# ③-D-1 漏洞报表 实施计划

> **给执行的代理：** 必须配合 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**目标：** 做出规格 §10.5 的漏洞报表页——给定手数窗口，回答「这段时间赢没赢 / 主要漏在哪类失误 / 哪条街哪个位置在漏」。

**架构：** 新增每手一条的 `summaries` object store（DB_VERSION 2），任意窗口的聚合由扫这个轻量 store 现算，`hands` store（4.5 KB/手）不参与统计路径。聚合是纯函数，与既有的增量 `applyHand` 由一条属性测试锁住口径一致。UI 沿用 ③-B 的分层：纯变形在 `reportModel.ts` 且测得密，组件不测。

**技术栈：** TypeScript（strict）· React 19 · Vitest · fast-check · IndexedDB（无第三方封装）· 内联 SVG（不引图表库）

**规格：** `docs/superpowers/specs/2026-08-23-poker-trainer-03d1-report-design.md`（本计划的每条论证都以它为准，执行时两份一起读）
**上游规格：** `docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md` §9 / §10.5

**基线：** `03d1-report` 分支 @ `929e64e`（自 master `ae8f505`），**53 文件 / 755 通过 / 3 跳过**，typecheck + build 绿。

**测试数逐任务（预计）：** 755 → T1 **≈773** → T2 ≈779 → T3 ≈791 → T4 **≈811** → T5/T6 811（UI 不测）→ T7 811。终态约 **56 文件 / 811 通过 / 3 跳过**。
这些是预计值不是验收标准。**跑出来对不上就如实报实际数字**，不许加水测试凑上去，也不许删测试凑下来。

---

## Global Constraints

抄自规格与项目既有硬约束，每个任务都隐含包含这一节：

- **内部量纲一律 BB。** 实额换算只允许存在于 `src/ui/format.ts`。报表页**不做实额换算**（BB/100 与 EV 损失是 BB 量纲的通用口径）。
- **金额比较一律走 `src/core/chips.ts`** 的 `isZeroChips` / `chipsGreater` / `round2`，禁裸 `===` 与裸 `>`。
- **`indexedDB` 只允许出现在 `src/storage/db.ts`。** 由 `src/session/architecture.test.ts` 的守卫盯着，本期不放宽。
- **`src/session/` 不得 import `src/storage/`**（同一守卫）。
- **`src/ui/` 不得从 `core/gameEngine` / `ai/decide` / `ai/selfPlayAi` 取值**（`import type` 不限）。
- **不碰 `src/core/` `src/ai/` `src/session/` `src/review/`。** 本期是存储层加法 + UI 加法。
- **不引新依赖。** 不引 `fake-indexeddb`、不引图表库、不引 testing-library。
- **组件不写自动化测试**（沿用 ③-A/③-B 取舍），可测逻辑必须下沉到纯函数。
- **界面文案全中文**，与历史页、复盘卡片保持同一套说法（「未记录」「分析失败」「有异议」）。
- 提交信息用中文，尾部带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

## 任务分解

| # | 内容 | 产出 |
|---|---|---|
| 1 | 摘要类型与窗口聚合（纯函数）+ 一致性闸 | `src/storage/summary.ts` + 测试；`stats.ts` 导出三个骨架构造器 |
| 2 | `summaries` store 与 DB_VERSION 2 | `src/storage/schema.ts`、`src/storage/db.ts` + schema 测试 |
| 3 | 仓库层：写入维护、窗口查询、回填 | `src/storage/repo.ts` + 测试 |
| 4 | 报表的纯数据变形 | `src/ui/reportModel.ts` + 测试 |
| 5 | 报表页与导航第三项 | `src/ui/pages/ReportPage.tsx`、`Nav.tsx`、`app.css` |
| 6 | 接线与浏览器验收 | `src/ui/App.tsx` + 验收清单 10 条 |
| 7 | README 收尾 | `README.md` |

T1–T4 是纯逻辑，全部有测试。T2 的 IndexedDB 部分刻意做薄，由 T6 的浏览器验收覆盖。

---

### Task 1: 摘要类型与窗口聚合

**Files:**
- Create: `src/storage/summary.ts`
- Create: `src/storage/summary.test.ts`
- Modify: `src/storage/stats.ts`（把三个骨架构造器从私有改为导出）

**Interfaces:**
- Consumes: `StoredHand`（`./schema`）、`heroNetOf` / `TagStat` / `PositionStat`（`./stats`）、`PREFLOP_TAGS` / `POSTFLOP_TAGS` / `MistakeTag`（`../review/taxonomy`）、`round2`（`../core/chips`）
- Produces:
  ```ts
  export const SUMMARY_SCHEMA_VERSION = 1;
  export interface HandSummary {
    id: string;
    timestamp: number;
    netBB: number;
    position: Position;
    byStreet: Record<Street, number>;
    byTag: Partial<Record<MistakeTag, TagStat>>;
  }
  export function summaryOf(hand: StoredHand): HandSummary;
  export interface WindowStats {
    hands: number;
    netBB: number;
    byTag: Record<MistakeTag, TagStat>;
    byStreet: Record<Street, number>;
    byPosition: Record<Position, PositionStat>;
    netSeries: number[];
  }
  export function aggregate(rows: readonly HandSummary[]): WindowStats;
  ```
  以及 `stats.ts` 新导出的 `emptyTagStats()` / `emptyStreetStats()` / `emptyPositionStats()`

- [ ] **Step 1: 先把骨架构造器从 `stats.ts` 导出**

