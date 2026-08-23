import type { HandRecord } from '../core/types';
import type { HandView } from '../review/view';
import { storedHandOf } from './schema';
import type { StoredHand } from './schema';
import { emptyStats, applyHand } from './stats';
import { matchesFilter, isFilterEmpty } from './filter';
import type { HandFilter } from './filter';
import type { Stats } from './stats';
import { summaryOf, aggregate, SUMMARY_SCHEMA_VERSION } from './summary';
import type { WindowStats } from './summary';
import * as db from './db';

/**
 * 仓库层：把 db.ts 的原子操作组合成应用真正要做的那几件事。
 *
 * db.ts 只管"包 Promise"，schema/stats 只管纯计算，两边都不知道对方存在。
 * 这一层负责把它们接起来，并处理三件只有在接起来之后才存在的问题：
 * 串行化、缓存、失败降级。
 */

/**
 * 写入是串行的。
 *
 * 「写一手」= 读统计 → 算新统计 → 写统计，是一个读-改-写序列。两次写入若
 * 交错（上一手的分析刚算完，用户已经打完了下一手），两边都会读到同一份旧
 * 统计，后写的那个把先写的覆盖掉——一手牌就这么从统计里消失了，而且不报错。
 *
 * 用一条 Promise 链而不是加锁：JS 是单线程的，只要保证每个写入任务在前一个
 * 完成之后才开始，读-改-写之间就没有别人插进来的机会。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  // 链上不能留下 rejected 状态，否则一次失败会让后续所有任务被跳过。
  // 这里吞掉的只是链的状态，调用方拿到的 next 仍然会 reject。
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * 统计的内存副本。
 *
 * 每手都从库里重读一次统计不是不行，但它意味着每手多一次事务往返，而这份
 * 文档只有本页在写。**代价写清楚：多标签页同时开着时，两页各自持有一份缓存，
 * 后写的会覆盖先写的统计。** 手牌本身不受影响（`hands` store 按 id 写入，
 * 两页写的是不同的手），丢的只有聚合数字，且下一次「重新计算统计」能修好。
 * 多标签页不是本项目的目标场景，不为它引 BroadcastChannel 那一套。
 */
let statsCache: Stats | null = null;

export type StorageStatus = 'unknown' | 'ready' | 'unavailable';

let status: StorageStatus = 'unknown';

export function storageStatus(): StorageStatus {
  return status;
}

/**
 * 读统计。第一次会打开数据库，失败则退化为空统计并把状态记成 unavailable。
 *
 * **不抛错**：调用方是界面，它拿到一份空统计照样能渲染，而"数据库打不开"
 * 这件事通过 storageStatus() 表达。牌局不依赖数据库，存不进去也必须能继续打。
 */
export async function loadStats(): Promise<Stats> {
  if (statsCache !== null) return statsCache;
  try {
    const stored = await db.getStats<Stats>();
    statsCache = stored ?? emptyStats();
    status = 'ready';
  } catch {
    statsCache = emptyStats();
    status = 'unavailable';
  }
  return statsCache;
}

export interface SaveOutcome {
  ok: boolean;
  /** 写入后的统计。失败时是内存里那份（未计入本手） */
  stats: Stats;
}

/**
 * 存一手牌并更新统计。
 *
 * view 为 null = 这一手分析失败（见设计文档 §6）。仍然存：record 是完整的，
 * 规则修好后能重跑；因为分析失败就不存，等于把最值得看的那一手永久丢掉。
 *
 * 不抛错，返回 ok。落库失败不该掀掉牌桌——这与 ③-B 里 analyzeHand 抛错的
 * 处理是同一个原则。
 */
export function saveHand(record: HandRecord, view: HandView | null): Promise<SaveOutcome> {
  return serialize(async () => {
    const prev = await loadStats();
    const hand = storedHandOf(record, view);
    // 先算新统计再写库：applyHand 是纯函数，算的过程不会失败，
    // 于是两次写入之间不存在"手写进去了但统计没算"的中间态。
    const next = applyHand(prev, hand);
    try {
      await db.putHand(hand);
      // 摘要写在 hand 之后、stats 之前：三次写不是原子的（既有代码本来就是
      // 两次非原子写），失败时统一走下面的 catch 降级，不为它单独引事务边界。
      await db.putSummary(summaryOf(hand));
      await db.putStats(next);
      statsCache = next;
      status = 'ready';
      return { ok: true, stats: next };
    } catch {
      status = 'unavailable';
      // 缓存保持旧值：本手没写进去，统计就不该把它算上，否则内存里的数字
      // 会比库里多，而用户看到的是内存里那份。
      return { ok: false, stats: prev };
    }
  });
}

