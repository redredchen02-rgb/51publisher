import type { PublishResult, SafetyMode } from '@51publisher/shared';

// 发布派发编排(background 侧逻辑,效果全注入,便于单测)。
// 安全脊柱:
//   - 只有 mode==='authorized' 且 host 命中(gate.allowed)才发"准许";
//   - 副作用前 **await** 写盘 publish-dispatched 成功,**再**发准许(崩溃幂等);
//   - off / dry-run / host 不符:绝不发准许、绝不写 dispatched。
// host 由调用方(background)从 chrome.tabs.get(tabId).url 取,绝不接受消息携带的 host。

export interface GateDecision {
  mode: SafetyMode;
  /** canSubmit 结果:仅 authorized + host 命中名单为真。 */
  allowed: boolean;
  host: string | null;
}

export interface OrchestratorDeps {
  evaluateGate: () => Promise<GateDecision>;
  /** 是否已有一笔在途(publish-dispatched 无回执)。真 → 拒绝重入,绝不二次发准许。 */
  isAlreadyDispatched: () => Promise<boolean>;
  /** 写 publish-dispatched(副作用前的无密标记);await 成功才继续。 */
  writeDispatched: () => Promise<void>;
  /** 发一次性准许到 content,返回 content 的执行结果。 */
  sendGrant: () => Promise<PublishResult>;
  /** 记录 grant 后的最终结果(publish-confirmed / 失败结果)。 */
  writeConfirmed: (result: PublishResult) => Promise<void>;
}

export async function orchestratePublish(deps: OrchestratorDeps): Promise<PublishResult> {
  const gate = await deps.evaluateGate();

  // dry-run:走完判定但不发准许,只报告"将发布"。
  if (gate.mode === 'dry-run') {
    return { ok: true, dryRun: true };
  }

  // off,或 authorized 但 host 不符 → 阻断,不发准许、不写 dispatched。
  if (!gate.allowed) {
    return { ok: false, dryRun: false, error: 'blocked' };
  }

  // 重入守卫:已有在途 dispatched(双击/并发/SW 重放)→ 拒绝,绝不二次发准许致重复发布。
  // 完整崩溃恢复(dispatched→needs-human-verification 隔离)在 U4。
  if (await deps.isAlreadyDispatched()) {
    return { ok: false, dryRun: false, error: 'already-publishing' };
  }

  // authorized + host 命中:先 await 写盘 dispatched,再发准许(幂等顺序)。
  await deps.writeDispatched();
  const result = await deps.sendGrant();
  await deps.writeConfirmed(result);
  return result;
}
