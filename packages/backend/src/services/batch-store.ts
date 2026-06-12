import { dirname, join } from "node:path";
import {
	type Batch,
	type BatchItemStatus,
	recoverBatch,
} from "@51publisher/shared";
import { JsonFileStore } from "../utils/json-store.js";

export type { Batch, BatchItemStatus };
export { recoverBatch };

// ---- 文件持久层(轻量 JSON) ----

const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");
const BATCHES_DIR = join(DATA_DIR, "batches");

const batchStore = new JsonFileStore<Batch>({
	dirPath: BATCHES_DIR,
	updatedAtKey: "updatedAt",
});

export async function loadBatch(batchId: string): Promise<Batch | null> {
	return batchStore.read(batchId);
}

export async function saveBatch(batch: Batch): Promise<void> {
	return batchStore.write(batch);
}

/**
 * 列出所有持久化批次(最近的排前面)。
 * 轻量实现:逐个读 JSON;高并发场景应替换为 SQLite。
 */
export async function listBatches(limit = 50): Promise<Batch[]> {
	return batchStore.list({ limit });
}
