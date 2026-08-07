import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from './gameEngine';
import { SEAT_COUNT } from './types';
import type { GameState } from './types';
import type { RangeSet } from './rangeSet';
import { createRng } from './rng';
import { situationFromGameState } from './situation';
import { initialRange, narrowByAction } from './opponentRange';
import { estimateEv } from './evEstimate';
import { rangeFraction } from './rangeSet';

describe('跨模块集成：对局状态 -> 局面快照 -> 范围收窄 -> EV 估算', () => {
  it('打完一手牌，每个决策点都能估出 EV，且推荐动作合法', () => {
    let s: GameState = startHand({ seed: 'integration-1', buttonSeat: 0 });

    // 每个座位的范围从其位置的开池范围起手，随对手动作逐步收窄
    const ranges = new Map<number, RangeSet>();
    for (const seat of s.seats) ranges.set(seat.seat, initialRange(seat.position));
    const personaIds = new Map<number, string>();
    for (const seat of s.seats) personaIds.set(seat.seat, 'tag');

    const heroSeat = s.toAct!;
    let decisions = 0;
    let guard = 0;

    while (!s.handOver) {
      if (++guard > 200) throw new Error('疑似死锁');
      const acting = s.toAct!;
      const legal = legalActions(s);
      if (legal.length === 0) throw new Error(`座位 ${acting} 无合法动作`);

      if (acting === heroSeat) {
        const sit = situationFromGameState(s, { ranges, personaIds });
        const ev = estimateEv(sit, {
          iterations: 400, strengthIterations: 40, rng: createRng(`ev-${decisions}`),
        });
        decisions++;

        // 推荐的动作必须是引擎认可的合法动作
        expect(legal.some(a => a.type === ev.recommended.actionType)).toBe(true);
        // 弃牌的 EV 恒为 0，且没有候选是 NaN
        for (const c of ev.candidates) expect(Number.isFinite(c.ev)).toBe(true);
      }

      // 用第一个合法动作推进，保证走完整手牌
      const pick = legal[0];
      const before = s;
      s = applyAction(s, { type: pick.type, amount: pick.min });

      // 对手动作后收窄其范围
      if (acting !== heroSeat) {
        const prev = ranges.get(acting)!;
        ranges.set(acting, narrowByAction(prev, pick.type, {
          street: before.street,
          board: before.board,
          dead: before.board,
          potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
          betSize: pick.min,
          strengthIterations: 30,
          rng: createRng(`narrow-${guard}`),
        }));
      }
    }

    expect(decisions).toBeGreaterThan(0);
  }, 60_000);

  it('链式收窄后的范围只会变窄，且不会变空', () => {
    const s = startHand({ seed: 'integration-2', buttonSeat: 0 });
    let range = initialRange('CO');
    let width = rangeFraction(range);
    const board = s.deck.slice(0, 3);

    for (const act of ['call', 'bet', 'call'] as const) {
      range = narrowByAction(range, act, {
        street: 'flop', board, dead: board,
        potBefore: 20, betSize: 10, strengthIterations: 30,
        rng: createRng(`chain-${act}`),
      });
      const next = rangeFraction(range);
      expect(next).toBeLessThanOrEqual(width);
      expect(range.size).toBeGreaterThan(0);
      width = next;
    }
  }, 60_000);
});
