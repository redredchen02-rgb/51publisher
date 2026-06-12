import { useCallback, useState } from "react";

export interface ErrorEntry {
	message: string;
	code?: string;
	timestamp: number;
}

export interface UseErrorHandlerReturn {
	error: string;
	errorLog: ErrorEntry[];
	setError: (message: string, code?: string) => void;
	clearError: () => void;
	withErrorHandling: <T>(
		fn: () => Promise<T>,
		fallback?: string,
	) => Promise<T | undefined>;
}

export function useErrorHandler(): UseErrorHandlerReturn {
	const [error, setErrorState] = useState("");
	const [errorLog, setErrorLog] = useState<ErrorEntry[]>([]);

	const setError = useCallback((message: string, code?: string) => {
		setErrorState(message);
		if (message) {
			setErrorLog((prev) => [
				...prev.slice(-19),
				{ message, code, timestamp: Date.now() },
			]);
		}
	}, []);

	const clearError = useCallback(() => setErrorState(""), []);

	const withErrorHandling = useCallback(
		async <T>(
			fn: () => Promise<T>,
			fallback?: string,
		): Promise<T | undefined> => {
			try {
				clearError();
				return await fn();
			} catch (e) {
				const msg =
					fallback ?? (e instanceof Error ? e.message : "操作失败，请重试。");
				setError(msg);
				return undefined;
			}
		},
		[setError, clearError],
	);

	return { error, errorLog, setError, clearError, withErrorHandling };
}
