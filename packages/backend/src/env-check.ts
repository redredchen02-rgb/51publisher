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
  }

  return errors;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = checkEnv(env);
  if (errors.length > 0) {
    throw new Error('Fail-closed env check failed:\n  - ' + errors.join('\n  - '));
  }
}
