import type { Position, Street } from '../core/types';
import type { MistakeTag } from '../review/taxonomy';
import { PREFLOP_TAGS, POSTFLOP_TAGS } from '../review/taxonomy';
import { round2 } from '../core/chips';
import type { StoredHand } from './schema';

/**
 * 聚合统计。**纯函数**，不碰 IndexedDB——db.ts 负责把结果存下来。
 *
 * 规格 §9 要求「单条聚合文档，每手结束时增量更新」。增量而不是每次全表重算，
 * 是因为一万手 × 2 KB 全读出来只为算个平均值，代价与收益不成比例。
 * 代价是它有状态，于是有了下面 lastHandId 那道防重复计入的闸。
 */

export const STATS_SCHEMA_VERSION = 1;

/**
 * 滚动窗口存 200 手而不是规格 §9 写的 100。
 *
 * §10.5 的趋势项要「最近 100 手 vs 之前 100 手」——只留 100 的话，"之前那 100 手"
 * 永远取不到。窗口是这个数组唯一的成本来源（200 个 number ≈ 1.6 KB），
 * 为了一个规格里明写的图表多留一倍，划算。
 */
export const RECENT_WINDOW = 200;

export interface TagStat {
  count: number;
  /** 该分类累计造成的 EV 损失，单位 BB */
  evLoss: number;
}

export interface PositionStat {
  hands: number;
  netBB: number;
}

export interface Stats {
  schemaVersion: number;
  hands: number;
  /**
   * 累计净盈亏，单位 BB。**这是每手 netBB 的求和**，与顶栏显示的净盈亏
   * （`ledger.ts` 的「当前筹码 − 累计买入」）算法不同。
   *
   * 正常情况下两者相等：补码把筹码补回去的同时也把买入加上去，差额守恒。
   * 但它们会在一种情况下分叉——某一手因为存储不可用（隐私模式、配额满）
   * 没能落库，那一手就不在这个和里，而顶栏的账本不受影响。所以这两个数
   * 各有各的用途：顶栏那个是「你现在赢了多少钱」的权威，这个是 BB/100
   * 的分母口径所要求的「被统计到的手」的盈亏和。不要拿其中一个去校验另一个。
   */
  netBB: number;
  /** 每个失误分类的次数与累计损失 */
  byTag: Record<MistakeTag, TagStat>;
  /** 分街的累计 EV 损失 */
  byStreet: Record<Street, number>;
  /** 分位置的手数与盈亏 */
  byPosition: Record<Position, PositionStat>;
  /** 最近若干手的净盈亏，新的在末尾。长度上限 RECENT_WINDOW */
  recentNet: number[];
  /**
   * 最后一次计入的手牌 id，防重复计入。
   *
   * 起因很具体：React StrictMode 下 effect 会双跑，而「手牌结束 → 写库 →
   * 更新统计」这条链正好挂在 effect 上；另外落库失败后的重试也会让同一手
   * 再来一次。重复计入不会报错，只会让所有数字慢慢变大，等发现时已经没法
   * 回溯是哪几手被算了两遍。
   *
   * 它只挡**连续重复**（同一手紧接着再来一次），挡不住"隔了几手之后又把
   * 某一手补进来"。后者在当前接线下不会发生（手牌按顺序结束、按顺序写入），
   * 若将来加了「批量重跑历史」那类功能，必须改成全量重算而不是继续增量。
   */
  lastHandId: string | null;
}

/** 从 taxonomy 的两个常量数组建骨架。summary.ts 的 aggregate 也用它——
    两处各写一份的话，taxonomy 加分类时只有一处会跟上 */
export function emptyTagStats(): Record<MistakeTag, TagStat> {
  const out = {} as Record<MistakeTag, TagStat>;
  // 从 taxonomy 的两个常量数组建，不手写字面量：taxonomy 加分类时这里自动跟上，
  // 而手写的对象字面量会缺一项，缺的那一项在 applyHand 里会读到 undefined。
  for (const tag of [...PREFLOP_TAGS, ...POSTFLOP_TAGS]) {
    out[tag] = { count: 0, evLoss: 0 };
  }
  return out;
}

/** Record<Street, number> 而不是普通对象：Street 加成员时这里编译失败。
    同样供 summary.ts 的 aggregate 复用，理由同 emptyTagStats */
export function emptyStreetStats(): Record<Street, number> {
  return { preflop: 0, flop: 0, turn: 0, river: 0 };
}

/** 同理，Position 加成员时编译失败，而不是在报表上少一行。
    同样供 summary.ts 的 aggregate 复用 */
