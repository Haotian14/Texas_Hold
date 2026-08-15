# 牌桌视觉改版与音效 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ③-A 交付的朴素牌桌改成「现代深色」风格，并加上八个音效——不改任何布局、交互流程与文案。

**Architecture:** 纯 UI 改动。全部代码落在 `src/ui/`，`src/session/` 及以下四层一行不动。唯一有真逻辑的两处（面额拆分、动作→音效映射）做成纯函数并单测；组件与音频播放沿用「渲染层无自动化测试」的既有取舍，靠人工验收清单守。

**Tech Stack:** TypeScript strict · React 19 · Vite 7 · Vitest · 纯 CSS（不引动画库）· Web Audio（`AudioContext` + `decodeAudioData`）

设计文档：`docs/superpowers/specs/2026-08-15-poker-trainer-ui-polish-design.md`

## Global Constraints

- TypeScript strict。`src/core/`、`src/ai/`、`src/review/`、`src/session/` 内禁止 `Math.random()`。
- 依赖方向：`src/ui/` → `src/session/`。**`src/ui/` 不得从 `src/core/gameEngine`、`src/ai/decide`、`src/ai/selfPlayAi` 取值**（`import type` 不受限）。`ActionType`、`SeatState`、`GameState` 来自 `src/core/types`，`chipsGreater` / `isZeroChips` / `round2` 来自 `src/core/chips`，**这两个模块都不在禁止清单内**，正常引入即可。
- **`src/session/` 不得导入 `react` / `react-dom`，不得出现 `setTimeout` / `setInterval` / `document` / `window`。本次新增：不得出现 `AudioContext` / `webkitAudioContext` / `new Audio` / `HTMLAudioElement`。**
- 金额比较一律用 `src/core/chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁止裸 `===` 和 `>`。`Math.min` / `Math.max` 钳位不算比较，不受此限。
- **内部量纲一律是 BB。实额（20 / 40 / 4000）只存在于 `src/ui/format.ts` 一个文件里。`CHIPS_PER_BB = 40`。**
- 常量取自 `src/core/types.ts`：`SMALL_BLIND = 0.5`、`BIG_BLIND = 1`、`STARTING_STACK = 100`、`SEAT_COUNT = 6`、`HERO_SEAT = 0`。**不得在新代码里重新定义这些数字。**
- npm registry 必须保持 `https://registry.npmmirror.com/`。用 `npm install <pkg>` 增量添加，**严禁**删除 `node_modules` 或 `package-lock.json` 后重装。**本计划不需要任何新依赖。**
- 提交信息用中文，结尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- **每个任务结束时 `npm test`、`npm run typecheck`、`npm run build` 必须全绿才能提交。**
- **这是纯 UI 改动：`src/core/` `src/ai/` `src/review/` `src/session/` 的现有 609 个测试一个都不该变。** 任何一个变了都说明改动越界，停下来报告。新增测试只会让总数增加。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/ui/format.ts` | 唯一的实额归属地：`CHIPS_PER_BB`、`chips()`、牌面文字、**新增**面额拆分 | 1, 4 |
| `src/ui/format.test.ts` | 上者的单测 | 1, 4 |
| `src/ui/components/Chips.tsx` | **新增**。渲染面额筹码堆，无逻辑 | 2 |
| `src/ui/components/Seat.tsx` | 对手座位：牌、位置、筹码、下注堆 | 2, 5 |
| `src/ui/components/HeroHand.tsx` | hero 手牌与信息 | 2, 5 |
| `src/ui/components/Card.tsx` | 单张牌（c3 样式） | 4 |
| `src/ui/components/Board.tsx` | 公共牌 | 5 |
| `src/ui/components/Pot.tsx` | 底池 | 5 |
| `src/ui/components/Table.tsx` | 牌桌容器（毡面在这里） | 3 |
| `src/ui/components/TopBar.tsx` | 顶栏 + **新增**静音按钮 | 8 |
| `src/ui/styles/app.css` | 全部样式与动效 | 3, 4, 5 |
| `src/ui/sound.ts` | **新增**。`soundFor()` 纯映射 + AudioContext / 播放 / 静音 | 6, 8 |
| `src/ui/sound.test.ts` | **新增**。`soundFor()` 单测 | 6 |
| `src/ui/App.tsx` | 音效触发接线 | 8 |
| `public/sounds/*.mp3` | **新增**。八个音效文件 | 7 |
| `public/sounds/CREDITS.md` | **新增**。来源与许可 | 7 |
| `src/session/architecture.test.ts` | **新增**音频守卫 | 6 |
| `README.md` | 更新技术栈与已知边界 | 9 |

---

## Task 1: `chipDenominations` —— 面额拆分纯函数

**Files:**
- Modify: `src/ui/format.ts`
- Test: `src/ui/format.test.ts`

**Interfaces:**
- Consumes: `CHIPS_PER_BB`（同文件已有）
- Produces:
  - `export const CHIP_DENOMINATIONS: readonly number[]`（`[1000, 500, 100, 20]`）
  - `export const MAX_CHIPS_DRAWN: number`（`5`）
  - `export function chipDenominations(bb: number): number[]`

- [ ] **Step 1: 写失败测试**

在 `src/ui/format.test.ts` 顶部的 import 改为：

```ts
import { CHIPS_PER_BB, chips, chipDenominations, CHIP_DENOMINATIONS, MAX_CHIPS_DRAWN } from './format';
```

（`CHIP_DENOMINATIONS` 被本段最后一条「面额表是从大到小的」用到，别漏。）

在文件末尾追加：

```ts
describe('筹码面额拆分', () => {
  it('小盲 0.5BB = 20 筹码，一枚 20', () => {
    expect(chipDenominations(0.5)).toEqual([20]);
  });

  it('大盲 1BB = 40 筹码，两枚 20', () => {
    expect(chipDenominations(1)).toEqual([20, 20]);
  });

  it('2BB = 80 筹码，四枚 20', () => {
    expect(chipDenominations(2)).toEqual([20, 20, 20, 20]);
  });

  it('起始筹码 100BB = 4,000，四枚 1000', () => {
    expect(chipDenominations(100)).toEqual([1000, 1000, 1000, 1000]);
  });

  it('贪心从大到小：38.25BB = 1,530 拆成 1000+500+20，余 10 不表示', () => {
    expect(chipDenominations(38.25)).toEqual([1000, 500, 20]);
  });

  it('超过上限时截断到 MAX_CHIPS_DRAWN 枚', () => {
    // 120BB = 4,800 筹码：1000*4 + 500 已经 5 枚，余 300 不再表示
    const out = chipDenominations(120);
    expect(out).toEqual([1000, 1000, 1000, 1000, 500]);
    expect(out).toHaveLength(MAX_CHIPS_DRAWN);
  });

  it('零金额不画筹码', () => {
    expect(chipDenominations(0)).toEqual([]);
  });

  it('取整后不足一枚最小面额时不画筹码', () => {
    // 0.01BB = 0.4 筹码，取整为 0
    expect(chipDenominations(0.01)).toEqual([]);
  });

  it('负数按绝对值处理，返回值不带符号', () => {
    expect(chipDenominations(-1)).toEqual([20, 20]);
  });

  it('面额表是从大到小的，拆分依赖这个顺序', () => {
    const sorted = [...CHIP_DENOMINATIONS].sort((a, b) => b - a);
    expect([...CHIP_DENOMINATIONS]).toEqual(sorted);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx.cmd vitest run src/ui/format.test.ts
```

期望：FAIL，报 `chipDenominations` / `MAX_CHIPS_DRAWN` 不是导出成员（TypeScript / 运行时均可）。

- [ ] **Step 3: 写实现**

在 `src/ui/format.ts` 的 `chips()` 之后插入：

```ts
/**
 * 实额筹码面额，从大到小。20 是最小下注单位（半个大盲）。
 * chipDenominations 的贪心拆分依赖这个降序。
 */