`src/storage/stats.ts` 里 `emptyTagStats` / `emptyStreetStats` / `emptyPositionStats` 三个函数现在是文件私有的。加 `export`，不改实现、不改调用点。

理由要写进注释：这三个函数的存在意义是「taxonomy 或 Position 加成员时编译失败，而不是报表上少一行」。`aggregate` 必须用同一份骨架，各写一份就等于把这道编译期保护废掉一半。

```ts
/** 从 taxonomy 的两个常量数组建骨架。summary.ts 的 aggregate 也用它——
    两处各写一份的话，taxonomy 加分类时只有一处会跟上 */
export function emptyTagStats(): Record<MistakeTag, TagStat> {
```

- [ ] **Step 2: 写失败的测试（`src/storage/summary.test.ts`）**

先只写 `summaryOf` 那组。测试用的 `StoredHand` 构造器抄 `src/storage/stats.test.ts` 里现成的做法（读它，别自己发明一套）。

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { summaryOf, aggregate } from './summary';
import { emptyStats, applyHand, heroNetOf } from './stats';

describe('summaryOf', () => {
  it('把一手的分街 evLoss 与分类累计抽出来', () => {
    const hand = handWith({
      position: 'BTN',
      netBB: 12.5,
      decisions: [
        { street: 'turn', evLoss: 2.3, tag: 'loose-call' },
        { street: 'river', evLoss: 0, tag: null },
      ],
    });
    const s = summaryOf(hand);
    expect(s.id).toBe(hand.id);
    expect(s.timestamp).toBe(hand.timestamp);
    expect(s.netBB).toBe(12.5);
    expect(s.position).toBe('BTN');
    expect(s.byStreet).toEqual({ preflop: 0, flop: 0, turn: 2.3, river: 0 });
    expect(s.byTag).toEqual({ 'loose-call': { count: 1, evLoss: 2.3 } });
  });

  it('同一分类在一手里出现两次会合并', () => {
    const s = summaryOf(handWith({
      decisions: [
        { street: 'flop', evLoss: 1.5, tag: 'loose-call' },
        { street: 'turn', evLoss: 0.5, tag: 'loose-call' },
      ],
    }));
    expect(s.byTag['loose-call']).toEqual({ count: 2, evLoss: 2 });
    expect(s.byStreet.flop).toBe(1.5);
    expect(s.byStreet.turn).toBe(0.5);
  });

  it('view 为 null（分析失败）仍产出摘要：手数与盈亏要进分母', () => {
    const s = summaryOf(handWith({ view: null, netBB: -8 }));
    expect(s.netBB).toBe(-8);
    expect(s.byTag).toEqual({});
    expect(s.byStreet).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 });
  });

  it('byTag 只含出现过的分类，不填满 15 项', () => {
    const s = summaryOf(handWith({ decisions: [{ street: 'preflop', evLoss: 1, tag: 'loose-open' }] }));
    expect(Object.keys(s.byTag)).toEqual(['loose-open']);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

`npx vitest run src/storage/summary.test.ts`
预期：FAIL，`Cannot find module './summary'`

- [ ] **Step 4: 实现 `summaryOf`**

逻辑就是 `applyHand` 里那段的单手版。`evLoss` 累加一律 `round2`（浮点，与 `applyHand` 同款处理）。

```ts
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
    id: hand.id,
    timestamp: hand.timestamp,
    netBB: heroNetOf(hand),
    position: hand.heroPosition,
    byStreet,
    byTag,
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

`npx vitest run src/storage/summary.test.ts` → 4 条 PASS

- [ ] **Step 6: 写 `aggregate` 的失败测试**

追加到同一文件：

```ts
describe('aggregate', () => {
  it('空窗口给出零值而不是 NaN', () => {
    const w = aggregate([]);
    expect(w.hands).toBe(0);
    expect(w.netBB).toBe(0);
    expect(w.netSeries).toEqual([]);
    expect(w.byStreet).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 });
    expect(w.byPosition.BTN).toEqual({ hands: 0, netBB: 0 });
  });

  it('byTag 骨架是满的，没出现过的分类为零而不是 undefined', () => {
    const w = aggregate([summaryOf(handWith({ decisions: [{ street: 'flop', evLoss: 1, tag: 'loose-call' }] }))]);
    expect(w.byTag['loose-call']).toEqual({ count: 1, evLoss: 1 });
    expect(w.byTag['loose-open']).toEqual({ count: 0, evLoss: 0 });
  });

  it('多手累加：手数、净盈亏、分街、分位置', () => {
    const rows = [
      summaryOf(handWith({ position: 'BTN', netBB: 10, decisions: [{ street: 'turn', evLoss: 2, tag: 'loose-call' }] })),
      summaryOf(handWith({ position: 'BTN', netBB: -4, decisions: [{ street: 'turn', evLoss: 1, tag: 'loose-call' }] })),
      summaryOf(handWith({ position: 'SB', netBB: -6, decisions: [] })),
    ];
    const w = aggregate(rows);
    expect(w.hands).toBe(3);
    expect(w.netBB).toBe(0);
    expect(w.byStreet.turn).toBe(3);
    expect(w.byTag['loose-call']).toEqual({ count: 2, evLoss: 3 });
    expect(w.byPosition.BTN).toEqual({ hands: 2, netBB: 6 });
    expect(w.byPosition.SB).toEqual({ hands: 1, netBB: -6 });
  });

  it('netSeries 保持入参顺序，不排序不截断', () => {
    const rows = [10, -4, 7].map(n => summaryOf(handWith({ netBB: n })));
    expect(aggregate(rows).netSeries).toEqual([10, -4, 7]);
  });

  it('不修改入参', () => {
    const row = summaryOf(handWith({ decisions: [{ street: 'flop', evLoss: 1, tag: 'loose-call' }] }));
    const snapshot = JSON.parse(JSON.stringify(row));
    aggregate([row]);
    expect(row).toEqual(snapshot);
  });
});
```

- [ ] **Step 7: 跑测试确认失败，再实现 `aggregate`**

`aggregate` 假定入参已按时间升序（排序在 repo 层做，见 T3）。这条假定写在函数注释里，不在函数里排序——排序需要 `id` 作次级键，而摘要层不该关心「同毫秒两手谁先」这种存储层的事。

```ts
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
```

- [ ] **Step 8: 写一致性闸（本任务最重要的一条）**

规格 §3.5：增量的 `applyHand` 与扫窗口的 `aggregate` 是两条算同一批数的路径，README 已经记过一次「两个净盈亏对不上」的教训。用属性测试锁死。

```ts
describe('一致性闸：增量与窗口聚合必须给出同一批数', () => {
  it('reduce(applyHand) ≡ aggregate(map(summaryOf))', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            position: fc.constantFrom('UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB' as const),
            netBB: fc.integer({ min: -200, max: 200 }).map(n => n / 2),
            // 约一成的手分析失败，走 view === null 那条路径
            failed: fc.boolean().map(b => b && Math.random() < 0.3),
            decisions: fc.array(
              fc.record({
                street: fc.constantFrom('preflop', 'flop', 'turn', 'river' as const),
                evLoss: fc.integer({ min: 0, max: 100 }).map(n => n / 10),
                tag: fc.constantFrom(...PREFLOP_TAGS, ...POSTFLOP_TAGS, null),
              }),
              { maxLength: 6 },
            ),
          }),
          { maxLength: 40 },
        ),
        specs => {
          const hands = specs.map((s, i) => handWith({ ...s, id: `h${i}`, timestamp: 1000 + i }));

          let inc = emptyStats();
          for (const h of hands) inc = applyHand(inc, h);
          const win = aggregate(hands.map(summaryOf));

          expect(win.hands).toBe(inc.hands);
          expect(win.netBB).toBe(inc.netBB);
          expect(win.byTag).toEqual(inc.byTag);
          expect(win.byStreet).toEqual(inc.byStreet);
          expect(win.byPosition).toEqual(inc.byPosition);
        },
      ),
      { numRuns: 200 },
    );
  });
});
```

**注意两处，别踩：**
- `applyHand` 的 `lastHandId` 会跳过「与上一手 id 相同」的手。生成的 id 必须互不相同（上面用 `h${i}`），否则这条测试会因为去重而假绿。
- `netSeries` 不在比对范围内：`Stats.recentNet` 上限 200，`netSeries` 没有上限，两者本来就不相等。这一点写进测试的注释里，免得后人以为漏了。

- [ ] **Step 9: 跑全套并提交**

```bash
npx vitest run src/storage/
npm run typecheck
git add src/storage/summary.ts src/storage/summary.test.ts src/storage/stats.ts
git commit -m "feat(storage): 每手摘要与窗口聚合，附一条口径一致性闸

