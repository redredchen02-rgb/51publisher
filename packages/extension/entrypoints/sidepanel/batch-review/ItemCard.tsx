import type {
	ContentDraft,
	FactsBlock,
	FieldFillResult,
	RejectionReason,
} from "@51publisher/shared";
import { FACT_ORDER, factUrls } from "@51publisher/shared";
import { useState } from "react";
import type { BatchItem } from "../../../lib/batch";
import { evaluateGrounding } from "../../../lib/grounding-gate";
import { verifyLinks } from "../../../lib/link-source";
import { DraftPreview } from "../DraftPreview";
import { GateFailedDetail } from "./GateFailedDetail";

// 单条批次条目的卡片(从 BatchReviewPanel 抽出)。纯展示 + 受控:展开/否决选择器等
// 跨条目共享的状态由 BatchReviewPanel 持有,经 props 下传;动作经回调上抛。
// 行为契约由 BatchReviewPanel.test.tsx 守护(gate-failed / 编辑框 / few-shot / badge /
// 否决流程 / error 区分 等分支)。

const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

const STATUS_LABEL: Record<BatchItem["status"], string> = {
	queued: "排队",
	generating: "生成中",
	filled: "待审",
	"gate-failed": "接地拦截",
	"awaiting-approval": "待审",
	"publish-dispatched": "发布中",
	"publish-confirmed": "已发布",
	"needs-human-verification": "待人工核",
	aborted: "已停",
	error: "失败",
};

const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
	duplicate: "重复选题",
	quality: "质量不达标",
	topic_mismatch: "选题不符",
	missing_facts: "事实缺失",
	other: "其他",
};

/**
 * 源接地审核摘要(U6,程序化结构化生成):
 * - 事实注入:每个字段 ✓已注入(verbatim)/ —未提供,让人一眼看到缺口(缺口不再污染正文)。
 * - 连结:正文每条 URL 标「程式注入」(✓)或「非来源·疑似编造」(✗,组装后应不出现)。
 * - 硬闸:展示该条若 authorized 发布会否被拦(残留【待补】/无来源连结)。
 */
