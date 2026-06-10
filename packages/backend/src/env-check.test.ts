import { describe, it, expect } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { checkEnv, validateEnv } from './env-check.js';

function goodHash(): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync('pw', salt, 64).toString('hex')}`;
}

const strongSecret = randomBytes(48).toString('hex');

describe('checkEnv', () => {
  it('passes with a strong secret and a valid hash', () => {
    expect(checkEnv({ JWT_SECRET: strongSecret, JWT_ADMIN_PASSWORD_HASH: goodHash() })).toEqual([]);
  });

  it('rejects known placeholder secrets', () => {
    const errors = checkEnv({
      JWT_SECRET: 'change-this-to-a-random-secret',
      JWT_ADMIN_PASSWORD_HASH: goodHash(),
    });
    expect(errors.some((e) => e.includes('JWT_SECRET'))).toBe(true);
  });

  it('rejects the legacy dev secret', () => {
    const errors = checkEnv({
      JWT_SECRET: 'dev-secret-change-in-production',
      JWT_ADMIN_PASSWORD_HASH: goodHash(),
    });
    expect(errors.some((e) => e.includes('JWT_SECRET'))).toBe(true);
  });

  it('rejects a too-short secret', () => {
    const errors = checkEnv({ JWT_SECRET: 'short', JWT_ADMIN_PASSWORD_HASH: goodHash() });
    expect(errors.some((e) => e.includes('JWT_SECRET'))).toBe(true);
  });

  it('rejects a missing or placeholder admin hash', () => {
    expect(checkEnv({ JWT_SECRET: strongSecret, JWT_ADMIN_PASSWORD_HASH: '' }).length).toBe(1);
    expect(checkEnv({ JWT_SECRET: strongSecret, JWT_ADMIN_PASSWORD_HASH: 'change-this' }).length).toBe(1);
  });

  it('validateEnv throws on bad env', () => {
    expect(() => validateEnv({ JWT_SECRET: '', JWT_ADMIN_PASSWORD_HASH: '' })).toThrow(/Fail-closed/);
  });

  it('validateEnv does not throw on good env', () => {
    expect(() => validateEnv({ JWT_SECRET: strongSecret, JWT_ADMIN_PASSWORD_HASH: goodHash() })).not.toThrow();
  });
});
