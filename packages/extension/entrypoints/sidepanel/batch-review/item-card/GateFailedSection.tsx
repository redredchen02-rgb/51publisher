import type { FactsBlock } from "@51publisher/shared";
import type { BatchItem } from "../../../../lib/batch";
import { btn } from "../constants";
import { emptyFactSlots, FactsOverlay } from "../FactsOverlay";

interface GateFailedSectionProps {
	it: BatchItem;
	busy?: boolean;
	onRefillFacts?: (itemId: string, facts: Partial<FactsBlock>) => void;
	onRetryItem?: (itemId: string) => void;
}

export function GateFailedSection({
	it,
	busy,
	onRefillFacts,
	onRetryItem,
}: GateFailedSectionProps) {
	const fillable = !!it.slots && onRefillFacts && emptyFactSlots(it).length > 0;

	return (
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
			{fillable && onRefillFacts ? (
				<FactsOverlay item={it} busy={busy} onRefillFacts={onRefillFacts} />
			) : (
				onRetryItem && (
					<div style={{ marginTop: 6 }}>
						<span
							className="text-warning-deep"
							style={{ fontSize: 11, marginRight: 6 }}
						>
							{it.slots
								? "无可补全的缺失事实(占位在散文内),需重新生成。"
								: "该条目无可重组装的槽位(旧条目),需重新生成。"}
						</span>
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
							需重新生成
						</button>
					</div>
				)
			)}
		</div>
	);
}
