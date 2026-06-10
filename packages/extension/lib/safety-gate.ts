import type { SafetyMode } from '@51publisher/shared';

// 授权站点发布闸门(纯函数,无副作用、不碰 chrome/#imports)。
// 安全脊柱:host 必须由 background 从 chrome.tabs.get(tabId).url 取,
// 绝不接受消息携带的 host;此模块只做"给定 host/mode/名单,能否提交"的判定。
//
// 设计取舍见计划 Key Decisions:lowercase → 去尾点 → 拒非法 hostname →
// 按 label 切 → 精确或"通配吃 ≥1 整 label"的标签边界匹配;裸 apex 默认不匹配。

export interface GateInput {
  /** 目标 tab 的 host(background 取自 chrome.tabs.get(tabId).url 的 hostname)。 */
  host: string;
  mode: SafetyMode;
  /** 授权名单:精确 host(如 dx-999-adm.ympxbys.xyz)或通配(*.ympxbys.xyz)。 */
  authorizedHosts: string[];
}

// 合法 DNS label:ASCII 字母数字与连字符,首尾不为连字符。
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function isNumericLabel(label: string): boolean {
  return /^[0-9]+$/.test(label);
}

/**
 * 规范化 host;非法返回 null(调用方一律按"不匹配/fail-closed"处理)。
 * 拒:非 [a-z0-9.-] 字符(含 @ : / ? # 空白 \0 与非 ASCII)、空 label、
 *     punycode(xn--)、IP 字面量(末 label 全数字)。
 */
export function normalizeHost(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let host = raw.toLowerCase();
  // 去单个尾点(FQDN 根),但不接受多重尾点。
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0) return null;
  // 字符集闸:任何非 [a-z0-9.-] 一律拒(@ : / ? # 空白 \0 非 ASCII 都落这)。
  if (!/^[a-z0-9.-]+$/.test(host)) return null;

  const labels = host.split('.');
  if (labels.length < 2) return null; // 单 label 不是可发布的 host
  for (const label of labels) {
    if (label.length === 0) return null; // 空 label(双点 / 首点)
    if (!LABEL_RE.test(label)) return null; // 首尾连字符等
    if (label.startsWith('xn--')) return null; // punycode/IDN
  }
  // IP 字面量:末 label(伪 TLD)全数字即拒(干掉 1.2.3.4 / 0x7f.1)。
  const tld = labels[labels.length - 1];
  if (tld === undefined || isNumericLabel(tld)) return null;

  return host;
}

/** 把 host 切成已规范化的 label 数组;非法 host → null。 */
function toLabels(rawHost: string): string[] | null {
  const h = normalizeHost(rawHost);
  return h ? h.split('.') : null;
}

/**
 * host 是否匹配单个 pattern。
 * - 精确 pattern:label 数组完全相等。
 * - 通配 `*.suffix`:host 以 suffix 的 label 序列在标签边界结尾,且至少多出 1 个 label
 *   (裸 apex == suffix 不匹配)。
 * pattern 非法 → false。
 */
export function labelBoundaryMatch(rawHost: string, rawPattern: string): boolean {
  const hostLabels = toLabels(rawHost);
  if (!hostLabels) return false;

  if (typeof rawPattern !== 'string') return false;
  const pattern = rawPattern.toLowerCase().trim();

  if (pattern.startsWith('*.')) {
    const suffixLabels = toLabels(pattern.slice(2));
    if (!suffixLabels) return false;
    // 至少多 1 个 label(吃 ≥1 整 label),裸 apex 不算。
    if (hostLabels.length <= suffixLabels.length) return false;
    return endsWithLabels(hostLabels, suffixLabels);
  }

  const patternLabels = toLabels(pattern);
  if (!patternLabels) return false;
  return arraysEqual(hostLabels, patternLabels);
}

function endsWithLabels(host: string[], suffix: string[]): boolean {
  const offset = host.length - suffix.length;
  for (let i = 0; i < suffix.length; i += 1) {
    if (host[offset + i] !== suffix[i]) return false;
  }
  return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 闸门主判定:仅当 mode==='authorized' 且 host 命中某授权 pattern 才放行。
 * off/dry-run 永远返回 false(由 background"不发准许"兜结构性保证)。
 */
export function canSubmit(input: GateInput): boolean {
  if (input.mode !== 'authorized') return false;
  if (normalizeHost(input.host) === null) return false;
  if (!Array.isArray(input.authorizedHosts) || input.authorizedHosts.length === 0) return false;
  return input.authorizedHosts.some((pattern) => labelBoundaryMatch(input.host, pattern));
}
