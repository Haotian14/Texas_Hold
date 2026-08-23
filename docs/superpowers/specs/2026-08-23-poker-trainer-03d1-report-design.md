# ③-D-1 漏洞报表 — 设计文档

上游：`2026-08-06-texas-holdem-trainer-design.md` §10.5（漏洞报表）、§9（存储）
设计稿：`docs/design-ref/poker-trainer-ui.dc.html` 的 Progress 屏
日期：2026-08-23

## 1. 目标

把「长期统计暴露反复出现的漏洞」这件事做出来。这是上游 §1 写的核心价值里最后一块没落地的：③-B 让用户看得见**这一手**打错在哪，③-C 把每手存了下来，但「你反复在转牌上多跟」这种只有跨手才看得见的结论，现在没有任何一个界面在说。

产出是一页报表：给定一个手数窗口，回答三件事——**这段时间赢没赢**、**输的钱主要漏在哪类失误上**、**哪条街、哪个位置在漏**。

## 2. 范围

### 本期做

- 新页面「报表」（导航第三项，对应设计稿的 Progress 屏）
- 窗口切换：最近 200 / 500 / 1000 / 全部，默认 200（§10.5）
- 三个 KPI：手数 · BB/100 · 每百手 EV 损失
- 累计净盈亏曲线 + 趋势对比（最近 100 手 vs 之前 100 手）
- 漏洞排行榜（按累计 evLoss 倒序）
- 分街 evLoss 分布
- 分位置盈亏
- 数据层：`summaries` object store（DB_VERSION 2）、窗口聚合纯函数、回填

### 本期明确不做

- 设置页、PWA、部署——③-D 的其余三项，各自单开
- 「重新计算统计」的手动入口（回填是自动的，见 §3.4）
- 导出文件里带摘要（它是派生值，理由与 ③-C 不导出统计相同）
- 图表交互（悬停读数、缩放）。静态曲线加一行趋势数字已经回答了 §10.5 要的问题

### 为什么砍掉设计稿的 "Win rate vs persona"

设计稿右下那块列的是「对各性格的胜率」。不做，两个理由：

1. **6-max 里这个数没有明确语义。** 一手牌桌上同时坐着五个不同性格，赢的钱来自底池不来自某个人。要让它有意义，得按「摊牌时谁在池子里」归因，那是一套新的口径，而 §10.5 没有要求它。
2. **③-A 每手重掷性格。** 同一个座位这手是岩石、下手是疯子，样本从一开始就是混的。

那块位置改放**分位置盈亏**——行结构（圆点 + 名称 + 右侧数字）与设计稿完全一致，换的是内容。

## 3. 数据层

### 3.1 现状与缺口

`src/storage/stats.ts` 已经有全部聚合逻辑：`applyHand` 把一手折进 `Stats`，`bb100` / `trend` / `leaks` 是现成的纯函数，`byStreet` / `byPosition` 也已经在 `Stats` 里。

缺的只有一件事：**这些数只有「全部手牌」一个口径**。`Stats` 是单条增量聚合文档，`recentNet` 只留最近 200 手的净盈亏（连 evLoss 都没有）。窗口切到「最近 500 手的漏洞排行」时，没有任何数据能算。

从 `hands` store 现扫也不行：IndexedDB 读不了部分字段，每条要把 `record` + `view` 整个取出来，实测约 4.5 KB/手——「全部」档在万手时是 45 MB。

### 3.2 `HandSummary` 与 `summaryOf`

新增 `src/storage/summary.ts`（纯数据 + 纯函数，不碰 IndexedDB，与 `schema.ts` / `stats.ts` 同一原则）：

```ts
export const SUMMARY_SCHEMA_VERSION = 1;

export interface HandSummary {
  id: string;                 // = StoredHand.id，主键
  timestamp: number;          // 索引字段
  netBB: number;              // = heroNetOf(hand)
  position: Position;
  /** 分街 evLoss。四条街恒在，没有失误就是 0 */
  byStreet: Record<Street, number>;
  /** 只含 count > 0 的分类。空对象 = 这手没有可归类的失误 */
  byTag: Partial<Record<MistakeTag, { count: number; evLoss: number }>>;
}

export function summaryOf(hand: StoredHand): HandSummary;
```

`summaryOf` 的逻辑就是现在 `applyHand` 里那段拆出来：遍历 `view.decisions` 累 `byStreet` 与 `byTag`，`view === null`（分析失败）时两者留空但**仍然产出摘要**——那一手确实打过，手数与盈亏要进分母，否则 BB/100 偏离真实战绩（与 `applyHand` 现有注释同一条理由）。

