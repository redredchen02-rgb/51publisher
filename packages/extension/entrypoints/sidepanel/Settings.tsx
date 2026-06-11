import type { FewShotPair, FieldMapping, FieldType } from "@51publisher/shared";
import { useCallback, useEffect, useState } from "react";
import {
	createPrompt,
	fetchPrompts,
	type PromptTemplate,
} from "../../lib/prompt-client";
import {
	DEFAULT_SETTINGS,
	getApiKey,
	getBackendToken,
	getSettings,
	saveApiKey,
	saveBackendToken,
	saveSettings,
} from "../../lib/storage";
import { FewShotPairEditor } from "./components/FewShotPairEditor";

const MAX_PAIRS = 8;

/** 从 fewShotPairs 派生 fewShotExamples 字符串(每条 input\n---\noutput，条间 \n\n 分隔)。 */
export function deriveFewShotExamples(pairs: FewShotPair[]): string {
	return pairs.map((p) => `${p.input}\n---\n${p.output}`).join("\n\n");
}

const FIELD_TYPES: FieldType[] = [
	"text",
	"textarea",
	"quill",
	"native-select",
	"checkbox-multi",
	"date",
	"custom-dropdown",
	"tag-input",
];
const inputStyle: React.CSSProperties = {
	width: "100%",
	boxSizing: "border-box",
	padding: "4px 6px",
	fontSize: 13,
	border: "1px solid #d9d9d9",
	borderRadius: 4,
};
const labelStyle: React.CSSProperties = {
	fontSize: 12,
	fontWeight: 600,
	color: "#555",
	display: "block",
	margin: "8px 0 2px",
};

