import type {
	ContentDraft,
	FillPageResponse,
	GenerateDraftResponse,
	RuntimeMessage,
} from "@51guapi/shared";
import { applyPromptTemplate, type FactsBlock } from "@51guapi/shared";
import { browser } from "#imports";
import type { DriftReport } from "./content/selectors";
import { DEFAULT_RECIPE } from "./core/recipe";

// MV3 Service Worker 随时可能被回收。sendMessage 若 SW 死亡可能永久 pending。
// sendMsg 包一层 race，超时则 reject → withBusy catch 显示"请重试"而非卡死。
const SW_TIMEOUT: Partial<Record<RuntimeMessage["type"], number>> = {
	GENERATE_DRAFT: 30_000,
};

function sendMsg<T>(msg: RuntimeMessage): Promise<T> {
	const ms = SW_TIMEOUT[msg.type] ?? 30_000;
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						`[sw/${msg.type}] 未在 ${ms / 1000}s 内响应，SW 可能已回收，请重试`,
					),
				),
			ms,
		);
		(browser.runtime.sendMessage(msg) as Promise<T>).then(
			(result) => {
				clearTimeout(timer);
				resolve(result);
			},
			(err: unknown) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/** side panel → background:生成草稿。 */
export async function requestGenerate(
	prompt: string,
): Promise<GenerateDraftResponse> {
	return sendMsg<GenerateDraftResponse>({ type: "GENERATE_DRAFT", prompt });
}

/**
 * 纯函数:从 tab 列表挑出后台发帖页 tab id。
 * 优先当前活动 tab(若它就是后台页);否则取任一 host 匹配的后台页 tab。
 */
export function pickAdminTabId(
	activeTab: { id?: number; url?: string } | undefined,
	hostMatchedTabs: ReadonlyArray<{ id?: number }>,
	host: string,
): number | null {
	if (activeTab?.id != null && activeTab.url?.includes(host))
		return activeTab.id;
	const withId = hostMatchedTabs.find((t) => typeof t.id === "number");
	return withId?.id ?? null;
}

/** 解析后台发帖页所在 tab id(优先活动 tab,否则按 host 在所有窗口里找)。 */
export async function resolveAdminTabId(): Promise<number | null> {
	const host = DEFAULT_RECIPE.host;
	const [active] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	const matched = await browser.tabs.query({ url: `https://${host}/*` });
	return pickAdminTabId(active, matched, host);
}

/** side panel → 后台发帖页 content script:填充。自动定位发帖页 tab。 */
export async function requestFill(
	draft: ContentDraft,
): Promise<FillPageResponse> {
	const tabId = await resolveAdminTabId();
	if (tabId == null) {
		return {
			ok: false,
			error: "未找到目標頁面標籤——請先在瀏覽器打開後台頁面。",
		};
	}
	try {
		return await browser.tabs.sendMessage(tabId, { type: "FILL_PAGE", draft });
	} catch {
		return {
			ok: false,
			error:
				"无法连接页面填充脚本——请在发帖页打开「添加」表单;若刚重载过扩展,请按 F5 刷新该页。",
		};
	}
}

/** 輕量漂移自檢:讓釘住 tab 的 content 查關鍵選擇器是否缺失。 */
export async function checkSelectors(tabId: number): Promise<DriftReport> {
	try {
		return await browser.tabs.sendMessage(tabId, { type: "CHECK_SELECTORS" });
	} catch {
		return { ok: false, missing: ["(無法連接頁面——請確認停在 admin 發帖頁)"] };
	}
}

/**
 * 用 prompt 模板 + 主題 + (可選)事實 + (可選)few-shot 組裝最終 prompt。
 * 委託 lib/facts 的純函數;facts/fewShot 省略時行為等同舊兩參版(向後兼容)。
 */
export function buildPrompt(
	template: string,
	topic: string,
	facts?: FactsBlock,
	fewShot?: string,
): string {
	return applyPromptTemplate(template, topic, facts, fewShot);
}
