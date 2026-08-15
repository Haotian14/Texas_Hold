# 牌桌视觉改版与音效 设计文档

日期：2026-08-15
基线：`master@3123126`（③-A 已合入，609 测试通过 / 3 如实跳过）
上游文档：`docs/superpowers/specs/2026-08-11-poker-trainer-03a-table-ui-design.md`

## 1. 目标

③-A 交付了一个能完整玩的牌桌，但它长得很朴素：整屏纯色没有牌桌形状、座位信息 11px、下注额是裸数字、没有任何动效、没有声音。

本次只做两件事：

1. **把牌桌做好看** —— 不改布局、不改交互流程、不改任何文案
2. **加下注筹码等音效**

### 非目标（明确不做）

- 不做玩家头像
- 不做赢池后筹码飞回赢家
- 不做逐张发底牌的动画（只有「开局发牌」一次音效）
- 不做主题切换、音量滑杆、设置面板（③-D 的范围）
- 不改用 canvas / WebGL
- 不动座位弧形排布、动作条结构、加注面板交互
- 不碰 `src/core/` `src/ai/` `src/review/` `src/session/` 的任何生产代码

## 2. 视觉方向（已确认的决定）

四项决定都是在浏览器里看着真实渲染的对比做的，不是文字描述：

| 项 | 选定 | 理由 |
|---|---|---|
| 整体风格 | **B · 现代深色** | 近黑底、低饱和毡面、一条细边光；琥珀色**只**给底池和「正在行动的人」。这是训练器，眼睛整局都在读数字，经典赌场风格的木纹与高光会持续和数字抢注意力 |
| 牌面 | **c3 · 极简** | 点数占满，花色缩到右上角 |
| 下注筹码 | **k1 · 按面额拆分的筹码堆** | 一眼看出注有多重，不必读数字 |
| 动效 | **m2 · 适中** | 有牌桌节奏但不弹不晃；全部可用 CSS 实现，不引动画库 |
| 目标视口 | **桌面优先，限宽居中** | 手机上仍满屏 |

**c3 的一处调整**：demo 里角上的花色符号偏小，实现时要做得略大，让形状本身可辨——不必纯靠颜色区分花色。这是刻意的可达性让步，不影响 c3 的观感。

## 3. 架构与边界

### 3.1 不可动摇的约束（继承自 ③-A，由架构守卫测试强制）

- **`src/session/` 不得导入 React、不得出现 `setTimeout` / `setInterval` / `document` / `window`。音频绝不进 session 层。** 前三期测试的说服力全部建立在「这一层能在 node 里完整驱动」之上
- `src/ui/` 不得从 `src/core/gameEngine`、`src/ai/decide`、`src/ai/selfPlayAi` 取**值**（`import type` 不限）
- **实额（20 / 40 / 4000）只存在于 `src/ui/format.ts` 一个文件里**，`CHIPS_PER_BB = 40`
- 金额比较一律用 `src/core/chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁止裸 `===` 和 `>`
- 常量取自 `src/core/types.ts`，不得重新定义
- npm registry 保持 `https://registry.npmmirror.com/`

### 3.2 新增架构守卫

在 `src/session/architecture.test.ts` 的跨层纯度守卫里追加一条：`src/session/` 禁止出现 `AudioContext` / `webkitAudioContext` / `new Audio` / `HTMLAudioElement`。与已有的「禁浏览器全局」同族。

### 3.3 文件清单

**新增**

| 文件 | 职责 |
|---|---|
| `src/ui/sound.ts` | 音效模块：AudioContext 生命周期、buffer 预加载、`play(name)`、静音开关；含纯函数 `soundFor()` |
| `src/ui/sound.test.ts` | `soundFor()` 的单测 |
| `src/ui/components/Chips.tsx` | 渲染面额筹码堆（无逻辑，逻辑在 `format.ts`） |
| `public/sounds/*.mp3` | 八个音效文件 |
| `public/sounds/CREDITS.md` | 每个文件的来源 URL 与许可 |

**修改**

