import { useCallback, useMemo, useRef, useState } from "react";

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
	const pausedRef = useRef({ value: false });

	const progress: BatchProgress = useMemo(() => {
		let done = 0;
		let failed = 0;
		for (const i of items) {
			if (i.status === "done") done++;
			else if (i.status === "failed") failed++;
		}
		return {
			total: items.length,
			done,
			failed,
			percent:
				items.length === 0
					? 0
					: Math.round(((done + failed) / items.length) * 100),
		};
	}, [items]);

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
			pausedRef.current.value = false;

			const collectedResults: R[] = [];

			for (let i = 0; i < inputs.length; i++) {
				while (pausedRef.current.value) {
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
		[],
	);

	const pause = useCallback(() => {
		pausedRef.current.value = !pausedRef.current.value;
		setStatus((s) => (s === "running" ? "paused" : "running"));
	}, []);

	const reset = useCallback(() => {
		pausedRef.current.value = false;
		setStatus("idle");
		setItems([]);
		setResults([]);
	}, []);

	return { status, items, results, progress, start, pause, reset };
}
