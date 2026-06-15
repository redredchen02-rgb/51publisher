import type {
	ContentDraft,
	FactsBlock,
	FillPageResponse,
	GenerateDraftResponse,
	PublishResult,
	RuntimeMessage,
} from "@51publisher/shared";
import { storage } from "#imports";
import {
	abortBatch,
	type Batch,
	patchBatchDrafts,
	releaseAllQuarantine,
	releaseQuarantine,
} from "../lib/batch";
import {
	type ApproveBatchDeps,
	approveBatch,
	discardBatchItem,
	retryItem,
	runBatch,
} from "../lib/batch-orchestrator";
import { withBackendSync } from "../lib/batch-sync";
import { evaluateGrounding } from "../lib/grounding-gate";
import { generateDraft, reviewDraft, rewriteDraft } from "../lib/llm";
import { updatePendingStatus } from "../lib/pending-client";
import { assemblePrompt, buildConstraintSuffix } from "../lib/prompt-assembly";
import { type GateDecision, gateReason } from "../lib/publish-orchestrator";
import {
	type PublishedPostRecord,
	recordPublishedPost,
} from "../lib/published-posts-client";
import { clearReadItems } from "../lib/read-tracker";
import { canSubmit } from "../lib/safety-gate";
import {
	addPublishedTopics,
	appendTrajectory,
	clearAllFillTombstones,
	clearFillTombstone,
	getApiKey,
	getAuthorizedHosts,
	getBatch,
	getBatch as getBatchRaw,
	getFillTombstones,
	getPublishedTopics,
	getSafetyMode,
	getSettings,
	refreshRemoteMappings,
	saveBatch,
	saveDryRunReport,
	setPendingQuarantineAlert,
	writeFillTombstone,
} from "../lib/storage";

// Background service worker:调度中心 + 发布闸门。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 APPROVE_BATCH/APPROVE_SINGLE_ITEM → grounding 双求值闸 + 发布编排
//   (host 取自 chrome.tabs.get(tabId).url)→ 仅授权才发准许。单条裸奔发布路径已退役。

export interface BackgroundHandlerDeps {
	getBatch: () => Promise<Batch | null>;
	saveBatch: (batch: Batch) => Promise<void>;
	getSettings: () => Promise<import("@51publisher/shared").Settings>;
	getApiKey: () => Promise<string>;
	getPublishedTopics: () => Promise<string[]>;
	addPublishedTopics: (topics: string[]) => Promise<void>;
	appendTrajectory: typeof appendTrajectory;
	getSafetyMode: () => Promise<import("@51publisher/shared").SafetyMode>;
	getAuthorizedHosts: () => Promise<string[]>;
	tabsGet: (tabId: number) => Promise<{ url?: string; id?: number }>;
	tabsSendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
	storageGetItem: <T>(key: `local:${string}`) => Promise<T | null>;
	storageSetItem: (key: `local:${string}`, value: unknown) => Promise<void>;
	generateDraftFn: (
		prompt: string,
		opts: {
			settings: import("@51publisher/shared").Settings;
			apiKey: string;
			facts?: FactsBlock;
			enrichment?: string;
		},
	) => Promise<GenerateDraftResponse>;
	buildBatchId: () => string;
	buildItemId: (batchId: string, i: number) => string;
	now: () => string;
	saveDryRunReportFn?: (
		report: import("@51publisher/shared").DryRunReport,
	) => Promise<void>;
	writeTombstone?: (itemId: string) => Promise<void>;
	clearTombstone?: (itemId: string) => Promise<void>;
	/** published_posts 回写(best-effort);可注入 mock 供测试。默认用 recordPublishedPost。 */
	recordPost?: (record: PublishedPostRecord) => Promise<void>;
}

// buildConstraintSuffix / assemblePrompt 已抽到 lib/prompt-assembly.ts。
// re-export 保留既有导出面(background.test.ts 仍从 background 导入 buildConstraintSuffix)。
export { buildConstraintSuffix };

/** 从 chrome.tabs.get(tabId).url 取 host;tab 关/无 url → null。 */
function makeResolveTabHost(deps: Pick<BackgroundHandlerDeps, "tabsGet">) {
	return async (tabId: number): Promise<string | null> => {
		try {
			const tab = await deps.tabsGet(tabId);
			if (!tab?.url) return null;
			return new URL(tab.url).hostname;
		} catch {
			return null;
		}
	};
}

