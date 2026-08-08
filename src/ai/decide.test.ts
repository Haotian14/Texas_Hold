import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import type { GameState, Street } from '../core/types';
import { SEAT_COUNT } from '../core/types';
import { createRng } from '../core/rng';
import { fullRange } from '../core/rangeSet';
import type { RangeSet } from '../core/rangeSet';
import { initialRange } from '../core/opponentRange';
import { PERSONAS } from './personas';
import { decide } from './decide';

function opts(personaId: string, seed = 'decide') {
  const ranges = new Map<number, RangeSet>();
  const personaIds = new Map<number, string>();
  for (let i = 0; i < SEAT_COUNT; i++) {
    ranges.set(i, fullRange());
    personaIds.set(i, personaId);
  }
  return { ranges, personaIds, rng: createRng(seed), iterations: 300, strengthIterations: 30 };
}

describe('decide 返回合法动作', () => {
  it('翻前首个决策点给出的动作在 legalActions 里', () => {
    const s = startHand({ seed: 'dec-1', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    const legal = legalActions(s);
    expect(legal.some(a => a.type === d.action.type)).toBe(true);
  });

  it('加注金额落在合法区间内', () => {
    const s = startHand({ seed: 'dec-2', buttonSeat: 0 });
    for (const p of PERSONAS) {
      const d = decide(s, opts(p.id, `amt-${p.id}`));
      const match = legalActions(s).find(a => a.type === d.action.type)!;
      if (d.action.amount !== undefined) {
        expect(d.action.amount).toBeGreaterThanOrEqual(match.min - 1e-9);
        expect(d.action.amount).toBeLessThanOrEqual(match.max + 1e-9);
      }
    }
  });

  it('返回的动作能被引擎接受', () => {
    const s = startHand({ seed: 'dec-3', buttonSeat: 0 });
    const d = decide(s, opts('lag'));
    expect(() => applyAction(s, d.action)).not.toThrow();
  });

  it('本手已结束时抛错', () => {
    let s = startHand({ seed: 'dec-4', buttonSeat: 0 });
    for (let i = 0; i < 5 && !s.handOver; i++) s = applyAction(s, { type: 'fold' });
    expect(() => decide(s, opts('tag'))).toThrow();
  });
});

describe('decide 反映性格差异', () => {
  it('跟注站比岩石更少弃牌', () => {
    let stationFolds = 0;
    let rockFolds = 0;
    for (let i = 0; i < 40; i++) {
      let s = startHand({ seed: `fold-${i}`, buttonSeat: i % SEAT_COUNT });
      // 先加注一手，制造一个需要跟注的局面
      s = applyAction(s, { type: 'raise', amount: 3 });
      if (s.handOver) continue;
      if (decide(s, opts('station', `st-${i}`)).action.type === 'fold') stationFolds++;
      if (decide(s, opts('rock', `rk-${i}`)).action.type === 'fold') rockFolds++;
    }
    expect(stationFolds).toBeLessThan(rockFolds);
  });

  it('疯子比岩石更常选进攻动作', () => {
    const aggressive = new Set(['bet', 'raise', 'allin']);
    let maniacAgg = 0;
    let rockAgg = 0;
    for (let i = 0; i < 40; i++) {
      const s = startHand({ seed: `agg-${i}`, buttonSeat: i % SEAT_COUNT });
      if (aggressive.has(decide(s, opts('maniac', `mn-${i}`)).action.type)) maniacAgg++;
      if (aggressive.has(decide(s, opts('rock', `rk2-${i}`)).action.type)) rockAgg++;
    }
    expect(maniacAgg).toBeGreaterThan(rockAgg);
  });

  it('GTO 原型不叠加任何偏好，评分等于 EV 本身', () => {
    // GTO 的 aggression / callThresholdMul 都是 1，bluffFreq 为 0，
    // 所以 personaScore 的三项加成全为 0，score 必须与所选候选的 ev 相等。
    // 注意不能断言「选的就是 ev.recommended」—— 推荐候选可能因非法尺度被过滤掉。
    const s = startHand({ seed: 'dec-gto', buttonSeat: 0 });
    const d = decide(s, { ...opts('gto'), rng: createRng('no-bluff') });
    expect(d.score).toBeCloseTo(d.chosen.ev, 9);
  });

  it('有性格的原型确实叠加了偏好', () => {
    // 疯子的 aggression 远大于 1，只要它选的是进攻动作，score 就必然高于 ev
    const s = startHand({ seed: 'dec-maniac', buttonSeat: 0 });
    const d = decide(s, opts('maniac', 'bias'));
    const aggressive = new Set(['bet', 'raise', 'allin']);
    if (aggressive.has(d.chosen.actionType)) {
      expect(d.score).toBeGreaterThan(d.chosen.ev);
    }
  });
});

describe('decide 大盲的选项也能加注（bet/raise 类型不匹配的回归）', () => {
  it('限注平跟到大盲选项时，激进性格能选择加注，且引擎接受该动作', () => {
    // 除大盲外全员平跟，制造 toCall === 0 但 currentBet === 1（大盲本身）的
    // 局面：evEstimate 按 toCall 把候选定为 'bet'，legalActions 按 currentBet
    // 把同一个合法动作定为 'raise'。旧的精确字符串匹配会把全部五个进攻候选
    // 筛掉，usable 塌缩成只剩 check，maniac 也只能 check。
    let s = startHand({ seed: 'bbopt-0', buttonSeat: 0 });
    while (s.seats[s.toAct!].position !== 'BB') {
      s = applyAction(s, { type: 'call' });
    }
    const bb = s.seats[s.toAct!];
    expect(bb.position).toBe('BB');
    expect(s.currentBet).toBe(1);
    const toCall = s.currentBet - bb.streetContribution;
    expect(Math.abs(toCall)).toBeLessThan(1e-9);
    const legal = legalActions(s);
    expect(legal.some(a => a.type === 'raise')).toBe(true);

    const ranges = new Map<number, RangeSet>();
    const personaIds = new Map<number, string>();
    for (let k = 0; k < SEAT_COUNT; k++) { ranges.set(k, fullRange()); personaIds.set(k, 'maniac'); }

    const d = decide(s, {
      ranges,
      personaIds,
      rng: createRng('bbopt-0-rng-2'),
      iterations: 120,
      strengthIterations: 15,
    });

    expect(d.action.type).toBe('raise');
    expect(() => applyAction(s, d.action)).not.toThrow();
  });
});

describe('decide 可复现', () => {
  it('相同 seed 决策相同', () => {
    const s = startHand({ seed: 'dec-repro', buttonSeat: 0 });
    const a = decide(s, opts('lag', 'same-seed'));
    const b = decide(s, opts('lag', 'same-seed'));
    expect(a.action).toEqual(b.action);
    expect(a.score).toBe(b.score);
  });
});

describe('decide 返回诊断信息', () => {
  it('带上用到的性格、完整的 EV 结果与被选中的候选', () => {
    const s = startHand({ seed: 'dec-diag', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    expect(d.persona.id).toBe('tag');
    expect(d.ev.candidates.length).toBeGreaterThan(0);
    expect(d.ev.candidates).toContain(d.chosen);
    expect(Number.isFinite(d.score)).toBe(true);
  });
});
