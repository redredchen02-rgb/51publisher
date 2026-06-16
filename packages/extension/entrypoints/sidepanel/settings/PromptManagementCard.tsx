import type { FewShotPair } from "@51publisher/shared";
import { useCallback, useState } from "react";
import {
	createPrompt,
	fetchPrompts,
	type PromptTemplate,
} from "../../../lib/prompt-client";
import { DEFAULT_SETTINGS, deriveFewShotExamples } from "../../../lib/storage";
import styles from "../Settings.module.css";

interface Props {
	promptTemplate: string;
	fewShotPairs: FewShotPair[];
	fewShotExamples: string;
	mappingText: string;
	setMappingText: (v: string) => void;
	onSelectPrompt: (template: string, fewShotExamples: string) => void;
}

export function PromptManagementCard({
	promptTemplate,
	fewShotPairs,
	fewShotExamples,
	mappingText,
	setMappingText,
	onSelectPrompt,
}: Props) {
	const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
	const [selectedPromptId, setSelectedPromptId] = useState("");
	const [promptStatus, setPromptStatus] = useState("");

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
			if (t) onSelectPrompt(t.template, t.fewShotExamples);
		},
		[prompts, onSelectPrompt],
	);

	const handleSaveToBackend = useCallback(async () => {
		const name = window.prompt("命名此模板:");
		if (!name) return;
		setPromptStatus("保存中...");
		const resolved =
			fewShotPairs.length > 0
				? deriveFewShotExamples(fewShotPairs)
				: fewShotExamples;
		const result = await createPrompt({
			name,
			template: promptTemplate,
			fewShotExamples: resolved,
		});
		if (result.ok) {
			setPromptStatus(`模板 "${name}" 已保存到后端`);
			void handleLoadPrompts();
		} else {
			setPromptStatus(`保存失败: ${result.error ?? "后端不可达"}`);
		}
	}, [promptTemplate, fewShotPairs, fewShotExamples, handleLoadPrompts]);

	return (
		<div className="card">
			<div className="field-group">
				<label className="field-label">
					Prompt 管理
					<button
						type="button"
						className="btn btn-plain btn-sm ml-sm"
						onClick={() => void handleLoadPrompts()}
					>
						从后端加载
					</button>
				</label>
				{prompts.length > 0 && (
					<select
						className={`field-input ${styles.promptSelect}`}
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
					className={`btn btn-plain btn-sm ${styles.saveToBackendBtn}`}
					onClick={() => void handleSaveToBackend()}
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
					className={`field-input ${styles.textareaMapping}`}
					value={mappingText}
					onChange={(e) => setMappingText(e.target.value)}
				/>
			</div>
		</div>
	);
}
