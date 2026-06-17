import { useCallback, useEffect, useState } from "react";
import { resolveAdminTabId, runBatch } from "../../lib/messaging";
import {
	fetchAdapters,
	fetchPendingTopics,
	type PendingTopic,
	patchPendingTopic,
	triggerScrape,
	updatePendingStatus,
} from "../../lib/pending-client";
import { Loading } from "./Loading";
import { PendingTopicsNav } from "./pending/PendingTopicsNav";
import { QuickDraftBanner } from "./pending/QuickDraftBanner";
import { TopicActionBar } from "./pending/TopicActionBar";
import { TopicListItem } from "./pending/TopicListItem";

interface Props {
	onBack: () => void;
	onBatchStarted: () => void;
	onError: (msg: string) => void;
}

export function PendingTopicsView({ onBack, onBatchStarted, onError }: Props) {
	const [topics, setTopics] = useState<PendingTopic[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [localFacts, setLocalFacts] = useState<
		Record<string, Record<string, string>>
	>({});
	const [adapters, setAdapters] = useState<string[]>([]);
	const [scrapeStatus, setScrapeStatus] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [hideLowScore, setHideLowScore] = useState(false);
	const [quickDraftConfirm, setQuickDraftConfirm] = useState<PendingTopic[] | null>(null);
	const [quickDraftStatus, setQuickDraftStatus] = useState("");

	const refresh = useCallback(async () => {
		setLoading(true);
		const list = await fetchPendingTopics({ status: "pending", sort_by: "score", domain: "acg" });
		setTopics(list);
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
		void fetchAdapters().then(setAdapters);
	}, [refresh]);

	function toggleSelect(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	}

	function toggleExpand(id: string, facts: Record<string, string>) {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
		setLocalFacts((prev) => {
			if (prev[id] !== undefined) return prev;
			return { ...prev, [id]: { ...facts } };
		});
	}

	function setFactField(id: string, key: string, value: string) {
		setLocalFacts((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? {}), [key]: value },
		}));
	}

	async function runApproveAndBatch(approvedTopics: PendingTopic[]) {
		await Promise.all(
			approvedTopics.map(async (t) => {
				const edited = localFacts[t.id];
				if (edited) await patchPendingTopic(t.id, { facts: edited });
				await updatePendingStatus(t.id, "approved");
			}),
		);
		const adminTabId = await resolveAdminTabId();
		if (adminTabId == null) {
			onError("未找到后台发帖页标签——请先在浏览器打开后台发帖页。");
			return;
		}
		const topicList = approvedTopics.map((t) => t.title || t.sourceUrl);
		const factsList = approvedTopics.map((t) => localFacts[t.id] ?? t.facts);
		const coverUrls = approvedTopics.map((t) => t.coverImageUrl ?? "");
		await runBatch(
			topicList,
			adminTabId,
			factsList.length > 0 ? factsList : undefined,
			coverUrls.some((u) => u !== "") ? coverUrls : undefined,
		);
		setSelected(new Set());
		onBatchStarted();
	}

	async function handleApproveSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			await runApproveAndBatch(topics.filter((t) => selected.has(t.id)));
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleRejectSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			await Promise.all(
				topics
					.filter((t) => selected.has(t.id))
					.map((t) => updatePendingStatus(t.id, "rejected", "manual reject")),
			);
			setSelected(new Set());
			await refresh();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleQuickDraft() {
		setQuickDraftStatus("备稿中…");
		setQuickDraftConfirm(null);
		try {
			const sorted = await fetchPendingTopics({ status: "pending", sort_by: "score", domain: "acg" });
			if (sorted.length === 0) {
				setQuickDraftStatus("待审池暂无选题，请先抓取");
				return;
			}
			setQuickDraftStatus("");
			setQuickDraftConfirm(sorted.slice(0, 3));
		} catch {
			setQuickDraftStatus("获取选题失败，请重试");
		}
	}

	async function handleQuickDraftConfirm() {
		if (!quickDraftConfirm) return;
		const confirmedTopics = quickDraftConfirm;
		setQuickDraftConfirm(null);
		setQuickDraftStatus("");
		setSelected(new Set(confirmedTopics.map((t) => t.id)));
		setBusy(true);
		try {
			await runApproveAndBatch(confirmedTopics);
		} catch {
			onError("操作失败，请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleScrape() {
		const site = adapters.includes("acgs51") ? "acgs51" : (adapters[0] ?? null);
		if (!site) return;
		setScrapeStatus("抓取中…");
		await triggerScrape(site);
		setTimeout(() => {
			setScrapeStatus("");
			void refresh();
		}, 2000);
	}

	const visibleTopics = topics.filter(
		(t) => !hideLowScore || (t.qualityScore ?? t.confidence) >= 0.3,
	);

	return (
		<main
			className="fade-in"
			style={{
				fontFamily: "system-ui, sans-serif",
				padding: "var(--space-lg)",
				fontSize: "var(--font-md)",
			}}
		>
			<PendingTopicsNav
				busy={busy}
				adaptersAvailable={adapters.length > 0}
				quickDraftStatus={quickDraftStatus}
				onBack={onBack}
				onRefresh={() => void refresh()}
				onScrape={() => void handleScrape()}
				onQuickDraft={() => void handleQuickDraft()}
			/>

			{scrapeStatus && (
				<div
					className="text-warning"
					style={{ fontSize: "var(--font-sm)", marginBottom: "var(--space-sm)" }}
				>
					{scrapeStatus}
				</div>
			)}

			{quickDraftStatus && !quickDraftConfirm && (
				<div
					className={quickDraftStatus.startsWith("待审池") ? "text-muted" : "text-info"}
					style={{ fontSize: "var(--font-sm)", marginBottom: "var(--space-sm)" }}
				>
					{quickDraftStatus}
				</div>
			)}

			{quickDraftConfirm && (
				<QuickDraftBanner
					topics={quickDraftConfirm}
					busy={busy}
					onConfirm={() => void handleQuickDraftConfirm()}
					onCancel={() => { setQuickDraftConfirm(null); setQuickDraftStatus(""); }}
				/>
			)}

			{loading && <Loading />}

			{!loading && topics.length === 0 && (
				<div className="text-center text-muted" style={{ marginTop: "var(--space-xl)" }}>
					暂无待审核选题。
					<div style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)", color: "var(--color-text-disabled)" }}>
						可通过后端 POST /api/v1/scraper/trigger 抓取新内容。
					</div>
				</div>
			)}

			{topics.length > 0 && (
				<>
					<div className="flex-between" style={{ marginBottom: "var(--space-md)", alignItems: "center" }}>
						<span className="text-sm text-muted">
							{topics.length} 条待审核 · 已选 {selected.size} 条
						</span>
						{topics.some((t) => (t.qualityScore ?? t.confidence) < 0.3) && (
							<button
								type="button"
								className="btn btn-plain btn-sm"
								onClick={() => setHideLowScore((v) => !v)}
								style={{ fontSize: "var(--font-xs)" }}
							>
								{hideLowScore ? "显示全部" : "折叠低分（< 0.3）"}
							</button>
						)}
					</div>

					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{visibleTopics.map((t) => (
							<TopicListItem
								key={t.id}
								topic={t}
								selected={selected.has(t.id)}
								expanded={expanded.has(t.id)}
								localFacts={localFacts[t.id]}
								busy={busy}
								onToggleSelect={() => toggleSelect(t.id)}
								onToggleExpand={() => toggleExpand(t.id, t.facts)}
								onFactChange={(key, value) => setFactField(t.id, key, value)}
							/>
						))}
					</ul>

					<TopicActionBar
						selectedCount={selected.size}
						busy={busy}
						onApprove={() => void handleApproveSelected()}
						onReject={() => void handleRejectSelected()}
					/>
				</>
			)}
		</main>
	);
}
