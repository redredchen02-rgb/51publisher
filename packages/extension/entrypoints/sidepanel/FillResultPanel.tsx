import type { FieldFillResult } from "@51publisher/shared";

const FIELD_LABELS: Record<string, string> = {
	title: "标题",
	subtitle: "副标题",
	category: "分类",
	body: "正文",
	tags: "标签",
	description: "描述",
	postStatus: "状态",
	publishedAt: "发布时间",
	mediaId: "作品 id",
};

const STATUS_STYLE = {
	filled: {
		color: "var(--color-success)",
		bg: "var(--color-success-light)",
		border: "var(--color-success-border)",
		text: "已填",
	},
	skipped: {
		color: "var(--color-warning)",
		bg: "var(--color-warning-light)",
		border: "var(--color-warning-border)",
		text: "跳过",
	},
	degraded: {
		color: "var(--color-error)",
		bg: "var(--color-error-light)",
		border: "var(--color-error-border)",
		text: "需手动",
	},
} as const;

export function FillResultPanel({ results }: { results: FieldFillResult[] }) {
	if (results.length === 0) return null;
	const problems = results.filter((r) => r.status !== "filled");
	return (
		<section aria-live="polite" style={{ marginTop: "var(--space-xl)" }}>
			<h2 style={{ fontSize: "var(--font-md)", margin: "0 0 var(--space-lg)" }}>
				填充结果
			</h2>
			{problems.length > 0 && (
				<div
					className="banner-error"
					style={{ marginBottom: "var(--space-lg)" }}
				>
					⚠️ 有 {problems.length} 个字段未完整填入,请在发帖页核对后再手动发布。
				</div>
			)}
			<ul
				style={{
					listStyle: "none",
					margin: 0,
					padding: 0,
					display: "flex",
					flexDirection: "column",
					gap: "var(--space-sm)",
				}}
			>
				{results.map((r) => {
					const s = STATUS_STYLE[r.status];
					return (
						<li
							key={r.field}
							style={{
								display: "flex",
								gap: "var(--space-md)",
								alignItems: "baseline",
								fontSize: "var(--font-sm)",
								background: s.bg,
								border: `1px solid ${s.border}`,
								borderRadius: "var(--radius-md)",
								padding: "3px 6px",
							}}
						>
							<span className="font-semibold" style={{ minWidth: 56 }}>
								{FIELD_LABELS[r.field] ?? r.field}
							</span>
							<span className="font-semibold" style={{ color: s.color }}>
								{s.text}
							</span>
							{r.note && <span className="text-muted">{r.note}</span>}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
