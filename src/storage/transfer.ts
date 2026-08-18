import type { StoredHand } from './schema';

/**
 * JSON 导出 / 导入（规格 §9：「提供 JSON 导出/导入，用于换设备迁移与问题反馈」）。
 *
 * 纯函数，不碰 IndexedDB，也不碰 DOM——取数据与触发下载都在调用方。
 */

export const TRANSFER_FORMAT = 'poker-trainer-export';
export const TRANSFER_VERSION = 1;

export interface TransferFile {
  format: typeof TRANSFER_FORMAT;
  version: number;
  exportedAt: number;
  hands: StoredHand[];
}

/**
 * 打包导出。
 *
 * **不导出统计。** 统计是从手牌推出来的派生值，把它一起写进文件，就多了一份
 * 可能与手牌对不上的真相——用户手改文件、或两次导出合并时，先坏的一定是它。
 * 导入侧统一重算（见 repo.recomputeStats），代价是一次全表扫描，换来的是
 * "库里的统计永远等于手牌算出来的统计"这条不变量。
 */
export function buildTransfer(hands: readonly StoredHand[], now: number): TransferFile {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: now,
    hands: [...hands],
  };
}

export interface ImportResult {
  ok: boolean;
  hands: StoredHand[];
  /** 结构不完整、被跳过的条目数 */
  skipped: number;
  /** ok 为 false 时说明原因；面向用户，可直接显示 */
  error: string | null;
}

/** 一条记录至少要有这些才可能被渲染或重跑 */
function looksLikeHand(x: unknown): x is StoredHand {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  if (typeof h.id !== 'string' || h.id === '') return false;
  if (typeof h.timestamp !== 'number' || !Number.isFinite(h.timestamp)) return false;
  if (typeof h.heroPosition !== 'string') return false;
  if (typeof h.worstEvLoss !== 'number' || !Number.isFinite(h.worstEvLoss)) return false;
  if (!Array.isArray(h.mistakeTags)) return false;
  if (typeof h.disputed !== 'boolean') return false;
  // record 是重跑分析的唯一依据，必须在；view 允许为 null（那一手分析失败过）
  const rec = h.record;
  if (typeof rec !== 'object' || rec === null) return false;
  const r = rec as Record<string, unknown>;
  if (typeof r.id !== 'string') return false;
  if (!Array.isArray(r.actions) || !Array.isArray(r.results) || !Array.isArray(r.seats)) {
    return false;
  }
  if (h.view !== null && (typeof h.view !== 'object' || h.view === undefined)) return false;
  return true;
}

/**
 * 解析导入文件。
 *
 * 单条坏记录**跳过而不是整份拒绝**：用户来导入多半是在恢复备份或换设备，
 * 为了一条坏数据把另外九百多手一起挡在门外，是把最坏的结果强加给最需要
 * 这个功能的人。但跳过的条数必须回报给调用方——静默丢数据比拒绝更糟。
 *
 * 整份文件层面的问题（不是 JSON、格式标记不对、版本更高）则一律拒绝：
 * 那种情况下继续往下猜，只会把别的应用的文件当成手牌塞进库里。
 */
export function parseTransfer(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, hands: [], skipped: 0, error: '这不是一个 JSON 文件。' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, hands: [], skipped: 0, error: '文件内容不是一个对象。' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.format !== TRANSFER_FORMAT) {
    return {
      ok: false,
      hands: [],
      skipped: 0,
      error: '这不是本应用导出的文件（缺少 format 标记）。',
    };
  }
  if (typeof obj.version !== 'number') {
    return { ok: false, hands: [], skipped: 0, error: '文件缺少版本号。' };
  }
  if (obj.version > TRANSFER_VERSION) {
    // 只挡更高的版本：更低的版本将来可以在这里做逐版本升级，而更高的版本
    // 意味着这份文件里有本代码不认识的字段，导进来就是拿旧代码去解释新数据。
    return {
      ok: false,
      hands: [],
      skipped: 0,
      error: `文件版本 ${obj.version} 高于本应用支持的 ${TRANSFER_VERSION}，请先升级应用。`,
    };
  }
  if (!Array.isArray(obj.hands)) {
    return { ok: false, hands: [], skipped: 0, error: '文件里没有手牌列表。' };
  }

  const hands: StoredHand[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const item of obj.hands) {
    if (!looksLikeHand(item)) {
      skipped++;
      continue;
    }
    // 同一份文件里重复的 id 只留第一条：后面那条写进库会覆盖前一条，
    // 结果取决于遍历顺序，那不是一个可解释的行为。
    if (seen.has(item.id)) {
      skipped++;
      continue;
    }
    seen.add(item.id);
    hands.push(item);
  }

  return { ok: true, hands, skipped, error: null };
}

/** 导出文件名。带日期，便于用户区分多次备份 */
export function transferFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `poker-trainer-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
