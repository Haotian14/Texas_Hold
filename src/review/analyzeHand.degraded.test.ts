import { describe, it, expect, vi } from 'vitest';
import { startHand, applyAction, settleHand, legalActions } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { HandRecord } from '../core/types';
import { analyzeHand } from './analyzeHand';

// 这份文件单独存在（不并进 analyzeHand.test.ts）是因为它要 mock
// core/evEstimate —— vi.mock 作用于整个模块，一旦和主测试文件共用一个
// import 图，会连带污染那边靠真实 estimateEv 得出的期望值。
//
// 目的：analyzeHand.test.ts 里"降级的决策点不报损失"这条断言只在
// `if (d.degraded)` 成立时才检查内容，而扫描过 an-1..an-9、an-report-1
// 全部种子后确认：这个测试文件构造出的记录全程只剩 hero 与一个对手
// （其余座位翻前就弃牌），estimateEv 的选择性放宽只在多个对手的范围
// 同时塌缩到互相冲突的窄类别时才触发（见 core/evEstimate.test.ts 的
// "健康的四个对手范围原样保留" 用例，需要 5 个对手），单对手局面下
// InfeasibleSamplingError 基本不可能出现。也就是说，原测试的
// `if (d.degraded)` 分支在这些种子上永远不成立，断言从未真正被执行过——
// 这正是任务书点名的"断言了但什么都没测到"的坑。
//
// 这里改用合成 EvResult 直接验证短路本身：强制 estimateEv 返回
// degraded: 'widened-ranges'，如果 analyzeHand 里的
// `const degraded = ev.degraded !== null` 短路被删掉或改错，
// 这个测试会因为 evLoss/severity/tag 不再被强制清零而失败。
vi.mock('../core/evEstimate', async importOriginal => {
  const actual = await importOriginal<typeof import('../core/evEstimate')>();
  return {
    ...actual,
    estimateEv: (...args: Parameters<typeof actual.estimateEv>) => {
      const real = actual.estimateEv(...args);
      return {
        ...real,
        degraded: 'widened-ranges' as const,
        degradedOpponentCount: Math.max(1, real.degradedOpponentCount),
      };
    },
  };
});

function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  let n = 0;
  while (!s.handOver && n++ < 40) {
    if (s.toAct === HERO_SEAT) {
      s = applyAction(s, s.street === 'preflop' ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else if (s.street === 'preflop' && s.toAct === 2) {
      s = applyAction(s, { type: 'call' });
    } else {
      const canFold = legalActions(s).some(a => a.type === 'fold');
      s = applyAction(s, canFold ? { type: 'fold' } : { type: 'check' });
    }
  }
  return toHandRecord(settleHand(s), { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

describe('analyzeHand degraded 短路（合成 EvResult，直接验证守卫本身）', () => {
  it('estimateEv 报告 degraded 时，每条决策都被强制 evLoss=0/severity=ok/tag=null/degraded=true', () => {
    const rec = makeRecord('an-degraded-1');
    const a = analyzeHand(rec, { iterations: 200, strengthIterations: 15 });
    expect(a.decisions.length).toBeGreaterThan(0);
    for (const d of a.decisions) {
      expect(d.degraded).toBe(true);
      expect(d.evLoss).toBe(0);
      expect(d.severity).toBe('ok');
      expect(d.tag).toBeNull();
    }
  });
});