| 文件 | 改什么 |
|---|---|
| `src/ui/format.ts` | 新增 `CHIP_DENOMINATIONS` 与 `chipDenominations(bb)` |
| `src/ui/format.test.ts` | 新增 `chipDenominations` 的单测 |
| `src/ui/components/Card.tsx` | c3 牌面 |
| `src/ui/components/Seat.tsx` | 下注额改筹码堆、行动中描边 |
| `src/ui/components/Pot.tsx` | 底池样式与动效钩子 |
| `src/ui/components/HeroHand.tsx` | 牌面尺寸与筹码堆 |
| `src/ui/components/Board.tsx` | 公共牌逐张落下的 stagger |
| `src/ui/components/Table.tsx` | 牌桌容器（椭圆毡面） |
| `src/ui/components/TopBar.tsx` | 静音按钮 |
| `src/ui/App.tsx` | 音效触发 effect |
| `src/ui/styles/app.css` | 主要改动集中在这里 |
| `src/session/architecture.test.ts` | 新增音频守卫 |

## 4. 筹码面额拆分

放在 `src/ui/format.ts`，因为面额本身就是**实额**概念，而实额只允许存在于这一个文件。

```ts
/** 实额面额，从大到小。20 是最小下注单位（半个大盲） */
export const CHIP_DENOMINATIONS = [1000, 500, 100, 20] as const;

/** 一堆筹码最多画几枚；超出部分不画，金额数字才是权威 */
export const MAX_CHIPS_DRAWN = 5;

/** BB 金额 → 从大到小的面额数组（实额）。贪心拆分，最多 MAX_CHIPS_DRAWN 枚 */
export function chipDenominations(bb: number): number[];
```

规则：

1. 先按 `chips()` 同样的方式取整到实额：`Math.round(bb * CHIPS_PER_BB)`
2. 从最大面额开始贪心，每次取不超过剩余额的最大面额
3. 循环在两种情况下结束，两种都会留下**不再表示**的余额——筹码堆是示意，旁边的数字才是权威：
   - 已经画满 `MAX_CHIPS_DRAWN` 枚
   - 剩余额小于最小面额（20），任何面额都放不下
4. 取整后为 0 返回空数组（调用方不画筹码）
5. 负数（理论上不会传入下注额）按绝对值处理，返回值不带符号

**筹码配色**（与 demo 一致）：1000 黑 `#1a1c20` / 500 绿 `#2a7a4a` / 100 红 `#b5342a` / 20 灰蓝 `#3f4c57`。

**测试用例**（`format.test.ts`）：
- `chipDenominations(0.5)` → `[20]`（小盲）
- `chipDenominations(1)` → `[20, 20]`（大盲，40 筹码）
- `chipDenominations(2)` → `[20, 20, 20, 20]`（80 筹码）
- `chipDenominations(100)` → `[1000, 1000, 1000, 1000]`（4000 筹码，恰好 4 枚）
- 需要超过 5 枚的金额 → 长度恰为 `MAX_CHIPS_DRAWN`
- `chipDenominations(0)` → `[]`
- `chipDenominations(0.01)` → `[]`（取整后为 0 筹码）
- 非整除余数（如 38.25 BB = 1530 筹码）→ `[1000, 500, 20]`，余 10 筹码不表示

## 5. 音效

### 5.1 清单与映射

| 名称 | 触发 |
|---|---|
| `chip-light` | `bet` / `raise` / `call`，且额度 < 半池 |
| `chip-heavy` | `bet` / `raise` / `call`，且额度 ≥ 半池 |
| `deal-card` | 新一手开局（每手一次，不是每张） |
| `board-flip` | 翻牌 / 转牌 / 河牌 |
| `fold` | 弃牌 |
| `check` | 过牌 |
| `pot-win` | 手牌结束且 hero 赢下底池 |
| `allin` | 全下 |

### 5.2 纯映射函数

```ts
export type SoundName =
  | 'chip-light' | 'chip-heavy' | 'deal-card' | 'board-flip'
  | 'fold' | 'check' | 'pot-win' | 'allin';

/** 动作 → 音效。amount 与 pot 都是 BB */
export function soundFor(type: ActionType, amount: number, pot: number): SoundName;
```

`ActionType` 来自 `src/core/types`（`Seat.tsx` 已有先例），**不在** `src/ui/` 的禁止取值清单里，正常 `import type` 即可。`chipsGreater` 来自 `src/core/chips`，同样不在禁止清单内。

