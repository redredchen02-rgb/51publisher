import type { ContentDraft, Settings } from "@51guapi/shared";
import { vi } from "vitest";
import type { BackgroundHandlerDeps } from "../../entrypoints/background";

export const HOST = "dx-999-adm.ympxbys.xyz";

export const SETTINGS: Settings = {
	endpoint: "https://api.example.com",
	model: "gpt-4o-mini",
	promptTemplate: "Write about {{topic}}",
	fieldMapping: {},
};

export const DRAFT: ContentDraft = {
	id: "item_0",
	title: "T",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>body</p>",
	tags: [],
	description: "",
	postStatus: "0",
	publishedAt: "2026-06-04",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-04T00:00:00.000Z",
};

export function makeDeps(
	overrides: Partial<BackgroundHandlerDeps> = {},
): BackgroundHandlerDeps {
	return {
		getSettings: vi.fn(async () => SETTINGS),
		getApiKey: vi.fn(async () => "test-key"),
		tabsGet: vi.fn(
			async () =>
				({ url: `https://${HOST}/admin`, id: 1 }) as {
					url?: string;
					id?: number;
				},
		),
		tabsSendMessage: vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: `https://${HOST}/post/1`,
		})),
		storageGetItem: vi.fn(async () => null),
		storageSetItem: vi.fn(async () => {}),
		generateDraftFn: vi.fn(async () => ({ ok: true as const, draft: DRAFT })),
		...overrides,
	};
}