/** 将多行/逗号分隔标签文本解析为去重去空字符串数组。 */
export function parseTagsText(text: string): string[] {
	return text
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** 校验字段映射 JSON:必须是对象,每条含 selector 字符串与合法 fieldType。返回错误信息或 null。 */
export function validateMapping(text: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		return `JSON 格式错误:${(e as Error).message}`;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return "字段映射必须是一个对象。";
	for (const [key, def] of Object.entries(parsed as Record<string, unknown>)) {
		if (!def || typeof def !== "object") return `字段 ${key} 必须是对象。`;
		const d = def as Record<string, unknown>;
		if (typeof d.selector !== "string" || !d.selector)
			return `字段 ${key} 缺少有效的 selector。`;
		if (
			typeof d.fieldType !== "string" ||
			!FIELD_TYPES.includes(d.fieldType as FieldType)
		) {
			return `字段 ${key} 的 fieldType 非法(应为:${FIELD_TYPES.join(" / ")})。`;
		}
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
	// Fallback LLM (P2): fallbackModel stored as model-name string per shared Settings schema;
	// fallbackEndpoint is UI-only (no dedicated field in Settings — stored in endpoint of Settings
	// if needed; for now kept local for display only).
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
	const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
	const [selectedPromptId, setSelectedPromptId] = useState("");
	const [promptStatus, setPromptStatus] = useState("");

	useEffect(() => {
		void (async () => {
			const [s, key, bToken] = await Promise.all([
				getSettings(),
				getApiKey(),
				getBackendToken(),
			]);
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
			if (s.fallbackModel) {
				setFallbackModel(s.fallbackModel);
				setFallbackOpen(true);
			}
			const pairs = s.fewShotPairs ?? [];
			setFewShotPairs(pairs);
			if (s.fewShotExamples && pairs.length === 0) {
				setImportBanner("检测到旧格式范例，点击导入→结构化编辑器");
			}
		})();
	}, []);

	async function handleImport() {
		const s = await getSettings();
		const raw = s.fewShotExamples ?? "";
		const blocks = raw.split(/\n\n+/).filter(Boolean);
		const truncated = blocks.length > MAX_PAIRS;
		const taken = blocks.slice(0, MAX_PAIRS).map((b) => {
			const sep = b.indexOf("\n---\n");
			return sep !== -1
				? { input: b.slice(0, sep), output: b.slice(sep + 5) }
				: { input: "", output: b };
		});
		setFewShotPairs(taken);
		setImportBanner("");
		if (truncated)
			setImportTruncated(
				`检测到 ${blocks.length} 块，已截取前 ${MAX_PAIRS} 条，请检查并补全 input 字段`,
			);
		else setImportTruncated("");
	}

	const handleLoadPrompts = useCallback(async () => {
		setPromptStatus("加载中...");
		const result = await fetchPrompts();
		if (result.ok && result.prompts) {
			setPrompts(result.prompts);
			setPromptStatus(`已加载 ${result.prompts.length} 个模板`);
		} else {
			setPromptStatus(`加载失败: ${result.error ?? "后端不可达"}`);
		}
	}, []);

	const handleSelectPrompt = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const id = e.target.value;
			setSelectedPromptId(id);
			if (!id) return;
			const t = prompts.find((p) => p.id === id);
			if (t) {
				setPromptTemplate(t.template);
				setFewShotExamples(t.fewShotExamples);
			}
		},
		[prompts],
	);

	const handleSaveToBackend = useCallback(async () => {
		const name = window.prompt("命名此模板:");
		if (!name) return;
		setPromptStatus("保存中...");
		const result = await createPrompt({
			name,
			template: promptTemplate,
			fewShotExamples,
		});
		if (result.ok) {
			setPromptStatus(`模板 "${name}" 已保存到后端`);
			void handleLoadPrompts();
		} else {
			setPromptStatus(`保存失败: ${result.error ?? "后端不可达"}`);
		}
	}, [promptTemplate, fewShotExamples, handleLoadPrompts]);

	async function handleSave() {
		setSaved(false);
		if (endpoint && !/^https:\/\//i.test(endpoint)) {
			setError("endpoint 必须是 https:// 地址(API key 会发往此处)。");
			return;
		}
		const mapErr = validateMapping(mappingText);
		if (mapErr) {
			setError(mapErr);
			return;
		}
		if (
			backendUrl &&
			!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(backendUrl)
		) {
			setError(
				"后端 URL 必须是 localhost 或 127.0.0.1 地址（例：http://localhost:3001）。",
			);
			return;
		}
		setError("");
		const existing = await getSettings();
		const fewShotExamplesResolved =
			fewShotPairs.length > 0
				? deriveFewShotExamples(fewShotPairs)
				: fewShotExamples;
		await saveSettings({
			...existing,
			endpoint,
			model,
			promptTemplate,
			fewShotExamples: fewShotExamplesResolved,
			fewShotPairs,
			recommendedTags: parseTagsText(tagsText),
			fieldMapping: JSON.parse(mappingText) as FieldMapping,
			fallbackModel: fallbackModel || undefined,
			backendUrl: backendUrl || undefined,
			reviewCriteriaPrompt: reviewCriteriaPrompt || undefined,
			// 非法输入交由 storage 层 clampDailyBatchSize 收敛到 [1,20]
			dailyBatchSize: Number.parseInt(dailyBatchSize, 10) || undefined,
		});
		await saveApiKey(apiKey);
		await saveBackendToken(backendToken);
		setSaved(true);
	}

	return (
		<div>
			<button onClick={onClose} style={{ fontSize: 13, marginBottom: 8 }}>
				← 返回
			</button>
			<h2 style={{ fontSize: 15, margin: "0 0 4px" }}>设置</h2>

			<p style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
				⚙️ 大模型 endpoint 与 API Key 已在后端服务 .env 中配置，扩展不直接管理。
			</p>

			<label style={labelStyle}>LLM Endpoint (https://)</label>
			<input
				style={inputStyle}
				value={endpoint}
				placeholder="https://api.openai.com/v1/chat/completions"
				onChange={(e) => setEndpoint(e.target.value)}
			/>
			<label style={labelStyle}>模型名</label>
			<input
				style={inputStyle}
				value={model}
				onChange={(e) => setModel(e.target.value)}
			/>
			<label style={labelStyle}>API Key</label>
			<input
				style={inputStyle}
				type="password"
				value={apiKey}
				onChange={(e) => setApiKey(e.target.value)}
			/>
			<p style={{ fontSize: 11, color: "#888", margin: "2px 0 0" }}>
				⚠️ key
				以明文存储于本地浏览器(chrome.storage.local),并会随请求发往上面配置的
				endpoint。请只配置可信地址,建议使用权限受限的专用 key。
			</p>

			{/* 备用 LLM 端点(可折叠) */}
			<div
				style={{
					marginTop: 10,
					border: "1px solid #e8e8e8",
					borderRadius: 4,
					padding: "6px 8px",
				}}
			>
				<button
					type="button"
					aria-expanded={fallbackOpen}
					onClick={() => setFallbackOpen((v) => !v)}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						fontSize: 12,
						color: "#555",
						padding: 0,
						width: "100%",
						textAlign: "left",
					}}
				>
					{fallbackOpen ? "▼" : "▶"} 备用 LLM 模型
					{fallbackModel ? " (已配置)" : " (可选)"}
				</button>
				{fallbackOpen && (
					<div style={{ marginTop: 6 }}>
						<p style={{ fontSize: 11, color: "#888", margin: "0 0 6px" }}>
							主模型失败时自动回退。留空即不启用。
						</p>
						<label style={labelStyle}>备用模型名(可选)</label>
						<input
							style={inputStyle}
							value={fallbackModel}
							onChange={(e) => setFallbackModel(e.target.value)}
						/>
					</div>
				)}
			</div>

			{/* 后端连接（可选，用于 published_posts 注册表双写） */}
			<label style={labelStyle}>后端 URL（可选，http://localhost:3001）</label>
			<input
				style={inputStyle}
				value={backendUrl}
				placeholder="http://localhost:3001"
				onChange={(e) => setBackendUrl(e.target.value)}
			/>
			<label style={labelStyle}>后端 JWT Token（可选）</label>
			<input
				style={inputStyle}
				type="password"
				value={backendToken}
				onChange={(e) => setBackendToken(e.target.value)}
			/>

			{/* 今日一键备稿:每日批量上限 */}
			<label style={labelStyle}>每日批量上限（1-20，默认 5）</label>
			<input
				style={inputStyle}
				type="number"
				min={1}
				max={20}
				value={dailyBatchSize}
				onChange={(e) => setDailyBatchSize(e.target.value)}
			/>

			{/* Few-shot 范例编辑器 */}
			<div style={{ marginTop: 10 }}>
				<div
					style={{
						...labelStyle,
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}
				>
					Few-shot 范例
					<span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>
						({fewShotPairs.length}/{MAX_PAIRS})
					</span>
				</div>
				{importTruncated && (
					<p
						role="alert"
						style={{ fontSize: 11, color: "#fa8c16", margin: "0 0 4px" }}
					>
						{importTruncated}
					</p>
				)}
				<FewShotPairEditor
					pairs={fewShotPairs}
					onChange={setFewShotPairs}
					importBanner={importBanner || undefined}
					onImport={() => void handleImport()}
				/>
			</div>

			<label style={labelStyle}>
				Prompt 模板(占位符:{"{{topic}}"} 选题 / {"{{facts}}"} 事实块 /{" "}
				{"{{fewshot}}"} 范例)
				<button
					style={{ marginLeft: 8, fontSize: 11 }}
					onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}
				>
					恢复默认
				</button>
			</label>
			<textarea
				style={{ ...inputStyle, minHeight: 120 }}
				value={promptTemplate}
				onChange={(e) => setPromptTemplate(e.target.value)}
			/>
			<p style={{ color: "#888", fontSize: 11, margin: "2px 0 0" }}>
				源接地:AI 只用 {"{{facts}}"} 里给的事实润色,缺的标【待补】,连结只用给定
				URL——防止编造作品事实/连结。
			</p>

			<label style={labelStyle}>
				Few-shot 原始文本(旧格式兼容,优先使用上方结构化编辑器)
				<button
					style={{ marginLeft: 8, fontSize: 11 }}
					onClick={() =>
						setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? "")
					}
				>
					恢复默认
				</button>
			</label>
			<textarea
				style={{ ...inputStyle, minHeight: 100 }}
				value={fewShotExamples}
				onChange={(e) => setFewShotExamples(e.target.value)}
			/>
			<p style={{ color: "#888", fontSize: 11, margin: "2px 0 0" }}>
				⚠️ 范例里别写真实連結(会随每次请求发往后端);用占位即可。
			</p>

			<label style={labelStyle}>推荐标签清单 (每行一个或逗号分隔)</label>
			<textarea
				style={{ ...inputStyle, minHeight: 80 }}
				placeholder={"漢化\n無修正\n校園日常\n…（约 20–50 条为宜）"}
				value={tagsText}
				onChange={(e) => setTagsText(e.target.value)}
			/>
			<p style={{ color: "#888", fontSize: 11, margin: "2px 0 0" }}>
				AI 生成时只从此列表选择标签；留空则仅约束分类不约束标签。
			</p>

			<label style={labelStyle}>
				AI 评审标准（Phase 3，留空使用内置四维标准）
			</label>
			<textarea
				style={{ ...inputStyle, minHeight: 80 }}
				placeholder={
					"留空=内置四维标准(内容丰富度/社群语气/标题质量/分类准确)。\n如需自定义,请按 JSON 格式写入各维度标准。"
				}
				value={reviewCriteriaPrompt}
				onChange={(e) => setReviewCriteriaPrompt(e.target.value)}
			/>
			<p style={{ color: "#888", fontSize: 11, margin: "2px 0 8px" }}>
				内置标准覆盖：内容丰富度 / 社群语气 / 标题质量 / 分类准确。Phase 3
				启用后每条草稿生成后自动评审。
			</p>

			<hr
				style={{
					margin: "14px 0 6px",
					border: "none",
					borderTop: "1px solid #e8e8e8",
				}}
			/>

			<label style={labelStyle}>
				Prompt 管理
				<button
					style={{ marginLeft: 8, fontSize: 11 }}
					onClick={handleLoadPrompts}
				>
					从后端加载
				</button>
			</label>
			{prompts.length > 0 && (
				<select
					style={{ ...inputStyle, marginBottom: 4 }}
					value={selectedPromptId}
					onChange={handleSelectPrompt}
				>
					<option value="">-- 选择模板 --</option>
					{prompts.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			)}
			<button
				style={{ fontSize: 11, marginTop: 2 }}
				onClick={handleSaveToBackend}
			>
				保存到后端
			</button>
			{promptStatus && (
				<p style={{ color: "#888", fontSize: 11, margin: "2px 0 0" }}>
					{promptStatus}
				</p>
			)}

			<label style={labelStyle}>
				字段映射(JSON)
				<button
					style={{ marginLeft: 8, fontSize: 11 }}
					onClick={() =>
						setMappingText(
							JSON.stringify(DEFAULT_SETTINGS.fieldMapping, null, 2),
						)
					}
				>
					恢复默认
				</button>
			</label>
			<textarea
				style={{
					...inputStyle,
					minHeight: 140,
					fontFamily: "monospace",
					fontSize: 11,
				}}
				value={mappingText}
				onChange={(e) => setMappingText(e.target.value)}
			/>

			{error && (
				<p role="alert" style={{ color: "#cf1322", fontSize: 12 }}>
					{error}
				</p>
			)}
			{saved && <p style={{ color: "#389e0d", fontSize: 12 }}>已保存。</p>}

			<button
				onClick={handleSave}
				style={{
					marginTop: 10,
					padding: "6px 14px",
					fontSize: 13,
					background: "#1677ff",
					color: "#fff",
					border: "none",
					borderRadius: 4,
					cursor: "pointer",
				}}
			>
				保存
			</button>
		</div>
	);
}
