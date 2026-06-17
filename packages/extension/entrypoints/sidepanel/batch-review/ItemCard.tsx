import type {
	ContentDraft,
	FactsBlock,
	RejectionReason,
} from "@51publisher/shared";
import { useMemo, useState } from "react";
import type { BatchItem } from "../../../lib/batch";
import { computeSlotDiff } from "../../../lib/draft-diff";
import { btn } from "./constants";
import { FactsEdit } from "./FactsEdit";
import { DraftSection } from "./item-card/DraftSection";
import { GateFailedSection } from "./item-card/GateFailedSection";
import { ItemCardHeader } from "./item-card/ItemCardHeader";
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
	onRefillFacts?: (itemId: string, facts: Partial<FactsBlock>) => void;
	recommendedTags?: string[];
	onEditFactsAndRegen?: (itemId: string, newFacts: FactsBlock) => void;
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
	onRefillFacts,
	recommendedTags,
	onEditFactsAndRegen,
	discardPickerId,
	setDiscardPickerId,
	discardReason,
	setDiscardReason,
}: ItemCardProps) {
	const [factsEditOpen, setFactsEditOpen] = useState(false);
	const slotDiff = useMemo(
		() =>
			it.draft
				? computeSlotDiff(it.assembledDraftSnapshot, it.draft)
				: undefined,
		[it.assembledDraftSnapshot, it.draft],
	);

	return (
		<li
			style={{
				border: "1px solid var(--color-border-lighter)",
				borderRadius: 4,
				marginBottom: 4,
			}}
		>
			<ItemCardHeader
				it={it}
				expanded={expanded}
				onToggle={onToggle}
				busy={busy}
				readItems={readItems}
				slotDiff={slotDiff}
				onDiscardItem={onDiscardItem}
				discardPickerId={discardPickerId}
				setDiscardPickerId={setDiscardPickerId}
				discardReason={discardReason}
				setDiscardReason={setDiscardReason}
			/>

			{expanded && (
				<div
					style={{
						padding: "6px 10px",
						fontSize: 12,
						borderTop: "1px solid var(--color-bg-muted)",
					}}
				>
					{it.status === "gate-failed" && (
						<GateFailedSection
							it={it}
							busy={busy}
							onRefillFacts={onRefillFacts}
							onRetryItem={onRetryItem}
						/>
					)}

					{onEditFactsAndRegen &&
						(it.status === "gate-failed" ||
							it.status === "awaiting-approval") && (
							<div style={{ marginBottom: 4 }}>
								{factsEditOpen ? (
									<FactsEdit
										itemId={it.id}
										initialFacts={it.facts ?? {}}
										onSubmit={(id, newFacts) => {
											setFactsEditOpen(false);
											onEditFactsAndRegen(id, newFacts);
										}}
										onCancel={() => setFactsEditOpen(false)}
									/>
								) : (
									<button
										type="button"
										style={{
											...btn,
											fontSize: 11,
											padding: "2px 8px",
											background: "var(--color-bg-subtle)",
											border: "1px solid var(--color-border)",
											color: "var(--color-text-secondary)",
										}}
										onClick={() => setFactsEditOpen(true)}
										disabled={busy}
									>
										✏ 修改事实并重新生成
									</button>
								)}
							</div>
						)}

					<DraftSection
						it={it}
						busy={busy}
						draftOverrides={draftOverrides}
						onDraftChange={onDraftChange}
						onItemEdited={onItemEdited}
						onSaveAsFewShot={onSaveAsFewShot}
					/>

					{it.draft && (
						<GroundingStrip
							draft={draftOverrides?.get(it.id) ?? it.draft}
							facts={it.facts}
							recommendedTags={recommendedTags}
						/>
					)}
					<FillStatusTable results={it.fillResults} />

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
