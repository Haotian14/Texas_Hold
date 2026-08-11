# ③-A 牌桌与对局会话 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在浏览器里能真实打完一手又一手德州扑克——六人桌、20/40 盲注、4000 后手、破产可补码，且每一步的合法性与筹码账目都由纯 TS 层保证。

**Architecture:** 三层。`src/session/` 是纯 TypeScript 的对局编排，把已完成的 `core` 引擎与 `ai` 决策串成一个**可在 hero 回合挂起**的循环——本质是 `src/ai/selfPlayAi.ts` 的 `playAiHand` 的可中断版本。`src/ui/` 是 React 渲染层，只订阅状态、渲染、把点击翻译成动作。两层之间由 `HandSessionState` 这一个不可变对象连接，且有结构性测试守着边界。

**Tech Stack:** TypeScript（strict）· Vite · React · Vitest · fast-check · Node 24。新增目录 `src/session/`（纯 TS）与 `src/ui/`（React）。

**Spec:** `docs/superpowers/specs/2026-08-11-poker-trainer-03a-table-ui-design.md`

## Global Constraints

- TypeScript strict。`src/core/`、`src/ai/`、`src/review/`、`src/session/` 内禁止 `Math.random()`。
- 依赖方向：`src/session/` → `src/core/` + `src/ai/`；`src/ui/` → `src/session/`。**`src/session/` 不得导入 `react` / `react-dom`，不得出现 `setTimeout` / `document` / `window`。`src/ui/` 不得从 `src/core/gameEngine`、`src/ai/decide`、`src/ai/selfPlayAi` 取值**（`import type` 不受限）。Task 4 与 Task 8 各加一条结构性守卫测试。
- 金额比较一律用 `src/core/chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁止裸 `===` 和 `>`。
- 所有随机性来自字符串 seed。**不在会话状态里存 `Rng` 对象**，每一步用 `createRng(派生字符串)` 现造，使 `stepAi` / `applyHero` 幂等（spec §3.3）。
- **内部量纲一律是 BB。** 实额（20/40/4000）只存在于 `src/ui/format.ts` 一个文件里。`CHIPS_PER_BB = 40`。EV 损失与复盘数字例外，保持 BB。
- 常量取自 `src/core/types.ts`：`SMALL_BLIND = 0.5`、`BIG_BLIND = 1`、`STARTING_STACK = 100`、`SEAT_COUNT = 6`、`HERO_SEAT = 0`。**不得在新代码里重新定义这些数字。**
- `REBUY_OPTIONS = [100, 200]`（BB），语义是**补码后的目标筹码额**，不是新增额。账本记录的 `amount` 是实际添进桌上的钱（`目标额 − 当前筹码`）。这条区别是账本恒等式成立的关键，见 Task 3。
- 深筹码阈值 `DEEP_STACK_BB = 150`。
- **npm registry 必须保持 `https://registry.npmmirror.com/`。** 用 `npm install <pkg>` 增量添加，**严禁**删除 `node_modules` 或 `package-lock.json` 后重装。任何使 lockfile 出现 `registry.npmjs.org` 的改动都要停下来报告，不得自行提交。
- 提交信息用中文，结尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 每个任务结束时 `npm test` 与 `npm run typecheck` 必须全绿才能提交。

## 文件结构

```
src/session/                 纯 TS，编排 core+ai，零 React
  ledger.ts                  买入账本：BuyIn / SessionLedger / 净盈亏
  actionBarModel.ts          GameState → 按钮启用态与加注滑块模型
  handSession.ts             会话状态与状态转换函数
  scriptedHero.ts            测试用脚本化玩家
  ledger.test.ts
  actionBarModel.test.ts
  handSession.test.ts
  architecture.test.ts       分层守卫（session 不碰 React，ui 不碰引擎）
  scriptedPlay.test.ts       ★ 验收关卡：200 手脚本化自对弈

src/ui/                      React 渲染层
  main.tsx                   入口
  App.tsx                    reducer + Context + AI 定时器 effect
  format.ts                  BB → 实额，唯一的换算点
  components/
    TopBar.tsx               手数 · 盈亏 · 买入 · 深筹码标记
    Board.tsx                公共牌
    Card.tsx                 单张牌（四色）
    Pot.tsx                  底池
    Seat.tsx                 单个 AI 座位
    Table.tsx                弧形座位排布 + Board + Pot
    HeroHand.tsx             hero 底牌 · 位置 · 筹码
    ActionBar.tsx            弃牌 / 过牌·跟注 / 下注·加注
    RaiseControl.tsx         快捷尺度 + 滑块
    SummaryBar.tsx           手牌结束的结算条
    RebuyPrompt.tsx          破产补码选择
  styles/
    app.css

index.html
vite.config.ts
```

拆分理由：`ledger.ts` 与 `actionBarModel.ts` 都是零依赖或单依赖的纯函数，能脱离会话独立测试；`handSession.ts` 是唯一持有对局状态的模块；`format.ts` 单独成文件，是为了让「实额」这个概念有一个可被结构性守卫盯住的唯一入口。

---

## Task 1: Vite + React 脚手架，构建绿色

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/ui/main.tsx`
- Create: `src/ui/styles/app.css`
- Create: `.gitignore` 追加 `dist`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `npm run dev` / `npm run build`；`src/ui/` 目录存在

- [ ] **Step 1: 确认 registry 是镜像源**

```bash
npm config get registry
```

期望输出：`https://registry.npmmirror.com/`

**若不是这个值，立刻停下来报告，不要继续安装。**

- [ ] **Step 2: 增量安装依赖**

```bash
npm install react react-dom
npm install -D vite @vitejs/plugin-react @types/react @types/react-dom
```

- [ ] **Step 3: 确认 lockfile 没有被改源**

```bash
grep -c "registry.npmjs.org" package-lock.json
```

期望输出：`0`

**若大于 0，立刻停下来报告，不要提交。**

- [ ] **Step 4: 写 vite.config.ts**

创建 `vite.config.ts`：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径，使构建产物可以放在静态托管的任意子路径下
// （③-D 上线时不必回头改这里）。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 5: 写 index.html**

创建 `index.html`（项目根目录）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no"
    />
    <meta name="theme-color" content="#0b3d2e" />
    <title>德州扑克模拟训练器</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/ui/main.tsx"></script>
  </body>
</html>
```

`viewport-fit=cover` 是 `safe-area-inset` 生效的前提，缺了它刘海屏上的内边距全部为 0。

- [ ] **Step 6: 写最小样式与入口**

创建 `src/ui/styles/app.css`：

```css
:root {
  --felt: #0b3d2e;
  --felt-light: #12513c;
  --text: #f2f5f3;
  --text-dim: #9bb0a6;
  --gold: #d8b45a;
  --danger: #c8503c;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-top: env(safe-area-inset-top, 0px);
}

* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--felt);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
```

创建 `src/ui/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <div style={{ padding: 16 }}>脚手架就绪</div>
  </StrictMode>,
);
```

**注意 `StrictMode` 是故意开着的。** 它会双调用 effect，正是 spec §3.3 那条「不在状态里存 Rng」的设计要防的东西——开着它才能在开发期暴露问题。

- [ ] **Step 7: 改 tsconfig.json**

把 `compilerOptions` 改成：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 8: 改 package.json 的 scripts**

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 9: 追加 .gitignore**

在 `.gitignore` 末尾加一行：

```
dist
```

- [ ] **Step 10: 验证构建与既有测试都绿**

```bash
npm run build
npm test
npm run typecheck
```

期望：`vite build` 输出 `dist/index.html` 与 `dist/assets/*`；`npm test` 仍是 534 个测试全绿（`3 skipped`）；typecheck 无输出。

**若既有测试因为 tsconfig 加了 DOM lib 而出现新报错，停下来报告——不要靠删 lib 绕过。**

- [ ] **Step 11: 提交**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/ui .gitignore
git commit -m "$(cat <<'EOF'
chore(ui): 接入 Vite + React 脚手架

base 用相对路径，使产物可放在静态托管的任意子路径下，③-D 上线时
不必回头改。StrictMode 故意开着——它的 effect 双调用正是会话层
「不存有状态 Rng」那条设计要防的东西，开着才能在开发期暴露问题。

依赖走 registry.npmmirror.com 增量安装，lockfile 未重新生成。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: actionBarModel.ts —— 合法动作到界面模型

**Files:**
- Create: `src/session/actionBarModel.ts`
- Test: `src/session/actionBarModel.test.ts`

**Interfaces:**
- Consumes: `legalActions(state)` / `currentPot(state)` / `round2` / `chipsGreater`（`src/core/gameEngine.ts`）、`HERO_SEAT`（`src/core/types.ts`）
- Produces:
  - `interface RaiseModel { min: number; max: number; presets: { label: string; amount: number }[] }`
  - `interface ActionBarModel { enabled: boolean; fold: boolean; passive: { type: 'check' } | { type: 'call'; amount: number } | null; raise: ({ type: 'bet' | 'raise' } & RaiseModel) | null; allin: { amount: number } | null }`
  - `function actionBarModel(state: GameState): ActionBarModel`

**设计约束（务必照做）：** 合法性的唯一权威是 `legalActions(state)`。本模块**不得**自己判断最小加注、加注权、不足额跟注这些规则——`gameEngine` 已经处理干净了，重写一遍就是制造一个会与引擎分歧的第二权威。本模块只做两件事：把 `legalActions` 的输出翻译成界面形状，以及算出快捷尺度的金额。

- [ ] **Step 1: 写失败的测试**

创建 `src/session/actionBarModel.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import { HERO_SEAT, SEAT_COUNT } from '../core/types';
import type { GameState } from '../core/types';
import { actionBarModel } from './actionBarModel';

/** 把牌局推进到指定座位行动为止，途中所有人都用 fold 以外的最省事动作 */
function advanceTo(state: GameState, seat: number): GameState {
  let s = state;
  let guard = 0;
  while (s.toAct !== seat) {
    if (++guard > 50) throw new Error('推进失败：目标座位一直没轮到');
    const legal = legalActions(s);
    const passive = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'call');
    if (!passive) throw new Error('没有过牌或跟注可选');
    s = applyAction(s, { type: passive.type });
  }
  return s;
}

