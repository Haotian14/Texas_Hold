# ③-C 持久化 · IndexedDB / 历史页 / 导出导入

**基线：** `persistence` 分支 @ `bc70e54`（自 master），**46 文件 / 651 通过 / 3 跳过**，typecheck + build 绿
**规格来源：** 设计文档 §9（存储规格）、§10.4（历史页）

**测试数逐任务：** 651 → T1 658（视图往返 7 条）→ T2 **672**（schema 12 条 +
架构守卫 2 条）→ T3 695（统计 23 条）。
注：T2 的提交信息把总数写成了 670，漏算了那两条新架构守卫，实际是 672。
任何一步跑出的数字与这里对不上，**停下来报实际数字**，不要靠删测试凑回来。

---

## 0. 开工前先解决的那件事

③-B 的整支审查留下一条「带进 ③-C 的风险」，它是本期的第一块砖：

> **`HandAnalysis` 不是可序列化的 DTO。** `situation.opponents[].range` 是
> `ReadonlyMap`，`JSON.stringify` 会静默变成 `{}`（不报错，取回时范围为空）；
> `recommended` 与 `candidates` 里的某一项是**同一个对象引用**，序列化会把它
> 拆成两份，`===` 判等在取回后失效。

再加一条落库前才看得见的：**体积**。规格估的是「单手约 1–2 KB，10000 手约
15 MB」。但一个 `HandAnalysis` 的每个决策点都挂着完整 `Situation`，里面是
最多 5 个对手 × 各一张 169 项的范围表——单个决策点就 10 KB 上下，一手四个
决策点 40 KB。按这个存，10000 手是 **400 MB**，比规格估的多二十倍，移动端
配额直接爆掉。

### 结论：范围不落库

理由不止是体积，更是**它没有用**：

- 界面上没有任何一处渲染对手范围（复盘卡片只用到 `pot` / `toCall`）。
- 规格 §9 说「规则升级后可对全部历史手牌批量重跑分析」——重跑的输入是
  `HandRecord`（座位、personaId、seed、完整动作序列都在里面），不是存下来的
  `Situation`。范围本来就是从 `HandRecord` 重新推出来的。

所以存的不该是 `HandAnalysis`，而是一个**只含界面会渲染的字段**的视图类型。

### 做法：视图类型即 DTO

新增 `src/review/view.ts`：

```
HandView   = { recordId, heroSeat, schemaVersion, decisions: DecisionView[],
               totalEvLoss, worstEvLoss, tags }
DecisionView = { actionIndex, street, actual, pot, toCall,
                 heroEquity, requiredEquity, evLoss, severity, tag,
                 explanation, degraded, candidates, actualLabel,
                 recommendedLabel }
viewOf(a: HandAnalysis): HandView
```

三件事一次性解决：

1. **没有 `Map`**，全是原语与数组，`JSON.stringify` 往返无损。
2. **没有共享引用**：`recommended` 塌成 `recommendedLabel: string | null`
   （`candidates[i].isRecommended` 本来就在，对象引用是多余的）。
3. **体积回到规格线上**：≈ 4 决策点 × (6 候选 × ~60B + 解释文案 ~120B) ≈ 2 KB。

而且它同时是 **UI 的输入类型**。复盘卡片改吃 `HandView`，于是「实时算出来的」
与「从库里取出来的」走同一条渲染路径，不存在"取回后要补一个假范围"的复原步骤
——那种复原正是本项目一直在防的那类缺陷：用一个结构上合法但语义上是谎的值
喂给下游。

`degraded` 契约不受影响：`viewOf` 只是搬字段，降级时被置空的那些字段搬过去
仍然是空的。这一点要有测试守着。

---

## 1. 任务分解

| # | 内容 | 产出 |
|---|---|---|
| 1 | 视图类型与 `viewOf`，复盘卡片改吃 `HandView` | `src/review/view.ts` + 测试；`src/ui/` 四个组件改签名 |
| 2 | 存储 schema（纯数据）与 IndexedDB 适配器 | `src/storage/schema.ts`、`src/storage/db.ts` |
| 3 | 统计聚合（纯函数） | `src/storage/stats.ts` + 测试 |
| 4 | 落库接线：每手结束写入 | `src/ui/App.tsx` |
| 5 | 历史页 + 左侧导航 | `src/ui/pages/`、设计稿的 sidebar 终于有内容了 |
| 6 | JSON 导出 / 导入 | `src/storage/transfer.ts` + 测试 |
| 7 | 「我不认同这个判定」（`disputed`） | 复盘卡片按钮 + 历史页筛选 |

