import type { TrajectoryRecord } from "../../../lib/trajectory";
import type { BatchItem } from "../../../lib/batch";
import { btn, box } from "./constants";
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
			{onReleaseAll && quarantined.length > 1 && (
				<button
					type="button"
					className="btn btn-plain btn-sm"
					style={{ margin: "4px 0" }}
					onClick={() => {
						if (
							window.confirm(
								`将清除整批 ${quarantined.length} 条的人工核验闸(全部撤出隔离 → aborted)。请确认已逐条在后台核对。继续?`,
							)
						)
							onReleaseAll?.();
					}}
				>
					批量撤出全部({quarantined.length})
				</button>
			)}
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
							{traj?.publishUrl && (
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
