import type { RejectionReason } from "@51publisher/shared";
import type { BatchItem } from "../../../../lib/batch";
import type { SlotDiff } from "../../../../lib/draft-diff";
import { btn, REJECTION_REASON_LABELS, STATUS_LABEL } from "../constants";

interface ItemCardHeaderProps {
	it: BatchItem;
	expanded: boolean;
	onToggle: (id: string) => void;
	busy?: boolean;
	readItems?: Set<string>;
	slotDiff: SlotDiff | undefined;
	onDiscardItem?: (itemId: string, reason?: RejectionReason) => void;
	discardPickerId: string | null;
	setDiscardPickerId: (id: string | null) => void;
	discardReason: RejectionReason;
	setDiscardReason: (reason: RejectionReason) => void;
}

export function ItemCardHeader({
	it,
	expanded,
	onToggle,
	busy,
	readItems,
	slotDiff,
	onDiscardItem,
	discardPickerId,
	setDiscardPickerId,
	discardReason,
	setDiscardReason,
}: ItemCardHeaderProps) {
	const degraded =
		it.fillResults?.filter((r) => r.status === "degraded").length ?? 0;

	return (
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
				{it.status === "awaiting-approval" && readItems?.has(it.id) && (
					<span
						role="img"
						aria-label="已读"
						className="text-success"
						style={{ marginLeft: 4, fontSize: 11, flexShrink: 0 }}
					>
						✓
					</span>
				)}
				{it.fillResults && it.fillResults.length > 0 && degraded > 0 && (
					<span
						className="text-warning"
						style={{ marginLeft: 4, fontSize: 11, flexShrink: 0 }}
					>
						{degraded}/{it.fillResults.length} 降级
					</span>
				)}
				{it.aiReviewTriggered === true && (
					<span
						className="text-muted"
						style={{ marginLeft: 4, fontSize: 10, flexShrink: 0 }}
					>
						✦ 已自评优化
					</span>
				)}
				<span
					role="status"
					aria-label={`状态 ${it.status}`}
					className="text-secondary"
					style={{ marginLeft: 8, fontSize: 12, flexShrink: 0 }}
				>
					[{STATUS_LABEL[it.status]}]
				</span>
				{slotDiff !== undefined && !slotDiff.unknown && (
					<span
						className={
							slotDiff.changedSlots.length > 0 ? "text-warning" : "text-muted"
						}
						style={{ marginLeft: 4, fontSize: 10, flexShrink: 0 }}
						title="含 AI 自動重寫"
					>
						{slotDiff.changedSlots.length > 0
							? `已修改 ${slotDiff.changedSlots.length} 個欄位`
							: "未修改"}
					</span>
				)}
			</button>

			{it.status === "awaiting-approval" &&
				onDiscardItem &&
				(discardPickerId === it.id ? (
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
							{(Object.keys(REJECTION_REASON_LABELS) as RejectionReason[]).map(
								(r) => (
									<option key={r} value={r}>
										{REJECTION_REASON_LABELS[r]}
									</option>
								),
							)}
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
	);
}
