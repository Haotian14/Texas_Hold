# 德州扑克模拟训练器 — 设计文档

日期：2026-08-06
状态：已确认

## 1. 目标

一个可在手机上运行的德州扑克模拟器，用于反复练习并在每手结束后复盘自己的失误。

核心价值不在"玩牌"，而在**告诉用户哪一步打错了、错在哪、亏了多少**，并通过长期统计暴露反复出现的漏洞。

## 2. 范围

### 本期做

- 6-max 现金局，盲注 0.5/1 BB 不递增，标准买入 100BB
  - **2026-08-11 修订（见 ③-A 设计文档 §4.4）**：原为「固定 100BB 等额起始筹码，每手重置」，现改为筹码跨手延续、破产后手动补 100BB 或 200BB，并记录买入账本。界面以实额显示（盲注 20/40、标准买入 4000），内部量纲仍为 BB。
  - 连带后果：边池分层自此进入产品路径（原先等额筹码使其不可达）；筹码深度会漂离范围表的 100BB 标定点，超过 150BB 的手牌打「复盘精度下降」标记
- 用户 + 5 个 AI 对手，用户位置每手轮转
- 完整德扑规则：翻前/翻牌/转牌/河牌四条街、边池、all-in、最小加注规则
- AI 对手：性格原型池（可在设置切换为全 GTO 平衡）
- 复盘引擎：启发式 + 蒙特卡洛 EV 估算，逐决策点评分
- 每手结束弹出复盘卡片
- 手牌历史（本地持久化，可按 EV loss 排序筛选）
- 漏洞统计报表
- PWA：可离线运行，可添加到主屏幕

### 本期明确不做

- 锦标赛 / MTT / ICM / 盲注递增 / push-fold 图表
- 单挑（HU）与 9 人桌
- 真实 CFR 求解器
- 联网对战、账号系统、任何服务端
- LLM 文字点评
- 多桌、快速扑克（Zoom）等变体

不做的理由：本期先把"6-max 现金局 + 可信复盘"这一条路径做扎实。以上每一项都是独立的策略体系或独立的工程量，属于后续迭代。

## 3. 技术栈与部署

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict） | 牌局状态类型复杂，类型系统能挡掉大量低级错误 |
| 构建 | Vite | 快，PWA 插件成熟 |
| UI | React | 牌桌状态多，手写 DOM 不现实 |
| 状态 | React 内置（useReducer + Context） | 规模不需要引入 Redux 等 |
| 测试 | Vitest + fast-check | fast-check 提供属性测试 |
| 存储 | IndexedDB（经 idb 封装） | 结构化查询 + 索引，localStorage 容量不够 |
| 部署 | 静态站点（GitHub Pages 等） | 零后端、零成本 |

**零后端。所有逻辑运行在浏览器内，所有数据存在设备本地，不上传任何内容。**

## 4. 架构

### 4.1 分层原则

```
   ┌─────────────────────────────────────────┐
   │  core/   纯逻辑，零 UI 依赖，可完整单测     │
   │  牌 · 牌型评估 · 胜率 · 状态机 · 范围表     │
   └───────────────┬─────────────────────────┘
                   │ 每手结束产出 HandRecord
        ┌──────────┴──────────┐
        ↓                     ↓
   ┌─────────┐          ┌──────────────┐
   │  ai/    │          │  review/     │
   │ 对手决策 │          │ 复盘分析引擎  │
   └─────────┘          └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │  store/      │
                        │ IndexedDB    │
                        └──────────────┘
                    以上之上才是 ui/ (React)
```

**硬约束（实现时必须守住）：**

1. `core/` 内不得出现 `import React` 或任何 DOM API
2. `core/` 内不得直接调用 `Math.random()`，随机数一律由外部注入的 seeded RNG 提供
3. `review/` 只读取 `HandRecord`，不访问运行中的对局状态、不访问 UI 状态

### 4.3 Situation：AI 与复盘引擎的共用接口

