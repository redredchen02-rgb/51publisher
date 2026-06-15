---
title: SSRF 与 grounding-gate 测试覆盖核对
date: 2026-06-15
area: security-tests
plan: docs/plans/2026-06-15-001-refactor-release-readiness-remediation-plan.md
unit: C1
---

# SSRF / grounding-gate 测试覆盖核对（计划 C1）

体检报「SSRF DNS-rebind / grounding host 未测」，逐条核对结论如下。

## grounding-gate「host 不在 facts → block」— 已覆盖，无需新增

`packages/extension/lib/grounding-gate.test.ts:60–68`（`注入无来源连结 → 拦(defense-in-depth)`）已构造 `href="https://evil.com/x"`（host 不在 facts）并断言 `reasons` 含「无来源连结」。这正是体检要的场景。**未新增测试**。

## SSRF — 补一条多记录 DNS，其余已覆盖

`assertUrlSafe`（`ssrf-guard.ts:132–157`）**确实**调 `node:dns/promises` 的 `lookup(hostname, {all:true})` 并逐条校验所有解析地址（149 行循环）。核对：

| 场景 | 状态 |
|---|---|
| 字面私网/loopback/CGNAT/link-local IPv4 + IPv6 special + NAT64 + mapped + 元数据 169.254.169.254 | 已覆盖（`isPublicUnicastIp` 表驱动） |
| 字面 loopback host、localhost 解析、协议、凭证、重定向至 loopback、too-many-redirects | 已覆盖（`assertUrlSafe` / `safeFetch`） |
| **多记录 DNS 含一条私网（DNS 投毒/split-horizon）** | **此前未测 → 已补** |
| 真 DNS-rebind（assertUrlSafe 解析与 fetch 自身解析间的 TOCTOU） | **不在此层闭合**（见下） |

### 新增测试

`ssrf-guard.test.ts` 加 `vi.mock("node:dns/promises")` 委派包装（`mockResolvedValueOnce` 只覆盖单次调用，其余调用 delegate 真实解析，保留 localhost 等真测试行为）：
- `rejects a host whose multi-record DNS includes a private address` — lookup 返回 `[公网, 10.0.0.5]` → 期望 `SsrfError`。
- `accepts a host whose multi-record DNS is all public` — lookup 返回 `[公网, 公网]` → resolves。

### DNS-rebind 为已知接受残留

`ssrf-guard.ts:8–13` 注释明确：当前实现**不**钉死 IP 到 socket（无 undici custom-lookup dispatcher，刻意避免 native-fetch 版本偏移依赖），assertUrlSafe 与 fetch 各自解析之间存在小 TOCTOU 窗口，由上游 hostname allowlist 兜底。这是设计取舍，非缺陷；rebind 不在 C1 范围闭合。

## 结论

grounding 无需改；SSRF 补 2 条多记录用例（`ssrf-guard.test.ts` 16 passed）。体检报的「缺口」一处已存在、一处为已接受残留、一处为真缺口已补。
