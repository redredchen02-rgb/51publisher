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
	refillGateFailed,
	releaseAllQuarantine,
	releaseQuarantine,
} from "../lib/batch";
import {
	type ApproveBatchDeps,
	approveBatch,
	createSerialQueue,
	discardBatchItem,
	regenItemWithFacts,
	retryItem,
	runBatch,
} from "../lib/batch-orchestrator";
import { withBackendSync } from "../lib/batch-sync";
import {
	type DispatchCtx,
	evaluateInterlock,
	hashDraft,
	type InterlockVerdict,
} from "../lib/first-flight";
import {
	type FirstFlightIntent,
	runFirstFlight,
} from "../lib/first-flight-orchestrator";
import { evaluateGrounding } from "../lib/grounding-gate";
import { generateDraft, reviewDraft, rewriteDraft } from "../lib/llm";
import { logger } from "../lib/logger";
import { updatePendingStatus } from "../lib/pending-client";
import { assemblePrompt, buildConstraintSuffix } from "../lib/prompt-assembly";
import { type GateDecision, gateReason } from "../lib/publish-orchestrator";
import {
	type PublishedPostRecord,
	recordPublishedPost,
} from "../lib/published-posts-client";
import { clearReadItems } from "../lib/read-tracker";
import { reassembleWithFacts } from "../lib/refill";
import { canSubmit } from "../lib/safety-gate";
import {
	addPublishedTopics,
	appendTrajectory,
	clearAllFillTombstones,
	clearFillTombstone,
	clearFirstFlight,
	type FirstFlightMarker,
	type FirstFlightRead,
	getApiKey,
	getAuthorizedHosts,
	getBatch,
	getBatch as getBatchRaw,
	getFillTombstones,
	getFirstFlight,
	getPublishedTopics,
	getSafetyMode,
	getSettings,
	refreshRemoteMappings,
	saveBatch,
	saveDryRunReport,
	setPendingQuarantineAlert,
	setSafetyMode,
	writeFillTombstone,
	writeFirstFlight,
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
	setSafetyMode: (
		mode: import("@51publisher/shared").SafetyMode,
	) => Promise<void>;
	getAuthorizedHosts: () => Promise<string[]>;
	// ---- First-flight 互锁(Unit 4/5)----
	getFirstFlight: () => Promise<FirstFlightRead>;
	writeFirstFlight: (marker: FirstFlightMarker) => Promise<boolean>;
	clearFirstFlight: () => Promise<void>;
	/** 一次性告警下沉(默认 console);测试可断言安全事件已发。 */
	emitSecurityAlert?: (event: string, detail?: unknown) => void;
	/** 武装时启动 one-shot 看门狗 alarm(可注入;默认 browser.alarms)。 */
	armWatchdog?: () => void;
	/** 干净 settle / reset 后清看门狗 alarm。 */
	clearWatchdog?: () => void;
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

/** 默认安全事件下沉(可被 deps.emitSecurityAlert 覆盖供测试断言)。 */
function defaultSecurityAlert(event: string, detail?: unknown): void {
	logger.warn(
		"bg",
		`[SECURITY] ${event}`,
		detail != null ? { detail } : undefined,
	);
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

	// ================================================================
	// First-flight 互锁(Unit 4/5)
	// ================================================================
	//
	// 状态都活在本 createHandlers 闭包里——liveDeps 那次 createHandlers 在每次 SW 启动时
	// 跑一遍,故这些变量天然随 SW 生命周期重置(SW 重启 → liveArmNonce 丢失,残留 pending
	// 的 nonce 必不匹配 → 互锁 block + 触发 reset)。
	const emitAlert = deps.emitSecurityAlert ?? defaultSecurityAlert;
	const armWatchdog = deps.armWatchdog ?? (() => {});
	const clearWatchdog = deps.clearWatchdog ?? (() => {});

	// in-memory arm-nonce:arm 时生成,只存内存(绝不落盘)。互锁额外要求它 === 标记里的 nonce。
	let liveArmNonce: string | null = null;
	// arm 串行临界区:check 标记 → 写 → 读回确认 → 翻 authorized 全程串行。
	const armQueue = createSerialQueue();
	// 连续强制 reset 计数(无干净 settle);达 N 回落 off,要求显式重新启用。
	const MAX_CONSECUTIVE_RESETS = 2;
	let consecutiveResets = 0;

	/**
	 * 本 SW 生命周期的「启动 reset 闸」:任何 publish-class handler 发 grant 前必须等它 settle。
	 * 默认未跑(undefined)→ 阻断;runStartupReset 完成后置为 resolved。
	 */
	let startupResetDone: Promise<void> | null = null;

	/**
	 * 强制 reset:降级保护(lower mode first → then clear marker)。
	 * 不可逆 grant 路径在此之前一律阻断。reset 目标 = dry-run(保留工作能力,非 off)。
	 * 连续 N 次未干净 settle → 回落 off + 要求显式重新启用。
	 */
	async function forceReset(cause: string, marker?: FirstFlightMarker | null) {
		consecutiveResets += 1;
		emitAlert("first-flight-forced-reset", { cause, consecutiveResets });
		liveArmNonce = null;
		clearWatchdog();
		if (consecutiveResets >= MAX_CONSECUTIVE_RESETS) {
			// 持续楔住:不当噪声处理,落 off 强制人工重新启用。
			emitAlert("first-flight-wedge-fallback-off", { consecutiveResets });
			await deps.setSafetyMode("off").catch(() => {});
			await deps.clearFirstFlight().catch(() => {});
			return;
		}
		// 非对称 revert:先降级档位,再清标记。
		const target = marker?.mode === "off" ? "off" : "dry-run";
		await deps.setSafetyMode(target).catch(() => {});
		await deps.clearFirstFlight().catch(() => {});
	}

	/**
	 * SW 启动 reset(Unit 4):标记在场即无条件 reset(独立于是否有 batch),并发安全事件。
	 * - 坏值标记 → 强制 reset。
	 * - 有 pending 残留 → SW 重启已丢 liveArmNonce,该 pending 必不可信 → 强制 reset。
	 * - 仅有 mode 无 pending(干净 arm 标记残留)→ 也 reset(无在场内存 nonce 撑不起 authorized)。
	 * - 干净缺失 → 不动 mode(happy path)。
	 */
	async function runStartupReset(): Promise<void> {
		try {
			const read = await deps.getFirstFlight();
			if (read.state === "absent") {
				consecutiveResets = 0; // 干净 settle
				return;
			}
			if (read.state === "bad") {
				await forceReset("startup-bad-marker", null);
				return;
			}
			// state==='ok':标记在场(无论有无 pending)→ 无条件 reset。
			await forceReset("startup-residual-marker", read.marker);
		} catch (e) {
			logger.warn("bg", "first-flight startup reset 失败", {
				err: e instanceof Error ? e.message : String(e),
			});
		}
	}

	/** 触发并记忆本 SW 生命周期的启动 reset(幂等,只跑一次)。 */
	function ensureStartupReset(): Promise<void> {
		if (!startupResetDone) startupResetDone = runStartupReset();
		return startupResetDone;
	}

	/**
	 * Arm(首飞武装):串行临界区。
	 * write {mode:被保护档位 kept, marker(pending)} → 读回确认 → 只有确认通过才翻 authorized。
	 * 写失败 / 读回不符 → REJECT(绝不进入 authorized 已置但标记缺失)。
	 * 返回 { ok, nonce? }。
	 */
	async function handleArmFirstFlight(args: {
		itemId: string;
		tabId: number;
		host: string;
		draft: ContentDraft;
	}): Promise<{ ok: boolean; reason?: string }> {
		return armQueue(async () => {
			// 临界区起点:若已有标记(并发二次 arm / 残留)→ 拒绝。
			const existing = await deps.getFirstFlight();
			if (existing.state !== "absent") {
				return { ok: false, reason: "first-flight-already-armed" };
			}
			const protectedMode = await deps.getSafetyMode();
			const nonce = crypto.randomUUID();
			const contentHash = await hashDraft(args.draft);
			const marker: FirstFlightMarker = {
				mode: protectedMode,
				pending: {
					itemId: args.itemId,
					tabId: args.tabId,
					host: args.host,
					contentHash,
					nonce,
					ts: deps.now(),
				},
			};
			const written = await deps.writeFirstFlight(marker);
			if (!written) {
				// 写失败 / 读回不符:清掉任何半写状态,绝不翻 authorized。
				await deps.clearFirstFlight().catch(() => {});
				return { ok: false, reason: "first-flight-write-failed" };
			}
			// 读回确认通过 → 只有此刻才置内存 nonce 并翻 authorized。
			liveArmNonce = nonce;
			await deps.setSafetyMode("authorized");
			armWatchdog();
			return { ok: true };
		});
	}

	/**
	 * 互锁守卫(Unit 5):在 fill 决策点 AND sendGrant 闭包各求值一次。
	 * **每次都重读标记**(close TOCTOU:APPROVE_BATCH 可能在标记写入前已过 evaluateGate)。
	 * - 标记坏值 → block + 强制 reset。
	 * - 无 pending → 放行(走正常 canSubmit 路径)。
	 * - 有 pending → evaluateInterlock 全等校验 + liveArmNonce 校验;不符 block,可疑信号触发 reset。
	 */
	async function firstFlightGuard(
		dispatch: DispatchCtx,
	): Promise<InterlockVerdict> {
		const read = await deps.getFirstFlight();
		if (read.state === "bad") {
			await forceReset("guard-bad-marker", null);
			return { allowed: false, reason: "first-flight-locked", needReset: true };
		}
		const pending = read.state === "ok" ? read.marker.pending : null;
		const dispatchHash = await hashDraft(dispatch.draft);
		const verdict = evaluateInterlock({
			pending,
			liveNonce: liveArmNonce,
			dispatch,
			dispatchHash,
		});
		if (verdict.needReset) {
			await forceReset(
				verdict.reason ?? "guard-mismatch",
				read.state === "ok" ? read.marker : null,
			);
		}
		return verdict;
	}

	/**
	 * 干净落定 revert(Unit 6 首飞收尾):非对称降级保护(先降档 → 再清标记)。
	 * 与 forceReset 的区别:这是**预期内**的窗口关闭(派发完/排演未过),不是可疑信号,
	 * 故不累加 consecutiveResets,反而归零(等同一次干净 settle),避免正常首飞把楔住计数顶满落 off。
	 */
	async function settleRevert(
		cause: string,
		marker?: FirstFlightMarker | null,
	): Promise<void> {
		liveArmNonce = null;
		clearWatchdog();
		const target = marker?.mode === "off" ? "off" : "dry-run";
		await deps.setSafetyMode(target).catch(() => {});
		await deps.clearFirstFlight().catch(() => {});
		consecutiveResets = 0; // 干净 settle:楔住计数归零
		emitAlert("first-flight-settle", { cause });
	}

	/** 时间看门狗(Unit 4):dispatch 挂起 + SW 仍存活的窄缝。fire → 强制 revert dry-run + 清 pending。 */
	async function handleWatchdog(): Promise<void> {
		try {
			const read = await deps.getFirstFlight();
			if (read.state === "absent") return;
			emitAlert("first-flight-watchdog-fired", {});
			await forceReset(
				"watchdog-timeout",
				read.state === "ok" ? read.marker : null,
			);
		} catch (e) {
			logger.warn("bg", "first-flight watchdog 失败", {
				err: e instanceof Error ? e.message : String(e),
			});
		}
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
			logger.error("bg", "生成草稿失败", {
				err: err instanceof Error ? err.message : String(err),
			});
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
			logger.error("bg", "批量生成失败", {
				err: err instanceof Error ? err.message : String(err),
			});
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
				logger.warn("bg", "轨迹快照含机密被丢弃(record 已落,无快照)", {
					itemId,
				}),
			saveDryRunReportFn: deps.saveDryRunReportFn,
			writeTombstone: deps.writeTombstone,
			clearTombstone: deps.clearTombstone,
			checkGrounding: evaluateGrounding,
			recordPost: deps.recordPost ?? recordPublishedPost,
			firstFlightGuard,
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
			// publish-class handler 默认阻断,直到本 SW 生命周期的启动 reset 跑完(grant 前置条件)。
			await ensureStartupReset();
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
					deps.addPublishedTopics(confirmedTopics).catch((e) =>
						logger.warn("bg", "addPublishedTopics 写入失败(best-effort)", {
							err: e instanceof Error ? e.message : String(e),
						}),
					);
				}
			}
			return result;
		} catch (err) {
			logger.error("bg", "发布失败", {
				err: err instanceof Error ? err.message : String(err),
			});
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
			logger.error("bg", "发布失败", {
				err: err instanceof Error ? err.message : String(err),
			});
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
			logger.error("bg", "重试条目失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			return deps.getBatch();
		}
	}

	/**
	 * 操作者在 FactsEdit 修改完整事实后触发 LLM 重生成。
	 * 原子性:generateDraft 成功后才写 facts+draft+snapshot;失败时 facts 不变。
	 * 安全边界:提升至 awaiting-approval,真发仍须经 approve 路径 host 授权 + 闸门。
	 */
	async function handleEditFactsAndRegen(
		itemId: string,
		newFacts: FactsBlock,
	): Promise<Batch | null> {
		try {
			const [settings, apiKey] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
			]);
			return await regenItemWithFacts(
				{
					getBatch: deps.getBatch,
					save: deps.saveBatch,
					generateDraft: (topic, itemFacts, enrichment) => {
						const prompt = assemblePrompt(settings, topic, itemFacts);
						return deps.generateDraftFn(prompt, {
							settings,
							apiKey,
							facts: itemFacts,
							enrichment,
						});
					},
					evaluateGrounding: (draft, facts, qualityScore, recommendedTags) =>
						evaluateGrounding(draft, facts, qualityScore, recommendedTags),
				},
				itemId,
				newFacts,
			);
		} catch (err) {
			logger.error("bg", "editFactsAndRegen 失败", {
				err: err instanceof Error ? err.message : String(err),
			});
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
				).catch((err) =>
					logger.warn("bg", "updatePendingStatus failed", {
						err: err instanceof Error ? err.message : String(err),
					}),
				);
			}
			return next;
		} catch {
			// Item may have already transitioned (concurrent approveBatch race). Treat as no-op.
			return batch;
		}
	}

	/**
	 * 操作者补齐缺失事实 → 重组装 + 重跑闸门(gate-failed → awaiting-approval)。
	 *
	 * 访问控制:这是特权通道(改 facts/draft/snapshot 并驱动提升)。它本身**绝不**授权发布——
	 * 提升仅由 refillGateFailed 内的闸门重跑决定(唯一提升者),且即便提升也只到 awaiting-approval,
	 * 真发仍须经 approve 路径的 host 授权 + 闸门。消息只应来自 side panel(扩展 UI 同源);
	 * content/page 世界绝不发此消息(三世界模型:content「绝不自我授权」)。
	 * WXT/chrome runtime.onMessage 不向 SW 暴露可信的 sender 来源(externally_connectable 未开),
	 * 故此处以「信任契约 + 闸门为唯一提升者」兜底,而非校验 sender;真正的安全边界是闸门重跑。
	 *
	 * 守卫:① 无 batch / 找不到 item → no-op;② 缺 slots(旧条目)或非 gate-failed →
	 * 返回原 batch(不 mutate),由 UI 据状态路由到「重新生成」;③ 操作者 URL 不合法 →
	 * 把拒因写入 item.gateFailReason(仍 gate-failed),不 mutate draft/snapshot。
	 * 仅在重组装成功后才经 refillGateFailed 提交(本地为主,后端经 withBackendSync best-effort)。
	 */
	async function handleRefillItemFacts(
		itemId: string,
		facts: FactsBlock,
	): Promise<Batch | null> {
		const batch = await deps.getBatch();
		if (!batch) return null;
		const item = batch.items.find((it) => it.id === itemId);
		if (!item) return batch;
		// 仅 gate-failed 可补全;缺 slots 的旧条目无法重组装。两者均 no-op(不 mutate)。
		if (item.status !== "gate-failed" || !item.slots) return batch;

		const reassembled = reassembleWithFacts(item, facts, deps.now());
		if (!reassembled.ok) {
			// 重组装拒绝(目前仅 invalid-url;no-slots 已被上面拦下)。把拒因写入失败原因,
			// 仍保持 gate-failed,不改 draft/snapshot。
			const next: Batch = {
				...batch,
				items: batch.items.map((it) =>
					it.id === itemId
						? { ...it, gateFailReason: reassembled.message }
						: it,
				),
			};
			await deps.saveBatch(next);
			return next;
		}

		// 重组装成功 → 经 refillGateFailed 原子地重跑闸门并决定终态。
		const next = refillGateFailed(
			batch,
			itemId,
			{
				draft: reassembled.draft,
				snapshot: reassembled.snapshot,
				facts: reassembled.facts,
			},
			evaluateGrounding,
		);
		await deps.saveBatch(next);
		return next;
	}

	// ================================================================
	// First-flight 向导编排(Unit 6):rehearse / run / status
	// ================================================================

	/** 从当前 batch 取一条 awaiting-approval 且有 draft 的 item 身份(含 facts)。 */
	async function resolveIntent(
		tabId: number,
		itemId: string,
	): Promise<
		{ ok: true; intent: FirstFlightIntent } | { ok: false; error: string }
	> {
		const host = (await evaluateGate(tabId)).host;
		if (host == null) return { ok: false, error: "host-unreachable" };
		const batch = await deps.getBatch();
		const item = batch?.items.find((it) => it.id === itemId);
		if (!item?.draft) return { ok: false, error: "item-not-found" };
		return {
			ok: true,
			intent: {
				itemId,
				tabId,
				host,
				draft: item.draft,
				...(item.facts ? { facts: item.facts } : {}),
			},
		};
	}

	/**
	 * 排演(只读):对**同一快照**跑 dry-run(approveBatch dry-run 档,itemIdFilter)+ grounding。
	 * 关键:evaluateGate 在此被强制为 dry-run(绝不读全局档、绝不翻 authorized);grounding 对
	 * snapshot(防 AI 重写洗【待补】)与最终 draft 各求值一次,任一不过即拦。
	 */
	async function rehearseIntent(intent: FirstFlightIntent): Promise<{
		dryRunGreen: boolean;
		grounding: ReturnType<typeof evaluateGrounding>;
	}> {
		// dry-run 强制闸:无论全局档为何,排演恒在 dry-run 下进行。
		const dryRunGate = async (): Promise<GateDecision> => ({
			mode: "dry-run",
			allowed: false,
			host: intent.host,
			reason: "dry-run",
		});
		const rehearseDeps = buildApproveDeps(intent.tabId, intent.itemId);
		let dryRunReached = false;
		const result = await approveBatch({
			...rehearseDeps,
			evaluateGate: dryRunGate,
			// 排演不写正式 dry-run 报告(避免污染向导外的报告视图);只探测是否走到 dry-run。
			saveDryRunReportFn: async (report) => {
				dryRunReached = report.items.some((it) => it.itemId === intent.itemId);
			},
			// 排演不启用互锁(无标记;互锁在真正 run 时兜底)。
			firstFlightGuard: undefined,
		});
		// grounding:对快照 + 最终 draft 各求值一次(与 approveBatch authorized 闸同口径)。
		const cur = result?.items.find((it) => it.id === intent.itemId);
		const snapshot = cur?.assembledDraftSnapshot;
		const vSnapshot = snapshot
			? evaluateGrounding(snapshot, intent.facts)
			: {
					ok: false,
					reasons: ["缺发布快照(assembledDraftSnapshot),请重新生成后再发。"],
				};
		const vFinal = evaluateGrounding(intent.draft, intent.facts);
		const reasons = [...new Set([...vSnapshot.reasons, ...vFinal.reasons])];
		return {
			dryRunGreen: dryRunReached,
			grounding: { ok: vSnapshot.ok && vFinal.ok, reasons },
		};
	}

	async function handleFirstFlightRehearse(
		tabId: number,
		itemId: string,
	): Promise<import("@51publisher/shared").FirstFlightRehearseResult> {
		try {
			const resolved = await resolveIntent(tabId, itemId);
			if (!resolved.ok)
				return {
					ok: false,
					dryRunGreen: false,
					groundingOk: false,
					reasons: [],
					error: resolved.error,
				};
			const r = await rehearseIntent(resolved.intent);
			return {
				ok: r.dryRunGreen && r.grounding.ok,
				dryRunGreen: r.dryRunGreen,
				groundingOk: r.grounding.ok,
				reasons: r.grounding.reasons,
			};
		} catch (err) {
			logger.error("bg", "first-flight rehearse 失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				dryRunGreen: false,
				groundingOk: false,
				reasons: [],
				error: "rehearse-internal-error",
			};
		}
	}

	/**
	 * 执行首飞:排演→武装→最小窗口派发恰好一条→finally revert。
	 * authorized 翻转只在 arm 内发生;最小窗口 = approveBatch({itemIdFilter}) 这一次派发;
	 * revert 由 forceReset 在 finally 兜底(先降档 dry-run → 再清标记)。
	 */
	async function handleFirstFlightRun(
		tabId: number,
		itemId: string,
	): Promise<import("@51publisher/shared").FirstFlightRunResult> {
		try {
			// publish-class:发 grant 前等启动 reset settle(与 runApprove 同前置条件)。
			await ensureStartupReset();
			const resolved = await resolveIntent(tabId, itemId);
			if (!resolved.ok)
				return {
					ok: false,
					phase: "rehearse",
					reverted: true,
					error: resolved.error,
				};

			const outcome = await runFirstFlight({
				intent: resolved.intent,
				rehearse: rehearseIntent,
				arm: (it) =>
					handleArmFirstFlight({
						itemId: it.itemId,
						tabId: it.tabId,
						host: it.host,
						draft: it.draft,
					}),
				dispatchOne: () => runApprove(tabId, itemId),
				revert: async (cause) => {
					const read = await deps.getFirstFlight();
					await settleRevert(cause, read.state === "ok" ? read.marker : null);
				},
			});

			if (outcome.phase === "dispatched")
				return {
					ok: true,
					phase: "dispatched",
					itemStatus: outcome.itemStatus,
					...(outcome.publishUrl ? { publishUrl: outcome.publishUrl } : {}),
					reverted: outcome.reverted,
				};
			return {
				ok: false,
				phase: outcome.phase,
				reason: outcome.reason,
				reverted: outcome.reverted,
			};
		} catch (err) {
			logger.error("bg", "first-flight run 失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			// 异常路径兜底 revert,绝不留 authorized 窗口悬空。
			await forceReset("first-flight-run-exception").catch(() => {});
			return {
				ok: false,
				phase: "arm",
				reverted: true,
				error: "run-internal-error",
			};
		}
	}

	async function handleFirstFlightStatus(): Promise<
		import("@51publisher/shared").FirstFlightStatusResult
	> {
		const [mode, read] = await Promise.all([
			deps.getSafetyMode(),
			deps.getFirstFlight(),
		]);
		return {
			mode,
			armed: read.state === "ok" && read.marker.pending !== null,
			bad: read.state === "bad",
		};
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
		handleRefillItemFacts,
		handleEditFactsAndRegen,
		handleDiscardBatchItem,
		evaluateGate,
		handleArmFirstFlight,
		firstFlightGuard,
		ensureStartupReset,
		handleWatchdog,
		handleFirstFlightRehearse,
		handleFirstFlightRun,
		handleFirstFlightStatus,
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
		logger.warn("bg", "generating recovery scan 失败", {
			err: e instanceof Error ? e.message : String(e),
		});
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
		logger.warn("bg", "tombstone startup scan 失败", {
			err: e instanceof Error ? e.message : String(e),
		});
	}
}

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
