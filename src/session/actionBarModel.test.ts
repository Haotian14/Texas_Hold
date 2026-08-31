import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import { HERO_SEAT } from '../core/types';
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

  // 引擎的 raise.min/max 都是**本次投入额**（见 gameEngine 的
  // ActionInput 注释），而动作条上那颗按钮写的是「加注到 X」——两者相差 hero
  // 本街已投入的部分。committed 就是这个差额，交给 UI 拼出「加注到」的总额，
  // 免得它自己去 state 里取（src/ui 不得从引擎取值）。
  it('committed 是 hero 本街已投入额，加注到的总额 = committed + 投入额', () => {
    // hero 在 BB：本街已放着 1BB 的盲注，committed 必须非零，否则这条测试
    // 会在 committed 恒为 0 的实现下也通过。
    const s = advanceTo(startHand({ seed: 'abm-committed', buttonSeat: 4 }), HERO_SEAT);
    const m = actionBarModel(s);
    expect(m.raise).not.toBeNull();

    const seat = s.seats[HERO_SEAT];
    expect(seat.streetContribution).toBeGreaterThan(0);
    expect(m.raise!.committed).toBe(seat.streetContribution);

    // 「加注到」的总额必须等于本街最终投入，且严格大于场上当前下注额——
    // 一次合法的加注不可能加到比现有下注还低的位置。动作条能选的额度全部
    // 落在 [min, max] 里（步进器每一步都夹回这个区间），所以钉住两端即可。
    for (const amount of [m.raise!.min, m.raise!.max]) {
      expect(m.raise!.committed + amount).toBeGreaterThan(s.currentBet);
    }
  });

  // all-in 单独一个字段，而不是让 UI 自己从 raise.max 推——动作条要靠它
  // 把主按钮文案换成「全下 $X」（那一下需要用户明确看见），推来的值一旦
  // 与引擎的 allin.min 有一分钱出入，二次确认就会在该出现时不出现。
  it('all-in 是独立字段，金额等于 hero 剩余筹码', () => {
    const s = advanceTo(startHand({ seed: 'abm-5', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    expect(m.raise).not.toBeNull();
    expect(m.allin).not.toBeNull();
    expect(m.allin!.amount).toBe(s.seats[HERO_SEAT].stack);
    // 两者恒等是动作条判定「当前额度已经是全下」的前提（见 ActionBar.tsx）
    expect(m.raise!.max).toBe(m.allin!.amount);
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
