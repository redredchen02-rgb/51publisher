import type { FewShotPair, FieldMapping } from "@51publisher/shared";
import { useCallback, useRef, useState } from "react";
import type { ConnectionTestResult } from "../../../lib/connection-test";
import { testConnection as runTestConnection } from "../../../lib/connection-test";
import { createPrompt, fetchPrompts } from "../../../lib/prompt-client";
import type { PromptTemplate } from "../../../lib/prompt-client";
import {
	deriveFewShotExamples,
	getApiKey as storageGetApiKey,
	getBackendToken as storageGetBackendToken,
	getSettings,
	saveApiKey,
	saveBackendToken,
	saveSettings,
} from "../../../lib/storage";
import { parseTagsText, validateSettingsForm } from "../Settings";

const MAX_PAIRS = 8;

const IMPORT_BANNER_TEXT =
	"偵測到舊格式 few-shot 範例，點擊「匯入」可轉換為新格式";

export interface SettingsFormValues {
	endpoint: string;
	model: string;
	promptTemplate: string;
	fewShotExamples: string;
	fewShotPairs: FewShotPair[];
	tagsText: string;
	mappingText: string;
	fallbackModel: string;
	backendUrl: string;
	reviewCriteriaPrompt: string;
	dailyBatchSize: string;
	importBanner: string;
	importTruncated: string;
}

export interface UseSettingsFormReturn {
	formValues: SettingsFormValues;
	getApiKey: () => string;
	getBackendToken: () => string;
	setApiKey: (v: string) => void;
	setBackendToken: (v: string) => void;
	derivedFewShotExamples: string;
	prompts: PromptTemplate[];
	selectedPromptId: string;
	promptStatus: string;
	load: () => Promise<void>;
	save: () => Promise<string | null>;
	importFewShot: () => void;
	loadPrompts: () => Promise<void>;
	selectPrompt: (id: string) => void;
	savePromptToBackend: (name: string) => Promise<void>;
	testConnectionFn: () => Promise<ConnectionTestResult>;
	setFormValue: <K extends keyof SettingsFormValues>(
		key: K,
		value: SettingsFormValues[K],
	) => void;
	setFewShotPairs: (pairs: FewShotPair[]) => void;
}