function GroundingStrip({
	draft,
	facts,
	onFixPlaceholder,
}: {
	draft: ContentDraft;
	facts?: FactsBlock;
	onFixPlaceholder?: () => void;
}) {
	const f = facts ?? {};
	let links: { url: string; sourced: boolean }[] = [];
	try {
		links = verifyLinks(draft.body, factUrls(f));
	} catch {
		links = [];
	}
	const verdict = evaluateGrounding(draft, facts);

	return (
		<div style={{ marginTop: 4, fontSize: 11 }}>
			{/* 事实注入状态 */}
			<div style={{ color: "#555" }}>
				事实注入:
				{FACT_ORDER.map((k) => {
					const has = !!f[k]?.trim();
					return (
						<span
							key={k}
							style={{ marginRight: 6, color: has ? "#389e0d" : "#bbb" }}
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
						<div style={{ marginTop: 2, color: "#d46b08", fontWeight: 600 }}>
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
							style={{ color: l.sourced ? "#389e0d" : "#cf1322" }}
						>
							{l.sourced ? "✓ 程式注入(不可编造)" : "✗ 非来源(疑似编造)"}{" "}
							<code style={{ wordBreak: "break-all" }}>{l.url}</code>
						</li>
					))}
				</ul>
			)}

			{/* 发布前硬闸判定 */}
			<div
				style={{
					marginTop: 2,
					color: verdict.ok ? "#389e0d" : "#cf1322",
					fontWeight: 600,
					display: "flex",
					alignItems: "center",
					gap: 6,
				}}
			>
				{verdict.ok
					? "✓ grounding 通过(authorized 可发)"
					: "⛔ authorized 会被拦:"}
				{!verdict.ok &&
					(draft.title.includes("【待补】") ||
						draft.body.includes("【待补】")) &&
					onFixPlaceholder && (
						<button
							type="button"
							onClick={onFixPlaceholder}
							style={{
								background: "#fa8c16",
								color: "#fff",
								border: "none",
								borderRadius: 3,
								padding: "2px 6px",
								fontSize: 11,
								cursor: "pointer",
							}}
						>
							✏️ 一键填入【待补】
						</button>
					)}
			</div>
			{!verdict.ok && (
				<ul
					style={{ margin: "2px 0 0", padding: "0 0 0 12px", color: "#cf1322" }}
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
function FillStatusTable({
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
			<div style={{ marginTop: 4, fontSize: 11, color: "#389e0d" }}>
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
					background: "#fafafa",
					border: "1px solid #d9d9d9",
					borderRadius: 3,
					padding: "2px 6px",
					fontSize: 11,
					cursor: "pointer",
					color: "#555",
				}}
				aria-expanded={open}
				aria-label="字段填充状态"
			>
				<span style={{ color: "#389e0d" }}>✓{filled.length}</span>{" "}
				<span style={{ color: "#d46b08" }}>↷{skipped.length}</span>{" "}
				<span style={{ color: "#cf1322" }}>⚠{degraded.length}</span>{" "}
				{open ? "▲" : "▼"}
			</button>
			{open && (
				<ul style={{ margin: "4px 0 0", padding: "0 0 0 12px", fontSize: 11 }}>
					{skipped.map((r) => (
						<li key={r.field} style={{ color: "#d46b08" }}>
							<strong>{r.field}</strong> 已跳过{r.note ? `：${r.note}` : ""}
						</li>
					))}
					{degraded.map((r) => (
						<li key={r.field} style={{ color: "#cf1322" }}>
							<strong>{r.field}</strong> 降级
							{r.note ? `：${r.note}` : "（innerHTML 兜底,格式可能丢失）"}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export interface ItemCardProps {
	item: BatchItem;
	expanded: boolean;
	onToggle: () => void;
	readItems?: Set<string>;
	busy?: boolean;
	draftOverrides?: Map<string, ContentDraft>;
	onDraftChange?: (itemId: string, draft: ContentDraft) => void;
	onFixPlaceholder?: (itemId: string, currentDraft: ContentDraft) => void;
	onItemEdited?: (itemId: string) => void;
	onSaveAsFewShot?: (itemId: string) => void;
	onRetryItem?: (itemId: string) => void;
	onDiscardItem?: (itemId: string, rejectionReason?: RejectionReason) => void;
	// 否决选择器(跨条目共享状态,由 BatchReviewPanel 持有)
	discardPickerOpen: boolean;
	discardReason: RejectionReason;
	onOpenDiscard: () => void;
	onCloseDiscard: () => void;
	onChangeDiscardReason: (reason: RejectionReason) => void;
	onConfirmDiscard: () => void;
}

export function ItemCard({
	item: it,
	expanded,
	onToggle,
	readItems,
	busy,
	draftOverrides,
	onDraftChange,
	onFixPlaceholder,
	onItemEdited,
	onSaveAsFewShot,
	onRetryItem,
	onDiscardItem,
	discardPickerOpen,
	discardReason,
	onOpenDiscard,
	onCloseDiscard,
	onChangeDiscardReason,
	onConfirmDiscard,
}: ItemCardProps) {
	return (
		<li
			style={{
				border: "1px solid #f0f0f0",
				borderRadius: 4,
				marginBottom: 4,
			}}
		>
			<div style={{ display: "flex", alignItems: "center" }}>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={expanded}
					style={{
						...btn,
						flex: 1,
						textAlign: "left",
						background: "#fff",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						minWidth: 0,
					}}
				>
					<span
						style={{
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							flex: 1,
						}}
					>
						{it.topic}
					</span>
					{/* U4:已读绿色徽章 */}
					{it.status === "awaiting-approval" && readItems?.has(it.id) && (
						<span
							role="img"
							aria-label="已读"
							style={{
								marginLeft: 4,
								fontSize: 11,
								color: "#389e0d",
								flexShrink: 0,
							}}
						>
							✓
						</span>
					)}
					{it.fillResults &&
						it.fillResults.length > 0 &&
						(() => {
							const degraded = it.fillResults.filter(
								(r) => r.status === "degraded",
							).length;
							return degraded > 0 ? (
								<span
									style={{
										marginLeft: 4,
										fontSize: 11,
										color: "#fa8c16",
										flexShrink: 0,
									}}
								>
									{degraded}/{it.fillResults.length} 降级
								</span>
							) : null;
						})()}
					{it.aiReviewTriggered === true && (
						<span
							style={{
								marginLeft: 4,
								fontSize: 10,
								color: "#8c8c8c",
								flexShrink: 0,
							}}
						>
							✦ 已自评优化
						</span>
					)}
					<span
						role="status"
						aria-label={`状态 ${it.status}`}
						style={{
							marginLeft: 8,
							fontSize: 12,
							color: "#555",
							flexShrink: 0,
						}}
					>
						[{STATUS_LABEL[it.status]}]
					</span>
				</button>
				{/* U9:否决按钮 + 拒绝原因选择器(仅 awaiting-approval 显示) */}
				{it.status === "awaiting-approval" &&
					onDiscardItem &&
					(discardPickerOpen ? (
						// 展示原因选择器
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								marginLeft: 4,
								flexShrink: 0,
							}}
						>
							<select
								aria-label="拒绝原因"
								value={discardReason}
								onChange={(e) => {
									e.stopPropagation();
									onChangeDiscardReason(e.target.value as RejectionReason);
								}}
								onClick={(e) => e.stopPropagation()}
								style={{
									fontSize: 11,
									padding: "1px 2px",
									borderRadius: 3,
									border: "1px solid #d9d9d9",
								}}
							>
								{(
									Object.keys(REJECTION_REASON_LABELS) as RejectionReason[]
								).map((r) => (
									<option key={r} value={r}>
										{REJECTION_REASON_LABELS[r]}
									</option>
								))}
							</select>
							<button
								type="button"
								aria-label={`确认否决 ${it.topic}`}
								onClick={(e) => {
									e.stopPropagation();
									onConfirmDiscard();
								}}
								disabled={busy}
								style={{
									padding: "2px 6px",
									fontSize: 11,
									background: "#cf1322",
									color: "#fff",
									border: "none",
									borderRadius: 3,
									cursor: busy ? "not-allowed" : "pointer",
								}}
							>
								确认
							</button>
							<button
								type="button"
								onClick={onCloseDiscard}
								style={{
									padding: "2px 4px",
									fontSize: 11,
									background: "#f0f0f0",
									color: "#555",
									border: "none",
									borderRadius: 3,
									cursor: "pointer",
								}}
							>
								取消
							</button>
						</span>
					) : (
						<button
							type="button"
							aria-label={`否决 ${it.topic}`}
							onClick={(e) => {
								e.stopPropagation();
								onOpenDiscard();
							}}
							disabled={busy}
							style={{
								marginLeft: 4,
								padding: "2px 6px",
								fontSize: 11,
								background: "#fff1f0",
								color: "#cf1322",
								border: "1px solid #ffa39e",
								borderRadius: 3,
								cursor: busy ? "not-allowed" : "pointer",
								flexShrink: 0,
							}}
						>
							否决
						</button>
					))}
			</div>
			{expanded && (
				<div
					style={{
						padding: "6px 10px",
						fontSize: 12,
						borderTop: "1px solid #f5f5f5",
					}}
				>
					{/* U9:gate-failed — 接地闸门拦截,显示原因 + 重新生成按钮,不显示审批按钮 */}
					{it.status === "gate-failed" && (
						<GateFailedDetail item={it} busy={busy} onRetryItem={onRetryItem} />
					)}
					{it.status === "awaiting-approval" && it.draft && onDraftChange ? (
						// 待审状态:显示可编辑字段(title/tags/category/description;body 唯读)。
						<DraftPreview
							draft={draftOverrides?.get(it.id) ?? it.draft}
							onChange={(d) => onDraftChange(it.id, d)}
						/>
					) : it.draft ? (
						<>
							<div>
								<strong>{it.draft.title || "(无标题)"}</strong>
							</div>
							<div
								style={{
									color: "#666",
									maxHeight: 120,
									overflow: "auto",
								}}
							>
								{it.draft.description ||
									it.draft.body.replace(/<[^>]+>/g, " ").slice(0, 200)}
							</div>
							{it.status === "awaiting-approval" && onItemEdited && (
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: 4,
										marginTop: 6,
										cursor: "pointer",
									}}
								>
									<input
										type="checkbox"
										checked={it.userEdited ?? false}
										onChange={() => {
											if (!it.userEdited) onItemEdited(it.id);
										}}
									/>
									<span style={{ color: "#888" }}>已手动修改草稿</span>
								</label>
							)}
							{it.status === "publish-confirmed" && onSaveAsFewShot && (
								<button
									type="button"
									onClick={() => onSaveAsFewShot(it.id)}
									style={{
										...btn,
										marginTop: 6,
										padding: "3px 8px",
										fontSize: 11,
										background: "#f6ffed",
										color: "#389e0d",
										border: "1px solid #b7eb8f",
									}}
								>
									存为范例
								</button>
							)}
						</>
					) : (
						<span style={{ color: "#999" }}>
							无草稿内容{it.error ? `(${it.error})` : ""}
						</span>
					)}
					{it.draft && (
						<GroundingStrip
							draft={draftOverrides?.get(it.id) ?? it.draft}
							facts={it.facts}
							onFixPlaceholder={
								onDraftChange && onFixPlaceholder
									? () =>
											onFixPlaceholder(
												it.id,
												(draftOverrides?.get(it.id) ??
													it.draft) as ContentDraft,
											)
									: undefined
							}
						/>
					)}
					<FillStatusTable results={it.fillResults} />
					{/* U9:error 状态区分 — grounding-blocked 走橙色"内容审核失败";其余走红色"重试此条" */}
					{it.status === "error" &&
					it.error?.startsWith("grounding-blocked:") ? (
						<div style={{ marginTop: 6 }}>
							<span
								role="alert"
								aria-label="内容审核失败"
								style={{
									display: "inline-block",
									background: "#fff7e6",
									border: "1px solid #ffa940",
									color: "#d46b08",
									borderRadius: 4,
									padding: "2px 8px",
									fontSize: 11,
									fontWeight: 600,
								}}
							>
								⊘ 内容审核失败:
								{it.error.slice("grounding-blocked:".length)}
							</span>
							{onRetryItem && (
								<button
									type="button"
									onClick={() => onRetryItem(it.id)}
									disabled={busy}
									style={{
										...btn,
										marginLeft: 6,
										padding: "2px 8px",
										fontSize: 11,
										background: "#fff7e6",
										border: "1px solid #ffd591",
										color: "#874d00",
									}}
								>
									重新生成
								</button>
							)}
						</div>
					) : (
						(it.status === "error" || it.status === "aborted") &&
						onRetryItem && (
							<div style={{ marginTop: 6 }}>
								<button
									type="button"
									onClick={() => onRetryItem(it.id)}
									disabled={busy}
									style={{
										...btn,
										padding: "2px 8px",
										fontSize: 11,
										background: "#fff7e6",
										border: "1px solid #ffd591",
										color: "#874d00",
									}}
								>
									重试此条
								</button>
							</div>
						)
					)}
				</div>
			)}
		</li>
	);
}
