import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandRecord } from '../core/types';
import type { HandView } from '../review/view';
import { storedHandOf } from './schema';
import type { StoredHand } from './schema';
import type { Stats } from './stats';
import { heroNetOf } from './stats';
import type { HandSummary } from './summary';

/**
 * db.ts 被替换成内存实现。
 *
 * 这不是"用假数据库测数据库"——db.ts 那一层刻意做薄到只剩包 Promise，没什么
 * 可测的。这里测的是 repo.ts 自己的三件事：写入串行化、内存缓存、失败降级。
 * 它们都只在"把 db / schema / stats 接起来"之后才存在，而且都是不接线就看不见
 * 的那种缺陷（统计被悄悄覆盖、失败后数字对不上）。
 */

interface FakeDb {
  hands: Map<string, StoredHand>;
  summaries: Map<string, HandSummary>;
  stats: Stats | undefined;
  /** true 时所有写入抛错，用来测降级 */
  failWrites: boolean;
  /** 只让这一手的写入抛错。全局开关是同步设的，而串行任务是异步跑的，
      等任务真正执行时开关早被复位了——定向失败才测得到"中间一次失败" */
  failHandId: string | null;
  failReads: boolean;
  /** 每次 putStats 前等一拍，制造读-改-写交错的机会 */
  slowStats: boolean;
  putStatsCalls: number;
  /** allHands 被调用的次数。ensureSummaries「计数相等时不扫表」靠它断言 */
  allHandsCalls: number;
}

const fake: FakeDb = {
  hands: new Map(),
  summaries: new Map(),
  stats: undefined,
  failWrites: false,
  failHandId: null,
  failReads: false,
  slowStats: false,
  putStatsCalls: 0,
  allHandsCalls: 0,
};

const tick = () => new Promise(r => setTimeout(r, 0));

vi.mock('./db', () => ({
  isStorageAvailable: () => true,
  openDb: async () => ({}),
  closeDb: async () => {},
  putHand: async (h: StoredHand) => {
    if (fake.failWrites || fake.failHandId === h.id) throw new Error('写入失败');
    fake.hands.set(h.id, h);
  },
  getHand: async (id: string) => {
    if (fake.failReads) throw new Error('读取失败');
    return fake.hands.get(id);
  },
  allHands: async () => {
    fake.allHandsCalls++;
    if (fake.failReads) throw new Error('读取失败');
    return [...fake.hands.values()];
  },
  countHands: async () => {
    if (fake.failReads) throw new Error('读取失败');
    return fake.hands.size;
  },
  pageByIndex: async (_i: string, o: { limit: number; offset?: number }) => {
    if (fake.failReads) throw new Error('读取失败');
    return [...fake.hands.values()]
      .sort((a, b) => b.worstEvLoss - a.worstEvLoss)
      .slice(o.offset ?? 0, (o.offset ?? 0) + o.limit);
  },
  getStats: async () => {
    if (fake.failReads) throw new Error('读取失败');
    return fake.stats;
  },
  putStats: async (v: Stats) => {
    fake.putStatsCalls++;
    if (fake.slowStats) await tick();
    if (fake.failWrites) throw new Error('写入失败');
    fake.stats = v;
  },
  clearAll: async () => {
    if (fake.failWrites) throw new Error('写入失败');
    fake.hands.clear();
    fake.stats = undefined;
    fake.summaries.clear();
  },
  putSummary: async (s: HandSummary) => {
    if (fake.failWrites) throw new Error('写入失败');
    fake.summaries.set(s.id, s);
  },
  allSummaries: async () => {
    if (fake.failReads) throw new Error('读取失败');
    return [...fake.summaries.values()];
  },
  countSummaries: async () => {
    if (fake.failReads) throw new Error('读取失败');
    return fake.summaries.size;
  },
  // 按 timestamp 倒序取最近 n 条——图省事返回插入顺序的话，loadReport 里
  // "取回后按 (timestamp, id) 升序重排"那段逻辑就测不到了，见任务简报。
  lastSummaries: async (n: number) => {
    if (fake.failReads) throw new Error('读取失败');
    return [...fake.summaries.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, n);
  },
}));

const repo = await import('./repo');

