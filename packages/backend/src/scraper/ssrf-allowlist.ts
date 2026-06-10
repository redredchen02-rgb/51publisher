import { URL } from 'node:url';

interface Pattern {
  hostname: string;
  wildcard: boolean;
  protocol?: string;
}

function compilePattern(raw: string): Pattern | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let rest = trimmed.replace(/^https?:\/\//, '').split('/')[0];
  if (!rest) return null;
  const wildcard = rest.startsWith('*.');
  const hostname = wildcard ? rest.slice(2) : rest;
  const protocol = trimmed.startsWith('http://') ? 'http:' : trimmed.startsWith('https://') ? 'https:' : undefined;
  return { hostname, wildcard, protocol };
}

function matches(pattern: Pattern, candidate: URL): boolean {
  if (pattern.protocol && candidate.protocol !== pattern.protocol) return false;
  const ch = candidate.hostname.toLowerCase();
  if (pattern.wildcard) {
    return ch === pattern.hostname.toLowerCase() || ch.endsWith('.' + pattern.hostname.toLowerCase());
  }
  return ch === pattern.hostname.toLowerCase();
}

export interface SSRFConfig {
  allowedHosts: Pattern[];
  mode: 'fail-closed';
}

// env 参数化以便 env-check 等调用方传入受测环境;默认行为不变。
export function loadSSRFAllowlist(env: NodeJS.ProcessEnv = process.env): SSRFConfig {
  const raw = env.ALLOWED_HOSTS ?? '';
  const patterns: Pattern[] = [];
  for (const part of raw.split(',')) {
    const p = compilePattern(part);
    if (p) patterns.push(p);
  }
  return { allowedHosts: patterns, mode: 'fail-closed' };
}

export function isHostAllowed(url: URL, config: SSRFConfig): boolean {
  if (config.allowedHosts.length === 0) return false;
  return config.allowedHosts.some((p) => matches(p, url));
}
