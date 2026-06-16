import { useEffect, useRef, useState } from "react";
import type { BatchItem } from "../../../lib/batch";
import {
	approveSingleItem,
	getBatchState,
	resolveAdminTabId,
	retryBatchItemMsg,
	runBatch,
} from "../../../lib/messaging";
import { fetchPendingTopics } from "../../../lib/pending-client";
import { getReadItems, markItemRead } from "../../../lib/read-tracker";
import { getSettings } from "../../../lib/storage";

const TERMINAL_STATUSES = new Set([
	"publish-confirmed",
	"gate-failed",
	"error",
	"aborted",
	"needs-human-verification",
]);

function isAllTerminal(items: BatchItem[]): boolean {
	return (
		items.length > 0 && items.every((it) => TERMINAL_STATUSES.has(it.status))
	);
}

export interface TodayBatchDomain {
	dailyBatchSize: number;
	adminTabId: number | null | undefined;
	tabError: string;
	busy: boolean;
	error: string;
	stage: "idle" | "generating" | "review";
	items: BatchItem[];
	readItems: Set<string>;
	publishingItems: Set<string>;
	setStage: (s: "idle" | "generating" | "review") => void;
	setItems: (items: BatchItem[]) => void;
	setError: (e: string) => void;
	handleDailyBatch: () => Promise<void>;
	handlePublish: (item: BatchItem) => Promise<void>;
	handleApproveAll: (items: BatchItem[]) => Promise<void>;
	handleRetry: (itemId: string) => Promise<void>;
	handleToggleRead: (itemId: string) => void;
}

export function useTodayBatchDomain(): TodayBatchDomain {
	const [dailyBatchSize, setDailyBatchSize] = useState(5);
	const [adminTabId, setAdminTabId] = useState<number | null | undefined>(
		undefined,
	);
	const [tabError, setTabError] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [stage, setStage] = useState<"idle" | "generating" | "review">("idle");
	const [items, setItems] = useState<BatchItem[]>([]);
	const [readItems, setReadItems] = useState<Set<string>>(new Set());
	const [publishingItems, setPublishingItems] = useState<Set<string>>(
		new Set(),
	);

	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isMounted = useRef(true);

	useEffect(() => {
		return () => {
			isMounted.current = false;
		};
	}, []);

	// 卸载时清掉批量启动期间的进度轮询
	useEffect(() => {
		return () => {
			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		void (async () => {
			const [settings, tabId, activeBatch, reads] = await Promise.all([
				getSettings(),
				resolveAdminTabId(),
				getBatchState(),
				getReadItems(),
			]);
			setDailyBatchSize(settings.dailyBatchSize ?? 5);
			setAdminTabId(tabId);
			setReadItems(reads);
			if (activeBatch?.items.length) {
				setItems(activeBatch.items);
				setStage("review");
			}
			if (tabId == null) {
				setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			}
		})();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: items intentionally omitted — adding it would recreate the interval on every setItems call, causing the infinite-polling bug fixed earlier
	useEffect(() => {
		if (stage !== "review") {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
			return;
		}
		if (isAllTerminal(items)) return;

		pollRef.current = setInterval(() => {
			void getBatchState().then((batch) => {
				if (!batch) return;
				setItems(batch.items);
				if (isAllTerminal(batch.items)) {
					if (pollRef.current) {
						clearInterval(pollRef.current);
						pollRef.current = null;
					}
				}
			});
		}, 1500);

		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [stage]);

	async function handleDailyBatch() {
		if (adminTabId == null) {
			setTabError("未找到后台发帖页——请先打开后台发帖页标签。");
			return;
		}
		setBusy(true);
		setError("");
		setPublishingItems(new Set());
		setStage("generating");

		try {
			const pendingTopics = await fetchPendingTopics({
				status: "pending",
				sort_by: "score",
			});
			const topN = pendingTopics.slice(0, dailyBatchSize);
			if (topN.length === 0) {
				setError("暂无待处理选题,请先到「待审」页面抓取或添加选题。");
				setStage("idle");
				return;
			}

			const topics = topN.map((t) => t.title);
			const factsList = topN.map((t) => t.facts ?? {});
			const topicIds = topN.map((t) => t.id);
			const enrichments = topN.map((t) => t.enrichmentText);

			progressPollRef.current = setInterval(() => {
				void getBatchState().then((batch) => {
					if (batch) setItems(batch.items);
				});
			}, 2000);

			const batch = await runBatch(
				topics,
				adminTabId,
				factsList,
				undefined,
				undefined,
				topicIds,
				enrichments,
			);

			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}

			const finalItems =
				batch?.items ??
				topN.map((t) => ({
					id: t.id ?? t.title,
					topic: t.title,
					facts: t.facts ?? {},
					status: "queued" as const,
					pendingTopicId: t.id,
				}));
			if (!isMounted.current) return;
			setItems(finalItems);

			const reads = await getReadItems();
			if (!isMounted.current) return;
			setReadItems(reads);
			setStage("review");
		} catch {
			if (progressPollRef.current) {
				clearInterval(progressPollRef.current);
				progressPollRef.current = null;
			}
			if (!isMounted.current) return;
			setError("启动批量失败,请重试。");
			setStage("idle");
		} finally {
			if (isMounted.current) setBusy(false);
		}
	}

	async function handlePublish(item: BatchItem) {
		if (adminTabId == null) return;
		setPublishingItems((prev) => new Set([...prev, item.id]));
		try {
			const batch = await approveSingleItem(adminTabId, item.id);
			if (batch) setItems(batch.items);
		} catch {
			setError("发布失败，请重试。");
		} finally {
			setPublishingItems((prev) => {
				const next = new Set(prev);
				next.delete(item.id);
				return next;
			});
		}
	}

	async function handleApproveAll(items: BatchItem[]) {
		if (adminTabId == null) return;
		const targets = items.filter((it) => it.status === "awaiting-approval");
		for (const item of targets) {
			setPublishingItems((prev) => new Set([...prev, item.id]));
			try {
				const batch = await approveSingleItem(adminTabId, item.id);
				if (batch && isMounted.current) setItems(batch.items);
			} catch {
				if (isMounted.current) setError(`「${item.topic}」发布失败，已跳过。`);
			} finally {
				setPublishingItems((prev) => {
					const next = new Set(prev);
					next.delete(item.id);
					return next;
				});
			}
		}
	}

	async function handleRetry(itemId: string) {
		try {
			const batch = await retryBatchItemMsg(itemId);
			if (batch) setItems(batch.items);
		} catch {
			setError("重试失败，请重试。");
		}
	}

	function handleToggleRead(itemId: string) {
		void markItemRead(itemId).then(() => {
			setReadItems((prev) => new Set([...prev, itemId]));
		});
	}

	return {
		dailyBatchSize,
		adminTabId,
		tabError,
		busy,
		error,
		stage,
		items,
		readItems,
		publishingItems,
		setStage,
		setItems,
		setError,
		handleDailyBatch,
		handlePublish,
		handleApproveAll,
		handleRetry,
		handleToggleRead,
	};
}
