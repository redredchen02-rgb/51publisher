import { describe, it, expect, vi } from 'vitest';
import { orchestratePublish } from './publish-orchestrator';
import type { GateDecision, OrchestratorDeps } from './publish-orchestrator';
import type { PublishResult } from './types';

function makeDeps(gate: GateDecision, grantResult: PublishResult, order: string[]): OrchestratorDeps {
  return {
    evaluateGate: vi.fn(async () => gate),
    writeDispatched: vi.fn(async () => {
      order.push('dispatched');
    }),
    sendGrant: vi.fn(async () => {
      order.push('grant');
      return grantResult;
    }),
    writeConfirmed: vi.fn(async (r: PublishResult) => {
      order.push(`confirmed:${r.ok}`);
    }),
  };
}

const OK: PublishResult = { ok: true, dryRun: false, url: 'https://dx-999-adm.ympxbys.xyz/post/1' };

describe('orchestratePublish', () => {
  it('authorized+allowed:先 await 写 dispatched 再发 grant 再写 confirmed', async () => {
    const order: string[] = [];
    const deps = makeDeps({ mode: 'authorized', allowed: true, host: 'dx-999-adm.ympxbys.xyz' }, OK, order);
    const res = await orchestratePublish(deps);
    expect(res).toEqual(OK);
    expect(order).toEqual(['dispatched', 'grant', 'confirmed:true']);
    expect(deps.sendGrant).toHaveBeenCalledOnce();
  });

  it('off:不发 grant、不写 dispatched,返回 blocked', async () => {
    const order: string[] = [];
    const deps = makeDeps({ mode: 'off', allowed: false, host: 'dx-999-adm.ympxbys.xyz' }, OK, order);
    const res = await orchestratePublish(deps);
    expect(res.ok).toBe(false);
    expect(res.dryRun).toBe(false);
    expect(order).toEqual([]);
    expect(deps.sendGrant).not.toHaveBeenCalled();
    expect(deps.writeDispatched).not.toHaveBeenCalled();
  });

  it('dry-run:不发 grant,返回 dryRun 报告', async () => {
    const order: string[] = [];
    const deps = makeDeps({ mode: 'dry-run', allowed: false, host: 'dx-999-adm.ympxbys.xyz' }, OK, order);
    const res = await orchestratePublish(deps);
    expect(res.dryRun).toBe(true);
    expect(order).toEqual([]);
    expect(deps.sendGrant).not.toHaveBeenCalled();
  });

  it('authorized 但 host 不符(allowed=false):不发 grant', async () => {
    const order: string[] = [];
    const deps = makeDeps({ mode: 'authorized', allowed: false, host: 'evil.com' }, OK, order);
    const res = await orchestratePublish(deps);
    expect(res.ok).toBe(false);
    expect(order).toEqual([]);
    expect(deps.sendGrant).not.toHaveBeenCalled();
  });

  it('content 触发失败(no-publish-target)如实回传,仍写 confirmed', async () => {
    const order: string[] = [];
    const fail: PublishResult = { ok: false, dryRun: false, error: 'no-publish-target' };
    const deps = makeDeps({ mode: 'authorized', allowed: true, host: 'dx-999-adm.ympxbys.xyz' }, fail, order);
    const res = await orchestratePublish(deps);
    expect(res).toEqual(fail);
    expect(order).toEqual(['dispatched', 'grant', 'confirmed:false']);
  });
});
