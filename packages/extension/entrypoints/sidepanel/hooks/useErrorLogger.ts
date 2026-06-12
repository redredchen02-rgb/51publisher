import { useCallback, useState } from "react";

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

// 检查 chrome/storage API 是否可用
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

function isStorageAvailable(): boolean {
	try {
		return (
			typeof chrome !== "undefined" &&
			chrome?.storage?.local != null
		);
	} catch {
		return false;
	}
}

function getStorage() {
	if (!isStorageAvailable()) return null;
	return chrome.storage.local as {
		get: (key: string) => Promise<Record<string, unknown>>;
		set: (data: Record<string, unknown>) => Promise<void>;
		remove: (key: string) => Promise<void>;
	};
}

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
			setLogs((prev) => {
				const newLogs = [log, ...prev].slice(0, 100);
				const storage = getStorage();
				if (storage) {
					storage.set({ [STORAGE_KEY]: newLogs }).catch(() => {});
				}
				return newLogs;
			});
		},
		[],
	);

	const retrieveLogs = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get(STORAGE_KEY);
				setLogs((result[STORAGE_KEY] as ErrorLog[] | undefined) ?? []);
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
