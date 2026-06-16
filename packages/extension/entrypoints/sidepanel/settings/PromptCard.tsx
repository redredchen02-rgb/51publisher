import type { FewShotPair } from "@51publisher/shared";
import { DEFAULT_SETTINGS } from "../../../lib/storage";
import { FewShotPairEditor } from "../components/FewShotPairEditor";
import styles from "../Settings.module.css";

const MAX_PAIRS = 8;

interface Props {
	promptTemplate: string;
	fewShotExamples: string;
	fewShotPairs: FewShotPair[];
	importBanner: string;
	importTruncated: string;
	setPromptTemplate: (v: string) => void;
	setFewShotExamples: (v: string) => void;
	setFewShotPairs: (v: FewShotPair[]) => void;
	onImport: () => void;
}

export function PromptCard({
	promptTemplate, fewShotExamples, fewShotPairs, importBanner, importTruncated,
	setPromptTemplate, setFewShotExamples, setFewShotPairs, onImport,
}: Props) {
	return (
		<>
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Few-shot 范例
						<span className={`font-normal text-muted ${styles.fewShotCount}`}>({fewShotPairs.length}/{MAX_PAIRS})</span>
					</label>
					{importTruncated && <p role="alert" className="field-hint text-warning">{importTruncated}</p>}
					<FewShotPairEditor pairs={fewShotPairs} onChange={setFewShotPairs} importBanner={importBanner || undefined} onImport={onImport} />
				</div>
			</div>

			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 模板(占位符:{"{{topic}}"} 选题 / {"{{facts}}"} 事实块 / {"{{fewshot}}"} 范例)
						<button type="button" className="btn btn-plain btn-sm ml-sm" onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}>
							恢复默认
						</button>
					</label>
					<textarea className={`field-input ${styles.textareaMd}`} value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} />
				</div>
				<p className="field-hint">源接地:AI 只用 {"{{facts}}"} 里给的事实润色,缺的标【待补】,连结只用给定 URL——防止编造作品事实/连结。</p>
				<div className="field-group">
					<label className="field-label">
						Few-shot 原始文本(旧格式兼容,优先使用上方结构化编辑器)
						<button type="button" className="btn btn-plain btn-sm ml-sm" onClick={() => setFewShotExamples(DEFAULT_SETTINGS.fewShotExamples ?? "")}>
							恢复默认
						</button>
					</label>
					<textarea className={`field-input ${styles.textareaSm}`} value={fewShotExamples} onChange={(e) => setFewShotExamples(e.target.value)} />
				</div>
				<p className="field-hint">⚠️ 范例里别写真实連結(会随每次请求发往后端);用占位即可。</p>
			</div>
		</>
	);
}
