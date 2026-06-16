import type { FewShotPair, FieldMapping } from "@51publisher/shared";
import { isValidFieldMapping, VALID_FIELD_TYPES } from "@51publisher/shared";
import { useEffect, useState } from "react";
import {
	DEFAULT_SETTINGS,
	deriveFewShotExamples,
	getApiKey,
	getBackendToken,
	getSettings,
	saveApiKey,
	saveBackendToken,
	saveSettings,
} from "../../lib/storage";
import styles from "./Settings.module.css";
import { BackendSettingsCard } from "./settings/BackendSettingsCard";
import { LLMSettingsCard } from "./settings/LLMSettingsCard";
import { PromptCard } from "./settings/PromptCard";
import { PromptManagementCard } from "./settings/PromptManagementCard";
import { TagsAndReviewCard } from "./settings/TagsAndReviewCard";

const MAX_PAIRS = 8;

export function parseTagsText(text: string): string[] {
	return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function validateMapping(text: string): string | null {
	let parsed: unknown;
	try { parsed = JSON.parse(text); } catch (e) { return `JSON 格式错误:${(e as Error).message}`; }
	if (!isValidFieldMapping(parsed)) {
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "字段映射必须是一个对象。";
		for (const [key, def] of Object.entries(parsed as Record<string, unknown>)) {
			if (!def || typeof def !== "object") return `字段 ${key} 必须是对象。`;
			const d = def as Record<string, unknown>;
			if (typeof d.selector !== "string" || !d.selector) return `字段 ${key} 缺少有效的 selector。`;
			if (typeof d.fieldType !== "string" || !(VALID_FIELD_TYPES as readonly string[]).includes(d.fieldType))
				return `字段 ${key} 的 fieldType 非法(应为:${VALID_FIELD_TYPES.join(" / ")})。`;
		}
		return "字段映射校验失败。";
	}
	return null;
}

export function Settings({ onClose }: { onClose: () => void }) {
	const [endpoint, setEndpoint] = useState("");
	const [model, setModel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [promptTemplate, setPromptTemplate] = useState("");
	const [fewShotExamples, setFewShotExamples] = useState("");
	const [tagsText, setTagsText] = useState("");
	const [mappingText, setMappingText] = useState("");
	const [fallbackModel, setFallbackModel] = useState("");
	const [fallbackOpen, setFallbackOpen] = useState(false);
	const [backendUrl, setBackendUrl] = useState("");
	const [backendToken, setBackendToken] = useState("");
	const [fewShotPairs, setFewShotPairs] = useState<FewShotPair[]>([]);
	const [reviewCriteriaPrompt, setReviewCriteriaPrompt] = useState("");
	const [dailyBatchSize, setDailyBatchSize] = useState("5");
	const [importBanner, setImportBanner] = useState("");
	const [importTruncated, setImportTruncated] = useState("");
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		void (async () => {
			const [s, key, bToken] = await Promise.all([getSettings(), getApiKey(), getBackendToken()]);
			setEndpoint(s.endpoint);
			setModel(s.model);
			setPromptTemplate(s.promptTemplate);
			setFewShotExamples(s.fewShotExamples ?? "");
			setTagsText((s.recommendedTags ?? []).join("\n"));
			setMappingText(JSON.stringify(s.fieldMapping, null, 2));
			setApiKey(key);
			setBackendUrl(s.backendUrl ?? "");
			setBackendToken(bToken);
			setReviewCriteriaPrompt(s.reviewCriteriaPrompt ?? "");
			setDailyBatchSize(String(s.dailyBatchSize ?? 5));
			if (s.fallbackModel) { setFallbackModel(s.fallbackModel); setFallbackOpen(true); }
			const pairs = s.fewShotPairs ?? [];
			setFewShotPairs(pairs);
			if (s.fewShotExamples && pairs.length === 0) setImportBanner("检测到旧格式范例，点击导入→结构化编辑器");
		})();
	}, []);

	async function handleImport() {
		const s = await getSettings();
		const raw = s.fewShotExamples ?? "";
		const blocks = raw.split(/\n\n+/).filter(Boolean);
		const truncated = blocks.length > MAX_PAIRS;
		const taken = blocks.slice(0, MAX_PAIRS).map((b) => {
			const sep = b.indexOf("\n---\n");
			return sep !== -1 ? { input: b.slice(0, sep), output: b.slice(sep + 5) } : { input: "", output: b };
		});
		setFewShotPairs(taken);
		setImportBanner("");
		setImportTruncated(truncated ? `检测到 ${blocks.length} 块，已截取前 ${MAX_PAIRS} 条，请检查并补全 input 字段` : "");
	}

	async function handleSave() {
		setSaved(false);
		if (endpoint && !/^https:\/\//i.test(endpoint)) { setError("endpoint 必须是 https:// 地址(API key 会发往此处)。"); return; }
		const mapErr = validateMapping(mappingText);
		if (mapErr) { setError(mapErr); return; }
		if (backendUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(backendUrl)) {
			setError("后端 URL 必须是 localhost 或 127.0.0.1 地址（例：http://localhost:3001）。"); return;
		}
		if (backendUrl?.startsWith("http://")) console.warn("[Settings] 后端 URL 使用 HTTP，JWT 以明文传输。建议仅在本地开发时使用。");
		setError("");
		const existing = await getSettings();
		const fewShotExamplesResolved = fewShotPairs.length > 0 ? deriveFewShotExamples(fewShotPairs) : undefined;
		let fieldMappingParsed: FieldMapping;
		try { fieldMappingParsed = JSON.parse(mappingText) as FieldMapping; } catch { setError("字段映射 JSON 解析失败。"); return; }
		await saveSettings({
			...existing, endpoint, model, promptTemplate,
			fewShotExamples: fewShotExamplesResolved, fewShotPairs,
			recommendedTags: parseTagsText(tagsText),
			fieldMapping: fieldMappingParsed,
			fallbackModel: fallbackModel || undefined,
			backendUrl: backendUrl || undefined,
			reviewCriteriaPrompt: reviewCriteriaPrompt || undefined,
			dailyBatchSize: Number.parseInt(dailyBatchSize, 10) || undefined,
		});
		await saveApiKey(apiKey);
		await saveBackendToken(backendToken);
		setSaved(true);
	}

	return (
		<div className="fade-in">
			<button type="button" onClick={onClose} className={`btn btn-plain ${styles.backBtn}`}>← 返回</button>
			<h2 className={styles.heading}>设置</h2>
			<p className={`field-hint ${styles.intro}`}>⚙️ 大模型 endpoint 与 API Key 已在后端服务 .env 中配置，扩展不直接管理。</p>

			<LLMSettingsCard endpoint={endpoint} model={model} apiKey={apiKey} fallbackModel={fallbackModel} fallbackOpen={fallbackOpen} setEndpoint={setEndpoint} setModel={setModel} setApiKey={setApiKey} setFallbackModel={setFallbackModel} setFallbackOpen={setFallbackOpen} />
			<BackendSettingsCard backendUrl={backendUrl} backendToken={backendToken} dailyBatchSize={dailyBatchSize} setBackendUrl={setBackendUrl} setBackendToken={setBackendToken} setDailyBatchSize={setDailyBatchSize} />
			<PromptCard promptTemplate={promptTemplate} fewShotExamples={fewShotExamples} fewShotPairs={fewShotPairs} importBanner={importBanner} importTruncated={importTruncated} setPromptTemplate={setPromptTemplate} setFewShotExamples={setFewShotExamples} setFewShotPairs={setFewShotPairs} onImport={() => void handleImport()} />
			<TagsAndReviewCard tagsText={tagsText} reviewCriteriaPrompt={reviewCriteriaPrompt} setTagsText={setTagsText} setReviewCriteriaPrompt={setReviewCriteriaPrompt} />
			<hr className="divider" />
			<PromptManagementCard promptTemplate={promptTemplate} fewShotPairs={fewShotPairs} fewShotExamples={fewShotExamples} mappingText={mappingText} setMappingText={setMappingText} onSelectPrompt={(t, ex) => { setPromptTemplate(t); setFewShotExamples(ex); }} />

			{error && <p role="alert" className="text-error text-sm">{error}</p>}
			{saved && <p className="text-success text-sm">已保存。</p>}
			<button type="button" onClick={() => void handleSave()} className={`btn btn-primary ${styles.saveBtn}`}>保存</button>
		</div>
	);
}
