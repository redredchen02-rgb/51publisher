import type { FewShotPair } from "@51publisher/shared";
import { DEFAULT_SETTINGS } from "../../../lib/storage";
import type { PromptTemplate } from "../../../lib/prompt-client";
import { FewShotPairEditor } from "./FewShotPairEditor";

const MAX_PAIRS = 8;

interface PromptSectionProps {
	promptTemplate: string;
	fewShotExamples: string;
	fewShotPairs: FewShotPair[];
	importBanner: string;
	importTruncated: string;
	prompts: PromptTemplate[];
	selectedPromptId: string;
	promptStatus: string;
	setPromptTemplate: (v: string) => void;
	setFewShotExamples: (v: string) => void;
	setFewShotPairs: (pairs: FewShotPair[]) => void;
	onImportFewShot: () => void;
	onLoadPrompts: () => void;
	onSelectPrompt: (id: string) => void;
	onSavePromptToBackend: (name: string) => Promise<void>;
}

export function PromptSection({
	promptTemplate,
	fewShotExamples,
	fewShotPairs,
	importBanner,
	importTruncated,
	prompts,
	selectedPromptId,
	promptStatus,
	setPromptTemplate,
	setFewShotExamples,
	setFewShotPairs,
	onImportFewShot,
	onLoadPrompts,
	onSelectPrompt,
	onSavePromptToBackend,
}: PromptSectionProps) {
	async function handleSaveToBackend() {
		const name = window.prompt("命名此模板:");
		if (!name) return;
		await onSavePromptToBackend(name);
	}

	return (
		<>
			{/* Few-shot 範例 */}
			<div className="card">
				<div className="field-group">
					<div className="field-label" id="fewshot-label">
						Few-shot 范例
						<span
							className="font-normal text-muted"
							style={{ marginLeft: "var(--space-sm)" }}
						>
							({fewShotPairs.length}/{MAX_PAIRS})
						</span>
					</div>
					{importTruncated && (
						<p role="alert" className="field-hint text-warning">
							{importTruncated}
						</p>
					)}
					<FewShotPairEditor
						pairs={fewShotPairs}
						onChange={setFewShotPairs}
						importBanner={importBanner || undefined}
						onImport={onImportFewShot}
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
					里给的事实润色,缺的标【待补】,连结只用给定 URL——防止编造作品事实/连结。
				</p>

				<div className="field-group">
					<label className="field-label">
						Few-shot 原始文本(旧格式兼容,优先使用上方结构化编辑器)
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={() => setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? "")}
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

			<hr className="divider" />

			{/* Prompt 管理 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 管理
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={onLoadPrompts}
						>
							从后端加载
						</button>
					</label>
					{prompts.length > 0 && (
						<select
							className="field-input"
							style={{ marginBottom: "var(--space-sm)" }}
							value={selectedPromptId}
							onChange={(e) => onSelectPrompt(e.target.value)}
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
						onClick={() => void handleSaveToBackend()}
					>
						保存到后端
					</button>
					{promptStatus && <p className="field-hint">{promptStatus}</p>}
				</div>
			</div>
		</>
	);
}
