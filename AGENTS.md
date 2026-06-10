# 51publisher

Monorepo: `packages/backend/` (Fastify 5 + TS, port 3001) + `packages/extension/` (WXT + React 19 + MV3)

## Auto-Memory (session-wrap)
On session start, read `.ai-memory/*.md` for project context and learnings from prior sessions.

## Local setup (fresh clone)
Git hooks are not auto-installed by clone — enable them once:

```
git config core.hooksPath scripts/git-hooks
```

This activates the pre-commit type-check + fixture-redaction gate and the
pre-push secret scan (install `gitleaks` for the strong scan; a pattern
fallback runs otherwise).

Backend env: copy `packages/backend/.env.example` → `.env` and fill real
values. The backend refuses to start on weak/placeholder `JWT_SECRET` or
`JWT_ADMIN_PASSWORD_HASH` (fail-closed). Generate strong values:

```
# JWT secret
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# Admin password hash (salt:scryptHex) — prompts for the password
node packages/backend/scripts/hash-password.mjs
```

Build order matters: `@51publisher/shared` must build its `dist/` before
backend/extension type-check. `pnpm -r compile` handles this in topological
order (shared has a `compile` script that emits dist).
