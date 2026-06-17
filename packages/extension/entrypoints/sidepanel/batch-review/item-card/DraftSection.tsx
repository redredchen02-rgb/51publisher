import type { ContentDraft } from "@51publisher/shared";
import type { BatchItem } from "../../../../lib/batch";
import { DraftPreview } from "../../DraftPreview";
import { btn } from "../constants";

interface DraftSectionProps {
	it: BatchItem;
	busy?: boolean;
	draftOverrides?: Map<string, ContentDraft>;
	onDraftChange?: (itemId: string, draft: ContentDraft) => void;
	onItemEdited?: (itemId: string) => void;
	onSaveAsFewShot?: (itemId: string) => void;
}

export function DraftSection({
	it,
	busy,
	draftOverrides,
	onDraftChange,
	onItemEdited,
	onSaveAsFewShot,
}: DraftSectionProps) {
	if (!it.draft) {
		return (
			<span className="text-muted">
				无草稿内容{it.error ? `(${it.error})` : ""}
			</span>
		);
	}

	if (it.status === "awaiting-approval" && onDraftChange) {
		return (
			<DraftPreview
				draft={draftOverrides?.get(it.id) ?? it.draft}
				onChange={(d) => onDraftChange(it.id, d)}
			/>
		);
	}

	return (
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
					disabled={busy}
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
	);
}
