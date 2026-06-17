interface WorkflowNavProps {
	onMetrics: () => void;
}

export function WorkflowNav({ onMetrics }: WorkflowNavProps) {
	return (
		<nav className="workflow-grid" aria-label="主要工作流">
			<button type="button" onClick={onMetrics} className="workflow-card">
				<span className="workflow-card-title">度量</span>
				<span className="workflow-card-desc">LLM 用量、品质等统计看板</span>
			</button>
		</nav>
	);
}
