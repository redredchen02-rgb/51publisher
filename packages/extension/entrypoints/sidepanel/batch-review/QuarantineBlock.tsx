import { useState } from "react";
import type { BatchItem } from "../../../lib/batch";
import type { TrajectoryRecord } from "../../../lib/trajectory";
import { box, btn } from "./constants";
import { QuarantineContext } from "./sub-blocks";

interface Props {
	quarantined: BatchItem[];
	trajectoryContext?: Map<string, TrajectoryRecord>;
	onRelease: (itemId: string) => void;
	onReleaseAll?: () => void;
}

export function QuarantineBlock({
	quarantined,
	trajectoryContext,
	onRelease,
	onReleaseAll,
}: Props) {
	const [isConfirming, setIsConfirming] = useState(false);

	if (quarantined.length === 0) return null;
	return (
		<div
			role="alert"
			style={{
				...box,
				background: "var(--color-error-light)",
				border: "2px solid var(--color-error)",
				color: "var(--color-error)",
			}}
		>
			<div className="font-semibold" style={{ fontWeight: 700 }}>
				⚠ {quarantined.length} 条需人工核对
			</div>
			<div style={{ fontSize: 12, margin: "4px 0" }}>
				这些条目发布中断且无回执,可能已发也可能没发——请去后台核对后再处置,系统绝不自动重发。
			</div>
			{onReleaseAll &&
				quarantined.length > 1 &&
				(isConfirming ? (
					<div
						style={{
							display: "flex",
							gap: 6,
							margin: "4px 0",
							alignItems: "center",
							fontSize: 12,
						}}
					>
						<span>已逐条核对后台？</span>
						<button
							type="button"
							className="btn btn-plain btn-sm"
							onClick={() => {
								setIsConfirming(false);
								onReleaseAll?.();
							}}
						>
							确认撤出
						</button>
						<button
							type="button"
							className="btn btn-plain btn-sm"
							onClick={() => setIsConfirming(false)}
						>
							取消
						</button>
					</div>
				) : (
					<button
						type="button"
						className="btn btn-plain btn-sm"
						style={{ margin: "4px 0" }}
						onClick={() => setIsConfirming(true)}
					>
						批量撤出全部({quarantined.length})
					</button>
				))}
			{quarantined.map((it) => {
				const traj = trajectoryContext?.get(it.id);
				return (
					<div
						key={it.id}
						style={{
							marginTop: 8,
							paddingTop: 6,
							borderTop: "1px solid var(--color-error-border)",
						}}
					>
						<div className="font-semibold">「{it.topic}」</div>
						<QuarantineContext record={traj} />
						<div className="flex" style={{ marginTop: 4, gap: 6 }}>
							{traj?.publishUrl?.startsWith("https://") && (
								<a
									href={traj.publishUrl}
									target="_blank"
									rel="noopener noreferrer"
									style={{
										...btn,
										background: "#fff",
										border: "1px solid var(--color-error-border)",
										color: "var(--color-error)",
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
								onClick={() => onRelease(it.id)}
								style={{
									...btn,
									background: "var(--color-error)",
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
	);
}
