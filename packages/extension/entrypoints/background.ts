import type { RuntimeMessage } from "@51publisher/shared";
import { storage } from "#imports";
import {
	type BackgroundHandlerDeps as _BHD,
	asPublishResult,
	buildConstraintSuffix,
	createHandlers,
	generateDraft,
	getBatch,
	getSettings,
	refreshRemoteMappings,
	saveBatch,
	withBackendSync,
} from "../lib/bg-handlers";

export { createHandlers };

import {
	runStartupGeneratingRecovery,
	runStartupTombstoneScan,
} from "../lib/bg-startup";
import { logger } from "../lib/logger";
import {
	addPublishedTopics,
	appendTrajectory,
	clearFillTombstone,
	clearFirstFlight,
	getApiKey,
	getAuthorizedHosts,
	getFirstFlight,
	getPublishedTopics,
	getSafetyMode,
	saveDryRunReport,
	setSafetyMode,
	writeFillTombstone,
	writeFirstFlight,
} from "../lib/storage";

// Background service worker:调度中心 + 发布闸门。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 APPROVE_BATCH/APPROVE_SINGLE_ITEM → grounding 双求值闸 + 发布编排
//   (host 取自 chrome.tabs.get(tabId).url)→ 仅授权才发准许。单条裸奔发布路径已退役。

// Re-exports for backward-compat (background.test.ts imports these from background).
export type BackgroundHandlerDeps = _BHD;
export { asPublishResult, buildConstraintSuffix, runStartupGeneratingRecovery };

export default defineBackground(() => {
	browser.sidePanel
		?.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) =>
			logger.error("bg", "setPanelBehavior 失败", {
				err: err instanceof Error ? err.message : String(err),
			}),
		);

	// SW 启动扫描:检测上次 fill 飞行中 SW 被回收的残留 tombstone → 设隔离通知。
	void runStartupTombstoneScan();
	// SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error,让操作者可以重试。
	void runStartupGeneratingRecovery();

	// 启动时拉取后端最新字段映射(选择器配置热更新)。
	// 后端不可达时 fail-closed,不覆盖本地已有映射。
	refreshRemoteMappings()
		.then(({ remote }) => {
			if (remote) logger.debug("bg", "远程映射配置已刷新");
			else logger.debug("bg", "使用本地默认映射(后端不可达)");
		})
		.catch((e) =>
			logger.warn("bg", "刷新远程映射失败", {
				err: e instanceof Error ? e.message : String(e),
			}),
		);

	// SW Keep-Alive 机制: 定时唤醒，防止超大批次时背景因闲置被杀。
	// 防御:alarms 权限缺失时 browser.alarms 为 undefined,绝不让它拖垮整个 SW 启动。
	if (browser.alarms) {
		browser.alarms.create("keep-alive", { periodInMinutes: 1 });
		browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
			if (alarm.name === "keep-alive") {
				logger.debug("bg", "keep-alive ping");
			}
		});
	} else {
		logger.warn("bg", "chrome.alarms 不可用(缺 alarms 权限?),跳过 keep-alive");
	}

	let batchSeq = 0;

	const liveDeps: BackgroundHandlerDeps = {
		getBatch,
		saveBatch: withBackendSync(saveBatch),
		getSettings,
		getApiKey,
		getPublishedTopics,
		addPublishedTopics,
		appendTrajectory,
		getSafetyMode,
		setSafetyMode,
		getAuthorizedHosts,
		getFirstFlight,
		writeFirstFlight,
		clearFirstFlight,
		armWatchdog: () => {
			// one-shot,>=1.5min(~90s,避开 ~60s clamp)。
			browser.alarms?.create("first-flight-watchdog", { delayInMinutes: 1.5 });
		},
		clearWatchdog: () => {
			browser.alarms?.clear("first-flight-watchdog").catch(() => {});
		},
		tabsGet: (id) => browser.tabs.get(id),
		tabsSendMessage: (id, msg) => browser.tabs.sendMessage(id, msg),
		storageGetItem: (key) => storage.getItem(key),
		storageSetItem: (key, val) => storage.setItem(key, val),
		generateDraftFn: generateDraft,
		buildBatchId: () => {
			batchSeq += 1;
			return `batch_${Date.now()}_${batchSeq}`;
		},
		buildItemId: (batchId: string, i: number) => `${batchId}:${i}`,
		now: () => new Date().toISOString(),
		saveDryRunReportFn: saveDryRunReport,
		writeTombstone: (itemId) =>
			writeFillTombstone(itemId, { tabId: 0, ts: new Date().toISOString() }),
		clearTombstone: clearFillTombstone,
	};

	const handlers = createHandlers(liveDeps);

	// SW 启动 reset:标记在场即无条件 reset(独立于 batch),发安全事件。
	// publish-class handler(runApprove)发 grant 前会 await 同一个 ensureStartupReset,默认阻断直到它 settle。
	void handlers.ensureStartupReset();

	// First-flight 时间看门狗:one-shot,delayInMinutes >= 1.5(~90s,避开 ~60s clamp)。
	// 仅覆盖「dispatch 挂起 + SW 仍存活」窄缝;ack 晚 ~1 周期,故互锁须在此延迟内仍权威。
	if (browser.alarms) {
		browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
			if (alarm.name === "first-flight-watchdog") {
				void handlers.handleWatchdog();
			}
		});
	}

	browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
		if (message?.type === "GENERATE_DRAFT")
			return handlers.handleGenerate(message.prompt);
		if (message?.type === "RUN_BATCH")
			return handlers.handleRunBatch(
				message.topics,
				message.tabId,
				message.facts,
				message.iterate,
				message.coverImageUrls,
				message.topicIds,
				message.enrichments,
			);
		if (message?.type === "APPROVE_BATCH")
			return handlers.handleApproveBatch(message.tabId, message.draftOverrides);
		if (message?.type === "APPROVE_SINGLE_ITEM")
			return handlers.handleApproveSingleItem(message.tabId, message.itemId);
		if (message?.type === "KILL_BATCH") return handlers.handleKillBatch();
		if (message?.type === "RELEASE_QUARANTINE")
			return handlers.handleReleaseQuarantine(message.itemId);
		if (message?.type === "RELEASE_QUARANTINE_BATCH")
			return handlers.handleReleaseQuarantineBatch();
		if (message?.type === "MARK_ITEM_EDITED")
			return handlers.handleMarkItemEdited(message.itemId);
		if (message?.type === "RETRY_BATCH_ITEM")
			return handlers.handleRetryBatchItem(message.itemId);
		if (message?.type === "REFILL_ITEM_FACTS")
			return handlers.handleRefillItemFacts(message.itemId, message.facts);
		if (message?.type === "EDIT_FACTS_AND_REGEN")
			return handlers.handleEditFactsAndRegen(message.itemId, message.newFacts);
		if (message?.type === "DISCARD_BATCH_ITEM")
			return handlers.handleDiscardBatchItem(
				message.itemId,
				message.rejectionReason,
			);
		if (message?.type === "FIRST_FLIGHT_REHEARSE")
			return handlers.handleFirstFlightRehearse(message.tabId, message.itemId);
		if (message?.type === "FIRST_FLIGHT_RUN")
			return handlers.handleFirstFlightRun(message.tabId, message.itemId);
		if (message?.type === "FIRST_FLIGHT_STATUS")
			return handlers.handleFirstFlightStatus();
		if (message?.type === "GET_BATCH") return getBatch();
		return undefined;
	});
});
