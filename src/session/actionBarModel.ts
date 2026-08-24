import type { GameState } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { legalActions, currentPot, round2, chipsGreater } from '../core/gameEngine';

export interface RaiseModel {
  /** 最小投入额，直接取自 legalActions */
  min: number;
  /** 最大投入额，直接取自 legalActions（等于 hero 剩余筹码） */
  max: number;
  /** 快捷尺度。超出 [min,max] 的档位不会出现在这里 */
  presets: { label: string; amount: number }[];
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
  /** 全下是独立字段而不是 presets 的一档：它需要二次确认，其他档位不需要 */
  allin: { amount: number } | null;
}

const PRESET_FRACTIONS: readonly { label: string; f: number }[] = [
  { label: '1/3 池', f: 1 / 3 },
  { label: '1/2 池', f: 1 / 2 },
  { label: '2/3 池', f: 2 / 3 },
  { label: '池', f: 1 },
];

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

  let raise: ActionBarModel['raise'] = null;
  if (raiseAction) {
    // 「池」的通用口径是跟注后的底池：先把欠的跟平，再按比例往里加。
    // toCall 为 0 时退化成「下注 X 倍底池」，与直觉一致。
    const potAfterCall = round2(currentPot(state) + toCall);
    const presets = PRESET_FRACTIONS.map(({ label, f }) => ({
      label,
      amount: round2(toCall + f * potAfterCall),
    })).filter(
      // 落在界外的档位直接不出现，而不是夹到边界上：夹到 max 会变成一个
      // 伪装成「1/2 池」的全下，而全下需要二次确认。宁可少给一个按钮。
      p => !chipsGreater(raiseAction.min, p.amount) && !chipsGreater(p.amount, raiseAction.max),
    );

    raise = {
      type: raiseAction.type as 'bet' | 'raise',
      min: raiseAction.min,
      max: raiseAction.max,
      presets,
      committed: seat.streetContribution,
    };
  }

  return {
    enabled: true,
    fold: legal.some(a => a.type === 'fold'),
    passive,
    raise,
    allin: allinAction ? { amount: allinAction.min } : null,
  };
}