function record(id: string, net: number, timestamp = 1700000000000): HandRecord {
  return {
    id,
    heroSeat: 0,
    timestamp,
    seats: [{ seat: 0, position: 'BTN', personaId: 'hero', startingStack: 100, holeCards: [] }],
    results: [{ seat: 0, netBB: net, showdown: true }],
  } as unknown as HandRecord;
}

function view(id: string): HandView {
  return {
    schemaVersion: 1,
    recordId: id,
    heroSeat: 0,
    decisions: [],
    totalEvLoss: 0,
    worstEvLoss: 0,
    tags: [],
  };
}

/**
 * 报表相关测试用的辅助：净值由 id 派生，而不是像 record() 那样由调用方传入。
 * recordOf 造记录、netOf 供测试端独立算出期望值，两处共用同一个派生规则，
 * 不会因为分别硬编码而走岔。
 */
function netOf(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return n;
}

function recordOf(id: string, timestamp = 1700000000000): HandRecord {
  return record(id, netOf(id), timestamp);
}

const viewOf = view;

beforeEach(() => {
  fake.hands.clear();
  fake.summaries.clear();
  fake.stats = undefined;
  fake.failWrites = false;
  fake.failHandId = null;
  fake.failReads = false;
  fake.slowStats = false;
  fake.putStatsCalls = 0;
  fake.allHandsCalls = 0;
  repo.__resetForTest();
});

describe('saveHand —— 正常路径', () => {
  it('手写进 hands，统计跟着更新', async () => {
    const out = await repo.saveHand(record('a', 12), view('a'));
    expect(out.ok).toBe(true);
    expect(fake.hands.get('a')?.record.id).toBe('a');
    expect(out.stats.hands).toBe(1);
    expect(out.stats.netBB).toBe(12);
    expect(fake.stats?.hands).toBe(1);
  });

  it('分析失败的那一手照样入库，view 为 null', async () => {
    const out = await repo.saveHand(record('a', -3), null);
    expect(out.ok).toBe(true);
    expect(fake.hands.get('a')?.view).toBeNull();
    // record 完整，规则修好后能重跑
    expect(fake.hands.get('a')?.record.id).toBe('a');
    expect(out.stats.hands).toBe(1);
  });

  it('同一手连着存两次只计一次 —— StrictMode 下 effect 会双跑', async () => {
    await repo.saveHand(record('a', 5), view('a'));
    const second = await repo.saveHand(record('a', 5), view('a'));
    expect(second.stats.hands).toBe(1);
    expect(second.stats.netBB).toBe(5);
  });
});

describe('saveHand —— 串行化', () => {
  it('两次写入并发发起时不会互相覆盖统计', async () => {
    // 这是这一层存在的核心理由：「读统计 → 算 → 写统计」是读-改-写，
    // 两次交错的话两边都读到同一份旧统计，后写的把先写的盖掉，
    // 一手牌就从统计里消失了，而且不报错。
    fake.slowStats = true;

    const [r1, r2] = await Promise.all([
      repo.saveHand(record('a', 10), view('a')),
      repo.saveHand(record('b', 4), view('b')),
    ]);

    expect(r1.ok && r2.ok).toBe(true);
    // 两手都必须在最终统计里
    expect(fake.stats?.hands).toBe(2);
    expect(fake.stats?.netBB).toBe(14);
    expect(fake.hands.size).toBe(2);
  });

  it('十次并发写入，一手不落', async () => {
    fake.slowStats = true;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.saveHand(record(`h${i}`, 1), view(`h${i}`))),
    );
    expect(fake.stats?.hands).toBe(10);
    expect(fake.stats?.netBB).toBe(10);
  });

  it('中间一次失败不会让后续写入被跳过', async () => {
    // Promise 链上若留下 rejected 状态，后面挂上去的任务会被整条跳过。
    fake.failHandId = 'b';
    const p1 = repo.saveHand(record('a', 1), view('a'));
    const p2 = repo.saveHand(record('b', 2), view('b'));
    const p3 = repo.saveHand(record('c', 3), view('c'));

    const [o1, o2, o3] = await Promise.all([p1, p2, p3]);
    expect(o1.ok).toBe(true);
    expect(o2.ok).toBe(false);
    expect(o3.ok).toBe(true);
    // 失败的那一手不在库里，也不在统计里
    expect(fake.hands.has('b')).toBe(false);
    expect(fake.stats?.hands).toBe(2);
    expect(fake.stats?.netBB).toBe(4);
  });
});

