import { useCallback, useState } from "react";

export type BatchOperationStatus =
	| "idle"
	| "running"
	| "paused"
	| "completed"
	| "error";

export interface BatchItem<T> {
	id: string;
	data: T;
	status: "pending" | "processing" | "done" | "failed";
	error?: string;
}

export interface BatchProgress {
	total: number;
	done: number;
	failed: number;
	percent: number;
}

export interface UseBatchOperationsReturn<T, R> {
	status: BatchOperationStatus;
	items: BatchItem<T>[];
	results: R[];
	progress: BatchProgress;
	start: (inputs: T[], processor: (item: T) => Promise<R>) => Promise<void>;
	pause: () => void;
	reset: () => void;
}

export function useBatchOperations<T, R>(): UseBatchOperationsReturn<T, R> {
	const [status, setStatus] = useState<BatchOperationStatus>("idle");
	const [items, setItems] = useState<BatchItem<T>[]>([]);
	const [results, setResults] = useState<R[]>([]);
	const [pausedRef] = useState({ value: false });

	const progress: BatchProgress = {
		total: items.length,
		done: items.filter((i) => i.status === "done").length,
		failed: items.filter((i) => i.status === "failed").length,
		percent:
			items.length === 0
				? 0
				: Math.round(
						(items.filter((i) => i.status === "done" || i.status === "failed")
							.length /
							items.length) *
							100,
					),
	};

	const start = useCallback(
		async (inputs: T[], processor: (item: T) => Promise<R>) => {
			const initialItems: BatchItem<T>[] = inputs.map((data, i) => ({
				id: String(i),
				data,
				status: "pending",
			}));
			setItems(initialItems);
			setResults([]);
			setStatus("running");
			pausedRef.value = false;

			const collectedResults: R[] = [];

			for (let i = 0; i < inputs.length; i++) {
				while (pausedRef.value) {
					await new Promise((r) => setTimeout(r, 100));
				}

				setItems((prev) =>
					prev.map((item, idx) =>
						idx === i ? { ...item, status: "processing" } : item,
					),
				);

				try {
					const result = await processor(inputs[i] as T);
					collectedResults.push(result);
					setItems((prev) =>
						prev.map((item, idx) =>
							idx === i ? { ...item, status: "done" } : item,
						),
					);
					setResults([...collectedResults]);
				} catch (e) {
					setItems((prev) =>
						prev.map((item, idx) =>
							idx === i
								? {
										...item,
										status: "failed",
										error: e instanceof Error ? e.message : "未知错误",
									}
								: item,
						),
					);
				}
			}

			setStatus("completed");
		},
		[pausedRef],
	);

	const pause = useCallback(() => {
		pausedRef.value = !pausedRef.value;
		setStatus((s) => (s === "running" ? "paused" : "running"));
	}, [pausedRef]);

	const reset = useCallback(() => {
		pausedRef.value = false;
		setStatus("idle");
		setItems([]);
		setResults([]);
	}, [pausedRef]);

	return { status, items, results, progress, start, pause, reset };
}
