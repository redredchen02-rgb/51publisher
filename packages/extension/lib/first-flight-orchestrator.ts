import type { ContentDraft, FactsBlock } from "@51publisher/shared";
import type { Batch } from "./batch";
import type { GroundingVerdict } from "./grounding-gate";

// 首飞编排(background 侧逻辑,效果全注入,便于单测)。
//
// 安全脊柱:首飞用「最小授权窗口」证明闸门时序正确——而非证明发布成功。流程严格五段:
//   1. 排演(rehearse):对**同一快照** 跑绿色 dry-run + grounding 通过;SHA-256 哈希 draft 字节。
//   2. 武装(arm):串行临界区里 durable 写单键 pending(itemId/tabId/host/contentHash/nonce/ts)+ 读回确认。
//      写失败 / 读回不符 → REJECT,绝不翻 authorized。arm 内部(handleArmFirstFlight)负责翻 authorized。
//   3. 最小窗口派发(dispatch):仅 authorized 档下经 approveBatch({itemIdFilter}) 派发**恰好一条**;
//      Unit 5 互锁(firstFlightGuard / preGrantGuard)在 fill 决策点与 grant 前各兜底一次。
//   4. 落定(settle):无论成功失败,finally 里非对称 revert(先降档 → 再清标记)。
//   5. 验证提示(verify):派发后提示操作者去**真站点核实**帖子是否落地(URL/内容)。
//
// 本模块**不**做任何自我授权 / 自动批准 / 旁路。authorized 翻转只发生在 arm 成功之后,
// revert 只发生在 finally;两者由 background 注入的真实 deps(handleArmFirstFlight / forceReset)执行。

/** 排演:对单条 item 跑 dry-run + grounding。 */
export interface RehearseResult {
	/** dry-run 是否绿(approveBatch 在 dry-run 档跑完且本条进了报告)。 */
	dryRunGreen: boolean;
	/** grounding 判决(对**同一快照**求值)。 */
	grounding: GroundingVerdict;
}

/** 一笔首飞意图的身份(host 由背景从 chrome.tabs.get 取,绝不接受消息携带的 host)。 */
export interface FirstFlightIntent {
	itemId: string;
	tabId: number;
	host: string;
	/** 实际将派发的 draft(与 dry-run / 哈希 / 派发同一份)。 */
	draft: ContentDraft;
	/** 该 draft 的结构化事实(grounding 判据);可省略。 */
	facts?: FactsBlock;
}

/** 终态判决。phase 标记走到了哪一步,便于 UI 与诊断;reverted 恒为 true(finally 兜底)。 */
export type FirstFlightOutcome =
	| {
			ok: false;
			phase: "rehearse";
			reason: string;
			/** 排演未过的可读原因(dry-run 不绿 / grounding 拦)。 */
			rehearsal: RehearseResult;
			reverted: boolean;
	  }
	| {
			ok: false;
			phase: "arm";
			reason: string;
			reverted: boolean;
	  }
	| {
			ok: true;
			phase: "dispatched";
			/** 派发后该 item 的终态(publish-confirmed / publish-failed / …)。 */
			itemStatus: string;
			/** content 回执的真实帖子 URL(若有);仅供操作者核实,不代表系统已证实落地。 */
			publishUrl?: string;
			/** 务必提示操作者去真站点核实的文案标记。 */
			verifyPrompt: true;
			reverted: boolean;
	  };

