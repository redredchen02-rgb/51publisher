// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- mock 消息层 + api-fetch ----
const firstFlightRehearse = vi.fn();
const firstFlightRun = vi.fn();
const firstFlightStatus = vi.fn();
vi.mock("../../lib/messaging", () => ({
	firstFlightRehearse: (...a: unknown[]) => firstFlightRehearse(...a),
	firstFlightRun: (...a: unknown[]) => firstFlightRun(...a),
	firstFlightStatus: (...a: unknown[]) => firstFlightStatus(...a),
}));

const apiFetch = vi.fn();
vi.mock("../../lib/api-fetch", () => ({
	apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

import { FirstFlightWizard } from "./FirstFlightWizard";

const HOST = "dx-999-adm.ympxbys.xyz"; // 主标签 = "ympxbys"

function preflightResponse(allPass = true) {
	return {
		ok: allPass,
		checks: [
			{ id: "jwt-secret", label: "JWT_SECRET 已设置且足够强", pass: allPass },
			{ id: "cors", label: "CORS_ORIGIN 已设置且非通配", pass: true },
		],
		residuals: [{ id: "smoke", label: "真后台人工冒烟" }],
	};
}

function mockPreflight(allPass = true) {
	apiFetch.mockResolvedValue({
		ok: true,
		json: async () => preflightResponse(allPass),
	});
}

function renderWizard() {
	return render(
		<FirstFlightWizard
			tabId={7}
			host={HOST}
			itemId="item_0"
			onBack={() => {}}
		/>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	firstFlightStatus.mockResolvedValue({
		mode: "dry-run",
		armed: false,
		bad: false,
	});
});
afterEach(cleanup);

describe("FirstFlightWizard", () => {
	it("① 三区 IA:自检未通过项(红)与仅人工可验证项(中性)用不同区块渲染", async () => {
		mockPreflight(false);
		renderWizard();
		await screen.findByText(/自检未通过项/);

		const failZone = document.querySelector('[data-zone="self-check-failed"]');
		const opZone = document.querySelector('[data-zone="operator-only"]');
		expect(failZone).not.toBeNull();
		expect(opZone).not.toBeNull();
		// 失败区用 error banner,操作者区用 info banner —— 视觉/语义不同。
		expect(failZone?.className).toContain("banner-error");
		expect(opZone?.className).toContain("banner-info");
		// 操作者区是 checklist,非失败
		expect(opZone?.textContent).toContain("真后台人工冒烟");
	});

	it("② 强制排演:未绿前禁止前进;排演绿后才可进入③", async () => {
		mockPreflight(true);
		renderWizard();
		fireEvent.click(await screen.findByText("下一步:排演"));

		const forward = screen.getByText(
			"下一步:确认真实站点",
		) as HTMLButtonElement;
		expect(forward.disabled).toBe(true);

		firstFlightRehearse.mockResolvedValue({
			ok: true,
			dryRunGreen: true,
			groundingOk: true,
			reasons: [],
		});
		fireEvent.click(screen.getByText("开始排演"));
		await screen.findByText(/排演全绿/);
		expect(
			(screen.getByText("下一步:确认真实站点") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("② 排演未过(grounding 拦)→ 展示原因,前进仍禁用", async () => {
		mockPreflight(true);
		renderWizard();
		fireEvent.click(await screen.findByText("下一步:排演"));
		firstFlightRehearse.mockResolvedValue({
			ok: false,
			dryRunGreen: true,
			groundingOk: false,
			reasons: ["标题仍含【待补】(缺作品名)"],
		});
		fireEvent.click(screen.getByText("开始排演"));
		await screen.findByText(/标题仍含【待补】/);
		expect(
			(screen.getByText("下一步:确认真实站点") as HTMLButtonElement).disabled,
		).toBe(true);
	});

	async function advanceToStep3() {
		mockPreflight(true);
		renderWizard();
		fireEvent.click(await screen.findByText("下一步:排演"));
		firstFlightRehearse.mockResolvedValue({
			ok: true,
			dryRunGreen: true,
			groundingOk: true,
			reasons: [],
		});
		fireEvent.click(screen.getByText("开始排演"));
		await screen.findByText(/排演全绿/);
		fireEvent.click(screen.getByText("下一步:确认真实站点"));
		await screen.findByText(/真实授权发布窗口/);
	}

	it("③ host 来自 prop(目标 tab),展示真实站点;初始焦点在警告而非确认按钮", async () => {
		await advanceToStep3();
		expect(screen.getByTestId("real-host").textContent).toBe(HOST);
		// 焦点不在确认按钮
		const confirm = screen.getByText("解锁并发布恰好一条") as HTMLButtonElement;
		expect(document.activeElement).not.toBe(confirm);
		expect(confirm.disabled).toBe(true); // 手势未输入
	});

	it("③ 防误点手势:输入错误标签确认仍禁用;输入正确才可解锁", async () => {
		await advanceToStep3();
		const input = screen.getByLabelText(/防误点/);
		const confirm = screen.getByText("解锁并发布恰好一条") as HTMLButtonElement;
		fireEvent.change(input, { target: { value: "wrong" } });
		expect(confirm.disabled).toBe(true);
		fireEvent.change(input, { target: { value: "ympxbys" } });
		expect(confirm.disabled).toBe(false);
	});

	it("④/⑤ 解锁:run 成功 → 结果展示已派发一条 + 已 revert + 验证真帖提示;无常驻直发", async () => {
		await advanceToStep3();
		fireEvent.change(screen.getByLabelText(/防误点/), {
			target: { value: "ympxbys" },
		});
		firstFlightRun.mockResolvedValue({
			ok: true,
			phase: "dispatched",
			itemStatus: "publish-confirmed",
			publishUrl: `https://${HOST}/post/1`,
			reverted: true,
		});
		fireEvent.click(screen.getByText("解锁并发布恰好一条"));
		await screen.findByText(/已派发恰好一条/);
		expect(firstFlightRun).toHaveBeenCalledWith(7, "item_0");
		// 验证真帖提示 + 已回落 dry-run
		screen.getByText(/请到真实站点核实/);
		expect(screen.getByText(/已派发恰好一条/).textContent).toContain(
			"授权已回落 dry-run",
		);
		// 失败/结果页只提供「重新排演并重试」,不提供直接重发
		screen.getByText("重新排演并重试");
		expect(screen.queryByText("解锁并发布恰好一条")).toBeNull();
	});

	it("⑤ run 失败 → 红色提示 + 已 revert + 仅「重新排演并重试」(回到②)", async () => {
		await advanceToStep3();
		fireEvent.change(screen.getByLabelText(/防误点/), {
			target: { value: "ympxbys" },
		});
		firstFlightRun.mockResolvedValue({
			ok: false,
			phase: "arm",
			reason: "first-flight-write-failed",
			reverted: true,
		});
		fireEvent.click(screen.getByText("解锁并发布恰好一条"));
		await screen.findByText(/首飞未完成/);
		fireEvent.click(screen.getByText("重新排演并重试"));
		// 回到②排演
		await screen.findByText("开始排演");
	});

	it("a11y:④ 解锁中面板有 aria-live=assertive 的「勿关闭」公告", async () => {
		await advanceToStep3();
		fireEvent.change(screen.getByLabelText(/防误点/), {
			target: { value: "ympxbys" },
		});
		// run 挂起,停在④
		let resolveRun: (v: unknown) => void = () => {};
		firstFlightRun.mockReturnValue(
			new Promise((r) => {
				resolveRun = r;
			}),
		);
		fireEvent.click(screen.getByText("解锁并发布恰好一条"));
		const notice = await screen.findByText(/不要关闭面板/);
		expect(notice.closest('[aria-live="assertive"]')).not.toBeNull();
		resolveRun({
			ok: true,
			phase: "dispatched",
			itemStatus: "x",
			reverted: true,
		});
	});

	it("背景强制 reset 再入:status.bad → 公告 + 退回排演步骤", async () => {
		mockPreflight(true);
		renderWizard();
		fireEvent.click(await screen.findByText("下一步:排演"));
		firstFlightRehearse.mockResolvedValue({
			ok: true,
			dryRunGreen: true,
			groundingOk: true,
			reasons: [],
		});
		fireEvent.click(screen.getByText("开始排演"));
		await screen.findByText(/排演全绿/);
		fireEvent.click(screen.getByText("下一步:确认真实站点"));
		await screen.findByText(/真实授权发布窗口/);

		// 背景强制 reset:下次状态轮询返回 bad。
		firstFlightStatus.mockResolvedValue({
			mode: "dry-run",
			armed: false,
			bad: true,
		});
		await waitFor(
			() => {
				screen.getByText(/首飞授权被强制重置/);
			},
			{ timeout: 3000 },
		);
		// 已退回(不再停在③:真实授权窗口警告消失);回到①/②重新排演路径。
		await waitFor(() => {
			expect(screen.queryByText(/真实授权发布窗口/)).toBeNull();
		});
		screen.getByText("下一步:排演");
	});
});