对局中的 AI 和事后的复盘引擎需要回答同一个问题——"这个局面下各动作的期望是多少"。为避免两套实现产生分歧，把这个能力抽成 `core/evEstimate.ts`，其输入是一个与来源无关的局面快照：

```ts
interface Situation {
  heroCards: [Card, Card];
  board: Card[];
  pot: number;
  toCall: number;
  heroStack: number;
  opponents: { seat: number; stack: number; range: RangeSet; personaId: string }[];
  street: Street;
  heroIsPreflopAggressor: boolean;
}
```

`ai/decide.ts` 从运行中的对局状态构造 `Situation`；`review/analyzeHand.ts` 从 `HandRecord` 重放构造 `Situation`。两者走同一条估算路径，AI 的行为与复盘的判定标准天然一致。

因此 `evEstimate.ts` 与 `opponentRange.ts` 归属 `core/` 而非 `review/`——它们被双方共用，且不依赖 `HandRecord`。

### 4.2 目录结构

```
src/
  core/
    cards.ts          牌的表示、牌堆、seeded 洗牌
    rng.ts            可复现的伪随机数发生器
    handEval.ts       7 选 5 最佳牌型评估（快速实现）
    handEvalSlow.ts   穷举参考实现（仅测试用）
    equity.ts         蒙特卡洛胜率 + 精确穷举
    gameEngine.ts     对局状态机（reducer）
    pots.ts           主池/边池计算
    types.ts          共享类型定义
    situation.ts      Situation 快照类型与构造
    opponentRange.ts  对手范围建模与逐街收窄
    evEstimate.ts     候选动作 EV 估算
    ranges/
      index.ts        范围表加载与查询
      data/*.json     内置 GTO 翻前范围表
  ai/
    personas.ts       性格原型参数
    decide.ts         AI 决策函数
  review/
    analyzeHand.ts    入口：HandRecord -> HandAnalysis
    rules/
      preflop.ts
      postflop.ts
    taxonomy.ts       错误分类定义
  store/
    db.ts             IndexedDB schema 与迁移
    hands.ts          手牌读写
    stats.ts          聚合统计
    exportImport.ts   JSON 导出/导入
  ui/
    Table/            牌桌
    ReviewCard/       复盘卡片
    History/          历史列表
    Stats/            漏洞报表
    Settings/         设置
```

## 5. 数据模型

```ts
type Suit = 's' | 'h' | 'd' | 'c';
type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;   // 14 = A
type Card = { rank: Rank; suit: Suit };

type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
type Street   = 'preflop' | 'flop' | 'turn' | 'river';
type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

interface Action {
  seat: number;
  street: Street;
  type: ActionType;
  amount: number;        // 该动作投入的筹码（BB 为单位），fold/check 为 0
  potBefore: number;     // 动作前底池
  toCall: number;        // 动作前需跟注额
  stackBefore: number;
}

/** 一手牌的完整自包含记录。复盘引擎的唯一输入。 */
interface HandRecord {
  id: string;
  schemaVersion: number;
  timestamp: number;
  seed: string;                    // 可完整复现本手牌
  heroSeat: number;
  seats: {
    seat: number;
    position: Position;
    personaId: string | 'hero';
    startingStack: number;
    holeCards: [Card, Card];       // 全部玩家的底牌，仅复盘可见
  }[];
  board: Card[];                   // 0..5 张，按发出顺序
  actions: Action[];               // 全局有序
  results: { seat: number; netBB: number; showdown: boolean }[];
}
```

复盘产物：

```ts
type Severity = 'ok' | 'minor' | 'notable' | 'severe';

interface DecisionAnalysis {
  actionIndex: number;             // 指向 HandRecord.actions
  street: Street;
  potBefore: number;
  toCall: number;
  heroEquity: number;              // 0..1，对当时对手范围
  requiredEquity: number | null;   // 跟注所需最低胜率，无需跟注时为 null
  candidates: {                    // 各候选动作的估算 EV（BB）
    label: string;                 // 'fold' | 'call' | 'bet 1/2' | ...
    ev: number;
    isRecommended: boolean;
    isChosen: boolean;
  }[];
  evLoss: number;                  // >= 0，单位 BB
  severity: Severity;
  mistakeTag: MistakeTag | null;
  explanation: string;             // 面向用户的一句话解释
}

interface HandAnalysis {
  handId: string;
  analyzerVersion: number;         // 规则改动后据此判断是否需重跑
  netBB: number;
  decisions: DecisionAnalysis[];
  worstEvLoss: number;
  disputed: boolean;               // 用户标记"我不认同"
}
```

