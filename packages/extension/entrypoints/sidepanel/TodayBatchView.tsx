import { useTodayBatchDomain } from "./hooks/useTodayBatchDomain";
import {
	BatchResultSections,
	ReviewableItemsList,
	STATUS_LABEL,
} from "./today-batch/ReviewableItemsList";

const STATUS_COLOR: Record<string, string> = {
	queued: "var(--color-text-disabled)",
	generating: "var(--color-info)",
	filled: "var(--color-success)",
	"gate-failed": "var(--color-error)",
	"awaiting-approval": "var(--color-warning)",
	"publish-dispatched": "var(--color-info)",
	"publish-confirmed": "var(--color-success)",
	"needs-human-verification": "var(--color-error)",
	aborted: "var(--color-text-disabled)",
	error: "var(--color-error)",
};

export function TodayBatchView({ onBack }: { onBack: () => void }) {
	const {
		dailyBatchSize,
		adminTabId,
		tabError,
		busy,
		error,
		stage,
		items,
		readItems,
		publishingItems,
		setStage,
		setItems,
		setError,
		handleDailyBatch,
		handlePublish,
		handleApproveAll,
		handleRetry,
		handleToggleRead,
	} = useTodayBatchDomain();

	const reviewableItems = items.filter(
		(it) => it.status === "filled" || it.status === "awaiting-approval",
	);
	const gateFailedItems = items.filter((it) => it.status === "gate-failed");
	const confirmedItems = items.filter(
		(it) => it.status === "publish-confirmed",
	);
	const terminalOtherItems = items.filter(
		(it) => it.status === "error" || it.status === "aborted",
	);
	const needsVerificationItems = items.filter(
		(it) => it.status === "needs-human-verification",
	);

	const generatingCount = items.filter(
		(it) => it.status === "generating" || it.status === "queued",
	).length;
	const totalCount = items.length;
	const producedCount = items.filter(
		(it) =>
			it.status === "filled" ||
			it.status === "awaiting-approval" ||
			it.status === "publish-dispatched" ||
			it.status === "publish-confirmed",
	).length;
	const blockedCount =
		gateFailedItems.length +
		terminalOtherItems.length +
		needsVerificationItems.length;
	const completedCount = confirmedItems.length;
	const progressValue =
		totalCount === 0 ? 0 : Math.round((producedCount / totalCount) * 100);
	const readReviewCount = reviewableItems.filter((it) =>
		readItems.has(it.id),
	).length;
	const isAllTerminal =
		totalCount > 0 &&
		items.every((it) =>
			[
				"publish-confirmed",
				"gate-failed",
				"error",
				"aborted",
				"needs-human-verification",
			].includes(it.status),
		);
	const currentStep =
		totalCount === 0
			? "选题"
			: generatingCount > 0
				? "生成"
				: reviewableItems.length > 0
					? "审读"
					: "发布";

	return (
		<main
			className="fade-in"
			style={{
				fontFamily: "system-ui, sans-serif",
				padding: "var(--space-lg)",
				fontSize: "var(--font-md)",
			}}
		>
			<nav className="flex-between mb-md">
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>今日备稿</h1>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 返回
				</button>
			</nav>

			{tabError && (
				<p role="alert" className="text-error">
					{tabError}
				</p>
			)}
			{error && (
				<p role="alert" className="text-error">
					{error}
				</p>
			)}

			<section className="pipeline-strip" aria-label="今日流水线进度">
				<div
					className={`pipeline-step ${currentStep === "选题" ? "active" : totalCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">选题</span>
					<span className="pipeline-step-value">{dailyBatchSize}</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "生成" ? "active" : producedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">生成</span>
					<span className="pipeline-step-value">
						{producedCount}/{totalCount || dailyBatchSize}
					</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "审读" ? "active" : completedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">审读</span>
					<span className="pipeline-step-value">
						{readReviewCount}/{reviewableItems.length}
					</span>
				</div>
				<div
					className={`pipeline-step ${currentStep === "发布" ? "active" : completedCount > 0 ? "done" : ""}`}
				>
					<span className="pipeline-step-label">发布</span>
					<span className="pipeline-step-value">{completedCount}</span>
				</div>
			</section>

			{stage !== "review" && (
				<>
					<p
						className="text-secondary"
						style={{ margin: "0 0 var(--space-xl)" }}
					>
						自动从高分待审选题中取前 <strong>{dailyBatchSize}</strong>{" "}
						条，一键触发批量生成。
					</p>
					<button
						type="button"
						onClick={() => void handleDailyBatch()}
						disabled={busy || adminTabId == null}
						className="btn btn-primary"
						style={{
							width: "100%",
							marginBottom: "var(--space-xl)",
							fontSize: "var(--font-md)",
							padding: "var(--space-md) var(--space-lg)",
						}}
					>
						{busy
							? `生成中 ${items.length - generatingCount}/${items.length}…`
							: "一键备稿"}
					</button>
					{busy && items.length > 0 && (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{items.map((item) => (
								<li
									key={item.id}
									style={{
										display: "flex",
										justifyContent: "space-between",
										padding: "5px 0",
										borderBottom: "1px solid var(--color-border-lighter)",
										fontSize: "var(--font-sm)",
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
										{item.topic}
									</span>
									<span
										style={{
											marginLeft: "var(--space-md)",
											color:
												STATUS_COLOR[item.status] ??
												"var(--color-text-disabled)",
											flexShrink: 0,
										}}
									>
										{STATUS_LABEL[item.status] ?? item.status}
									</span>
								</li>
							))}
						</ul>
					)}
				</>
			)}

			{stage === "review" && (
				<>
					<section className="stats-grid" aria-label="批次摘要">
						<div className="stat-tile">
							<span className="stat-value">{progressValue}%</span>
							<span className="stat-label">生成进度</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{reviewableItems.length}</span>
							<span className="stat-label">待审发布</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{blockedCount}</span>
							<span className="stat-label">需处理</span>
						</div>
						<div className="stat-tile">
							<span className="stat-value">{completedCount}</span>
							<span className="stat-label">已发布</span>
						</div>
					</section>

					<div
						className="flex-between"
						style={{ marginBottom: "var(--space-lg)" }}
					>
						<span className="text-secondary">
							当前批次 · {currentStep}中 · 共 {items.length} 条
						</span>
						<button
							type="button"
							onClick={() => {
								setStage("idle");
								setItems([]);
								setError("");
							}}
							className="btn btn-plain btn-sm"
						>
							新批次
						</button>
					</div>

					{isAllTerminal && (
						<p
							className="text-success"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							✓ 批次已完成
						</p>
					)}

					{reviewableItems.length > 0 && (
						<ReviewableItemsList
							items={reviewableItems}
							readItems={readItems}
							publishingItems={publishingItems}
							onToggleRead={handleToggleRead}
							onPublish={(item) => void handlePublish(item)}
							onApproveAll={() => void handleApproveAll(reviewableItems)}
						/>
					)}

					<BatchResultSections
						gateFailedItems={gateFailedItems}
						needsVerificationItems={needsVerificationItems}
						confirmedItems={confirmedItems}
						terminalOtherItems={terminalOtherItems}
						onRetry={(id) => void handleRetry(id)}
					/>

					{reviewableItems.length === 0 &&
						gateFailedItems.length === 0 &&
						needsVerificationItems.length === 0 &&
						terminalOtherItems.length === 0 &&
						confirmedItems.length === 0 && (
							<div className="banner-info">
								当前批次还没有可审读内容，生成进度会自动刷新。
							</div>
						)}
				</>
			)}
		</main>
	);
}
