export type Step = 1 | 2 | 3 | 4 | 5;

export interface PreflightCheck {
	id: string;
	label: string;
	pass: boolean;
}
export interface PreflightResidual {
	id: string;
	label: string;
}
export interface PreflightResponse {
	ok: boolean;
	checks: PreflightCheck[];
	residuals: PreflightResidual[];
}

/** 取 host 的最后一段标签(防误点手势:要求操作者手输它)。 */
export function lastLabel(host: string): string {
	const parts = host.split(".").filter(Boolean);
	return parts.length >= 2
		? (parts[parts.length - 2] ?? host)
		: (parts[0] ?? host);
}
