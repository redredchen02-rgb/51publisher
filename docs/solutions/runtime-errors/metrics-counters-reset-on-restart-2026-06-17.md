---
title: "Metrics counters always zero — in-memory state resets on server restart"
date: 2026-06-17
category: runtime-errors
module: metrics
problem_type: runtime_error
component: database
severity: medium
symptoms:
  - "/api/v1/metrics always returns 0 for all counters (drafts, batches, publish attempts)"
  - "Prometheus scrape shows publisher_drafts_total{status=\"success\"} 0 even after successful draft generations"
  - "Server restart clears all counter values regardless of production activity"
root_cause: config_error
resolution_type: code_fix
related_components:
  - background_job
  - service_object
tags:
  - metrics
  - prometheus
  - sqlite
  - in-memory
  - persistence
  - counter
  - runtime-reset
---

# Metrics counters always zero — in-memory state resets on server restart

## Problem

`packages/backend/src/services/metrics.ts` stored all Prometheus counters (`draftsGenerated`, `batchesCompleted`, `scraperRuns`, `publishAttempts`) as module-level JavaScript variables. These reset to zero on every server restart, making the `/api/v1/metrics` endpoint always report 0 for all metrics in production. Surfaced by adversarial review in PR #34 (auto memory [claude]).

## Symptoms

- `GET /api/v1/metrics` returns `0` for all counter values regardless of actual activity
- Prometheus dashboards show flat lines across all `publisher_*` metrics
- Counters reset after any process exit — deploy, crash, `pnpm start` restart
- Bug is silent: no error is thrown, the endpoint returns HTTP 200 with plausible-looking but wrong data

## What Didn't Work

Module-level variables were the original design and work correctly within a single process lifetime. They are incompatible with long-running production services that restart:

```typescript
// Original — resets to 0 on every restart
export const counters = {
  draftsGenerated: 0,
  draftsFailed: 0,
  batchesCompleted: 0,
  scraperRuns: { success: 0, failed: 0 },
  publishAttempts: { success: 0, failed: 0 },
};
```

## Solution

Replace in-memory variables with SQLite upserts using `ON CONFLICT ... DO UPDATE SET value = value + 1`. Expose a backward-compatible `counters` Proxy so existing call sites don't break.

```typescript
// metrics table DDL (run once on first call)
// CREATE TABLE IF NOT EXISTS metrics (
//   key TEXT PRIMARY KEY,
//   value INTEGER NOT NULL DEFAULT 0
// )

function increment(key: string): void {
  ensureTable();
  getDb()
    .prepare(
      `INSERT INTO metrics (key, value) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1`,
    )
    .run(key);
}

export function recordDraft(ok: boolean): void {
  increment(ok ? "drafts_generated" : "drafts_failed");
}

export function getMetrics(): string {
  // reads from DB via read("drafts_generated"), etc.
  const lines = [
    `publisher_drafts_total{status="success"} ${read("drafts_generated")}`,
    // ...
  ];
  return lines.join("\n") + "\n";
}

// Backward-compat: code that accesses counters.draftsGenerated still works
export const counters = new Proxy({} as CountersShape, {
  get(_t, prop) { return read(propToKey(prop as string)); },
  set(_t, prop, value) { set(propToKey(prop as string), value); return true; },
});
```

The `getDb()` call returns an in-memory SQLite instance in tests (`:memory:`), so the persistence strategy works in both test and production without mocking.

## Why This Works

Module-level variables live in Node.js heap and are garbage-collected when the process exits. SQLite's WAL mode persists data to disk atomically. The `ON CONFLICT ... DO UPDATE SET value = value + 1` upsert is atomic — safe under concurrent requests without additional locking.

## Prevention

1. **Never use module-level variables for state that must survive restarts.** Use SQLite, Redis, or a file-backed store for any counter intended to be observable across process lifetimes.

2. **Assert counter values in tests, not just HTTP status codes:**

```typescript
it("recordDraft increments drafts_generated counter", async () => {
  recordDraft(true);
  recordDraft(true);
  const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
  expect(res.body).toContain('publisher_drafts_total{status="success"} 2');
});
```

Tests that only check `res.statusCode === 200` give false confidence — the bug was present for months with all status-code tests passing.

3. **Add a liveness signal**: if all counters are 0 after the service has been running for >1 hour and has received traffic, treat it as a silent failure indicator.

## Related Issues

- Commit `3dcbc9cf` — fix implementation
- PR #34 adversarial review — original bug discovery (auto memory [claude])
- `docs/solutions/developer-experience/extension-http-client-testability-injection-seam-2026-06-15.md` — related pattern: use `getDb()` injection seam for testability
