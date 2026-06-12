import { useCallback, useState } from "react";
import { getStorage } from "../../../lib/chrome-storage-utils";

interface ErrorLog {
	id: string;
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
	timestamp: string;
}

interface UseErrorLoggerReturn {
	logs: ErrorLog[];
	logError: (error: Error, context?: Record<string, unknown>) => Promise<void>;
	retrieveLogs: () => Promise<void>;
	clearLogs: () => Promise<void>;
	exportLogs: () => string;
}

const STORAGE_KEY = "pfa-error-logs";

export function useErrorLogger(): UseErrorLoggerReturn {
	const [logs, setLogs] = useState<ErrorLog[]>([]);

	const logError = useCallback(
		async (error: Error, context?: Record<string, unknown>) => {
			const log: ErrorLog = {
				id: crypto.randomUUID(),
				message: error.message,
				stack: error.stack,
				context,
				timestamp: new Date().toISOString(),
			};
			// 先计算新日志，再更新状态和存储
			const newLogs = [log, ...logs].slice(0, 100);
			setLogs(newLogs);
			// 异步保存到存储（在 updater 外部）
			const storage = getStorage();
			if (storage) {
				storage.set({ [STORAGE_KEY]: newLogs }).catch(() => {});
			}
		},
		[logs],
	);

	const retrieveLogs = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get<Record<string, unknown>>(STORAGE_KEY);
				setLogs((result?.[STORAGE_KEY] as ErrorLog[] | undefined) ?? []);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const clearLogs = useCallback(async () => {
		setLogs([]);
		try {
			const storage = getStorage();
			if (storage) {
				await storage.remove(STORAGE_KEY);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const exportLogs = useCallback(() => {
		return JSON.stringify(logs, null, 2);
	}, [logs]);

	return { logs, logError, retrieveLogs, clearLogs, exportLogs };
}
