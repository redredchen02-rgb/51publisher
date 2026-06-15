import type {
	ContentDraft,
	RejectionReason,
	SafetyMode,
} from "@51publisher/shared";
import { useState } from "react";
import { type Batch, batchPhase, batchSummary } from "../../lib/batch";
import { aggregateDegradeStats } from "../../lib/degrade-stats";
import type { DriftReport } from "../../lib/selectors";
import type { TrajectoryRecord } from "../../lib/trajectory";
import { ItemCard } from "./batch-review/ItemCard";

/** 隔离释放时展示轨迹上下文:三态(有 URL / 无 URL / 无记录)。 */
function QuarantineContext({
	record,
}: {
	record: TrajectoryRecord | undefined;
}) {
	const s: React.CSSProperties = { fontSize: 11, marginTop: 2 };
	if (!record) {
		return <div style={{ ...s, color: "#888" }}>无发布记录 — 可安全重试</div>;
	}
	if (record.publishUrl) {
		return (
			<div style={{ ...s, color: "#874d00" }}>
				可能已发布(未核实) — 请先点「查看帖子」确认后再撤出隔离
			</div>
		);
	}
	return (
		<div style={{ ...s, color: "#874d00" }}>
			未收到发布确认 — 帖子可能未成功发布
		</div>
	);
}

// 批量审核面板:专为"在窄面板里高效审 N 条"设计(评审 design-lens)。
// 纯展示 + 受控:批次/档位/tab 健康由 props 传入,动作经回调上抛给 App(它接 messaging)。

interface Props {
	/** U4:操作者已展开过的条目 id 集合。 */
	readItems?: Set<string>;
	/** U4:条目展开时回调,标记为已读。 */
	onItemRead?: (id: string) => void;
	/** U3/U9:操作者否决单条 awaiting-approval 条目;rejectionReason 供后端统计用。 */
	onDiscardItem?: (itemId: string, rejectionReason?: RejectionReason) => void;
	/** U4:所有 awaiting-approval 条目已读时为 true,门控 approve 按钮。 */
	allRead?: boolean;
	batch: Batch;
	safetyMode: SafetyMode;
	/** 批次创建时记录的授权 host(字面展示供核对)。 */
	authorizedHost: string;
	/** 钉住的 tab 是否仍停在授权 host(false → 阻断式暂停)。 */
	tabHealthy: boolean;
	busy?: boolean;
	driftResult?: DriftReport | null;
	/** 轨迹上下文(item.id → TrajectoryRecord),用于隔离释放时展示发布结果。 */
	trajectoryContext?: Map<string, TrajectoryRecord>;
	/** 人工编辑覆盖(itemId → 编辑后草稿);awaiting-approval 条目显示可编辑字段。 */
	draftOverrides?: Map<string, ContentDraft>;
	/** 用户编辑某条草稿时回调(item id + 完整新草稿)。 */
	onDraftChange?: (itemId: string, draft: ContentDraft) => void;
	/** 运营商显式重试单条 error/aborted 条目。 */
	onRetryItem?: (itemId: string) => void;
	/** 发布档位切换(操作者主动变更)。 */
	onModeChange?: (mode: SafetyMode) => void;
	/** 标准批准(含漂移自检前置门)。 */
	onApprove: () => void;
	/** 跳过漂移自检直接批准(仅在自检失败后提供)。 */
	onApproveBypass: () => void;
	onKill: () => void;
	onRelease: (itemId: string) => void;
	onDriftCheck: () => void;
	onResume: () => void;
	/** 操作者手动修改了草稿后调用,用于直发率度量。 */
	onItemEdited?: (itemId: string) => void;
	/** 一键将已发布条目存为 few-shot 范例（R11）。 */
	onSaveAsFewShot?: (itemId: string) => void;
}

const box: React.CSSProperties = {
	borderRadius: 6,
	padding: "8px 10px",
	fontSize: 13,
	marginBottom: 10,
};
const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

// 档位视觉:authorized 必须一眼区别于 dry-run(评审 design-lens 安全关键)。
const MODE_STYLE: Record<
	SafetyMode,
	{ bg: string; border: string; color: string; label: string; icon: string }
