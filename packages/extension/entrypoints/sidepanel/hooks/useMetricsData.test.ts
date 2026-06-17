import { describe, expect, it } from "vitest";
import type { TrajectoryRecord } from "../../../lib/safety/trajectory";
import { computeMetrics } from "./useMetricsData";

describe("computeMetrics", () => {
	it("应该在轨迹记录为空时返回全部为零/null的初始结构", () => {
		const result = computeMetrics([]);
		expect(result).toEqual({
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			avgCompletionTokens: 0,
			tokenRecordCount: 0,
			editedCount: 0,
			withDiffCount: 0,
			editRate: 0,
			directPublishRate: null,
			reviewRate: null,
			avgDurationSec: null,
			durationRecordCount: 0,
		});
	});

	it("应该正确计算 Token 用量及平均 Completion Token", () => {
		const mockRecords: TrajectoryRecord[] = [
			{
				id: "1",
				topic: "t1",
				llmCostTokens: { prompt: 100, completion: 50 },
				ts: "2026-06-17",
				fields: [],
				seq: 1,
				hash: "",
				status: "done",
			},
			{
				id: "2",
				topic: "t2",
				llmCostTokens: { prompt: 200, completion: 150 },
				ts: "2026-06-17",
				fields: [],
				seq: 2,
				hash: "",
				status: "done",
			},
			{
				id: "3",
				topic: "t3",
				// 没有 Token 数据
				ts: "2026-06-17",
				fields: [],
				seq: 3,
				hash: "",
				status: "done",
			},
		];
		const result = computeMetrics(mockRecords);
		expect(result.totalPromptTokens).toBe(300);
		expect(result.totalCompletionTokens).toBe(200);
		expect(result.avgCompletionTokens).toBe(100); // 200 / 2
		expect(result.tokenRecordCount).toBe(2);
	});

	it("应该正确计算编辑率", () => {
		const mockRecords: TrajectoryRecord[] = [
			{
				id: "1",
				topic: "t1",
				slotDiff: { totalSlots: 7, changedSlots: ["body"] },
				ts: "2026-06-17",
				fields: [],
				seq: 1,
				hash: "",
				status: "done",
			},
			{
				id: "2",
				topic: "t2",
				slotDiff: { totalSlots: 7, changedSlots: [] },
				ts: "2026-06-17",
				fields: [],
				seq: 2,
				hash: "",
				status: "done",
			},
			{
				id: "3",
				topic: "t3",
				slotDiff: { unknown: true, totalSlots: 0, changedSlots: ["title"] }, // unknown: true 应该被过滤掉
				ts: "2026-06-17",
				fields: [],
				seq: 3,
				hash: "",
				status: "done",
			},
		];
		const result = computeMetrics(mockRecords);
		expect(result.editedCount).toBe(1);
		expect(result.withDiffCount).toBe(2);
		expect(result.editRate).toBe(50); // 1 / 2 * 100
	});

	it("应该正确计算直发率", () => {
		const mockRecords: TrajectoryRecord[] = [
			{
				id: "1",
				topic: "t1",
				hasManualEdit: false,
				ts: "2026-06-17",
				fields: [],
				seq: 1,
				hash: "",
				status: "done",
			},
			{
				id: "2",
				topic: "t2",
				hasManualEdit: true,
				ts: "2026-06-17",
				fields: [],
				seq: 2,
				hash: "",
				status: "done",
			},
			{
				id: "3",
				topic: "t3",
				hasManualEdit: false,
				ts: "2026-06-17",
				fields: [],
				seq: 3,
				hash: "",
				status: "done",
			},
			{
				id: "4",
				topic: "t4",
				ts: "2026-06-17",
				fields: [],
				seq: 4,
				hash: "",
				status: "done",
			}, // 未定义 hasManualEdit 应该被忽略
		];
		const result = computeMetrics(mockRecords);
		expect(result.directPublishRate).toBe(67); // 2 / 3 * 100
	});

	it("应该正确计算 AI 评审触发率", () => {
		const mockRecords: TrajectoryRecord[] = [
			{
				id: "1",
				topic: "t1",
				aiReviewTriggered: true,
				ts: "2026-06-17",
				fields: [],
				seq: 1,
				hash: "",
				status: "done",
			},
			{
				id: "2",
				topic: "t2",
				aiReviewTriggered: false,
				ts: "2026-06-17",
				fields: [],
				seq: 2,
				hash: "",
				status: "done",
			},
			{
				id: "3",
				topic: "t3",
				ts: "2026-06-17",
				fields: [],
				seq: 3,
				hash: "",
				status: "done",
			}, // 未定义 aiReviewTriggered 应该被忽略
		];
		const result = computeMetrics(mockRecords);
		expect(result.reviewRate).toBe(50); // 1 / 2 * 100
	});

	it("应该正确计算平均生成时长", () => {
		const mockRecords: TrajectoryRecord[] = [
			{
				id: "1",
				topic: "t1",
				generationDurationMs: 1500,
				ts: "2026-06-17",
				fields: [],
				seq: 1,
				hash: "",
				status: "done",
			},
			{
				id: "2",
				topic: "t2",
				generationDurationMs: 2500,
				ts: "2026-06-17",
				fields: [],
				seq: 2,
				hash: "",
				status: "done",
			},
			{
				id: "3",
				topic: "t3",
				ts: "2026-06-17",
				fields: [],
				seq: 3,
				hash: "",
				status: "done",
			}, // 未定义时长
		];
		const result = computeMetrics(mockRecords);
		expect(result.avgDurationSec).toBe("2.0"); // (1500 + 2500) / 2 / 1000 = 2.0s
		expect(result.durationRecordCount).toBe(2);
	});
});
