import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from './gameEngine';
import type { LegalAction } from './gameEngine';
import { SEAT_COUNT } from './types';
import type { GameState, Street } from './types';
import type { RangeSet } from './rangeSet';
import { createRng } from './rng';
import { situationFromGameState } from './situation';
import { initialRange, narrowByAction } from './opponentRange';
import { estimateEv } from './evEstimate';
import { rangeFraction } from './rangeSet';

/** 驱动策略：优先让牌局继续，这样才能走完四条街并真正触发范围收窄 */
function pickContinuing(legal: LegalAction[]): LegalAction {
  return legal.find(a => a.type === 'check')
    ?? legal.find(a => a.type === 'call')
    ?? legal.find(a => a.type === 'fold')
    ?? legal[0];
}

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
    const streetsSeen = new Set<Street>();
    const lastWidth = new Map<number, number>();

    while (!s.handOver) {
      if (++guard > 200) throw new Error('疑似死锁');
      const acting = s.toAct!;
      const legal = legalActions(s);
      if (legal.length === 0) throw new Error(`座位 ${acting} 无合法动作`);

      if (acting === heroSeat) {
        streetsSeen.add(s.street);

        const sit = situationFromGameState(s, { ranges, personaIds });
        const ev = estimateEv(sit, {
          iterations: 400, strengthIterations: 40, rng: createRng(`ev-${decisions}`),
        });
        decisions++;

        // 推荐的动作必须是引擎认可的合法动作
        expect(legal.some(a => a.type === ev.recommended.actionType)).toBe(true);
        // 弃牌的 EV 恒为 0，且没有候选是 NaN
        for (const c of ev.candidates) expect(Number.isFinite(c.ev)).toBe(true);

        // 链式收窄：范围只能变窄或持平，且永远不为空（hero 自己不算对手）
        for (const [seat, r] of ranges) {
          if (seat === heroSeat) continue;
          expect(r.size).toBeGreaterThan(0);
          const prev = lastWidth.get(seat);
          const now = rangeFraction(r);
          if (prev !== undefined) expect(now).toBeLessThanOrEqual(prev + 1e-9);
          lastWidth.set(seat, now);
        }
      }

      // 优先推进牌局（check/call），而不是每次都弃牌，
      // 这样才能走完四条街，真正触发多次范围收窄
      const pick = pickContinuing(legal);
      const before = s;
      s = applyAction(s, { type: pick.type, amount: pick.min });

      // 对手动作后收窄其范围；已弃牌的座位不再收窄——弃牌后范围收窄为空，
      // 会让上面的非空断言在下一次 hero 决策点失败，而且毫无意义（弃牌者已出局）
      if (acting !== heroSeat && pick.type !== 'fold') {
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

    // 实测 seed 'integration-1' 下 hero 在四条街各被问到一次：
    // streetsSeen = {preflop, flop, turn, river}，decisions = 4。
    expect(streetsSeen.size).toBe(4);
    expect(decisions).toBe(4);
  }, 60_000);

  it('短筹码对手全下后，hero 的对手集合里出现不能弃牌的全下对手', () => {
    // buttonSeat: 0 时按 POSITION_ORDER 座位映射为
    // 0=BTN 1=SB 2=BB 3=UTG 4=HJ 5=CO，UTG（座位 3）是 preflop 第一个行动者，
    // 即本测试的 hero。把 BB（座位 2）的起始筹码压到 0.5（小于大盲 1），
    // 这样开局扣盲注时就会把该座位打成全下（postBlind: paid = min(1, 0.5) = 0.5，
    // stack 归零 => allIn = true）——不依赖 pickContinuing 的选择，从第一个
    // hero 决策点起就确定性地存在一个不能弃牌的全下对手。
    const startingStacks = [100, 100, 0.5, 100, 100, 100];
    let s: GameState = startHand({ seed: 'integration-3', buttonSeat: 0, startingStacks });

    const ranges = new Map<number, RangeSet>();
    for (const seat of s.seats) ranges.set(seat.seat, initialRange(seat.position));
    const personaIds = new Map<number, string>();
    for (const seat of s.seats) personaIds.set(seat.seat, 'tag');

    const heroSeat = s.toAct!;
    let decisions = 0;
    let guard = 0;
    let sawAllInOpponent = false;

    while (!s.handOver) {
      if (++guard > 200) throw new Error('疑似死锁');
      const acting = s.toAct!;
      const legal = legalActions(s);
      if (legal.length === 0) throw new Error(`座位 ${acting} 无合法动作`);

      if (acting === heroSeat) {
        const sit = situationFromGameState(s, { ranges, personaIds });
        const ev = estimateEv(sit, {
          iterations: 400, strengthIterations: 40, rng: createRng(`ev3-${decisions}`),
        });
        decisions++;

        if (sit.opponents.some(o => !o.canFold)) sawAllInOpponent = true;

        expect(legal.some(a => a.type === ev.recommended.actionType)).toBe(true);
        for (const c of ev.candidates) expect(Number.isFinite(c.ev)).toBe(true);
      }

      const pick = pickContinuing(legal);
      const before = s;
      s = applyAction(s, { type: pick.type, amount: pick.min });

      if (acting !== heroSeat && pick.type !== 'fold') {
        const prev = ranges.get(acting)!;
        ranges.set(acting, narrowByAction(prev, pick.type, {
          street: before.street,
          board: before.board,
          dead: before.board,
          potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
          betSize: pick.min,
          strengthIterations: 30,
          rng: createRng(`narrow3-${guard}`),
        }));
      }
    }

    expect(sawAllInOpponent).toBe(true);
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
