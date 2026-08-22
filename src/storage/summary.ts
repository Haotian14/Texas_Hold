import type { Position, Street } from '../core/types';
import type { MistakeTag } from '../review/taxonomy';
import { round2 } from '../core/chips';
import type { StoredHand } from './schema';
import type { TagStat, PositionStat } from './stats';
import { emptyTagStats, emptyStreetStats, emptyPositionStats, heroNetOf } from './stats';

/**
 * 每手摘要与窗口聚合。**纯函数**，不碰 IndexedDB——db.ts 负责把结果存下来，
 * UI 不直接调这里的函数（后续任务经 repo.ts 接线）。
 *
 * 为什么要有这一层：`Stats`（stats.ts）只有一个全局累计口径，是「单条聚合
 * 文档，每手结束时增量更新」（规格 §9）的产物，天生答不出「最近 50 手」
 * 「8 月这一段」这类任意窗口的问题——增量结构没有减法，退不出某一手。
 * §10.5 的漏洞报表恰好要任意窗口，于是每手额外存一条轻量摘要
 * （`HandSummary`，估计几十字节：分街 4 个数、分类最多 15 项、外加几个标量），
 * 报表扫一段摘要现算，用不着把完整的 `StoredHand`（含整副 `HandRecord`、
 * 每个决策点的 EV 候选列表，规格估 1–2 KB）都读出来。
 */

export const SUMMARY_SCHEMA_VERSION = 1;

export interface HandSummary {
  /** 摘要形状的版本号。summaryOf 产出时填 SUMMARY_SCHEMA_VERSION；
      与已存摘要的 v 不一致时触发重建是后续任务（repo 层回填）的事，
      这里只负责把值填对——摘要是从 StoredHand 可重建的派生缓存，
      不建这个版本号的话，字段集变了之后陈旧摘要会被静默继续用，
      报表数字错得没人看得出来 */
  v: number;
  id: string;
  timestamp: number;
  netBB: number;
  position: Position;
  byStreet: Record<Street, number>;
  /** 只含这一手实际出现过的分类。不像 Stats.byTag 填满 15 项骨架——
      单手命中的分类通常只有 0～2 个，逐手都填满骨架是纯粹的空间浪费，
      骨架该在 aggregate 折算一批摘要时补一次就够 */
  byTag: Partial<Record<MistakeTag, TagStat>>;
}

/**
 * 把一手拆成摘要。逻辑是 `applyHand`（stats.ts）里那段累计逻辑的单手版——
 * 两处刻意保持同一套读法（都读 `hand.view.decisions`、都用 `round2`），
 * 这是下面一致性闸测试锁住的前提。
 */
export function summaryOf(hand: StoredHand): HandSummary {
  const byStreet = emptyStreetStats();
  const byTag: Partial<Record<MistakeTag, TagStat>> = {};

  // view === null 表示这一手分析失败。仍然产出摘要：那一手确实打过，
  // 手数与盈亏要进 BB/100 的分母，排除它会让战绩偏离真实值。
  if (hand.view !== null) {
    for (const d of hand.view.decisions) {
      byStreet[d.street] = round2(byStreet[d.street] + d.evLoss);
      if (d.tag !== null) {
        const cur = byTag[d.tag] ?? { count: 0, evLoss: 0 };
        byTag[d.tag] = { count: cur.count + 1, evLoss: round2(cur.evLoss + d.evLoss) };
      }
    }
  }

  return {
    v: SUMMARY_SCHEMA_VERSION,
    id: hand.id,
    timestamp: hand.timestamp,
    netBB: heroNetOf(hand),
    position: hand.heroPosition,
    byStreet,
    byTag,
  };
}

export interface WindowStats {
  hands: number;
  netBB: number;
  byTag: Record<MistakeTag, TagStat>;
  byStreet: Record<Street, number>;
  byPosition: Record<Position, PositionStat>;
  /** 窗口内每手的净盈亏，按 rows 入参顺序，供报表画累计曲线。
      与 Stats.recentNet 不同：没有 200 手的上限，窗口多大它就多长 */
  netSeries: number[];
}

/**
 * 把一批摘要折成窗口统计。**入参必须已按 (timestamp, id) 升序**——
 * netSeries 是累计曲线的输入，顺序不稳会让同一份数据渲染出不同形状。
 * 排序由 repo 层负责（它才知道次级键），这里不重复做。
 */
export function aggregate(rows: readonly HandSummary[]): WindowStats {
  const byTag = emptyTagStats();
  const byStreet = emptyStreetStats();
  const byPosition = emptyPositionStats();
  const netSeries: number[] = [];
  let netBB = 0;

  for (const r of rows) {
    netBB = round2(netBB + r.netBB);
    netSeries.push(r.netBB);

    const pos = byPosition[r.position];
    pos.hands += 1;
    pos.netBB = round2(pos.netBB + r.netBB);

    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      byStreet[street] = round2(byStreet[street] + r.byStreet[street]);
    }
    for (const [tag, stat] of Object.entries(r.byTag) as [MistakeTag, TagStat][]) {
      const t = byTag[tag];
      t.count += stat.count;
      t.evLoss = round2(t.evLoss + stat.evLoss);
    }
  }

  return { hands: rows.length, netBB, byTag, byStreet, byPosition, netSeries };
}