export function emptyPositionStats(): Record<Position, PositionStat> {
  return {
    UTG: { hands: 0, netBB: 0 },
    HJ: { hands: 0, netBB: 0 },
    CO: { hands: 0, netBB: 0 },
    BTN: { hands: 0, netBB: 0 },
    SB: { hands: 0, netBB: 0 },
    BB: { hands: 0, netBB: 0 },
  };
}

export function emptyStats(): Stats {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    hands: 0,
    netBB: 0,
    byTag: emptyTagStats(),
    byStreet: emptyStreetStats(),
    byPosition: emptyPositionStats(),
    recentNet: [],
    lastHandId: null,
  };
}

/** 这一手 hero 的净盈亏（BB）。没有 hero 那一行时记 0 */
export function heroNetOf(hand: StoredHand): number {
  const r = hand.record.results.find(x => x.seat === hand.record.heroSeat);
  return r === undefined ? 0 : r.netBB;
}

/**
 * 把一手牌计入统计，返回新的 Stats。**不修改入参**。
 *
 * 纯函数是刻意的：它让「重复计入」这件事可以在测试里直接构造，也让
 * 调用方没有借口就地改一个共享对象。
 */
export function applyHand(prev: Stats, hand: StoredHand): Stats {
  // 连续重复直接原样返回。返回同一个引用（而不是浅拷贝）是有意的：
  // 调用方若把返回值与入参做引用比较，能立刻看出"这次没有变化"。
  if (prev.lastHandId === hand.id) return prev;

  const net = heroNetOf(hand);

  const byTag = emptyTagStats();
  for (const tag of [...PREFLOP_TAGS, ...POSTFLOP_TAGS]) {
    byTag[tag] = { ...prev.byTag[tag] };
  }
  const byStreet = { ...prev.byStreet };
  const byPosition = { ...prev.byPosition };
  byPosition[hand.heroPosition] = { ...prev.byPosition[hand.heroPosition] };

  // view 为 null（分析失败）时仍然计手数与盈亏，只是没有失误可归类：
  // 那一手确实打过，把它排除在分母外会让 BB/100 偏离真实战绩。
  if (hand.view !== null) {
    for (const d of hand.view.decisions) {
      byStreet[d.street] = round2(byStreet[d.street] + d.evLoss);
      if (d.tag !== null) {
        const t = byTag[d.tag];
        t.count += 1;
        t.evLoss = round2(t.evLoss + d.evLoss);
      }
    }
  }

  const pos = byPosition[hand.heroPosition];
  pos.hands += 1;
  pos.netBB = round2(pos.netBB + net);

  // slice 从尾部取：新的在末尾，超出窗口的从头掉出去
  const recentNet = [...prev.recentNet, net].slice(-RECENT_WINDOW);

  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    hands: prev.hands + 1,
    netBB: round2(prev.netBB + net),
    byTag,
    byStreet,
    byPosition,
    recentNet,
    lastHandId: hand.id,
  };
}

/** BB/100：每百手赢多少 BB。零手时返回 0 而不是 NaN */
export function bb100(hands: number, netBB: number): number {
  if (hands === 0) return 0;
  return round2((netBB / hands) * 100);
}

/**
 * 趋势：最近 n 手与紧邻其前 n 手的 BB/100。
 *
 * 任一段不足 n 手时该段返回 null，而不是拿不足的样本硬算一个数——
 * 用 12 手算出来的 BB/100 波动能到几百，摆在界面上会被读成"最近状态崩了"。
 */
export function trend(
  recentNet: readonly number[],
  n: number,
): { current: number | null; previous: number | null } {
  const cur = recentNet.slice(-n);
  const prev = recentNet.slice(-2 * n, -n);
  return {
    current: cur.length === n ? bb100(n, cur.reduce((a, b) => a + b, 0)) : null,
    previous: prev.length === n ? bb100(n, prev.reduce((a, b) => a + b, 0)) : null,
  };
}

export interface LeakRow {
  tag: MistakeTag;
  count: number;
  evLoss: number;
}

/**
 * 漏洞排行榜：按**累计 evLoss** 倒序，不是按次数。
 *
 * 规格 §10.5 明写了理由：3 次大错比 30 次小错更值得改。按次数排会把
 * 一堆 0.2 BB 的小偏差顶到 3 BB 的重大失误前面，用户照着改的是错的东西。
 * 次数为 0 的分类不出现——榜上列一堆"你从没犯过"是噪音。
 */
export function leaks(byTag: Record<MistakeTag, TagStat>): LeakRow[] {
  return (Object.entries(byTag) as [MistakeTag, TagStat][])
    .filter(([, s]) => s.count > 0)
    .map(([tag, s]) => ({ tag, count: s.count, evLoss: s.evLoss }))
    .sort((a, b) => b.evLoss - a.evLoss || a.tag.localeCompare(b.tag));
}