describe('saveHand —— 失败降级', () => {
  it('写不进去时 ok 为 false，且返回的统计不含这一手', async () => {
    fake.failWrites = true;
    const out = await repo.saveHand(record('a', 99), view('a'));
    expect(out.ok).toBe(false);
    expect(out.stats.hands).toBe(0);
    expect(repo.storageStatus()).toBe('unavailable');
  });

  it('失败后内存里的统计不能比库里多 —— 用户看到的是内存那份', async () => {
    await repo.saveHand(record('a', 10), view('a'));
    fake.failWrites = true;
    await repo.saveHand(record('b', 10), view('b'));
    fake.failWrites = false;
    // 再存一手成功的，总数应该是 2 而不是 3
    const out = await repo.saveHand(record('c', 10), view('c'));
    expect(out.stats.hands).toBe(2);
    expect(out.stats.netBB).toBe(20);
  });

  it('落库失败不抛错 —— 牌局不能因为存不进去就掀桌子', async () => {
    fake.failWrites = true;
    await expect(repo.saveHand(record('a', 1), view('a'))).resolves.toMatchObject({ ok: false });
  });
});

describe('loadStats', () => {
  it('库里没有统计时给一份空的', async () => {
    const s = await repo.loadStats();
    expect(s.hands).toBe(0);
    expect(repo.storageStatus()).toBe('ready');
  });

  it('读不出来时退化为空统计并标记 unavailable，不抛错', async () => {
    fake.failReads = true;
    const s = await repo.loadStats();
    expect(s.hands).toBe(0);
    expect(repo.storageStatus()).toBe('unavailable');
  });

  it('第二次调用走缓存，不再打数据库', async () => {
    await repo.loadStats();
    fake.failReads = true; // 若还去读库就会失败并把状态改成 unavailable
    const s = await repo.loadStats();
    expect(s.hands).toBe(0);
    expect(repo.storageStatus()).toBe('ready');
  });
});

describe('setDisputed', () => {
  it('把标记写回那一手，其余字段不动', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    expect(await repo.setDisputed('a', true)).toBe(true);
    const h = fake.hands.get('a')!;
    expect(h.disputed).toBe(true);
    expect(h.record.id).toBe('a');
    expect(h.view).not.toBeNull();
  });

  it('可以取消', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    await repo.setDisputed('a', true);
    await repo.setDisputed('a', false);
    expect(fake.hands.get('a')!.disputed).toBe(false);
  });

  it('不存在的 id 返回 false，不抛错', async () => {
    expect(await repo.setDisputed('nope', true)).toBe(false);
  });

  it('标记不会被统计重算冲掉 —— 它不在 view 里', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    await repo.setDisputed('a', true);
    // 再存别的手，统计更新，disputed 应原封不动
    await repo.saveHand(record('b', 1), view('b'));
    expect(fake.hands.get('a')!.disputed).toBe(true);
  });
});

