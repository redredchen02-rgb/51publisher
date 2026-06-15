import type { ContentDraft, RejectionReason } from "@51publisher/shared";
import type { BatchItem } from "../../../lib/batch";
import { DraftPreview } from "../DraftPreview";
import { btn, REJECTION_REASON_LABELS, STATUS_LABEL } from "./constants";
import { FillStatusTable, GroundingStrip } from "./sub-blocks";

interface ItemCardProps {
	item: BatchItem;
	expanded: boolean;
	onToggle: (id: string) => void;
	busy?: boolean;
	readItems?: Set<string>;
	draftOverrides?: Map<string, ContentDraft>;
	onDraftChange?: (itemId: string, draft: ContentDraft) => void;
	onRetryItem?: (itemId: string) => void;
	onItemEdited?: (itemId: string) => void;
	onSaveAsFewShot?: (itemId: string) => void;
	onDiscardItem?: (itemId: string, rejectionReason?: RejectionReason) => void;
	onFixPlaceholder: (itemId: string, currentDraft: ContentDraft) => void;
	/** U9:否决流程 — 当前正在选择拒绝原因的条目 id。 */
	discardPickerId: string | null;
	setDiscardPickerId: (id: string | null) => void;
	discardReason: RejectionReason;
	setDiscardReason: (reason: RejectionReason) => void;
}

export function ItemCard({
	item: it,
	expanded,
	onToggle,
	busy,
	readItems,
	draftOverrides,
	onDraftChange,
	onRetryItem,
	onItemEdited,
	onSaveAsFewShot,
	onDiscardItem,
	onFixPlaceholder,
	discardPickerId,
	setDiscardPickerId,
	discardReason,
	setDiscardReason,
}: ItemCardProps) {
	return (
		<li
			style={{
				border: "1px solid var(--color-border-lighter)",
				borderRadius: 4,
				marginBottom: 4,
			}}
		>
			<div className="flex" style={{ alignItems: "center" }}>
				<button
					type="button"
					onClick={() => onToggle(it.id)}
					aria-expanded={expanded}
					className="flex"
					style={{
						...btn,
						flex: 1,
						textAlign: "left",
						background: "#fff",
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
							className="text-success"
							style={{
								marginLeft: 4,
								fontSize: 11,
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
									className="text-warning"
									style={{
										marginLeft: 4,
										fontSize: 11,
										flexShrink: 0,
									}}
								>
									{degraded}/{it.fillResults.length} 降级
								</span>
							) : null;
						})()}
					{it.aiReviewTriggered === true && (
						<span
							className="text-muted"
							style={{
								marginLeft: 4,
								fontSize: 10,
								flexShrink: 0,
							}}
						>
							✦ 已自评优化
						</span>
					)}
					<span
						role="status"
						aria-label={`状态 ${it.status}`}
						className="text-secondary"
						style={{
							marginLeft: 8,
							fontSize: 12,
							flexShrink: 0,
						}}
					>
						[{STATUS_LABEL[it.status]}]
					</span>
				</button>
				{/* U9:否决按钮 + 拒绝原因选择器(仅 awaiting-approval 显示) */}
				{it.status === "awaiting-approval" &&
					onDiscardItem &&
					(discardPickerId === it.id ? (
						// 展示原因选择器
						<span
							className="flex"
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
									setDiscardReason(e.target.value as RejectionReason);
								}}
								onClick={(e) => e.stopPropagation()}
								style={{
									fontSize: 11,
									padding: "1px 2px",
									borderRadius: 3,
									border: "1px solid var(--color-border)",
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
									setDiscardPickerId(null);
									onDiscardItem(it.id, discardReason);
								}}
								disabled={busy}
								style={{
									padding: "2px 6px",
									fontSize: 11,
									background: "var(--color-error)",
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
								onClick={() => setDiscardPickerId(null)}
								style={{
									padding: "2px 4px",
									fontSize: 11,
									background: "var(--color-border-lighter)",
									color: "var(--color-text-secondary)",
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
								setDiscardReason("other");
								setDiscardPickerId(it.id);
							}}
							disabled={busy}
							style={{
								marginLeft: 4,
								padding: "2px 6px",
								fontSize: 11,
								background: "var(--color-error-light)",
								color: "var(--color-error)",
								border: "1px solid var(--color-error-border)",
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
						borderTop: "1px solid var(--color-bg-muted)",
					}}
				>
					{/* U9:gate-failed — 接地闸门拦截,显示原因 + 重新生成按钮,不显示审批按钮 */}
					{it.status === "gate-failed" && (
						<div style={{ marginBottom: 6 }}>
							<span
								role="status"
								aria-label="接地拦截原因"
								style={{
									display: "inline-block",
									background: "var(--color-warning-light)",
									border: "1px solid var(--color-warning-border)",
									color: "var(--color-warning-deep)",
									borderRadius: 4,
									padding: "2px 8px",
									fontSize: 11,
									fontWeight: 600,
								}}
							>
								⚠ 接地拦截:{it.gateFailReason ?? "未知原因"}
							</span>
							{/* 展示原稿快照(含【待补】)让操作者知道缺哪些事实 */}
							{it.assembledDraftSnapshot && (
								<div
									style={{
										marginTop: 6,
										padding: "4px 8px",
										background: "var(--color-warning-light)",
										border: "1px solid var(--color-warning-border)",
										borderRadius: 4,
										fontSize: 11,
										color: "var(--color-warning-deep)",
									}}
								>
									<div className="font-semibold" style={{ marginBottom: 2 }}>
										原稿(含缺失事实):
									</div>
									<div style={{ wordBreak: "break-all" }}>
										{it.assembledDraftSnapshot.title || "(无标题)"}
									</div>
								</div>
							)}
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
										background: "var(--color-warning-light)",
										border: "1px solid var(--color-warning-border)",
										color: "var(--color-warning-deep)",
									}}
								>
									重新生成
								</button>
							)}
						</div>
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
									color: "var(--color-text-close)",
									maxHeight: 120,
									overflow: "auto",
								}}
							>
								{it.draft.description ||
									it.draft.body.replace(/<[^>]+>/g, " ").slice(0, 200)}
							</div>
							{it.status === "awaiting-approval" && onItemEdited && (
								<label
									className="flex"
									style={{
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
											if (!it.userEdited) onItemEdited?.(it.id);
										}}
									/>
									<span className="text-muted">已手动修改草稿</span>
								</label>
							)}
							{it.status === "publish-confirmed" && onSaveAsFewShot && (
								<button
									type="button"
									onClick={() => onSaveAsFewShot?.(it.id)}
									style={{
										...btn,
										marginTop: 6,
										padding: "3px 8px",
										fontSize: 11,
										background: "var(--color-success-light)",
										color: "var(--color-success)",
										border: "1px solid var(--color-success-border)",
									}}
								>
									存为范例
								</button>
							)}
						</>
					) : (
						<span className="text-muted">
							无草稿内容{it.error ? `(${it.error})` : ""}
						</span>
					)}
					{it.draft && (
						<GroundingStrip
							draft={draftOverrides?.get(it.id) ?? it.draft}
							facts={it.facts}
							onFixPlaceholder={
								onDraftChange
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
									background: "var(--color-warning-light)",
									border: "1px solid var(--color-warning)",
									color: "var(--color-warning)",
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
										background: "var(--color-warning-light)",
										border: "1px solid var(--color-warning-border)",
										color: "var(--color-warning-deep)",
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
										background: "var(--color-warning-light)",
										border: "1px solid var(--color-warning-border)",
										color: "var(--color-warning-deep)",
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
