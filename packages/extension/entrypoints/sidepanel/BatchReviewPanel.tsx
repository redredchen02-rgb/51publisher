import type {
	ContentDraft,
	FactsBlock,
	RejectionReason,
	SafetyMode,
} from "@51publisher/shared";
import { useState } from "react";
import { type Batch, batchPhase, batchSummary } from "../../lib/batch";
import { aggregateDegradeStats } from "../../lib/degrade-stats";
import type { DriftReport } from "../../lib/selectors";
import type { TrajectoryRecord } from "../../lib/trajectory";
import { ApprovalBar } from "./batch-review/ApprovalBar";
import { DriftView } from "./batch-review/DriftView";
import { ItemCard } from "./batch-review/ItemCard";
import { ModeStatusBar } from "./batch-review/ModeStatusBar";
import { QuarantineBlock } from "./batch-review/QuarantineBlock";
import { SummaryBar } from "./batch-review/SummaryBar";

// 批量审核面板:纯展示 + 受控;批次/档位/tab 健康由 props 传入,动作经回调上抛给 App。

interface Props {
	readItems?: Set<string>;
	onItemRead?: (id: string) => void;
	onDiscardItem?: (itemId: string, rejectionReason?: RejectionReason) => void;
	allRead?: boolean;
	batch: Batch;
	safetyMode: SafetyMode;
	authorizedHost: string;
	tabHealthy: boolean;
	busy?: boolean;
	driftResult?: DriftReport | null;
	trajectoryContext?: Map<string, TrajectoryRecord>;
	draftOverrides?: Map<string, ContentDraft>;
	onDraftChange?: (itemId: string, draft: ContentDraft) => void;
	onRefillFacts?: (itemId: string, facts: Partial<FactsBlock>) => void;
	onRetryItem?: (itemId: string) => void;
	onModeChange?: (mode: SafetyMode) => void;
	onApprove: () => void;
	onApproveBypass: () => void;
	onKill: () => void;
	onRelease: (itemId: string) => void;
	onReleaseAll?: () => void;
	onDriftCheck: () => void;
	onResume: () => void;
	onItemEdited?: (itemId: string) => void;
	onSaveAsFewShot?: (itemId: string) => void;
}

export function BatchReviewPanel(props: Props) {
	const {
		batch,
		safetyMode,
		authorizedHost,
		tabHealthy,
		busy,
		driftResult,
		trajectoryContext,
		draftOverrides,
		onDraftChange,
		onRefillFacts,
		onRetryItem,
		readItems,
		onItemRead,
		onDiscardItem,
		allRead,
		onModeChange,
	} = props;
	const summary = batchSummary(batch);
	const phase = batchPhase(batch);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [discardPickerId, setDiscardPickerId] = useState<string | null>(null);
	const [discardReason, setDiscardReason] = useState<RejectionReason>("other");

	const quarantined = batch.items.filter(
		(it) => it.status === "needs-human-verification",
	);
	const awaitingApprovalCount = batch.items.filter(
		(it) => it.status === "awaiting-approval",
	).length;
	const readGateOk = awaitingApprovalCount === 0 || (allRead ?? false);
	const canApprove =
		phase === "awaiting-approval" &&
		awaitingApprovalCount > 0 &&
		tabHealthy &&
		(safetyMode === "authorized" || safetyMode === "dry-run") &&
		!busy &&
		readGateOk;
	const ds = aggregateDegradeStats(batch.items);

	function toggle(id: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			const willExpand = !next.has(id);
			if (willExpand) {
				next.add(id);
				const item = batch.items.find((it) => it.id === id);
				if (item?.status === "awaiting-approval") onItemRead?.(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}

	return (
		<div>
			<ModeStatusBar
				safetyMode={safetyMode}
				authorizedHost={authorizedHost}
				tabHealthy={tabHealthy}
				onModeChange={onModeChange}
				onResume={props.onResume}
			/>

			<SummaryBar
				phase={phase}
				summary={summary}
				aiOptimizedCount={batch.items.filter((i) => i.aiReviewTriggered === true).length}
				ds={ds}
			/>

			<QuarantineBlock
				quarantined={quarantined}
				trajectoryContext={trajectoryContext}
				onRelease={props.onRelease}
				onReleaseAll={props.onReleaseAll}
			/>

			<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
				{batch.items.map((it) => (
					<ItemCard
						key={it.id}
						item={it}
						expanded={expanded.has(it.id)}
						onToggle={toggle}
						busy={busy}
						readItems={readItems}
						draftOverrides={draftOverrides}
						onDraftChange={onDraftChange}
						onRefillFacts={onRefillFacts}
						onRetryItem={onRetryItem}
						onItemEdited={props.onItemEdited}
						onSaveAsFewShot={props.onSaveAsFewShot}
						onDiscardItem={onDiscardItem}
						discardPickerId={discardPickerId}
						setDiscardPickerId={setDiscardPickerId}
						discardReason={discardReason}
						setDiscardReason={setDiscardReason}
					/>
				))}
			</ul>

			{driftResult && (
				<DriftView
					driftResult={driftResult}
					busy={busy}
					onDriftCheck={props.onDriftCheck}
					onApproveBypass={props.onApproveBypass}
				/>
			)}

			<ApprovalBar
				phase={phase}
				summary={summary}
				safetyMode={safetyMode}
				authorizedHost={authorizedHost}
				tabHealthy={tabHealthy}
				busy={busy}
				canApprove={canApprove}
				onApprove={props.onApprove}
				onApproveBypass={props.onApproveBypass}
				onKill={props.onKill}
				onDriftCheck={props.onDriftCheck}
			/>
		</div>
	);
}