describe('listHands', () => {
  it('默认按 worstEvLoss 倒序（规格 §10.4）', async () => {
    for (const [id, worst] of [['a', 1], ['b', 5], ['c', 3]] as [string, number][]) {
      await repo.saveHand(record(id, 0), { ...view(id), worstEvLoss: worst });
    }
    const page = await repo.listHands({ limit: 10 });
    expect(page.rows.map(r => r.id)).toEqual(['b', 'c', 'a']);
    expect(page.nextOffset).toBeNull();
  });

  it('读失败时返回空页并标记 unavailable，不抛错', async () => {
    fake.failReads = true;
    expect(await repo.listHands()).toEqual({ rows: [], nextOffset: null });
    expect(repo.storageStatus()).toBe('unavailable');
  });

  it('筛得很窄时会继续往下扫，而不是"这一批没有就算没有"', async () => {
    // 100 手，只有最后 2 手是 SB。SCAN_BATCH 是 100，若实现是"取一页再过滤"，
    // 第一批就返回 0 条并被当成"没有更多了"。
    for (let i = 0; i < 98; i++) {
      await repo.saveHand(record(`h${i}`, 0), { ...view(`h${i}`), worstEvLoss: 100 - i });
    }
    for (const id of ['sb1', 'sb2']) {
      const rec = record(id, 0);
      rec.seats[0].position = 'SB';
      await repo.saveHand(rec, { ...view(id), worstEvLoss: 0 });
    }
    const page = await repo.listHands({ limit: 10, filter: { position: 'SB' } });
    expect(page.rows.map(r => r.id).sort()).toEqual(['sb1', 'sb2']);
  });

  it('续页从 nextOffset 接着扫，不重复也不漏', async () => {
    for (let i = 0; i < 7; i++) {
      await repo.saveHand(record(`h${i}`, 0), { ...view(`h${i}`), worstEvLoss: 10 - i });
    }
    const p1 = await repo.listHands({ limit: 3 });
    expect(p1.rows.map(r => r.id)).toEqual(['h0', 'h1', 'h2']);
    expect(p1.nextOffset).toBe(3);

    const p2 = await repo.listHands({ limit: 3, offset: p1.nextOffset! });
    expect(p2.rows.map(r => r.id)).toEqual(['h3', 'h4', 'h5']);

    const p3 = await repo.listHands({ limit: 3, offset: p2.nextOffset! });
    expect(p3.rows.map(r => r.id)).toEqual(['h6']);
    expect(p3.nextOffset).toBeNull();
  });
});

describe('importHands / recomputeStats', () => {
  it('导入的手写进库，统计整表重算', async () => {
    await repo.saveHand(record('old', 5), view('old'));
    const out = await repo.importHands([
      { ...fake.hands.get('old')!, id: 'i1', timestamp: 1, record: record('i1', 10) },
      { ...fake.hands.get('old')!, id: 'i2', timestamp: 2, record: record('i2', -3) },
    ]);
    expect(out.ok).toBe(true);
    expect(out.imported).toBe(2);
    expect(fake.hands.size).toBe(3);
    // 5 + 10 - 3 = 12。增量是算不出这个数的——导入是乱序插入，
    // applyHand 的 lastHandId 只挡连续重复
    expect(out.stats.hands).toBe(3);
    expect(out.stats.netBB).toBe(12);
  });

  it('重复导入同一份文件是幂等的 —— 用户点两次不该变成双倍手数', async () => {
    const batch = [
      { ...(await (async () => { await repo.saveHand(record('seed', 1), view('seed')); return fake.hands.get('seed')!; })()), id: 'x', record: record('x', 7) },
    ];
    await repo.importHands(batch);
    const second = await repo.importHands(batch);
    expect(second.stats.hands).toBe(2);
    expect(second.stats.netBB).toBe(8);
  });

  it('重算按 timestamp 排序 —— 滚动窗口是有顺序的', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    const base = fake.hands.get('a')!;
    await repo.importHands([
      { ...base, id: 'late', timestamp: 300, record: record('late', 30) },
      { ...base, id: 'early', timestamp: 100, record: record('early', 10) },
    ]);
    const s = await repo.loadStats();
    // a 的 timestamp 是 1700000000000（最大），所以顺序是 early(100) → late(300) → a
    expect(s.recentNet).toEqual([10, 30, 1]);
  });

  it('写到一半失败：已写进去的不回滚，统计与实际写入对得上', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    const base = fake.hands.get('a')!;
    fake.failHandId = 'bad';
    const out = await repo.importHands([
      { ...base, id: 'good', timestamp: 10, record: record('good', 4) },
      { ...base, id: 'bad', timestamp: 20, record: record('bad', 99) },
      { ...base, id: 'never', timestamp: 30, record: record('never', 99) },
    ]);
    expect(out.ok).toBe(false);
    expect(out.imported).toBe(1);
    expect(fake.hands.has('good')).toBe(true);
    expect(fake.hands.has('bad')).toBe(false);
    // 统计只含真正写进去的：1（a）+ 4（good）
    expect(out.stats.hands).toBe(2);
    expect(out.stats.netBB).toBe(5);
  });

  it('recomputeStats 单独调用也能把统计修回来', async () => {
    await repo.saveHand(record('a', 10), view('a'));
    // 直接改库，绕过 repo —— 模拟"统计与手牌对不上"的状态
    fake.stats = { ...fake.stats!, hands: 999, netBB: 999 };
    const s = await repo.recomputeStats();
    expect(s.hands).toBe(1);
    expect(s.netBB).toBe(10);
  });
});