/** content 经消息边界回来的值是 unknown → 校验形状。 */
export function asPublishResult(value: unknown): PublishResult {
	if (value && typeof value === "object") {
		const o = value as Record<string, unknown>;
		if (typeof o.ok === "boolean" && typeof o.dryRun === "boolean") {
			const hasError = typeof o.error === "string";
			// 判别式形状校验(fail-closed):成功结果不得携带 error(畸形 → 降级为失败,
			// 杜绝把 { ok:true, error } 记成 publish-confirmed 的假确认);失败结果必须带可读 error。
			if (o.ok === true && hasError) {
				return {
					ok: false,
					dryRun: o.dryRun,
					error: "content-response-malformed",
				};
			}
			if (o.ok === false && !hasError) {
				return {
					ok: false,
					dryRun: o.dryRun,
					error: "content-response-invalid",
				};
			}
			return {
				ok: o.ok,
				dryRun: o.dryRun,
				...(typeof o.url === "string" ? { url: o.url } : {}),
				...(hasError ? { error: o.error as string } : {}),
			};
		}
	}
	return { ok: false, dryRun: false, error: "content-response-invalid" };
}

export function createHandlers(deps: BackgroundHandlerDeps) {
	const resolveTabHost = makeResolveTabHost(deps);

	// TOCTOU fix: 三个异步读在同一个 Promise.all 里并发触发,消除两次 await 之间 tab 可导航的窗口。
	async function evaluateGate(tabId: number): Promise<GateDecision> {
		const [mode, authorizedHosts, host] = await Promise.all([
			deps.getSafetyMode(),
			deps.getAuthorizedHosts(),
			resolveTabHost(tabId),
		]);
		const allowed = host != null && canSubmit({ host, mode, authorizedHosts });
		return { mode, allowed, host, reason: gateReason(mode, host, allowed) };
	}

	function pinnedHostOk(batch: Batch): Promise<boolean> {
		return resolveTabHost(batch.tabId).then(
			(h) => h !== null && h === batch.authorizedHost,
		);
	}

	async function handleGenerate(
		prompt: string,
	): Promise<GenerateDraftResponse> {
		try {
			const [settings, apiKey] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
			]);
			const constrainedPrompt =
				prompt + buildConstraintSuffix(settings.recommendedTags ?? []);
			return await deps.generateDraftFn(constrainedPrompt, {
				settings,
				apiKey,
			});
		} catch (err) {
			console.error("[bg] 生成草稿失败", err);
			return {
				ok: false,
				kind: "network",
				error: "生成草稿时发生内部错误,请重试。",
			};
		}
	}

	let _batchSeq = 0;

	async function handleRunBatch(
		topics: string[],
		tabId: number,
		facts?: FactsBlock[],
		iterate?: boolean,
		coverImageUrls?: string[],
		topicIds?: string[],
		enrichments?: (string | undefined)[],
	): Promise<Batch | null> {
		try {
			// 新批次启动:重置已读标记,确保门控从零开始(SW kill 后恢复也同样干净)。
			await clearReadItems();
			const [settings, apiKey, publishedTopics] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
				deps.getPublishedTopics(),
			]);
			return await runBatch({
				topics,
				facts,
				coverImageUrls,
				topicIds,
				enrichments,
				tabId,
				resolveHost: () => resolveTabHost(tabId),
				getExistingBatch: deps.getBatch,
				pinnedHostOk,
				generateDraft: (topic, itemFacts, enrichment) => {
					const prompt = assemblePrompt(settings, topic, itemFacts);
					return deps.generateDraftFn(prompt, {
						settings,
						apiKey,
						facts: itemFacts,
						enrichment,
					});
				},
				save: deps.saveBatch,
				genBatchId: () => {
					_batchSeq += 1;
					return deps.buildBatchId();
				},
				now: deps.now,
				persistentBlockedTopics: publishedTopics,
				bypassReentry: iterate,
				reviewDraft: (draft, criteriaPrompt) =>
					reviewDraft(draft, criteriaPrompt, { settings, apiKey }),
				rewriteDraft: (draft, failedDims) =>
					rewriteDraft(draft, failedDims, { settings, apiKey }),
				reviewCriteriaPrompt: settings.reviewCriteriaPrompt,
			});
		} catch (err) {
			console.error("[bg] 批量生成失败", err);
			return deps.getBatch();
		}
	}

	// 构造两条 approve 路径共享的 ApproveBatchDeps;itemIdFilter 仅在传入时设置。
	function buildApproveDeps(
		tabId: number,
		itemIdFilter?: string,
	): ApproveBatchDeps {
		return {
			getBatch: deps.getBatch,
			save: deps.saveBatch,
			pinnedHostOk,
			sendFill: async (draft: ContentDraft) => {
				try {
					return (await deps.tabsSendMessage(tabId, {
						type: "FILL_PAGE",
						draft,
					})) as FillPageResponse;
				} catch {
					return { ok: false, error: "fill-unreachable" };
				}
			},
			evaluateGate: () => evaluateGate(tabId),
			sendGrant: async () => {
				try {
					return asPublishResult(
						await deps.tabsSendMessage(tabId, { type: "PUBLISH_GRANT" }),
					);
				} catch {
					return { ok: false, dryRun: false, error: "content-unreachable" };
				}
			},
			appendTrajectory: deps.appendTrajectory,
			onSnapshotDropped: (itemId) =>
				console.warn(
					`[bg] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`,
				),
			saveDryRunReportFn: deps.saveDryRunReportFn,
			writeTombstone: deps.writeTombstone,
			clearTombstone: deps.clearTombstone,
			checkGrounding: evaluateGrounding,
			recordPost: deps.recordPost ?? recordPublishedPost,
			...(itemIdFilter ? { itemIdFilter } : {}),
		};
	}

	// 单一 approve 核心;两条消息入口共用。itemIdFilter 同时控制 approveBatch
	// 的过滤与 confirmedTopics 的过滤,保留两条路径合并前的全部差异分支。
	async function runApprove(
		tabId: number,
		itemIdFilter?: string,
	): Promise<Batch | null> {
		try {
			const result = await approveBatch(buildApproveDeps(tabId, itemIdFilter));
			if (result) {
				const confirmedTopics = result.items
					.filter(
						(it) =>
							it.status === "publish-confirmed" &&
							(!itemIdFilter || it.id === itemIdFilter),
					)
					.map((it) => it.topic);
				if (confirmedTopics.length > 0) {
					deps
						.addPublishedTopics(confirmedTopics)
						.catch((e) =>
							console.warn("[bg] addPublishedTopics 写入失败(best-effort)", e),
						);
				}
			}
			return result;
		} catch (err) {
			console.error("[bg] 发布失败", err);
			return deps.getBatch();
		}
	}

	async function handleApproveBatch(
		tabId: number,
		draftOverrides?: Record<string, ContentDraft>,
	): Promise<Batch | null> {
		// batch 入口独有:draftOverrides → patchBatchDrafts → saveBatch 预存步,
		// 必须在 approveBatch 之前发生。注意 try/catch 包住预存步以保持原行为
		// (预存失败也走 getBatch() 回退)。
		try {
			if (draftOverrides && Object.keys(draftOverrides).length > 0) {
				const current = await deps.getBatch();
				if (current) {
					await deps.saveBatch(patchBatchDrafts(current, draftOverrides));
				}
			}
		} catch (err) {
			console.error("[bg] 发布失败", err);
			return deps.getBatch();
		}
		return runApprove(tabId);
	}

	async function handleApproveSingleItem(
		tabId: number,
		itemId: string,
	): Promise<Batch | null> {
		// single 入口独有:入参守卫。
		if (typeof tabId !== "number" || typeof itemId !== "string" || !itemId)
			return deps.getBatch();
		return runApprove(tabId, itemId);
	}

	async function handleKillBatch(): Promise<Batch | null> {
		const batch = await deps.getBatch();
		if (!batch) return null;
		const next = abortBatch(batch);
		await deps.saveBatch(next);
		return next;
	}

	async function handleReleaseQuarantine(
		itemId: string,
	): Promise<Batch | null> {
		const batch = await deps.getBatch();
		if (!batch) return null;
		const next = releaseQuarantine(batch, itemId);
		await deps.saveBatch(next);
		return next;
	}

	async function handleReleaseQuarantineBatch(): Promise<Batch | null> {
		const batch = await deps.getBatch();
		if (!batch) return null;
		const next = releaseAllQuarantine(batch);
		if (next === batch) return batch; // 无隔离项,不写
		await deps.saveBatch(next); // 单次原子保存(全或无)
		return next;
	}

	async function handleMarkItemEdited(itemId: string): Promise<void> {
		const batch = await deps.getBatch();
		if (!batch) return;
		const item = batch.items.find((it) => it.id === itemId);
		if (!item || item.userEdited) return; // 已标记则幂等跳过
		const next = {
			...batch,
			items: batch.items.map((it) =>
				it.id === itemId ? { ...it, userEdited: true } : it,
			),
		};
		await deps.saveBatch(next);
	}

	async function handleRetryBatchItem(itemId: string): Promise<Batch | null> {
		try {
			const [settings, apiKey] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
			]);
			return await retryItem(
				{
					getBatch: deps.getBatch,
					save: deps.saveBatch,
					generateDraft: (topic, itemFacts) => {
						const prompt = assemblePrompt(settings, topic, itemFacts);
						return deps.generateDraftFn(prompt, {
							settings,
							apiKey,
							facts: itemFacts,
						});
					},
				},
				itemId,
			);
		} catch (err) {
			console.error("[bg] 重试条目失败", err);
			return deps.getBatch();
		}
	}

	async function handleDiscardBatchItem(
		itemId: string,
		rejectionReason?: import("@51publisher/shared").RejectionReason,
	): Promise<Batch | null> {
		const batch = await deps.getBatch();
		if (!batch) return null;
		const item = batch.items.find((it) => it.id === itemId);
		try {
			const next = discardBatchItem(batch, itemId);
			await deps.saveBatch(next);
			// fire-and-forget — 拒绝状态同步失败不影响 batch 本地状态
			if (item?.pendingTopicId && rejectionReason) {
				updatePendingStatus(
					item.pendingTopicId,
					"rejected",
					rejectionReason,
				).catch((err) => console.warn("[bg] updatePendingStatus failed:", err));
			}
			return next;
		} catch {
			// Item may have already transitioned (concurrent approveBatch race). Treat as no-op.
			return batch;
		}
	}

	return {
		handleGenerate,
		handleRunBatch,
		handleApproveBatch,
		handleApproveSingleItem,
		handleKillBatch,
		handleReleaseQuarantine,
		handleReleaseQuarantineBatch,
		handleMarkItemEdited,
		handleRetryBatchItem,
		handleDiscardBatchItem,
		evaluateGate,
	};
}