export interface FirstFlightOrchestratorDeps {
	intent: FirstFlightIntent;
	/**
	 * 排演:对**同一快照**跑 dry-run(approveBatch dry-run 档,itemIdFilter=本条)+ grounding。
	 * 必须在 arm 之前、在 dry-run 档下执行(绝不在 authorized 档排演)。
	 */
	rehearse: (intent: FirstFlightIntent) => Promise<RehearseResult>;
	/**
	 * 武装:串行临界区里 write pending + 读回确认 + (确认通过才)翻 authorized。
	 * 返回 { ok:false } 表示写失败 / 读回不符 / 已武装 → 调用方绝不进入派发。
	 * 由 background 注入 handleArmFirstFlight。
	 */
	arm: (intent: FirstFlightIntent) => Promise<{ ok: boolean; reason?: string }>;
	/**
	 * 最小窗口派发:仅在 arm 成功(已 authorized)后调用一次,经 approveBatch({itemIdFilter})
	 * 派发恰好本条。Unit 5 互锁在内部兜底。返回派发后的 batch(读本条终态)。
	 */
	dispatchOne: (intent: FirstFlightIntent) => Promise<Batch | null>;
	/**
	 * 落定 revert(非对称:先降档 → 再清标记)。在 finally 里调用,成功失败都跑。
	 * 由 background 注入 forceReset(或等价的 lower-mode-then-clear)。
	 */
	revert: (cause: string) => Promise<void>;
}

/**
 * 跑一次首飞。纯编排:排演→武装→最小窗口派发→finally revert。
 *
 * - 排演不过(dry-run 不绿 或 grounding 拦)→ **绝不武装**,直接返回 rehearse 失败(无需 revert,
 *   但 finally 仍调一次 revert 兜底——此时无标记,revert 应幂等)。
 * - 武装失败 → 绝不派发,返回 arm 失败。
 * - 派发后:无论成功失败,finally 非对称 revert;返回 dispatched 终态 + 验证提示。
 */
export async function runFirstFlight(
	deps: FirstFlightOrchestratorDeps,
): Promise<FirstFlightOutcome> {
	const { intent, rehearse, arm, dispatchOne, revert } = deps;
	let armed = false;
	let reverted = false;
	let outcome: FirstFlightOutcome | undefined;
	try {
		// ① 排演:同一快照绿 dry-run + grounding 通过,才有资格武装。
		const rehearsal = await rehearse(intent);
		if (!rehearsal.dryRunGreen || !rehearsal.grounding.ok) {
			const reason = !rehearsal.dryRunGreen
				? "first-flight-rehearsal-dryrun-not-green"
				: rehearsal.grounding.reasons.join(" ") ||
					"first-flight-rehearsal-grounding-blocked";
			outcome = {
				ok: false,
				phase: "rehearse",
				reason,
				rehearsal,
				reverted: false,
			};
			return outcome;
		}

		// ② 武装:write pending + 读回确认 + 翻 authorized(全在 arm 内串行)。
		const armResult = await arm(intent);
		if (!armResult.ok) {
			outcome = {
				ok: false,
				phase: "arm",
				reason: armResult.reason ?? "first-flight-arm-rejected",
				reverted: false,
			};
			return outcome;
		}
		armed = true;

		// ③ 最小窗口派发:authorized 已置,经 approveBatch({itemIdFilter}) 派发恰好一条。
		const batch = await dispatchOne(intent);
		const item = batch?.items.find((it) => it.id === intent.itemId);
		const itemStatus = item?.status ?? "unknown";
		const publishUrl = item?.publishUrl;

		// ④/⑤ 落定 + 验证提示(派发证明时序正确,不证明发布成功 → 必须人工核实)。
		outcome = {
			ok: true,
			phase: "dispatched",
			itemStatus,
			...(publishUrl ? { publishUrl } : {}),
			verifyPrompt: true,
			reverted: false,
		};
		return outcome;
	} finally {
		// 非对称 revert(先降档 → 再清标记):武装过则必收尾;未武装也兜底调一次(应幂等)。
		await revert(
			armed ? "first-flight-settle" : "first-flight-no-arm-settle",
		).then(
			() => {
				reverted = true;
			},
			() => {
				/* revert best-effort;绝不因收尾失败把成功窗口拖成异常 */
			},
		);
		// 在 finally 里把真实 revert 结果回填到将返回的 outcome(reverted 反映落定状态)。
		// outcome 在三个 return 分支前均已赋值;非 null 断言安全(无 outcome 即异常路径,无返回对象可改)。
		if (outcome) outcome.reverted = reverted;
	}
}
