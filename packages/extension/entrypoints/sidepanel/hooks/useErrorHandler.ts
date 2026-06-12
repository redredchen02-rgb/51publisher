import { useCallback, useState } from "react";

interface UseErrorHandlerReturn {
	error: string | null;
	isRetrying: boolean;
	handleError: (error: Error | string) => void;
	clearError: () => void;
	retry: <T>(
		operation: () => Promise<T>,
		maxRetries?: number,
	) => Promise<T | null>;
}

export function useErrorHandler(): UseErrorHandlerReturn {
	const [error, setError] = useState<string | null>(null);
	const [isRetrying, setIsRetrying] = useState(false);

	const handleError = useCallback((err: Error | string) => {
		const message = err instanceof Error ? err.message : String(err);
		setError(message);
		console.error("[ErrorHandler]", message);
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const retry = useCallback(
		async <T>(
			operation: () => Promise<T>,
			maxRetries = 3,
		): Promise<T | null> => {
			setIsRetrying(true);
			let lastError: Error | null = null;

			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const result = await operation();
					clearError();
					setIsRetrying(false);
					return result;
				} catch (err) {
					lastError =
						err instanceof Error ? err : new Error(String(err));
					console.warn(
						`[ErrorHandler] Attempt ${attempt}/${maxRetries} failed:`,
						lastError.message,
					);

					if (attempt < maxRetries) {
						await new Promise((resolve) =>
							setTimeout(resolve, 1000 * attempt),
						);
					}
				}
			}

			if (lastError) {
				handleError(lastError);
			}
			setIsRetrying(false);
			return null;
		},
		[clearError, handleError],
	);

	return {
		error,
		isRetrying,
		handleError,
		clearError,
		retry,
	};
}
