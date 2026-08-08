import { describe, it, expect } from 'vitest';
import { allHandClasses } from '../handClass';
import { rangeFraction } from '../rangeSet';
import { PREFLOP_NODES } from './data';
import {
  rfiKey, vsOpenKey, vs3betKey, hasNode, nodeActions, actionFreqs, rangeForAction,
} from './index';
import type { Position } from '../types';

describe('节点键构造', () => {
  it('RFI 键', () => {
    expect(rfiKey('CO')).toBe('CO_rfi');
  });
  it('面对开池键', () => {
    expect(vsOpenKey('BB', 'BTN')).toBe('BB_vs_BTN_open');
  });
  it('面对 3bet 键', () => {
    expect(vs3betKey('CO', 'BTN')).toBe('CO_vs_BTN_3bet');
  });
});

describe('hasNode', () => {
  it('已覆盖的节点返回 true', () => {
    expect(hasNode(rfiKey('BTN'))).toBe(true);
    expect(hasNode(vsOpenKey('BB', 'BTN'))).toBe(true);
  });

  it('未覆盖的节点返回 false（调用方需回落到 EV 估算）', () => {
    expect(hasNode('BB_rfi')).toBe(false);
  });
});

describe('actionFreqs', () => {
  it('各动作频率之和恒为 1', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const sum = Object.values(f).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
      }
    }
  });

  it('未列出的手牌全部落在 fold 上', () => {
    // 72o 不在任何开池范围里
    const f = actionFreqs(rfiKey('UTG'), '72o')!;
    expect(f.fold).toBe(1);
    expect(f.raise ?? 0).toBe(0);
  });

  it('AA 在所有 RFI 节点上都是 100% 加注', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(actionFreqs(rfiKey(pos), 'AA')!.raise).toBe(1);
    }
  });

  it('混合频率如实反映', () => {
    const f = actionFreqs('UTG_vs_BB_3bet', 'A5s')!;
    expect(f['4bet']).toBe(0.5);
    expect(f.fold).toBeCloseTo(0.5, 9);
  });

  it('节点不存在时返回 undefined', () => {
    expect(actionFreqs('NOT_A_NODE', 'AA')).toBeUndefined();
  });
});

describe('数据一致性', () => {
  it('同一节点内任一手牌的非 fold 频率之和不超过 1', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const nonFold = Object.entries(f)
          .filter(([a]) => a !== 'fold')
          .reduce((s, [, v]) => s + v, 0);
        if (nonFold > 1.0001) {
          throw new Error(`节点 ${key} 的 ${hc} 非 fold 频率之和为 ${nonFold}`);
        }
      }
    }
  });

  it('每个节点的记法都能解析（无拼写错误）', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const action of nodeActions(key)) {
        expect(() => rangeForAction(key, action)).not.toThrow();
        expect(rangeForAction(key, action)!.size).toBeGreaterThan(0);
      }
    }
  });
});

describe('范围宽度落在扑克常识区间', () => {
  const width = (key: string, action: 'raise') => rangeFraction(rangeForAction(key, action)!);

  it('开池范围随位置递增：UTG < HJ < CO < BTN', () => {
    const utg = width(rfiKey('UTG'), 'raise');
    const hj = width(rfiKey('HJ'), 'raise');
    const co = width(rfiKey('CO'), 'raise');
    const btn = width(rfiKey('BTN'), 'raise');
    expect(utg).toBeLessThan(hj);
    expect(hj).toBeLessThan(co);
    expect(co).toBeLessThan(btn);
  });

  it('UTG 开池约 11-18%', () => {
    expect(width(rfiKey('UTG'), 'raise')).toBeGreaterThan(0.11);
    expect(width(rfiKey('UTG'), 'raise')).toBeLessThan(0.18);
  });

  it('BTN 开池约 38-52%', () => {
    expect(width(rfiKey('BTN'), 'raise')).toBeGreaterThan(0.38);
    expect(width(rfiKey('BTN'), 'raise')).toBeLessThan(0.52);
  });

  it('大盲面对 BTN 开池比面对 UTG 开池防守得宽', () => {
    const vsBtn = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), 'call')!);
    const vsUtg = rangeFraction(rangeForAction(vsOpenKey('BB', 'UTG'), 'call')!);
    expect(vsBtn).toBeGreaterThan(vsUtg);
  });

  it('3bet 范围明显窄于跟注范围', () => {
    const threeBet = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), '3bet')!);
    const call = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), 'call')!);
    expect(threeBet).toBeLessThan(call);
  });
});

describe('rangeForAction', () => {
  it('返回的范围里手牌权重等于其频率', () => {
    const r = rangeForAction('UTG_vs_BB_3bet', '4bet')!;
    expect(r.get('A5s')).toBe(0.5);
    expect(r.get('AA')).toBe(1);
  });

  it('节点或动作不存在时返回 undefined', () => {
    expect(rangeForAction('NOT_A_NODE', 'raise')).toBeUndefined();
    expect(rangeForAction(rfiKey('UTG'), '4bet')).toBeUndefined();
  });
});

describe('面对开池节点的覆盖', () => {
  const allVsOpen: Array<[Position, Position]> = [
    ['BB', 'UTG'], ['BB', 'HJ'], ['BB', 'CO'], ['BB', 'BTN'], ['BB', 'SB'],
    ['BTN', 'UTG'], ['BTN', 'HJ'], ['BTN', 'CO'],
    ['SB', 'UTG'], ['SB', 'HJ'], ['SB', 'CO'], ['SB', 'BTN'],
    ['HJ', 'UTG'], ['CO', 'UTG'], ['CO', 'HJ'],
  ];

  it('十五个单次加注底池节点全部存在', () => {
    for (const [pos, opener] of allVsOpen) {
      const key = vsOpenKey(pos, opener);
      if (!hasNode(key)) throw new Error(`缺少节点 ${key}`);
    }
  });

  it('新增节点的频率之和仍然为 1', () => {
    for (const key of ['HJ_vs_UTG_open', 'CO_vs_UTG_open', 'CO_vs_HJ_open',
                       'SB_vs_UTG_open', 'SB_vs_HJ_open']) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const sum = Object.values(f).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
      }
    }
  });

  it('面对越靠前的开池，防守越紧', () => {
    // CO 面对 UTG 开池应当比面对 HJ 开池防守得更紧
    const total = (key: string) =>
      rangeFraction(rangeForAction(key, 'call')!) + rangeFraction(rangeForAction(key, '3bet')!);
    expect(total('CO_vs_UTG_open')).toBeLessThan(total('CO_vs_HJ_open'));
  });

  it('小盲面对同一开池比大盲防守得紧（位置劣势）', () => {
    const total = (key: string) =>
      rangeFraction(rangeForAction(key, 'call')!) + rangeFraction(rangeForAction(key, '3bet')!);
    expect(total('SB_vs_UTG_open')).toBeLessThan(total('BB_vs_UTG_open'));
  });
});
