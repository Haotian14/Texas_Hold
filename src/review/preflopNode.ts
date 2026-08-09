import type { GameState, Position } from '../core/types';
import { rfiKey, vsOpenKey, vs3betKey, hasNode } from '../core/ranges';

export interface PreflopNode {
  /** 范围表里的节点 key */
  key: string;
  kind: 'rfi' | 'vs-open' | 'vs-3bet';
  /** vs-open / vs-3bet 时的进攻者位置；rfi 时为 null */
  opener: Position | null;
}

/**
 * 从当前状态推断适用的翻前范围表节点。
 *
 * 只数加注次数：盲注不在 actions 里（见 types.ts 上 Action 的注释），
 * 所以不必为盲注做任何扣除。跛入是 call，不计入。
 *
 * 4bet 之后的节点范围表未覆盖，返回 null —— 调用方应回落到纯 EV 判定，
 * 而不是拿一个不存在的节点去查表。
 */
export function preflopNodeFor(state: GameState): PreflopNode | null {
  if (state.street !== 'preflop') return null;
  if (state.toAct === null) return null;

  const hero = state.seats.find(s => s.seat === state.toAct);
  if (!hero) return null;

  const raises = state.actions.filter(a => a.type === 'raise' || a.type === 'allin');

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