正文写清三件事：为什么摘要与 hands 分开存（4.5 KB/手 vs ~120 字节/手）、
byTag 为什么用 Partial 而不填满 15 项、那条属性测试防的是什么。"
```

---

### Task 2: `summaries` store 与 DB_VERSION 2

**Files:**
- Modify: `src/storage/schema.ts`
- Modify: `src/storage/schema.test.ts`
- Modify: `src/storage/db.ts`

**Interfaces:**
- Consumes: `HandSummary`（T1）
- Produces:
  ```ts
  // schema.ts
  export const SUMMARIES_STORE = 'summaries';
  export const DB_VERSION = 2;   // 1 → 2
  // db.ts
  export function putSummary(s: HandSummary): Promise<void>;
  export function allSummaries(): Promise<HandSummary[]>;
  export function countSummaries(): Promise<number>;
  export function lastSummaries(n: number): Promise<HandSummary[]>;
  ```

- [ ] **Step 1: 写失败的 schema 测试**

`src/storage/schema.test.ts` 已有一组「store 名 / keyPath / 索引集」的断言，照它的写法追加：

```ts
it('summaries store：主键 id，一个 timestamp 索引', () => {
  const s = STORES.find(x => x.name === SUMMARIES_STORE);
  expect(s).toBeDefined();
  expect(s!.keyPath).toBe('id');
  expect(s!.indexes.map(i => i.name)).toEqual(['timestamp']);
});

it('DB_VERSION 是 2：加了 summaries store', () => {
  expect(DB_VERSION).toBe(2);
});

it('三个 store 都在 STORES 里——clearAll 与 onupgradeneeded 都按它走', () => {
  expect(STORES.map(s => s.name).sort()).toEqual(['hands', 'stats', 'summaries']);
});
```

- [ ] **Step 2: 跑测试确认失败**

`npx vitest run src/storage/schema.test.ts` → FAIL（`SUMMARIES_STORE` 未导出）

- [ ] **Step 3: 改 `schema.ts`**

```ts
export const DB_VERSION = 2;
export const SUMMARIES_STORE = 'summaries';
```
`STORES` 追加：
```ts
{
  name: SUMMARIES_STORE,
  keyPath: 'id',
  // 只有一个索引：报表按时间取最近 N 手，其余维度（位置、分类、街）都是
  // 取回之后在内存里聚合的——一千条摘要在内存里过一遍是微秒级，
  // 为它们各建一个索引只会让每次写入更慢。
  indexes: [{ name: 'timestamp', keyPath: 'timestamp' }],
},
```

- [ ] **Step 4: 跑测试确认通过**

`npx vitest run src/storage/schema.test.ts` → PASS

- [ ] **Step 5: 给 `db.ts` 加四个薄函数**

与既有的 `putHand` / `allHands` / `countHands` 同构，只包 Promise，不做判断。`lastSummaries` 抄 `pageByIndex` 的游标写法，但简化——不需要 offset：

```ts
export async function putSummary(s: HandSummary): Promise<void> {
  const db = await openDb();
  await promisify(tx(db, SUMMARIES_STORE, 'readwrite').put(s));
}

