import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Deny-unless-global-unicast SSRF guard for scraper fetches.
//
// Strategy: before each fetch (and on every redirect hop) resolve the host and
// reject if any resolved address is non-public (private / loopback / link-local
// / CGNAT / IPv6 special). This is dependency-free; it does NOT pin the resolved
// IP to the socket, so a small TOCTOU window remains between this lookup and
// fetch's own resolution. That residual is bounded by the hostname allowlist
// applied upstream (scraper-routes). Full pinning would require an undici
// custom-lookup dispatcher (deliberately avoided to not add a native-fetch
// version-skew dependency).

export class SsrfError extends Error {}

function isPublicV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return false; // 0.0.0.0/8 "this host"
  if (a === 10) return false; // 10/8 private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return false; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 168) return false; // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18/15 benchmark
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113/24 TEST-NET-3
  if (a >= 224) return false; // 224/4 multicast, 240/4 reserved, 255.255.255.255
  return true;
}

function isPublicV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false; // loopback / unspecified
  // IPv4-mapped (::ffff:x), NAT64 (64:ff9b::x), v4-compat: validate embedded v4.
  const embedded = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return isPublicV4(embedded[1]!);
  const firstHextet = lower.split(':').find((h) => h !== '');
  if (!firstHextet) return false;
  const fh = Number.parseInt(firstHextet, 16);
  if (Number.isNaN(fh)) return false;
  if (fh >= 0xfc00 && fh <= 0xfdff) return false; // fc00::/7 unique-local
  if (fh >= 0xfe80 && fh <= 0xfebf) return false; // fe80::/10 link-local
  if (fh >= 0xff00) return false; // ff00::/8 multicast
  return true;
}

export function isPublicUnicastIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind === 6) return isPublicV6(ip);
  return false;
}

export async function assertUrlSafe(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError(`Disallowed protocol: ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new SsrfError('URL credentials not allowed');
  }
  const addrs = await lookup(u.hostname, { all: true, verbatim: true });
  if (addrs.length === 0) {
    throw new SsrfError(`No DNS records for ${u.hostname}`);
  }
  for (const { address } of addrs) {
    if (!isPublicUnicastIp(address)) {
      throw new SsrfError(`Host ${u.hostname} resolves to non-public address ${address}`);
    }
  }
  return u;
}

// fetch wrapper: validates the target (and every redirect hop) before connecting.
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxHops = 5): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertUrlSafe(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError(`Too many redirects (>${maxHops})`);
}