> = {
	off: {
		bg: "#f5f5f5",
		border: "#d9d9d9",
		color: "#555",
		label: "关闭(只填充,不发布)",
		icon: "⏻",
	},
	"dry-run": {
		bg: "#e6f4ff",
		border: "#91caff",
		color: "#0958d9",
		label: "预演(走流程不真发)",
		icon: "🧪",
	},
	authorized: {
		bg: "#fff1f0",
		border: "#ffa39e",
		color: "#cf1322",
		label: "已授权·会真发布",
		icon: "🔴",
	},
};

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
		onRetryItem,
		readItems,
		onItemRead,
		onDiscardItem,
		allRead,
		onModeChange,
	} = props;
	const summary = batchSummary(batch);
	const phase = batchPhase(batch);
	const modeStyle = MODE_STYLE[safetyMode];
	const [confirming, setConfirming] = useState(false);
	const [typed, setTyped] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	// U9:否决流程 — 记录哪个条目正在选择拒绝原因。
	const [discardPickerId, setDiscardPickerId] = useState<string | null>(null);
	const [discardReason, setDiscardReason] = useState<RejectionReason>("other");

	const quarantined = batch.items.filter(
		(it) => it.status === "needs-human-verification",
	);
	const awaitingApprovalCount = batch.items.filter(
		(it) => it.status === "awaiting-approval",
	).length;
	// U4:有 awaiting-approval 条目时,需全部已读才可批准。
	const readGateOk = awaitingApprovalCount === 0 || (allRead ?? false);
	const canApprove =
		phase === "awaiting-approval" &&
		awaitingApprovalCount > 0 &&
		tabHealthy &&
		(safetyMode === "authorized" || safetyMode === "dry-run") &&
		!busy &&
		readGateOk;
	// authorized 才要求打字手势;dry-run 预演只需点确认。
	const gestureOk =
		safetyMode !== "authorized" || typed.trim().toLowerCase() === "publish";
	const ds = aggregateDegradeStats(batch.items);

	function toggle(id: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			const willExpand = !next.has(id);
			if (willExpand) {
				next.add(id);
				// U4:展开即视为已读(仅 awaiting-approval 条目需要门控)。
				const item = batch.items.find((it) => it.id === id);
				if (item?.status === "awaiting-approval") {
					onItemRead?.(id);
				}
			} else {
				next.delete(id);
			}
			return next;
		});
	}

	function handleFixPlaceholder(itemId: string, currentDraft: ContentDraft) {
		const newVal = prompt(
			"请输入缺失的内容(将自动替换标题与正文中的【待补】):",
		);
		if (!newVal?.trim()) return;
		const val = newVal.trim();
		if (onDraftChange) {
			onDraftChange(itemId, {
				...currentDraft,
				title: currentDraft.title.replace(/【待补】/g, val),
				body: currentDraft.body.replace(/【待补】/g, val),
			});
		}
	}

	function confirmApprove() {
		setConfirming(false);
		setTyped("");
		props.onApprove();
	}

	return (
		<div>
			{/* 档位 + host + tab 状态带(常驻) */}
			<div
				style={{
					...box,
					background: modeStyle.bg,
					border: `1px solid ${modeStyle.border}`,
					color: modeStyle.color,
				}}
			>
				<div
					role="status"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontWeight: 600,
					}}
					aria-label={`发布档位 ${safetyMode}`}
				>
					{modeStyle.icon} 档位:
					{onModeChange ? (
						<select
							value={safetyMode}
							onChange={(e) => onModeChange(e.target.value as SafetyMode)}
							style={{
								fontSize: 12,
								padding: "1px 4px",
								border: `1px solid ${modeStyle.border}`,
								borderRadius: 4,
								background: modeStyle.bg,
								color: modeStyle.color,
								cursor: "pointer",
							}}
						>
							<option value="off">⏻ 关闭(只填充)</option>
							<option value="dry-run">🧪 预演(不真发)</option>
							<option value="authorized">🚀 已授权·真发布</option>
						</select>
					) : (
						modeStyle.label
					)}
				</div>
				<div style={{ marginTop: 2 }}>
					授权站点:<code>{authorizedHost || "(未记录)"}</code>
				</div>
				<div style={{ marginTop: 2 }}>
					{tabHealthy ? "✅ 目标标签页正常" : "⚠️ 目标标签页已离开授权站点"}
				</div>
			</div>

			{/* tab 漂移 → 阻断式暂停(非一行 toast) */}
			{!tabHealthy && (
				<div
					role="alert"
					style={{
						...box,
						background: "#fff7e6",
						border: "1px solid #ffd591",
						color: "#874d00",
					}}
				>
					批次已暂停:请切回授权 admin 标签页(<code>{authorizedHost}</code>
					)。在途条目不受影响。
					<div style={{ marginTop: 6 }}>
						<button
							type="button"
							onClick={props.onResume}
							style={{ ...btn, background: "#fa8c16", color: "#fff" }}
						>
							我已切回,继续
						</button>
					</div>
				</div>
			)}

			{/* 摘要带 */}
			<div
				style={{
					...box,
					background: "#fafafa",
					border: "1px solid #eee",
					color: "#333",
				}}
			>
				共 {summary.total} 条 · 待审 {summary.awaitingApproval} · 已发{" "}
				{summary.confirmed} · 失败 {summary.errored}
				{summary.quarantined > 0 && (
					<strong style={{ color: "#cf1322" }}>
						{" "}
						· 待人工核 {summary.quarantined}
					</strong>
				)}
				{summary.aborted > 0 && <span> · 已停 {summary.aborted}</span>}
				{(() => {
					const optimized = batch.items.filter(
						(i) => i.aiReviewTriggered === true,
					).length;
					return optimized > 0 ? (
						<span style={{ color: "#8c8c8c" }}>
							{" "}
							· ✦ {optimized} 条自评已优化
						</span>
					) : null;
				})()}
				{(() => {
					return phase === "done" && ds.itemsWithAnyDegrade > 0 ? (
						<span
							style={{
								marginLeft: 6,
								background: "#fa8c16",
								color: "#fff",
								borderRadius: 10,
								padding: "1px 7px",
								fontSize: 11,
								fontWeight: 600,
							}}
						>
							{ds.itemsWithAnyDegrade} 条降级
						</span>
					) : null;
				})()}
			</div>

			{/* 降级汇总条(批次完成后展示) */}
			{phase === "done" &&
				(() => {
					if (ds.totalItemsWithResults === 0) return null;
					const topSummary = ds.topFields
						.map((f) => `${f.field}（${f.count}x）`)
						.join("，");
					return ds.itemsWithAnyDegrade === 0 ? (
						<div
							style={{
								...box,
								background: "#f6ffed",
								border: "1px solid #b7eb8f",
								color: "#389e0d",
								fontSize: 12,
							}}
						>
							✅ 本批次所有字段填充成功
						</div>
					) : (
						<div
							style={{
								...box,
								background: "#fff7e6",
								border: "1px solid #ffd591",
								color: "#874d00",
								fontSize: 12,
							}}
						>
							⚠️ 本批次 {ds.itemsWithAnyDegrade}/{ds.totalItemsWithResults}{" "}
							条目有字段降级
							{topSummary && <span> | 高频：{topSummary}</span>}
						</div>
					);
				})()}

			{/* 隔离态:醒目独立表示(安全关键) */}
			{quarantined.length > 0 && (
				<div
					role="alert"
					style={{
						...box,
						background: "#fff1f0",
						border: "2px solid #cf1322",
						color: "#cf1322",
					}}
				>
					<div style={{ fontWeight: 700 }}>
						⚠ {quarantined.length} 条需人工核对
					</div>
					<div style={{ fontSize: 12, margin: "4px 0" }}>
						这些条目发布中断且无回执,可能已发也可能没发——请去后台核对后再处置,系统绝不自动重发。
					</div>
					{quarantined.map((it) => {
						const traj = trajectoryContext?.get(it.id);
						return (
							<div
								key={it.id}
								style={{
									marginTop: 8,
									paddingTop: 6,
									borderTop: "1px solid #ffa39e",
								}}
							>
								<div style={{ fontWeight: 600 }}>「{it.topic}」</div>
								<QuarantineContext record={traj} />
								<div style={{ marginTop: 4, display: "flex", gap: 6 }}>
									{traj?.publishUrl && (
										<a
											href={traj.publishUrl}
											target="_blank"
											rel="noopener noreferrer"
											style={{
												...btn,
												background: "#fff",
												border: "1px solid #ffa39e",
												color: "#cf1322",
												padding: "2px 8px",
												fontSize: 12,
												textDecoration: "none",
											}}
										>
											查看帖子
										</a>
									)}
									<button
										type="button"
										onClick={() => props.onRelease(it.id)}
										style={{
											...btn,
											background: "#cf1322",
											color: "#fff",
											padding: "2px 8px",
											fontSize: 12,
										}}
									>
										我已核对,撤出隔离
									</button>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* 条目列表(默认折叠) */}
			<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
				{batch.items.map((it) => (
					<ItemCard
						key={it.id}
						item={it}
						expanded={expanded.has(it.id)}
						onToggle={() => toggle(it.id)}
						readItems={readItems}
						busy={busy}
						draftOverrides={draftOverrides}
						onDraftChange={onDraftChange}
						onFixPlaceholder={handleFixPlaceholder}
						onItemEdited={props.onItemEdited}
						onSaveAsFewShot={props.onSaveAsFewShot}
						onRetryItem={onRetryItem}
						onDiscardItem={onDiscardItem}
						discardPickerOpen={discardPickerId === it.id}
						discardReason={discardReason}
						onOpenDiscard={() => {
							setDiscardReason("other");
							setDiscardPickerId(it.id);
						}}
						onCloseDiscard={() => setDiscardPickerId(null)}
						onChangeDiscardReason={setDiscardReason}
						onConfirmDiscard={() => {
							setDiscardPickerId(null);
							onDiscardItem?.(it.id, discardReason);
						}}
					/>
				))}
			</ul>

			{/* 漂移自检结果 */}
			{driftResult && (
				<div
					style={{
						...box,
						marginTop: 8,
						background: driftResult.ok ? "#f6ffed" : "#fff7e6",
						border: `1px solid ${driftResult.ok ? "#b7eb8f" : "#ffd591"}`,
					}}
				>
					{driftResult.ok ? (
						"✅ 选择器自检通过"
					) : (
						<>
							<div>⚠️ 缺失:{driftResult.missing.join("、")}</div>
							<div style={{ fontSize: 12, color: "#874d00", marginTop: 2 }}>
								请在目标页确认表单已载入,或刷新页面后操作。
							</div>
							<div style={{ display: "flex", gap: 6, marginTop: 6 }}>
								<button
									type="button"
									onClick={props.onDriftCheck}
									disabled={busy}
									style={{
										...btn,
										padding: "3px 8px",
										fontSize: 12,
										background: "#fa8c16",
										color: "#fff",
									}}
								>
									重新自检
								</button>
								<button
									type="button"
									onClick={props.onApproveBypass}
									disabled={busy}
									style={{
										...btn,
										padding: "3px 8px",
										fontSize: 12,
										background: "#f0f0f0",
										color: "#333",
									}}
								>
									跳过检查继续批准
								</button>
							</div>
						</>
					)}
				</div>
			)}

			{/* 动作区 */}
			<div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
				{canApprove && !confirming && (
					<button
						type="button"
						onClick={() => setConfirming(true)}
						style={{
							...btn,
							background: safetyMode === "authorized" ? "#cf1322" : "#1677ff",
							color: "#fff",
						}}
					>
						{safetyMode === "authorized"
							? `批准发布 ${summary.awaitingApproval} 条`
							: `预演 ${summary.awaitingApproval} 条`}
					</button>
				)}
				<button
					type="button"
					onClick={props.onDriftCheck}
					disabled={busy}
					style={{ ...btn, background: "#f0f0f0", color: "#333" }}
				>
					漂移自检
				</button>
				{phase !== "done" && (
					<button
						type="button"
						onClick={props.onKill}
						disabled={busy}
						style={{
							...btn,
							background: "#fff1f0",
							color: "#cf1322",
							border: "1px solid #ffa39e",
						}}
					>
						急停
					</button>
				)}
			</div>

			{/* 二次确认:插值 count + host + 主动手势(authorized) */}
			{confirming && (
				<div
					role="alertdialog"
					aria-label="发布确认"
					style={{
						...box,
						marginTop: 10,
						background: "#fff",
						border: "2px solid #cf1322",
					}}
				>
					<div style={{ fontWeight: 600, color: "#cf1322" }}>
						{safetyMode === "authorized"
							? `确定发布 ${summary.awaitingApproval} 条到 ${authorizedHost}?`
							: `预演发布 ${summary.awaitingApproval} 条(不会真发)?`}
					</div>
					{safetyMode === "authorized" && (
						<div style={{ marginTop: 6 }}>
							<div style={{ fontSize: 12, color: "#888" }}>
								防误触:请输入 <code>publish</code> 确认
							</div>
							<input
								aria-label="输入 publish 确认"
								value={typed}
								onChange={(e) => setTyped(e.target.value)}
								style={{
									width: "100%",
									boxSizing: "border-box",
									padding: 5,
									marginTop: 4,
									border: "1px solid #d9d9d9",
									borderRadius: 4,
								}}
							/>
						</div>
					)}
					<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
						<button
							type="button"
							onClick={confirmApprove}
							disabled={!gestureOk || !!busy}
							style={{
								...btn,
								background: gestureOk && !busy ? "#cf1322" : "#f5f5f5",
								color: gestureOk && !busy ? "#fff" : "#bbb",
							}}
						>
							确认
						</button>
						<button
							type="button"
							onClick={() => {
								setConfirming(false);
								setTyped("");
							}}
							style={{ ...btn, background: "#f0f0f0", color: "#333" }}
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