`byTag` 用 `Partial` 而不是像 `Stats` 那样填满 15 个分类：`Stats` 是单条文档，填满是为了「taxonomy 加分类时编译失败而不是报表上少一行」；摘要是每手一条 × 一万条，填满等于把 15 个零乘一万遍存进库。聚合侧从 `PREFLOP_TAGS` / `POSTFLOP_TAGS` 建骨架，加分类时仍然编译期可见。

**体积**：典型一手 `byTag` 空或一项，估约 100–150 字节，一万手 1–1.5 MB。相对 `hands` 的 45 MB 可以忽略。

### 3.3 `summaries` store 与 DB_VERSION 2

`schema.ts` 加：

```ts
export const SUMMARIES_STORE = 'summaries';
export const DB_VERSION = 2;   // 1 → 2
```

`STORES` 加一项：`keyPath: 'id'`，一个索引 `timestamp`。`db.ts` 的 `onupgradeneeded` 已经是「按 `STORES` 建表、已存在就补索引」的循环，加 store 不需要改它一行。

`db.ts` 新增四个薄函数，与既有的同构（只包 Promise，不做判断）：`putSummary`、`allSummaries`、`countSummaries`、`lastSummaries(n)`（`timestamp` 索引反向游标取 n 条）。`clearAll` 的 store 列表是手写的（不是从 `STORES` 推的），要从两个改成三个——漏掉这一处的后果是「重置数据」之后摘要还在，报表上的手数不归零。

### 3.4 回填：为什么必须在升级事务外

`db.ts` 的 `onupgradeneeded` 刻意不做值层面的迁移，注释里写了理由：升级事务会阻塞整个打开流程，在里面扫全表会让应用启动时卡住不定长的时间。这条不放宽。

后果是**新 store 建出来是空的**，③-C 期间存下的手牌没有摘要。回填放在升级事务外，由报表页触发：

```ts
export function ensureSummaries(): Promise<boolean>;
```

比对 `countHands()` 与 `countSummaries()`，相等就直接返回；不等就 `allHands()` 全读一遍、`summaryOf` 逐条重建、批量写入。这条扫全表的路径 `recomputeStatsInline` 已经在走（导入后重算统计），不是新增的代价类型。

计数相等即认为一致，不逐条校验 id：一致性的真正威胁是「写了手牌但没写摘要」，那必然导致计数不等。逐条比对要把两个 store 全读出来，代价与直接重建相同，不划算。

回填在页面挂载时触发一次，结果缓存在模块级变量；同一次会话内不重复扫表。

### 3.5 `aggregate` 与一致性闸

```ts
export interface WindowStats {
  hands: number;
  netBB: number;
  byTag: Record<MistakeTag, TagStat>;
  byStreet: Record<Street, number>;
  byPosition: Record<Position, PositionStat>;
  /** 窗口内逐手净盈亏，时间升序。曲线与 trend() 都吃它 */
  netSeries: number[];
}

export function aggregate(rows: readonly HandSummary[]): WindowStats;
```

`aggregate` 假定入参已按时间升序（排序在 repo 层做，见 §3.6）。字段集与 `Stats` 的重合部分刻意同名同义——`bb100` / `trend` / `leaks` 三个现成函数直接吃，不需要各写一份。

**这里有两条算同一批数的路径**（增量的 `applyHand`，与扫窗口的 `aggregate`），README 已经记过一次「两个净盈亏对不上」的教训。所以加一道闸，作为本期测试的一等公民：

> 同一批 `StoredHand`，`reduce(applyHand, emptyStats())` 与 `aggregate(hands.map(summaryOf))` 的 `hands` / `netBB` / `byTag` / `byStreet` / `byPosition` 必须逐字段相等。

用属性测试驱动（随机手数、随机 evLoss 分布、含 `view === null` 的手）。这条测试的意义不是证明某次实现对，是在将来任何一侧被改动时立刻炸——两个口径分叉是这类项目里最难在界面上看出来的缺陷。

`netSeries` 与 `Stats.recentNet` 不在闸的范围内：后者上限 200，前者没有上限，本来就不相等。

### 3.6 repo 层接口

```ts
export type ReportWindow = 200 | 500 | 1000 | 'all';

export interface ReportData {
  stats: WindowStats;
  /** 窗口内实际取到的手数 < 请求的窗口大小时为 true（库里就这么多） */
  partial: boolean;
}

export function loadReport(w: ReportWindow): Promise<ReportData>;
export function ensureSummaries(): Promise<boolean>;
```

`loadReport` 取数后在内存里按 `(timestamp, id)` 升序排——与 `recomputeStatsInline` 用的排序键一致。索引游标只能按 `timestamp` 排，同毫秒的两手顺序不稳定；曲线是累计值，顺序不稳会让同一份数据两次渲染出不同的形状。

