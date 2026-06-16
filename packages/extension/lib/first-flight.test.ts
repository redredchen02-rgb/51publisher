import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import {
	canonicalizeDraft,
	type DispatchCtx,
	evaluateInterlock,
	hashDraft,
} from "./first-flight";
import type { FirstFlightPending } from "./storage";

const DRAFT: ContentDraft = {
	id: "item_0",
	title: "T",
	subtitle: "S",
	category: "2",
	coverImageUrl: "",
	body: "<p>b</p>",
	tags: ["x", "y"],
	description: "d",
	postStatus: "0",
	publishedAt: "2026-06-15",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-15T00:00:00.000Z",
};

function pending(over: Partial<FirstFlightPending> = {}): FirstFlightPending {
	return {
		itemId: "item_0",
		tabId: 7,
		host: "dx-999-adm.ympxbys.xyz",
		contentHash: "HASH",
		nonce: "NONCE",
		ts: "2026-06-15T00:00:00.000Z",
		...over,
	};
}

function dispatch(over: Partial<DispatchCtx> = {}): DispatchCtx {
	return {
		itemId: "item_0",
		tabId: 7,
		host: "dx-999-adm.ympxbys.xyz",
		draft: DRAFT,
		...over,
	};
}

describe("canonicalizeDraft / hashDraft", () => {
	it("字段顺序无关:键插入顺序不同 → 同一 hash", async () => {
		// 用不同的对象键插入顺序重建同一份草稿。
		const reordered: ContentDraft = {
			tags: DRAFT.tags,
			body: DRAFT.body,
			title: DRAFT.title,
			id: DRAFT.id,
			subtitle: DRAFT.subtitle,
			category: DRAFT.category,
			coverImageUrl: DRAFT.coverImageUrl,
			description: DRAFT.description,
			postStatus: DRAFT.postStatus,
			publishedAt: DRAFT.publishedAt,
			mediaId: DRAFT.mediaId,
			status: DRAFT.status,
			createdAt: DRAFT.createdAt,
		};
		expect(await hashDraft(reordered)).toBe(await hashDraft(DRAFT));
	});

	it("内容变更 → hash 变", async () => {
		const h1 = await hashDraft(DRAFT);
		const h2 = await hashDraft({ ...DRAFT, body: "<p>tampered</p>" });
		expect(h1).not.toBe(h2);
	});

	it("canonicalize 稳定可复算", () => {
		expect(canonicalizeDraft(DRAFT)).toBe(canonicalizeDraft({ ...DRAFT }));
	});
});

describe("evaluateInterlock", () => {
	it("无 pending → allowed(走正常路径)", () => {
		expect(
			evaluateInterlock({
				pending: null,
				liveNonce: null,
				dispatch: dispatch(),
				dispatchHash: "HASH",
			}).allowed,
		).toBe(true);
	});

	it("全等 + nonce 匹配 → allowed", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: "NONCE",
			dispatch: dispatch(),
			dispatchHash: "HASH",
		});
		expect(v.allowed).toBe(true);
	});

	it("itemId 不符 → block(无 needReset)", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: "NONCE",
			dispatch: dispatch({ itemId: "item_1" }),
			dispatchHash: "HASH",
		});
		expect(v.allowed).toBe(false);
		expect(v.needReset).toBeFalsy();
	});

	it("host 不符(即使都授权)→ block + needReset", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: "NONCE",
			dispatch: dispatch({ host: "other.ympxbys.xyz" }),
			dispatchHash: "HASH",
		});
		expect(v.allowed).toBe(false);
		expect(v.needReset).toBe(true);
	});

	it("contentHash 不符 → block + needReset", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: "NONCE",
			dispatch: dispatch(),
			dispatchHash: "DIFFERENT",
		});
		expect(v.allowed).toBe(false);
		expect(v.needReset).toBe(true);
	});

	it("liveNonce 缺失(SW 重启)→ block + needReset", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: null,
			dispatch: dispatch(),
			dispatchHash: "HASH",
		});
		expect(v.allowed).toBe(false);
		expect(v.needReset).toBe(true);
	});

	it("liveNonce 不符(伪造)→ block + needReset", () => {
		const v = evaluateInterlock({
			pending: pending(),
			liveNonce: "FORGED",
			dispatch: dispatch(),
			dispatchHash: "HASH",
		});
		expect(v.allowed).toBe(false);
		expect(v.needReset).toBe(true);
	});
});
