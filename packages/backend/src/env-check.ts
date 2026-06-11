// Fail-closed startup validation of security-critical env vars.
// Refuses to start on weak/placeholder secrets so the running instance can
// never authenticate with known defaults.

import { URL } from 'node:url';
import { isHostAllowed, loadSSRFAllowlist } from './scraper/ssrf-allowlist.js';

const WEAK_SECRETS = new Set([
  '',
  'change-this-to-a-random-secret',
  'dev-secret-change-in-production',
  'secret',
  'changeme',
  'dev-secret',
]);

// salt(16 bytes = 32 hex) : key(64 bytes = 128 hex)
const HASH_RE = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

export function checkEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  const secret = env.JWT_SECRET ?? '';
  if (WEAK_SECRETS.has(secret) || secret.length < 32) {
    errors.push(
      'JWT_SECRET is missing, a known placeholder, or shorter than 32 chars. ' +
        "Generate: node -e \"console.log(require('node:crypto').randomBytes(48).toString('hex'))\"",
    );
  }

  const hash = env.JWT_ADMIN_PASSWORD_HASH ?? '';
  if (!HASH_RE.test(hash)) {
    errors.push(
      'JWT_ADMIN_PASSWORD_HASH is missing or not a valid salt:key hash. ' +
        'Generate: node packages/backend/scripts/hash-password.mjs',
    );
  }

  const corsOrigin = (env.CORS_ORIGIN ?? '').trim();
  if (!corsOrigin || corsOrigin === '*') {
    errors.push(
      "CORS_ORIGIN is not set or is '*'. Set it to your extension's origin, e.g. " +
        'chrome-extension://<extension-id>. Comma-separate for dev+prod IDs. ' +
        "Wildcard '*' is rejected to prevent open cross-origin access.",
    );
  }

  // 抓取防呆:仅当启用 acgs51 抓取时校验。adapter 是单条详情页解析器,
  // START_URL 必须是具体详情页且 host 在 SSRF allowlist 内,不启用则零影响。
  if (env.ACGS51_ENABLED === 'true') {
    const startUrl = (env.ACGS51_START_URL ?? '').trim();
    if (!startUrl) {
      errors.push(
        'ACGS51_ENABLED=true but ACGS51_START_URL is missing or blank. ' +
          'Set it to a concrete content detail page URL (the adapter parses a single ' +
          'detail page, not a homepage). See .env.example for the expected form.',
      );
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(startUrl);
      } catch {
        errors.push(
          `ACGS51_START_URL is not a valid URL: "${startUrl}". ` +
            'Set it to a concrete content detail page URL, e.g. ' +
            'https://51acgs.com/acg/12345.html (see .env.example).',
        );
      }
      if (parsed && !isHostAllowed(parsed, loadSSRFAllowlist(env))) {
        errors.push(
          `ACGS51_START_URL host "${parsed.hostname}" is not covered by ALLOWED_HOSTS. ` +
            'Add it to ALLOWED_HOSTS (comma-separated, see .env.example) or fix the URL. ' +
            'Empty ALLOWED_HOSTS denies all hosts (fail-closed).',
        );
      }
    }

    // ACGS51_LIST_URL: 可选；若填写则必须是合法 URL 且 host 在 allowlist 内
    const listUrl = (env.ACGS51_LIST_URL ?? '').trim();
    if (listUrl) {
      let parsedList: URL | null = null;
      try {
        parsedList = new URL(listUrl);
      } catch {
        errors.push(
          `ACGS51_LIST_URL is not a valid URL: "${listUrl}". ` +
            'Set it to the list/index page of the acgs51 site (e.g. https://51acgs.com/acg/).',
        );
      }
      if (parsedList && !isHostAllowed(parsedList, loadSSRFAllowlist(env))) {
        errors.push(
          `ACGS51_LIST_URL host "${parsedList.hostname}" is not covered by ALLOWED_HOSTS. ` +
            'Add it to ALLOWED_HOSTS or fix the URL.',
        );
      }
    }

    // ACGS51_LIST_BUDGET: 可选；若填写必须是正整数
    const budgetStr = (env.ACGS51_LIST_BUDGET ?? '').trim();
    if (budgetStr) {
      const n = Number(budgetStr);
      if (!Number.isInteger(n) || n < 1) {
        errors.push(`ACGS51_LIST_BUDGET must be a positive integer (got "${budgetStr}"). ` + 'Default is 20 if unset.');
      }
    }
  }

  // Revisit job: REVISIT_ALLOWED_HOSTS must not be wildcard when set
  const revisitHosts = (env.REVISIT_ALLOWED_HOSTS ?? '').trim();
  if (revisitHosts === '*') {
    errors.push(
      "REVISIT_ALLOWED_HOSTS must not be '*'. Set it to the specific hostname(s) of your self-hosted " +
        'admin panel (comma-separated). Empty = fail-closed (revisit job skips all rows).',
    );
  }

  if (env.TG_ENABLED === 'true') {
    const token = (env.TG_BOT_TOKEN ?? '').trim();
    if (!token) {
      errors.push('TG_ENABLED=true but TG_BOT_TOKEN is missing or blank.');
    } else if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      errors.push(
        'TG_BOT_TOKEN does not match the expected Bot Token format (numeric_id:secret). ' +
          'Get it from @BotFather on Telegram.',
      );
    }
    if (!(env.TG_CHAT_ID ?? '').trim()) {
      errors.push('TG_ENABLED=true but TG_CHAT_ID is missing or blank.');
    }
  }

  return errors;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = checkEnv(env);
  if (errors.length > 0) {
    throw new Error('Fail-closed env check failed:\n  - ' + errors.join('\n  - '));
  }
}
