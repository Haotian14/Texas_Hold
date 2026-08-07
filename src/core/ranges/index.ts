import type { Position } from '../types';
import type { HandClass } from '../handClass';
import { parseRange } from '../rangeNotation';
import type { RangeSet } from '../rangeSet';
import { PREFLOP_NODES } from './data';

export type PreflopAction = 'raise' | 'call' | '3bet' | '4bet' | 'fold';

export function rfiKey(pos: Position): string {
  return `${pos}_rfi`;
}

export function vsOpenKey(pos: Position, opener: Position): string {
  return `${pos}_vs_${opener}_open`;
}

export function vs3betKey(pos: Position, threeBettor: Position): string {
  return `${pos}_vs_${threeBettor}_3bet`;
}

/** 解析结果缓存：同一节点的记法只展开一次 */
const cache = new Map<string, Map<string, RangeSet>>();

function nodeRanges(key: string): Map<string, RangeSet> | undefined {
  const cached = cache.get(key);
  if (cached) return cached;

  const raw = PREFLOP_NODES[key];
  if (!raw) return undefined;

  const m = new Map<string, RangeSet>();
  for (const [action, notation] of Object.entries(raw)) {
    if (notation === undefined) continue;
    m.set(action, parseRange(notation));
  }
  cache.set(key, m);
  return m;
}

export function hasNode(key: string): boolean {
  return PREFLOP_NODES[key] !== undefined;
}

/** 该节点列出的非 fold 动作 */
export function nodeActions(key: string): PreflopAction[] {
  const m = nodeRanges(key);
  if (!m) return [];
  return [...m.keys()] as PreflopAction[];
}

/**
 * 某手牌在该节点上的各动作频率，含 fold。
 * fold 是补集：1 减去所有非 fold 动作的频率之和。
 */
export function actionFreqs(key: string, hc: HandClass): Record<string, number> | undefined {
  const m = nodeRanges(key);
  if (!m) return undefined;

  const out: Record<string, number> = {};
  let nonFold = 0;
  for (const [action, range] of m) {
    const w = range.get(hc) ?? 0;
    out[action] = w;
    nonFold += w;
  }
  out.fold = Math.max(0, 1 - nonFold);
  return out;
}

/** 该节点某个动作对应的范围（权重即频率） */
export function rangeForAction(key: string, action: PreflopAction): RangeSet | undefined {
  return nodeRanges(key)?.get(action);
}