`analyzerVersion` 使得规则升级后可批量重跑历史手牌。

## 6. core 模块规格

### 6.1 rng.ts

实现一个可 seed 的 PRNG（xoshiro128** 或同类）。暴露 `nextInt(n)`、`nextFloat()`。洗牌用 Fisher-Yates。

任何需要随机的地方都接收 RNG 实例作为参数，绝不使用全局随机源。这是复现能力的基础。

### 6.2 handEval.ts

输入 7 张牌，输出一个可比较的整数分值（越大越强），以及牌型分类（用于展示"两对"等文案）。

采用位运算 + 查表实现。同时在 `handEvalSlow.ts` 提供穷举 21 组合的显然正确实现，仅供测试对拍。

### 6.3 equity.ts

- `equityMonteCarlo(heroCards, board, opponentRanges, iterations)` — 默认 2000 次
- `equityExact(heroCards, board, opponentRanges)` — 仅在剩余未知牌较少（转牌/河牌）时可用

多个对手时按各自范围独立采样，跳过与已知牌冲突的组合。

### 6.4 gameEngine.ts

纯函数 reducer：`(state, action) -> state`。

必须正确实现的规则：
- 盲注下注、翻前从 UTG 开始行动、翻后从 SB 起顺时针
- 最小加注额 = 上一次加注的增量
- **all-in 金额不足最小加注时，不重开下注轮**（已行动且未面对合法加注的玩家不再获得行动权）
- 下注轮在"所有未弃牌玩家投入相等且都已行动过"时结束
- 主池/边池按 all-in 金额分层计算（`pots.ts`）
- 摊牌时逐池独立比牌，平分时余数按位置顺序分配

每次状态转移后断言不变量：`Σ玩家筹码 + Σ底池 ≡ 常数`。

### 6.5 ranges/

内置 6-max 100BB 翻前范围表，JSON 格式：

```jsonc
{
  "CO_vs_none": {                  // CO 位首次进池
    "AKo": { "raise": 1.0, "call": 0.0, "fold": 0.0 },
    "KJo": { "raise": 0.62, "call": 0.0, "fold": 0.38 }
  },
  "BTN_vs_CO_raise": {
    "KJo": { "3bet": 0.35, "call": 0.45, "fold": 0.20 }
  }
}
```

手牌用标准缩写（`AKs`/`AKo`/`77`，169 种组合）。

覆盖的节点：各位置 RFI、各位置面对单一开池（call/3bet/fold）、面对 3bet（call/4bet/fold）。更深的节点（4bet 后、多人底池的复杂节点）不查表，回落到翻后同一套 EV 估算逻辑并降低置信度。

数据来源为公开的 6-max 100BB GTO 近似范围表整理。初版数据以纯策略为主（频率取 0 或 1），仅在公认的边界手牌上使用混合频率——这样人工录入 169×节点数 的数据量可控，且不影响判定逻辑（§8.2 的 0.15 阈值对纯策略同样适用）。后续可替换为更精细的混合频率数据，**查询接口与 JSON 格式保持不变**。

范围数据需有一致性测试：每个节点各动作频率之和必须为 1.0（容差 0.001），且 169 种手牌组合无遗漏、无拼写错误。

## 7. AI 模块规格

### 7.1 性格原型

```ts
interface Persona {
  id: string;
  name: string;              // "紧凶" / "松凶" / "跟注站" / "岩石" / "疯子"
  rangeWidthMul: number;     // 相对 GTO 范围的宽窄倍率
  aggression: number;        // 主动下注/加注倾向
  bluffFreq: number;         // 诈唬频率
  callThresholdMul: number;  // 跟注所需胜率的倍率，<1 表示跟得松
  cbetFreq: number;
}
```