/** 标记 / 取消标记「我不认同这个判定」 */
export function setDisputed(id: string, disputed: boolean): Promise<boolean> {
  return serialize(async () => {
    try {
      const hand = await db.getHand(id);
      if (hand === undefined) return false;
      await db.putHand({ ...hand, disputed });
      return true;
    } catch {
      status = 'unavailable';
      return false;
    }
  });
}

export interface HistoryQuery {
  /** 排序依据。默认 worstEvLoss（规格 §10.4：默认按最大损失倒序） */
  sortBy?: 'worstEvLoss' | 'timestamp';
  /** 要凑够几条**命中筛选**的结果 */
  limit?: number;
  /** 从索引的第几条开始扫（不是"第几条命中"）。续页时传上一页返回的 nextOffset */
  offset?: number;
  filter?: HandFilter;
}

export interface HistoryPage {
  rows: StoredHand[];
  /** 下一页从这里继续扫。已扫到底时为 null */
  nextOffset: number | null;
}

/** 每次向数据库要多少条原始记录。筛选后可能只剩几条，所以要成批地扫 */
const SCAN_BATCH = 100;

/**
 * 历史列表的一页。
 *
 * 筛选**不在数据库里做**：IndexedDB 一次查询只能用一个索引，而规格 §10.4 要
 * 的是位置 / 街道 / 分类 / disputed 四项可组合。走索引只能覆盖其中一项，剩下
 * 的仍要在内存里过一遍，不如统一在内存里过——索引留给排序与分页，那才是它
 * 真正省事的地方（一万手不必全读进内存）。
 *
 * 代价：筛得很窄时要多扫几批才能凑够一页。所以这里循环扫描而不是"取一页再
 * 过滤"——后者会让"筛选后不足一页"看起来像"没有更多了"，而其实只是这一批
 * 里恰好没有命中的。
 *
 * 失败时返回空页，由 storageStatus() 表达失败。
 */
export async function listHands(q: HistoryQuery = {}): Promise<HistoryPage> {
  const limit = q.limit ?? 50;
  const filter = q.filter ?? {};
  const noFilter = isFilterEmpty(filter);
  let offset = q.offset ?? 0;
  const rows: StoredHand[] = [];

  try {
    while (rows.length < limit) {
      const batch = await db.pageByIndex(q.sortBy ?? 'worstEvLoss', {
        limit: noFilter ? limit - rows.length : SCAN_BATCH,
        offset,
        direction: 'prev',
      });
      status = 'ready';
      if (batch.length === 0) {
        // 扫到底了
        return { rows, nextOffset: null };
      }
      offset += batch.length;
      for (const h of batch) {
        if (matchesFilter(h, filter)) rows.push(h);
        if (rows.length >= limit) break;
      }
    }
    return { rows, nextOffset: offset };
  } catch {
    status = 'unavailable';
    return { rows: [], nextOffset: null };
  }
}

export async function getHand(id: string): Promise<StoredHand | undefined> {
  try {
    return await db.getHand(id);
  } catch {
    status = 'unavailable';
    return undefined;
  }
}

/**
 * 从库里的全部手牌重算统计。
 *
 * 增量的 applyHand 只挡得住"同一手连着来两次"，挡不住乱序插入（见
 * stats.ts 里 lastHandId 的注释）。而导入恰恰就是乱序插入——一次塞进来
 * 几百手，时间戳与库里已有的交错。所以导入之后必须整表重算，不能接着增量。
 *
 * 排序按 timestamp：滚动窗口 recentNet 是有顺序的，不排的话"最近 200 手"
 * 会变成"getAll 恰好返回的那 200 手"。
 */
export function recomputeStats(): Promise<Stats> {
  return serialize(recomputeStatsInline);
}

export interface ImportOutcome {
  ok: boolean;
  /** 实际写进库的手数 */
  imported: number;
  stats: Stats;
}

/**
 * 导入一批手牌。
 *
 * 按 id 覆盖写入（put），所以重复导入同一份文件是幂等的——用户手边只有一份
 * 备份、点了两次导入，不该变成双倍手数。
 *
 * 写完统一重算统计，理由见 recomputeStats。
 */
