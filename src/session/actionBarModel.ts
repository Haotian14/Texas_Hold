import type { GameState } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { legalActions, round2 } from '../core/gameEngine';

export interface RaiseModel {
  /** 最小投入额，直接取自 legalActions */
  min: number;
  /** 最大投入额，直接取自 legalActions（等于 hero 剩余筹码） */
  max: number;
  /**
   * hero 本街已投入额。上面三个字段全是**本次投入额**（引擎的口径，见
   * gameEngine 的 ActionInput 注释），而动作条上写的是「加注到 X」——两者
   * 相差的就是这个数。放在这里是为了让 UI 不必自己去 GameState 里取
   * `seats[HERO_SEAT].streetContribution`（src/ui 不得从引擎取值）。
   */
  committed: number;
}

export interface ActionBarModel {
  /** 非 hero 回合或手牌已结束时为 false */
  enabled: boolean;
  fold: boolean;
  passive: { type: 'check' } | { type: 'call'; amount: number } | null;
  raise: ({ type: 'bet' | 'raise' } & RaiseModel) | null;
  /** 全下是独立字段而不是加注区间的一个端点：它需要二次确认，其他额度不需要 */
  allin: { amount: number } | null;
}

const DISABLED: ActionBarModel = {
  enabled: false,
  fold: false,
  passive: null,
  raise: null,
  allin: null,
};

/**
 * 把引擎的合法动作翻译成动作条能直接渲染的形状。
 *
 * 合法性的唯一权威是 legalActions —— 最小加注额、加注权
 * （hasActedSinceLastFullRaise）、不足额跟注、「没有加注权的人面对短
 * all-in 只能跟或弃」这些规则全部已在 gameEngine 里处理。本模块只翻译，
 * 不重新判断，否则就是给自己造一个会与引擎分歧的第二权威。
 */
export function actionBarModel(state: GameState): ActionBarModel {
  if (state.handOver || state.toAct !== HERO_SEAT) return DISABLED;

  const legal = legalActions(state);
  if (legal.length === 0) return DISABLED;

  const seat = state.seats[HERO_SEAT];
  const toCall = round2(state.currentBet - seat.streetContribution);

  const callAction = legal.find(a => a.type === 'call');
  const checkAction = legal.find(a => a.type === 'check');
  const raiseAction = legal.find(a => a.type === 'bet' || a.type === 'raise');
  const allinAction = legal.find(a => a.type === 'allin');

  let passive: ActionBarModel['passive'] = null;
  if (checkAction) passive = { type: 'check' };
  else if (callAction) passive = { type: 'call', amount: callAction.min };

  // 这里曾经额外算一组底池比例档（1/3 池、1/2 池…）喂给动作条的预设按钮。
  // 动作条换成加价步进器（+$40 / +$100 / …，见 ActionBar.tsx）之后没有消费
  // 者了，连同 betInvestment 的调用一起删除——底池比例仍然是 EV 引擎候选
  // 尺度与复盘判定的口径，那些在 core/evEstimate 里，不受这次改动影响。
  const raise: ActionBarModel['raise'] = raiseAction
    ? {
        type: raiseAction.type as 'bet' | 'raise',
        min: raiseAction.min,
        max: raiseAction.max,
        committed: seat.streetContribution,
      }
    : null;

  return {
    enabled: true,
    fold: legal.some(a => a.type === 'fold'),
    passive,
    raise,
    allin: allinAction ? { amount: allinAction.min } : null,
  };
}
