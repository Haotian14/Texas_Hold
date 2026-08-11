import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import { HERO_SEAT, SEAT_COUNT } from '../core/types';
import type { GameState } from '../core/types';
import { actionBarModel } from './actionBarModel';

/** 把牌局推进到指定座位行动为止，途中所有人都用 fold 以外的最省事动作 */
function advanceTo(state: GameState, seat: number): GameState {
  let s = state;
  let guard = 0;
  while (s.toAct !== seat) {
    if (++guard > 50) throw new Error('推进失败：目标座位一直没轮到');
    const legal = legalActions(s);
    const passive = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'call');
    if (!passive) throw new Error('没有过牌或跟注可选');
    s = applyAction(s, { type: passive.type });
  }
  return s;
}

describe('actionBarModel', () => {
  it('非 hero 回合时禁用', () => {
    // buttonSeat = 0 时 UTG 是座位 3，hero(0) 不是第一个行动的
    const s = startHand({ seed: 'abm-1', buttonSeat: 0 });
    expect(s.toAct).not.toBe(HERO_SEAT);
    expect(actionBarModel(s).enabled).toBe(false);
  });

  it('hero 回合时启用，且给出的动作集合与 legalActions 一一对应', () => {
    const s = advanceTo(startHand({ seed: 'abm-2', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    const legalTypes = new Set(legalActions(s).map(a => a.type));

    expect(m.enabled).toBe(true);
    expect(m.fold).toBe(legalTypes.has('fold'));
    expect(m.passive !== null).toBe(legalTypes.has('check') || legalTypes.has('call'));
    expect(m.raise !== null).toBe(legalTypes.has('bet') || legalTypes.has('raise'));
    expect(m.allin !== null).toBe(legalTypes.has('allin'));
  });

  it('加注上下界直接取自 legalActions，不自行推导', () => {
    const s = advanceTo(startHand({ seed: 'abm-3', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    const legalRaise = legalActions(s).find(a => a.type === 'bet' || a.type === 'raise');

    expect(legalRaise).toBeDefined();
    expect(m.raise).not.toBeNull();
    expect(m.raise!.min).toBe(legalRaise!.min);
    expect(m.raise!.max).toBe(legalRaise!.max);
  });

  it('快捷尺度全部落在 [min, max] 内，落不进去的档位不出现', () => {
    for (let button = 0; button < SEAT_COUNT; button++) {
      const s = advanceTo(startHand({ seed: `abm-p${button}`, buttonSeat: button }), HERO_SEAT);
      const m = actionBarModel(s);
      if (!m.raise) continue;
      for (const p of m.raise.presets) {
        expect(p.amount).toBeGreaterThanOrEqual(m.raise.min);
        expect(p.amount).toBeLessThanOrEqual(m.raise.max);
      }
    }
  });

  it('快捷尺度按「跟注后的底池」计价：投入额 = toCall + f × (pot + toCall)', () => {
    const s = advanceTo(startHand({ seed: 'abm-4', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    expect(m.raise).not.toBeNull();

    const seat = s.seats[HERO_SEAT];
    const toCall = s.currentBet - seat.streetContribution;
    const pot = s.seats.reduce((a, x) => a + x.totalContribution, 0);
    const potAfterCall = pot + toCall;

    const half = m.raise!.presets.find(p => p.label === '1/2 池');
    if (half) {
      expect(half.amount).toBeCloseTo(toCall + 0.5 * potAfterCall, 2);
    }
  });

  it('all-in 是独立字段，不混在 presets 里', () => {
    const s = advanceTo(startHand({ seed: 'abm-5', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    if (m.raise) {
      expect(m.raise.presets.some(p => p.label.includes('全下'))).toBe(false);
      expect(m.raise.presets.some(p => p.label.toLowerCase().includes('allin'))).toBe(false);
    }
    expect(m.allin).not.toBeNull();
    expect(m.allin!.amount).toBe(s.seats[HERO_SEAT].stack);
  });

  it('手牌结束后禁用', () => {
    let s = startHand({ seed: 'abm-6', buttonSeat: 0 });
    let guard = 0;
    while (!s.handOver) {
      if (++guard > 100) throw new Error('牌局没有结束');
      s = applyAction(s, { type: 'fold' });
    }
    expect(actionBarModel(s).enabled).toBe(false);
  });
});
