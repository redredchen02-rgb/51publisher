import type { BatchItem } from "../../../../lib/batch";
import { FeedbackWidget } from "./FeedbackWidget";

interface BatchResultSectionsProps {
	gateFailedItems: BatchItem[];
	needsVerificationItems: BatchItem[];
	confirmedItems: BatchItem[];
	terminalOtherItems: BatchItem[];
	onRetry: (itemId: string) => void;
}

export function BatchResultSections({
	gateFailedItems,
	needsVerificationItems,
	confirmedItems,
	terminalOtherItems,
	onRetry,
}: BatchResultSectionsProps) {
	return (
		<>
			{gateFailedItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						内容问题
					</p>
					{gateFailedItems.map((item) => {
						const reason = item.gateFailReason ?? "";
						const hint =
							reason.includes("待補") || reason.includes("placeholder")
								? "提示：草稿含【待補】佔位符，請補充事實後重試"
								: reason.includes("link") ||
										reason.includes("連結") ||
										reason.includes("来源")
									? "提示：缺少來源鏈接，請在選題事實中補充後重試"
									: reason.includes("重複") || reason.includes("duplicate")
										? "提示：內容與已發布帖子高度相似，建議換題"
										: null;
						return (
							<div
								key={item.id}
								className="banner-error"
								style={{ marginBottom: "var(--space-lg)" }}
							>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "flex-start",
									}}
								>
									<div style={{ flex: 1 }}>
										<p className="font-medium" style={{ margin: 0 }}>
											{item.topic}
										</p>
										{reason && (
											<p
												className="text-error"
												style={{
													margin: "var(--space-sm) 0 0",
													fontSize: "var(--font-xs)",
												}}
											>
												{reason}
											</p>
										)}
										{hint && (
											<p
												style={{
													margin: "var(--space-xs) 0 0",
													fontSize: "var(--font-xs)",
													color: "var(--color-warning)",
												}}
											>
												{hint}
											</p>
										)}
									</div>
									<button
										type="button"
										onClick={() => onRetry(item.id)}
										className="btn btn-plain btn-sm text-error"
										style={{
											flexShrink: 0,
											borderColor: "var(--color-error-border)",
										}}
									>
										重新生成
									</button>
								</div>
							</div>
						);
					})}
				</section>
			)}

			{needsVerificationItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						需人工核实
					</p>
					{needsVerificationItems.map((item) => (
						<div
							key={item.id}
							className="banner-warning"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							<p className="font-medium" style={{ margin: 0 }}>
								{item.draft?.title ?? item.topic}
							</p>
							<p
								className="text-warning-deep text-sm"
								style={{ margin: "var(--space-sm) 0 0" }}
							>
								发布确认状态不确定，请先到后台核实是否已发出，再回到批量审核处理。
							</p>
						</div>
					))}
				</section>
			)}

			{confirmedItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						已发布
					</p>
					{confirmedItems.map((item) => (
						<div
							key={item.id}
							style={{
								padding: "var(--space-lg) var(--space-xl)",
								borderBottom: "1px solid var(--color-border-lighter)",
							}}
						>
							<div style={{ display: "flex", justifyContent: "space-between" }}>
								<span
									style={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										flex: 1,
									}}
								>
									{item.draft?.title ?? item.topic}
								</span>
								<span
									className="text-success"
									style={{ marginLeft: "var(--space-md)", flexShrink: 0 }}
								>
									✓ 已发布
								</span>
							</div>
							<FeedbackWidget itemId={item.id} topic={item.topic} />
						</div>
					))}
				</section>
			)}

			{terminalOtherItems.length > 0 && (
				<section style={{ marginBottom: "var(--space-xl)" }}>
					<p className="text-muted" style={{ margin: "0 0 var(--space-lg)" }}>
						出错/中止
					</p>
					{terminalOtherItems.map((item) => (
						<div
							key={item.id}
							style={{
								padding: "var(--space-lg) var(--space-xl)",
								borderBottom: "1px solid var(--color-border-lighter)",
								fontSize: "var(--font-sm)",
								color: "var(--color-text-muted)",
							}}
						>
							<span>{item.topic}</span>
							{item.error && (
								<span
									style={{
										marginLeft: "var(--space-md)",
										color: "var(--color-error)",
									}}
								>
									{item.error}
								</span>
							)}
						</div>
					))}
				</section>
			)}
		</>
	);
}