**用穷尽 switch，不返回 `null`。** 六个动作类型每个都有对应音效，没有「无声」这一档；将来 `ActionType` 若新增成员，穷尽 switch 会让 TypeScript **编译失败**，这比静默返回 `null` 少播一个音效要好——后者要等人在浏览器里发现。「不播声音」的场景（如开局那一刻没有动作）由调用方的守卫处理，不由本函数表达。

- `fold` → `'fold'`，`check` → `'check'`，`allin` → `'allin'`
- `bet` / `raise` / `call` → 以**相对底池**分界：`amount ≥ pot / 2` 为 `'chip-heavy'`，否则 `'chip-light'`。同样 80 筹码，在 140 底池里是大注、在 4,000 底池里是零头，绝对金额分不出这个差别
- 比较必须用 `chips.ts` 的 helper（`chipsGreater(halfPot, amount)` 为真表示 `amount < halfPot`，即轻），禁止裸 `>=`
- `pot ≤ 0` 在真实牌局中不可达（盲注恒先入池），函数不特判，按同一式子处理

### 5.3 音频文件

- **来源**：[BigSoundBank](https://bigsoundbank.com/)，CC0 公有领域，无需账号、可商用、署名可选。备选 [Pixabay](https://pixabay.com/sound-effects/) 内容许可
- **位置**：`public/sounds/`——Vite 原样拷贝到 `dist/`，不进 JS bundle
- **体积**：每个 11–40 KB，八个合计约 200 KB
- **许可记录**：`public/sounds/CREDITS.md` 逐个记录文件名、来源 URL、许可、下载日期

**实施纪律**：每个文件下载前必须停下来向用户报清**文件名、来源 URL、大小**并取得授权。不得批量下载，不得从未经确认的来源下载。若目标站点不可用或找不到合适音效，**停下来报告**，不要擅自换源。

**预案**：若八个音效凑不齐，回退方案是用 Web Audio 合成缺失的那几个（振荡器 + 滤波噪声 + 包络）。`sound.ts` 的接口不变，只换实现。

### 5.4 浏览器自动播放策略

浏览器在用户第一次手势前不允许播放音频。做法：

- AudioContext **惰性创建**，在第一次用户点击时创建并 `resume()`
- 在此之前 `play()` 是无操作，不抛错、不打日志噪音
- 这是标准做法，不是 workaround

### 5.5 静音开关

- 顶栏一个按钮，图标切换
- 状态存 `localStorage`，键 `poker-trainer.muted`

**这是对 ③-A「无持久化」的一处有意例外**。那条规则针对的是**对局状态**（刷新即丢，③-C 解决）；一个每次刷新都要重按的静音键是纯粹的烦扰。读写包在 `try/catch` 里——隐私模式下 `localStorage` 可能抛错，抛了就退化成「本次会话内有效」。

### 5.6 触发机制

会话层是纯的，UI 只能从状态变化反推「刚发生了什么」。全部在 `App.tsx` 的 effect 里：

- **动作音**：以 `state.stepIndex` 为单调 key，变化时读 `state.lastAction` 播对应音效。用 `stepIndex` 而不是 `lastAction` 本身作依赖，是因为两个相邻动作可能完全相同（例如连续两个 `fold`），对象比较会漏播。**必须先判 `lastAction` 存在**——新一手开局时 `stepIndex` 也会变，但那一刻没有动作，不判会把上一手的残留动作重播一次
- **公共牌**：监听 `state.game.board.length` 变化
- **开局发牌**：监听 `state.handIndex` 变化。**第一手不会响**——那时用户还没做过任何手势，浏览器不允许播放。这是自动播放策略的必然结果，不特殊处理，也不要为它写 workaround
- **赢池 / 全下**：`phase` 变为 `handOver` 时读 `state.record.results` 判断 hero 是否赢

## 6. 动效（m2）

| 动效 | 参数 |
|---|---|
| 筹码滑进底池 | `translate` 到底池 + 淡出，200ms，`cubic-bezier(.4,0,.2,1)` |
| 底池轻涨 | `scale` 1 → 1.08 → 1，180ms |
| 公共牌逐张落下 | `translateY(-20px)` + 淡入 → 原位，220ms，每张错开 70ms |
| 赢池脉冲 | 底池琥珀色描边，2 次，共约 600ms |
| 行动中座位 | **静态**琥珀描边环，不做呼吸/闪烁——它会全程存在，动起来就是持续干扰 |

**`prefers-reduced-motion: reduce` 下全部退化**为纯淡入淡出，无位移、无缩放。一行媒体查询。

## 7. 桌面限宽

- `.app` 加最大宽度并水平居中，取 **760px**（5 个对手弧形排布 + 4 个动作按钮的舒适宽度）；实施时以人工验收为准可在 720–800 间微调
- 两侧露出的背景用比牌桌更深的色
- 手机上（视口窄于最大宽度）行为与现在完全一致，满屏

**必须守住的回归**：`.bottom` 保持**非** `position: fixed`，hero 手牌与动作条**零重叠**。这是 ③-A 最后一轮浏览器验证才修好的缺陷（固定定位的动作条压住 hero 自己的手牌 68px），布局改动最容易把它带回来。

## 8. 测试策略

### 8.1 自动化测试

新增单测**只覆盖两个纯函数**：

- `chipDenominations()` —— §4 列出的用例
- `soundFor()` —— 轻/重分界（恰好等于半池时为重）、各动作类型映射、未知类型返回 `null`

新增架构守卫：§3.2 的音频禁令。

### 8.2 不测的部分（如实承认）

组件渲染与真实音频播放没有自动化测试，沿用 ③-A 已在 README 写明的取舍（避免引入 jsdom 与脆弱的组件测试），靠 §9 的人工验收。

### 8.3 最强的回归网

**这是纯 UI 改动，`src/core/` `src/ai/` `src/review/` `src/session/` 的现有 609 个测试一个都不该变。** 任何一个变了都说明改动越界。这条比任何新增测试都有力，实施时每个任务结束都要核对。

## 9. 人工验收清单

完成时在浏览器里逐条走一遍：

1. 牌桌呈椭圆毡面且有细边光，不再是整屏纯色
2. 桌面宽视口下牌桌限宽居中，两侧为更深的背景
3. 手机尺寸视口下满屏、无横向滚动
4. **hero 手牌不被动作条遮挡**（③-A 修过的回归项）
5. c3 牌面：点数占满、右上角花色符号形状可辨（不必靠颜色也能认出）
6. 座位下注额显示为面额拆分的筹码堆 + 数字，颜色与面额对应
7. 大额下注的筹码堆不超过 5 枚，不撑破座位
8. 行动中的座位有静态琥珀描边，且只有一个座位有
9. 筹码滑进底池、底池轻涨、公共牌逐张落下、赢池脉冲——四个动效都能看到
10. 系统开启「减少动态效果」后，上述动效退化为淡入淡出
11. 页面加载后第一次点击之前，控制台没有 autoplay 相关报错
12. 八个音效各触发一次，声音与事件对得上
13. 小注与大注的筹码声明显不同
14. 静音按钮生效；刷新页面后静音状态保持
15. 连打 10 手，音效不重复触发也不漏触发（尤其连续两个相同动作）

## 10. 已知风险

1. **视觉大改可能让 ③-A 修过的遮挡缺陷回归** —— 由验收清单第 4 条守着
2. **音频文件依赖外部站点** —— 站点不可用时的预案见 §5.3
3. **`localStorage` 在隐私模式下可能抛错** —— 已用 `try/catch` 处理，退化为会话内有效
4. **c3 牌面对色觉的依赖高于 c1** —— 已知取舍，用户在读过提醒后仍选择 c3；用「加大角标花色符号」缓解，但不完全消除
5. **音效触发靠从状态变化反推** —— 若将来会话层新增不经 `stepIndex` 的转换，音效会漏；这是 UI 与 session 解耦的代价，`stepIndex` 单调递增是当前的保证

## 11. 对上游文档的影响

本次不修改 ③-A 的设计文档与实施计划。README 的「技术栈」与「已知边界」在实施末尾更新：加入音效与其许可来源、以及静音状态使用 `localStorage` 这一例外。
