import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { FACT_ORDER, type FactsBlock, factUrls } from "@51publisher/shared";
import { useState } from "react";
import { evaluateGrounding } from "../../../lib/grounding-gate";
import { verifyLinks } from "../../../lib/link-source";
import type { TrajectoryRecord } from "../../../lib/trajectory";

/**
 * 源接地审核摘要(U6,程序化结构化生成):
 * - 事实注入:每个字段 ✓已注入(verbatim)/ —未提供,让人一眼看到缺口(缺口不再污染正文)。
 * - 连结:正文每条 URL 标「程式注入」(✓)或「非来源·疑似编造」(✗,组装后应不出现)。
 * - 硬闸:展示该条若 authorized 发布会否被拦(残留【待补】/无来源连结)。
 */
export function GroundingStrip({
	draft,
	facts,
	recommendedTags,
}: {
	draft: ContentDraft;
	facts?: FactsBlock;
	/** 允许集(来自 Settings.recommendedTags);不传则跳过标签校验(优雅降级)。 */
	recommendedTags?: string[];
}) {
	const f = facts ?? {};
	let links: { url: string; sourced: boolean }[] = [];
	try {
		links = verifyLinks(draft.body, factUrls(f));
	} catch {
		links = [];
	}
	const verdict = evaluateGrounding(draft, facts, undefined, recommendedTags);

	return (
		<div style={{ marginTop: 4, fontSize: 11 }}>
			{/* 事实注入状态 */}
			<div className="text-secondary">
				事实注入:
				{FACT_ORDER.map((k) => {
					const has = !!f[k]?.trim();
					return (
						<span
							key={k}
							style={{
								marginRight: 6,
								color: has
									? "var(--color-success)"
									: "var(--color-text-disabled)",
							}}
						>
							{has ? "✓" : "—"}
							{k}
						</span>
					);
				})}
			</div>
			{/* 明确列出缺失事实，避免审核者忽略 */}
			{(() => {
				const missing = FACT_ORDER.filter((k) => !f[k]?.trim());
				if (missing.length > 0) {
					return (
						<div
							className="font-semibold"
							style={{ marginTop: 2, color: "var(--color-warning)" }}
						>
							⚠️ 缺失事实 (不会渲染): {missing.join("、")}
						</div>
					);
				}
				return null;
			})()}

			{/* 连结来源(程式注入) */}
			{links.length > 0 && (
				<ul style={{ margin: "4px 0 0", padding: "0 0 0 12px" }}>
					{links.map((l) => (
						<li
							key={l.url}
							style={{
								color: l.sourced
									? "var(--color-success)"
									: "var(--color-error)",
							}}
						>
							{l.sourced ? "✓ 程式注入(不可编造)" : "✗ 非来源(疑似编造)"}{" "}
							<code style={{ wordBreak: "break-all" }}>{l.url}</code>
						</li>
					))}
				</ul>
			)}

			{/* 发布前硬闸判定 */}
			<div
				className="flex font-semibold"
				style={{
					marginTop: 2,
					color: verdict.ok ? "var(--color-success)" : "var(--color-error)",
					gap: 6,
				}}
			>
				{verdict.ok
					? "✓ grounding 通过(authorized 可发)"
					: "⛔ authorized 会被拦:"}
			</div>
			{!verdict.ok && (
				<ul
					style={{
						margin: "2px 0 0",
						padding: "0 0 0 12px",
						color: "var(--color-error)",
					}}
				>
					{verdict.reasons.map((r) => (
						<li key={r}>{r}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * 字段填充三态状态表。
 * - 无数据(空数组 / undefined): 不渲染任何内容。
 * - 全部已填且无降级/跳过: 显示内联绿色打勾。
 * - 有跳过/降级: 显示可展开的三列计数 + 明细。
 */
export function FillStatusTable({
	results,
}: {
	results: FieldFillResult[] | undefined;
}) {
	const [open, setOpen] = useState(false);
	if (!results || results.length === 0) return null;

	const filled = results.filter((r) => r.status === "filled");
	const skipped = results.filter((r) => r.status === "skipped");
	const degraded = results.filter((r) => r.status === "degraded");
	const allFilled = skipped.length === 0 && degraded.length === 0;

	if (allFilled) {
		return (
			<div className="text-xs text-success" style={{ marginTop: 4 }}>
				✓ 全部字段已填
			</div>
		);
	}

	return (
		<div style={{ marginTop: 4 }}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				style={{
					background: "var(--color-bg-surface)",
					border: "1px solid var(--color-border)",
					borderRadius: 3,
					padding: "2px 6px",
					fontSize: 11,
					cursor: "pointer",
					color: "var(--color-text-secondary)",
				}}
				aria-expanded={open}
				aria-label="字段填充状态"
			>
				<span className="text-success">✓{filled.length}</span>{" "}
				<span className="text-warning">↷{skipped.length}</span>{" "}
				<span className="text-error">⚠{degraded.length}</span>{" "}
				{open ? "▲" : "▼"}
			</button>
			{open && (
				<ul style={{ margin: "4px 0 0", padding: "0 0 0 12px", fontSize: 11 }}>
					{skipped.map((r) => (
						<li key={r.field} className="text-warning">
							<strong>{r.field}</strong> 已跳过{r.note ? `：${r.note}` : ""}
						</li>
					))}
					{degraded.map((r) => (
						<li key={r.field} className="text-error">
							<strong>{r.field}</strong> 降级
							{r.note ? `：${r.note}` : "（innerHTML 兜底,格式可能丢失）"}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** 隔离释放时展示轨迹上下文:三态(有 URL / 无 URL / 无记录)。 */
export function QuarantineContext({
	record,
}: {
	record: TrajectoryRecord | undefined;
}) {
	const s: React.CSSProperties = { fontSize: 11, marginTop: 2 };
	if (!record) {
		return (
			<div style={{ ...s, color: "var(--color-text-muted)" }}>
				无发布记录 — 可安全重试
			</div>
		);
	}
	if (record.publishUrl) {
		return (
			<div style={{ ...s, color: "var(--color-warning-deep)" }}>
				可能已发布(未核实) — 请先点「查看帖子」确认后再撤出隔离
			</div>
		);
	}
	return (
		<div style={{ ...s, color: "var(--color-warning-deep)" }}>
			未收到发布确认 — 帖子可能未成功发布
		</div>
	);
}
