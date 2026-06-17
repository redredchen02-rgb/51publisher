import React from "react";
import type { PendingTopic } from "../../../lib/pending-client";

const FACTS_KEYS = [
	"作品名",
	"集数",
	"制作",
	"漢化",
	"無修",
	"题材",
	"简介",
] as const;

interface Props {
	topic: PendingTopic;
	selected: boolean;
	expanded: boolean;
	localFacts: Record<string, string> | undefined;
	busy: boolean;
	onToggleSelect: () => void;
	onToggleExpand: () => void;
	onFactChange: (key: string, value: string) => void;
}

export function TopicListItem({
	topic: t,
	selected,
	expanded,
	localFacts,
	busy,
	onToggleSelect,
	onToggleExpand,
	onFactChange,
}: Props) {
	const score = t.qualityScore ?? t.confidence;
	const isHigh = score >= 0.7;
	const isMed = score >= 0.4 && score < 0.7;

	return (
		<li
			style={{
				border: `1px solid ${isHigh ? "var(--color-success)" : "var(--color-border-lighter)"}`,
				borderRadius: "var(--radius-md)",
				marginBottom: "var(--space-sm)",
				opacity: score < 0.3 ? 0.6 : 1,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "var(--space-lg) var(--space-md)",
				}}
			>
				<input
					type="checkbox"
					checked={selected}
					onChange={onToggleSelect}
					style={{ marginRight: "var(--space-md)" }}
					disabled={busy}
				/>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						className="font-semibold"
						style={{
							fontSize: "var(--font-base)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						{isHigh && (
							<span
								style={{
									fontSize: "var(--font-xs)",
									background: "var(--color-success)",
									color: "#fff",
									padding: "1px 5px",
									borderRadius: 4,
									flexShrink: 0,
								}}
							>
								高潜力
							</span>
						)}
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{t.title || t.sourceUrl}
						</span>
					</div>
					<div
						className="text-xs text-muted"
						style={{ marginTop: "var(--space-xs)" }}
					>
						{t.siteName} ·{" "}
						<span
							style={{
								color: isHigh
									? "var(--color-success)"
									: isMed
										? "var(--color-warning)"
										: "var(--color-text-disabled)",
							}}
						>
							評分 {Math.round(score * 100)}
						</span>
						{" · "}
						{t.sourceUrl.slice(0, 50)}
					</div>
				</div>
				<button
					type="button"
					onClick={onToggleExpand}
					aria-expanded={expanded}
					className="btn btn-plain btn-sm text-secondary"
				>
					{expanded ? "收起" : "详情"}
				</button>
			</div>

			{expanded && (
				<div
					className="expand-enter"
					style={{
						padding: "var(--space-lg) var(--space-xl)",
						fontSize: "var(--font-sm)",
						borderTop: "1px solid var(--color-border-lighter)",
					}}
				>
					{t.coverImageUrl && (
						<img
							src={t.coverImageUrl}
							alt="封面"
							style={{
								maxHeight: 60,
								marginBottom: "var(--space-lg)",
								objectFit: "cover",
								borderRadius: "var(--radius-sm)",
							}}
						/>
					)}
					<div>
						<strong>事实（可编辑）:</strong>
						<div
							style={{
								marginTop: "var(--space-sm)",
								display: "grid",
								gridTemplateColumns: "4em 1fr",
								gap: "3px var(--space-lg)",
								alignItems: "center",
							}}
						>
							{FACTS_KEYS.map((key) => (
								<React.Fragment key={key}>
									<div
										className="text-xs text-muted"
										style={{ textAlign: "right" }}
									>
										{key}
									</div>
									<input
										type="text"
										className="field-input"
										value={(localFacts ?? t.facts)[key] ?? ""}
										onChange={(e) => onFactChange(key, e.target.value)}
										disabled={busy}
										style={{
											fontSize: "var(--font-xs)",
											padding: "1px var(--space-sm)",
										}}
									/>
								</React.Fragment>
							))}
						</div>
					</div>
					{t.rawContent?.body && (
						<div
							style={{
								marginTop: "var(--space-lg)",
								maxHeight: 120,
								overflow: "auto",
								color: "var(--color-text-muted)",
								fontSize: "var(--font-xs)",
							}}
						>
							<strong>原始内容(前300字):</strong>
							<div style={{ marginTop: "var(--space-xs)" }}>
								{t.rawContent.body.slice(0, 300)}…
							</div>
						</div>
					)}
				</div>
			)}
		</li>
	);
}