任务 1–3、6 是纯逻辑，全部有测试。任务 2 的 IndexedDB 适配器是本期唯一碰
浏览器 API 的地方，**刻意做薄**——不引 `fake-indexeddb` 这类依赖去测它，
而是把可测的东西（schema 定义、索引名、迁移步骤）全部挤到纯数据一侧，
适配器只剩包一层 Promise 的样板，由浏览器验收覆盖。这与本项目一贯的做法
一致（`src/ui/` 至今没有组件测试，纯逻辑层测得很密）。

## 2. 分层

新增 `src/storage/`，位置在 `session` 与 `ui` 之间：

- 它可以 import `core` / `review` 的**类型**与 `review/view` 的 `viewOf`
- 它是**唯一**允许出现 `indexedDB` 的目录（`db.ts` 一个文件）
- `src/session/` 不得 import `src/storage/`——对局逻辑不知道有没有数据库，
  刷新即丢的行为必须仍然成立（离线/隐私模式下 IndexedDB 可能不可用）
- 落库失败不掀桌子：与 ③-B 的 `analyzeHand` 抛错同款处理，记一条失败状态，
  牌局继续

`src/session/architecture.test.ts` 加两条守卫：`src/session/` 不 import
`storage`；`indexedDB` 只出现在 `src/storage/db.ts`。

## 3. 存储规格（抄自设计文档 §9，落到实处）

**库名** `poker-trainer`，**版本** 1。

**`hands`** — 主键 `id`（= `HandRecord.id`）
值：`{ record: HandRecord, view: HandView, disputed: boolean }`
索引：`timestamp`、`worstEvLoss`、`heroPosition`、`mistakeTags`（multiEntry）

> 规格写的是 `{ record, analysis }`。这里存 `view` 而不是 `analysis`，理由见 §0。
> `disputed` 提到顶层而不是塞进 view：它是用户对这一手的**标注**，不是分析
> 结果的一部分，重跑分析时不该被覆盖掉。

**`stats`** — 单条聚合文档，主键固定 `'global'`
每手结束时增量更新。内容见任务 3。

**迁移**：`schemaVersion` 随值一起存。`onupgradeneeded` 只负责建 store 与
索引；值层面的迁移在读出来之后做（读到旧版本就现场升级或丢弃并标记需重跑），
不在 `onupgradeneeded` 里遍历数据——那个事务里做重活会卡住整个打开流程。

## 3.5 实测体积（Task 4 浏览器验收）

真实写入三手后直接读库量的：

| | 字节 |
|---|---|
| `view` | 2,655 |
| `record` | 1,907 |
| 合计/手 | **≈ 4.5 KB** |

规格 §9 估的是「单手约 1–2 KB，10000 手约 15 MB」。**实测是估值的两到三倍，
10000 手约 45 MB。** 如实记下来，不改规格也不假装对上了：

- 45 MB 仍在移动端 IndexedDB 配额内（通常几百 MB 起），不构成阻塞。
- 它与"带着范围表落库"那条路（10000 手 400 MB）差一个数量级，砍范围这个
  决定仍然是对的。
- 大头是 `view` 里每个决策点的六个候选与解释文案。真要压，第一刀应该切
  候选里那三个可选字段（`foldEquity` / `equityWhenCalled` / `impliedOdds`，
  界面从不渲染），但那是 ③-D 观察到配额压力之后再做的事，不是现在。

## 4. 不在本期

- 漏洞报表（§10.5）与设置页（§10.6）是 ③-D
- 会话续跑（刷新后接着打同一手）：spec 没要求，且它要持久化 `GameState`
  而不是 `HandRecord`，是另一套东西
- 候选动作名的中文化（③-B 留下的已知边界）：与本期无关，别顺手改