export async function allSummaries(): Promise<HandSummary[]> {
  const db = await openDb();
  return promisify<HandSummary[]>(tx(db, SUMMARIES_STORE, 'readonly').getAll());
}

export async function countSummaries(): Promise<number> {
  const db = await openDb();
  return promisify<number>(tx(db, SUMMARIES_STORE, 'readonly').count());
}

/**
 * 按 timestamp 倒序取最近 n 条。
 *
 * 用游标而不是 getAll 之后再截：一万条摘要全读进内存只为拿最近 200 条，
 * 与历史页当初不用 getAll 是同一个理由（见 pageByIndex 的注释）。
 * 返回的是**倒序**，调用方要升序请自己反转——这里不替它决定。
 */
export async function lastSummaries(n: number): Promise<HandSummary[]> {
  const db = await openDb();
  const index = tx(db, SUMMARIES_STORE, 'readonly').index('timestamp');
  return new Promise<HandSummary[]>((resolve, reject) => {
    const out: HandSummary[] = [];
    const req = index.openCursor(null, 'prev');
    req.onerror = () => reject(req.error ?? new Error('游标失败'));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor === null || out.length >= n) {
        resolve(out);
        return;
      }
      out.push(cursor.value as HandSummary);
      cursor.continue();
    };
  });
}
```

- [ ] **Step 6: 改 `clearAll` 清三个 store**

`clearAll` 的 store 列表是手写的（不是从 `STORES` 推的）。漏掉这一处的后果很具体：「重置数据」之后摘要还在，报表上的手数不归零。

```ts
/** 清空三个 store。「重置数据」用，不删库——删库要等所有连接关闭，容易卡住 */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  const t = db.transaction([HANDS_STORE, STATS_STORE, SUMMARIES_STORE], 'readwrite');
  await Promise.all([
    promisify(t.objectStore(HANDS_STORE).clear()),
    promisify(t.objectStore(STATS_STORE).clear()),
    promisify(t.objectStore(SUMMARIES_STORE).clear()),
  ]);
}
```

- [ ] **Step 7: 确认 `onupgradeneeded` 一行都不用改**

读一遍 `openDb` 里那段：它已经是「按 `STORES` 建表、已存在就补索引」的循环。新 store 会被自动建出来。

**同时确认它没有偷偷做值迁移**——规格 §3.4 明确要求升级事务里不扫全表，回填在 T3 由报表页触发。若发现有人在这里加了遍历，停下来报告。

- [ ] **Step 8: 跑全套并提交**

```bash
npx vitest run src/storage/
npm run typecheck && npm run build
git add src/storage/schema.ts src/storage/schema.test.ts src/storage/db.ts
git commit -m "feat(storage): summaries store 与 DB_VERSION 2

正文写清：onupgradeneeded 为什么不做值迁移、clearAll 的 store 列表是手写的
所以必须一起改。"
```

---

### Task 3: 仓库层——写入维护、窗口查询、回填

**Files:**
- Modify: `src/storage/repo.ts`
- Modify: `src/storage/repo.test.ts`

**Interfaces:**
- Consumes: `summaryOf` / `aggregate` / `WindowStats`（T1）、`db.putSummary` / `allSummaries` / `countSummaries` / `lastSummaries`（T2）
- Produces:
  ```ts
  export type ReportWindow = 200 | 500 | 1000 | 'all';
  export interface ReportData { stats: WindowStats; partial: boolean }
  export function loadReport(w: ReportWindow): Promise<ReportData>;
  export function ensureSummaries(): Promise<boolean>;
  ```

- [ ] **Step 1: 扩 `repo.test.ts` 的假 db**

`repo.test.ts` 把 `db.ts` 换成了内存实现（`FakeDb`）。加三样东西：

- `summaries: Map<string, HandSummary>`
- 四个新函数的假实现（`putSummary` / `allSummaries` / `countSummaries` / `lastSummaries`）。`lastSummaries(n)` 要**按 timestamp 倒序取 n 条**，不能图省事返回插入顺序——「取回后要重新排序」正是 `loadReport` 要测的行为，假实现替它排好就把测试变成空转了
- `allHandsCalls: number` 计数器，`allHands` 每次被调 +1。`ensureSummaries` 那条「计数相等时不扫表」的测试靠它断言

`failWrites` / `failReads` 两个开关要对新函数同样生效——降级路径正是这里要测的东西。`__resetForTest` 之外，`beforeEach` 里把新加的 Map 与计数器一并清零。

- [ ] **Step 2: 写失败的测试**

```ts
describe('saveHand 同时写摘要', () => {
  it('一手写进去之后，摘要 store 里有对应的一条', async () => {
    await saveHand(recordOf('h1'), viewOf('h1'));
    expect(fake.summaries.size).toBe(1);
    expect(fake.summaries.get('h1')!.netBB).toBe(heroNetOf(fake.hands.get('h1')!));
  });
});

