import { useEffect, useRef, useCallback } from "react";

export interface UseAutoSaveOptions<T> {
	value: T;
	onSave: (value: T) => Promise<void> | void;
	debounceMs?: number;
	enabled?: boolean;
}

export function useAutoSave<T>({
	value,
	onSave,
	debounceMs = 1000,
	enabled = true,
}: UseAutoSaveOptions<T>): void {
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstRef = useRef(true);

	const flush = useCallback(
		(v: T) => {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => void onSaveRef.current(v), debounceMs);
		},
		[debounceMs],
	);

	useEffect(() => {
		if (!enabled) return;
		// 跳过首次挂载
		if (isFirstRef.current) {
			isFirstRef.current = false;
			return;
		}
		flush(value);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [value, enabled, flush]);
}
