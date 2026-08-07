import { describe, it, expect } from 'vitest';
import { startHand, applyAction } from './gameEngine';
import { BIG_BLIND, SEAT_COUNT } from './types';
import type { GameState } from './types';
import { fullRange } from './rangeSet';
import { parseRange } from './rangeNotation';
import { situationFromGameState, describeSituation } from './situation';

function ranges(): Map<number, ReturnType<typeof fullRange>> {
  const m = new Map();
  for (let i = 0; i < SEAT_COUNT; i++) m.set(i, fullRange());
  return m;
}
function personas(): Map<number, string> {
  const m = new Map<number, string>();
  for (let i = 0; i < SEAT_COUNT; i++) m.set(i, i === 0 ? 'hero' : 'tag');
  return m;
}
const opts = () => ({ ranges: ranges(), personaIds: personas() });

describe('situationFromGameState 基本字段', () => {
  it('翻前开局：底池 1.5、UTG 面对 1BB', () => {
    const s = startHand({ seed: 'sit-1', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.street).toBe('preflop');
    expect(sit.pot).toBe(1.5);
    expect(sit.toCall).toBe(BIG_BLIND);
    expect(sit.heroSeat).toBe(s.toAct);
    expect(sit.heroPosition).toBe('UTG');
  });

  it('heroCards 取自当前行动座位', () => {
    const s = startHand({ seed: 'sit-2', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.heroCards).toEqual(s.seats[s.toAct!].holeCards);
  });

  it('heroStack 与 heroStreetContribution 取自该座位', () => {
    const s = startHand({ seed: 'sit-3', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    const seat = s.seats[s.toAct!];
    expect(sit.heroStack).toBe(seat.stack);
    expect(sit.heroStreetContribution).toBe(seat.streetContribution);
  });
});

describe('situationFromGameState 对手集合', () => {
  it('包含其余 5 家', () => {
    const s = startHand({ seed: 'sit-4', buttonSeat: 0 });
    expect(situationFromGameState(s, opts()).opponents).toHaveLength(5);
  });

  it('排除已弃牌的对手', () => {
    let s = startHand({ seed: 'sit-5', buttonSeat: 0 });
    s = applyAction(s, { type: 'fold' });     // UTG 弃牌
    const sit = situationFromGameState(s, opts());
    expect(sit.opponents).toHaveLength(4);
    expect(sit.opponents.some(o => o.seat === 3)).toBe(false);   // UTG 是座位 3
  });

  it('排除自己', () => {
    const s = startHand({ seed: 'sit-6', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.opponents.some(o => o.seat === sit.heroSeat)).toBe(false);
  });

  it('带上各自的范围与 persona', () => {
    const s = startHand({ seed: 'sit-7', buttonSeat: 0 });
    const custom = ranges();
    custom.set(4, parseRange('AA, KK'));
    const sit = situationFromGameState(s, { ranges: custom, personaIds: personas() });
    const opp = sit.opponents.find(o => o.seat === 4)!;
    expect(opp.range.size).toBe(2);
    expect(opp.personaId).toBe('tag');
  });

  it('缺少某座位的范围时回落到全范围', () => {
    const s = startHand({ seed: 'sit-8', buttonSeat: 0 });
    const sit = situationFromGameState(s, { ranges: new Map(), personaIds: new Map() });
    for (const o of sit.opponents) {
      expect(o.range.size).toBe(169);
      expect(o.personaId).toBe('unknown');
    }
  });
});

describe('situationFromGameState 翻前加注者标记', () => {
  it('无人加注时为 false', () => {
    const s = startHand({ seed: 'sit-9', buttonSeat: 0 });
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(false);
  });

  it('翻牌圈能正确区分谁是翻前加注者', () => {
    // buttonSeat 0 时：BTN=0, SB=1, BB=2, UTG=3, HJ=4, CO=5
    // 翻前 UTG 加注、其余弃牌、大盲跟注；翻后由大盲先行动
    let s = startHand({ seed: 'sit-10', buttonSeat: 0 });
    expect(s.toAct).toBe(3);                       // UTG
    s = applyAction(s, { type: 'raise', amount: 3 });
    s = applyAction(s, { type: 'fold' });           // HJ
    s = applyAction(s, { type: 'fold' });           // CO
    s = applyAction(s, { type: 'fold' });           // BTN
    s = applyAction(s, { type: 'fold' });           // SB
    s = applyAction(s, { type: 'call' });           // BB 跟注，进入翻牌圈
    expect(s.street).toBe('flop');

    // 翻牌圈先由大盲行动，他不是翻前加注者
    expect(s.toAct).toBe(2);
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(false);

    // 大盲过牌后轮到 UTG，他才是翻前加注者
    s = applyAction(s, { type: 'check' });
    expect(s.toAct).toBe(3);
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(true);
  });
});

describe('situationFromGameState 前置条件', () => {
  it('本手已结束时抛错', () => {
    let s = startHand({ seed: 'sit-11', buttonSeat: 0 });
    for (let i = 0; i < 5 && !s.handOver; i++) s = applyAction(s, { type: 'fold' });
    expect(() => situationFromGameState(s, opts())).toThrow();
  });
});

describe('describeSituation', () => {
  it('输出单行摘要，包含街道与底池', () => {
    const s = startHand({ seed: 'sit-12', buttonSeat: 0 });
    const text = describeSituation(situationFromGameState(s, opts()));
    expect(text).toContain('preflop');
    expect(text).toContain('1.5');
    expect(text.split('\n')).toHaveLength(1);
  });
});
