import { describe, it, expect } from 'vitest';
import { startHand, applyAction, totalChips, currentPot, legalActions } from './gameEngine';
import { BIG_BLIND, SEAT_COUNT, STARTING_STACK } from './types';
import type { GameState } from './types';

const CHIPS = SEAT_COUNT * STARTING_STACK;

/** 依次执行一串动作 */
function play(s: GameState, steps: { type: any; amount?: number }[]): GameState {
  let cur = s;
  for (const step of steps) cur = applyAction(cur, step);
  return cur;
}

describe('applyAction 基本行为', () => {
  it('不修改入参', () => {
    const s = startHand({ seed: 'aa-1', buttonSeat: 0 });
    const before = JSON.stringify(s);
    applyAction(s, { type: 'fold' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('fold 后该座位标记为已弃牌', () => {
    const s = startHand({ seed: 'aa-2', buttonSeat: 0 });
    const seat = s.toAct!;
    const next = applyAction(s, { type: 'fold' });
    expect(next.seats[seat].folded).toBe(true);
  });

  it('call 从筹码里扣除并计入投入', () => {
    const s = startHand({ seed: 'aa-3', buttonSeat: 0 });
    const seat = s.toAct!;
    const next = applyAction(s, { type: 'call' });
    expect(next.seats[seat].stack).toBe(STARTING_STACK - BIG_BLIND);
    expect(next.seats[seat].streetContribution).toBe(BIG_BLIND);
    expect(next.seats[seat].totalContribution).toBe(BIG_BLIND);
  });

  it('每个动作都追加进 actions', () => {
    const s = startHand({ seed: 'aa-4', buttonSeat: 0 });
    const next = applyAction(s, { type: 'call' });
    expect(next.actions).toHaveLength(1);
    expect(next.actions[0].type).toBe('call');
    expect(next.actions[0].street).toBe('preflop');
  });

  it('非法动作抛错', () => {
    const s = startHand({ seed: 'aa-5', buttonSeat: 0 });
    expect(() => applyAction(s, { type: 'check' })).toThrow();
  });
});

describe('筹码守恒不变量', () => {
  it('每一步之后筹码总量都不变', () => {
    let s = startHand({ seed: 'aa-6', buttonSeat: 0 });
    expect(totalChips(s)).toBe(CHIPS);
    const steps = [
      { type: 'raise', amount: 3 },
      { type: 'call' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'call' },
    ];
    for (const step of steps) {
      if (s.handOver) break;
      s = applyAction(s, step as any);
      expect(totalChips(s)).toBe(CHIPS);
    }
  });
});

describe('下注轮结束与街推进', () => {
  it('翻前全部跟注、BB 过牌后进入翻牌圈并发 3 张公共牌', () => {
    let s = startHand({ seed: 'aa-7', buttonSeat: 0 });
    // UTG HJ CO BTN 跟注，SB 补齐，BB 过牌
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
  });

  it('翻后从 SB 起首先行动', () => {
    let s = startHand({ seed: 'aa-8', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.seats[s.toAct!].position).toBe('SB');
  });

  it('翻牌圈全过牌进入转牌，公共牌变 4 张', () => {
    let s = startHand({ seed: 'aa-9', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
    ]);
    expect(s.street).toBe('turn');
    expect(s.board).toHaveLength(4);
  });

  it('新街开始时本街投入清零、currentBet 归零', () => {
    let s = startHand({ seed: 'aa-10', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.currentBet).toBe(0);
    expect(s.seats.every(x => x.streetContribution === 0)).toBe(true);
  });

  it('BB 在无人加注时保留最后的加注选择权', () => {
    let s = startHand({ seed: 'aa-11', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
    ]);
    // 轮到 BB，且仍可加注
    expect(s.seats[s.toAct!].position).toBe('BB');
    expect(legalActions(s).map(a => a.type)).toContain('raise');
    expect(s.street).toBe('preflop');
  });
});

describe('只剩一人时立即结束', () => {
  it('全部弃牌给 BB 则本手结束', () => {
    let s = startHand({ seed: 'aa-12', buttonSeat: 0 });
    s = play(s, [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(s.handOver).toBe(true);
    expect(totalChips(s)).toBe(CHIPS);
  });
});

describe('短 all-in 不重开下注轮', () => {
  it('不足最小加注额的 all-in 后，已行动者只能 fold/call 不能 raise', () => {
    let s = startHand({ seed: 'aa-13', buttonSeat: 0 });
    const utg = s.toAct!;
    // UTG 加注到 10
    s = applyAction(s, { type: 'raise', amount: 10 });
    // HJ 手上只有 14，all-in（增量 4 < 上次加注增量 9，属短 all-in）
    s = { ...s, seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 14 } : x)) };
    s = applyAction(s, { type: 'allin' });
    // 后续玩家全部弃牌，轮回 UTG
    while (s.toAct !== utg && !s.handOver) {
      s = applyAction(s, { type: 'fold' });
    }
    expect(s.handOver).toBe(false);
    expect(s.toAct).toBe(utg);
    const t = legalActions(s).map(a => a.type);
    expect(t).toContain('call');
    expect(t).not.toContain('raise');
  });

  it('完整加注会重开下注轮，已行动者可再次加注', () => {
    let s = startHand({ seed: 'aa-14', buttonSeat: 0 });
    const utg = s.toAct!;
    s = applyAction(s, { type: 'raise', amount: 3 });   // 加注到 3
    s = applyAction(s, { type: 'raise', amount: 9 });   // 再加注到 9，增量 6 >= 2，完整加注
    while (s.toAct !== utg && !s.handOver) {
      s = applyAction(s, { type: 'fold' });
    }
    expect(s.toAct).toBe(utg);
    expect(legalActions(s).map(a => a.type)).toContain('raise');
  });
});

describe('currentPot', () => {
  it('等于所有人的本手总投入之和', () => {
    let s = startHand({ seed: 'aa-15', buttonSeat: 0 });
    expect(currentPot(s)).toBe(1.5);  // SB 0.5 + BB 1
    s = applyAction(s, { type: 'call' });
    expect(currentPot(s)).toBe(2.5);
  });
});
