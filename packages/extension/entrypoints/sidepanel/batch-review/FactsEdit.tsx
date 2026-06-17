import { FACT_ORDER, type FactKey, type FactsBlock } from "@51publisher/shared";
import { useState } from "react";

/**
 * 内联事实编辑器。
 *
 * 用途:操作者看到 grounding 闸拦截(gate-failed 或 awaiting-approval)后,
 * 直接在审核卡片内修改事实字段,提交触发后台 LLM 重生成。
 *
 * 工作模式:
 * - 以当前 item.facts(来自爬虫)为初始值;所有字段可编辑。
 * - 提交时把完整 FactsBlock 传给 onSubmit(itemId, newFacts)。
 * - 取消恢复到初始值,关闭面板(onCancel)。
 * - URL 字段(漢化/無修)做轻量格式校验(须 http/https);不合法则本地拒绝。
 */

const URL_FIELDS: ReadonlySet<FactKey> = new Set(["漢化", "無修"]);

function isValidUrlOrEmpty(v: string): boolean {
	if (!v.trim()) return true;
	try {
		const url = new URL(v.trim());
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function FactsEdit({
	itemId,
	initialFacts,
	onSubmit,
	onCancel,
}: {
	itemId: string;
	initialFacts: FactsBlock;
	onSubmit: (itemId: string, newFacts: FactsBlock) => void;
	onCancel: () => void;
}) {
	const [local, setLocal] = useState<FactsBlock>({ ...initialFacts });
	const [errors, setErrors] = useState<Partial<Record<FactKey, string>>>({});

	function patch(key: FactKey, value: string) {
		setLocal((prev) => ({ ...prev, [key]: value }));
		if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
	}

	function validate(): boolean {
		const next: Partial<Record<FactKey, string>> = {};
		for (const key of URL_FIELDS) {
			const v = local[key] ?? "";
			if (!isValidUrlOrEmpty(v)) {
				next[key] = "须为 https:// 或 http:// 开头的合法 URL，或留空";
			}
		}
		setErrors(next);
		return Object.keys(next).length === 0;
	}

	function handleSubmit() {
		if (!validate()) return;
		// 清理空白字段(空字符串 → 删除 key)
		const clean: FactsBlock = {};
		for (const key of FACT_ORDER) {
			const v = local[key]?.trim();
			if (v) clean[key] = v;
		}
		onSubmit(itemId, clean);
	}

	return (
		<div
			style={{
				border: "1px solid var(--color-warning)",
				borderRadius: 4,
				padding: 8,
				marginTop: 6,
				background: "var(--color-bg-subtle, #fafafa)",
			}}
		>
			<div
				className="font-semibold text-sm"
				style={{ marginBottom: 6, color: "var(--color-warning)" }}
			>
				编辑事实 → 重新生成草稿
			</div>
			{FACT_ORDER.map((key) => {
				const isUrl = URL_FIELDS.has(key);
				const errMsg = errors[key];
				return (
					<div key={key} style={{ marginBottom: 4 }}>
						<label
							htmlFor={`facts-field-${key}`}
							className="text-sm text-secondary"
							style={{ display: "block" }}
						>
							{key}
							{isUrl && (
								<span
									className="text-muted"
									style={{ marginLeft: 4, fontSize: 10 }}
								>
									(URL)
								</span>
							)}
						</label>
						{key === "简介" ? (
							<textarea
								id={`facts-field-${key}`}
								className={`field-input${errMsg ? " field-input--error" : ""}`}
								style={{
									minHeight: 56,
									width: "100%",
									boxSizing: "border-box",
								}}
								value={local[key] ?? ""}
								onChange={(e) => patch(key, e.target.value)}
							/>
						) : (
							<input
								id={`facts-field-${key}`}
								className={`field-input${errMsg ? " field-input--error" : ""}`}
								style={{ width: "100%", boxSizing: "border-box" }}
								value={local[key] ?? ""}
								onChange={(e) => patch(key, e.target.value)}
							/>
						)}
						{errMsg && (
							<div
								className="text-sm"
								style={{ color: "var(--color-error)", marginTop: 2 }}
							>
								{errMsg}
							</div>
						)}
					</div>
				);
			})}
			<div className="flex" style={{ gap: 6, marginTop: 8 }}>
				<button
					type="button"
					className="btn btn-primary btn-sm"
					onClick={handleSubmit}
				>
					提交并重新生成
				</button>
				<button
					type="button"
					className="btn btn-ghost btn-sm"
					onClick={onCancel}
				>
					取消
				</button>
			</div>
		</div>
	);
}