预置 5–6 个原型，每手随机分配到各座位（座位与原型的绑定在一手内保持不变）。

设置中可切换为"全 GTO 模式"：所有 AI 使用范围表 + 平衡的翻后策略。

### 7.2 决策

AI 从当前对局状态构造 `Situation`（§4.3），调用 `core/evEstimate.ts` 得到各动作 EV，再按 persona 参数扰动阈值后选择动作。这样 AI 与复盘引擎共享同一套局面理解，行为一致且代码不重复。

AI 决策必须在 100ms 内返回（蒙特卡洛迭代数相应降低到 500），保证手机上不卡顿。

## 8. 复盘引擎规格

### 8.1 流程

遍历 `HandRecord.actions`，对每个 `seat === heroSeat` 的动作：

1. 重建当时局面（底池、待跟注额、剩余对手、各自范围）
2. 枚举候选动作
3. 估算每个候选动作的 EV
4. 取 EV 最高者为推荐，计算 `evLoss = EV(推荐) − EV(实际)`
5. 按 evLoss 定 severity，按局面特征打 mistakeTag，生成解释文案

### 8.2 翻前判定

查范围表得到该手牌在该节点的动作频率分布。

- 用户动作频率 **≥ 0.15** → `severity: 'ok'`，evLoss 记 0
- 否则判为失误

阈值 0.15 的理由：均衡策略本身是混合的，不能因为用户这次选了低频但合法的动作就判错。

**范围表只存频率，不存 EV**（公开范围数据普遍只给频率）。判为失误后，evLoss 通过 §8.3 的同一套 EV 估算在翻前节点上计算：把对手范围设为范围表给出的各自防守范围，用蒙特卡洛算 `W`、用范围表算 `Fe`，得出各候选动作的 EV，取最优者与用户动作之差。

这样翻前和翻后共用一条估算路径，`evLoss` 的量纲一致，漏洞报表里翻前与翻后的损失可以直接相加比较。频率表只用于**判定是否算失误**，不用于计算损失大小。

### 8.3 翻后 EV 估算

以"此刻起"为基准，已投入筹码视为沉没成本：

```
EV(弃牌)   = 0

EV(跟注)   = W × (底池 + 跟注额) − 跟注额

EV(下注 B) = Fe × 底池
           + (1 − Fe) × [ W' × (底池 + 2B) − B ]
```

- `W` = 对当前对手范围的蒙特卡洛胜率
- `Fe` = 弃牌率，= 对手范围中面对尺度 B 无法继续的组合占比
- `W'` = **对手跟注后**的胜率，对"对手继续范围"单独计算。必须单独算，否则会系统性高估诈唬价值。

候选下注尺度固定为：1/3 池、1/2 池、2/3 池、满池、all-in。不做连续尺度搜索（收益低、开销大）。

跟注所需最低胜率：`requiredEquity = 跟注额 / (底池 + 跟注额)`。

### 8.4 隐含赔率修正

纯即时 EV 会低估听牌和小口袋对的价值。对以下情形加修正项：

- 手牌为同花听牌 / 开口顺听 / 口袋对（有击中暗三条潜力）
- 且非河牌圈
- 且对手剩余筹码足够支付未来街

修正额按 `对手有效剩余筹码 × 击中后预期获得比例 × 击中概率` 估算，比例参数按对手 persona 的跟注松紧调整。此项为近似，会在文档与 UI 中标注。

### 8.5 对手范围建模

- 起手 = 该位置的开池/防守范围
- 每个对手动作后逐街收窄：3bet → 保留 3bet 范围；check-raise → 保留强成手 + 强听牌；跟注 → 剔除应加注的最强部分与应弃牌的最弱部分
- GTO 模式用范围表收窄；原型模式按 persona 参数调整收窄幅度（跟注站几乎不收窄）

**复盘时不得使用对手的实际底牌来评判用户决策**——那是结果论。对手底牌仅在展示层显示，用于事后解释。