export function importHands(hands: readonly StoredHand[]): Promise<ImportOutcome> {
  return serialize(async () => {
    let imported = 0;
    try {
      for (const h of hands) {
        await db.putHand(h);
        await db.putSummary(summaryOf(h));
        imported++;
      }
      status = 'ready';
    } catch {
      status = 'unavailable';
      // 已经写进去的那些不回滚：它们本身是完整的，回滚需要一个这一层没有的
      // 事务边界，而"导进去一半"比"导进去一半又被删掉"对用户更好。
      // 下面照样重算统计，让库里的数字与实际写进去的手对上。
    }
    const stats = await recomputeStatsInline();
    return { ok: imported === hands.length, imported, stats };
  });
}

/** recomputeStats 的内部版本：已经在 serialize 里了，不能再套一层（会死锁） */
async function recomputeStatsInline(): Promise<Stats> {
  try {
    const all = await db.allHands();
    all.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    let next = emptyStats();
    for (const h of all) next = applyHand(next, h);
    await db.putStats(next);
    statsCache = next;
    return next;
  } catch {
    status = 'unavailable';
    return statsCache ?? emptyStats();
  }
}

/** 导出用：取出库里全部手牌 */
export async function allHands(): Promise<StoredHand[]> {
  try {
    const rows = await db.allHands();
    status = 'ready';
    return rows;
  } catch {
    status = 'unavailable';
    return [];
  }
}

/** 「重置数据」。清空两个 store 并把内存缓存一并归零 */
export function resetAll(): Promise<boolean> {
  return serialize(async () => {
    try {
      await db.clearAll();
      statsCache = emptyStats();
      return true;
    } catch {
      status = 'unavailable';
      return false;
    }
  });
}

export type ReportWindow = 200 | 500 | 1000 | 'all';

export interface ReportData {
  stats: WindowStats;
  /** 库里的手数少于所请求的窗口。'all' 时恒为 false */
  partial: boolean;
}

/**
 * 取一个窗口的报表数据。
 *
 * 排序键是 (timestamp, id)，与 recomputeStatsInline 一致。索引游标只能按
 * timestamp 排，同毫秒的两手顺序不稳定——累计曲线会因此在两次渲染间变形。
 */
export async function loadReport(w: ReportWindow): Promise<ReportData> {
  try {
    const rows = w === 'all' ? await db.allSummaries() : await db.lastSummaries(w);
    rows.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    status = 'ready';
    return { stats: aggregate(rows), partial: w !== 'all' && rows.length < w };
  } catch {
    status = 'unavailable';
    return { stats: aggregate([]), partial: false };
  }
}

/** 本次会话是否已经回填过。回填是幂等的，但扫全表不便宜，不重复做 */
let summariesChecked = false;

/**
 * 确保摘要 store 与 hands store 对得上，不对就回填。
 *
 * ③-C 存下的手牌没有摘要（DB_VERSION 2 的升级事务里刻意不做值迁移，
 * 见 db.ts 里 onupgradeneeded 的注释）。回填放在这里、由报表页触发，
 * 而不是放在启动路径上——从不看报表的用户不该为这次全表扫描买单。
 *
 * 触发重建的条件是两者之一：
 * 1. 条数不等——真正的威胁是「写了手牌但没写摘要」，那必然让计数不等；
 * 2. 抽样到的一条摘要 `v !== SUMMARY_SCHEMA_VERSION`。摘要是从 StoredHand
 *    可重建的派生缓存，将来它的字段集变了（SUMMARY_SCHEMA_VERSION 从 1 变成
 *    2），条数仍然相等——只比条数的话，陈旧形状的摘要会被静默继续用，报表
 *    数字会错得没人看得出来。抽样只取一条（`db.lastSummaries(1)`，已经存在，
 *    不新增 db 函数）；库里一条摘要都没有时跳过版本检查，没东西可比。
 *
 * 两种情况都不逐条比 id / 版本：逐条比对要把两个 store 全读出来，代价与
 * 直接重建相同。
 */
export function ensureSummaries(): Promise<boolean> {
  return serialize(async () => {
    if (summariesChecked) return true;
    try {
      const [hands, summaries] = await Promise.all([db.countHands(), db.countSummaries()]);
      const sample = summaries > 0 ? await db.lastSummaries(1) : [];
      const staleVersion = sample.length > 0 && sample[0].v !== SUMMARY_SCHEMA_VERSION;
      if (hands !== summaries || staleVersion) {
        for (const h of await db.allHands()) {
          await db.putSummary(summaryOf(h));
        }
      }
      summariesChecked = true;
      status = 'ready';
      return true;
    } catch {
      status = 'unavailable';
      return false;
    }
  });
}

/** 仅测试用：把模块级状态清干净，让每个用例从同一起点开始 */
export function __resetForTest(): void {
  writeChain = Promise.resolve();
  statsCache = null;
  status = 'unknown';
  summariesChecked = false;
}