export const CHIP_DENOMINATIONS: readonly number[] = [1000, 500, 100, 20];

/** 一堆筹码最多画几枚。超出的不画——筹码堆是示意，旁边的数字才是权威 */
export const MAX_CHIPS_DRAWN = 5;

/**
 * BB 金额 → 从大到小的面额数组（实额），供界面画筹码堆。
 *
 * 贪心拆分。循环在两种情况下结束，两种都会留下不再表示的余额：
 * 画满 MAX_CHIPS_DRAWN 枚，或剩余额小于最小面额（20）放不下任何一枚。
 * 这是有意的——调用方必须同时用 chips() 显示精确金额。
 */
export function chipDenominations(bb: number): number[] {
  let remaining = Math.abs(Math.round(bb * CHIPS_PER_BB));
  const out: number[] = [];
  while (out.length < MAX_CHIPS_DRAWN) {
    const d = CHIP_DENOMINATIONS.find(v => v <= remaining);
    if (d === undefined) break;
    out.push(d);
    remaining -= d;
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx.cmd vitest run src/ui/format.test.ts
```

期望：PASS，该文件全部测试绿（原有 9 条 + 新增 10 条）。

- [ ] **Step 5: 全套与类型检查**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：44 文件；通过数为 609 + 10 = **619**；3 跳过；typecheck 与 build 均绿。若通过数不是 619，停下来报告实际数字。

- [ ] **Step 6: 提交**

```bash
git add src/ui/format.ts src/ui/format.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): 筹码面额拆分纯函数

面额定义与拆分逻辑放进 format.ts 而不是新建文件——面额（1000/500/
100/20）本身就是实额概念，而实额只允许存在于这一个文件里。

贪心拆分刻意会留下不表示的余额（画满 5 枚，或剩余不足 20）。筹码堆
是示意，调用方必须同时用 chips() 显示精确金额。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `Chips` 组件与座位/hero 接线

**Files:**
- Create: `src/ui/components/Chips.tsx`
- Modify: `src/ui/components/Seat.tsx`
- Modify: `src/ui/components/HeroHand.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `chipDenominations`（Task 1）、`chips`（已有）
- Produces: `export function Chips({ bb }: { bb: number }): JSX.Element | null`

本任务无自动化测试（组件层的既有取舍）。验证靠 typecheck + build + 控制方浏览器验收。

- [ ] **Step 1: 写 Chips 组件**

创建 `src/ui/components/Chips.tsx`：

```tsx
import { chipDenominations } from '../format';

/**
 * 面额筹码堆。纯展示，无逻辑——拆分在 format.ts 的 chipDenominations 里。
 *
 * aria-hidden：金额已由相邻的文字节点念出，筹码只是同一信息的图形重复，
 * 让读屏软件念一串无意义的空 span 是噪音。
 */
export function Chips({ bb }: { bb: number }) {
  const denoms = chipDenominations(bb);
  if (denoms.length === 0) return null;
  return (
    <span className="chip-stack" aria-hidden="true">
      {denoms.map((d, i) => (
        <span key={i} className={`chip chip-d${d}`} />
      ))}
    </span>
  );
}
```

- [ ] **Step 2: 座位接上筹码堆**

`src/ui/components/Seat.tsx`：在 import 区加入

```tsx
import { Chips } from './Chips';
```

把文件末尾的下注额那一段

```tsx
      {chipsGreater(seat.streetContribution, 0) && (
        <div className="seat-bet">{chips(seat.streetContribution)}</div>
      )}
```

替换为

```tsx
      {chipsGreater(seat.streetContribution, 0) && (
        <div className="seat-bet">
          <Chips bb={seat.streetContribution} />
          <span className="seat-bet-amount">{chips(seat.streetContribution)}</span>
        </div>
      )}
```

- [ ] **Step 3: hero 接上筹码堆**

`src/ui/components/HeroHand.tsx`：在 import 区加入

```tsx
import { Chips } from './Chips';
```

把

```tsx
        {chipsGreater(seat.streetContribution, 0) && (
          <span className="hero-bet">投入 {chips(seat.streetContribution)}</span>
        )}
```

替换为

```tsx
        {chipsGreater(seat.streetContribution, 0) && (
          <span className="hero-bet">
            <Chips bb={seat.streetContribution} />
            投入 {chips(seat.streetContribution)}
          </span>
        )}
```

- [ ] **Step 4: 加筹码样式**

在 `src/ui/styles/app.css` 末尾追加：

```css
/* ---- 面额筹码堆 ---- */
.chip-stack {
  display: inline-flex;
  align-items: flex-end;
  vertical-align: middle;
}
.chip {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  margin-left: -4px;
  position: relative;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.18);
}
.chip:first-child { margin-left: 0; }
/* 边缘的虚线条纹——真实筹码的标志性纹路 */
.chip::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.45);
}
.chip-d20 { background: #3f4c57; }
.chip-d100 { background: #b5342a; }
.chip-d500 { background: #2a7a4a; }
.chip-d1000 { background: #1a1c20; }

.seat-bet {
  display: flex;
  align-items: center;
  gap: 5px;
}
.seat-bet-amount {
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}
.hero-bet { display: inline-flex; align-items: center; gap: 5px; }
```

同时把 `app.css` 里原有的这条删掉（它的 `color` / `font-variant-numeric` 已移到 `.seat-bet-amount`，`.seat-bet` 现在是 flex 容器）：

```css
.seat-bet {
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: 验证**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：619 通过 / 3 跳过（本任务不新增测试，数字不变）；typecheck 与 build 绿。

- [ ] **Step 6: 提交**

```bash
git add src/ui/components/Chips.tsx src/ui/components/Seat.tsx src/ui/components/HeroHand.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 下注额改用面额筹码堆显示

裸数字看不出一注有多重。拆成面额堆之后，「四枚 20」和「四枚 1000」
一眼可分，不必读数字。

筹码堆标了 aria-hidden：金额已由相邻文字念出，让读屏软件再念一串
空 span 是噪音。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 配色令牌、牌桌毡面与桌面限宽

**Files:**
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: 无
- Produces: 新的 CSS 自定义属性（`--bg` / `--felt-1` / `--felt-2` / `--felt-edge` / `--gold` / `--danger` / `--text` / `--text-dim` / `--line`），供 Task 4、5 使用

- [ ] **Step 1: 替换 `:root` 令牌**

把 `src/ui/styles/app.css` 开头的整个 `:root` 块

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
```

替换为

```css
:root {
  /* 页面底色：近黑。牌桌是唯一有颜色的东西，其余一律退让 */
  --bg: #0d0f12;
  --panel: #14181d;
  --line: #232a32;

  /* 毡面：低饱和青绿，中心略亮 */
  --felt-1: #1b4a40;
  --felt-2: #0f2b26;
  --felt-edge: #2b6b5c;

  --text: #e6edea;
  --text-dim: #7d938c;

  /* 琥珀色只给两处：底池、正在行动的人。多给一处就不再抢眼 */
  --gold: #f4b942;
  --danger: #8c3a2c;
  --positive: #7fd18a;

  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-top: env(safe-area-inset-top, 0px);
}
```

- [ ] **Step 2: 页面底色与限宽居中**

把

```css
body {
  background: var(--felt);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
```

替换为

```css
body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
```

在 `html, body, #root { height: 100%; margin: 0; }` 规则之后追加一条独立规则：

```css
/* 桌面上把 .app 在视口里居中。窄屏时 .app 撑满，这条不产生任何效果 */
#root {
  display: flex;
  align-items: center;
  justify-content: center;
}
```

把

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: var(--safe-top);
}
```

替换为

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: var(--safe-top);
  /* 桌面上限宽限高并居中，牌桌才是横椭圆而不是竖椭圆——只限宽的话
     .table 的 flex:1 会吃掉全部竖向空间，在高视口下把牌桌立起来。
     窄屏（手机）时两个上限都够不着，行为与限制前完全一致。 */
  width: 100%;
  max-width: 1040px;
  max-height: 760px;
  margin-inline: auto;
}
```

（注意 `width: 100%` 是新加的：`#root` 变成 flex 容器后，`.app` 作为 flex item 不再自动撑满宽度，不加会缩成内容宽。）

- [ ] **Step 3: 牌桌毡面**

把

```css
.table {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

替换为

```css
.table {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 毡面画在伪元素上而不是 .table 本身：座位是绝对定位的，
   改动 .table 的盒模型会挪动它们，用伪元素则完全不碰布局 */
.table::before {
  content: '';
  position: absolute;
  inset: 6px 10px 4px;
  border-radius: 44% / 30%;
  background: radial-gradient(120% 95% at 50% 22%, var(--felt-1), var(--felt-2));
  border: 1px solid var(--felt-edge);
  box-shadow:
    inset 0 0 0 6px rgba(255, 255, 255, 0.02),
    0 0 40px rgba(28, 120, 100, 0.15);
  z-index: 0;
}
.table > * {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 4: 顶栏与底部随新令牌调整**

把

```css
.topbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.25);
}
```

替换为

```css
.topbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 9px 12px;
  font-size: 13px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
```

把 `.topbar-item.pos { color: #7fd18a; }` 替换为 `.topbar-item.pos { color: var(--positive); }`。

把

```css
.bottom {
  padding: 8px 10px calc(8px + var(--safe-bottom));
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}
```

替换为

```css
.bottom {
  padding: 8px 10px calc(8px + var(--safe-bottom));
  background: var(--panel);
  border-top: 1px solid var(--line);
}
```

（`backdrop-filter` 去掉：`.bottom` 已不是固定定位，背后没有内容需要透视，留着只是白费一次合成。）

- [ ] **Step 5: 座位与按钮配色**

把 `.seat-to-act .seat-info { box-shadow: 0 0 0 2px var(--gold); }` 替换为

```css
/* 行动中的座位：静态描边，不做呼吸/闪烁——它全程存在，动起来就是持续干扰 */
.seat-to-act .seat-info {
  box-shadow: 0 0 0 1.5px var(--gold);
}
```

把

```css
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
```

替换为

```css
.btn {
  flex: 1;
  min-height: 52px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  background: var(--line);
  cursor: pointer;
}
.btn-primary { background: #1d6b4e; }
.btn-danger { background: var(--danger); }
.btn-ghost { background: var(--line); }
```

- [ ] **Step 6: 底池与公共牌配色**

把

```css
.pot-label { color: var(--text-dim); font-size: 12px; }
.pot-amount { font-size: 20px; font-variant-numeric: tabular-nums; }
```

替换为

```css
.pot-label {
  color: var(--text-dim);
  font-size: 10px;
  letter-spacing: 0.14em;
}
.pot-amount {
  font-size: 24px;
  font-weight: 700;
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: 验证**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：619 通过 / 3 跳过；typecheck 与 build 绿。

**同时用 grep 确认旧令牌已彻底移除**：

```bash
grep -n "felt-light\|--felt[^-]" src/ui/styles/app.css
```

期望：无输出。若有残留，说明漏改了某处引用，补上。

- [ ] **Step 8: 提交**

```bash
git add src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 现代深色配色、牌桌毡面与桌面限宽居中

整屏纯色换成「近黑底 + 一块毡面」：牌桌是唯一有颜色的东西，其余一律
退让。琥珀色只给底池和正在行动的人这两处，多给一处就不再抢眼。

毡面画在 .table::before 上而不是 .table 本身——座位是绝对定位的，
改动 .table 的盒模型会挪动它们，用伪元素则完全不碰布局。

.bottom 去掉 backdrop-filter：它在 ③-A 已改为非固定定位，背后没有
内容需要透视，留着只是白费一次合成。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: c3 极简牌面

**Files:**
- Modify: `src/ui/format.ts`
- Modify: `src/ui/format.test.ts`
- Modify: `src/ui/components/Card.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `Card`（`src/core/cards`，`import type`）
- Produces:
  - `export function rankText(c: Card): string`
  - `export function suitText(c: Card): string`
  - `cardText` 保留，改为由上面两个组合而成

- [ ] **Step 1: 写失败测试**

`src/ui/format.test.ts` 顶部 import 补上 `rankText, suitText`，并在文件末尾追加：

```ts
describe('牌面文字拆成点数与花色', () => {
  const AS = { rank: 14, suit: 's' } as const;
  const TD = { rank: 10, suit: 'd' } as const;
  const SEVEN_C = { rank: 7, suit: 'c' } as const;

  it('点数：A / 10 / 数字', () => {
    expect(rankText(AS)).toBe('A');
    expect(rankText(TD)).toBe('10');
    expect(rankText(SEVEN_C)).toBe('7');
  });

  it('花色符号', () => {
    expect(suitText(AS)).toBe('♠');
    expect(suitText(TD)).toBe('♦');
    expect(suitText(SEVEN_C)).toBe('♣');
  });

  it('cardText 仍是两者相接，没有回归', () => {
    expect(cardText(AS)).toBe('A♠');
    expect(cardText(TD)).toBe('10♦');
  });
});
```

本文件的 import 列表需同时含 `cardText`、`rankText`、`suitText`。

（2026-08-15 补记：点数 10 的显示从 `T` 改成了 `10`，是用户明确要求的需求变更，详见本 Task 末尾的补记与 `docs/superpowers/specs/2026-08-15-poker-trainer-ui-polish-design.md` §2。上面两条断言的期望值已按最终版本写出。）

- [ ] **Step 2: 运行确认失败**

```bash
npx.cmd vitest run src/ui/format.test.ts
```

期望：FAIL，`rankText` / `suitText` 不是导出成员。

- [ ] **Step 3: 拆分实现**

把 `src/ui/format.ts` 里的

```ts
/** 牌面文字，如 'A♠' */
export function cardText(c: Card): string {
  const rank = RANK_TEXT[c.rank] ?? String(c.rank);
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit];
  return `${rank}${suit}`;
}
```

替换为

```ts
/** 点数文字，如 'A' / '10' / '7' */
export function rankText(c: Card): string {
  return RANK_TEXT[c.rank] ?? String(c.rank);
}

/** 花色符号，如 '♠' */
export function suitText(c: Card): string {
  return { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit];
}

/** 牌面文字，如 'A♠'。点数与花色分开渲染时用上面两个 */
export function cardText(c: Card): string {
  return `${rankText(c)}${suitText(c)}`;
}
```

- [ ] **Step 4: 改 Card 组件为 c3 结构**

`src/ui/components/Card.tsx` 整体替换为：

```tsx
import type { Card as CardModel } from '../../core/cards';
import { rankText, suitText, suitClass } from '../format';

export function CardView({ card, size = 'md' }: { card: CardModel; size?: 'sm' | 'md' | 'lg' }) {
  const rank = rankText(card);
  return (
    <span className={`card card-${size} ${suitClass(card)}`}>
      {/* 「10」是唯一两个字符的点数，需要单独缩一档字号，否则会撑破牌面 */}
      <span className={rank.length > 1 ? 'card-rank card-rank-wide' : 'card-rank'}>{rank}</span>
      <span className="card-suit">{suitText(card)}</span>
    </span>
  );
}

/** 背面朝上的牌 */
export function CardBack({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-back`} />;
}
```

（2026-08-15 补记：`rank.length > 1` 分支与 `card-rank-wide` 类名是后补的——用户把点数 10 的显示从 `T` 改成了 `10` 之后，两字符点数需要单独缩字号，见本 Task 末尾补记。上面已是最终版本。）

- [ ] **Step 5: c3 牌面样式**

把 `app.css` 里的

```css
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
```

替换为

```css
/* c3 极简牌面：点数占满，花色缩到右上角。
   角标花色刻意比示意稿大一档——形状本身要可辨，不能只靠颜色区分花色。 */
.card {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f7f8f7;
  border-radius: 4px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
}
.card-rank { line-height: 1; }
.card-suit {
  position: absolute;
  right: 3px;
  top: 2px;
  line-height: 1;
  font-weight: 800;
}
.card-sm { width: 24px; height: 33px; }
.card-sm .card-rank { font-size: 14px; }
.card-sm .card-suit { font-size: 9px; }
.card-md { width: 30px; height: 42px; }
.card-md .card-rank { font-size: 18px; }
.card-md .card-suit { font-size: 11px; }
.card-lg { width: 42px; height: 59px; }
.card-lg .card-rank { font-size: 26px; }
.card-lg .card-suit { font-size: 14px; }
/* 「10」是唯一两个字符的点数。c3 的点数占满牌面，两字符按原字号会挤出牌外；
   缩一档并收紧字距，让它的视觉重量与单字符点数相当。 */
.card-sm .card-rank-wide { font-size: 10px; letter-spacing: -0.06em; }
.card-md .card-rank-wide { font-size: 13px; letter-spacing: -0.06em; }
.card-lg .card-rank-wide { font-size: 19px; letter-spacing: -0.06em; }
/* 牌背没有子元素，上面的 .card-rank/.card-suit 规则对它无副作用 */
```

（2026-08-15 补记：`.card-rank-wide` 三条规则是后补的，字号取单字符尺寸的约 72%，供 `10` 这个唯一的两字符点数使用。上面已是最终版本。）

- [ ] **Step 6: 验证**

```bash
npx.cmd vitest run src/ui/format.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：`format.test.ts` 全绿；全套 44 文件、**622** 通过（619 + 新增 3）、3 跳过；typecheck 与 build 绿。

- [ ] **Step 7: 提交**

```bash
git add src/ui/format.ts src/ui/format.test.ts src/ui/components/Card.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): c3 极简牌面

点数占满、花色缩到右上角。cardText 拆成 rankText + suitText 之后
由两者组合而成，没有第二份点数表。

角标花色刻意比示意稿大一档：c3 对色觉的依赖本来就高于角标式，让花色
的形状本身可辨，才不至于只能靠颜色区分。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: m2 动效

**Files:**
- Modify: `src/ui/components/Pot.tsx`
- Modify: `src/ui/components/Seat.tsx`
- Modify: `src/ui/components/HeroHand.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `isZeroChips` / `round2`（`src/core/chips`）
- Produces: 无新导出

**设计说明（实现者必读）**：m2 里「筹码滑进底池」用的是**保持挂载 + CSS 过渡**，不是 React 里编排时间线。座位下注框始终渲染，靠 `data-empty` 属性切换；金额归零时元素不卸载，而是过渡到「向牌桌中心位移 + 淡出」。这样既拿到了滑动效果，又不需要测量位置或写动画编排。代价是位移方向是直上直下的近似，不是精确飞向底池坐标——这是刻意的取舍。

- [ ] **Step 1: 底池改为随金额变化重挂载**

`src/ui/components/Pot.tsx` 整体替换为：

```tsx
import { chips } from '../format';

export function Pot({ amount }: { amount: number }) {
  return (
    <div className="pot">
      <span className="pot-label">底池</span>
      {/* key 随金额变化 → 元素重挂载 → CSS 入场动画重放。
          用它代替「在 React 里记住上一次金额再手动触发动画」。 */}
      <span key={chips(amount)} className="pot-amount">
        {chips(amount)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: 座位下注框改为常驻**

`src/ui/components/Seat.tsx`：import 区把

```tsx
import { chipsGreater } from '../../core/chips';
```

改为

```tsx
import { chipsGreater, isZeroChips, round2 } from '../../core/chips';
```

文件顶部加 `import { useEffect, useRef } from 'react';`。

在组件函数体**最前面**（`const cls = [...]` 之前）加入这一整块：

```tsx
  // 下注框常驻挂载，金额归零时靠 CSS 过渡滑向牌桌中心并淡出——
  // 卸载元素就没有过渡可言。淡出期间要显示最后一次的非零金额，
  // 否则数字会在滑动过程中突变成 0。
  const lastBetRef = useRef(0);
  const betEmpty = isZeroChips(round2(seat.streetContribution));
  const shownBet = betEmpty ? lastBetRef.current : seat.streetContribution;
  // ref 在 effect 里写，不在渲染中写——渲染必须是纯的。时序正好合用：
  // 金额归零的那一次渲染，读到的是上一次 effect 存下的非零值。
  useEffect(() => {
    if (!betEmpty) lastBetRef.current = seat.streetContribution;
  });
```

把 Task 2 写下的那段下注框

```tsx
      {chipsGreater(seat.streetContribution, 0) && (
        <div className="seat-bet">
          <Chips bb={seat.streetContribution} />
          <span className="seat-bet-amount">{chips(seat.streetContribution)}</span>
        </div>
      )}
```

替换为

```tsx
      <div className="seat-bet" data-empty={betEmpty ? 'true' : 'false'}>
        <Chips bb={shownBet} />
        <span className="seat-bet-amount">{chips(shownBet)}</span>
      </div>
```

`chipsGreater` **保留**——文件上方的气泡那段仍在用它（`chipsGreater(bubble.amount, 0)`）。

- [ ] **Step 3: hero 下注框同样常驻**

`src/ui/components/HeroHand.tsx`：顶部加 `import { useEffect, useRef } from 'react';`，import 区改为

```tsx
import { isZeroChips, round2 } from '../../core/chips';
```

在组件函数体最前面加入这一整块（与 `Seat.tsx` 同一模式，理由见上）：

```tsx
  const lastBetRef = useRef(0);
  const betEmpty = isZeroChips(round2(seat.streetContribution));
  const shownBet = betEmpty ? lastBetRef.current : seat.streetContribution;
  useEffect(() => {
    if (!betEmpty) lastBetRef.current = seat.streetContribution;
  });
```

把 Task 2 写下的 hero 下注那段替换为：

```tsx
        <span className="hero-bet" data-empty={betEmpty ? 'true' : 'false'}>
          <Chips bb={shownBet} />
          投入 {chips(shownBet)}
        </span>
```

`chipsGreater` 在本文件**已无调用点**（它原本只用于这一处判断），从 import 中移除，否则 typecheck 会报未使用的导入。

- [ ] **Step 4: 动效样式**

在 `app.css` 末尾追加：

```css
/* ================= m2 动效 =================
   全部用 CSS transition / keyframes，不引动画库，也不在 React 里编排时间线。 */

/* 筹码滑向牌桌中心并淡出。对手在上半部，向下即朝中心；hero 在下方，方向相反。
   元素常驻挂载（见 Seat.tsx / HeroHand.tsx），卸载就没有过渡可言。 */
.seat-bet,
.hero-bet {
  transition:
    transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.seat-bet[data-empty='true'] {
  opacity: 0;
  transform: translateY(26px) scale(0.7);
  pointer-events: none;
}
.hero-bet[data-empty='true'] {
  opacity: 0;
  transform: translateY(-26px) scale(0.7);
  pointer-events: none;
}

/* 底池收到筹码时轻轻一涨。由 Pot.tsx 的 key 变化触发重挂载 */
@keyframes pot-bump {
  0% { transform: scale(1); }
  45% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
.pot-amount {
  display: inline-block;
  animation: pot-bump 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* 公共牌逐张落下 */
@keyframes card-drop {
  from { opacity: 0; transform: translateY(-20px) scale(0.88); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.board .card {
  animation: card-drop 220ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards;
}
.board .card:nth-child(2) { animation-delay: 70ms; }
.board .card:nth-child(3) { animation-delay: 140ms; }
.board .card:nth-child(4) { animation-delay: 210ms; }
.board .card:nth-child(5) { animation-delay: 280ms; }

/* 赢池脉冲：结算条出现时，底池闪两下琥珀描边 */
@keyframes pot-win-pulse {
  0%, 100% { box-shadow: none; }
  25%, 75% { box-shadow: 0 0 0 2px var(--gold), 0 0 18px rgba(244, 185, 66, 0.55); }
}
/* padding 与 border-radius 放在 .pot 上常驻，不放在 .pot-won 里——
   否则类名出现的那一刻底池会因为盒子变大而跳一下 */
.pot {
  border-radius: 8px;
  padding: 2px 10px;
}
.pot.pot-won {
  animation: pot-win-pulse 600ms ease-in-out;
}

/* 系统开启「减少动态效果」时全部退化为纯淡入淡出：无位移、无缩放 */
@media (prefers-reduced-motion: reduce) {
  .seat-bet,
  .hero-bet {
    transition: opacity 120ms linear;
  }
  .seat-bet[data-empty='true'],
  .hero-bet[data-empty='true'] {
    transform: none;
  }
  .pot-amount { animation: none; }
  .board .card {
    animation: card-drop 120ms linear backwards;
  }
  @keyframes card-drop {
    from { opacity: 0; transform: none; }
    to { opacity: 1; transform: none; }
  }
  .pot.pot-won { animation: none; }
}
```

- [ ] **Step 5: 赢池脉冲接线**

`src/ui/components/Pot.tsx` 加一个可选 prop：

```tsx
import { chips } from '../format';

export function Pot({ amount, won = false }: { amount: number; won?: boolean }) {
  return (
    <div className={won ? 'pot pot-won' : 'pot'}>
      <span className="pot-label">底池</span>
      <span key={chips(amount)} className="pot-amount">
        {chips(amount)}
      </span>
    </div>
  );
}
```

`src/ui/components/Table.tsx` 的 `TableProps` 加一个字段并透传：

```tsx
export interface TableProps {
  game: GameState;
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 手牌结束且走到摊牌时为 true */
  revealed: boolean;
  /** 本手已结束且 hero 赢下底池时为 true，触发赢池脉冲 */
  heroWon: boolean;
}
```

函数签名改为 `export function Table({ game, lastAction, revealed, heroWon }: TableProps)`，并把 `<Pot amount={pot} />` 改为 `<Pot amount={pot} won={heroWon} />`。

`src/ui/App.tsx` 里把

```tsx
      <Table game={state.game} lastAction={state.lastAction} revealed={revealed} />
```

替换为

```tsx
      <Table
        game={state.game}
        lastAction={state.lastAction}
        revealed={revealed}
        heroWon={heroWon}
      />
```

并在 `revealed` 定义之后加入：

```tsx
  // 本手已结束且 hero 净盈亏为正 —— 触发底池的赢池脉冲
  const heroWon =
    state.phase === 'handOver' &&
    chipsGreater(state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0, 0);
```

`App.tsx` 顶部加 `import { chipsGreater } from '../core/chips';`。

- [ ] **Step 6: 验证**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：622 通过 / 3 跳过（本任务不新增测试）；typecheck 与 build 绿。

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/Pot.tsx src/ui/components/Seat.tsx src/ui/components/HeroHand.tsx src/ui/components/Table.tsx src/ui/App.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): m2 动效——筹码滑进底池、底池轻涨、公共牌逐张落下、赢池脉冲

「筹码滑进底池」用的是保持挂载 + CSS 过渡，不是在 React 里编排时间线：
下注框常驻渲染，金额归零时靠 data-empty 切换到「位移 + 淡出」。卸载
元素就没有过渡可言。淡出期间显示最后一次的非零金额，否则数字会在滑动
过程中突变成 0。代价是方向是直上直下的近似，不是精确飞向底池坐标。

底池轻涨用 key 随金额变化触发重挂载来重放入场动画，同样避免了在组件
里记上一次的值。

prefers-reduced-motion 下全部退化为纯淡入淡出。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `soundFor` 纯函数与 session 音频守卫

**Files:**
- Create: `src/ui/sound.ts`
- Create: `src/ui/sound.test.ts`
- Modify: `src/session/architecture.test.ts`

**Interfaces:**
- Consumes: `ActionType`（`src/core/types`，`import type`）、`chipsGreater`（`src/core/chips`）
- Produces:
  - `export type SoundName = 'chip-light' | 'chip-heavy' | 'deal-card' | 'board-flip' | 'fold' | 'check' | 'pot-win' | 'allin'`
  - `export function soundFor(type: ActionType, amount: number, pot: number): SoundName`

- [ ] **Step 1: 写失败测试**

创建 `src/ui/sound.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { soundFor } from './sound';

describe('动作 → 音效映射', () => {
  it('弃牌 / 过牌 / 全下各有专属音效，与金额和底池无关', () => {
    expect(soundFor('fold', 0, 140)).toBe('fold');
    expect(soundFor('check', 0, 140)).toBe('check');
    expect(soundFor('allin', 100, 140)).toBe('allin');
    expect(soundFor('allin', 1, 4000)).toBe('allin');
  });

  it('下注 / 加注 / 跟注按相对底池分轻重', () => {
    // 底池 140（3.5BB），半池 1.75BB
    expect(soundFor('bet', 1, 3.5)).toBe('chip-light');
    expect(soundFor('raise', 3, 3.5)).toBe('chip-heavy');
    expect(soundFor('call', 1, 3.5)).toBe('chip-light');
    expect(soundFor('call', 3, 3.5)).toBe('chip-heavy');
  });

  it('恰好等于半池算重注', () => {
    expect(soundFor('bet', 1.75, 3.5)).toBe('chip-heavy');
  });

  it('同样的绝对金额，在小池是重注、在大池是零头', () => {
    // 2BB 在 3.5BB 池里超过半池；在 100BB 池里远不足半池
    expect(soundFor('bet', 2, 3.5)).toBe('chip-heavy');
    expect(soundFor('bet', 2, 100)).toBe('chip-light');
  });

  it('底池为 0 时任何正额都算重注（真实牌局不可达，仅锁定行为）', () => {
    expect(soundFor('bet', 1, 0)).toBe('chip-heavy');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx.cmd vitest run src/ui/sound.test.ts
```

期望：FAIL，找不到模块 `./sound`。

- [ ] **Step 3: 写实现**

创建 `src/ui/sound.ts`：

```ts
import type { ActionType } from '../core/types';
import { chipsGreater } from '../core/chips';

export type SoundName =
  | 'chip-light'
  | 'chip-heavy'
  | 'deal-card'
  | 'board-flip'
  | 'fold'
  | 'check'
  | 'pot-win'
  | 'allin';

/**
 * 动作 → 音效。amount 与 pot 都是 BB。
 *
 * 轻重按**相对底池**分界而不是绝对金额：同样 2BB，在 3.5BB 的池里是
 * 大注，在 100BB 的池里是零头，绝对金额分不出这个差别。
 *
 * 穷尽 switch，不返回 null——六个动作类型每个都有音效。将来 ActionType
 * 若新增成员，这里会编译失败，比静默少播一个音效要好。「不播声音」的
 * 场景（如开局那一刻没有动作）由调用方守卫，不由本函数表达。
 */
export function soundFor(type: ActionType, amount: number, pot: number): SoundName {
  switch (type) {
    case 'fold':
      return 'fold';
    case 'check':
      return 'check';
    case 'allin':
      return 'allin';
    case 'bet':
    case 'raise':
    case 'call': {
      const halfPot = pot / 2;
      // chipsGreater(halfPot, amount) 为真即 amount < halfPot（轻）；
      // 相等归入重注。禁止裸 >= ，见 Global Constraints。
      return chipsGreater(halfPot, amount) ? 'chip-light' : 'chip-heavy';
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx.cmd vitest run src/ui/sound.test.ts
```

期望：PASS，5 条全绿。

- [ ] **Step 5: 加 session 音频守卫**

`src/session/architecture.test.ts`：在 `BROWSER_GLOBAL_LAYER_DIRS` 常量之后加入

```ts
/** 音频只允许存在于 src/ui/。session 及以下四层一律禁止 */
const AUDIO_BANNED = /\bAudioContext\b|\bwebkitAudioContext\b|new\s+Audio\b|\bHTMLAudioElement\b/;
```

并在 `describe('跨层纯度守卫…')` 内追加一条测试：

```ts
  it.each(PURE_LAYER_DIRS)('%s 不碰音频 API', dir => {
    const offenders: string[] = [];
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (AUDIO_BANNED.test(stripComments(readFileSync(file, 'utf-8')))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 6: 变异验证守卫真的会红**

临时在 `src/session/ledger.ts` 顶部加一行 `const ctx = new AudioContext();`，运行

```bash
npx.cmd vitest run src/session/architecture.test.ts
```

期望：FAIL，`src/session/ledger.ts` 出现在 offenders 里。**记录真实失败输出**，然后还原该文件并确认

```bash
git diff --exit-code -- src/session/ledger.ts
```

exit 0，再重跑守卫确认变绿。

- [ ] **Step 7: 全套验证**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：45 文件（新增 `sound.test.ts`）；通过数为 622 + 5（sound）+ 4（音频守卫 it.each 四个目录）= **631**；3 跳过。若数字对不上，停下来报告。

- [ ] **Step 8: 提交**

```bash
git add src/ui/sound.ts src/ui/sound.test.ts src/session/architecture.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): 动作→音效映射，并把音频 API 挡在 session 层之外

轻重按相对底池分界而不是绝对金额：同样 2BB，在 3.5BB 的池里是大注，
在 100BB 的池里是零头。

穷尽 switch 不返回 null——ActionType 将来新增成员时这里会编译失败，
比静默少播一个音效要好，后者要等人在浏览器里发现。

守卫用变异验证过：往 session 里塞一个 new AudioContext() 确实变红。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 获取音频文件

**Files:**
- Create: `public/sounds/*.mp3`（八个）
- Create: `public/sounds/CREDITS.md`

**Interfaces:**
- Consumes: 无
- Produces: 八个文件，文件名必须**逐字**为 `chip-light.mp3` / `chip-heavy.mp3` / `deal-card.mp3` / `board-flip.mp3` / `fold.mp3` / `check.mp3` / `pot-win.mp3` / `allin.mp3`——Task 8 按 `SoundName` 直接拼路径，名字对不上就加载失败

> **⚠️ 本任务需要人工授权，不能由子代理自行完成。**
> 每个文件下载前必须停下来，向人报清**文件名、来源 URL、大小**并取得授权。**不得批量下载，不得从未经确认的来源下载。**
> 若某个音效在 CC0 来源里找不到合适的，**停下来报告**——不要擅自换源，也不要用「差不多的」凑数。
> 预案见设计文档 §5.3：凑不齐的用 Web Audio 合成补上，`sound.ts` 接口不变。

- [ ] **Step 1: 列出候选并请求授权**

在 [BigSoundBank](https://bigsoundbank.com/)（CC0 公有领域、无需账号）检索八类音效，整理成一张表：音效名 → 来源页 URL → 直链 → 格式 → 大小。**把这张表交给人，等待逐项授权。**

- [ ] **Step 2: 下载已授权的文件**

只下载已获授权的项，放入 `public/sounds/`，文件名严格按上面的清单。

- [ ] **Step 3: 写 CREDITS.md**

创建 `public/sounds/CREDITS.md`：

```markdown
# 音效来源与许可

本目录下的音频文件全部来自公有领域（CC0）或等价的免版权来源，
可商用、可修改、署名可选。下载日期与来源逐个记录如下。

| 文件 | 来源 | 许可 | 下载日期 |
|---|---|---|---|
| chip-light.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| chip-heavy.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| deal-card.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| board-flip.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| fold.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| check.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| pot-win.mp3 | <来源页 URL> | CC0 | 2026-08-15 |
| allin.mp3 | <来源页 URL> | CC0 | 2026-08-15 |

若日后替换任何一个文件，这张表必须同步更新——许可信息丢失比文件丢失更麻烦。
```

表格里的 `<来源页 URL>` 必须换成真实 URL，不得留占位符。

- [ ] **Step 4: 确认文件被打包进 dist**

```bash
npm.cmd run build
ls dist/sounds
```

期望：八个 mp3 都出现在 `dist/sounds/`（Vite 把 `public/` 原样拷贝，不进 JS bundle）。

- [ ] **Step 5: 验证与提交**

```bash
npm.cmd test
npm.cmd run typecheck
```

期望：631 通过 / 3 跳过（本任务不改代码）。

```bash
git add public/sounds
git commit -m "$(cat <<'EOF'
chore(ui): 加入八个 CC0 音效文件

全部来自公有领域来源，可商用、署名可选，逐个在 CREDITS.md 里记了
来源 URL 与下载日期——许可信息丢失比文件丢失更麻烦。

放 public/ 而不是 src/：Vite 原样拷贝，不进 JS bundle。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 音效播放模块、静音开关与 App 接线

**Files:**
- Modify: `src/ui/sound.ts`
- Modify: `src/ui/components/TopBar.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles/app.css`

**Interfaces:**
- Consumes: `soundFor` / `SoundName`（Task 6）、`public/sounds/*.mp3`（Task 7）
- Produces:
  - `export function playSound(name: SoundName): void`
  - `export function isMuted(): boolean`
  - `export function setMuted(v: boolean): void`

- [ ] **Step 1: 在 sound.ts 追加播放层**

在 `src/ui/sound.ts` 末尾追加：

```ts
const MUTE_KEY = 'poker-trainer.muted';

let ctx: AudioContext | null = null;
let muted = readMuted();
const buffers = new Map<SoundName, AudioBuffer>();

function readMuted(): boolean {
  // 隐私模式下 localStorage 可能抛错。抛了就退化成「本次会话内有效」，
  // 不让一个静音开关把整个界面搞崩。
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    // 同上：存不下就算了，本次会话内仍然生效
  }
}

/**
 * 在第一次用户手势里调用。浏览器在用户手势前不允许播放音频，
 * 所以 AudioContext 惰性创建，并在同一个事件处理里 resume()。
 * 这是标准做法，不是 workaround。
 */
export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();
  void ctx.resume();
  void preload();
}

/**
 * 有真实录音的四个。它们是筹码撞击声——多体金属碰撞，合成器做出来一听就假，
 * 所以这四个用 CC0 录音（来源见 public/sounds/CREDITS.md）。
 */
const SAMPLED_SOUNDS = ['chip-light', 'chip-heavy', 'pot-win', 'allin'] as const;
type SampledName = (typeof SAMPLED_SOUNDS)[number];

function isSampled(name: SoundName): name is SampledName {
  return (SAMPLED_SOUNDS as readonly string[]).includes(name);
}

async function preload(): Promise<void> {
  const c = ctx;
  if (!c) return;
  await Promise.all(
    SAMPLED_SOUNDS.map(async name => {
      try {
        const res = await fetch(`sounds/${name}.mp3`);
        const buf = await c.decodeAudioData(await res.arrayBuffer());
        buffers.set(name, buf);
      } catch {
        // 单个音效加载失败不该让其他三个跟着不响，也不该刷控制台
      }
    }),
  );
}

/**
 * 合成音效的参数。这四个在 CC0 库里找不到合适素材，改用滤波噪声 + 包络实时合成——
 * 它们都是**短噪声瞬态**（发牌的滑擦、翻牌的脆响、搓牌、敲桌），正是合成最擅长的。
 *
 * 参数是按各自质感调出来的，不要随手改：
 * - freq/Q 决定音色的「亮」与「窄」，deal 偏闷、flip 偏脆
 * - decay 决定尾巴长短，check 是一记短促的敲击
 */
const SYNTH_PARAMS: Record<
  Exclude<SoundName, SampledName>,
  { type: BiquadFilterType; freq: number; q: number; peak: number; decay: number }
> = {
  'deal-card': { type: 'bandpass', freq: 1800, q: 0.9, peak: 0.22, decay: 0.11 },
  'board-flip': { type: 'highpass', freq: 3200, q: 0.7, peak: 0.26, decay: 0.07 },
  fold: { type: 'bandpass', freq: 1200, q: 0.8, peak: 0.18, decay: 0.14 },
  check: { type: 'lowpass', freq: 700, q: 3.5, peak: 0.34, decay: 0.09 },
};

/**
 * 白噪声 + 滤波 + 指数衰减包络。
 *
 * 这里用 Math.random() 生成噪声：本项目禁止 Math.random() 的是 core / ai /
 * review / session 四层（由 architecture.test.ts 的守卫强制），因为**牌局**的
 * 随机必须来自字符串 seed 才能复现。音频噪声与牌局状态无关，不在该约束内。
 */
function playSynth(name: Exclude<SoundName, SampledName>): void {
  const c = ctx;
  if (!c) return;
  const p = SYNTH_PARAMS[name];
  const len = Math.max(1, Math.floor(c.sampleRate * p.decay));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = p.type;
  filter.frequency.value = p.freq;
  filter.Q.value = p.q;
  const gain = c.createGain();
  const t = c.currentTime;
  gain.gain.setValueAtTime(p.peak, t);
  // 指数衰减不能收到 0（会抛错），收到一个足够小的值即可
  gain.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start();
  src.stop(t + p.decay);
}

/** 播放。未解锁或已静音时是无操作；录音尚未加载完成时该次播放跳过 */
export function playSound(name: SoundName): void {
  if (muted || !ctx) return;
  if (!isSampled(name)) {
    playSynth(name);
    return;
  }
  const buf = buffers.get(name);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
```

- [ ] **Step 2: 顶栏加静音按钮**

`src/ui/components/TopBar.tsx`：`TopBarProps` 加两个字段

```tsx
  muted: boolean;
  onToggleMute: () => void;
```

函数签名相应加上 `muted, onToggleMute`，并在 `deepStack` 那段之后、`</div>` 之前插入：

```tsx
      <button
        type="button"
        className="topbar-mute"
        onClick={onToggleMute}
        aria-pressed={muted}
        title={muted ? '取消静音' : '静音'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
```

- [ ] **Step 3: 静音按钮样式**

在 `app.css` 末尾追加：

```css
.topbar-mute {
  margin-left: 6px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
}
.topbar-mute:hover { color: var(--text); }
```

注意 `.topbar-item.dim` 带 `margin-left: auto`，静音按钮排在它之后即位于最右侧。

- [ ] **Step 4: App 接线**

`src/ui/App.tsx` 顶部 import 区加入：

```tsx
import { useState } from 'react';
import { playSound, soundFor, isMuted, setMuted, unlockAudio } from './sound';
```

（`useState` 与已有的 `useCallback, useEffect, useMemo, useReducer` 合并成一条 import。）

在 `export function App()` 的 `const [state, dispatch] = useReducer(...)` 之后加入：

```tsx
  const [muted, setMutedState] = useState(isMuted);

  const onToggleMute = useCallback(() => {
    setMutedState(prev => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  // 浏览器在用户第一次手势前不允许播放音频。任何一次点击都算手势，
  // 所以挂在根节点上捕获一次就够，之后自行解绑。
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // 动作音：以 stepIndex 为单调 key。用它而不是 lastAction 本身作依赖，
  // 是因为两个相邻动作可能完全相同（例如连续两个 fold），对象比较会漏播。
  // 必须先判 lastAction 存在——新一手开局时 stepIndex 也会变，但那一刻
  // 没有动作，不判会把上一手的残留动作重播一次。
  // 依赖数组刻意只放 stepIndex，不放 state.lastAction / state.game：
  // 这个 effect 要的是「步进了一次」这个事件，不是「这些对象变了」。
  // 本项目没有 eslint，不需要写 disable 注释；这条注释才是给人看的。
  useEffect(() => {
    const a = state.lastAction;
    if (!a) return;
    const pot = state.game.seats.reduce((sum, s) => sum + s.totalContribution, 0);
    playSound(soundFor(a.type, a.amount, pot));
  }, [state.stepIndex]);

  // 公共牌翻开。依赖只放长度——牌面对象每手都会换新，放进依赖会每手多响一次
  useEffect(() => {
    if (state.game.board.length === 0) return;
    playSound('board-flip');
  }, [state.game.board.length]);

  // 新一手开局发牌。第一手不会响——那时用户还没做过任何手势，
  // 浏览器不允许播放。这是自动播放策略的必然结果，不特殊处理。
  useEffect(() => {
    playSound('deal-card');
  }, [state.handIndex]);

  // hero 赢下底池
  useEffect(() => {
    if (heroWon) playSound('pot-win');
  }, [heroWon]);
```

**注意**：上面第四个 effect 依赖 `heroWon`，它在 Task 5 已经定义；请把这四个 effect 放在 `heroWon` 定义**之后**。

把 `<TopBar ... />` 的调用加上两个新 prop：

```tsx
      <TopBar
        handsPlayed={state.ledger.handsPlayed}
        inProgress={state.phase !== 'handOver'}
        netBB={netBB}
        totalBuyIn={state.ledger.totalBuyIn}
        deepStack={isDeepStackHand(state)}
        muted={muted}
        onToggleMute={onToggleMute}
      />
```

- [ ] **Step 5: 验证**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

期望：631 通过 / 3 跳过（本任务不新增测试）；typecheck 与 build 绿。

**同时确认架构守卫仍绿**（本任务往 `src/ui/` 加了 `AudioContext`，守卫只禁 session 及以下四层，不该误伤）：

```bash
npx.cmd vitest run src/session/architecture.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add src/ui/sound.ts src/ui/components/TopBar.tsx src/ui/App.tsx src/ui/styles/app.css
git commit -m "$(cat <<'EOF'
feat(ui): 音效播放、静音开关与触发接线

会话层是纯的，UI 只能从状态变化反推「刚发生了什么」：动作音以
stepIndex 为单调 key（相邻两个动作可能完全相同，比对象会漏播），
并且必须先判 lastAction 存在——新一手开局时 stepIndex 也会变，
但那一刻没有动作。

静音状态存 localStorage。③-A 的「无持久化」针对的是对局状态，
一个每次刷新都要重按的静音键是纯粹的烦扰。读写包 try/catch，
隐私模式下退化为本次会话内有效。

第一手的发牌音注定不会响：那时用户还没做过手势，浏览器不允许播放。
这是自动播放策略的必然结果，不为它写 workaround。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: README 更新与人工验收走查

**Files:**
- Modify: `README.md`

**Interfaces:** 无

- [ ] **Step 1: 取当前真实测试数**

```bash
npm.cmd test
```

**以实际输出为准**更新 README 里的数字，不要照抄本计划里的预估值。

- [ ] **Step 2: 更新 README**

在「技术栈」一行末尾追加 Web Audio；在「已知的覆盖边界」一节补三条：

```markdown
- **音效来自 CC0 公有领域素材**，逐个在 `public/sounds/CREDITS.md` 记了来源与许可。放 `public/` 而非 `src/`，Vite 原样拷贝，不进 JS bundle。
- **静音状态存 `localStorage`，是「无持久化」的一处有意例外。** 那条规则针对的是对局状态（刷新即丢，③-C 解决）；一个每次刷新都要重按的静音键是纯粹的烦扰。隐私模式下写入失败会退化为本次会话内有效。
- **第一手的发牌音不会响。** 浏览器在用户第一次手势前不允许播放音频，而第一手在页面加载时就开始了。这是自动播放策略的必然结果，没有为它写 workaround。
```

- [ ] **Step 3: 人工验收走查（控制方执行）**

在浏览器里逐条走设计文档 §9 的 15 条清单，**逐条记录结论**。其中第 4 条是回归项，必须确认：

> hero 手牌不被动作条遮挡

- [ ] **Step 4: 验证与提交**

```bash
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README 更新到视觉改版与音效完成状态

三条新的已知边界都是如实记的：音效素材的许可来源、静音状态用
localStorage 这一处对「无持久化」的例外、以及第一手发牌音注定
不会响这个自动播放策略的必然结果。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完成标准

1. 设计文档 §9 的 15 条人工验收清单逐条走过并记录结论
2. `src/core/` `src/ai/` `src/review/` `src/session/` 的**现有 609 个测试一个都没变**
3. 新增测试全绿：`chipDenominations` 10 条、牌面拆分 3 条、`soundFor` 5 条、音频守卫 4 条
4. `npm test` / `npm run typecheck` / `npm run build` 全绿
5. `public/sounds/CREDITS.md` 里每个文件都有真实来源 URL，无占位符
6. README 里的测试数字取自实际运行输出