describe('loadReport', () => {
  it('窗口取最近 N 手，且按 (timestamp, id) 升序喂给 aggregate', async () => {
    // 故意乱序写入，且制造两条同毫秒的
    for (const [id, ts] of [['c', 3], ['a', 1], ['b2', 2], ['b1', 2]] as const) {
      await saveHand(recordOf(id, ts), viewOf(id));
    }
    const out = await loadReport(200);
    expect(out.stats.hands).toBe(4);
    // 升序且同毫秒按 id：a(1), b1(2), b2(2), c(3)
    // netOf 是本文件的局部辅助：从 recordOf 造出的那手里取 hero 的 netBB
    expect(out.stats.netSeries).toEqual(['a', 'b1', 'b2', 'c'].map(netOf));
  });

  it('库里手数少于窗口时 partial 为 true，仍然出数', async () => {
    await saveHand(recordOf('h1'), viewOf('h1'));
    const out = await loadReport(1000);
    expect(out.partial).toBe(true);
    expect(out.stats.hands).toBe(1);
  });

  it('窗口 all 时 partial 恒为 false', async () => {
    await saveHand(recordOf('h1'), viewOf('h1'));
    expect((await loadReport('all')).partial).toBe(false);
  });

  it('存储不可用时返回空统计而不是抛错', async () => {
    fake.failReads = true;
    const out = await loadReport(200);
    expect(out.stats.hands).toBe(0);
    expect(storageStatus()).toBe('unavailable');
  });
});

describe('ensureSummaries', () => {
  it('计数相等时不扫表', async () => {
    await saveHand(recordOf('h1'), viewOf('h1'));
    fake.allHandsCalls = 0;
    expect(await ensureSummaries()).toBe(true);
    expect(fake.allHandsCalls).toBe(0);
  });

  it('计数不等时从 hands 重建（③-C 存下的手牌没有摘要）', async () => {
    // 直接往假 db 里塞手牌，绕过 saveHand——这正是升级前存下的那些手的状态
    fake.hands.set('old', storedHandOf(recordOf('old'), viewOf('old')));
    expect(fake.summaries.size).toBe(0);
    expect(await ensureSummaries()).toBe(true);
    expect(fake.summaries.size).toBe(1);
  });

  it('回填失败时返回 false，不抛错', async () => {
    fake.hands.set('old', storedHandOf(recordOf('old'), viewOf('old')));
    fake.failWrites = true;
    expect(await ensureSummaries()).toBe(false);
  });
});

