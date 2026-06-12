// @vitest-environment jsdom
// U3 安全档位矩阵:真 canSubmit(闸门)+ orchestratePublish(派发)+ executePublish(content 触发)
// 三者集成,断言"仅 (host∈名单, authorized) 才真正 POST 到 save 端点"。
//
// 验证边界(写清,免误读):
//   - 此 e2e 证"无准许→content 无触发""off/dry-run/host 不符→零提交";
//   - "host 来自浏览器、防伪造 host"靠 background chrome.tabs.get + 人工 admin 冒烟兜,jsdom 证不了。

import type { SafetyMode } from "@51publisher/shared";
import { afterEach, describe, expect, it } from "vitest";
import { executePublish } from "../../lib/publish";
import { orchestratePublish } from "../../lib/publish-orchestrator";
import { canSubmit } from "../../lib/safety-gate";
import { installFetchSubmitSpy } from "./helpers/authorized-submit";

const AUTHORIZED = ["dx-999-adm.ympxbys.xyz"];
const SAVE = "/admin/webarticle/save";

function mountPublishForm(): void {
	document.body.innerHTML = `
    <form lay-filter="form-save">
      <input name="media_id" value="1" />
      <input name="title" value="标题" />
      <input type="hidden" name="html_content" value="" />
      <button lay-submit lay-filter="save">保存</button>
    </form>
    <div id="editor"><div class="ql-editor"><p>正文</p></div></div>
  `;
}

/** 跑一遍完整链路,返回到 save 端点的 POST 次数。 */
async function runGate(
	mode: SafetyMode,
	host: string,
	hosts: string[] = AUTHORIZED,
): Promise<number> {
	mountPublishForm();
	const spy = installFetchSubmitSpy();
	try {
		await orchestratePublish({
			evaluateGate: async () => ({
				mode,
				allowed: canSubmit({ host, mode, authorizedHosts: hosts }),
				host,
			}),
			isAlreadyDispatched: async () => false,
			writeDispatched: async () => {},
			// sendGrant == content 收到准许后执行(用 spy 的 fetch)。
			sendGrant: () => executePublish({ saveEndpoint: SAVE }),
			writeConfirmed: async () => {},
		});
		return spy.submitCount();
	} finally {
		spy.restore();
	}
}

describe("U3 授权矩阵", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("(host∈名单, authorized) → 提交=1", async () => {
		expect(await runGate("authorized", "dx-999-adm.ympxbys.xyz")).toBe(1);
	});

	it("(host∈名单, dry-run) → 提交=0(不发准许)", async () => {
		expect(await runGate("dry-run", "dx-999-adm.ympxbys.xyz")).toBe(0);
	});

	it("(host∉名单, authorized) → 提交=0", async () => {
		expect(await runGate("authorized", "evil.com")).toBe(0);
	});

	it("(off, host∈名单) → 提交=0", async () => {
		expect(await runGate("off", "dx-999-adm.ympxbys.xyz")).toBe(0);
	});

	it("防假绿:伪装相似 host(aympxbys.xyz / 裸 apex / 尾接攻击域)→ 提交=0", async () => {
		for (const host of [
			"aympxbys.xyz",
			"ympxbys.xyz",
			"dx-999-adm.ympxbys.xyz.evil.com",
		]) {
			expect(await runGate("authorized", host), host).toBe(0);
		}
	});

	it("名单空 → 提交=0", async () => {
		expect(await runGate("authorized", "dx-999-adm.ympxbys.xyz", [])).toBe(0);
	});
});
