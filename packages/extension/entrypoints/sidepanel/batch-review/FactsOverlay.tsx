// 缺失事实补全编辑器(U6,替代 prompt() 全局替换)。
//
// 目的:gate-failed 且含 slots 的条目,操作者按「缺失的事实槽位」逐字段补全
// (作品名/集数/制作/漢化/無修/简介),每个输入独立(不再全局 replace 同一值),
// 提交前本地预览重组装后的标题+正文,提交则派发 refillItemFacts(itemId, facts)。
//
// 边界:
//   - 只读预览 —— 权威重组装仍在 background(commit 时)。
//   - 槽位全填满却仍 gate-failed(散文内残留【待补】) 或 无 slots →
//     无可填字段,由 ItemCard 走「需重新生成」兜底(本组件不渲染编辑字段)。

import type { BatchItem, FactsBlock } from "@51publisher/shared";
import { useMemo, useState } from "react";
import { reassembleWithFacts } from "../../../lib/refill";
import { sanitizeBody } from "../../../lib/sanitize";

/** 可补全的事实槽位顺序与人类可读标签(对应 plan:作品名/集数/制作/漢化/無修/简介)。 */
const FILLABLE_SLOTS: {
	key: keyof FactsBlock;
	label: string;
	hint?: string;
}[] = [
	{ key: "作品名", label: "作品名" },
	{ key: "集数", label: "集数" },
	{ key: "制作", label: "制作 / 原作" },
	{ key: "漢化", label: "漢化(连结,https)", hint: "https://…" },
	{ key: "無修", label: "無修(连结,https)", hint: "https://…" },
	{ key: "简介", label: "简介" },
];

/**
 * 某条目当前为空的可填事实槽位(操作者据此补全)。
 * 注意:与 reassembleWithFacts 一致——只看 item.facts 当前值是否为空。
 */
export function emptyFactSlots(
	item: BatchItem,
): { key: keyof FactsBlock; label: string; hint?: string }[] {
	const f = item.facts ?? {};
	return FILLABLE_SLOTS.filter((s) => !f[s.key]?.trim());
}

interface Props {
	item: BatchItem;
	busy?: boolean;
	/** 提交补全:派发 refillItemFacts(itemId, facts)。 */
	onRefillFacts: (itemId: string, facts: Partial<FactsBlock>) => void;
}

export function FactsOverlay({ item, busy, onRefillFacts }: Props) {
	const slots = useMemo(() => emptyFactSlots(item), [item]);
	const [values, setValues] = useState<
		Partial<Record<keyof FactsBlock, string>>
	>({});

	// 修剪后的事实(仅含非空字段),供预览/校验/提交复用。
	const trimmed = useMemo(() => {
		const out: Partial<FactsBlock> = {};
		for (const s of slots) {
			const v = values[s.key]?.trim();
			if (v) out[s.key] = v;
		}
		return out;
	}, [values, slots]);

	const anyTyped = slots.some((s) => (values[s.key]?.trim() ?? "") !== "");
	const allFilled = slots.every((s) => (values[s.key]?.trim() ?? "") !== "");

	// 本地预览:用 reassembleWithFacts 复用同一纯函数,正文经 sanitizeBody 消毒。
	const preview = useMemo(() => {
		const result = reassembleWithFacts(item, trimmed);
		if (!result.ok) return { error: result.message } as const;
		return {
			title: result.draft.title,
			body: sanitizeBody(result.draft.body),
		} as const;
	}, [item, trimmed]);

	function reset() {
		setValues({});
	}

	function handleCancel() {
		if (anyTyped) {
			if (!window.confirm("已输入的内容将被丢弃,确定取消?")) return;
		}
		reset();
	}

	function handleCommit() {
		if (!allFilled) return;
		onRefillFacts(item.id, trimmed);
		reset();
	}

	return (
		<div
			style={{
				marginTop: 8,
				padding: "6px 8px",
				background: "var(--color-bg-surface)",
				border: "1px solid var(--color-border)",
				borderRadius: 4,
			}}
		>
			<div className="font-semibold" style={{ marginBottom: 4, fontSize: 11 }}>
				补全缺失事实(逐项填写,提交后重新组装)
			</div>

			{slots.map((s) => (
				<label
					key={s.key}
					style={{ display: "block", marginBottom: 4, fontSize: 11 }}
				>
					<span className="text-secondary">{s.label}</span>
					<input
						aria-label={`补全 ${s.label}`}
						value={values[s.key] ?? ""}
						placeholder={s.hint}
						disabled={busy}
						onChange={(e) =>
							setValues((prev) => ({ ...prev, [s.key]: e.target.value }))
						}
						style={{
							width: "100%",
							boxSizing: "border-box",
							padding: 4,
							marginTop: 2,
							border: "1px solid var(--color-border)",
							borderRadius: 3,
							fontSize: 11,
						}}
					/>
				</label>
			))}

			{/* 空/空白槽位阻断提交的内联提示 */}
			{!allFilled && (
				<div
					role="status"
					className="text-warning"
					style={{ fontSize: 11, marginTop: 2 }}
				>
					请填写全部 {slots.length} 个字段后再提交(空白不算)。
				</div>
			)}

			{/* 预览:重组装后的标题 + 正文(已消毒);URL 不合法等拒因内联展示 */}
			<div style={{ marginTop: 6 }}>
				<div className="font-semibold text-secondary" style={{ fontSize: 11 }}>
					预览(重组装后):
				</div>
				{"error" in preview ? (
					<div
						role="alert"
						aria-label="重组装校验失败"
						className="text-error"
						style={{ fontSize: 11, marginTop: 2 }}
					>
						⛔ {preview.error}
					</div>
				) : (
					<>
						<div
							role="note"
							aria-label="预览标题"
							style={{
								fontWeight: 600,
								fontSize: 11,
								marginTop: 2,
								wordBreak: "break-all",
							}}
						>
							{preview.title || "(无标题)"}
						</div>
						<div
							role="note"
							aria-label="预览正文"
							style={{
								fontSize: 11,
								marginTop: 2,
								maxHeight: 120,
								overflow: "auto",
								color: "var(--color-text-close)",
							}}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: 正文经 sanitizeBody(DOMPurify)消毒
							dangerouslySetInnerHTML={{ __html: preview.body }}
						/>
					</>
				)}
			</div>

			<div className="flex" style={{ gap: 6, marginTop: 6 }}>
				<button
					type="button"
					onClick={handleCommit}
					disabled={busy || !allFilled || "error" in preview}
					style={{
						padding: "3px 10px",
						fontSize: 11,
						border: "none",
						borderRadius: 3,
						background:
							!busy && allFilled && !("error" in preview)
								? "var(--color-success)"
								: "var(--color-bg-muted)",
						color:
							!busy && allFilled && !("error" in preview)
								? "#fff"
								: "var(--color-text-disabled)",
						cursor:
							!busy && allFilled && !("error" in preview)
								? "pointer"
								: "not-allowed",
					}}
				>
					提交补全
				</button>
				<button
					type="button"
					onClick={handleCancel}
					disabled={busy}
					style={{
						padding: "3px 10px",
						fontSize: 11,
						border: "1px solid var(--color-border)",
						borderRadius: 3,
						background: "var(--color-border-lighter)",
						color: "var(--color-text)",
						cursor: "pointer",
					}}
				>
					取消
				</button>
			</div>
		</div>
	);
}