describe('actionBarModel', () => {
  it('非 hero 回合时禁用', () => {
    // buttonSeat = 0 时 UTG 是座位 3，hero(0) 不是第一个行动的
    const s = startHand({ seed: 'abm-1', buttonSeat: 0 });
    expect(s.toAct).not.toBe(HERO_SEAT);
    expect(actionBarModel(s).enabled).toBe(false);
  });

  it('hero 回合时启用，且给出的动作集合与 legalActions 一一对应', () => {
    const s = advanceTo(startHand({ seed: 'abm-2', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    const legalTypes = new Set(legalActions(s).map(a => a.type));

    expect(m.enabled).toBe(true);
    expect(m.fold).toBe(legalTypes.has('fold'));
    expect(m.passive !== null).toBe(legalTypes.has('check') || legalTypes.has('call'));
    expect(m.raise !== null).toBe(legalTypes.has('bet') || legalTypes.has('raise'));
    expect(m.allin !== null).toBe(legalTypes.has('allin'));
  });

  it('加注上下界直接取自 legalActions，不自行推导', () => {
    const s = advanceTo(startHand({ seed: 'abm-3', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    const legalRaise = legalActions(s).find(a => a.type === 'bet' || a.type === 'raise');

    expect(legalRaise).toBeDefined();
    expect(m.raise).not.toBeNull();
    expect(m.raise!.min).toBe(legalRaise!.min);
    expect(m.raise!.max).toBe(legalRaise!.max);
  });

  it('快捷尺度全部落在 [min, max] 内，落不进去的档位不出现', () => {
    for (let button = 0; button < SEAT_COUNT; button++) {
      const s = advanceTo(startHand({ seed: `abm-p${button}`, buttonSeat: button }), HERO_SEAT);
      const m = actionBarModel(s);
      if (!m.raise) continue;
      for (const p of m.raise.presets) {
        expect(p.amount).toBeGreaterThanOrEqual(m.raise.min);
        expect(p.amount).toBeLessThanOrEqual(m.raise.max);
      }
    }
  });

  it('快捷尺度按「跟注后的底池」计价：投入额 = toCall + f × (pot + toCall)', () => {
    const s = advanceTo(startHand({ seed: 'abm-4', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    expect(m.raise).not.toBeNull();

    const seat = s.seats[HERO_SEAT];
    const toCall = s.currentBet - seat.streetContribution;
    const pot = s.seats.reduce((a, x) => a + x.totalContribution, 0);
    const potAfterCall = pot + toCall;

    const half = m.raise!.presets.find(p => p.label === '1/2 池');
    if (half) {
      expect(half.amount).toBeCloseTo(toCall + 0.5 * potAfterCall, 2);
    }
  });

  it('all-in 是独立字段，不混在 presets 里', () => {
    const s = advanceTo(startHand({ seed: 'abm-5', buttonSeat: 0 }), HERO_SEAT);
    const m = actionBarModel(s);
    if (m.raise) {
      expect(m.raise.presets.some(p => p.label.includes('全下'))).toBe(false);
      expect(m.raise.presets.some(p => p.label.toLowerCase().includes('allin'))).toBe(false);
    }
    expect(m.allin).not.toBeNull();
    expect(m.allin!.amount).toBe(s.seats[HERO_SEAT].stack);
  });

  it('手牌结束后禁用', () => {
    let s = startHand({ seed: 'abm-6', buttonSeat: 0 });
    let guard = 0;
    while (!s.handOver) {
      if (++guard > 100) throw new Error('牌局没有结束');
      s = applyAction(s, { type: 'fold' });
    }
    expect(actionBarModel(s).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/session/actionBarModel.test.ts
```

期望：FAIL，报错为找不到模块 `./actionBarModel`。

- [ ] **Step 3: 写实现**

创建 `src/session/actionBarModel.ts`：

```ts
import type { GameState } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { legalActions, currentPot, round2, chipsGreater } from '../core/gameEngine';

export interface RaiseModel {
  /** 最小投入额，直接取自 legalActions */
  min: number;
  /** 最大投入额，直接取自 legalActions（等于 hero 剩余筹码） */
  max: number;
  /** 快捷尺度。超出 [min,max] 的档位不会出现在这里 */
  presets: { label: string; amount: number }[];
}

export interface ActionBarModel {
  /** 非 hero 回合或手牌已结束时为 false */
  enabled: boolean;
  fold: boolean;
  passive: { type: 'check' } | { type: 'call'; amount: number } | null;
  raise: ({ type: 'bet' | 'raise' } & RaiseModel) | null;
  /** 全下是独立字段而不是 presets 的一档：它需要二次确认，其他档位不需要 */
  allin: { amount: number } | null;
}

const PRESET_FRACTIONS: readonly { label: string; f: number }[] = [
  { label: '1/3 池', f: 1 / 3 },
  { label: '1/2 池', f: 1 / 2 },
  { label: '2/3 池', f: 2 / 3 },
  { label: '池', f: 1 },
];

const DISABLED: ActionBarModel = {
  enabled: false,
  fold: false,
  passive: null,
  raise: null,
  allin: null,
};

/**
 * 把引擎的合法动作翻译成动作条能直接渲染的形状。
 *
 * 合法性的唯一权威是 legalActions —— 最小加注额、加注权
 * （hasActedSinceLastFullRaise）、不足额跟注、「没有加注权的人面对短
 * all-in 只能跟或弃」这些规则全部已在 gameEngine 里处理。本模块只翻译，
 * 不重新判断，否则就是给自己造一个会与引擎分歧的第二权威。
 */
export function actionBarModel(state: GameState): ActionBarModel {
  if (state.handOver || state.toAct !== HERO_SEAT) return DISABLED;

  const legal = legalActions(state);
  if (legal.length === 0) return DISABLED;

  const seat = state.seats[HERO_SEAT];
  const toCall = round2(state.currentBet - seat.streetContribution);

  const callAction = legal.find(a => a.type === 'call');
  const checkAction = legal.find(a => a.type === 'check');
  const raiseAction = legal.find(a => a.type === 'bet' || a.type === 'raise');
  const allinAction = legal.find(a => a.type === 'allin');

  let passive: ActionBarModel['passive'] = null;
  if (checkAction) passive = { type: 'check' };
  else if (callAction) passive = { type: 'call', amount: callAction.min };

  let raise: ActionBarModel['raise'] = null;
  if (raiseAction) {
    // 「池」的通用口径是跟注后的底池：先把欠的跟平，再按比例往里加。
    // toCall 为 0 时退化成「下注 X 倍底池」，与直觉一致。
    const potAfterCall = round2(currentPot(state) + toCall);
    const presets = PRESET_FRACTIONS.map(({ label, f }) => ({
      label,
      amount: round2(toCall + f * potAfterCall),
    })).filter(
      // 落在界外的档位直接不出现，而不是夹到边界上：夹到 max 会变成一个
      // 伪装成「1/2 池」的全下，而全下需要二次确认。宁可少给一个按钮。
      p => !chipsGreater(raiseAction.min, p.amount) && !chipsGreater(p.amount, raiseAction.max),
    );

    raise = {
      type: raiseAction.type as 'bet' | 'raise',
      min: raiseAction.min,
      max: raiseAction.max,
      presets,
    };
  }

  return {
    enabled: true,
    fold: legal.some(a => a.type === 'fold'),
    passive,
    raise,
    allin: allinAction ? { amount: allinAction.min } : null,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/session/actionBarModel.test.ts
```

期望：PASS，7 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/session/actionBarModel.ts src/session/actionBarModel.test.ts
git commit -m "$(cat <<'EOF'
feat(session): 动作条模型，把合法动作翻译成界面形状

合法性的唯一权威是 legalActions，本模块只翻译不重判——最小加注、
加注权、不足额跟注这些边角引擎已经处理干净，重写一遍就是造一个
会与引擎分歧的第二权威。

快捷尺度按「跟注后的底池」计价，落在 [min,max] 外的档位直接不出现
而不是夹到边界：夹到 max 会变成一个伪装成「1/2 池」的全下，而全下
需要二次确认。

抽成纯函数是为了让 UI 层唯一值得测的逻辑能在 node 里测，
不必引入 jsdom。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ledger.ts —— 买入账本

**Files:**
- Create: `src/session/ledger.ts`
- Test: `src/session/ledger.test.ts`

**Interfaces:**
- Consumes: `round2`（`src/core/gameEngine.ts`）、`STARTING_STACK`（`src/core/types.ts`）
- Produces:
  - `interface BuyIn { handIndex: number; amount: number }`
  - `interface SessionLedger { buyIns: readonly BuyIn[]; totalBuyIn: number; handsPlayed: number }`
  - `function createLedger(): SessionLedger`
  - `function addBuyIn(l: SessionLedger, handIndex: number, amount: number): SessionLedger`
  - `function recordHandPlayed(l: SessionLedger): SessionLedger`
  - `function heroNet(l: SessionLedger, currentStack: number): number`

**这个模块存在的全部理由**：净盈亏必须按 `当前筹码 − 累计买入` 算，不能靠累加每手的 `netBB`。不记买入的话，补一次 4000 就会被当成赢了 4000。

**`amount` 的语义**：实际添进桌上的钱，即 `目标筹码额 − 补码前的筹码`。开局那次为 `STARTING_STACK`（补码前是 0）。这样 `当前筹码 − totalBuyIn` 才严格等于所有手牌 `netBB` 之和——若把 `amount` 记成目标额 200 而实际只添了 199.7，恒等式就会差 0.3。

- [ ] **Step 1: 写失败的测试**

创建 `src/session/ledger.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { STARTING_STACK } from '../core/types';
import { createLedger, addBuyIn, recordHandPlayed, heroNet } from './ledger';

describe('SessionLedger', () => {
  it('开局账本记一次 STARTING_STACK 的买入', () => {
    const l = createLedger();
    expect(l.buyIns).toEqual([{ handIndex: 0, amount: STARTING_STACK }]);
    expect(l.totalBuyIn).toBe(STARTING_STACK);
    expect(l.handsPlayed).toBe(0);
  });

  it('开局时净盈亏为 0', () => {
    expect(heroNet(createLedger(), STARTING_STACK)).toBe(0);
  });

  it('输掉一半筹码，净盈亏是负的一半', () => {
    expect(heroNet(createLedger(), 50)).toBe(-50);
  });

  it('补码不算盈利：补码前后净盈亏不变', () => {
    const l0 = createLedger();
    const stackBeforeRebuy = 0.3;
    const netBefore = heroNet(l0, stackBeforeRebuy);

    // 补到 100BB，实际添进桌上的是 100 - 0.3 = 99.7
    const added = 100 - stackBeforeRebuy;
    const l1 = addBuyIn(l0, 7, added);
    const netAfter = heroNet(l1, 100);

    expect(netBefore).toBe(-99.7);
    expect(netAfter).toBe(netBefore);
  });

  it('补到 200BB 同样不改变净盈亏', () => {
    const l0 = createLedger();
    const stackBeforeRebuy = 0;
    const l1 = addBuyIn(l0, 3, 200 - stackBeforeRebuy);
    expect(heroNet(l0, stackBeforeRebuy)).toBe(-100);
    expect(heroNet(l1, 200)).toBe(-100);
  });

  it('多次补码后 totalBuyIn 与 buyIns 一致', () => {
    let l = createLedger();
    l = addBuyIn(l, 5, 100);
    l = addBuyIn(l, 12, 200);
    expect(l.buyIns).toHaveLength(3);
    expect(l.totalBuyIn).toBe(STARTING_STACK + 100 + 200);
    expect(l.totalBuyIn).toBe(l.buyIns.reduce((a, b) => a + b.amount, 0));
  });

  it('recordHandPlayed 只加手数，不动买入', () => {
    const l0 = createLedger();
    const l1 = recordHandPlayed(recordHandPlayed(l0));
    expect(l1.handsPlayed).toBe(2);
    expect(l1.totalBuyIn).toBe(l0.totalBuyIn);
  });

  it('所有转换都不改动入参（不可变）', () => {
    const l0 = createLedger();
    addBuyIn(l0, 1, 100);
    recordHandPlayed(l0);
    expect(l0.buyIns).toHaveLength(1);
    expect(l0.handsPlayed).toBe(0);
  });

  it('拒绝非正的买入额', () => {
    expect(() => addBuyIn(createLedger(), 1, 0)).toThrow();
    expect(() => addBuyIn(createLedger(), 1, -5)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/session/ledger.test.ts
```

期望：FAIL，找不到模块 `./ledger`。

- [ ] **Step 3: 写实现**

创建 `src/session/ledger.ts`：

```ts
import { STARTING_STACK } from '../core/types';
import { round2 } from '../core/chips';

export interface BuyIn {
  /** 这次买入发生在第几手之前；开局那次为 0 */
  handIndex: number;
  /**
   * 实际添进桌上的钱，单位 BB。
   *
   * 注意是「目标筹码额 − 补码前的筹码」，不是目标额本身。剩 0.3BB 时
   * 补到 100BB，这里记 99.7 而不是 100 —— 否则 heroNet 的恒等式会差 0.3。
   */
  amount: number;
}

export interface SessionLedger {
  /** 每一次买入，含开局那次，按时间顺序 */
  buyIns: readonly BuyIn[];
  /** 累计买入额，BB */
  totalBuyIn: number;
  /** 已打完的手数 */
  handsPlayed: number;
}

export function createLedger(): SessionLedger {
  return {
    buyIns: [{ handIndex: 0, amount: STARTING_STACK }],
    totalBuyIn: STARTING_STACK,
    handsPlayed: 0,
  };
}

export function addBuyIn(l: SessionLedger, handIndex: number, amount: number): SessionLedger {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`买入额必须为正，实际为 ${amount}`);
  }
  return {
    buyIns: [...l.buyIns, { handIndex, amount: round2(amount) }],
    totalBuyIn: round2(l.totalBuyIn + amount),
    handsPlayed: l.handsPlayed,
  };
}

export function recordHandPlayed(l: SessionLedger): SessionLedger {
  return { ...l, handsPlayed: l.handsPlayed + 1 };
}

/**
 * hero 的净盈亏 = 当前筹码 − 累计买入。
 *
 * **不能**用累加每手 netBB 的方式算。补码是往桌上添钱不是盈利，
 * 不记买入的话补一次 100BB 就会被当成赢了 100BB。
 */
export function heroNet(l: SessionLedger, currentStack: number): number {
  return round2(currentStack - l.totalBuyIn);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/session/ledger.test.ts
```

期望：PASS，9 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/session/ledger.ts src/session/ledger.test.ts
git commit -m "$(cat <<'EOF'
feat(session): 买入账本，净盈亏按「当前筹码 − 累计买入」计

账本存在的全部理由是补码不能被算成盈利。BuyIn.amount 记的是实际
添进桌上的钱（目标额 − 补码前筹码），不是目标额——剩 0.3BB 时补到
100BB 记 99.7，否则恒等式会差 0.3。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: handSession.ts —— 单手对局的可中断循环

**Files:**
- Create: `src/session/handSession.ts`
- Test: `src/session/handSession.test.ts`
- Create: `src/session/architecture.test.ts`
- Modify: `src/core/node-ambient.d.ts`

**Interfaces:**
- Consumes: `startHand` / `applyAction` / `settleHand`（`src/core/gameEngine.ts`）、`toHandRecord`（`src/core/handRecord.ts`）、`createRng`（`src/core/rng.ts`）、`narrowByAction`（`src/core/opponentRange.ts`）、`assignPersonas` / `getPersona` / `GTO_PERSONA`（`src/ai/personas.ts`）、`personaInitialRange`（`src/ai/personaRange.ts`）、`decide`（`src/ai/decide.ts`）、`createLedger` / `recordHandPlayed`（Task 3）
- Produces:
  - `type SessionPhase = 'aiToAct' | 'awaitingHero' | 'handOver'`
  - `interface SessionConfig { seed: string; iterations?: number; strengthIterations?: number; now?: () => number }`
  - `interface HandSessionState`（字段见实现）
  - `function startSession(cfg: SessionConfig): HandSessionState`
  - `function beginHand(cfg: SessionConfig, handIndex: number, stacks: readonly number[], ledger: SessionLedger, totalTableBuyIn: number): HandSessionState`（Task 5 的 `nextHand` 与两个任务的测试都要用）
  - `function stepAi(s: HandSessionState, cfg: SessionConfig): HandSessionState`
  - `function applyHero(s: HandSessionState, input: ActionInput, cfg?: SessionConfig): HandSessionState`
  - `const DEEP_STACK_BB = 150`
  - `function isDeepStackHand(s: HandSessionState): boolean`

本任务只做单手：开局、AI 推进、hero 行动、结算产出 `HandRecord`。跨手轮转与补码是 Task 5。

**必须照抄 `src/ai/selfPlayAi.ts` 的两处做法：**

1. 收窄范围时的 `betSize` 取 `applyAction` 返回状态里 `actions` 最后一条的 `amount`，**不是** `d.action.amount`——后者对 `call` / `allin` 恒为 `undefined`，`?? 0` 会把按尺度收窄整个关掉。这是 ②-B-1 修过的一个真缺陷。
2. AI 决策与范围收窄的顺序、每个座位初始范围的构造方式，与 `playAiHand` 保持一致——两条路径的 AI 行为必须相同。

- [ ] **Step 1: 写失败的测试**

创建 `src/session/handSession.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import {
  startSession,
  stepAi,
  applyHero,
  isDeepStackHand,
  DEEP_STACK_BB,
} from './handSession';
import type { HandSessionState, SessionConfig } from './handSession';

const CFG: SessionConfig = { seed: 'hs-test', iterations: 100, strengthIterations: 10 };

/** 推进到 hero 回合或手牌结束 */
function runToHeroOrEnd(s0: HandSessionState, cfg: SessionConfig): HandSessionState {
  let s = s0;
  let guard = 0;
  while (s.phase === 'aiToAct') {
    if (++guard > 200) throw new Error('疑似死锁');
    s = stepAi(s, cfg);
  }
  return s;
}

/** hero 一律选最保守的合法动作，把一手打到结束 */
function runHandPassively(s0: HandSessionState, cfg: SessionConfig): HandSessionState {
  let s = runToHeroOrEnd(s0, cfg);
  let guard = 0;
  while (s.phase !== 'handOver') {
    if (++guard > 200) throw new Error('疑似死锁');
    const legal = legalActions(s.game);
    const pick = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'fold')!;
    s = applyHero(s, { type: pick.type });
    s = runToHeroOrEnd(s, cfg);
  }
  return s;
}

describe('handSession 单手', () => {
  it('开局六个座位各带 STARTING_STACK，按钮位为 0', () => {
    const s = startSession(CFG);
    expect(s.handIndex).toBe(0);
    expect(s.game.buttonSeat).toBe(0);
    expect(s.game.seats).toHaveLength(SEAT_COUNT);
    for (const seat of s.game.seats) {
      expect(seat.startingStack).toBe(STARTING_STACK);
    }
    expect(s.ledger.totalBuyIn).toBe(STARTING_STACK);
  });

  it('phase 与引擎状态一致', () => {
    const s = startSession(CFG);
    expect(s.phase).toBe(s.game.toAct === HERO_SEAT ? 'awaitingHero' : 'aiToAct');
  });

  it('每个动作后筹码守恒', () => {
    const s0 = startSession(CFG);
    const total = totalChips(s0.game);
    let s = s0;
    let guard = 0;
    while (s.phase === 'aiToAct') {
      if (++guard > 200) throw new Error('疑似死锁');
      s = stepAi(s, CFG);
      expect(totalChips(s.game)).toBeCloseTo(total, 6);
    }
  });

  it('stepAi 是幂等的：对同一个状态调两次，结果逐位相同', () => {
    // 开局时按钮位为 0，hero 坐 0 号位（BTN），翻前第一个行动的必是 AI
    const s = startSession(CFG);
    expect(s.phase).toBe('aiToAct');

    const a = stepAi(s, CFG);
    const b = stepAi(s, CFG);
    expect(JSON.stringify(a.game)).toBe(JSON.stringify(b.game));
    expect(a.stepIndex).toBe(b.stepIndex);
  });

  it('applyHero 是幂等的', () => {
    const s = runToHeroOrEnd(startSession(CFG), CFG);
    expect(s.phase).toBe('awaitingHero');
    const a = applyHero(s, { type: 'fold' });
    const b = applyHero(s, { type: 'fold' });
    expect(JSON.stringify(a.game)).toBe(JSON.stringify(b.game));
  });

  it('非法阶段调用会抛错，而不是静默返回原状态', () => {
    const s = runToHeroOrEnd(startSession(CFG), CFG);
    expect(s.phase).toBe('awaitingHero');
    expect(() => stepAi(s, CFG)).toThrow();

    const over = runHandPassively(startSession(CFG), CFG);
    expect(over.phase).toBe('handOver');
    expect(() => applyHero(over, { type: 'fold' })).toThrow();
  });

  it('手牌结束时产出可被 replayHandRecord 复现的 HandRecord', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.record).not.toBeNull();

    const replayed = replayHandRecord(s.record!);
    expect(replayed.board).toEqual(s.game.board);
    expect(replayed.seats.map(x => x.stack)).toEqual(s.game.seats.map(x => x.stack));
  });

  it('手牌结束时更新 stacks 与 handsPlayed', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.ledger.handsPlayed).toBe(1);
    expect(s.stacks).toEqual(s.game.seats.map(x => x.stack));
  });

  it('lastAction 反映最近一个动作', () => {
    let s = startSession(CFG);
    expect(s.lastAction).toBeNull();
    if (s.phase === 'aiToAct') {
      s = stepAi(s, CFG);
      expect(s.lastAction).not.toBeNull();
      const last = s.game.actions[s.game.actions.length - 1];
      expect(s.lastAction!.seat).toBe(last.seat);
      expect(s.lastAction!.type).toBe(last.type);
    }
  });

  it('同 seed 打两遍，牌局逐位相同', () => {
    const a = runHandPassively(startSession(CFG), CFG);
    const b = runHandPassively(startSession(CFG), CFG);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });

  it('默认时钟是确定性的，不引入 Date.now', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.record!.timestamp).toBe(0);
  });

  it('注入的时钟会被用上', () => {
    const cfg: SessionConfig = { ...CFG, now: () => 12345 };
    const s = runHandPassively(startSession(cfg), cfg);
    expect(s.record!.timestamp).toBe(12345);
  });

  it('全员 100BB 的手牌不算深筹码', () => {
    expect(isDeepStackHand(startSession(CFG))).toBe(false);
    expect(DEEP_STACK_BB).toBe(150);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/session/handSession.test.ts
```

期望：FAIL，找不到模块 `./handSession`。

- [ ] **Step 3: 写实现**

创建 `src/session/handSession.ts`：

```ts
import type { ActionInput } from '../core/gameEngine';
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { ActionType, GameState, HandRecord } from '../core/types';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import type { RangeSet } from '../core/rangeSet';
import { narrowByAction } from '../core/opponentRange';
import { assignPersonas, getPersona, GTO_PERSONA } from '../ai/personas';
import { personaInitialRange } from '../ai/personaRange';
import { decide } from '../ai/decide';
import type { SessionLedger } from './ledger';
import { createLedger, recordHandPlayed } from './ledger';

/** 超过此深度（BB）即认为复盘精度下降 */
export const DEEP_STACK_BB = 150;

export type SessionPhase = 'aiToAct' | 'awaitingHero' | 'handOver';

export interface SessionConfig {
  /** 整个会话的基础 seed，各手牌由它与 handIndex 派生 */
  seed: string;
  /** 主胜率估算迭代数，透传给 decide */
  iterations?: number;
  /** 范围牌力排序迭代数，透传给 decide 与 narrowByAction */
  strengthIterations?: number;
  /**
   * 时钟。默认返回 0，使同 seed 的 HandRecord 逐位可复现。
   * 界面层传 Date.now —— 真实时间戳是 ③-C 的历史页需要的。
   */
  now?: () => number;
}

export interface HandSessionState {
  /** 牌局引擎状态，唯一权威 */
  game: GameState;
  /** 座位号 -> 该座位当前的手牌范围，逐街收窄 */
  ranges: ReadonlyMap<number, RangeSet>;
  /** 座位号 -> persona id，hero 座位为 'hero' */
  personaIds: ReadonlyMap<number, string>;
  phase: SessionPhase;
  /** 本手是第几手（从 0 起），参与 rng 派生与按钮位轮转 */
  handIndex: number;
  /** 本手已推进的步数，参与 rng 派生 */
  stepIndex: number;
  /** 最近一个动作，供动作气泡渲染 */
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 仅 phase==='handOver' 时非空 */
  record: HandRecord | null;
  /** 各座位在下一手开局时的筹码（BB），跨手延续 */
  stacks: readonly number[];
  /** hero 的买入账本 */
  ledger: SessionLedger;
  /**
   * 桌上所有座位（含 AI）的累计买入额。
   *
   * ledger 只记 hero，但跨手筹码守恒的断言需要知道 AI 补了多少钱进来，
   * 否则「这一手的总筹码比上一手多」就没法区分是补码还是漏算。
   */
  totalTableBuyIn: number;
}

function phaseOf(game: GameState): SessionPhase {
  if (game.handOver) return 'handOver';
  return game.toAct === HERO_SEAT ? 'awaitingHero' : 'aiToAct';
}

/**
 * 开一手新牌。内部函数，被 startSession 与 nextHand（Task 5）共用。
 *
 * 每个座位的初始范围与 playAiHand 的构造方式一致：从该位置的开池范围起手，
 * 按该座位性格的 rangeWidthMul 收紧或放宽。hero 没有性格，按 GTO 原型处理，
 * 与 decide.ts 把 'hero' 映射到 GTO_PERSONA 的规则一致。
 */
export function beginHand(
  cfg: SessionConfig,
  handIndex: number,
  stacks: readonly number[],
  ledger: SessionLedger,
  totalTableBuyIn: number,
): HandSessionState {
  const game = startHand({
    seed: `${cfg.seed}-h${handIndex}`,
    buttonSeat: handIndex % SEAT_COUNT,
    startingStacks: [...stacks],
  });

  const personaIds = assignPersonas(
    game.seats.map(s => s.seat),
    createRng(`${cfg.seed}-persona-${handIndex}`),
    HERO_SEAT,
  );

  const ranges = new Map<number, RangeSet>();
  for (const s of game.seats) {
    const personaId = personaIds.get(s.seat) ?? GTO_PERSONA.id;
    const persona = personaId === 'hero' ? GTO_PERSONA : getPersona(personaId);
    ranges.set(
      s.seat,
      personaInitialRange(
        s.position,
        persona,
        createRng(`${cfg.seed}-range-${handIndex}-${s.seat}`),
        cfg.strengthIterations,
      ),
    );
  }

  return {
    game,
    ranges,
    personaIds,
    phase: phaseOf(game),
    handIndex,
    stepIndex: 0,
    lastAction: null,
    record: null,
    stacks,
    ledger,
    totalTableBuyIn,
  };
}

export function startSession(cfg: SessionConfig): HandSessionState {
  const stacks = new Array<number>(SEAT_COUNT).fill(STARTING_STACK);
  // 开局时桌上每个座位都买入了 STARTING_STACK
  return beginHand(cfg, 0, stacks, createLedger(), STARTING_STACK * SEAT_COUNT);
}

/**
 * 施加一个动作并推进会话。stepAi 与 applyHero 的公共部分。
 *
 * `betSize` 取的是 applyAction 记下的实际投入额，**不是**入参的 amount：
 * decide 对 call/allin 故意不带 amount（引擎自己算），用入参会让 betSize
 * 恒为 0，等于对这两种动作完全关闭按尺度收窄。这是 ②-B-1 修过的真缺陷，
 * 见 src/ai/selfPlayAi.ts 里同一处的注释。
 */
function advance(
  s: HandSessionState,
  cfg: SessionConfig,
  input: ActionInput,
): HandSessionState {
  const acting = s.game.toAct!;
  const before = s.game;
  const next = applyAction(before, input);
  const applied = next.actions[next.actions.length - 1];

  const ranges = new Map(s.ranges);
  ranges.set(
    acting,
    narrowByAction(ranges.get(acting)!, input.type, {
      street: before.street,
      board: before.board,
      dead: before.board,
      potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
      betSize: applied.amount,
      strengthIterations: cfg.strengthIterations ?? 20,
      rng: createRng(`${cfg.seed}-h${s.handIndex}-narrow${s.stepIndex}`),
    }),
  );

  const lastAction = { seat: applied.seat, type: applied.type, amount: applied.amount };

  if (!next.handOver) {
    return {
      ...s,
      game: next,
      ranges,
      phase: phaseOf(next),
      stepIndex: s.stepIndex + 1,
      lastAction,
    };
  }

  const settled = settleHand(next);
  const record = toHandRecord(settled, {
    id: `${cfg.seed}-h${s.handIndex}`,
    heroSeat: HERO_SEAT,
    personaIds: Object.fromEntries(s.personaIds),
    timestamp: (cfg.now ?? (() => 0))(),
  });

  return {
    ...s,
    game: settled,
    ranges,
    phase: 'handOver',
    stepIndex: s.stepIndex + 1,
    lastAction,
    record,
    stacks: settled.seats.map(x => x.stack),
    ledger: recordHandPlayed(s.ledger),
  };
}

/**
 * 推进一个 AI 动作。
 *
 * rng 每步现造而不是存在状态里：Rng 有内部可变状态，存进 React 状态后
 * StrictMode 的 effect 双调用会让它多走一步，同 seed 不再复现。派生 seed
 * 让本函数成为幂等纯函数，重复调用得到逐位相同的结果。
 */
export function stepAi(s: HandSessionState, cfg: SessionConfig): HandSessionState {
  if (s.phase !== 'aiToAct') {
    throw new Error(`stepAi 只能在 aiToAct 阶段调用，当前为 ${s.phase}`);
  }

  const d = decide(s.game, {
    ranges: new Map(s.ranges),
    personaIds: new Map(s.personaIds),
    rng: createRng(`${cfg.seed}-h${s.handIndex}-s${s.stepIndex}`),
    iterations: cfg.iterations,
    strengthIterations: cfg.strengthIterations,
  });

  return advance(s, cfg, d.action);
}

/**
 * 施加 hero 的动作。hero 座位的范围同样收窄，使复盘走的是同一条链路。
 *
 * cfg 可省略：省略时从 game.seed 还原基础 seed，这样界面层每次点击不必
 * 把配置传进来。验收关卡显式传 cfg，因为它要控制迭代数。
 */
export function applyHero(
  s: HandSessionState,
  input: ActionInput,
  cfg?: SessionConfig,
): HandSessionState {
  if (s.phase !== 'awaitingHero') {
    throw new Error(`applyHero 只能在 awaitingHero 阶段调用，当前为 ${s.phase}`);
  }
  // cfg 只用于取 seed 与 strengthIterations；未传时从 game.seed 还原基础 seed
  const effective: SessionConfig = cfg ?? { seed: baseSeedOf(s) };
  return advance(s, effective, input);
}

/** 从本手的引擎 seed（`${base}-h${n}`）还原基础 seed */
function baseSeedOf(s: HandSessionState): string {
  const suffix = `-h${s.handIndex}`;
  return s.game.seed.endsWith(suffix)
    ? s.game.seed.slice(0, -suffix.length)
    : s.game.seed;
}

/** 本手开局时是否有任一座位达到深筹码阈值 */
export function isDeepStackHand(s: HandSessionState): boolean {
  return s.game.seats.some(seat => seat.startingStack >= DEEP_STACK_BB);
}
```

**关于 `applyHero` 的 cfg 参数**：测试里调用 `applyHero(s, input)` 不传 cfg，实现从 `game.seed` 还原基础 seed。这样 UI 层也不必在每次点击时传配置。重载签名的存在是为了让传 cfg 的调用（Task 6 的验收关卡）也合法。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/session/handSession.test.ts
```

期望：PASS，13 个测试全绿。

- [ ] **Step 5: 补 node-ambient 的 readdirSync 声明**

`src/core/node-ambient.d.ts` 里的 `declare module 'node:fs'` 只声明了 `readFileSync`。分层守卫要遍历目录，追加一行：

```ts
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(
    path: string,
    options: { recursive: boolean },
  ): string[];
}
```

- [ ] **Step 6: 写分层守卫测试**

创建 `src/session/architecture.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map(f => `${dir}/${f.split('\\').join('/')}`);
}

describe('三期分层守卫', () => {
  it('src/session/ 不导入 React，也不碰浏览器 API', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/session')) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]react(-dom)?['"]/.test(src)) offenders.push(`${file}: react`);
      if (/\bsetTimeout\b|\bsetInterval\b/.test(src)) offenders.push(`${file}: 计时器`);
      if (/\bdocument\.|\bwindow\./.test(src)) offenders.push(`${file}: DOM`);
    }
    expect(offenders).toEqual([]);
  });

  it('src/session/ 不使用 Math.random', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/session')) {
      if (/Math\.random/.test(readFileSync(file, 'utf-8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 7: 运行全量测试**

```bash
npm test
npm run typecheck
```

期望：全绿，测试总数从 534 增至约 558。

- [ ] **Step 8: 提交**

```bash
git add src/session/handSession.ts src/session/handSession.test.ts src/session/architecture.test.ts src/core/node-ambient.d.ts
git commit -m "$(cat <<'EOF'
feat(session): 可在 hero 回合挂起的单手对局循环

本质是 playAiHand 的可中断版本。挂起期间必须保住 ranges Map——
逐街收窄的范围就是 AI 世界观的连续性，丢了 AI 会前后矛盾。

不在状态里存 Rng：它有内部可变状态，进了 React 状态后 StrictMode
的 effect 双调用会让它多走一步，同 seed 不再复现。改用 stepIndex
派生 seed，stepAi/applyHero 因此是幂等纯函数。

收窄用的 betSize 取 applyAction 记下的实际投入额而非入参 amount，
照抄 selfPlayAi 的做法——入参对 call/allin 恒为 undefined，用它会把
按尺度收窄整个关掉。

时钟可注入，默认返回 0 以保证 HandRecord 逐位可复现。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 跨手轮转、筹码延续与补码

**Files:**
- Modify: `src/session/handSession.ts`
- Modify: `src/session/handSession.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `beginHand` / `HandSessionState`、Task 3 的 `addBuyIn`
- Produces:
  - `const REBUY_OPTIONS: readonly number[]`（`[100, 200]`，语义是**目标筹码额**）
  - `function heroNeedsRebuy(s: HandSessionState): boolean`
  - `function rebuyHero(s: HandSessionState, targetStack: number): HandSessionState`
  - `function nextHand(s: HandSessionState, cfg: SessionConfig): HandSessionState`

**破产判定的口径是「筹码不足一个大盲」而非「筹码为 0」**：剩 0.5BB 的座位连大盲都下不满，让它入座只会产生一手立刻全下的退化牌局。剩 15BB 这类短码继续打，不弹补码框。

- [ ] **Step 1: 追加失败的测试**

在 `src/session/handSession.test.ts` 末尾追加（同时把顶部 import 补上新符号）：

```ts
import {
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  REBUY_OPTIONS,
  beginHand,
} from './handSession';
import { BIG_BLIND } from '../core/types';
import { createLedger } from './ledger';

/** 构造一个已结束、且 hero 筹码为指定值的会话状态，用于测试补码分支 */
function sessionWithHeroStack(stack: number): HandSessionState {
  const stacks = [stack, 100, 100, 100, 100, 100];
  const s = beginHand(CFG, 3, stacks, createLedger(), 600);
  return { ...s, phase: 'handOver', record: null, stacks };
}

describe('handSession 跨手', () => {
  it('REBUY_OPTIONS 是目标筹码额 100 / 200 BB', () => {
    expect(REBUY_OPTIONS).toEqual([100, 200]);
  });

  it('nextHand 让按钮位前进一位，handIndex 加一', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    const n = nextHand(s, CFG);
    expect(n.handIndex).toBe(1);
    expect(n.game.buttonSeat).toBe(1);
    expect(n.phase).not.toBe('handOver');
    expect(n.record).toBeNull();
  });

  it('hero 位置 6 手一个完整轮回', () => {
    let s = runHandPassively(startSession(CFG), CFG);
    const positions: string[] = [s.game.seats[HERO_SEAT].position];
    for (let i = 0; i < SEAT_COUNT - 1; i++) {
      s = runHandPassively(nextHand(s, CFG), CFG);
      positions.push(s.game.seats[HERO_SEAT].position);
    }
    expect(new Set(positions).size).toBe(SEAT_COUNT);
  });

  it('筹码跨手延续：新一手的起始筹码等于上一手结束时的筹码', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    const n = nextHand(s, CFG);
    expect(n.game.seats.map(x => x.startingStack)).toEqual(s.stacks);
  });

  it('heroNeedsRebuy 的口径是「筹码 < 一个大盲」', () => {
    expect(heroNeedsRebuy(sessionWithHeroStack(0))).toBe(true);
    expect(heroNeedsRebuy(sessionWithHeroStack(BIG_BLIND / 2))).toBe(true);
    expect(heroNeedsRebuy(sessionWithHeroStack(BIG_BLIND))).toBe(false);
    expect(heroNeedsRebuy(sessionWithHeroStack(15))).toBe(false);
  });

  it('hero 需要补码时 nextHand 抛错，而不是悄悄发一手筹码为 0 的牌', () => {
    expect(() => nextHand(sessionWithHeroStack(0), CFG)).toThrow(/补码/);
  });

  it('rebuyHero 把筹码设成目标额，账本记的是实际添进去的钱', () => {
    const s = sessionWithHeroStack(0.3);
    const r = rebuyHero(s, 100);
    expect(r.stacks[HERO_SEAT]).toBe(100);
    const last = r.ledger.buyIns[r.ledger.buyIns.length - 1];
    expect(last.amount).toBeCloseTo(99.7, 6);
    expect(last.handIndex).toBe(s.handIndex + 1);
  });

  it('补码后净盈亏不变——补码不是盈利', () => {
    const s = sessionWithHeroStack(0.3);
    const before = s.stacks[HERO_SEAT] - s.ledger.totalBuyIn;
    const r = rebuyHero(s, 200);
    const after = r.stacks[HERO_SEAT] - r.ledger.totalBuyIn;
    expect(after).toBeCloseTo(before, 6);
  });

  it('rebuyHero 拒绝 REBUY_OPTIONS 以外的额度', () => {
    const s = sessionWithHeroStack(0);
    expect(() => rebuyHero(s, 150)).toThrow();
    expect(() => rebuyHero(s, 0)).toThrow();
  });

  it('rebuyHero 拒绝在不需要补码时调用', () => {
    expect(() => rebuyHero(sessionWithHeroStack(50), 100)).toThrow();
  });

  it('AI 破产时 nextHand 自动补码到 REBUY_OPTIONS 之一', () => {
    const stacks = [100, 0, 100, 100, 100, 100];
    const s: HandSessionState = {
      ...beginHand(CFG, 2, stacks, createLedger(), 500),
      phase: 'handOver',
      stacks,
    };
    const n = nextHand(s, CFG);
    expect(REBUY_OPTIONS).toContain(n.game.seats[1].startingStack);
    expect(n.totalTableBuyIn).toBeGreaterThan(s.totalTableBuyIn);
  });

  it('AI 补码可复现：同 seed 同 handIndex 补出同样的额度', () => {
    const stacks = [100, 0, 100, 100, 100, 100];
    const make = (): HandSessionState => ({
      ...beginHand(CFG, 2, stacks, createLedger(), 500),
      phase: 'handOver',
      stacks,
    });
    expect(nextHand(make(), CFG).game.seats[1].startingStack).toBe(
      nextHand(make(), CFG).game.seats[1].startingStack,
    );
  });

  it('任一座位达到 150BB 即判为深筹码手牌', () => {
    const stacks = [DEEP_STACK_BB, 100, 100, 100, 100, 100];
    const s = beginHand(CFG, 0, stacks, createLedger(), 650);
    expect(isDeepStackHand(s)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/session/handSession.test.ts
```

期望：FAIL，`nextHand` / `heroNeedsRebuy` / `rebuyHero` / `REBUY_OPTIONS` 未导出。

- [ ] **Step 3: 写实现**

在 `src/session/handSession.ts` 顶部的 import 里补上：

```ts
import { BIG_BLIND } from '../core/types';
import { chipsGreater, round2 } from '../core/chips';
import { addBuyIn } from './ledger';
```

在文件末尾追加：

```ts
/**
 * 可选的补码额度，单位 BB，语义是**补码后的目标筹码额**（不是新增额）。
 * 对应实额 4000 / 8000。
 */
export const REBUY_OPTIONS: readonly number[] = [100, 200];

/** 筹码不足一个大盲即无法参与下一手。剩 15BB 这类短码继续打，不算破产 */
function needsRebuy(stack: number): boolean {
  return chipsGreater(BIG_BLIND, stack);
}

export function heroNeedsRebuy(s: HandSessionState): boolean {
  return needsRebuy(s.stacks[HERO_SEAT]);
}

/**
 * hero 补码。targetStack 是补码后的筹码额，账本记的是实际添进桌上的钱
 * （targetStack − 当前筹码）——记成 targetStack 会让净盈亏的恒等式失准。
 */
export function rebuyHero(s: HandSessionState, targetStack: number): HandSessionState {
  if (!REBUY_OPTIONS.includes(targetStack)) {
    throw new Error(`补码额度必须是 ${REBUY_OPTIONS.join(' / ')} 之一，实际为 ${targetStack}`);
  }
  if (!heroNeedsRebuy(s)) {
    throw new Error('hero 筹码充足，无需补码');
  }

  const added = round2(targetStack - s.stacks[HERO_SEAT]);
  const stacks = [...s.stacks];
  stacks[HERO_SEAT] = targetStack;

  return {
    ...s,
    stacks,
    ledger: addBuyIn(s.ledger, s.handIndex + 1, added),
    totalTableBuyIn: round2(s.totalTableBuyIn + added),
  };
}

/**
 * 进入下一手：按钮位前进一位，各座位带上一手结束时的筹码入座。
 *
 * hero 需要补码时抛错而不是自动补——这逼 UI 显式处理补码分支，
 * 而不是让一手筹码为 0 的牌悄悄发出去。AI 不需要人来点，自动补。
 */
export function nextHand(s: HandSessionState, cfg: SessionConfig): HandSessionState {
  if (s.phase !== 'handOver') {
    throw new Error(`nextHand 只能在 handOver 阶段调用，当前为 ${s.phase}`);
  }
  if (heroNeedsRebuy(s)) {
    throw new Error('hero 需要补码后才能开始下一手');
  }

  const handIndex = s.handIndex + 1;
  const stacks = [...s.stacks];
  let totalTableBuyIn = s.totalTableBuyIn;

  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (seat === HERO_SEAT || !needsRebuy(stacks[seat])) continue;
    const rng = createRng(`${cfg.seed}-rebuy-${handIndex}-${seat}`);
    const target = REBUY_OPTIONS[rng.nextInt(REBUY_OPTIONS.length)];
    totalTableBuyIn = round2(totalTableBuyIn + (target - stacks[seat]));
    stacks[seat] = target;
  }

  return beginHand(cfg, handIndex, stacks, s.ledger, totalTableBuyIn);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/session/handSession.test.ts
npm run typecheck
```

期望：PASS，26 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/session/handSession.ts src/session/handSession.test.ts
git commit -m "$(cat <<'EOF'
feat(session): 筹码跨手延续与手动补码

REBUY_OPTIONS 的语义是补码后的目标筹码额，账本记的是实际添进桌上的
钱（目标额 − 当前筹码）。这个区别不是洁癖：记成目标额会让「净盈亏 =
当前筹码 − 累计买入」差掉零头。

破产口径是「不足一个大盲」而非「为 0」——剩 0.5BB 的座位连大盲都下
不满，入座只会产生一手立刻全下的退化牌局；剩 15BB 的短码继续打。

hero 需要补码时 nextHand 抛错而不是自动补，逼 UI 显式处理该分支。
AI 自动补，额度由 seed 派生因而可复现。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ★ 验收关卡 —— 脚本化玩家连打 200 手

**Files:**
- Create: `src/session/scriptedHero.ts`
- Create: `src/session/scriptedPlay.test.ts`

**Interfaces:**
- Consumes: Task 4/5 的全部导出、`decide`（`src/ai/decide.ts`）
- Produces: `function scriptedHeroAction(s: HandSessionState, cfg: SessionConfig): ActionInput`

**这是 ③-A 的硬关卡，对标前三期的 10000 手属性测试、200 手 AI 自对弈、29 个金标准场景。**

脚本化 hero 用 `decide` 以 GTO 原型代打，而不是「总是跟注」这类退化脚本——退化脚本走不到加注与全下路径，而那正是动作合法性最容易出错的地方。`decide` 已经把 `'hero'` 映射到 `GTO_PERSONA`，直接调即可。

**关于断言 10（多池必须出现过）：如果跑出来是 0，停下来报数字，不许换 seed 直到出现。** 若变额筹码下多池仍然不可达，那说明我们对边池的理解有问题——这个事实比一条绿测试重要得多。

- [ ] **Step 1: 写脚本化玩家**

创建 `src/session/scriptedHero.ts`：

```ts
import type { ActionInput } from '../core/gameEngine';
import { createRng } from '../core/rng';
import { decide } from '../ai/decide';
import type { HandSessionState, SessionConfig } from './handSession';

/**
 * 测试用的脚本化 hero：用 EV 引擎以 GTO 原型代打。
 *
 * 刻意不用「总是跟注」这类退化脚本 —— 退化脚本永远走不到加注与全下
 * 路径，而那正是动作合法性最容易出错的地方。decide 内部已把 'hero'
 * 映射到 GTO_PERSONA，直接调用即可。
 */
export function scriptedHeroAction(s: HandSessionState, cfg: SessionConfig): ActionInput {
  const d = decide(s.game, {
    ranges: new Map(s.ranges),
    personaIds: new Map(s.personaIds),
    rng: createRng(`${cfg.seed}-hero-h${s.handIndex}-s${s.stepIndex}`),
    iterations: cfg.iterations,
    strengthIterations: cfg.strengthIterations,
  });
  return d.action;
}
```

- [ ] **Step 2: 写验收关卡测试**

创建 `src/session/scriptedPlay.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, BIG_BLIND } from '../core/types';
import type { HandRecord } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import {
  startSession,
  stepAi,
  applyHero,
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  isDeepStackHand,
  DEEP_STACK_BB,
} from './handSession';
import type { HandSessionState, SessionConfig } from './handSession';
import { actionBarModel } from './actionBarModel';
import { scriptedHeroAction } from './scriptedHero';

const HANDS = 200;

// 迭代数压低是为了让 200 手在可接受时间内跑完。筹码守恒、可复现、
// 账本恒等这些断言与迭代数无关；迭代数只影响 AI 打得多好，不影响
// 它打得是否合法。
const CFG: SessionConfig = { seed: 'gate-2026-08-11', iterations: 200, strengthIterations: 20 };

interface RunResult {
  records: HandRecord[];
  /** 每手开局时的六个座位筹码 */
  openingStacks: number[][];
  /** 每手开局时账本里的累计桌面买入 */
  openingTableBuyIn: number[];
  /** 每手结束时的六个座位筹码 */
  closingStacks: number[][];
  deepStackHands: number;
  multiPotHands: number;
  final: HandSessionState;
}

/**
 * 脚本化 hero 驱动会话连打 HANDS 手。
 * rebuyTarget 决定 hero 破产时补到多少。
 */
function run(cfg: SessionConfig, hands: number, rebuyTarget: number): RunResult {
  const out: RunResult = {
    records: [],
    openingStacks: [],
    openingTableBuyIn: [],
    closingStacks: [],
    deepStackHands: 0,
    multiPotHands: 0,
    final: startSession(cfg),
  };

  let s = out.final;

  for (let h = 0; h < hands; h++) {
    out.openingStacks.push(s.game.seats.map(x => x.startingStack));
    out.openingTableBuyIn.push(s.totalTableBuyIn);
    if (isDeepStackHand(s)) out.deepStackHands++;

    const chipsAtStart = totalChips(s.game);
    let guard = 0;

    while (s.phase !== 'handOver') {
      if (++guard > 300) throw new Error(`第 ${h} 手疑似死锁`);

      if (s.phase === 'aiToAct') {
        s = stepAi(s, cfg);
      } else {
        // 断言 6：动作条模型与引擎的合法动作一一对应
        const model = actionBarModel(s.game);
        const legalTypes = new Set(legalActions(s.game).map(a => a.type));
        expect(model.enabled).toBe(true);
        expect(model.fold).toBe(legalTypes.has('fold'));
        expect(model.passive !== null).toBe(
          legalTypes.has('check') || legalTypes.has('call'),
        );
        expect(model.raise !== null).toBe(legalTypes.has('bet') || legalTypes.has('raise'));
        expect(model.allin !== null).toBe(legalTypes.has('allin'));

        const action = scriptedHeroAction(s, cfg);

        // 脚本选中的动作必须落在模型的启用项里
        const inModel =
          (action.type === 'fold' && model.fold) ||
          (action.type === 'check' && model.passive?.type === 'check') ||
          (action.type === 'call' && model.passive?.type === 'call') ||
          ((action.type === 'bet' || action.type === 'raise') && model.raise !== null) ||
          (action.type === 'allin' && model.allin !== null);
        expect(inModel, `第 ${h} 手动作 ${action.type} 不在动作条模型里`).toBe(true);

        s = applyHero(s, action, cfg);
      }

      // 断言 1：每个动作后筹码守恒
      expect(totalChips(s.game)).toBeCloseTo(chipsAtStart, 6);
    }

    out.records.push(s.record!);
    out.closingStacks.push(s.stacks.slice());
    if (s.record!.pots.length > 1) out.multiPotHands++;

    if (h < hands - 1) {
      if (heroNeedsRebuy(s)) s = rebuyHero(s, rebuyTarget);
      s = nextHand(s, cfg);
    }
  }

  out.final = s;
  return out;
}

describe('★ 验收关卡：脚本化玩家 200 手自对弈', () => {
  const r = run(CFG, HANDS, 100);

  it('1&2. 筹码守恒且无死锁（由 run 内部逐动作断言，跑完即通过）', () => {
    expect(r.records).toHaveLength(HANDS);
  });

  it('3. 同 seed 跑两遍，200 份 HandRecord 逐位相同', () => {
    const again = run(CFG, HANDS, 100);
    expect(JSON.stringify(again.records)).toBe(JSON.stringify(r.records));
  });

  it('4. 每份 record 都能被 replayHandRecord 复现到相同终局', () => {
    r.records.forEach((rec, i) => {
      const replayed = replayHandRecord(rec);
      expect(replayed.board, `第 ${i} 手公共牌不一致`).toEqual(rec.board);
      expect(
        replayed.seats.map(x => x.stack),
        `第 ${i} 手终局筹码不一致`,
      ).toEqual(r.closingStacks[i]);
    });
  });

  it('5. 按钮位每手前进一位，hero 位置 6 手一个完整轮回', () => {
    r.records.forEach((rec, i) => {
      expect(rec.buttonSeat, `第 ${i} 手按钮位不对`).toBe(i % SEAT_COUNT);
    });
    for (let start = 0; start + SEAT_COUNT <= HANDS; start += SEAT_COUNT) {
      const window = r.records
        .slice(start, start + SEAT_COUNT)
        .map(rec => rec.seats.find(x => x.seat === HERO_SEAT)!.position);
      expect(new Set(window).size, `第 ${start} 手起的一轮位置没走满`).toBe(SEAT_COUNT);
    }
  });

  it('7. 跨手筹码守恒：本手开局总额 = 上手收局总额 + 期间买入', () => {
    for (let h = 1; h < HANDS; h++) {
      const opening = r.openingStacks[h].reduce((a, b) => a + b, 0);
      const closing = r.closingStacks[h - 1].reduce((a, b) => a + b, 0);
      const bought = r.openingTableBuyIn[h] - r.openingTableBuyIn[h - 1];
      expect(opening, `第 ${h} 手开局总筹码对不上`).toBeCloseTo(closing + bought, 6);
    }
  });

  it('8. 账本恒等式：当前筹码 − 累计买入 = 每手 netBB 之和', () => {
    const sumNet = r.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    const byLedger = r.final.stacks[HERO_SEAT] - r.final.ledger.totalBuyIn;
    expect(byLedger).toBeCloseTo(sumNet, 6);
  });

  it('9. 补码只在该补时发生，且拒绝非法额度', () => {
    // heroNeedsRebuy ⟺ 筹码 < 一个大盲
    for (let h = 0; h < HANDS; h++) {
      const heroClosing = r.closingStacks[h][HERO_SEAT];
      const needed = heroClosing < BIG_BLIND;
      const nextOpening = h + 1 < HANDS ? r.openingStacks[h + 1][HERO_SEAT] : null;
      if (nextOpening !== null && needed) {
        expect(nextOpening, `第 ${h} 手后 hero 应已补码`).toBe(100);
      }
      if (nextOpening !== null && !needed) {
        expect(nextOpening, `第 ${h} 手后 hero 不该补码`).toBeCloseTo(heroClosing, 6);
      }
    }
    expect(() => rebuyHero(r.final, 150)).toThrow();
  });

  it('10. 多池确实出现过，且池金额之和等于全桌总投入', () => {
    expect(
      r.multiPotHands,
      '200 手里一次多池都没有 —— 停下来查边池，不要换 seed',
    ).toBeGreaterThan(0);

    // 不用「池金额之和 = 总投入」来断言：座位的实际投入无法从 record 直接
    // 读出（netBB 是投入与赢回的净额，两者没有分开记）。下面三条是不需要
    // 任何反推就成立的关系，同样能抓住分层算错。
    for (const rec of r.records.filter(x => x.pots.length > 1)) {
      const potSum = rec.pots.reduce((a, p) => a + p.amount, 0);
      const startSum = rec.seats.reduce((a, x) => a + x.startingStack, 0);
      const netSum = rec.results.reduce((a, x) => a + x.netBB, 0);

      // 底池是正的，且不可能超过全桌起始筹码之和
      expect(potSum).toBeGreaterThan(0);
      expect(potSum).toBeLessThanOrEqual(startSum + 1e-6);
      // 一手牌是零和的：所有人的净盈亏加起来必须是 0
      expect(netSum, `第 ${rec.id} 手净盈亏之和不为零`).toBeCloseTo(0, 6);
      // 每个池的资格集非空且互不越界
      for (const p of rec.pots) {
        expect(p.eligible.length).toBeGreaterThan(0);
        expect(p.amount).toBeGreaterThan(0);
      }
    }
  });

  it('11. 深筹码标记与开局筹码一致', () => {
    r.openingStacks.forEach((stacks, h) => {
      const deep = stacks.some(x => x >= DEEP_STACK_BB);
      const rec = r.records[h];
      const recDeep = rec.seats.some(x => x.startingStack >= DEEP_STACK_BB);
      expect(recDeep, `第 ${h} 手深筹码判定不一致`).toBe(deep);
    });
  });

  it('补 200BB 的变体也守恒（40 手）', () => {
    const deep = run({ ...CFG, seed: 'gate-deep' }, 40, 200);
    const sumNet = deep.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    expect(deep.final.stacks[HERO_SEAT] - deep.final.ledger.totalBuyIn).toBeCloseTo(sumNet, 6);
  });

  it('多池手数是一个具体数字，记进报告', () => {
    // 这条不是断言而是记录：报告里要写出真实数字，不能只说「大于 0」
    console.log(`200 手中多池手数：${r.multiPotHands}，深筹码手数：${r.deepStackHands}`);
    expect(r.multiPotHands).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 运行验收关卡**

```bash
npx vitest run src/session/scriptedPlay.test.ts
```

期望：全绿。**若断言 10 失败（多池为 0），停下来报数字，不要换 seed。**

预计耗时 60–120 秒。若超过 5 分钟，把 `iterations` 降到 100 再跑，并在报告里注明改了迭代数。

- [ ] **Step 4: 变异测试 —— 确认关卡真能抓到 bug**

绿色测试的说服力取决于它抓得住什么。临时把 `src/session/handSession.ts` 的 `advance` 里 `betSize: applied.amount` 改成 `betSize: input.amount ?? 0`（这是 ②-B-1 修过的那个真缺陷），重跑：

```bash
npx vitest run src/session/scriptedPlay.test.ts
```

记录结果，然后**把改动还原**。

这一步的产出是一句诚实的结论：这个关卡能不能抓到按尺度收窄失效？如果抓不到（很可能抓不到——该缺陷影响的是 AI 打得好不好，不是合法性），就在报告里如实说明，不要粉饰。

- [ ] **Step 5: 变异测试之二 —— 账本**

临时把 `rebuyHero` 里的 `addBuyIn(s.ledger, s.handIndex + 1, added)` 改成 `addBuyIn(s.ledger, s.handIndex + 1, targetStack)`（把实际添入额错记成目标额），重跑：

```bash
npx vitest run src/session/scriptedPlay.test.ts -t "账本恒等式"
```

期望：**FAIL**。这证明断言 8 确实在守着账本。然后还原改动。

若它居然通过了，说明测试没起作用，停下来报告。

- [ ] **Step 6: 跑全量并提交**

```bash
npm test
npm run typecheck
```

```bash
git add src/session/scriptedHero.ts src/session/scriptedPlay.test.ts
git commit -m "$(cat <<'EOF'
test(session): 验收关卡——脚本化玩家连打 200 手

对标前三期的硬关卡。脚本化 hero 用 EV 引擎以 GTO 原型代打，不用
「总是跟注」这类退化脚本——退化脚本永远走不到加注与全下路径，
而那正是动作合法性最容易出错的地方。

十一条断言里，跨手筹码守恒与账本恒等式是本次筹码延续改动的核心：
单手守恒不能保证跨手不漏钱，而账本恒等式用两条独立路径算净盈亏，
对不上就说明补码被算成了盈利。

多池断言写死了一条规矩：跑出 0 要停下来查边池，不许换 seed 直到
出现。变额筹码下若多池仍不可达，那个事实比一条绿测试重要。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: format.ts 与静态渲染组件

**Files:**
- Create: `src/ui/format.ts`
- Test: `src/ui/format.test.ts`
- Create: `src/ui/components/Card.tsx`
- Create: `src/ui/components/Board.tsx`
- Create: `src/ui/components/Pot.tsx`
- Create: `src/ui/components/Seat.tsx`
- Create: `src/ui/components/HeroHand.tsx`
- Create: `src/ui/components/TopBar.tsx`
- Create: `src/ui/components/Table.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `Card` / `SeatState` / `Position`（`src/core/types.ts`，**只用 `import type`**）、`HandSessionState`（Task 4/5）
- Produces:
  - `const CHIPS_PER_BB = 40`
  - `function chips(bb: number): string`
  - `function cardText(c: Card): string` / `function suitClass(c: Card): string`
  - 上述七个组件

- [ ] **Step 1: 写 format 的失败测试**

创建 `src/ui/format.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { SMALL_BLIND, BIG_BLIND, STARTING_STACK } from '../core/types';
import { CHIPS_PER_BB, chips } from './format';

describe('BB → 实额', () => {
  it('盲注显示为 20 / 40', () => {
    expect(chips(SMALL_BLIND)).toBe('20');
    expect(chips(BIG_BLIND)).toBe('40');
  });

  it('标准买入显示为 4,000', () => {
    expect(chips(STARTING_STACK)).toBe('4,000');
  });

  it('200BB 显示为 8,000', () => {
    expect(chips(200)).toBe('8,000');
  });

  it('换算比例是 40', () => {
    expect(CHIPS_PER_BB).toBe(40);
  });

  it('负数带符号', () => {
    expect(chips(-12.5)).toBe('-500');
  });

  it('非整数实额取整到个位', () => {
    expect(chips(0.3)).toBe('12');
    expect(chips(1.51)).toBe('60');
  });

  it('零显示为 0', () => {
    expect(chips(0)).toBe('0');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run src/ui/format.test.ts
```

期望：FAIL，找不到 `./format`。

- [ ] **Step 3: 写 format.ts**

创建 `src/ui/format.ts`：

```ts
import type { Card } from '../core/types';

/**
 * 一个大盲等于多少筹码。
 *
 * 这是整个项目里唯一的 BB ↔ 实额换算点。内部量纲（core / ai / review /
 * session）一律是 BB —— 范围表的标定、EV 的单位、534 个测试全都建立在
 * BB 上。实额只是显示。若日后要改盲注级别，只动这一个常量。
 *
 * 例外：EV 损失与复盘数字保持 BB。「你这一步亏了 2.3BB」比「亏了 92」
 * 有意义得多，且跨盲注级别可比。
 */
export const CHIPS_PER_BB = 40;

/** BB → 实额字符串，带千位分隔，取整到个位 */
export function chips(bb: number): string {
  const v = Math.round(bb * CHIPS_PER_BB);
  return v.toLocaleString('en-US');
}

const RANK_TEXT: Record<number, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: 'T',
};

/** 牌面文字，如 'A♠' */
export function cardText(c: Card): string {
  const rank = RANK_TEXT[c.rank] ?? String(c.rank);
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit];
  return `${rank}${suit}`;
}

/** 四色牌的 CSS 类名：♠黑 ♥红 ♦蓝 ♣绿 */
export function suitClass(c: Card): string {
  return `suit-${c.suit}`;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run src/ui/format.test.ts
```

期望：PASS，7 个测试全绿。

- [ ] **Step 5: 写牌与公共牌组件**

创建 `src/ui/components/Card.tsx`：

```tsx
import type { Card as CardModel } from '../../core/types';
import { cardText, suitClass } from '../format';

export function CardView({ card, size = 'md' }: { card: CardModel; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} ${suitClass(card)}`}>{cardText(card)}</span>;
}

/** 背面朝上的牌 */
export function CardBack({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-back`} />;
}
```

创建 `src/ui/components/Board.tsx`：

```tsx
import type { Card as CardModel } from '../../core/types';
import { CardView } from './Card';

export function Board({ board }: { board: readonly CardModel[] }) {
  return (
    <div className="board">
      {board.map((c, i) => (
        <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="lg" />
      ))}
    </div>
  );
}
```

创建 `src/ui/components/Pot.tsx`：

```tsx
import { chips } from '../format';

export function Pot({ amount }: { amount: number }) {
  return (
    <div className="pot">
      <span className="pot-label">底池</span>
      <span className="pot-amount">{chips(amount)}</span>
    </div>
  );
}
```

- [ ] **Step 6: 写座位与 hero 手牌组件**

创建 `src/ui/components/Seat.tsx`：

```tsx
import type { ActionType, SeatState } from '../../core/types';
import { chips } from '../format';
import { CardBack, CardView } from './Card';

const ACTION_TEXT: Record<ActionType, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  allin: '全下',
};

export interface SeatProps {
  seat: SeatState;
  isButton: boolean;
  isToAct: boolean;
  /** 本座位最近一个动作；不是本座位或本手尚无动作时为 null */
  bubble: { type: ActionType; amount: number } | null;
  /** 摊牌后亮底牌 */
  revealed: boolean;
}

export function Seat({ seat, isButton, isToAct, bubble, revealed }: SeatProps) {
  const cls = [
    'seat',
    seat.folded ? 'seat-folded' : '',
    isToAct ? 'seat-to-act' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      {bubble && (
        <div className="bubble">
          {ACTION_TEXT[bubble.type]}
          {bubble.amount > 0 && ` ${chips(bubble.amount)}`}
        </div>
      )}
      <div className="seat-cards">
        {revealed && !seat.folded ? (
          seat.holeCards.map((c, i) => (
            <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="sm" />
          ))
        ) : (
          <>
            <CardBack />
            <CardBack />
          </>
        )}
      </div>
      <div className="seat-info">
        <span className="seat-pos">
          {seat.position}
          {isButton && <span className="button-chip">D</span>}
        </span>
        <span className="seat-stack">{chips(seat.stack)}</span>
      </div>
      {seat.streetContribution > 0 && (
        <div className="seat-bet">{chips(seat.streetContribution)}</div>
      )}
    </div>
  );
}
```

创建 `src/ui/components/HeroHand.tsx`：

```tsx
import type { SeatState } from '../../core/types';
import { chips } from '../format';
import { CardView } from './Card';

export function HeroHand({ seat, isButton }: { seat: SeatState; isButton: boolean }) {
  return (
    <div className="hero">
      <div className="hero-cards">
        {seat.holeCards.map((c, i) => (
          <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="lg" />
        ))}
      </div>
      <div className="hero-info">
        <span className="hero-pos">
          {seat.position}
          {isButton && <span className="button-chip">D</span>}
        </span>
        <span className="hero-stack">{chips(seat.stack)}</span>
        {seat.streetContribution > 0 && (
          <span className="hero-bet">投入 {chips(seat.streetContribution)}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 写顶栏与牌桌容器**

创建 `src/ui/components/TopBar.tsx`：

```tsx
import { chips } from '../format';

export interface TopBarProps {
  handsPlayed: number;
  /** hero 净盈亏，BB */
  netBB: number;
  /** hero 累计买入，BB */
  totalBuyIn: number;
  deepStack: boolean;
}

export function TopBar({ handsPlayed, netBB, totalBuyIn, deepStack }: TopBarProps) {
  return (
    <div className="topbar">
      <span className="topbar-item">第 {handsPlayed + 1} 手</span>
      <span className={`topbar-item ${netBB < 0 ? 'neg' : 'pos'}`}>
        {netBB >= 0 ? '+' : ''}
        {chips(netBB)}
      </span>
      <span className="topbar-item dim">买入 {chips(totalBuyIn)}</span>
      {deepStack && (
        <span className="topbar-item warn" title="筹码深度超过 150BB，复盘精度下降">
          深筹码
        </span>
      )}
    </div>
  );
}
```

创建 `src/ui/components/Table.tsx`：

```tsx
import type { ActionType, GameState } from '../../core/types';
import { HERO_SEAT } from '../../core/types';
import { Board } from './Board';
import { Pot } from './Pot';
import { Seat } from './Seat';

export interface TableProps {
  game: GameState;
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 手牌结束且走到摊牌时为 true */
  revealed: boolean;
}

export function Table({ game, lastAction, revealed }: TableProps) {
  const others = game.seats.filter(s => s.seat !== HERO_SEAT);
  const pot = game.seats.reduce((a, s) => a + s.totalContribution, 0);

  return (
    <div className="table">
      <div className="opponents">
        {others.map((seat, i) => (
          <div key={seat.seat} className={`opponent-slot slot-${i}`}>
            <Seat
              seat={seat}
              isButton={seat.seat === game.buttonSeat}
              isToAct={game.toAct === seat.seat}
              bubble={lastAction?.seat === seat.seat ? lastAction : null}
              revealed={revealed}
            />
          </div>
        ))}
      </div>
      <div className="table-center">
        <Pot amount={pot} />
        <Board board={game.board} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 写样式**

把 `src/ui/styles/app.css` 追加为（保留 Step 6 已有的 `:root` 与 reset，在其后追加）：

```css
/* ---- 布局骨架 ---- */
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: var(--safe-top);
}

.topbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.25);
}
.topbar-item.pos { color: #7fd18a; }
.topbar-item.neg { color: var(--danger); }
.topbar-item.dim { color: var(--text-dim); margin-left: auto; }
.topbar-item.warn {
  color: var(--gold);
  border: 1px solid var(--gold);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
}

.table {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ---- 弧形座位：5 个对手沿上半部的一段圆弧排布 ---- */
.opponents {
  position: relative;
  height: 46%;
}
.opponent-slot {
  position: absolute;
  transform: translate(-50%, -50%);
}
.slot-0 { left: 12%; top: 62%; }
.slot-1 { left: 27%; top: 24%; }
.slot-2 { left: 50%; top: 12%; }
.slot-3 { left: 73%; top: 24%; }
.slot-4 { left: 88%; top: 62%; }

.seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 76px;
  font-size: 11px;
  transition: opacity 0.2s;
}
.seat-folded { opacity: 0.35; }
.seat-to-act .seat-info { box-shadow: 0 0 0 2px var(--gold); }

.seat-cards { display: flex; gap: 2px; }
.seat-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  padding: 2px 6px;
  line-height: 1.3;
}
.seat-pos { color: var(--text-dim); }
.seat-stack { font-variant-numeric: tabular-nums; }
.seat-bet {
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}
.bubble {
  background: var(--text);
  color: #12261f;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  white-space: nowrap;
}
.button-chip {
  display: inline-block;
  margin-left: 4px;
  width: 14px;
  height: 14px;
  line-height: 14px;
  border-radius: 50%;
  background: var(--text);
  color: #12261f;
  font-size: 10px;
  text-align: center;
}

/* ---- 中部：底池与公共牌 ---- */
.table-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.pot { display: flex; gap: 6px; align-items: baseline; }
.pot-label { color: var(--text-dim); font-size: 12px; }
.pot-amount { font-size: 20px; font-variant-numeric: tabular-nums; }
.board { display: flex; gap: 6px; }

/* ---- 四色牌 ---- */
.card {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f7f7f2;
  border-radius: 4px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.card-sm { width: 22px; height: 30px; font-size: 12px; }
.card-md { width: 30px; height: 42px; font-size: 15px; }
.card-lg { width: 40px; height: 56px; font-size: 19px; }
.card-back {
  background: repeating-linear-gradient(45deg, #24506f, #24506f 3px, #1b3d55 3px, #1b3d55 6px);
}
.suit-s { color: #1a1a1a; }
.suit-h { color: #c8281e; }
.suit-d { color: #1962b8; }
.suit-c { color: #17803d; }

/* ---- hero ---- */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
}
.hero-cards { display: flex; gap: 6px; }
.hero-info {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 13px;
}
.hero-pos { color: var(--text-dim); }
.hero-stack { font-size: 16px; font-variant-numeric: tabular-nums; }
.hero-bet { color: var(--gold); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 9: 验证 typecheck 与构建**

```bash
npm run typecheck
npm run build
```

期望：都通过。组件此时还没有被 `main.tsx` 用上，只需保证能编译。

- [ ] **Step 10: 提交**

```bash
git add src/ui/format.ts src/ui/format.test.ts src/ui/components src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 实额格式化与静态渲染组件

format.ts 是整个项目唯一的 BB ↔ 实额换算点，CHIPS_PER_BB = 40。
内部量纲一律 BB——范围表标定、EV 单位、既有测试全建立在 BB 上，
实额只是显示。EV 损失例外，保持 BB，因为「亏了 2.3BB」比「亏了 92」
有意义且跨盲注级别可比。

四色牌 ♠黑 ♥红 ♦蓝 ♣绿。五个对手座位沿上半部圆弧定位。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: App.tsx —— reducer、Context 与 AI 定时器

**Files:**
- Create: `src/ui/App.tsx`
- Modify: `src/ui/main.tsx`
- Modify: `src/session/architecture.test.ts`

**Interfaces:**
- Consumes: Task 4/5 的会话接口、Task 7 的组件
- Produces: 可运行的应用——AI 自动行动、hero 回合停下（动作条在 Task 9）

**时间只存在于这一层。** 会话层没有 `setTimeout`、没有 `async`。思考延迟由这里的一个 effect 施加，延迟值由 seed 派生以保持可复现。

- [ ] **Step 1: 写 App.tsx**

创建 `src/ui/App.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ActionInput } from '../core/gameEngine';
import { HERO_SEAT } from '../core/types';
import {
  startSession,
  stepAi,
  applyHero,
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  isDeepStackHand,
} from '../session/handSession';
import type { HandSessionState, SessionConfig } from '../session/handSession';
import { heroNet } from '../session/ledger';
import { TopBar } from './components/TopBar';
import { Table } from './components/Table';
import { HeroHand } from './components/HeroHand';

const CFG: SessionConfig = {
  // 每次刷新换一局。③-C 会把 seed 一并持久化，届时刷新可续上。
  seed: `s${Date.now()}`,
  now: Date.now,
};

/** AI 思考延迟区间（毫秒）。极速模式在 ③-D 的设置里接通 */
const THINK_MIN = 300;
const THINK_MAX = 600;

type Action =
  | { kind: 'stepAi' }
  | { kind: 'hero'; input: ActionInput }
  | { kind: 'nextHand' }
  | { kind: 'rebuy'; targetStack: number };

function reducer(s: HandSessionState, a: Action): HandSessionState {
  switch (a.kind) {
    case 'stepAi':
      // StrictMode 下 effect 会双跑，这个守卫让第二次成为无操作。
      // stepAi 本身也是幂等的（派生 seed，不存有状态 Rng），
      // 两道保险都要有：守卫防的是状态被推进两步。
      return s.phase === 'aiToAct' ? stepAi(s, CFG) : s;
    case 'hero':
      return s.phase === 'awaitingHero' ? applyHero(s, a.input, CFG) : s;
    case 'nextHand':
      return s.phase === 'handOver' && !heroNeedsRebuy(s) ? nextHand(s, CFG) : s;
    case 'rebuy':
      return heroNeedsRebuy(s) ? rebuyHero(s, a.targetStack) : s;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, CFG, startSession);

  // 时间只存在于这一层：会话层没有 setTimeout、没有 async。
  // 延迟值由 seed 与步数派生，使同一局的节奏也是可复现的。
  useEffect(() => {
    if (state.phase !== 'aiToAct') return;
    const span = THINK_MAX - THINK_MIN;
    const jitter = (state.handIndex * 7919 + state.stepIndex * 104729) % (span + 1);
    const id = setTimeout(() => dispatch({ kind: 'stepAi' }), THINK_MIN + jitter);
    return () => clearTimeout(id);
  }, [state.phase, state.handIndex, state.stepIndex]);

  const hero = state.game.seats[HERO_SEAT];
  const netBB = useMemo(
    () => heroNet(state.ledger, state.stacks[HERO_SEAT]),
    [state.ledger, state.stacks],
  );
  const revealed =
    state.phase === 'handOver' &&
    (state.record?.results.some(r => r.showdown) ?? false);

  const onHero = useCallback((input: ActionInput) => dispatch({ kind: 'hero', input }), []);
  const onNext = useCallback(() => dispatch({ kind: 'nextHand' }), []);
  const onRebuy = useCallback(
    (targetStack: number) => dispatch({ kind: 'rebuy', targetStack }),
    [],
  );

  return (
    <div className="app">
      <TopBar
        handsPlayed={state.ledger.handsPlayed}
        netBB={netBB}
        totalBuyIn={state.ledger.totalBuyIn}
        deepStack={isDeepStackHand(state)}
      />
      <Table game={state.game} lastAction={state.lastAction} revealed={revealed} />
      <HeroHand seat={hero} isButton={state.game.buttonSeat === HERO_SEAT} />
      <BottomSlot state={state} onHero={onHero} onNext={onNext} onRebuy={onRebuy} />
    </div>
  );
}

/** 底部区域：Task 9 接动作条，Task 10 接结算条与补码 */
function BottomSlot(_props: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
}) {
  return <div className="bottom" />;
}
```

- [ ] **Step 2: 接到 main.tsx**

把 `src/ui/main.tsx` 改为：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: 加 UI 层的分层守卫**

在 `src/session/architecture.test.ts` 的 `describe` 里追加一条：

```ts
  it('src/ui/ 不从引擎与 AI 取值，只允许类型导入', () => {
    const banned = ['core/gameEngine', 'ai/decide', 'ai/selfPlayAi'];
    const offenders: string[] = [];

    for (const file of sourceFiles('src/ui')) {
      const src = readFileSync(file, 'utf-8');
      for (const mod of banned) {
        // 匹配「不是 import type 的」导入语句。import type 编译后不产生
        // 运行时依赖，Card / Position 这类类型是渲染必需的，不该被禁。
        const re = new RegExp(`import\\s+(?!type\\b)[^;]*?from\\s+['"][^'"]*${mod}['"]`, 's');
        if (re.test(src)) offenders.push(`${file} -> ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });
```

**注意 `App.tsx` 里 `import type { ActionInput } from '../core/gameEngine'` 是 `import type`，不会被这条守卫拦下——这正是它区分类型导入与值导入的意义。**

- [ ] **Step 4: 跑测试与构建**

```bash
npm test
npm run typecheck
npm run build
```

期望：全绿。若 UI 守卫报出 `App.tsx -> core/gameEngine`，说明某处漏写了 `type` 关键字，补上而不是放宽守卫。

- [ ] **Step 5: 人工验证 AI 会自己动**

```bash
npm run dev
```

打开输出的 `http://localhost:5173`，确认：牌桌渲染出来、五个对手座位有位置标签与筹码、AI 每隔 0.3–0.6 秒行动一次并冒出动作气泡、轮到 hero 时停住不动。

**若 AI 一次跳两步（气泡连闪），说明 StrictMode 的双跑没被守住，停下来查 reducer 的守卫。**

- [ ] **Step 6: 提交**

```bash
git add src/ui/App.tsx src/ui/main.tsx src/session/architecture.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): reducer + AI 定时器，牌局能自己跑起来

时间只存在于这一层：会话层没有 setTimeout、没有 async，思考延迟由
App 的 effect 施加，延迟值由 handIndex/stepIndex 派生因而可复现。
极速模式将来只需把延迟置 0，不改会话层一行。

StrictMode 的 effect 双跑有两道保险：reducer 的 phase 守卫防止状态
被推进两步，stepAi 自身的幂等（派生 seed，不存有状态 Rng）兜底。

分层守卫按 import type 与值导入区分，不一刀切——Card/Position 这类
类型是渲染必需的，且编译后不产生运行时依赖。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 动作条与加注滑块

**Files:**
- Create: `src/ui/components/ActionBar.tsx`
- Create: `src/ui/components/RaiseControl.tsx`
- Modify: `src/ui/App.tsx`（把 `BottomSlot` 接上 `ActionBar`）
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `actionBarModel`（Task 2）、`chips`（Task 7）
- Produces: `ActionBar` / `RaiseControl` 组件

**动作条固定在底部拇指可达区，不随内容滚动。all-in 二次确认，其他动作不确认。**

- [ ] **Step 1: 写 RaiseControl**

创建 `src/ui/components/RaiseControl.tsx`：

```tsx
import { useEffect, useState } from 'react';
import type { RaiseModel } from '../../session/actionBarModel';
import { chips } from '../format';

export interface RaiseControlProps {
  model: RaiseModel;
  label: string;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}

export function RaiseControl({ model, label, onSubmit, onCancel }: RaiseControlProps) {
  const [amount, setAmount] = useState(model.min);

  // 局面变了就把滑块拉回最小值，避免残留一个已经非法的额度
  useEffect(() => setAmount(model.min), [model.min, model.max]);

  const clamped = Math.min(Math.max(amount, model.min), model.max);

  return (
    <div className="raise-panel">
      <div className="raise-presets">
        {model.presets.map(p => (
          <button key={p.label} className="preset" onClick={() => setAmount(p.amount)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="raise-slider">
        <input
          type="range"
          min={model.min}
          max={model.max}
          step={0.5}
          value={clamped}
          onChange={e => setAmount(Number(e.target.value))}
        />
        <span className="raise-amount">{chips(clamped)}</span>
      </div>
      <div className="raise-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={() => onSubmit(clamped)}>
          {label} {chips(clamped)}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 ActionBar**

创建 `src/ui/components/ActionBar.tsx`：

```tsx
import { useEffect, useState } from 'react';
import type { ActionInput } from '../../core/gameEngine';
import type { ActionBarModel } from '../../session/actionBarModel';
import { chips } from '../format';
import { RaiseControl } from './RaiseControl';

type Panel = 'none' | 'raise' | 'allin';

export function ActionBar({
  model,
  onAction,
}: {
  model: ActionBarModel;
  onAction: (input: ActionInput) => void;
}) {
  const [panel, setPanel] = useState<Panel>('none');

  // 轮到别人时把展开的面板收起来，防止下一次轮到自己时残留旧面板
  useEffect(() => {
    if (!model.enabled) setPanel('none');
  }, [model.enabled]);

  if (!model.enabled) {
    return (
      <div className="actionbar actionbar-idle">
        <span className="waiting">等待其他玩家…</span>
      </div>
    );
  }

  if (panel === 'raise' && model.raise) {
    return (
      <div className="actionbar">
        <RaiseControl
          model={model.raise}
          label={model.raise.type === 'bet' ? '下注' : '加注'}
          onCancel={() => setPanel('none')}
          onSubmit={amount => {
            setPanel('none');
            onAction({ type: model.raise!.type, amount });
          }}
        />
      </div>
    );
  }

  if (panel === 'allin' && model.allin) {
    return (
      <div className="actionbar">
        <div className="confirm">
          <span className="confirm-text">全下 {chips(model.allin.amount)}？</span>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setPanel('none')}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setPanel('none');
                onAction({ type: 'allin' });
              }}
            >
              确认全下
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="actionbar">
      <div className="actionbar-row">
        {model.fold && (
          <button className="btn btn-ghost" onClick={() => onAction({ type: 'fold' })}>
            弃牌
          </button>
        )}
        {model.passive && (
          <button
            className="btn btn-primary"
            onClick={() => onAction({ type: model.passive!.type })}
          >
            {model.passive.type === 'check'
              ? '过牌'
              : `跟注 ${chips(model.passive.amount)}`}
          </button>
        )}
        {model.raise && (
          <button className="btn btn-primary" onClick={() => setPanel('raise')}>
            {model.raise.type === 'bet' ? '下注' : '加注'}
          </button>
        )}
        {model.allin && (
          <button className="btn btn-danger" onClick={() => setPanel('allin')}>
            全下
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 把 ActionBar 接进 App**

在 `src/ui/App.tsx` 顶部追加 import：

```tsx
import { actionBarModel } from '../session/actionBarModel';
import { ActionBar } from './components/ActionBar';
```

把 `BottomSlot` 换成：

```tsx
function BottomSlot({
  state,
  onHero,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
}) {
  const model = actionBarModel(state.game);
  return (
    <div className="bottom">
      <ActionBar model={model} onAction={onHero} />
    </div>
  );
}
```

- [ ] **Step 4: 加样式**

在 `src/ui/styles/app.css` 末尾追加：

```css
/* ---- 底部动作条：固定定位，位于拇指可达区 ---- */
.bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 10px calc(8px + var(--safe-bottom));
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}

.actionbar-idle {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 12px 0;
}

.actionbar-row {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  min-height: 52px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  background: var(--felt-light);
  cursor: pointer;
}
.btn-primary { background: #1b6b4a; }
.btn-danger { background: var(--danger); }
.btn-ghost { background: rgba(255, 255, 255, 0.12); }
.btn:active { filter: brightness(1.2); }

.raise-panel { display: flex; flex-direction: column; gap: 8px; }
.raise-presets { display: flex; gap: 6px; }
.preset {
  flex: 1;
  min-height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.raise-slider { display: flex; align-items: center; gap: 10px; }
.raise-slider input { flex: 1; }
.raise-amount {
  min-width: 72px;
  text-align: right;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.raise-actions { display: flex; gap: 8px; }

.confirm { display: flex; flex-direction: column; gap: 8px; }
.confirm-text { text-align: center; font-size: 15px; }
.confirm-actions { display: flex; gap: 8px; }
```

- [ ] **Step 5: 跑测试与构建**

```bash
npm test
npm run typecheck
npm run build
```

期望：全绿。

- [ ] **Step 6: 人工验证动作条**

```bash
npm run dev
```

逐条确认：
- 轮到 hero 时按钮出现；非 hero 回合显示「等待其他玩家…」
- 点「弃牌」牌局立刻推进，不卡住
- 点「加注」出现滑块面板；快捷尺度按钮改变金额；滑块拖到最小与最大都能提交且不报错
- 点「全下」出现二次确认，点「取消」能退回

**任何一条提交后控制台报「非法动作」，停下来排查——那说明 `actionBarModel` 与引擎产生了分歧，是真 bug。**

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/ActionBar.tsx src/ui/components/RaiseControl.tsx src/ui/App.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 动作条与加注滑块

固定定位在拇指可达区，不随内容滚动。滑块上下界与快捷尺度全部来自
actionBarModel，界面不自行推导合法性。all-in 二次确认，其他动作
不确认。

局面变化时把展开的面板收起、把滑块拉回最小值，避免残留一个已经
非法的额度被提交上去。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 结算条与补码选择

**Files:**
- Create: `src/ui/components/SummaryBar.tsx`
- Create: `src/ui/components/RebuyPrompt.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `REBUY_OPTIONS` / `heroNeedsRebuy`（Task 5）、`chips`（Task 7）
- Produces: `SummaryBar` / `RebuyPrompt` 组件；③-A 的完整交互闭环

**补码选择没有取消按钮**：会话里没有「不补码」这个合法状态，给一个点了什么都不发生的按钮只会让人困惑。

- [ ] **Step 1: 写 SummaryBar**

创建 `src/ui/components/SummaryBar.tsx`：

```tsx
import { chips } from '../format';

export function SummaryBar({
  netBB,
  showdown,
  onNext,
}: {
  /** 本手 hero 的净盈亏，BB */
  netBB: number;
  showdown: boolean;
  onNext: () => void;
}) {
  return (
    <div className="summary">
      <div className="summary-line">
        <span className={netBB >= 0 ? 'pos' : 'neg'}>
          本手 {netBB >= 0 ? '+' : ''}
          {chips(netBB)}
        </span>
        <span className="summary-note">{showdown ? '摊牌' : '未摊牌'}</span>
      </div>
      <button className="btn btn-primary" onClick={onNext}>
        下一手
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 写 RebuyPrompt**

创建 `src/ui/components/RebuyPrompt.tsx`：

```tsx
import { chips } from '../format';

export function RebuyPrompt({
  options,
  buyInCount,
  totalBuyIn,
  onRebuy,
}: {
  /** 可选的目标筹码额，BB */
  options: readonly number[];
  /** 已发生的买入次数（含开局那次） */
  buyInCount: number;
  /** 累计买入额，BB */
  totalBuyIn: number;
  onRebuy: (targetStack: number) => void;
}) {
  return (
    <div className="rebuy">
      <div className="rebuy-note">
        筹码不足，需要补码 · 这是第 {buyInCount + 1} 次买入 · 累计买入{' '}
        {chips(totalBuyIn)}
      </div>
      <div className="rebuy-actions">
        {options.map(o => (
          <button key={o} className="btn btn-primary" onClick={() => onRebuy(o)}>
            补 {chips(o)}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**没有取消按钮是刻意的**：会话里没有「不补码」这个合法状态。

- [ ] **Step 3: 接进 App**

在 `src/ui/App.tsx` 顶部追加 import：

```tsx
import { REBUY_OPTIONS } from '../session/handSession';
import { SummaryBar } from './components/SummaryBar';
import { RebuyPrompt } from './components/RebuyPrompt';
```

把 `BottomSlot` 换成：

```tsx
function BottomSlot({
  state,
  onHero,
  onNext,
  onRebuy,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
}) {
  if (state.phase === 'handOver') {
    if (heroNeedsRebuy(state)) {
      return (
        <div className="bottom">
          <RebuyPrompt
            options={REBUY_OPTIONS}
            buyInCount={state.ledger.buyIns.length}
            totalBuyIn={state.ledger.totalBuyIn}
            onRebuy={onRebuy}
          />
        </div>
      );
    }
    const netBB = state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0;
    const showdown = state.record?.results.some(r => r.showdown) ?? false;
    return (
      <div className="bottom">
        <SummaryBar netBB={netBB} showdown={showdown} onNext={onNext} />
      </div>
    );
  }

  const model = actionBarModel(state.game);
  return (
    <div className="bottom">
      <ActionBar model={model} onAction={onHero} />
    </div>
  );
}
```

**补码后仍停在 `handOver`，此时 `heroNeedsRebuy` 转为 false，界面自动换成结算条，用户再点「下一手」。** 这一步不自动跳转是刻意的：补完码立刻发牌会让人来不及看清自己补了多少。

- [ ] **Step 4: 加样式**

在 `src/ui/styles/app.css` 末尾追加：

```css
.summary { display: flex; flex-direction: column; gap: 8px; }
.summary-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.summary-line .pos { color: #7fd18a; }
.summary-line .neg { color: var(--danger); }
.summary-note { color: var(--text-dim); font-size: 13px; }

.rebuy { display: flex; flex-direction: column; gap: 8px; }
.rebuy-note { color: var(--text-dim); font-size: 12px; text-align: center; }
.rebuy-actions { display: flex; gap: 8px; }
```

- [ ] **Step 5: 跑测试与构建**

```bash
npm test
npm run typecheck
npm run build
```

期望：全绿。

- [ ] **Step 6: 走完 spec §9 的手工验证清单**

```bash
npm run dev
```

在浏览器里逐条确认，把结果记下来（**通过 / 不通过 + 现象**，不要只写「已验证」）：

1. 六个座位的位置标签与按钮位一致，且逐手轮转
2. 轮到 hero 时动作条出现，非 hero 回合时禁用
3. 弃牌后本手立即推进到结算，不卡住
4. 加注滑块拖到最小值与最大值都能提交，且提交后引擎不报错
5. 快捷尺度按钮算出的额度与底池显示自洽
6. all-in 二次确认可取消
7. 打到摊牌时对手底牌亮出，未摊牌时不亮
8. 连打 10 手，顶栏手数与累计盈亏随之变化且数值合理
9. 手机尺寸视口下（DevTools 切 iPhone 视口）动作条不被遮挡、不需要横向滚动
10. 所有金额显示为实额：盲注 20/40、开局筹码 4,000、底池与下注额都是 40 的整数倍
11. 故意打光筹码（连续全下），补码选择出现；分别选 4,000 与 8,000，下一手起始筹码正确
12. 补码之后顶栏累计盈亏**没有**跳涨
13. 赢到超过 6,000 时顶栏出现「深筹码」标记，回落后消失

**第 12 条若失败，是账本 bug，不是显示问题——回到 Task 3/5 查 `addBuyIn` 记的是不是实际添入额。**

第 11 条不容易撞上（需要连输到破产）。若十几手打不出来，可临时把 `App.tsx` 里 `CFG` 的 seed 固定为某个值反复重开，或临时把 `startSession` 的初始筹码调小来触发——**验证完必须还原，且在报告里说明用了什么手段触发**。

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/SummaryBar.tsx src/ui/components/RebuyPrompt.tsx src/ui/App.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 结算条与补码选择，③-A 交互闭环

补码选择没有取消按钮——会话里没有「不补码」这个合法状态，给一个
点了什么都不发生的按钮只会让人困惑。

补完码不自动发牌，先退回结算条让用户看清补了多少、这是第几次买入、
累计买入多少，再由他点「下一手」。

「下一手」按钮的位置就是 ③-B 复盘卡片主按钮的位置，不会白写。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: README 更新与已知边界修订

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 前十个任务的成果
- Produces: 与代码一致的 README

**这个任务不是收尾的装饰。** README 里有两条记载会被 ③-A 直接推翻，留着不改就是错误文档：

1. 「边池分层在产品默认配置下不可达」——筹码延续后它可达了
2. 「固定 100BB 等额起始筹码」——改成了延续 + 补码

- [ ] **Step 1: 更新状态表**

把 README「当前状态」一节的表格中 ③ 那一行拆开：

```markdown
| ③-A 牌桌与会话 | 对局会话层 · 牌桌 UI · 动作条 · 筹码延续与补码 | ✅ 完成 |
| ③-B 复盘卡片 | 街道时间线 · EV 条形图 · 解释文案 | 未开始 |
| ③-C 持久化 | IndexedDB · 历史页 · 导出导入 | 未开始 |
| ③-D 上线 | 漏洞报表 · 设置 · PWA · 部署 | 未开始 |
```

并把开头「界面尚未开始」那句改成实际状态。**测试总数用 `npm test` 的真实输出填，不要估。**

- [ ] **Step 2: 修订「已知的覆盖边界」**

把这一条：

```markdown
- **边池分层在产品默认配置下不可达。** 固定 100BB 等额起始筹码，加上 all-in 永远投入全部筹码，导致所有活跃玩家总投入恒等，`buildPots` 每次都合并成单个池。
```

改成：

```markdown
- **边池分层自 ③-A 起进入产品路径。** 此前固定 100BB 等额起始筹码使 `buildPots` 每次都合并成单池；③-A 改为筹码跨手延续 + 破产补码（100BB 或 200BB）后，各座位筹码不再恒等，分层真正启用。验收关卡断言 200 手中必须出现多池——若为 0 则停下来查边池，不许换 seed 绕过。
```

- [ ] **Step 3: 追加 ③-A 一节**

在「复盘引擎（②-B-2）这边」之后追加：

```markdown
牌桌与会话（③-A）这边：

- **对局编排是纯 TS，React 只是壳。** `src/session/` 不得 import React、不得出现计时器与 DOM，`src/ui/` 不得从引擎取值（类型导入除外）。两条由 `src/session/architecture.test.ts` 的结构性守卫盯着。这样做的理由是前三期 534 个测试的说服力全部建立在「纯逻辑、可在 node 里完整驱动」之上，把对局循环写进 React hook 就得把验收关卡搬进 jsdom。
- **会话状态里不存 `Rng`。** 它有内部可变状态，进了 React 状态后 StrictMode 的 effect 双调用会让它多走一步，同 seed 不再复现。改用 `stepIndex` 派生 seed，`stepAi` / `applyHero` 因此是幂等纯函数。**代价：会话层与 `playAiHand` 用的是不同的随机流，同一个 seed 在两者下产生的牌局不相同**，两条路径各自内部可复现，互不对表。
- **实额只存在于 `src/ui/format.ts`。** 界面显示 20/40 盲注、4000 后手，内部量纲仍是 0.5/1 BB 与 100BB——20/40/4000 在 BB 量纲上与原设计完全一致，所以这是显示单位而非引擎改动。EV 损失例外，保持 BB。
- **净盈亏按「当前筹码 − 累计买入」算，不累加每手 `netBB`。** 补码是往桌上添钱不是盈利；账本记的是实际添入额（目标额 − 补码前筹码）而非目标额，否则恒等式会差掉零头。验收关卡用两条独立路径算同一个数来守这条。
- **深筹码只标记不修正。** 翻前范围表与 EV 引擎按 100BB 标定，筹码延续后深度会漂移。任一座位开局 ≥ 150BB 即打标记，`isDeepStackHand` 产出、③-B 的复盘卡片消费。本代码库没有深筹码范围表，标记是诚实的下限而不是解决方案。
- **渲染层没有自动化测试。** 只有 `actionBarModel` 与 `format` 这两层纯逻辑被测到，组件树靠人工清单验证。这是为避免引入 jsdom 与脆弱组件测试的刻意取舍，代价是渲染回归只能靠人发现。
- **每手重掷对手性格，但筹码延续。** 等于每手换人却把筹码留在座位上，扑克语义上略显奇怪，也让用户无法建立读牌记忆。取舍换来的是对手多样性。
```

- [ ] **Step 4: 更新文档链接与技术栈**

在「文档」一节追加：

```markdown
- 设计 ③-A（牌桌与会话）：`docs/superpowers/specs/2026-08-11-poker-trainer-03a-table-ui-design.md`
- 计划 ③-A：`docs/superpowers/plans/2026-08-11-poker-trainer-03a-table-ui.md`
```

把「技术栈」一节末尾那句「三期将加入 React、Vite、IndexedDB」改成实际状态：React 与 Vite 已加入，IndexedDB 待 ③-C。

- [ ] **Step 5: 更新「快速开始」**

```markdown
```bash
npm install
npm run dev       # 开发服务器，浏览器打开 http://localhost:5173
npm test          # 全部测试
npm run typecheck
npm run build     # 静态产物到 dist/
```
```

测试数量与耗时用 `npm test` 的真实输出填。

- [ ] **Step 6: 核对数字**

```bash
npm test
```

把输出里的测试总数与跳过数与 README 里写的对照，**不一致就以输出为准改 README**。

- [ ] **Step 7: 提交**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README 更新到 ③-A 完成状态

修订两条被 ③-A 推翻的记载：「边池分层在产品默认配置下不可达」
（筹码延续后可达了）与「固定 100BB 等额起始筹码」（改成延续 +
补码）。留着不改就是错误文档。

新增 ③-A 的已知边界一节，其中最该被读到的是：会话层与 playAiHand
随机流不同，同 seed 不产生相同牌局；以及渲染层没有自动化测试。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完成标准

全部十一个任务做完后，以下每一条都要有证据，不能只是「应该没问题」：

1. `npm test` 全绿，输出的测试总数记在报告里
2. `npm run typecheck` 无输出
3. `npm run build` 产出 `dist/`，且 `npm run preview` 能打开
4. `src/session/scriptedPlay.test.ts` 的十一条断言全部通过，其中多池手数是一个**具体数字**，不是「大于 0」
5. Task 6 的两次变异测试结果如实记录——尤其是第一次（`betSize` 缺陷）如果关卡抓不到，要明说抓不到
6. spec §9 的 13 条手工验证清单逐条有结论，不通过的要写现象
7. `package-lock.json` 里 `registry.npmjs.org` 的出现次数为 0
