import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type Batch,
	type BatchItemStatus,
	recoverBatch,
} from "@51publisher/shared";

export type { Batch, BatchItemStatus };
export { recoverBatch };

// ---- 文件持久层(轻量 JSON) ----

const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");
const BATCHES_DIR = join(DATA_DIR, "batches");

async function ensureDir(dir: string): Promise<void> {
	if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

function batchFilePath(batchId: string): string {
	// 过滤路径注入
	const safe = batchId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(BATCHES_DIR, `${safe}.json`);
}

export async function loadBatch(batchId: string): Promise<Batch | null> {
	const fp = batchFilePath(batchId);
	if (!existsSync(fp)) return null;
	try {
		const raw = await readFile(fp, "utf-8");
		return JSON.parse(raw) as Batch;
	} catch {
		return null;
	}
}

export async function saveBatch(batch: Batch): Promise<void> {
	await ensureDir(BATCHES_DIR);
	batch.updatedAt = new Date().toISOString();
	await writeFile(
		batchFilePath(batch.id),
		JSON.stringify(batch, null, 2),
		"utf-8",
	);
}

/**
 * 列出所有持久化批次(最近的排前面)。
 * 轻量实现:逐个读 JSON;高并发场景应替换为 SQLite。
 */
export async function listBatches(limit = 50): Promise<Batch[]> {
	await ensureDir(BATCHES_DIR);
	const { readdir } = await import("node:fs/promises");
	const files = await readdir(BATCHES_DIR);
	// Read all batches then sort by updatedAt — readdir order is arbitrary, so
	// slicing before the sort could drop a recently-updated batch.
	const jsonFiles = files.filter((f) => f.endsWith(".json"));

	const batches: Batch[] = [];
	for (const f of jsonFiles) {
		try {
			const raw = await readFile(join(BATCHES_DIR, f), "utf-8");
			batches.push(JSON.parse(raw) as Batch);
		} catch {
			// skip corrupt
		}
	}
	// 最近更新排前
	batches.sort(
		(a, b) =>
			new Date(b.updatedAt ?? b.createdAt).getTime() -
			new Date(a.updatedAt ?? a.createdAt).getTime(),
	);
	return batches.slice(0, limit);
}