/**
 * SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error,
 * 让操作者可以重试。gate-failed 类终态不受影响。
 * 失败时只 warn,绝不阻断 SW 启动。
 */
export async function runStartupGeneratingRecovery(
	deps: {
		getBatch: () => Promise<import("../lib/batch").Batch | null>;
		saveBatch: (b: import("../lib/batch").Batch) => Promise<void>;
	} = { getBatch: getBatchRaw, saveBatch },
): Promise<void> {
	try {
		const batch = await deps.getBatch();
		if (!batch) return;
		let changed = false;
		for (const item of batch.items) {
			if (item.status === "generating") {
				item.status = "error";
				item.error = "SW restarted during generation";
				changed = true;
			}
		}
		if (changed) await deps.saveBatch(batch);
	} catch (e) {
		console.warn("[bg] generating recovery scan 失败", e);
	}
}

async function runStartupTombstoneScan(): Promise<void> {
	try {
		const [batch, tombstones] = await Promise.all([
			getBatchRaw(),
			getFillTombstones(),
		]);
		const tombstoneIds = Object.keys(tombstones);
		if (tombstoneIds.length === 0) return;

		// 清理无对应 batch 条目的残留 tombstone(重置/新批次后的孤儿)。
		if (batch) {
			const batchItemIds = new Set(batch.items.map((it) => it.id));
			const stale = tombstoneIds.filter((id) => !batchItemIds.has(id));
			for (const id of stale) {
				await clearFillTombstone(id).catch(() => {});
			}
		} else {
			await clearAllFillTombstones().catch(() => {});
		}

		// 统计 needs-human-verification 条目;有则设通知计数。
		const nhvCount = batch
			? batch.items.filter((it) => it.status === "needs-human-verification")
					.length
			: 0;
		if (nhvCount > 0) {
			await setPendingQuarantineAlert(nhvCount);
		}
	} catch (e) {
		console.warn("[bg] tombstone startup scan 失败", e);
	}
}

