import type { GameState, Position } from './types';
import { rfiKey, vsOpenKey, vs3betKey, hasNode } from './ranges';
import { chipsGreater } from './chips';

export interface PreflopNode {
  /** 范围表里的节点 key */
  key: string;
  kind: 'rfi' | 'vs-open' | 'vs-3bet';
  /** vs-open / vs-3bet 时的进攻者位置；rfi 时为 null */
  opener: Position | null;
}

/**
 * 判断一次 'allin' 是不是「筹码不够、被迫按当前下注跟注」（俗称
 * call-for-less），而不是一次真正把加注封顶到底的主动行为。
 *
 * toCall > 0 且手上的筹码不超过 toCall 时，玩家没有加注权——
 * core/gameEngine.ts legalActions 在这种处境下把 'allin' 列为唯一能表达
 * "跟注"的动作类型，core/evEstimate.ts 的候选生成用完全相同的条件区分
 * "跟注"分支与"下注/加注"分支（见 evEstimate.ts 第 171 行）。
 *
 * 这个判据在本文件与 judge.ts::isAggressiveActual 里各需要一次：前者站在
 * Action（历史记录）一侧，问"这次 allin 有没有真的推高 currentBet，该不该
 * 计进翻前加注次数"；后者站在 Situation（当时局面）一侧，问"这次 allin 是
 * 不是一次主动进攻"。两处问的是同一个物理问题，只是数值来源不同（历史记录
 * 的 toCall/stackBefore vs 当下局面的 toCall/heroStack），语义完全一致，
 * 因此抽成这一个只依赖两个数字的纯函数，两处各自传入自己手上有的字段，
 * 不重复这条判据本身——preflopNodeFor 原来完全没有做这个区分，把任何
 * 'allin'（含筹码不够的 call-for-less）都当成一次真正的加注计入 raises，
 * 产生了"phantom open"缺陷：短筹码玩家喊 all-in 但没有真正提高
 * currentBet，preflopNodeFor 却把后续玩家的节点算成"面对开池"。
 */
export function isForcedShortStackAllin(toCall: number, stackAvailable: number): boolean {
  return chipsGreater(toCall, 0) && !chipsGreater(stackAvailable, toCall);
}

/**
 * 从当前状态推断适用的翻前范围表节点。
 *
 * 只数「真正提高了 currentBet」的加注次数：盲注不在 actions 里（见
 * types.ts 上 Action 的注释），所以不必为盲注做任何扣除。跛入是 call，
 * 不计入。筹码不足以完整跟注、被迫按当前下注跟出的 'allin'
 * （isForcedShortStackAllin）语义是「跟注」，同样不计入——否则短筹码玩家
 * 喊全下但没有真正加注时，后续玩家的节点会被错误地算成「面对开池」
 * （phantom open，见上面 isForcedShortStackAllin 的注释）。
 *
 * 4bet 之后的节点范围表未覆盖，返回 null —— 调用方应回落到纯 EV 判定，
 * 而不是拿一个不存在的节点去查表。
 */
export function preflopNodeFor(state: GameState): PreflopNode | null {
  if (state.street !== 'preflop') return null;
  if (state.toAct === null) return null;

  const hero = state.seats.find(s => s.seat === state.toAct);
  if (!hero) return null;

  const raises = state.actions.filter(
    a => a.type === 'raise' || (a.type === 'allin' && !isForcedShortStackAllin(a.toCall, a.stackBefore)),
  );

  if (raises.length === 0) {
    const key = rfiKey(hero.position);
    return hasNode(key) ? { key, kind: 'rfi', opener: null } : null;
  }

  if (raises.length === 1) {
    const opener = state.seats.find(s => s.seat === raises[0].seat);
    if (!opener) return null;
    const key = vsOpenKey(hero.position, opener.position);
    return hasNode(key) ? { key, kind: 'vs-open', opener: opener.position } : null;
  }

  if (raises.length === 2) {
    const threeBettor = state.seats.find(s => s.seat === raises[1].seat);
    if (!threeBettor) return null;
    const key = vs3betKey(hero.position, threeBettor.position);
    return hasNode(key) ? { key, kind: 'vs-3bet', opener: threeBettor.position } : null;
  }

  return null;
}
