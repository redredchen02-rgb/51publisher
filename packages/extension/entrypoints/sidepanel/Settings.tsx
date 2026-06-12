import type { FewShotPair, FieldMapping } from "@51publisher/shared";
import { isValidFieldMapping, VALID_FIELD_TYPES } from "@51publisher/shared";
import { useCallback, useEffect, useState } from "react";
import {
	createPrompt,
	fetchPrompts,
	type PromptTemplate,
} from "../../lib/prompt-client";
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
import { FewShotPairEditor } from "./components/FewShotPairEditor";

const MAX_PAIRS = 8;

export function parseTagsText(text: string): string[] {
	return text
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function validateMapping(text: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		return `JSON 格式错误:${(e as Error).message}`;
	}
	if (!isValidFieldMapping(parsed)) {
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return "字段映射必须是一个对象。";
		for (const [key, def] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (!def || typeof def !== "object") return `字段 ${key} 必须是对象。`;
			const d = def as Record<string, unknown>;
			if (typeof d.selector !== "string" || !d.selector)
				return `字段 ${key} 缺少有效的 selector。`;
			if (
				typeof d.fieldType !== "string" ||
				!(VALID_FIELD_TYPES as readonly string[]).includes(d.fieldType)
			) {
				return `字段 ${key} 的 fieldType 非法(应为:${VALID_FIELD_TYPES.join(" / ")})。`;
			}
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
		if (backendUrl && backendUrl.startsWith("http://")) {
			console.warn(
				"[Settings] 后端 URL 使用 HTTP，JWT 以明文传输。建议仅在本地开发时使用。",
			);
		}
		setError("");
		const existing = await getSettings();
		const fewShotExamplesResolved =
			fewShotPairs.length > 0
				? deriveFewShotExamples(fewShotPairs)
				: fewShotExamples;
		let fieldMappingParsed: FieldMapping;
		try {
			fieldMappingParsed = JSON.parse(mappingText) as FieldMapping;
		} catch {
			setError("字段映射 JSON 解析失败。");
			return;
		}
		await saveSettings({
			...existing,
			endpoint,
			model,
			promptTemplate,
			fewShotExamples: fewShotExamplesResolved,
			fewShotPairs,
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
			<button
				type="button"
				onClick={onClose}
				className="btn btn-plain"
				style={{ marginBottom: "var(--space-md)" }}
			>
				← 返回
			</button>
			<h2 style={{ fontSize: "var(--font-lg)", margin: "0 0 var(--space-sm)" }}>
				设置
			</h2>

			<p className="field-hint" style={{ marginBottom: "var(--space-md)" }}>
				⚙️ 大模型 endpoint 与 API Key 已在后端服务 .env 中配置，扩展不直接管理。
			</p>

			{/* LLM 配置 */}
			<div className="card">
				<div className="section-header">LLM 配置</div>
				<div className="field-group">
					<label className="field-label">LLM Endpoint (https://)</label>
					<input
						className="field-input"
						value={endpoint}
						placeholder="https://api.openai.com/v1/chat/completions"
						onChange={(e) => setEndpoint(e.target.value)}
					/>
				</div>
				<div className="field-group">
					<label className="field-label">模型名</label>
					<input
						className="field-input"
						value={model}
						onChange={(e) => setModel(e.target.value)}
					/>
				</div>
				<div className="field-group">
					<label className="field-label">API Key</label>
					<input
						className="field-input"
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					⚠️ key
					以明文存储于本地浏览器(chrome.storage.local),并会随请求发往上面配置的
					endpoint。请只配置可信地址,建议使用权限受限的专用 key。
				</p>

				{/* 备用 LLM */}
				<div className="card" style={{ marginTop: "var(--space-lg)" }}>
					<button
						type="button"
						aria-expanded={fallbackOpen}
						onClick={() => setFallbackOpen((v) => !v)}
						className="btn-icon text-secondary"
						style={{
							width: "100%",
							textAlign: "left",
							fontSize: "var(--font-sm)",
							padding: 0,
						}}
					>
						{fallbackOpen ? "▼" : "▶"} 备用 LLM 模型
						{fallbackModel ? " (已配置)" : " (可选)"}
					</button>
					{fallbackOpen && (
						<div style={{ marginTop: "var(--space-lg)" }}>
							<p className="field-hint">主模型失败时自动回退。留空即不启用。</p>
							<div className="field-group">
								<label className="field-label">备用模型名(可选)</label>
								<input
									className="field-input"
									value={fallbackModel}
									onChange={(e) => setFallbackModel(e.target.value)}
								/>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* 后端连接 */}
			<div className="card">
				<div className="section-header">后端连接（可选）</div>
				<div className="field-group">
					<label className="field-label">
						后端 URL（http://localhost:3001）
					</label>
					<input
						className="field-input"
						value={backendUrl}
						placeholder="http://localhost:3001"
						onChange={(e) => setBackendUrl(e.target.value)}
					/>
				</div>
				<div className="field-group">
					<label className="field-label">后端 JWT Token（可选）</label>
					<input
						className="field-input"
						type="password"
						value={backendToken}
						onChange={(e) => setBackendToken(e.target.value)}
					/>
				</div>
				<div className="field-group">
					<label className="field-label">每日批量上限（1-20，默认 5）</label>
					<input
						className="field-input"
						type="number"
						min={1}
						max={20}
						value={dailyBatchSize}
						onChange={(e) => setDailyBatchSize(e.target.value)}
					/>
				</div>
			</div>

			{/* Few-shot 范例 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Few-shot 范例
						<span
							className="font-normal text-muted"
							style={{ marginLeft: "var(--space-sm)" }}
						>
							({fewShotPairs.length}/{MAX_PAIRS})
						</span>
					</label>
					{importTruncated && (
						<p role="alert" className="field-hint text-warning">
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
			</div>

			{/* Prompt 模板 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 模板(占位符:{"{{topic}}"} 选题 / {"{{facts}}"} 事实块 /{" "}
						{"{{fewshot}}"} 范例)
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}
						>
							恢复默认
						</button>
					</label>
					<textarea
						className="field-input"
						style={{ minHeight: 120 }}
						value={promptTemplate}
						onChange={(e) => setPromptTemplate(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					源接地:AI 只用 {"{{facts}}"}{" "}
					里给的事实润色,缺的标【待补】,连结只用给定
					URL——防止编造作品事实/连结。
				</p>

				<div className="field-group">
					<label className="field-label">
						Few-shot 原始文本(旧格式兼容,优先使用上方结构化编辑器)
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={() =>
								setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? "")
							}
						>
							恢复默认
						</button>
					</label>
					<textarea
						className="field-input"
						style={{ minHeight: 100 }}
						value={fewShotExamples}
						onChange={(e) => setFewShotExamples(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					⚠️ 范例里别写真实連結(会随每次请求发往后端);用占位即可。
				</p>
			</div>

			{/* 标签 & 评审标准 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						推荐标签清单 (每行一个或逗号分隔)
					</label>
					<textarea
						className="field-input"
						style={{ minHeight: 80 }}
						placeholder={"漢化\n無修正\n校園日常\n…（约 20–50 条为宜）"}
						value={tagsText}
						onChange={(e) => setTagsText(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					AI 生成时只从此列表选择标签；留空则仅约束分类不约束标签。
				</p>

				<div className="field-group">
					<label className="field-label">
						AI 评审标准（Phase 3，留空使用内置四维标准）
					</label>
					<textarea
						className="field-input"
						style={{ minHeight: 80 }}
						placeholder={
							"留空=内置四维标准(内容丰富度/社群语气/标题质量/分类准确)。\n如需自定义,请按 JSON 格式写入各维度标准。"
						}
						value={reviewCriteriaPrompt}
						onChange={(e) => setReviewCriteriaPrompt(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					内置标准覆盖：内容丰富度 / 社群语气 / 标题质量 / 分类准确。Phase 3
					启用后每条草稿生成后自动评审。
				</p>
			</div>

			<hr className="divider" />

			{/* Prompt 管理 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 管理
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={handleLoadPrompts}
						>
							从后端加载
						</button>
					</label>
					{prompts.length > 0 && (
						<select
							className="field-input"
							style={{ marginBottom: "var(--space-sm)" }}
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
						type="button"
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-xs)" }}
						onClick={handleSaveToBackend}
					>
						保存到后端
					</button>
					{promptStatus && <p className="field-hint">{promptStatus}</p>}
				</div>

				<div className="field-group">
					<label className="field-label">
						字段映射(JSON)
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
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
						className="field-input"
						style={{
							minHeight: 140,
							fontFamily: "monospace",
							fontSize: "var(--font-xs)",
						}}
						value={mappingText}
						onChange={(e) => setMappingText(e.target.value)}
					/>
				</div>
			</div>

			{error && (
				<p role="alert" className="text-error text-sm">
					{error}
				</p>
			)}
			{saved && <p className="text-success text-sm">已保存。</p>}

			<button
				type="button"
				onClick={handleSave}
				className="btn btn-primary"
				style={{ marginTop: "var(--space-lg)" }}
			>
				保存
			</button>
		</div>
	);
}
