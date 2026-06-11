import type { FactsBlock } from "@51publisher/shared";
import {
	type BetterSqlite3DB,
	getDb,
	pendingWriteQueue,
} from "./pending-db.js";
import type { RawContent } from "./site-adapter.js";

export type PendingStatus = "pending" | "approved" | "rejected";

export interface PendingTopic {
	id: string;
	sourceUrl: string;
	siteName: string;
	title: string;
	rawContent?: RawContent;
	facts: FactsBlock;
	confidence: number;
	status: PendingStatus;
	rejectedReason?: string;
	coverImageUrl?: string;
	score?: number;
	createdAt: string;
	updatedAt: string;
}

export interface PendingTopicPatch {
	facts?: FactsBlock;
	confidence?: number;
	status?: PendingStatus;
	rejectedReason?: string;
}

interface PendingRow {
	id: string;
	source_url: string;
	site_name: string;
	title: string;
	raw_content: string;
	facts: string;
	confidence: number;
	status: string;
	rejected_reason: string | null;
	cover_image_url: string | null;
	score: number | null;
	created_at: string;
	updated_at: string;
}

function rowToTopic(row: PendingRow): PendingTopic {
	return {
		id: row.id,
		sourceUrl: row.source_url,
		siteName: row.site_name,
		title: row.title,
		rawContent: row.raw_content
			? (JSON.parse(row.raw_content) as RawContent)
			: undefined,
		facts: JSON.parse(row.facts) as FactsBlock,
		confidence: row.confidence,
		status: row.status as PendingStatus,
		rejectedReason: row.rejected_reason ?? undefined,
		coverImageUrl: row.cover_image_url ?? undefined,
		score: row.score ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * 计算选题质量分 (0–1):
 *   score = fieldCompleteness × freshnessDecay × (1 − publishedPenalty)
 * - fieldCompleteness: {title, body, facts, coverImageUrl} 中非空字段占比
 * - freshnessDecay: exp(-daysSinceCreation / 7)，半衰期约 5 天
 * - publishedPenalty: 0.8（已发布 source_title 匹配），否则 0
 */
function computeScore(topic: PendingTopic, db: BetterSqlite3DB): number {
	const hasTitle = topic.title.trim().length > 0;
	const hasBody = !!topic.rawContent?.body?.trim();
	const hasFacts = Object.values(topic.facts ?? {}).some(
		(v) => v !== null && v !== undefined && v !== "",
	);
	const hasCover = !!topic.coverImageUrl;
	const fieldCompleteness =
		[hasTitle, hasBody, hasFacts, hasCover].filter(Boolean).length / 4;

	const daysSince =
		(Date.now() - Date.parse(topic.createdAt)) / (1000 * 60 * 60 * 24);
	const freshnessDecay = Math.exp(-daysSince / 7);

	let publishedPenalty = 0;
	try {
		const hit = db
			.prepare("SELECT id FROM published_posts WHERE source_title = ? LIMIT 1")
			.get(topic.title);
		if (hit) publishedPenalty = 0.8;
	} catch {
		// published_posts テーブルが存在しない場合（旧 DB）はペナルティなし
	}

	return fieldCompleteness * freshnessDecay * (1 - publishedPenalty);
}

export async function pendingTopicExistsBySourceUrl(
	url: string,
): Promise<boolean> {
	const db = getDb();
	return (
		db.prepare("SELECT 1 FROM pending_topics WHERE source_url = ?").get(url) !==
		undefined
	);
}

export async function loadPendingTopic(
	id: string,
): Promise<PendingTopic | null> {
	const db = getDb();
	const row = db.prepare("SELECT * FROM pending_topics WHERE id = ?").get(id) as
		| PendingRow
		| undefined;
	return row ? rowToTopic(row) : null;
}

export async function savePendingTopic(
	topic: PendingTopic,
): Promise<{ inserted: boolean }> {
	const db = getDb();
	topic.updatedAt = new Date().toISOString();
	return pendingWriteQueue.enqueue(() => {
		// 跨会话去重：source_url 已存在但 id 不同 → 跳过，不插入
		const existing = db
			.prepare("SELECT id FROM pending_topics WHERE source_url = ?")
			.get(topic.sourceUrl) as { id: string } | undefined;

		if (existing && existing.id !== topic.id) {
			return { inserted: false };
		}

		const score = computeScore(topic, db);

		db.prepare(
			`
      INSERT INTO pending_topics
        (id, source_url, site_name, title, raw_content, facts, confidence, status,
         rejected_reason, cover_image_url, score, created_at, updated_at)
      VALUES
        (@id, @sourceUrl, @siteName, @title, @rawContent, @facts, @confidence, @status,
         @rejectedReason, @coverImageUrl, @score, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        site_name  = excluded.site_name,
        title      = excluded.title,
        raw_content = excluded.raw_content,
        facts      = excluded.facts,
        confidence = excluded.confidence,
        status     = excluded.status,
        rejected_reason = excluded.rejected_reason,
        cover_image_url = excluded.cover_image_url,
        score      = excluded.score,
        updated_at = excluded.updated_at
    `,
		).run({
			id: topic.id,
			sourceUrl: topic.sourceUrl,
			siteName: topic.siteName,
			title: topic.title,
			rawContent: topic.rawContent ? JSON.stringify(topic.rawContent) : "{}",
			facts: JSON.stringify(topic.facts),
			confidence: topic.confidence,
			status: topic.status,
			rejectedReason: topic.rejectedReason ?? null,
			coverImageUrl: topic.coverImageUrl ?? null,
			score,
			createdAt: topic.createdAt,
			updatedAt: topic.updatedAt,
		});

		// existing 且同 id → upsert 更新；不存在 → 新插入
		return { inserted: existing === undefined };
	});
}

export async function listPendingTopics(
	limit?: number,
	status?: PendingStatus,
	sortBy?: "score" | "created_at",
): Promise<PendingTopic[]> {
	const db = getDb();
	const cap = Math.min(Math.max(limit ?? 50, 1), 500);
	const orderCol =
		sortBy === "score" ? "score DESC NULLS LAST" : "created_at DESC";
	let rows: PendingRow[];
	if (status !== undefined) {
		rows = db
			.prepare(
				`SELECT * FROM pending_topics WHERE status = ? ORDER BY ${orderCol} LIMIT ?`,
			)
			.all(status, cap) as PendingRow[];
	} else {
		rows = db
			.prepare(`SELECT * FROM pending_topics ORDER BY ${orderCol} LIMIT ?`)
			.all(cap) as PendingRow[];
	}
	return rows.map(rowToTopic);
}

export async function deletePendingTopic(id: string): Promise<void> {
	const db = getDb();
	await pendingWriteQueue.enqueue(() => {
		db.prepare("DELETE FROM pending_topics WHERE id = ?").run(id);
	});
}

export async function updatePendingTopicStatus(
	id: string,
	status: PendingStatus,
	rejectedReason?: string,
): Promise<PendingTopic | null> {
	const db = getDb();
	const now = new Date().toISOString();
	return pendingWriteQueue.enqueue(() => {
		const result = db
			.prepare(
				"UPDATE pending_topics SET status = ?, rejected_reason = ?, updated_at = ? WHERE id = ? RETURNING *",
			)
			.get(status, rejectedReason ?? null, now, id) as PendingRow | undefined;
		return result ? rowToTopic(result) : null;
	});
}
