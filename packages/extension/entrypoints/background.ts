import type { RuntimeMessage } from "@51guapi/shared";
import {
	type BackgroundHandlerDeps as _BHD,
	createHandlers,
	generateDraft,
} from "../lib/bg-handlers";

export { createHandlers };

import { runStartupGeneratingRecovery } from "../lib/bg-startup";
import { logger } from "../lib/logger";

// Background service worker: 調 LLM 生成呱稿。
// - 路由 GENERATE_DRAFT → 調大模型(鑑權 + CORS 集中在此;key 絕不進 content)

// Re-exports for backward-compat (background-generate.test.ts imports these from background).
export type BackgroundHandlerDeps = _BHD;
export { buildConstraintSuffix, generateDraft } from "../lib/bg-handlers";

export default defineBackground(() => {
	browser.sidePanel
		?.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) =>
			logger.error("bg", "setPanelBehavior 失敗", {
				err: err instanceof Error ? err.message : String(err),
			}),
		);

	// SW 啟動恢復:將上次 SW 被殺時卡在 generating 狀態的條目標記為 error,讓操作者可以重試。
	void runStartupGeneratingRecovery();

	// SW Keep-Alive 機制:定時喚醒，防止背景因閒置被殺。
	if (browser.alarms) {
		browser.alarms.create("keep-alive", { periodInMinutes: 1 });
		browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
			if (alarm.name === "keep-alive") {
				logger.debug("bg", "keep-alive ping");
			}
		});
	} else {
		logger.warn("bg", "chrome.alarms 不可用(缺 alarms 權限?),跳過 keep-alive");
	}

	const liveDeps: BackgroundHandlerDeps = {
		getSettings: () => import("../lib/storage").then((m) => m.getSettings()),
		getApiKey: () => import("../lib/storage").then((m) => m.getApiKey()),
		tabsGet: (id) => browser.tabs.get(id),
		tabsSendMessage: (id, msg) => browser.tabs.sendMessage(id, msg),
		storageGetItem: (key) =>
			import("#imports").then(({ storage }) => storage.getItem(key)),
		storageSetItem: (key, val) =>
			import("#imports").then(({ storage }) => storage.setItem(key, val)),
		generateDraftFn: generateDraft,
	};

	const handlers = createHandlers(liveDeps);

	browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
		if (message?.type === "GENERATE_DRAFT")
			return handlers.handleGenerate(message.prompt);
		return undefined;
	});
});
