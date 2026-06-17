import { getDb, initPendingDb } from "../scraper/pending-db.js";

function ensureTable(): void {
	initPendingDb();
	getDb().exec(
		`CREATE TABLE IF NOT EXISTS metrics (
			key TEXT PRIMARY KEY,
			value INTEGER NOT NULL DEFAULT 0
		)`,
	);
}

function increment(key: string): void {
	ensureTable();
	getDb()
		.prepare(
			`INSERT INTO metrics (key, value) VALUES (?, 1)
			 ON CONFLICT(key) DO UPDATE SET value = value + 1`,
		)
		.run(key);
}

function read(key: string): number {
	ensureTable();
	const row = getDb()
		.prepare("SELECT value FROM metrics WHERE key = ?")
		.get(key) as { value: number } | undefined;
	return row?.value ?? 0;
}

function set(key: string, value: number): void {
	ensureTable();
	getDb()
		.prepare(
			`INSERT INTO metrics (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.run(key, value);
}

type NestedCounter = { success: number; failed: number };

function makeNestedProxy(successKey: string, failedKey: string): NestedCounter {
	return new Proxy({} as NestedCounter, {
		get(_t, prop) {
			if (prop === "success") return read(successKey);
			if (prop === "failed") return read(failedKey);
		},
		set(_t, prop, value: number) {
			if (prop === "success") set(successKey, value);
			else if (prop === "failed") set(failedKey, value);
			return true;
		},
	});
}

// Kept for backward-compat — proxies live DB reads/writes.
export const counters = new Proxy(
	{} as {
		draftsGenerated: number;
		draftsFailed: number;
		batchesCompleted: number;
		scraperRuns: NestedCounter;
		publishAttempts: NestedCounter;
	},
	{
		get(_t, prop) {
			if (prop === "scraperRuns")
				return makeNestedProxy("scraper_runs_success", "scraper_runs_failed");
			if (prop === "publishAttempts")
				return makeNestedProxy(
					"publish_attempts_success",
					"publish_attempts_failed",
				);
			const keyMap: Record<string, string> = {
				draftsGenerated: "drafts_generated",
				draftsFailed: "drafts_failed",
				batchesCompleted: "batches_completed",
			};
			return read(keyMap[prop as string] ?? String(prop));
		},
		set(_t, prop, value: number) {
			const keyMap: Record<string, string> = {
				draftsGenerated: "drafts_generated",
				draftsFailed: "drafts_failed",
				batchesCompleted: "batches_completed",
			};
			const k = keyMap[prop as string];
			if (k) set(k, value);
			return true;
		},
	},
);

export function recordDraft(ok: boolean): void {
	increment(ok ? "drafts_generated" : "drafts_failed");
}

export function recordScraperRun(ok: boolean): void {
	increment(ok ? "scraper_runs_success" : "scraper_runs_failed");
}

export function recordPublishAttempt(ok: boolean): void {
	increment(ok ? "publish_attempts_success" : "publish_attempts_failed");
}

export function recordBatchCompleted(): void {
	increment("batches_completed");
}

export function getMetrics(): string {
	const lines = [
		"# HELP publisher_drafts_total Total drafts generated",
		"# TYPE publisher_drafts_total counter",
		`publisher_drafts_total{status="success"} ${read("drafts_generated")}`,
		`publisher_drafts_total{status="failed"} ${read("drafts_failed")}`,
		"",
		"# HELP publisher_batches_total Total batches completed",
		"# TYPE publisher_batches_total counter",
		`publisher_batches_total ${read("batches_completed")}`,
		"",
		"# HELP publisher_scraper_runs_total Total scraper runs",
		"# TYPE publisher_scraper_runs_total counter",
		`publisher_scraper_runs_total{status="success"} ${read("scraper_runs_success")}`,
		`publisher_scraper_runs_total{status="failed"} ${read("scraper_runs_failed")}`,
		"",
		"# HELP publisher_publish_attempts_total Total publish attempts",
		"# TYPE publisher_publish_attempts_total counter",
		`publisher_publish_attempts_total{status="success"} ${read("publish_attempts_success")}`,
		`publisher_publish_attempts_total{status="failed"} ${read("publish_attempts_failed")}`,
	];
	return `${lines.join("\n")}\n`;
}
