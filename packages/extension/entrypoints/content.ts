import type {
	ContentDraft,
	FillPageResponse,
	PublishResult,
	RuntimeMessage,
} from "@51publisher/shared";
import { bodyResultFromOutcome, requestBodyFill } from "../lib/body-bridge";
import { fillDraft } from "../lib/fillers";
import { resolveFormFrame } from "../lib/frame-resolve";
import { executePublish } from "../lib/publish";
import { sanitizeBody } from "../lib/sanitize";
import { checkSelectorDrift, type DriftReport } from "../lib/selectors";
import { logger } from "../lib/logger";
import { getSettings } from "../lib/storage";

// 隔离世界 content script:接收 side panel 的 FILL_PAGE 填充;接收 background 的
// PUBLISH_GRANT 一次性"准许"才触发提交。**content 绝不自我授权**——无 grant 即从不提交。
export default defineContentScript({
	// 注入面=闸门面:收窄到授权 admin 子域 + https(与 quill-bridge / host_permissions 同步)。
	matches: ["https://dx-999-adm.ympxbys.xyz/*"],
	main() {
		browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
			if (message?.type === "FILL_PAGE") {
				return handleFill(message.draft);
			}
			if (message?.type === "PUBLISH_GRANT") {
				return handlePublishGrant();
			}
			if (message?.type === "CHECK_SELECTORS") {
				return handleCheckSelectors();
			}
			return undefined;
		});
	},
});

// 仅在收到 background 准许后调用;闸门判定全在 background,content 不读配置、不判 host。
async function handlePublishGrant(): Promise<PublishResult> {
	try {
		// 表单可能在同源 iframe(layuiAdmin):解析到表单所在 frame 再序列化发布。
		const { fieldMapping } = await getSettings();
		const { doc: formDoc } = resolveFormFrame(document, fieldMapping, window);
		return await executePublish({ doc: formDoc });
	} catch (err) {
		logger.error("content", "发布触发失败", { err: err instanceof Error ? err.message : String(err) });
		return { ok: false, dryRun: false, error: "internal" };
	}
}

async function handleCheckSelectors(): Promise<DriftReport> {
	const { fieldMapping } = await getSettings();
	const { doc: formDoc } = resolveFormFrame(document, fieldMapping, window);
	return checkSelectorDrift(formDoc, fieldMapping);
}

async function handleFill(draft: ContentDraft): Promise<FillPageResponse> {
	try {
		const { fieldMapping } = await getSettings();
		// 表单可能在同源 iframe(layuiAdmin 内容区)→ 先解析表单所在 frame,顶层无则下钻。
		const { doc: formDoc } = resolveFormFrame(document, fieldMapping, window);
		// 普通字段(标题/副标题/分类/标签/描述/状态/时间/作品id)。
		const results = fillDraft(draft, fieldMapping, formDoc);

		// 正文:消毒后交主世界桥写入 Quill;三态映射抽到 bodyResultFromOutcome(可单测)。
		// 主世界 responder 自行解析编辑器所在 frame(隔离/主世界各自下钻,见 body-responder)。
		const bodyDef = fieldMapping.body;
		if (bodyDef && bodyDef.fieldType === "quill" && draft.body) {
			const outcome = await requestBodyFill(
				sanitizeBody(draft.body),
				bodyDef.selector,
			);
			results.push(bodyResultFromOutcome(outcome));
		}

		return { ok: true, results };
	} catch (err) {
		logger.error("content", "填充失败", { err: err instanceof Error ? err.message : String(err) });
		return { ok: false, error: "填充时发生错误,请重试。" };
	}
}