写入侧的维护：

- `saveHand`：在 `putHand` 之后 `putSummary`。三次写（hand / summary / stats）**不是原子的**——现有代码本来就不是（hand 与 stats 已经是两次），本期不引入事务边界。不一致由 `ensureSummaries` 的计数比对兜底。
- `importHands`：每条写入时一并写摘要；写完照旧整表重算统计。
- `resetAll`：`clearAll` 已改为清三个 store，无需额外改动。
- 存储不可用时一律走既有降级：`status = 'unavailable'`，返回空数据，页面显示不可用空态。

## 4. UI 架构

### 4.1 分层

```
src/ui/reportModel.ts       纯数据变形，零 React 零 DOM —— 本期几乎全部可测的 UI 逻辑在这里
src/ui/pages/ReportPage.tsx 页面壳：窗口切换、四块卡片的摆放、空态
```

沿用 ③-B 的取舍：组件不测（本项目没有 testing-library，本期不引入），所有判断与归一化下沉到纯函数里。曲线用内联 SVG，与设计稿一致，不引图表库。

### 4.2 `reportModel.ts` 接口

```ts
/** 三个 KPI 卡的显示值 */
export function kpisOf(s: WindowStats): Kpi[];

/** 累计净盈亏曲线。点数上限 MAX_POINTS，超出按等距抽样 */
export function curveOf(netSeries: readonly number[]): CurvePoint[];

/** 趋势对比：最近 100 手 vs 之前 100 手，样本不足时为 null */
export function trendOf(netSeries: readonly number[]): TrendView;

/** 漏洞排行榜的条形数据，按累计 evLoss 倒序，条宽相对榜首归一 */
export function leakBarsOf(s: WindowStats): LeakBar[];

/** 分街 evLoss 分布，四段占比 */
export function streetBarsOf(s: WindowStats): StreetBar[];

/** 分位置盈亏，六行，无手数的位置显示破折号 */
export function positionRowsOf(s: WindowStats): PositionRow[];
```

**KPI 定义**（§10.5 只写了「顶部 BB/100」，其余本设计定死）：

| 卡片 | 值 | 说明 |
|---|---|---|
| 手数 | `stats.hands` | 窗口内实际手数 |
| BB/100 | `bb100(hands, netBB)` | 正绿负红，与顶栏同色系 |
| 每百手 EV 损失 | `−bb100(hands, Σ byStreet)` | 恒为负或零，恒红。这是「漏了多少」不是「输了多少」 |

第三个卡与第二个是两个独立的数：EV 损失衡量决策质量，净盈亏里还掺着运气。一段时间里 BB/100 为正而 EV 损失也很大是完全可能的，那正是最该被看见的情形——赢着钱在漏。

**曲线抽样**：`MAX_POINTS = 240`。「全部」档在万手时 SVG 里画一万个点既慢又没有信息量。累计曲线可以直接等距抽样（取第 k 个累计值），不需要平均——平均会把回撤削平，那是在美化数据。抽样后首尾两点必须保留。

**趋势**：直接调现成的 `trend(netSeries, 100)`。任一段不足 100 手时该段为 `null`，界面显示「样本不足」而不是拿 12 手硬算一个 BB/100（`trend` 的注释里已经写了理由）。

**条形归一**：漏洞榜条宽 = `evLoss / 榜首 evLoss`，榜首恒为 100%。分街占比 = `街 evLoss / 四街之和`，和为 0 时四段全 0 宽并显示「窗口内没有可判定的失误」。两处都不做除零。

### 4.3 空态

四种，各说各的话，不合并成一句「暂无数据」：

| 情形 | 文案 |
|---|---|
| 回填/查询进行中 | 加载中 |
| 存储不可用（隐私模式、配额满、被禁用） | 与顶栏「未记录」同源：本机存储不可用，报表无法统计 |
| 库里一手都没有 | 还没有记录，先去牌桌打几手 |
| 窗口内手数少于所选窗口（`partial`） | 正常渲染，但在窗口选择器旁标注实际手数 |

第四种不算错误：选了「最近 1000 手」但库里只有 37 手时，照常出报表并说明是 37 手。把它当空态挡掉，等于让新用户在攒够 1000 手之前看不到任何东西。

## 5. 视觉

设计稿 Progress 屏的结构逐块对应，皮不变、内容换：

