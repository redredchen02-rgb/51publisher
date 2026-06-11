export const counters = {
	draftsGenerated: 0,
	draftsFailed: 0,
	batchesCompleted: 0,
	scraperRuns: { success: 0, failed: 0 },
	publishAttempts: { success: 0, failed: 0 },
};

export function getMetrics(): string {
	const lines = [
		"# HELP publisher_drafts_total Total drafts generated",
		"# TYPE publisher_drafts_total counter",
		`publisher_drafts_total{status="success"} ${counters.draftsGenerated}`,
		`publisher_drafts_total{status="failed"} ${counters.draftsFailed}`,
		"",
		"# HELP publisher_batches_total Total batches completed",
		"# TYPE publisher_batches_total counter",
		`publisher_batches_total ${counters.batchesCompleted}`,
		"",
		"# HELP publisher_scraper_runs_total Total scraper runs",
		"# TYPE publisher_scraper_runs_total counter",
		`publisher_scraper_runs_total{status="success"} ${counters.scraperRuns.success}`,
		`publisher_scraper_runs_total{status="failed"} ${counters.scraperRuns.failed}`,
		"",
		"# HELP publisher_publish_attempts_total Total publish attempts",
		"# TYPE publisher_publish_attempts_total counter",
		`publisher_publish_attempts_total{status="success"} ${counters.publishAttempts.success}`,
		`publisher_publish_attempts_total{status="failed"} ${counters.publishAttempts.failed}`,
	];
	return `${lines.join("\n")}\n`;
}
