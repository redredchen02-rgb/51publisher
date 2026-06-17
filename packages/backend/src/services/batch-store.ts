import {
	type Batch,
	type BatchItemStatus,
	recoverBatch,
} from "@51guapi/shared";
import { getDb, pendingWriteQueue } from "../scraper/pending-db.js";

export type { Batch, BatchItemStatus };
export { recoverBatch };

// ---- SQLite 持久层 ----

interface BatchRow {
	id: string;
	tab_id: number;
	authorized_host: string;
	items: string;
	created_at: string;
	updated_at: string;
}

function rowToBatch(row: BatchRow): Batch {
	const items = JSON.parse(row.items) as Batch["items"];
	return {
		id: row.id,
		tabId: row.tab_id,
		authorizedHost: row.authorized_host,
		items,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function loadBatch(batchId: string): Promise<Batch | null> {
	const db = getDb();
	const row = db.prepare("SELECT * FROM batches WHERE id = ?").get(batchId) as
		| BatchRow
		| undefined;
	return row ? rowToBatch(row) : null;
}

export async function saveBatch(batch: Batch): Promise<void> {
	const now = new Date().toISOString();
	const items = JSON.stringify(batch.items);

	await pendingWriteQueue.enqueue(() => {
		const db = getDb();
		db.prepare(
			`INSERT INTO batches (id, tab_id, authorized_host, items, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   tab_id = excluded.tab_id,
			   authorized_host = excluded.authorized_host,
			   items = excluded.items,
			   updated_at = excluded.updated_at`,
		).run(
			batch.id,
			batch.tabId,
			batch.authorizedHost,
			items,
			batch.createdAt ?? now,
			now,
		);
	});
}

/**
 * 列出所有持久化批次(最近的排前面)。
 */
export async function listBatches(limit = 50): Promise<Batch[]> {
	const db = getDb();
	const rows = db
		.prepare("SELECT * FROM batches ORDER BY updated_at DESC LIMIT ?")
		.all(limit) as BatchRow[];
	return rows.map(rowToBatch);
}
