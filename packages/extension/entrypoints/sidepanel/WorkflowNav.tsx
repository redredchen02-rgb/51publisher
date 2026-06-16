interface WorkflowNavProps {
	onToday: () => void;
	onGossip: () => void;
	onPending: () => void;
	onBatch: () => void;
	onFirstFlight: () => void;
	onMetrics: () => void;
}

export function WorkflowNav({
	onToday,
	onGossip,
	onPending,
	onBatch,
	onFirstFlight,
	onMetrics,
}: WorkflowNavProps) {
	return (
		<nav className="workflow-grid" aria-label="主要工作流">
			<button type="button" onClick={onToday} className="workflow-card primary">
				<span className="workflow-card-title">今日流水线</span>
				<span className="workflow-card-desc">
					自动取高分待审选题，生成草稿，逐篇审读后发布
				</span>
			</button>
			<button
				type="button"
				onClick={onGossip}
				className="btn btn-plain"
				aria-label="吃瓜素材"
			>
				🍉 吃瓜
			</button>
			<button type="button" onClick={onPending} className="workflow-card">
				<span className="workflow-card-title">待审池</span>
				<span className="workflow-card-desc">
					抓取选题、补事实、挑选进入批量生成
				</span>
			</button>
			<button type="button" onClick={onBatch} className="workflow-card">
				<span className="workflow-card-title">批量审核</span>
				<span className="workflow-card-desc">
					查看当前批次、处理异常、重跑或人工放行
				</span>
			</button>
			<button type="button" onClick={onFirstFlight} className="workflow-card">
				<span className="workflow-card-title">首飞向导</span>
				<span className="workflow-card-desc">
					最小授权窗口发布恰好一条,验证闸门时序
				</span>
			</button>
			<button type="button" onClick={onMetrics} className="workflow-card">
				<span className="workflow-card-title">度量</span>
				<span className="workflow-card-desc">
					发布质量、LLM 用量、编辑率等统计看板
				</span>
			</button>
		</nav>
	);
}
