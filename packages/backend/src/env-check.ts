// Fail-closed startup validation of security-critical env vars.
// Refuses to start on weak/placeholder secrets so the running instance can
// never authenticate with known defaults.

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

  return errors;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = checkEnv(env);
  if (errors.length > 0) {
    throw new Error('Fail-closed env check failed:\n  - ' + errors.join('\n  - '));
  }
}