export default defineBackground(() => {
	browser.sidePanel
		?.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) => console.error("[bg] setPanelBehavior 失败", err));

	// SW 启动扫描:检测上次 fill 飞行中 SW 被回收的残留 tombstone → 设隔离通知。
	void runStartupTombstoneScan();
	// SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error,让操作者可以重试。
	void runStartupGeneratingRecovery();

	// 启动时拉取后端最新字段映射(选择器配置热更新)。
	// 后端不可达时 fail-closed,不覆盖本地已有映射。
	refreshRemoteMappings()
		.then(({ remote }) => {
			if (remote) console.debug("[bg] 远程映射配置已刷新");
			else console.debug("[bg] 使用本地默认映射(后端不可达)");
		})
		.catch((e) => console.warn("[bg] 刷新远程映射失败", e));

	// SW Keep-Alive 机制: 定时唤醒，防止超大批次时背景因闲置被杀。
	// 防御:alarms 权限缺失时 browser.alarms 为 undefined,绝不让它拖垮整个 SW 启动。
	if (browser.alarms) {
		browser.alarms.create("keep-alive", { periodInMinutes: 1 });
		browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
			if (alarm.name === "keep-alive") {
				console.debug("[bg] keep-alive ping");
			}
		});
	} else {
		console.warn("[bg] chrome.alarms 不可用(缺 alarms 权限?),跳过 keep-alive");
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
		getAuthorizedHosts,
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
		if (message?.type === "DISCARD_BATCH_ITEM")
			return handlers.handleDiscardBatchItem(
				message.itemId,
				message.rejectionReason,
			);
		if (message?.type === "GET_BATCH") return getBatch();
		return undefined;
	});
});
