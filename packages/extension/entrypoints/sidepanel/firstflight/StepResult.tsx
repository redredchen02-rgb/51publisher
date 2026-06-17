import type { FirstFlightRunResult } from "@51publisher/shared";

interface Props {
	runResult: FirstFlightRunResult;
	onReRehearse: () => void;
	onBack: () => void;
}

export function StepResult({ runResult, onReRehearse, onBack }: Props) {
	return (
		<section aria-label="结果" aria-live="polite">
			{runResult.ok && runResult.phase === "dispatched" ? (
				<>
					<div className="banner-info" role="status">
						✅ 已派发恰好一条(条目终态:{runResult.itemStatus ?? "未知"})。
						{runResult.reverted && " 授权已回落 dry-run、标记已清。"}
					</div>
					<div className="banner-warning" role="note" style={{ marginTop: "var(--space-md)" }}>
						🔴 请到真实站点核实帖子是否真的落地(URL/内容)——首飞只证明闸门时序正确,
						<strong>不</strong>代表发布一定成功。
						{runResult.publishUrl && (
							<div style={{ marginTop: 4 }}>
								回执 URL(请人工核实):<code>{runResult.publishUrl}</code>
							</div>
						)}
					</div>
				</>
			) : (
				<div className="banner-error" role="alert">
					首飞未完成({runResult.phase} 阶段
					{runResult.reason ? `:${runResult.reason}` : ""}
					{runResult.error ? `:${runResult.error}` : ""})。
					{runResult.reverted && " 授权已回落 dry-run。"}
				</div>
			)}
			<div style={{ marginTop: "var(--space-lg)", display: "flex", gap: 8 }}>
				<button type="button" className="btn btn-primary" onClick={onReRehearse}>
					重新排演并重试
				</button>
				<button type="button" className="btn btn-plain" onClick={onBack}>
					完成,返回
				</button>
			</div>
		</section>
	);
}
