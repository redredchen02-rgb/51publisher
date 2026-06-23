import type { ContentDraft, Settings } from "@51publisher/shared";
import { vi } from "vitest";
import type { BackgroundHandlerDeps } from "../../entrypoints/background";
import type { Batch } from "../../lib/batch";
import type { FirstFlightMarker, FirstFlightRead } from "../../lib/storage";

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

export function makeBatch(
	status: "awaiting-approval" | "error" = "awaiting-approval",
): Batch {
	return {
		id: "batch_1",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		items: [
			{
				id: "item_0",
				topic: "topic-a",
				status,
				draft: DRAFT,
				assembledDraftSnapshot: DRAFT,
			},
		],
	};
}

export function makeDeps(
	overrides: Partial<BackgroundHandlerDeps> = {},
): BackgroundHandlerDeps {
	return {
		getBatch: vi.fn(async () => null),
		saveBatch: vi.fn(async () => {}),
		getSettings: vi.fn(async () => SETTINGS),
		getApiKey: vi.fn(async () => "test-key"),
		getPublishedTopics: vi.fn(async () => []),
		addPublishedTopics: vi.fn(async () => {}),
		appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
		getSafetyMode: vi.fn(async () => "authorized" as const),
		setSafetyMode: vi.fn(async () => {}),
		getAuthorizedHosts: vi.fn(async () => [HOST]),
		getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
		writeFirstFlight: vi.fn(async () => true),
		clearFirstFlight: vi.fn(async () => {}),
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
		buildBatchId: vi.fn(() => "batch_1"),
		buildItemId: vi.fn((_batchId: string, i: number) => `item_${i}`),
		now: vi.fn(() => "2026-06-04T00:00:00.000Z"),
		...overrides,
	};
}

export function makeFFStore(initial: FirstFlightRead = { state: "absent" }) {
	let cur: FirstFlightRead = initial;
	return {
		getFirstFlight: vi.fn(async () => cur),
		writeFirstFlight: vi.fn(async (m: FirstFlightMarker) => {
			cur = { state: "ok", marker: m };
			return true;
		}),
		clearFirstFlight: vi.fn(async () => {
			cur = { state: "absent" };
		}),
		peek: () => cur,
	};
}

export function makeModeStore(
	initial: "off" | "dry-run" | "authorized" = "dry-run",
) {
	let mode = initial;
	return {
		getSafetyMode: vi.fn(async () => mode),
		setSafetyMode: vi.fn(async (m: "off" | "dry-run" | "authorized") => {
			mode = m;
		}),
		peek: () => mode,
	};
}