### 8.6 严重度阈值

| evLoss (BB) | severity | UI |
|---|---|---|
| `[0, 0.2)` | `ok` | ✅ |
| `[0.2, 1)` | `minor` | 🟡 |
| `[1, 3)` | `notable` | 🟠 |
| `[3, ∞)` | `severe` | 🔴 |

区间左闭右开。阈值集中定义在 `review/taxonomy.ts` 中，便于统一调整。

### 8.7 错误分类（MistakeTag）

翻前：
- `preflop_cold_call_too_wide` 冷跟太宽
- `preflop_missed_3bet` 该 3bet 没 3bet
- `preflop_over_aggressive` 翻前过度激进
- `preflop_sb_limp` 小盲跛入
- `preflop_open_too_wide` 开池范围太宽
- `preflop_fold_too_tight` 弃得太紧

翻后：
- `missed_cbet` 该 c-bet 没 c-bet
- `missed_value_bet` 错过价值下注
- `chasing_bad_odds` 赔率不足追听牌
- `call_too_light_vs_raise` 面对加注跟太松
- `should_have_folded` 该弃牌没弃
- `bet_size_too_small` 下注尺度过小
- `bet_size_too_large` 下注尺度过大
- `ineffective_bluff` 无效诈唬（对手弃牌率不足）
- `over_bluffing` 诈唬过多

每个 tag 附带一段解释模板，填入当时的底池、胜率、所需胜率等数值生成具体文案。

## 9. 存储规格

IndexedDB，库名 `poker-trainer`，两个 object store：

**`hands`**
- 主键：`id`
- 值：`{ record: HandRecord, analysis: HandAnalysis }`
- 索引：`timestamp`、`worstEvLoss`、`heroPosition`、`mistakeTags`（multiEntry）

**`stats`**
- 单条聚合文档，每手结束时增量更新
- 内容：总手数、累计净盈亏、BB/100、各 mistakeTag 的次数与累计 evLoss、分街 evLoss、分位置盈亏、最近 100 手滚动窗口

分开存 `record` 与 `analysis` 的原因：规则升级后可对全部历史手牌批量重跑分析，历史数据随之变准。

容量估算：单手约 1–2 KB，10000 手约 15 MB，在移动端配额内。

Schema 带 `schemaVersion`，通过 IndexedDB `onupgradeneeded` 做迁移。

提供 JSON 导出/导入，用于换设备迁移与问题反馈。

## 10. UI 规格

### 10.1 页面

1. **牌桌**（主页面）
2. **复盘卡片**（手牌结束后从底部滑出的 sheet）
3. **历史**
4. **漏洞报表**
5. **设置**

### 10.2 牌桌布局（竖屏）

- 顶栏：设置入口 / 手数 / 累计盈亏
- 上半部弧形排布 5 个 AI 座位，显示筹码、本街投入、动作气泡
- 中部：底池数额 + 公共牌（居中最大）
- 下部：用户底牌（比公共牌大一号）+ 位置 + 筹码
- 底部固定动作条：弃牌 / 过牌·跟注 / 下注·加注，按钮位于拇指可达区
- 加注尺度：1/3、1/2、2/3、池、all-in 快捷键 + 滑块

交互细节：
- 动作条固定定位，不随内容滚动
- all-in 需二次确认，其他动作不确认
- AI 思考延迟 300–600ms，设置中可切"极速模式"（0ms）
- 轮到用户时触发 Vibration API
- 四色牌（♠黑 ♥红 ♦蓝 ♣绿）
- 遵守 `safe-area-inset`，适配刘海屏与手势条

### 10.3 复盘卡片

- 顶部：本手净盈亏 + 整体评级
- 街道时间线：每街列出用户动作与 severity 色标
- 点开某决策点展开：底池、待跟注、用户胜率、所需胜率、各候选动作 EV 条形图、推荐动作、mistakeTag、解释文案
- **「我不认同这个判定」按钮** — 置 `disputed: true`。这些手牌可在历史页单独筛出，用于后续改进规则
- 底部：对手底牌（标注"仅复盘可见"）
- 主按钮：下一手