export function useSettingsForm(): UseSettingsFormReturn {
	const [formValues, setFormValues] = useState<SettingsFormValues>({
		endpoint: "",
		model: "",
		promptTemplate: "",
		fewShotExamples: "",
		fewShotPairs: [],
		tagsText: "",
		mappingText: "",
		fallbackModel: "",
		backendUrl: "",
		reviewCriteriaPrompt: "",
		dailyBatchSize: "5",
		importBanner: "",
		importTruncated: "",
	});

	const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
	const [selectedPromptId, setSelectedPromptId] = useState("");
	const [promptStatus, setPromptStatus] = useState("");

	const apiKeyRef = useRef("");
	const backendTokenRef = useRef("");
	const loadedRef = useRef(false);

	const getApiKey = useCallback(() => apiKeyRef.current, []);
	const getBackendToken = useCallback(() => backendTokenRef.current, []);
	const setApiKey = useCallback((v: string) => { apiKeyRef.current = v; }, []);
	const setBackendToken = useCallback((v: string) => { backendTokenRef.current = v; }, []);

	const load = useCallback(async () => {
		if (loadedRef.current) return;
		loadedRef.current = true;

		const [s, key, bToken] = await Promise.all([
			getSettings(),
			storageGetApiKey(),
			storageGetBackendToken(),
		]);

		apiKeyRef.current = key;
		backendTokenRef.current = bToken;

		const pairs = s.fewShotPairs ?? [];
		const rawExamples = s.fewShotExamples ?? "";
		const importBanner =
			rawExamples && pairs.length === 0 ? IMPORT_BANNER_TEXT : "";

		setFormValues({
			endpoint: s.endpoint,
			model: s.model,
			promptTemplate: s.promptTemplate,
			fewShotExamples: rawExamples,
			fewShotPairs: pairs,
			tagsText: (s.recommendedTags ?? []).join("\n"),
			mappingText: JSON.stringify(s.fieldMapping, null, 2),
			fallbackModel: s.fallbackModel ?? "",
			backendUrl: s.backendUrl ?? "",
			reviewCriteriaPrompt: s.reviewCriteriaPrompt ?? "",
			dailyBatchSize: String(s.dailyBatchSize ?? 5),
			importBanner,
			importTruncated: "",
		});
	}, []);

	const derivedFewShotExamples =
		formValues.fewShotPairs.length > 0
			? deriveFewShotExamples(formValues.fewShotPairs)
			: formValues.fewShotExamples;

	const save = useCallback(async (): Promise<string | null> => {
		const validationErr = validateSettingsForm({
			endpoint: formValues.endpoint,
			mappingText: formValues.mappingText,
			backendUrl: formValues.backendUrl,
		});
		if (validationErr) return validationErr;

		const existing = await getSettings();
		let fieldMappingParsed: FieldMapping;
		try {
			fieldMappingParsed = JSON.parse(formValues.mappingText) as FieldMapping;
		} catch {
			return "字段映射 JSON 解析失败。";
		}

		const resolvedFewShotExamples =
			formValues.fewShotPairs.length > 0
				? deriveFewShotExamples(formValues.fewShotPairs)
				: formValues.fewShotExamples;

		await saveSettings({
			...existing,
			endpoint: formValues.endpoint,
			model: formValues.model,
			promptTemplate: formValues.promptTemplate,
			fewShotExamples: resolvedFewShotExamples,
			fewShotPairs: formValues.fewShotPairs,
			recommendedTags: parseTagsText(formValues.tagsText),
			fieldMapping: fieldMappingParsed,
			fallbackModel: formValues.fallbackModel || undefined,
			backendUrl: formValues.backendUrl || undefined,
			reviewCriteriaPrompt: formValues.reviewCriteriaPrompt || undefined,
			dailyBatchSize:
				Number.parseInt(formValues.dailyBatchSize, 10) || undefined,
		});
		await saveApiKey(apiKeyRef.current);
		await saveBackendToken(backendTokenRef.current);
		return null;
	}, [formValues]);

	const importFewShot = useCallback(() => {
		const raw = formValues.fewShotExamples;
		if (!raw) return;

		const blocks = raw.split(/\n\n+/).filter(Boolean);
		const truncated = blocks.length > MAX_PAIRS;
		const taken = blocks.slice(0, MAX_PAIRS).map((b) => {
			const sep = b.indexOf("\n---\n");
			return sep !== -1
				? { input: b.slice(0, sep), output: b.slice(sep + 5) }
				: { input: "", output: b };
		});

		setFormValues((prev) => ({
			...prev,
			fewShotPairs: taken,
			importBanner: "",
			importTruncated: truncated
				? `检测到 ${blocks.length} 块，已截取前 ${MAX_PAIRS} 条，请检查并补全 input 字段`
				: "",
		}));
	}, [formValues.fewShotExamples]);

	const loadPrompts = useCallback(async () => {
		const result = await fetchPrompts();
		if (result.ok && result.prompts) {
			setPrompts(result.prompts);
			setPromptStatus(`已加載 ${result.prompts.length} 個模板`);
		} else {
			setPromptStatus(`加載失敗：${result.error ?? "未知錯誤"}`);
		}
	}, []);

	const selectPrompt = useCallback(
		(id: string) => {
			const tpl = prompts.find((p) => p.id === id);
			if (!tpl) return;
			setSelectedPromptId(id);
			setFormValues((prev) => ({
				...prev,
				promptTemplate: tpl.template,
				fewShotExamples: tpl.fewShotExamples,
			}));
		},
		[prompts],
	);

	const savePromptToBackend = useCallback(
		async (name: string) => {
			const resolved =
				formValues.fewShotPairs.length > 0
					? deriveFewShotExamples(formValues.fewShotPairs)
					: formValues.fewShotExamples;
			const result = await createPrompt({
				name,
				template: formValues.promptTemplate,
				fewShotExamples: resolved,
				model: formValues.model || undefined,
			});
			if (result.ok) {
				setPromptStatus("已儲存至後端");
			} else {
				setPromptStatus(`儲存失敗：${result.error ?? "未知錯誤"}`);
			}
			await loadPrompts();
		},
		[formValues, loadPrompts],
	);

	const testConnectionFn = useCallback(async (): Promise<ConnectionTestResult> => {
		return runTestConnection();
	}, []);

	const setFormValue = useCallback(
		<K extends keyof SettingsFormValues>(
			key: K,
			value: SettingsFormValues[K],
		) => {
			setFormValues((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);

	const setFewShotPairs = useCallback((pairs: FewShotPair[]) => {
		setFormValues((prev) => ({ ...prev, fewShotPairs: pairs }));
	}, []);

	return {
		formValues,
		getApiKey,
		getBackendToken,
		setApiKey,
		setBackendToken,
		derivedFewShotExamples,
		prompts,
		selectedPromptId,
		promptStatus,
		load,
		save,
		importFewShot,
		loadPrompts,
		selectPrompt,
		savePromptToBackend,
		testConnectionFn,
		setFormValue,
		setFewShotPairs,
	};
}