describe('allHands', () => {
  it('取出全部，失败时返回空数组不抛错', async () => {
    await repo.saveHand(record('a', 1), view('a'));
    expect((await repo.allHands()).map(h => h.id)).toEqual(['a']);
    fake.failReads = true;
    expect(await repo.allHands()).toEqual([]);
  });
});

describe('resetAll', () => {
  it('清空库与内存缓存', async () => {
    await repo.saveHand(record('a', 10), view('a'));
    expect(await repo.resetAll()).toBe(true);
    expect(fake.hands.size).toBe(0);
    const s = await repo.loadStats();
    expect(s.hands).toBe(0);
  });
});

describe('saveHand 同时写摘要', () => {
  it('一手写进去之后，摘要 store 里有对应的一条', async () => {
    await repo.saveHand(recordOf('h1'), viewOf('h1'));
    expect(fake.summaries.size).toBe(1);
    expect(fake.summaries.get('h1')!.netBB).toBe(heroNetOf(fake.hands.get('h1')!));
  });
});

describe('loadReport', () => {
  it('窗口取最近 N 手，且按 (timestamp, id) 升序喂给 aggregate', async () => {
    // 故意乱序写入，且制造两条同毫秒的
    for (const [id, ts] of [
      ['c', 3],
      ['a', 1],
      ['b2', 2],
      ['b1', 2],
    ] as const) {
      await repo.saveHand(recordOf(id, ts), viewOf(id));
    }
    const out = await repo.loadReport(200);
    expect(out.stats.hands).toBe(4);
    // 升序且同毫秒按 id：a(1), b1(2), b2(2), c(3)
    expect(out.stats.netSeries).toEqual(['a', 'b1', 'b2', 'c'].map(netOf));
  });

  it('库里手数少于窗口时 partial 为 true，仍然出数', async () => {
    await repo.saveHand(recordOf('h1'), viewOf('h1'));
    const out = await repo.loadReport(1000);
    expect(out.partial).toBe(true);
    expect(out.stats.hands).toBe(1);
  });

  it('窗口 all 时 partial 恒为 false', async () => {
    await repo.saveHand(recordOf('h1'), viewOf('h1'));
    expect((await repo.loadReport('all')).partial).toBe(false);
  });

  it('存储不可用时返回空统计而不是抛错', async () => {
    fake.failReads = true;
    const out = await repo.loadReport(200);
    expect(out.stats.hands).toBe(0);
    expect(repo.storageStatus()).toBe('unavailable');
  });
});

describe('ensureSummaries', () => {
  it('计数相等时不扫表', async () => {
    await repo.saveHand(recordOf('h1'), viewOf('h1'));
    fake.allHandsCalls = 0;
    expect(await repo.ensureSummaries()).toBe(true);
    expect(fake.allHandsCalls).toBe(0);
  });

  it('计数不等时从 hands 重建（③-C 存下的手牌没有摘要）', async () => {
    // 直接往假 db 里塞手牌，绕过 saveHand——这正是升级前存下的那些手的状态
    fake.hands.set('old', storedHandOf(recordOf('old'), viewOf('old')));
    expect(fake.summaries.size).toBe(0);
    expect(await repo.ensureSummaries()).toBe(true);
    expect(fake.summaries.size).toBe(1);
  });

  it('回填失败时返回 false，不抛错', async () => {
    fake.hands.set('old', storedHandOf(recordOf('old'), viewOf('old')));
    fake.failWrites = true;
    expect(await repo.ensureSummaries()).toBe(false);
  });
});

describe('importHands 维护摘要', () => {
  it('导入的每一手都有摘要', async () => {
    const out = await repo.importHands([
      storedHandOf(recordOf('i1'), viewOf('i1')),
      storedHandOf(recordOf('i2'), viewOf('i2')),
    ]);
    expect(out.imported).toBe(2);
    expect(fake.summaries.size).toBe(2);
  });
});