### 10.4 历史页

列表，默认按 `worstEvLoss` 倒序。可按位置、街道、mistakeTag、是否 disputed 筛选。点击打开同样的复盘卡片。

### 10.5 漏洞报表

- 顶部：BB/100。统计窗口默认为**最近 200 手**，可切换为最近 500 手 / 最近 1000 手 / 全部
- **漏洞排行榜**：按累计 evLoss 排序（不是按次数——3 次大错比 30 次小错更值得改），显示次数、累计损失、条形图
- 分街 evLoss 分布
- 分位置盈亏
- 趋势：最近 100 手 vs 之前 100 手的 evLoss/手 对比

### 10.6 设置

AI 模式（原型池 / 全 GTO）、速度（正常 / 极速）、震动开关、复盘卡片自动弹出开关、数据导出/导入、重置数据。

## 11. 测试策略

`core/` 采用 TDD：先写测试再写实现。

**1. 牌型评估 — 对拍测试**
随机生成 10 万组 7 张牌，断言 `handEval` 与 `handEvalSlow` 结果一致（含相等判定）。

**2. 游戏引擎 — 不变量 + 属性测试**
- 核心不变量：任意时刻 `Σ玩家筹码 + Σ底池 ≡ 常数`，每次状态转移后断言
- 属性测试：随机动作序列跑 10000 手完整牌局，断言不变量从不破、每手都能正常结算、无死锁
- 手写边池用例：三人不同筹码全下、短筹码 all-in 后剩余玩家继续加注、**all-in 不足最小加注时不重开下注轮**、平分底池余数分配

**3. 胜率 — 对拍精确解**
- 转牌/河牌圈用穷举结果作为标准答案，验证蒙特卡洛 2000 次采样误差 < 1.5%
- 已知值回归：`AA vs KK` 翻前 ≈ 81.9%、`AKs vs 22` ≈ 46.2%

**4. 复盘引擎 — 金标准场景库**

手工构造约 40 个答案无争议的场景，断言必须产出指定 mistakeTag。示例：

| 局面 | 期望 tag |
|---|---|
| BB 拿 72o 面对 BTN 开池，用户 3bet | `preflop_over_aggressive` |
| 底池 100，跟 50（需 33%），用户仅裸同花听牌（≈18%） | `chasing_bad_odds` |
| 河牌用户拿坚果同花，对手为跟注站，用户过牌 | `missed_value_bet` |
| 用户在 SB 跛入 | `preflop_sb_limp` |
| 干燥面、单挑底池、用户为翻前加注者，用户过牌 | `missed_cbet` |

这组用例是规则调优的回归网：任何参数改动若导致明显错误被判为正确，测试立即失败。

**5. UI 层**
只测关键交互：动作按钮的启用/禁用状态、加注滑块的上下界合法性。不做全面 UI 测试。

## 12. 已知局限（需在 UI 中向用户明示）

1. **单步近似，非博弈树求解**。复盘引擎在每个决策点估算即时期望，不展开未来街的所有分支。它能可靠指出明显错误，但不应被当作 solver 的精确输出。
2. **隐含赔率仅为估算**。§8.4 的修正项是启发式的，对深筹码投机牌的判定可能偏严。
3. **不评估策略平衡性**。引擎逐手判断，不会指出"你整体诈唬频率偏高"这类频率层面的问题；这类问题只能从漏洞报表侧面观察。
4. **多人底池精度下降**。对手数量增加时范围建模误差累积，多人底池的判定置信度低于单挑底池。

对应措施：复盘卡片明确标注"近似估算"，evLoss 以适当精度显示而非伪精确的小数点后两位；提供"我不认同这个判定"通道。

## 13. 后续可能的扩展（不在本期）

- 按需深度求解：对单手牌手动触发小规模 CFR
- MTT 模式：盲注递增、push-fold 图表、ICM
- 更精细的范围表数据
- 真实手牌历史导入（从线上平台的 hand history 文件）