| 设计稿 | 本页 |
|---|---|
| 标题 + 副标题 "Last 30 sessions" | 标题「报表」+ 窗口分段控件（200 / 500 / 1000 / 全部） |
| 三个 KPI 卡（Hands played / Win rate / Leak rate） | 手数 / BB/100 / 每百手 EV 损失 |
| Net BB over time 折线 + 底部三个刻度 | 累计净盈亏曲线，x 轴是**手序**不是 session（本项目没有 session 概念）；底部刻度为第 1 手 / 中点 / 末手；曲线下方加一行趋势对比 |
| Top leaks 条形 | 漏洞排行榜，比设计稿多一列次数 |
| Win rate vs persona | 分位置盈亏（六行，圆点 + 位置 + BB/100） |
| （无） | 分街 evLoss 分布，四段横条，接在漏洞榜下方 |

颜色令牌沿用 `app.css` 里已有的那套（③-A 定的浅色令牌层），不新增调色板。正值绿、负值与损失红，与顶栏、历史页一致。

窄屏（手机）时三列 KPI 折成一列、右侧两块下沉到曲线之后——与历史页同一套断点，不引新的。

## 6. 错误处理与边界

- **存储不可用不掀页面**：`loadReport` 内部吞掉异常、置 `status`，返回空 `WindowStats`。报表页显示不可用空态，导航仍可用。
- **回填失败**：`ensureSummaries` 返回 false，报表按现有摘要（可能不全）出数，并在页头标注「统计可能不完整」。不弹错、不阻断——不完整的报表仍比空白有用，但必须说出来。
- **多标签页**：与 ③-C 的既有边界一致，不为它引 BroadcastChannel。摘要按 id 写入，不像统计文档那样互相覆盖，所以多标签页对本页的影响小于对顶栏统计的影响。
- **金额比较**一律走 `core/chips.ts`，禁裸 `===` 与裸 `>`。
- **内部量纲 BB**；本页**不做实额换算**——BB/100 与 EV 损失是 BB 量纲的指标，换成实额会让它们与扑克界的通用口径对不上。这与顶栏显示实额不冲突：顶栏说的是「你赢了多少钱」，报表说的是「你打得多好」。

## 7. 测试策略

| 层 | 怎么测 |
|---|---|
| `summaryOf` | 单元：有失误 / 无失误 / `view === null` / 多街多分类 |
| `aggregate` | 单元：空数组、单手、多手累加、分类骨架完整性 |
| **一致性闸** | 属性测试：`reduce(applyHand)` ≡ `aggregate(map(summaryOf))`（§3.5） |
| `reportModel` 六个函数 | 单元：正常值、零手、全零 evLoss、抽样边界（249 点 / 240 点 / 1 点）、趋势样本不足 |
| `schema.ts` 的 store 定义 | 沿用既有做法：断言 store 名、keyPath、索引集 |
| `db.ts` / `repo.ts` 的 IndexedDB 路径 | 不写自动化测试（本项目不引 fake-indexeddb），由 §8 浏览器验收覆盖 |
| 组件树 | 不测，沿用 ③-A/③-B 的取舍 |

## 8. 人工验收清单

1. 空库进报表页：显示「还没有记录」，不报错
2. 打 3 手后进报表页：KPI 有数、曲线三点、趋势显示样本不足
3. 打满 200+ 手：四块内容齐全，趋势两段都有数
4. 窗口切到 500 / 1000 / 全部：手数随之变化，库里不足时标注实际手数
5. **升级路径**：用 ③-C 版本存下手牌，再加载本期代码 → 首次进报表页触发回填，数字与历史页对得上
6. 导入一份 JSON 后进报表页：手数与导入后的历史页一致
7. 隐私模式：显示存储不可用空态，牌桌仍能打
8. 「重置数据」后进报表页：回到空库空态
9. 窄屏（375px）：三列折一列，无横向滚动
10. 报表页数字与历史页交叉核对：手数、净盈亏方向一致

## 9. 已知局限

- **报表的净盈亏与顶栏那个仍是两个数**（③-C 已记）。本页用的是每手 `netBB` 求和，顶栏是账本的「当前筹码 − 累计买入」。某手因存储不可用没落库时会分叉。本页不试图校验顶栏，也不该被拿去校验顶栏。
- **EV 损失继承上游 §12 的全部局限**：单步近似、蒙特卡洛噪声、多人底池精度下降。报表把这些数累加了几百手，噪声会部分抵消，但系统性偏差（如尚未行动的对手被建模为持开池范围）会**累积而不是抵消**。页脚需要一句「近似估算」的标注——这也是 ③-B 遗留下来、至今没上界面的那条。本期在报表页补上，复盘卡片那处仍留给后续。
- **窗口是「最近 N 手」不是「最近 N 天」。** 一周不打的用户回来看到的还是上次那批手，这是 §10.5 定的口径。
- **回填只在报表页触发。** 从不打开报表页的用户，摘要 store 会一直是空的。这是刻意的：为一个可能永远不看的页面在启动时扫全表，代价加在每个人身上。
