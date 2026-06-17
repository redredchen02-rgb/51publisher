import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { storage } from "#imports";
import {
	addFewShotPair,
	appendTrajectory,
	clearTrajectory,
	DEFAULT_SETTINGS,
	deriveFewShotExamples,
	getApiKey,
	getAuthorizedHosts,
	getBackendToken,
	getSafetyMode,
	getSettings,
	getTrajectory,
	parseFewShotExamples,
	removeLastFewShotPair,
	saveApiKey,
	saveBackendToken,
	saveSettings,
	setAuthorizedHosts,
	setSafetyMode,
} from "../storage";

describe("storage", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("storage 为空时 getSettings 返回完整默认对象", async () => {
		const s = await getSettings();
		expect(s.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
		expect(s.fieldMapping.title?.selector).toBe('input[name="title"]');
		expect(s.fieldMapping.body?.fieldType).toBe("quill");
		// 新增字段默认值
		expect(s.recommendedTags).toEqual([]);
		expect(s.fewShotPairs).toEqual([]);
	});

	it("旧 storage（无 recommendedTags/fewShotPairs）getSettings 回落默认值", async () => {
		// 模拟旧版 storage 没有这两个字段
		await storage.setItem("local:settings", {
			endpoint: "https://x.com",
			model: "gpt-4o",
		});
		const s = await getSettings();
		expect(s.recommendedTags).toEqual([]);
		expect(s.fewShotPairs).toEqual([]);
	});

	it("saveSettings 后 getSettings 取回同值", async () => {
		const next = {
			...DEFAULT_SETTINGS,
			endpoint: "https://api.example.com/v1/chat/completions",
			model: "gpt-4o",
		};
		await saveSettings(next);
		const got = await getSettings();
		expect(got.endpoint).toBe("https://api.example.com/v1/chat/completions");
		expect(got.model).toBe("gpt-4o");
	});

	it("部分设置与默认 fieldMapping 合并(缺省项回落)", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			fieldMapping: { title: { selector: "#custom-title", fieldType: "text" } },
		});
		const got = await getSettings();
		expect(got.fieldMapping.title?.selector).toBe("#custom-title");
		// 未覆盖的字段仍回落默认
		expect(got.fieldMapping.body?.selector).toBe("#editor");
	});

	it("getApiKey 未设置时返回空字符串而非崩溃", async () => {
		expect(await getApiKey()).toBe("");
	});

	it("saveApiKey 后能取回", async () => {
		await saveApiKey("sk-test-123");
		expect(await getApiKey()).toBe("sk-test-123");
	});

	describe("安全档位 + 授权名单", () => {
		it("档位缺省 → off(fail-closed)", async () => {
			expect(await getSafetyMode()).toBe("off");
		});

		it("set/get 档位往返", async () => {
			await setSafetyMode("authorized");
			expect(await getSafetyMode()).toBe("authorized");
		});

		it("坏档位值回落 off", async () => {
			await storage.setItem("local:safetyMode", "YOLO");
			expect(await getSafetyMode()).toBe("off");
		});

		it("名单从未设置 → 种子(含 admin 站)", async () => {
			expect(await getAuthorizedHosts()).toEqual(["dx-999-adm.ympxbys.xyz"]);
		});

		it("set/get 名单往返 + 过滤空串", async () => {
			await setAuthorizedHosts(["dx-999-adm.ympxbys.xyz", "", "  "]);
			expect(await getAuthorizedHosts()).toEqual(["dx-999-adm.ympxbys.xyz"]);
		});

		it("坏名单值(非数组)→ 空(fail-closed)", async () => {
			await storage.setItem("local:authorizedHosts", "dx-999-adm.ympxbys.xyz");
			expect(await getAuthorizedHosts()).toEqual([]);
		});
	});

	describe("轨迹追加 + 脱敏", () => {
		const rec = (id: string) => ({
			id,
			topic: "t",
			fields: [{ field: "title", status: "filled" as const }],
			status: "publish-confirmed",
			ts: "2026-06-04T00:00:00.000Z",
		});

		it("无轨迹 → 空数组", async () => {
			expect(await getTrajectory()).toEqual([]);
		});

		it("追加多条 → seq 递增持久化", async () => {
			await appendTrajectory(rec("a"));
			await appendTrajectory(rec("b"));
			const list = await getTrajectory();
			expect(list.map((r) => r.seq)).toEqual([1, 2]);
		});

		it("含机密快照 → snapshotDropped=true,record 仍落但无快照", async () => {
			const { snapshotDropped } = await appendTrajectory({
				...rec("a"),
				rawSnapshot: "<span>PHPSESSID=deadbeefdeadbeef</span>",
			});
			expect(snapshotDropped).toBe(true);
			const list = await getTrajectory();
			expect(list[0]?.snapshot).toBeUndefined();
		});

		it("clearTrajectory 后 → 空", async () => {
			await appendTrajectory(rec("a"));
			await clearTrajectory();
			expect(await getTrajectory()).toEqual([]);
		});
	});

	describe("backendToken", () => {
		it("未设置时返回空字符串", async () => {
			expect(await getBackendToken()).toBe("");
		});

		it("saveBackendToken 后能取回", async () => {
			await saveBackendToken("jwt-token-abc");
			expect(await getBackendToken()).toBe("jwt-token-abc");
		});
	});

	describe("addFewShotPair / removeLastFewShotPair", () => {
		it("addFewShotPair:首条追加成功 → ok:true,settings 存有 pair", async () => {
			const r = await addFewShotPair({ input: "Q1", output: "A1" });
			expect(r).toEqual({ ok: true });
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(1);
			expect(s.fewShotPairs?.[0]).toEqual({ input: "Q1", output: "A1" });
		});

		it("addFewShotPair:已有 8 条 → ok:false, reason:full,不写入", async () => {
			for (let i = 0; i < 8; i++) {
				await addFewShotPair({ input: `i${i}`, output: `o${i}` });
			}
			const r = await addFewShotPair({ input: "overflow", output: "x" });
			expect(r).toEqual({ ok: false, reason: "full" });
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(8);
		});

		it("addFewShotPair:多条时 fewShotPairs 正确储存", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await addFewShotPair({ input: "Q2", output: "A2" });
			const s = await getSettings();
			expect(s.fewShotPairs).toEqual([
				{ input: "Q1", output: "A1" },
				{ input: "Q2", output: "A2" },
			]);
		});

		it("removeLastFewShotPair:移除末尾一条", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await addFewShotPair({ input: "Q2", output: "A2" });
			await removeLastFewShotPair();
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(1);
			expect(s.fewShotPairs?.[0]).toEqual({ input: "Q1", output: "A1" });
		});

		it("removeLastFewShotPair:最后一条移除后 fewShotPairs 为空", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await removeLastFewShotPair();
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(0);
		});

		it("removeLastFewShotPair:空列表时幂等,不报错", async () => {
			await expect(removeLastFewShotPair()).resolves.toBeUndefined();
			const s = await getSettings();
			expect(s.fewShotPairs ?? []).toHaveLength(0);
		});
	});

	describe("parseFewShotExamples / deriveFewShotExamples", () => {
		it("happy path: 單條帶分隔符 → [{input, output}]", () => {
			expect(parseFewShotExamples("A\n---\nB")).toEqual([
				{ input: "A", output: "B" },
			]);
		});

		it("happy path: 兩條以 \\n\\n 分隔 → 兩個 pair", () => {
			expect(parseFewShotExamples("A\n---\nB\n\nC\n---\nD")).toEqual([
				{ input: "A", output: "B" },
				{ input: "C", output: "D" },
			]);
		});

		it("edge case: 無分隔符的 block → {input: '', output: block}", () => {
			expect(parseFewShotExamples("no separator here")).toEqual([
				{ input: "", output: "no separator here" },
			]);
		});

		it("edge case: 空字串 → []", () => {
			expect(parseFewShotExamples("")).toEqual([]);
		});

		it("edge case: 只有空白行 → []", () => {
			expect(parseFewShotExamples("\n\n\n")).toEqual([]);
		});

		it("round-trip: derive → parse 還原相同 pairs", () => {
			const pairs = [
				{ input: "Q1", output: "A1" },
				{ input: "Q2", output: "A2" },
			];
			expect(parseFewShotExamples(deriveFewShotExamples(pairs))).toEqual(pairs);
		});
	});
});
