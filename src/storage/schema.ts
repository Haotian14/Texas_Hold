import type { HandRecord, Position } from '../core/types';
import type { HandView } from '../review/view';
import type { MistakeTag } from '../review/taxonomy';

/**
 * 存储层的 schema 与值构造，**纯数据，不碰 IndexedDB**。
 *
 * 分成这一份与 db.ts 两个文件是刻意的：本项目不引 fake-indexeddb 之类的依赖
 * 去测数据库（③-B 起就没引过新依赖，且那类假实现测出来的多半是假实现自己的
 * 行为）。所以把**所有能测的东西**——库名、版本、store 与索引的定义、落库值
 * 的构造与索引字段的取值——全挤到这一侧，让 db.ts 只剩"把回调包成 Promise"
 * 的样板，那部分由浏览器验收覆盖。
 */

export const DB_NAME = 'poker-trainer';
export const DB_VERSION = 2;

export const HANDS_STORE = 'hands';
export const STATS_STORE = 'stats';
export const SUMMARIES_STORE = 'summaries';

/** stats 是单条聚合文档，主键固定 */
export const STATS_KEY = 'global';

export interface IndexDef {
  name: string;
  keyPath: string;
  multiEntry?: boolean;
}

export interface StoreDef {
  name: string;
  keyPath: string;
  indexes: IndexDef[];
}

/**
 * 三个 object store（设计文档 §9，summaries 是 ③-D-1 漏洞报表追加的第三个）。
 *
 * hands 上四个索引的 keyPath 都指向 StoredHand 的**顶层**字段，而不是
 * `record.timestamp` / `view.worstEvLoss` 这样的点号路径。IndexedDB 支持点号
 * 路径，但那会让索引和内层结构绑死：view 为 null 的那些手（分析失败）在
 * `view.worstEvLoss` 上取不到值，会被索引整个跳过，于是"按损失排序"的列表里
 * 悄悄少了几手。顶层冗余一份，代价是几十字节。
 */
export const STORES: readonly StoreDef[] = [
  {
    name: HANDS_STORE,
    keyPath: 'id',
    indexes: [
      { name: 'timestamp', keyPath: 'timestamp' },
      { name: 'worstEvLoss', keyPath: 'worstEvLoss' },
      { name: 'heroPosition', keyPath: 'heroPosition' },
      { name: 'mistakeTags', keyPath: 'mistakeTags', multiEntry: true },
    ],
  },
  {
    name: STATS_STORE,
    keyPath: 'key',
    indexes: [],
  },
  {
    name: SUMMARIES_STORE,
    keyPath: 'id',
    // 只有一个索引：报表按时间取最近 N 手，其余维度（位置、分类、街）都是
    // 取回之后在内存里聚合的——一千条摘要在内存里过一遍是微秒级，
    // 为它们各建一个索引只会让每次写入更慢。
    indexes: [{ name: 'timestamp', keyPath: 'timestamp' }],
  },
];

/** 落库的一手牌 */
export interface StoredHand {
  /** = HandRecord.id */
  id: string;
  /** 索引字段，冗余自 record.timestamp */
  timestamp: number;
  /** 索引字段，冗余自 view.worstEvLoss；分析失败时为 0 */
  worstEvLoss: number;
  /** 索引字段，冗余自 record 里 hero 座位的位置 */
  heroPosition: Position;
  /** multiEntry 索引字段，冗余自 view.tags；分析失败时为空数组 */
  mistakeTags: MistakeTag[];
  /**
   * 用户点过「我不认同这个判定」。
   *
   * 放在顶层而不是塞进 view：它是用户对这一手的**标注**，不是分析的产物。
   * 规格 §9 说规则升级后要能对历史手牌批量重跑分析——重跑会整个换掉 view，
   * 若 disputed 住在里面就会被一起冲掉，而"我不认同"恰恰是用来改进规则的
   * 那份反馈，冲掉它等于把改进依据丢了。
   */
  disputed: boolean;
  record: HandRecord;
  /**
   * 复盘视图。**null = 这一手分析失败**（analyzeHand 抛错，见设计文档 §6）。
   *
   * 仍然入库：record 本身是完整的，规则修好之后可以重跑。若因为分析失败就
   * 不存，这一手就永久消失了，而它多半正是最值得看的那一手。
   */
  view: HandView | null;
}

/** hero 在这一手的位置。record.seats 里必有 hero 座位，否则 record 本身就是坏的 */
export function heroPositionOf(record: HandRecord): Position {
  const seat = record.seats.find(s => s.seat === record.heroSeat);
  if (seat === undefined) {
    throw new Error(`HandRecord ${record.id} 缺少 hero 座位 ${record.heroSeat}`);
  }
  return seat.position;
}

/**
 * 构造落库值。索引字段在这里一次性从 record / view 里抽出来，
 * 调用方不需要知道有哪几个索引。
 */
export function storedHandOf(
  record: HandRecord,
  view: HandView | null,
  opts: { disputed?: boolean } = {},
): StoredHand {
  return {
    id: record.id,
    timestamp: record.timestamp,
    worstEvLoss: view === null ? 0 : view.worstEvLoss,
    heroPosition: heroPositionOf(record),
    mistakeTags: view === null ? [] : [...view.tags],
    disputed: opts.disputed ?? false,
    record,
    view,
  };
}
