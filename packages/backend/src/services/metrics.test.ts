import { describe, expect, it } from "vitest";
import {
	counters,
	getMetrics,
	recordBatchCompleted,
	recordDraft,
	recordPublishAttempt,
	recordScraperRun,
} from "./metrics.js";

describe("metrics", () => {
	it("starts with zero counters", () => {
		expect(counters.draftsGenerated).toBe(0);
		expect(counters.draftsFailed).toBe(0);
		expect(counters.batchesCompleted).toBe(0);
		expect(counters.scraperRuns.success).toBe(0);
		expect(counters.scraperRuns.failed).toBe(0);
		expect(counters.publishAttempts.success).toBe(0);
		expect(counters.publishAttempts.failed).toBe(0);
	});

	it("recordDraft increments correct counter", () => {
		recordDraft(true);
		expect(counters.draftsGenerated).toBe(1);
		recordDraft(false);
		expect(counters.draftsFailed).toBe(1);
	});

	it("recordScraperRun increments correct counter", () => {
		recordScraperRun(true);
		expect(counters.scraperRuns.success).toBe(1);
		recordScraperRun(false);
		expect(counters.scraperRuns.failed).toBe(1);
	});

	it("recordPublishAttempt increments correct counter", () => {
		recordPublishAttempt(true);
		expect(counters.publishAttempts.success).toBe(1);
		recordPublishAttempt(false);
		expect(counters.publishAttempts.failed).toBe(1);
	});

	it("recordBatchCompleted increments counter", () => {
		recordBatchCompleted();
		expect(counters.batchesCompleted).toBe(1);
	});

	it("getMetrics returns Prometheus text format", () => {
		const output = getMetrics();
		expect(output).toContain("# HELP publisher_drafts_total");
		expect(output).toContain("# TYPE publisher_drafts_total counter");
		expect(output).toContain("# HELP publisher_batches_total");
		expect(output).toContain("# HELP publisher_scraper_runs_total");
		expect(output).toContain("# HELP publisher_publish_attempts_total");
		expect(output).toMatch(/publisher_drafts_total{status="success"} \d+/);
	});
});
