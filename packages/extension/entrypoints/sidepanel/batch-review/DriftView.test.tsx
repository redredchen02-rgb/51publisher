// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftView } from "./DriftView";

describe("DriftView", () => {
	it("ok=true: 显示通过文案，不显示缺失列表", () => {
		render(
			<DriftView
				driftResult={{ ok: true, missing: [] }}
				onDriftCheck={vi.fn()}
				onApproveBypass={vi.fn()}
			/>,
		);
		expect(screen.getByText(/选择器自检通过/)).toBeTruthy();
		expect(screen.queryByText(/缺失/)).toBeNull();
	});

	it("ok=false: 显示缺失字段并渲染操作按钮", () => {
		const onDriftCheck = vi.fn();
		const onApproveBypass = vi.fn();
		render(
			<DriftView
				driftResult={{ ok: false, missing: ["#title", "#body"] }}
				onDriftCheck={onDriftCheck}
				onApproveBypass={onApproveBypass}
			/>,
		);
		expect(screen.getByText(/缺失/)).toBeTruthy();
		expect(screen.getByText(/重新自检/)).toBeTruthy();
		fireEvent.click(screen.getByText("重新自检"));
		expect(onDriftCheck).toHaveBeenCalled();
		fireEvent.click(screen.getByText(/跳过检查/));
		expect(onApproveBypass).toHaveBeenCalled();
	});
});
