import type { RejectionReason, SafetyMode } from "@51publisher/shared";
import type { BatchItem } from "../../../lib/batch";

export const box: React.CSSProperties = {
	borderRadius: 6,
	padding: "8px 10px",
	fontSize: 13,
	marginBottom: 10,
};
export const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

// 档位视觉:authorized 必须一眼区别于 dry-run(评审 design-lens 安全关键)。
export const MODE_STYLE: Record<
	SafetyMode,
	{ bg: string; border: string; color: string; label: string; icon: string }
> = {
	off: {
		bg: "var(--color-bg-muted)",
		border: "var(--color-border)",
		color: "var(--color-text-secondary)",
		label: "关闭(只填充,不发布)",
		icon: "⏻",
	},
	"dry-run": {
		bg: "var(--color-info-light)",
		border: "var(--color-info-border)",
		color: "var(--color-info)",
		label: "预演(走流程不真发)",
		icon: "🧪",
	},
	authorized: {
		bg: "var(--color-error-light)",
		border: "var(--color-error-border)",
		color: "var(--color-error)",
		label: "已授权·会真发布",
		icon: "🔴",
	},
};

export const STATUS_LABEL: Record<BatchItem["status"], string> = {
	queued: "排队",
	generating: "生成中",
	filled: "待审",
	"gate-failed": "接地拦截",
	"awaiting-approval": "待审",
	"publish-dispatched": "发布中",
	"publish-confirmed": "已发布",
	"needs-human-verification": "待人工核",
	aborted: "已停",
	error: "失败",
};

/** U9:拒绝原因选项(与 RejectionReason 枚举值对应)。 */
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
	duplicate: "重复选题",
	quality: "质量不达标",
	topic_mismatch: "选题不符",
	missing_facts: "事实缺失",
	other: "其他",
};