describe('importHands 维护摘要', () => {
  it('导入的每一手都有摘要', async () => {
    const out = await importHands([
      storedHandOf(recordOf('i1'), viewOf('i1')),
      storedHandOf(recordOf('i2'), viewOf('i2')),
    ]);
    expect(out.imported).toBe(2);
    expect(fake.summaries.size).toBe(2);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

`npx vitest run src/storage/repo.test.ts` → FAIL（`loadReport` 未导出）

- [ ] **Step 4: 实现三处写入维护**

- `saveHand`：`putHand` 之后加 `putSummary(summaryOf(hand))`。**放在 `putHand` 之后、`putStats` 之前**，三次写不是原子的（现有代码本来就不是），失败时统一走既有的 catch 降级。
- `importHands`：循环里每条 `putHand` 之后 `putSummary`。
- `resetAll`：不用改，T2 的 `clearAll` 已经清三个 store。

- [ ] **Step 5: 实现 `loadReport` 与 `ensureSummaries`**

```ts
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
 * 只比计数不逐条比 id：真正的威胁是「写了手牌但没写摘要」，那必然让计数
 * 不等。逐条比对要把两个 store 全读出来，代价与直接重建相同。
 */
export function ensureSummaries(): Promise<boolean> {
  return serialize(async () => {
    if (summariesChecked) return true;
    try {
      const [hands, summaries] = await Promise.all([db.countHands(), db.countSummaries()]);
      if (hands !== summaries) {
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
```

`__resetForTest` 里把 `summariesChecked` 一并复位。

- [ ] **Step 6: 跑测试确认通过，跑全套，提交**

```bash
npx vitest run src/storage/
npm run typecheck
git add src/storage/repo.ts src/storage/repo.test.ts
git commit -m "feat(storage): 报表的窗口查询与摘要回填

正文写清：排序键为什么是 (timestamp, id)、回填为什么只比计数不逐条比 id、
为什么由报表页触发而不是启动路径。"
```

---

### Task 4: 报表的纯数据变形

**Files:**
- Create: `src/ui/reportModel.ts`
- Create: `src/ui/reportModel.test.ts`

**Interfaces:**
- Consumes: `WindowStats`（T1）、`bb100` / `trend` / `leaks`（`../storage/stats`）、`TAG_TEXT`（`./reviewModel`）
- Produces:
  ```ts
  export const MAX_POINTS = 240;
  export interface Kpi { key: 'hands' | 'bb100' | 'leak'; label: string; value: string; unit: string | null; tone: 'neutral' | 'positive' | 'negative' }
  export function kpisOf(s: WindowStats): Kpi[];
  export interface CurvePoint { i: number; cum: number }
  export function curveOf(netSeries: readonly number[]): CurvePoint[];
  export interface TrendView { current: number | null; previous: number | null; text: string }
  export function trendOf(netSeries: readonly number[]): TrendView;
  export interface LeakBar { tag: MistakeTag; label: string; count: number; evLoss: number; pct: number }
  export function leakBarsOf(s: WindowStats): LeakBar[];
  export interface StreetBar { street: Street; label: string; evLoss: number; pct: number }
  export function streetBarsOf(s: WindowStats): StreetBar[];
  export interface PositionRow { position: Position; hands: number; bb100: number | null }
  export function positionRowsOf(s: WindowStats): PositionRow[];
  ```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { kpisOf, curveOf, trendOf, leakBarsOf, streetBarsOf, positionRowsOf, MAX_POINTS } from './reportModel';
import { aggregate } from '../storage/summary';

// 空值从 aggregate([]) 借，不手搓 WindowStats 字面量：手搓的那份在
// taxonomy 加分类时不会跟着变，而 aggregate 的骨架会。
const empty = aggregate([]);

describe('kpisOf', () => {
  it('零手时三个卡都出，值为 0，不出 NaN', () => {
    const k = kpisOf(empty);
    expect(k.map(x => x.key)).toEqual(['hands', 'bb100', 'leak']);
    expect(k.every(x => !x.value.includes('NaN'))).toBe(true);
  });

  it('EV 损失卡恒为负号且恒红——它是「漏了多少」不是「输了多少」', () => {
    const s = { ...empty, hands: 100, netBB: 420, byStreet: { preflop: 0, flop: 10, turn: 20, river: 0 } };
    const leak = kpisOf(s).find(k => k.key === 'leak')!;
    expect(leak.value.startsWith('−')).toBe(true);
    expect(leak.tone).toBe('negative');
  });

  it('赢着钱也可能在漏：BB/100 为正与 EV 损失为负并存', () => {
    const s = { ...empty, hands: 100, netBB: 420, byStreet: { preflop: 0, flop: 30, turn: 0, river: 0 } };
    const [, winrate, leak] = kpisOf(s);
    expect(winrate.tone).toBe('positive');
    expect(leak.tone).toBe('negative');
  });
});

describe('curveOf', () => {
  it('累计而不是逐手：[10,-4,7] → [10,6,13]', () => {
    expect(curveOf([10, -4, 7]).map(p => p.cum)).toEqual([10, 6, 13]);
  });

  it('空数组给空曲线', () => {
    expect(curveOf([])).toEqual([]);
  });

  it('不超过 MAX_POINTS 时一个点都不丢', () => {
    const series = Array.from({ length: MAX_POINTS }, () => 1);
    expect(curveOf(series)).toHaveLength(MAX_POINTS);
  });

  it('超过 MAX_POINTS 时等距抽样，首尾必须保留', () => {
    const series = Array.from({ length: 10000 }, () => 1);
    const out = curveOf(series);
    expect(out).toHaveLength(MAX_POINTS);
    expect(out[0]!.i).toBe(1);
    expect(out[out.length - 1]!.i).toBe(10000);
    expect(out[out.length - 1]!.cum).toBe(10000);
  });

  it('抽样取累计值本身，不做平均——平均会把回撤削平', () => {
    // 前 5000 手每手 +1，后 5000 手每手 −1：末点必须回到 0
    const series = [...Array.from({ length: 5000 }, () => 1), ...Array.from({ length: 5000 }, () => -1)];
    const out = curveOf(series);
    expect(out[out.length - 1]!.cum).toBe(0);
    expect(Math.max(...out.map(p => p.cum))).toBeGreaterThan(4900);
  });
});

describe('trendOf', () => {
  it('两段都满 100 手时给出两个数', () => {
    const t = trendOf(Array.from({ length: 200 }, (_, i) => (i < 100 ? -1 : 2)));
    expect(t.previous).toBe(-100);
    expect(t.current).toBe(200);
  });

  it('不足 200 手时 previous 为 null，文案是样本不足', () => {
    const t = trendOf(Array.from({ length: 150 }, () => 1));
    expect(t.previous).toBeNull();
    expect(t.text).toContain('样本不足');
  });
});

describe('leakBarsOf', () => {
  it('按累计 evLoss 倒序，榜首 100%', () => {
    const s = { ...empty, byTag: { ...empty.byTag, 'loose-call': { count: 2, evLoss: 10 }, 'loose-open': { count: 9, evLoss: 4 } } };
    const bars = leakBarsOf(s);
    expect(bars.map(b => b.tag)).toEqual(['loose-call', 'loose-open']);
    expect(bars[0]!.pct).toBe(100);
    expect(bars[1]!.pct).toBe(40);
  });

  it('次数为 0 的分类不上榜', () => {
    expect(leakBarsOf(empty)).toEqual([]);
  });

  it('标签是中文，来自 TAG_TEXT', () => {
    const s = { ...empty, byTag: { ...empty.byTag, 'loose-call': { count: 1, evLoss: 1 } } };
    expect(leakBarsOf(s)[0]!.label).not.toBe('loose-call');
  });
});

describe('streetBarsOf', () => {
  it('四段恒在，占比之和为 100', () => {
    const s = { ...empty, byStreet: { preflop: 1, flop: 1, turn: 2, river: 0 } };
    const bars = streetBarsOf(s);
    expect(bars.map(b => b.street)).toEqual(['preflop', 'flop', 'turn', 'river']);
    expect(bars.reduce((a, b) => a + b.pct, 0)).toBe(100);
    expect(bars[2]!.pct).toBe(50);
  });

  it('全零时四段全 0 宽，不除零', () => {
    expect(streetBarsOf(empty).every(b => b.pct === 0)).toBe(true);
  });
});

describe('positionRowsOf', () => {
  it('六个位置恒在，顺序固定 UTG→BB', () => {
    expect(positionRowsOf(empty).map(r => r.position)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it('没打过的位置 bb100 为 null（界面显示破折号），不是 0', () => {
    expect(positionRowsOf(empty).every(r => r.bb100 === null)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

`npx vitest run src/ui/reportModel.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现六个函数**

关键实现点，逐条：

**`kpisOf`** — 三卡：手数（`tone: 'neutral'`）、BB/100（`bb100(hands, netBB)`，正绿负红）、每百手 EV 损失（`bb100(hands, Σ byStreet)` 取负，恒红）。负号用 U+2212（`−`）不用 ASCII 连字符，与 `format.ts` 现有做法一致（读它确认）。

**`curveOf`** — 先累计再抽样：

```ts
export function curveOf(netSeries: readonly number[]): CurvePoint[] {
  const all: CurvePoint[] = [];
  let cum = 0;
  for (let i = 0; i < netSeries.length; i++) {
    cum = round2(cum + netSeries[i]!);
    all.push({ i: i + 1, cum });
  }
  if (all.length <= MAX_POINTS) return all;

  // 等距抽样，取累计值本身。不做区间平均：平均会把回撤削平，
  // 那是在美化数据——曲线的用处恰恰是让人看见那些坑。
  const out: CurvePoint[] = [];
  for (let k = 0; k < MAX_POINTS; k++) {
    out.push(all[Math.round((k * (all.length - 1)) / (MAX_POINTS - 1))]!);
  }
  return out;
}
```

**`trendOf`** — 直接调 `trend(netSeries, 100)`，只负责生成文案。两段都有时文案是「最近 100 手 X BB/100 · 之前 100 手 Y BB/100」，任一段为 null 时是「样本不足（需 200 手）」。

**`leakBarsOf`** — 调现成的 `leaks(s.byTag)` 拿排序后的行，`pct = evLoss / 榜首 evLoss * 100`。榜首 evLoss 为 0 时（有次数但损失全 0）全部记 0，不除零。标签走 `TAG_TEXT[tag]`。

**`streetBarsOf`** — 固定四段顺序，`pct = evLoss / 四街之和 * 100`，和为 0 时全 0。

**`positionRowsOf`** — 固定六位顺序，`bb100 = hands === 0 ? null : bb100(hands, netBB)`。

- [ ] **Step 4: 跑测试确认全绿**

`npx vitest run src/ui/reportModel.test.ts`

- [ ] **Step 5: 提交**

```bash
npm run typecheck
git add src/ui/reportModel.ts src/ui/reportModel.test.ts
git commit -m "feat(ui): 报表的纯数据变形

正文写清：抽样为什么取累计值不做平均、EV 损失卡为什么与 BB/100 分开列。"
```

---

### Task 5: 报表页与导航第三项

**Files:**
- Create: `src/ui/pages/ReportPage.tsx`
- Modify: `src/ui/components/Nav.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `loadReport` / `ensureSummaries` / `ReportWindow` / `storageStatus`（T3）、`reportModel` 六个函数（T4）
- Produces: `export function ReportPage(): JSX.Element`；`PageId` 增加 `'report'`

- [ ] **Step 1: 改 `Nav.tsx`**

`PageId` 加 `'report'`，`ITEMS` 加 `{ id: 'report', label: '报表' }`。

顺手把那段注释改掉——它现在写的是「设计稿里还有第三项 Progress，那是 ③-D，列一个点了没反应的入口比不列更糟」。这一期它有反应了。新注释说明三项各是什么，别留一条过期的解释在那儿误导下一个人。

- [ ] **Step 2: 写 `ReportPage.tsx`**

结构（对应规格 §5 的映射表）：

```
.rep
  .rep-head        标题「报表」+ 窗口分段控件（200 / 500 / 1000 / 全部）
                   partial 时在控件旁标注「库里共 N 手」
  .rep-kpis        三张 KPI 卡（kpisOf）
  .rep-main        左：曲线卡（curveOf + trendOf）
                   右：漏洞榜（leakBarsOf）、分街（streetBarsOf）、分位置（positionRowsOf）
  .rep-note        页脚：「EV 数字为近似估算，非 solver 输出」
```

状态机与数据流：

```tsx
const [win, setWin] = useState<ReportWindow>(200);
const [data, setData] = useState<ReportData | null>(null);
const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'partial-backfill'>('loading');

useEffect(() => {
  let alive = true;
  setState('loading');
  void (async () => {
    const filled = await ensureSummaries();      // 每次挂载调，内部自己去重
    const out = await loadReport(win);
    if (!alive) return;
    setData(out);
    setState(storageStatus() === 'unavailable' ? 'unavailable' : filled ? 'ready' : 'partial-backfill');
  })();
  return () => { alive = false; };
}, [win]);
```

`alive` 那道闸是必须的：用户快速连点窗口切换时，先发的请求可能后到，把新窗口的数据覆盖成旧的。

四种空态（规格 §4.3），各说各的话：

| 条件 | 显示 |
|---|---|
| `state === 'loading'` | 加载中 |
| `state === 'unavailable'` | 「本机存储不可用，报表无法统计」——与顶栏「未记录」同源 |
| `data.stats.hands === 0` | 「还没有记录，先去牌桌打几手」 |
| `state === 'partial-backfill'` | 正常渲染 + 页头标注「统计可能不完整」 |

`partial`（窗口比库大）**不是空态**：照常出报表，只在控件旁标注实际手数。选了「最近 1000 手」但只有 37 手的新用户必须看得到东西。

- [ ] **Step 3: 曲线用内联 SVG**

不引图表库。`viewBox="0 0 300 120"`、`preserveAspectRatio="none"`，与设计稿一致：三条横向网格线、渐变填充区、折线、末点一个圆点。

`curveOf` 的输出映射到坐标：x 按点序等距，y 按 `cum` 的 min/max 归一。**min === max 时（全平的曲线）把线画在中间高度**，不要除零。

零轴：`cum = 0` 那条线用虚线画出来，与设计稿里那条 `stroke-dasharray="3 3"` 的线对应——它是「回本线」，比任何刻度都重要。

- [ ] **Step 4: 加 CSS**

在 `app.css` 末尾追加 `.rep-*` 一组，紧跟在 `.hist-*` 之后。

- 令牌沿用既有那套（`--app` `--line` `--text-dim` `--positive` `--danger` …），**不新增调色板**
- 卡片样式抄 `.hist` 那组的圆角、边框、阴影，别自己调一套新的
- 窄屏断点与历史页同一个：三列 KPI 折一列，右侧三块下沉到曲线之后
- 数字一律 `font-variant-numeric: tabular-nums`（全项目惯例）

- [ ] **Step 5: 手动跑一眼**

```bash
npm run dev
```
打开 `http://localhost:5173`，点导航「报表」。空库状态下应看到「还没有记录」而不是报错或一片空白。

- [ ] **Step 6: 提交**

```bash
npm run typecheck && npm run build
git add src/ui/pages/ReportPage.tsx src/ui/components/Nav.tsx src/ui/styles/app.css
git commit -m "feat(ui): 报表页与导航第三项

正文写清：四种空态为什么分开说、partial 为什么不当空态挡掉。"
```

---

### Task 6: 接线与浏览器验收

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: 把两路分支改成三路**

`App.tsx` 现在是 `page === 'history' ? (…) : (…)` 的三元。三个页面之后这个写法会开始打结，改成显式分支：

```tsx
{page === 'history' ? (
  <>…</>
) : page === 'report' ? (
  <ReportPage />
) : (
  <>…牌桌…</>
)}
```

牌桌那一支保持原样，一行都不动——它挂着会话状态、音效与结算动画，本期不碰它。

- [ ] **Step 2: 确认报表页不订阅牌桌状态**

`ReportPage` 自己从库里取数，不接受任何 props。这是有意的：它与牌桌之间唯一的耦合就是数据库，多一条 props 就多一条「牌桌重渲染带着报表一起重算」的路径。

- [ ] **Step 3: 浏览器验收（规格 §8 的十条，逐条走）**

```bash
npm run dev
```

1. 空库进报表页：显示「还没有记录」，控制台无报错
2. 打 3 手后进报表页：KPI 有数、曲线三点、趋势显示样本不足
3. 打满 200+ 手（可用导入一份既有 JSON 加速）：四块内容齐全，趋势两段都有数
4. 窗口切到 500 / 1000 / 全部：手数随之变化，库里不足时标注实际手数
5. **升级路径**：先用 master 的代码（DB_VERSION 1）存几手，再切回本分支加载 → 首次进报表页触发回填，手数与历史页对得上
6. 导入一份 JSON 后进报表页：手数与导入后的历史页一致
7. 隐私模式窗口：显示「本机存储不可用」，牌桌仍能打
8. 历史页「重置数据」后进报表页：回到空库空态（**这条专门验 `clearAll` 的第三个 store**）
9. 窄屏 375px：三列折一列，无横向滚动
10. 报表数字与历史页交叉核对：手数一致、净盈亏方向一致

**第 5 条与第 8 条是本期最容易坏的两条**，别跳过。发现对不上就停下来报告，不要就地改数凑上。

- [ ] **Step 4: 跑全套并提交**

```bash
npm test && npm run typecheck && npm run build
git add src/ui/App.tsx
git commit -m "feat(ui): 报表页接线

正文附上浏览器验收十条的实际结果，尤其第 5 条升级路径与第 8 条重置数据。"
```

---

### Task 7: README 收尾

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 改状态表与开头那段**

- 阶段表：③-D 那行拆成「③-D-1 漏洞报表 ✅ 完成」与「③-D-2 上线（设置 · PWA · 部署）未开始」
- 开头「当前状态」那段加上报表页
- 测试数改成实跑出来的数字（**不是本计划里的预计值**）

- [ ] **Step 2: 加「漏洞报表（③-D-1）这边」一节**

按 README 既有的写法，记下本期的取舍与边界，每条都要给理由：

- 摘要与手牌是两个 store，报表只扫摘要（4.5 KB/手 vs ~120 字节/手）
- 增量的 `applyHand` 与窗口的 `aggregate` 是两条路径，靠一条属性测试锁口径
- 回填只在报表页触发，从不看报表的用户摘要 store 一直是空的——这是刻意的
- 砍掉设计稿的 "Win rate vs persona"，两条理由
- 曲线 x 轴是手序不是 session；超过 240 点等距抽样，取累计值不做平均
- 报表页不做实额换算，与顶栏的口径分工
- 报表的净盈亏与顶栏那个仍是两个数（③-C 已记的分叉，本期不试图统一）
- EV 损失的系统性偏差会累积而不是抵消，所以页脚有「近似估算」标注

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: README 更新到漏洞报表完成状态

正文写清本期新增的已知边界有哪几条。"
```

---

## 不在本期

- 设置页（§10.6）、PWA、部署——③-D-2 / D-3
- 「重新计算统计」的手动入口（回填是自动的）
- 导出文件里带摘要（派生值，理由同 ③-C 不导出统计）
- 图表交互（悬停读数、缩放）
- 复盘卡片上的「近似估算」标注——本期只在报表页补，卡片那处仍是欠账
- 候选动作名的中文化（③-B 留下的已知边界）：与本期无关，别顺手改
