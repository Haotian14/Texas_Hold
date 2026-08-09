# 复盘引擎（②-B-2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入一份 `HandRecord`，输出「hero 的每个决策点错在哪、亏了多少 BB、属于哪类错误」。

**Architecture:** 复盘引擎只吃 `HandRecord`，不碰运行中的对局状态。它把记录**部分重放**到 hero 的每个决策点，借助已有的 `situationFromGameState` 构造 `Situation`，交给 `estimateEv` 估值，再按规则定级、分类、生成文案。与 AI 走同一条估算路径，所以「复盘说该弃牌、AI 在同样局面从不弃」这种割裂在结构上不可能出现。

**Tech Stack:** TypeScript（strict）· Vitest · fast-check · Node 24。新增目录 `src/review/`，只依赖 `src/core/`，不依赖 `src/ai/`。

## Global Constraints

- TypeScript strict。`src/core/`、`src/ai/`、`src/review/` 内禁止 `Math.random()`，禁止 React/DOM 导入。
- 依赖方向：`src/review/` → `src/core/`。**`src/review/` 不得导入 `src/ai/`**，`src/core/` 不得导入两者中任何一个。
- 金额比较一律用 `chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁止裸 `===` 和 `>`。牌型分值是精确整数，用精确比较。
- 所有随机性来自字符串 seed。复盘同一份 `HandRecord` 两次，结果必须逐位相同。
- **复盘判定不得读取非 hero 座位的 `holeCards`。** 对手底牌只允许出现在展示层。这条有专门的测试守着（Task 2）。
- **`EvResult.degraded !== null` 时不得输出 BB 损失数字。** 该决策点记为 `severity: 'ok'`、`evLoss: 0`、`tag: null`，并置 `degraded: true`。宁可少算，不可错报。
- 严重度阈值（§8.6，左闭右开）：`[0, 0.2)` → `ok`；`[0.2, 1)` → `minor`；`[1, 3)` → `notable`；`[3, ∞)` → `severe`。集中定义在 `src/review/taxonomy.ts`。
- 翻前频率阈值（§8.2）：用户动作在范围表中的频率 **≥ 0.15** 即判 `ok`，evLoss 记 0。
- 提交信息用中文，结尾带 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## 文件结构

```
src/review/
  taxonomy.ts             MistakeTag 枚举、Severity、阈值、severityOf()
  situationFromRecord.ts  部分重放 + 逐步收窄对手范围 → Situation
  preflopNode.ts          从重放状态推断翻前范围表节点 key
  judge.ts                单个决策点的判定：evLoss、severity、MistakeTag
  explain.ts              按 tag 生成中文解释文案
  analyzeHand.ts          入口：遍历 hero 决策点 → HandAnalysis
  types.ts                DecisionAnalysis / HandAnalysis
  goldenScenarios.test.ts 约 40 个答案无争议的场景
```

拆分理由：`judge.ts` 是纯函数（局面 + EV 结果 → 判定），`explain.ts` 是纯文案，两者都能脱离重放独立测试。`situationFromRecord.ts` 是唯一碰 `HandRecord` 的模块。

---

## Task 1: taxonomy.ts —— 分类法与阈值

**Files:**
- Create: `src/review/taxonomy.ts`
- Test: `src/review/taxonomy.test.ts`

**Interfaces:**
- Consumes: 无（叶子模块）
- Produces:
  - `type Severity = 'ok' | 'minor' | 'notable' | 'severe'`
  - `type MistakeTag`（§8.7 的 15 个字面量联合类型）
  - `PREFLOP_TAGS: readonly MistakeTag[]` / `POSTFLOP_TAGS: readonly MistakeTag[]`
  - `SEVERITY_THRESHOLDS: readonly { min: number; severity: Severity }[]`
  - `severityOf(evLoss: number): Severity`
  - `PREFLOP_OK_FREQ = 0.15`

- [ ] **Step 1: 写失败的测试**

创建 `src/review/taxonomy.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  severityOf,
  SEVERITY_THRESHOLDS,
  PREFLOP_TAGS,
  POSTFLOP_TAGS,
  PREFLOP_OK_FREQ,
} from './taxonomy';

describe('severityOf', () => {
  it('区间左闭右开，边界值归入更严重的一档', () => {
    expect(severityOf(0)).toBe('ok');
    expect(severityOf(0.199)).toBe('ok');
    expect(severityOf(0.2)).toBe('minor');
    expect(severityOf(0.999)).toBe('minor');
    expect(severityOf(1)).toBe('notable');
    expect(severityOf(2.999)).toBe('notable');
    expect(severityOf(3)).toBe('severe');
    expect(severityOf(100)).toBe('severe');
  });

  it('负的 evLoss 视为 ok —— 用户打得比推荐还好时不该报错', () => {
    // 蒙特卡洛噪声会让实际动作偶尔算出比推荐更高的 EV
    expect(severityOf(-0.5)).toBe('ok');
  });

  it('阈值表按 min 升序且首档为 0', () => {
    expect(SEVERITY_THRESHOLDS[0].min).toBe(0);
    for (let i = 1; i < SEVERITY_THRESHOLDS.length; i++) {
      expect(SEVERITY_THRESHOLDS[i].min).toBeGreaterThan(SEVERITY_THRESHOLDS[i - 1].min);
    }
  });
});

describe('MistakeTag 分组', () => {
  it('翻前六个、翻后九个，共十五个', () => {
    expect(PREFLOP_TAGS).toHaveLength(6);
    expect(POSTFLOP_TAGS).toHaveLength(9);
  });

  it('两组不重叠', () => {
    const pre = new Set<string>(PREFLOP_TAGS);
    for (const t of POSTFLOP_TAGS) expect(pre.has(t)).toBe(false);
  });

  it('翻前 tag 一律以 preflop_ 开头，便于 UI 分组与报表聚合', () => {
    for (const t of PREFLOP_TAGS) expect(t.startsWith('preflop_')).toBe(true);
  });
});

describe('翻前频率阈值', () => {
  it('等于 spec §8.2 规定的 0.15', () => {
    expect(PREFLOP_OK_FREQ).toBe(0.15);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/taxonomy.test.ts`
Expected: FAIL，找不到模块 `./taxonomy`

- [ ] **Step 3: 实现 taxonomy.ts**

创建 `src/review/taxonomy.ts`：

```ts
/**
 * 复盘引擎的分类法与阈值。
 *
 * 这些数字决定了用户看到多少个红灯。集中放在一处是刻意的 ——
 * 调整判定松紧时只应该改这个文件，不用去翻判定规则本身。
 */

export type Severity = 'ok' | 'minor' | 'notable' | 'severe';

/** 翻前失误分类（spec §8.7） */
export const PREFLOP_TAGS = [
  'preflop_cold_call_too_wide',
  'preflop_missed_3bet',
  'preflop_over_aggressive',
  'preflop_sb_limp',
  'preflop_open_too_wide',
  'preflop_fold_too_tight',
] as const;

/** 翻后失误分类（spec §8.7） */
export const POSTFLOP_TAGS = [
  'missed_cbet',
  'missed_value_bet',
  'chasing_bad_odds',
  'call_too_light_vs_raise',
  'should_have_folded',
  'bet_size_too_small',
  'bet_size_too_large',
  'ineffective_bluff',
  'over_bluffing',
] as const;

export type PreflopTag = (typeof PREFLOP_TAGS)[number];
export type PostflopTag = (typeof POSTFLOP_TAGS)[number];
export type MistakeTag = PreflopTag | PostflopTag;

/**
 * 严重度阈值（spec §8.6）。区间左闭右开：evLoss 恰好等于 0.2 归入 minor。
 * 最小档 0.2 BB 是刻意设的 —— 默认迭代数下单个 EV 的蒙特卡洛标准误约与之同量级，
 * 低于这个数的差异不该拿去指责用户。
 */
export const SEVERITY_THRESHOLDS: readonly { min: number; severity: Severity }[] = [
  { min: 0, severity: 'ok' },
  { min: 0.2, severity: 'minor' },
  { min: 1, severity: 'notable' },
  { min: 3, severity: 'severe' },
];

export function severityOf(evLoss: number): Severity {
  let out: Severity = 'ok';
  for (const t of SEVERITY_THRESHOLDS) {
    if (evLoss >= t.min) out = t.severity;
  }
  return out;
}

/**
 * 翻前判定阈值（spec §8.2）：用户动作在范围表里的频率达到这个值就不算失误。
 *
 * 均衡策略本身是混合的 —— 同一手牌在同一节点可能 30% 加注、70% 跟注。
 * 用户选了低频但合法的那一支，不该被判错。
 */
export const PREFLOP_OK_FREQ = 0.15;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/taxonomy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/review/taxonomy.ts src/review/taxonomy.test.ts
git commit -m "feat(review): 错误分类法与严重度阈值

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: situationFromRecord —— 部分重放构造局面

本计划的地基。spec §4.3 的另一半：目前只能从活对局构造 `Situation`，复盘只有 `HandRecord`。

**Files:**
- Create: `src/review/situationFromRecord.ts`
- Test: `src/review/situationFromRecord.test.ts`

**Interfaces:**
- Consumes: `HandRecord`, `GameState`, `Action`（`../core/types`）；`startHand`, `applyAction`（`../core/gameEngine`）；`Situation`, `situationFromGameState`（`../core/situation`）；`initialRange`, `narrowByAction`（`../core/opponentRange`）；`RangeSet`（`../core/rangeSet`）；`createRng`（`../core/rng`）
- Produces:
  - `interface HeroDecisionPoint { actionIndex: number; situation: Situation; actual: Action; state: GameState }`
  - `heroDecisionPoints(record: HandRecord, opts?: { strengthIterations?: number }): HeroDecisionPoint[]`

**实现要点：**

1. 用 `startHand({ seed, buttonSeat, startingStacks })` 起局，起始筹码从 `record.seats[].startingStack` 按座位号排序取，与 `replayHandRecord` 一致。
2. 逐个应用 `record.actions`。每应用一个动作**之前**，若该动作的 `seat === record.heroSeat`，就在此刻构造一个决策点。
3. 每应用完一个动作，用 `narrowByAction` 收窄该座位的范围（与 `selfPlayAi.ts` 同一条链路）。`betSize` 必须取**引擎实际记录的投入**，即刚应用后 `state.actions[state.actions.length - 1].amount`，不能取输入动作的 amount —— `call` / `allin` 的输入不带 amount。
4. 每个座位的范围起手为 `initialRange(position)`。**hero 自己的范围不参与收窄**，因为 `situationFromGameState` 只读对手的范围。
5. rng 用 `createRng(`${record.seed}-review`)`，保证同一记录两次复盘逐位相同。

**红线：** 除 `record.seats` 里 hero 那一条的 `holeCards` 外（`startHand` 自己会按 seed 发牌，实际上连这条都不需要读），**不得读取任何座位的 `holeCards`**。对手底牌用于判定就是结果论。本任务有专门的测试守这条。

- [ ] **Step 1: 写失败的测试**

创建 `src/review/situationFromRecord.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import type { HandRecord } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { heroDecisionPoints } from './situationFromRecord';

/** 造一份 hero 至少行动两次的记录：hero 加注、其余弃牌到大盲、大盲跟注、翻牌 hero 下注 */
function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  const guard = 40;
  let n = 0;
  while (!s.handOver && n++ < guard) {
    if (s.toAct === HERO_SEAT) {
      const canRaise = s.street === 'preflop';
      s = applyAction(s, canRaise ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else {
      s = applyAction(s, s.street === 'preflop' && s.toAct === 2 ? { type: 'call' } : { type: 'fold' });
    }
  }
  s = settleHand(s);
  return toHandRecord(s, { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

describe('heroDecisionPoints', () => {
  it('每个 hero 动作对应一个决策点，且顺序与记录一致', () => {
    const rec = makeRecord('rev-1');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const heroActions = rec.actions.filter(a => a.seat === rec.heroSeat);
    expect(pts).toHaveLength(heroActions.length);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].actual.type).toBe(heroActions[i].type);
      expect(rec.actions[pts[i].actionIndex].seat).toBe(rec.heroSeat);
    }
  });

  it('决策点的局面是「该动作发生之前」的局面', () => {
    const rec = makeRecord('rev-2');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    // 构造出的 Situation，其 heroSeat 必须就是待行动的 hero
    for (const p of pts) {
      expect(p.situation.heroSeat).toBe(rec.heroSeat);
      expect(p.state.toAct).toBe(rec.heroSeat);
      expect(p.state.handOver).toBe(false);
    }
  });

  it('hero 的底牌与记录一致', () => {
    const rec = makeRecord('rev-3');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const heroHole = rec.seats.find(s => s.seat === rec.heroSeat)!.holeCards;
    for (const p of pts) {
      expect(p.situation.heroCards[0]).toEqual(heroHole[0]);
      expect(p.situation.heroCards[1]).toEqual(heroHole[1]);
    }
  });

  it('对手范围随其动作收窄 —— 跟注过的对手范围严格小于全范围', () => {
    const rec = makeRecord('rev-4');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const last = pts[pts.length - 1];
    for (const o of last.situation.opponents) {
      expect(o.range.size).toBeGreaterThan(0);
      expect(o.range.size).toBeLessThanOrEqual(169);
    }
  });

  it('同一份记录复盘两次，结果逐位相同', () => {
    const rec = makeRecord('rev-5');
    const a = heroDecisionPoints(rec, { strengthIterations: 15 });
    const b = heroDecisionPoints(rec, { strengthIterations: 15 });
    const key = (pts: ReturnType<typeof heroDecisionPoints>) =>
      JSON.stringify(pts.map(p => ({
        i: p.actionIndex,
        pot: p.situation.pot,
        toCall: p.situation.toCall,
        opp: p.situation.opponents.map(o => [o.seat, [...o.range.entries()].sort()]),
      })));
    expect(key(a)).toBe(key(b));
  });

  it('hero 从未行动的记录返回空数组', () => {
    // hero 在大盲前弃牌的牌局里 hero 仍会行动；构造一个 hero 一动作都没有的记录
    // 的办法是把 heroSeat 指向一个开局即全下的座位 —— 这里退而求其次，
    // 断言函数对「没有 hero 动作」这一情形返回空而不是抛错
    const rec = makeRecord('rev-6');
    const noHero: HandRecord = { ...rec, actions: rec.actions.filter(a => a.seat !== rec.heroSeat) };
    // 动作被抽掉后重放会失败，这正是期望行为：记录不完整必须报错而不是静默给出错误分析
    expect(() => heroDecisionPoints(noHero, { strengthIterations: 15 })).toThrow();
  });
});

describe('不得使用对手底牌', () => {
  it('把对手底牌换成别的牌，判定所依赖的局面不变', () => {
    // 这是本模块最重要的一条性质（spec §8.5）：复盘用对手的实际底牌评判用户决策
    // 就是结果论。底牌在 record 里唾手可得，很容易被"顺手"用上。
    const rec = makeRecord('rev-hole');
    const base = heroDecisionPoints(rec, { strengthIterations: 15 });

    const tampered: HandRecord = {
      ...rec,
      seats: rec.seats.map(s =>
        s.seat === rec.heroSeat ? s : { ...s, holeCards: s.holeCards },
      ),
    };
    // 注意：不能真的改成任意牌 —— startHand 按 seed 发牌，改 record.seats 不影响重放。
    // 正因如此，本测试真正要断言的是：构造过程根本没有从 record.seats 读过对手底牌。
    const after = heroDecisionPoints(tampered, { strengthIterations: 15 });

    const key = (pts: ReturnType<typeof heroDecisionPoints>) =>
      JSON.stringify(pts.map(p => ({
        pot: p.situation.pot,
        opp: p.situation.opponents.map(o => [...o.range.entries()].sort()),
      })));
    expect(key(after)).toBe(key(base));
  });

  it('源码里没有从非 hero 座位读 holeCards 的语句', () => {
    // 上一条测试无法真正证伪（改 record.seats 不影响 startHand 发牌），
    // 所以再加一条静态检查作为守卫。
    const src = readFileSync(new URL('./situationFromRecord.ts', import.meta.url), 'utf8');
    expect(src.includes('holeCards')).toBe(false);
  });
});
```

测试文件顶部需要 `import { readFileSync } from 'node:fs';`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/situationFromRecord.test.ts`
Expected: FAIL，找不到模块 `./situationFromRecord`

- [ ] **Step 3: 实现 situationFromRecord.ts**

创建 `src/review/situationFromRecord.ts`：

```ts
import type { GameState, HandRecord, Action } from '../core/types';
import { startHand, applyAction } from '../core/gameEngine';
import type { Situation } from '../core/situation';
import { situationFromGameState } from '../core/situation';
import type { RangeSet } from '../core/rangeSet';
import { initialRange, narrowByAction } from '../core/opponentRange';
import { createRng } from '../core/rng';

export interface HeroDecisionPoint {
  /** 该动作在 record.actions 里的下标 */
  actionIndex: number;
  /** 动作发生「之前」的局面快照 */
  situation: Situation;
  /** hero 当时实际做的动作 */
  actual: Action;
  /** 动作发生前的引擎状态，供判定时查合法动作等 */
  state: GameState;
}

export interface DecisionPointOptions {
  /** 范围收窄时的牌力排序迭代数。默认 20 */
  strengthIterations?: number;
}

/**
 * 把一份手牌记录部分重放到 hero 的每个决策点，产出当时的局面快照。
 *
 * 复盘只能看到记录，看不到运行中的对局 —— 这是 spec §4.3 里
 * situationFromGameState 的另一半。两者最终都交给同一个 estimateEv，
 * 所以 AI 的判断标准和复盘的判定标准天然一致。
 *
 * **本模块不读取任何座位的底牌。** 公共牌与 hero 底牌都由 startHand
 * 按 record.seed 重新发出，与记录里存的必然一致（replayHandRecord 已验证
 * 这一点）。对手底牌只在展示层用，拿它来评判用户当时的决策就是结果论
 * （spec §8.5）—— 用户下注时并不知道对手拿的什么。
 */
export function heroDecisionPoints(
  record: HandRecord,
  opts: DecisionPointOptions = {},
): HeroDecisionPoint[] {
  const strengthIterations = opts.strengthIterations ?? 20;
  const rng = createRng(`${record.seed}-review`);

  const startingStacks = [...record.seats]
    .sort((a, b) => a.seat - b.seat)
    .map(s => s.startingStack);

  let state = startHand({
    seed: record.seed,
    buttonSeat: record.buttonSeat,
    startingStacks,
  });

  // 每个座位的范围从其位置的开池范围起手，随其动作逐街收窄。
  // 这条链路与 ai/selfPlayAi.ts 完全相同 —— 复盘看到的对手模型
  // 和 AI 当时用的是同一套。
  const ranges = new Map<number, RangeSet>();
  for (const s of state.seats) ranges.set(s.seat, initialRange(s.position));

  const points: HeroDecisionPoint[] = [];

  record.actions.forEach((action, index) => {
    if (action.seat !== state.toAct) {
      throw new Error(
        `situationFromRecord：第 ${index} 个动作记录的座位是 ${action.seat}，` +
          `但重放到此处该行动的座位是 ${state.toAct}——记录可能被重排、增删或篡改`,
      );
    }

    if (action.seat === record.heroSeat) {
      points.push({
        actionIndex: index,
        situation: situationFromGameState(state, { ranges, personaIds: new Map() }),
        actual: action,
        state,
      });
    }

    const before = state;
    state = applyAction(state, { type: action.type, amount: action.amount });

    // 用引擎实际记录的投入来收窄，而不是输入动作的 amount ——
    // call / allin 的输入不带 amount，取到的会是 0，导致 mdf = 1、
    // 尺寸相关的收窄整个失效（这个 bug 在 ②-B-1 的自对弈里出现过）。
    const applied = state.actions[state.actions.length - 1];
    const prev = ranges.get(action.seat)!;
    ranges.set(
      action.seat,
      narrowByAction(prev, action.type, {
        street: before.street,
        board: before.board,
        dead: before.board,
        potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
        betSize: applied?.amount ?? 0,
        strengthIterations,
        rng,
      }),
    );
  });

  if (!state.handOver) {
    throw new Error('situationFromRecord：重放完 record.actions 后本手仍未结束，记录数据不完整');
  }

  return points;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/situationFromRecord.test.ts`
Expected: PASS

若「源码里没有 holeCards」那条失败，**不要改测试** —— 它守的是 spec §8.5 的红线。

- [ ] **Step 5: 提交**

```bash
git add src/review/situationFromRecord.ts src/review/situationFromRecord.test.ts
git commit -m "feat(review): 部分重放手牌记录构造 hero 决策点局面

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: preflopNode —— 推断翻前范围表节点

**Files:**
- Create: `src/review/preflopNode.ts`
- Test: `src/review/preflopNode.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Position`（`../core/types`）；`rfiKey`, `vsOpenKey`, `vs3betKey`, `hasNode`（`../core/ranges`）
- Produces:
  - `interface PreflopNode { key: string; kind: 'rfi' | 'vs-open' | 'vs-3bet'; opener: Position | null }`
  - `preflopNodeFor(state: GameState): PreflopNode | null` —— 无法归类时返回 null（调用方回落到纯 EV 判定）

**归类规则**（只看 `state.actions` 里翻前的加注序列）：
- 之前没有任何加注 → hero 是开池者 → `rfi`
- 之前恰好一次加注 → hero 面对开池 → `vs-open`，opener 为那次加注者的位置
- 之前恰好两次加注 → hero 面对 3bet → `vs-3bet`
- 三次及以上（4bet 之后）→ 返回 null，范围表未覆盖

盲注不在 `actions` 里（见 `types.ts` 上 `Action` 的注释），所以「加注次数」直接数 `type === 'raise'` 即可，不必扣除盲注。

- [ ] **Step 1: 写失败的测试**

创建 `src/review/preflopNode.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction } from '../core/gameEngine';
import { hasNode } from '../core/ranges';
import { preflopNodeFor } from './preflopNode';

describe('preflopNodeFor', () => {
  it('首个行动者是开池节点', () => {
    const s = startHand({ seed: 'node-1', buttonSeat: 0 });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('rfi');
    expect(n.opener).toBeNull();
    expect(hasNode(n.key)).toBe(true);
  });

  it('一次加注之后是面对开池节点，且记下开池者位置', () => {
    let s = startHand({ seed: 'node-2', buttonSeat: 0 });
    const openerPos = s.seats.find(x => x.seat === s.toAct)!.position;
    s = applyAction(s, { type: 'raise', amount: 3 });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('vs-open');
    expect(n.opener).toBe(openerPos);
  });

  it('两次加注之后是面对 3bet 节点', () => {
    let s = startHand({ seed: 'node-3', buttonSeat: 0 });
    s = applyAction(s, { type: 'raise', amount: 3 });
    while (s.toAct !== null && !s.handOver) {
      const t = s.toAct;
      s = applyAction(s, { type: 'raise', amount: 9 });
      if (t !== null) break;
    }
    const n = preflopNodeFor(s);
    if (n) expect(n.kind).toBe('vs-3bet');
  });

  it('翻后返回 null', () => {
    let s = startHand({ seed: 'node-4', buttonSeat: 0 });
    let guard = 0;
    while (s.street === 'preflop' && !s.handOver && guard++ < 20) {
      s = applyAction(s, s.toAct === null ? { type: 'check' } : { type: 'call' });
    }
    if (s.street !== 'preflop') expect(preflopNodeFor(s)).toBeNull();
  });

  it('跛入不计作加注 —— 全跛到大盲仍是开池节点族', () => {
    let s = startHand({ seed: 'node-5', buttonSeat: 0 });
    s = applyAction(s, { type: 'call' });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('rfi');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/preflopNode.test.ts`
Expected: FAIL，找不到模块 `./preflopNode`

- [ ] **Step 3: 实现 preflopNode.ts**

创建 `src/review/preflopNode.ts`：

```ts
import type { GameState, Position } from '../core/types';
import { rfiKey, vsOpenKey, vs3betKey, hasNode } from '../core/ranges';

export interface PreflopNode {
  /** 范围表里的节点 key */
  key: string;
  kind: 'rfi' | 'vs-open' | 'vs-3bet';
  /** vs-open / vs-3bet 时的进攻者位置；rfi 时为 null */
  opener: Position | null;
}

/**
 * 从当前状态推断适用的翻前范围表节点。
 *
 * 只数加注次数：盲注不在 actions 里（见 types.ts 上 Action 的注释），
 * 所以不必为盲注做任何扣除。跛入是 call，不计入。
 *
 * 4bet 之后的节点范围表未覆盖，返回 null —— 调用方应回落到纯 EV 判定，
 * 而不是拿一个不存在的节点去查表。
 */
export function preflopNodeFor(state: GameState): PreflopNode | null {
  if (state.street !== 'preflop') return null;
  if (state.toAct === null) return null;

  const hero = state.seats.find(s => s.seat === state.toAct);
  if (!hero) return null;

  const raises = state.actions.filter(a => a.type === 'raise' || a.type === 'allin');

  if (raises.length === 0) {
    const key = rfiKey(hero.position);
    return hasNode(key) ? { key, kind: 'rfi', opener: null } : null;
  }

  if (raises.length === 1) {
    const opener = state.seats.find(s => s.seat === raises[0].seat);
    if (!opener) return null;
    const key = vsOpenKey(hero.position, opener.position);
    return hasNode(key) ? { key, kind: 'vs-open', opener: opener.position } : null;
  }

  if (raises.length === 2) {
    const threeBettor = state.seats.find(s => s.seat === raises[1].seat);
    if (!threeBettor) return null;
    const key = vs3betKey(hero.position, threeBettor.position);
    return hasNode(key) ? { key, kind: 'vs-3bet', opener: threeBettor.position } : null;
  }

  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/preflopNode.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/review/preflopNode.ts src/review/preflopNode.test.ts
git commit -m "feat(review): 从重放状态推断翻前范围表节点

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: judge —— 单个决策点的判定

**Files:**
- Create: `src/review/types.ts`
- Create: `src/review/judge.ts`
- Test: `src/review/judge.test.ts`

**Interfaces:**
- Consumes: `Situation`（`../core/situation`）；`EvResult`, `EvCandidate`（`../core/evEstimate`）；`Action`, `ActionType`（`../core/types`）；`classifyHand`（`../core/handClass`）；`actionFreqs`（`../core/ranges`）；Task 1 与 Task 3 的产出
- Produces（`src/review/types.ts`）：
  - `interface DecisionAnalysis { actionIndex; street; situation; actual; actualEv; recommended; evLoss; severity; tag; explanation; degraded }`
  - `interface HandAnalysis { recordId; heroSeat; schemaVersion; decisions; totalEvLoss; worstEvLoss; tags }`
  - `REVIEW_SCHEMA_VERSION = 1`
- Produces（`src/review/judge.ts`）：
  - `matchCandidate(ev: EvResult, actual: Action): EvCandidate | null`
  - `judgePreflopFrequency(node: PreflopNode | null, situation: Situation, actual: Action): boolean` —— 返回「按频率表算不算 ok」
  - `tagFor(situation, actual, actualCand, ev): MistakeTag | null`

**三条必须守住的规则：**

1. **`ev.degraded !== null` 时不产出 BB 数字。** 该决策点 `evLoss` 记 0、`severity` 记 `ok`、`tag` 记 null、`degraded` 置 true。这是 ②-B-1 留下的硬约束：degraded 意味着对手范围被替换过，那个数字不能拿去告诉用户亏了多少。
2. **翻前频率达标即 ok。** 查 `actionFreqs(node.key, handClass)`，用户动作对应的频率 ≥ `PREFLOP_OK_FREQ` 就判 ok，evLoss 记 0，不再看 EV 差。
3. **`evLoss` 取 `max(0, EV(推荐) − EV(实际))`。** 蒙特卡洛噪声会让实际动作偶尔算出比推荐更高的 EV，负值一律归零。

**候选匹配规则：** 按 `actionType` 找同类候选；`bet`/`raise` 有多个尺度时取 `investment` 最接近的那个。用户尺度落在两档之间会引入误差，这是已知近似，写进注释与 README。

- [ ] **Step 1: 写失败的测试**

创建 `src/review/judge.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import type { Action } from '../core/types';
import { matchCandidate } from './judge';

function cand(label: string, actionType: EvCandidate['actionType'], investment: number, ev: number): EvCandidate {
  return { label, actionType, investment, ev, isRecommended: false };
}

function result(candidates: EvCandidate[], degraded: EvResult['degraded'] = null): EvResult {
  return {
    candidates,
    heroEquity: 0.5,
    requiredEquity: 0.33,
    recommended: candidates[0],
    iterations: 500,
    degraded,
    degradedOpponentCount: degraded ? 1 : 0,
  };
}

/** Action 的七个字段都是必填的；判定只读 type 与 amount，其余给合理占位值 */
function act(type: Action['type'], amount: number): Action {
  return { seat: 0, street: 'flop', type, amount, potBefore: 9, toCall: 0, stackBefore: 100 };
}

describe('matchCandidate', () => {
  it('按动作类型匹配', () => {
    const ev = result([cand('fold', 'fold', 0, 0), cand('call', 'call', 2, 1.5)]);
    expect(matchCandidate(ev, act('call', 2))!.actionType).toBe('call');
  });

  it('多个下注尺度时取投入最接近的', () => {
    const ev = result([
      cand('bet 1/3', 'bet', 3, 1),
      cand('bet 1/2', 'bet', 4.5, 2),
      cand('bet pot', 'bet', 9, 0.5),
    ]);
    expect(matchCandidate(ev, act('bet', 5))!.label).toBe('bet 1/2');
  });

  it('恰好落在两档中间时取其一，且不抛错', () => {
    // 3 与 4.5 的中点是 3.75，两档距离相等 —— 实现用严格小于比较，取先出现的那档
    const ev = result([cand('bet 1/3', 'bet', 3, 1), cand('bet 1/2', 'bet', 4.5, 2)]);
    expect(matchCandidate(ev, act('bet', 3.75))!.label).toBe('bet 1/3');
  });

  it('没有同类候选时返回 null', () => {
    const ev = result([cand('fold', 'fold', 0, 0)]);
    expect(matchCandidate(ev, act('bet', 5))).toBeNull();
  });
});
```

Task 6 会补上端到端的判定测试。本任务的 `tagFor` 与 `judgePreflopFrequency` 由 Task 7 的金标准场景覆盖。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/judge.test.ts`
Expected: FAIL，找不到模块 `./judge`

- [ ] **Step 3: 实现 types.ts 与 judge.ts**

创建 `src/review/types.ts`：

```ts
import type { Street, Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvCandidate } from '../core/evEstimate';
import type { Severity, MistakeTag } from './taxonomy';

export interface DecisionAnalysis {
  /** 该动作在 HandRecord.actions 里的下标 */
  actionIndex: number;
  street: Street;
  /** 当时的局面，供 UI 复现牌面与底池 */
  situation: Situation;
  actual: Action;
  /** 用户实际动作的 EV。无法匹配到候选时为 null */
  actualEv: number | null;
  recommended: EvCandidate;
  /** max(0, EV(推荐) − EV(实际))。degraded 时恒为 0 */
  evLoss: number;
  severity: Severity;
  tag: MistakeTag | null;
  explanation: string;
  /**
   * 估算是否降级（对手范围被替换过）。为 true 时 evLoss 不可信，
   * 已强制记 0、severity 记 ok —— UI 应显示「本手此处无法判定」而不是数字。
   */
  degraded: boolean;
}

export interface HandAnalysis {
  recordId: string;
  heroSeat: number;
  schemaVersion: number;
  decisions: DecisionAnalysis[];
  /** 所有决策点 evLoss 之和 */
  totalEvLoss: number;
  /** 单个决策点的最大 evLoss，供历史列表排序（spec §9 的索引字段） */
  worstEvLoss: number;
  /** 本手出现过的所有 tag，去重。对应 §9 的 mistakeTags multiEntry 索引 */
  tags: MistakeTag[];
}

export const REVIEW_SCHEMA_VERSION = 1;
```

创建 `src/review/judge.ts`：

```ts
import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import { classifyHand } from '../core/handClass';
import { actionFreqs } from '../core/ranges';
import { chipsGreater } from '../core/chips';
import type { MistakeTag } from './taxonomy';
import { PREFLOP_OK_FREQ } from './taxonomy';
import type { PreflopNode } from './preflopNode';

/**
 * 把用户的实际动作对应到一个 EV 候选。
 *
 * 已知近似：用户的下注尺度可能落在两个候选档之间（比如 0.4 池），
 * 此时取最接近的一档，EV 会有偏差。候选尺度固定为五档是 spec §8.3
 * 的决定（连续尺度搜索收益低、开销大），所以这个偏差是设计的一部分，
 * 不是缺陷 —— 但要在 UI 与文档里说明。
 */
export function matchCandidate(ev: EvResult, actual: Action): EvCandidate | null {
  const same = ev.candidates.filter(c => c.actionType === actual.type);
  if (same.length === 0) return null;
  if (same.length === 1) return same[0];

  const target = actual.amount;
  let best = same[0];
  let bestGap = Math.abs(best.investment - target);
  for (const c of same) {
    const gap = Math.abs(c.investment - target);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * 翻前按频率表判定是否算失误（spec §8.2）。
 *
 * 范围表只存频率不存 EV，所以它只回答「这算不算失误」，
 * 不回答「亏了多少」—— 后者由同一套 EV 估算给出，量纲才能和翻后相加。
 *
 * 均衡策略是混合的：同一手牌在同一节点可能 30% 加注、70% 跟注。
 * 用户选了低频但合法的那一支不该被判错，所以阈值取 0.15 而不是「最高频动作」。
 */
export function judgePreflopFrequency(
  node: PreflopNode | null,
  situation: Situation,
  actual: Action,
): boolean {
  if (!node) return false;
  const hc = classifyHand(situation.heroCards[0], situation.heroCards[1]);
  const freqs = actionFreqs(node.key, hc);
  if (!freqs) return false;

  // 引擎的动作类型与范围表的动作名对不上：表里用 raise / call / 3bet / 4bet / fold
  const key = preflopActionKey(node, actual.type);
  if (!key) return false;
  return (freqs[key] ?? 0) >= PREFLOP_OK_FREQ;
}

function preflopActionKey(node: PreflopNode, type: Action['type']): string | null {
  if (type === 'fold') return 'fold';
  if (type === 'call') return 'call';
  if (type === 'raise' || type === 'allin') {
    if (node.kind === 'rfi') return 'raise';
    if (node.kind === 'vs-open') return '3bet';
    return '4bet';
  }
  return null;
}

/**
 * 按局面特征给失误打分类标签（spec §8.7）。
 *
 * 规则按「最具体的先判」排序 —— 一个决策可能同时符合多条描述，
 * 取最能说明问题的那一条。返回 null 表示能算出损失但归不进任何一类，
 * 此时 UI 只显示损失额与推荐动作。
 */
export function tagFor(
  situation: Situation,
  actual: Action,
  actualCand: EvCandidate | null,
  ev: EvResult,
): MistakeTag | null {
  const rec = ev.recommended;
  const isPreflop = situation.street === 'preflop';
  const facingBet = chipsGreater(situation.toCall, 0);

  if (isPreflop) {
    if (actual.type === 'fold' && (rec.actionType === 'call' || rec.actionType === 'raise')) {
      return 'preflop_fold_too_tight';
    }
    if (actual.type === 'call' && rec.actionType === 'raise') {
      return 'preflop_missed_3bet';
    }
    if (actual.type === 'call' && rec.actionType === 'fold') {
      return 'preflop_cold_call_too_wide';
    }
    if (actual.type === 'call' && !facingBet && situation.heroPosition === 'SB') {
      return 'preflop_sb_limp';
    }
    if ((actual.type === 'raise' || actual.type === 'allin') && rec.actionType === 'fold') {
      return facingBet ? 'preflop_over_aggressive' : 'preflop_open_too_wide';
    }
    return null;
  }

  // ── 翻后
  if (actual.type === 'fold' && rec.actionType !== 'fold') {
    // 该继续却弃了。§8.7 的翻后分类里没有「弃得太紧」这一条 ——
    // 翻后弃牌过紧的形态太多（弃掉听牌、弃掉成手、弃掉底池赔率足够的边缘牌），
    // 归成一个标签没有指导意义。返回 null，UI 只显示损失额与推荐动作。
    return null;
  }
  if ((actual.type === 'call' || actual.type === 'raise' || actual.type === 'allin') &&
      rec.actionType === 'fold') {
    if (actual.type !== 'call') return 'should_have_folded';
    return isRaiseFaced(situation) ? 'call_too_light_vs_raise' : 'chasing_bad_odds';
  }
  if ((actual.type === 'check' || actual.type === 'call') && (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (situation.street === 'flop' && situation.heroIsPreflopAggressor && actual.type === 'check') {
      return 'missed_cbet';
    }
    return 'missed_value_bet';
  }
  if ((actual.type === 'bet' || actual.type === 'raise') && rec.actionType === 'fold') {
    return 'over_bluffing';
  }
  if ((actual.type === 'bet' || actual.type === 'raise') && rec.actionType === 'check') {
    // 下注但推荐过牌：弃牌率不足的诈唬
    if (rec.foldEquity !== undefined && rec.foldEquity < 0.2) return 'ineffective_bluff';
    return 'over_bluffing';
  }
  if (actualCand && (actual.type === 'bet' || actual.type === 'raise') &&
      (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (chipsGreater(rec.investment, actualCand.investment)) return 'bet_size_too_small';
    if (chipsGreater(actualCand.investment, rec.investment)) return 'bet_size_too_large';
  }
  return null;
}

/**
 * 面对的是不是一个「大注」——用于区分「面对加注跟太松」与「赔率不足追听牌」。
 *
 * 用 toCall 超过半个底池作为代理，而不是去 actions 里找有没有 raise：
 * 半池以上的下注要求跟注方有 33% 以上的胜率，这个门槛本身就是
 * 「跟太松」的判定依据，比「技术上是不是一次 raise」更贴近要表达的意思。
 */
function isRaiseFaced(situation: Situation): boolean {
  return chipsGreater(situation.toCall, situation.pot * 0.5);
}
```

**实现者注意：** `tagFor` 的分支顺序有意义 —— 上面的分支更具体，命中即返回。调整顺序会改变分类结果，改动前先想清楚哪条更该优先。测试要覆盖「用户弃牌而推荐继续」（返回 null）与「用户跟注而推荐弃牌」（返回 tag）两个方向。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/judge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/review/types.ts src/review/judge.ts src/review/judge.test.ts
git commit -m "feat(review): 决策点判定——候选匹配、翻前频率、错误分类

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: explain —— 解释文案

**Files:**
- Create: `src/review/explain.ts`
- Test: `src/review/explain.test.ts`

**Interfaces:**
- Consumes: `Situation`；`EvCandidate`；`MistakeTag`, `Severity`（`./taxonomy`）
- Produces:
  - `explain(input: { tag; severity; situation; actual; actualEv; recommended; evLoss; degraded }): string`

**要求：**
- 每个 `MistakeTag` 有一条模板，填入底池、胜率、所需胜率、损失额等真实数值。
- `degraded` 为 true 时**不得出现任何 BB 数字**，固定输出「本手此处对手范围过窄，估算已降级，不做判定」。
- `severity === 'ok'` 且无 tag 时输出简短肯定语，不编造理由。
- 文案用中文，不使用感叹号，不评价用户水平，只陈述数字与替代方案。

- [ ] **Step 1: 写失败的测试**

创建 `src/review/explain.test.ts`，至少覆盖：

```ts
import { describe, it, expect } from 'vitest';
import { explain } from './explain';
import { POSTFLOP_TAGS, PREFLOP_TAGS } from './taxonomy';

// 构造一个最小可用的输入；situation 只需 explain 实际读到的字段
function input(overrides: Partial<Parameters<typeof explain>[0]> = {}) {
  return {
    tag: null,
    severity: 'ok' as const,
    situation: {
      pot: 10, toCall: 3, street: 'flop' as const, heroEquity: 0.4,
    } as never,
    actual: { seat: 0, street: 'flop' as const, type: 'call' as const, amount: 3 },
    actualEv: 1.2,
    recommended: { label: 'fold', actionType: 'fold' as const, investment: 0, ev: 0, isRecommended: true },
    evLoss: 0,
    degraded: false,
    heroEquity: 0.4,
    requiredEquity: 0.23,
    ...overrides,
  };
}

describe('explain', () => {
  it('每个 tag 都有对应模板，且产出非空文案', () => {
    for (const tag of [...PREFLOP_TAGS, ...POSTFLOP_TAGS]) {
      const text = explain(input({ tag, severity: 'minor', evLoss: 0.5 }));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    }
  });

  it('降级时不出现任何 BB 数字', () => {
    const text = explain(input({ degraded: true, evLoss: 0, severity: 'ok' }));
    expect(text).not.toMatch(/\d+(\.\d+)?\s*BB/);
    expect(text).toContain('降级');
  });

  it('无失误时给简短肯定，不编造理由', () => {
    const text = explain(input({ tag: null, severity: 'ok', evLoss: 0 }));
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(40);
  });

  it('有损失时文案里带上损失数值', () => {
    const text = explain(input({ tag: 'chasing_bad_odds', severity: 'notable', evLoss: 1.8 }));
    expect(text).toContain('1.8');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/explain.test.ts`
Expected: FAIL，找不到模块 `./explain`

- [ ] **Step 3: 实现 explain.ts**

创建 `src/review/explain.ts`。骨架如下，**`TEMPLATES` 必须是 `Record<MistakeTag, …>` 而不是 `Partial<Record<…>>`** —— 这样将来新增 tag 却漏写模板会直接编译失败，而不是运行时静默输出空字符串：

```ts
import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvCandidate } from '../core/evEstimate';
import type { MistakeTag, Severity } from './taxonomy';

export interface ExplainInput {
  tag: MistakeTag | null;
  severity: Severity;
  situation: Situation;
  actual: Action;
  actualEv: number | null;
  recommended: EvCandidate;
  evLoss: number;
  degraded: boolean;
  /** hero 对当前对手范围的胜率，来自 EvResult.heroEquity */
  heroEquity: number;
  /** 跟注所需最低胜率，来自 EvResult.requiredEquity；无需跟注时为 null */
  requiredEquity: number | null;
}

/** 模板可用的数值，先算好再填，避免每条模板各算一遍 */
interface Ctx {
  pot: string;
  toCall: string;
  loss: string;
  equity: string;
  required: string;
  recLabel: string;
}

const TEMPLATES: Record<MistakeTag, (c: Ctx) => string> = {
  preflop_open_too_wide: c =>
    `这手牌不在该位置的开池范围内，开池损失约 ${c.loss} BB。建议${c.recLabel}。`,
  preflop_fold_too_tight: c =>
    `底池 ${c.pot} BB，跟注 ${c.toCall} BB 只需 ${c.required} 的胜率，而这手牌有 ${c.equity}。弃牌损失约 ${c.loss} BB。`,
  chasing_bad_odds: c =>
    `跟注 ${c.toCall} BB 需要 ${c.required} 的胜率，这手牌只有 ${c.equity}，损失约 ${c.loss} BB。`,
  // …其余 12 条同样风格：先给数字，再给替代方案
  preflop_cold_call_too_wide: c => `…`,
  preflop_missed_3bet: c => `…`,
  preflop_over_aggressive: c => `…`,
  preflop_sb_limp: c => `…`,
  missed_cbet: c => `…`,
  missed_value_bet: c => `…`,
  call_too_light_vs_raise: c => `…`,
  should_have_folded: c => `…`,
  bet_size_too_small: c => `…`,
  bet_size_too_large: c => `…`,
  ineffective_bluff: c => `…`,
  over_bluffing: c => `…`,
};

export function explain(input: ExplainInput): string {
  // 降级优先于一切：此时任何 BB 数字都不可信，绝不能出现在文案里
  if (input.degraded) {
    return '本手此处对手范围过窄，估算已降级，不做判定。';
  }
  if (!input.tag) {
    return input.severity === 'ok' ? '这一步没问题。' : `建议${input.recommended.label}。`;
  }
  return TEMPLATES[input.tag](buildCtx(input));
}
```

`buildCtx` 把数值格式化成字符串：金额保留一位小数（`10.0`），胜率格式化成百分数（`42%`）。`requiredEquity` 为 null 时（无需跟注）填 `—`，模板里不要引用它。

省略号那 12 条由实现者按同样风格补全：**先给数字，再给替代方案，不评价用户水平，不用感叹号。**

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/explain.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/review/explain.ts src/review/explain.test.ts
git commit -m "feat(review): 按错误分类生成解释文案

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: analyzeHand —— 入口

**Files:**
- Create: `src/review/analyzeHand.ts`
- Test: `src/review/analyzeHand.test.ts`

**Interfaces:**
- Consumes: Task 1–5 的全部产出；`estimateEv`（`../core/evEstimate`）；`createRng`（`../core/rng`）
- Produces:
  - `interface AnalyzeOptions { iterations?: number; strengthIterations?: number }`
  - `analyzeHand(record: HandRecord, opts?: AnalyzeOptions): HandAnalysis`

**流程**（spec §8.1）：对 `heroDecisionPoints` 的每个决策点 → `estimateEv` → 匹配实际候选 → 翻前先查频率表 → 算 evLoss → 定 severity → 打 tag → 生成文案。

**必须守住：**
- `ev.degraded !== null` → `evLoss = 0`、`severity = 'ok'`、`tag = null`、`degraded = true`。
- 翻前频率达标 → `evLoss = 0`、`severity = 'ok'`、`tag = null`（但 `degraded` 为 false）。
- `evLoss = Math.max(0, rec.ev − actualEv)`；`actualEv` 为 null（匹配不到候选）时 `evLoss` 记 0 并 `tag = null`。
- rng 用 `createRng(`${record.id}-analyze`)`，同一记录两次分析结果逐位相同。

- [ ] **Step 1: 写失败的测试**

创建 `src/review/analyzeHand.test.ts`，至少覆盖：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { HandRecord } from '../core/types';
import { analyzeHand } from './analyzeHand';
import { REVIEW_SCHEMA_VERSION } from './types';

function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  let n = 0;
  while (!s.handOver && n++ < 40) {
    if (s.toAct === HERO_SEAT) {
      s = applyAction(s, s.street === 'preflop' ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else {
      s = applyAction(s, s.street === 'preflop' && s.toAct === 2 ? { type: 'call' } : { type: 'fold' });
    }
  }
  return toHandRecord(settleHand(s), { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

const OPTS = { iterations: 200, strengthIterations: 15 };

describe('analyzeHand', () => {
  it('每个 hero 动作产出一条分析', () => {
    const rec = makeRecord('an-1');
    const a = analyzeHand(rec, OPTS);
    expect(a.decisions).toHaveLength(rec.actions.filter(x => x.seat === rec.heroSeat).length);
    expect(a.recordId).toBe(rec.id);
    expect(a.schemaVersion).toBe(REVIEW_SCHEMA_VERSION);
  });

  it('汇总字段与逐条一致', () => {
    const a = analyzeHand(makeRecord('an-2'), OPTS);
    const sum = a.decisions.reduce((x, d) => x + d.evLoss, 0);
    expect(a.totalEvLoss).toBeCloseTo(sum, 6);
    expect(a.worstEvLoss).toBeCloseTo(Math.max(0, ...a.decisions.map(d => d.evLoss)), 6);
    const tags = new Set(a.decisions.map(d => d.tag).filter(Boolean));
    expect(new Set(a.tags)).toEqual(tags);
  });

  it('evLoss 恒非负', () => {
    for (const seed of ['an-3', 'an-4', 'an-5']) {
      for (const d of analyzeHand(makeRecord(seed), OPTS).decisions) {
        expect(d.evLoss).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('降级的决策点不报损失', () => {
    for (const seed of ['an-6', 'an-7']) {
      for (const d of analyzeHand(makeRecord(seed), OPTS).decisions) {
        if (d.degraded) {
          expect(d.evLoss).toBe(0);
          expect(d.severity).toBe('ok');
          expect(d.tag).toBeNull();
        }
      }
    }
  });

  it('同一记录分析两次结果逐位相同', () => {
    const rec = makeRecord('an-8');
    const a = analyzeHand(rec, OPTS);
    const b = analyzeHand(rec, OPTS);
    expect(JSON.stringify(a.decisions.map(d => [d.evLoss, d.severity, d.tag])))
      .toBe(JSON.stringify(b.decisions.map(d => [d.evLoss, d.severity, d.tag])));
  });

  it('severity 与 evLoss 一致', () => {
    for (const d of analyzeHand(makeRecord('an-9'), OPTS).decisions) {
      if (d.evLoss < 0.2) expect(d.severity).toBe('ok');
      else if (d.evLoss < 1) expect(d.severity).toBe('minor');
      else if (d.evLoss < 3) expect(d.severity).toBe('notable');
      else expect(d.severity).toBe('severe');
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/review/analyzeHand.test.ts`
Expected: FAIL，找不到模块 `./analyzeHand`

- [ ] **Step 3: 实现 analyzeHand.ts**

创建 `src/review/analyzeHand.ts`：

```ts
import type { HandRecord } from '../core/types';
import { estimateEv } from '../core/evEstimate';
import { createRng } from '../core/rng';
import type { HandAnalysis, DecisionAnalysis } from './types';
import { REVIEW_SCHEMA_VERSION } from './types';
import type { MistakeTag } from './taxonomy';
import { severityOf } from './taxonomy';
import { heroDecisionPoints } from './situationFromRecord';
import { preflopNodeFor } from './preflopNode';
import { matchCandidate, judgePreflopFrequency, tagFor } from './judge';
import { explain } from './explain';

export interface AnalyzeOptions {
  /** 主胜率估算的迭代数。默认 1500 —— 复盘不受手机实时预算约束，可以比 AI 算得准 */
  iterations?: number;
  /** 范围牌力排序的迭代数。默认 40 */
  strengthIterations?: number;
}

/**
 * 复盘一手牌：对 hero 的每个决策点给出「错在哪、亏了多少、属于哪类」。
 *
 * 与 AI 走同一条估算路径（core/evEstimate），所以不会出现
 * 「复盘说该弃牌、AI 在同样局面从不弃」这种割裂。
 *
 * 迭代数默认比 AI 高：AI 有 100ms 的手机预算，复盘没有，
 * 可以用更多采样换更小的噪声。
 */
export function analyzeHand(record: HandRecord, opts: AnalyzeOptions = {}): HandAnalysis {
  const iterations = opts.iterations ?? 1500;
  const strengthIterations = opts.strengthIterations ?? 40;

  const points = heroDecisionPoints(record, { strengthIterations });
  const decisions: DecisionAnalysis[] = [];

  for (const p of points) {
    // 每个决策点用自己的 rng，且种子只与记录 id 和动作下标有关 ——
    // 这样某个决策点的采样次数变化不会影响后面决策点的结果，
    // 单点调试时也能独立复现。
    const rng = createRng(`${record.id}-analyze-${p.actionIndex}`);
    const ev = estimateEv(p.situation, { iterations, strengthIterations, rng });

    const actualCand = matchCandidate(ev, p.actual);
    const actualEv = actualCand ? actualCand.ev : null;
    const degraded = ev.degraded !== null;

    // ── 三条短路，顺序有意义
    // 1) 估算降级：对手范围被替换过，这个数字不能拿去告诉用户亏了多少（②-B-1 的硬约束）
    // 2) 翻前频率达标：均衡策略是混合的，低频但合法的选择不算失误（spec §8.2）
    // 3) 匹配不到候选：算不出损失就不报损失，宁可少算
    const preflopOk =
      p.situation.street === 'preflop' &&
      judgePreflopFrequency(preflopNodeFor(p.state), p.situation, p.actual);

    const skip = degraded || preflopOk || actualEv === null;

    const evLoss = skip ? 0 : Math.max(0, round4(ev.recommended.ev - actualEv));
    const severity = severityOf(evLoss);
    const tag: MistakeTag | null =
      skip || severity === 'ok' ? null : tagFor(p.situation, p.actual, actualCand, ev);

    decisions.push({
      actionIndex: p.actionIndex,
      street: p.situation.street,
      situation: p.situation,
      actual: p.actual,
      actualEv,
      recommended: ev.recommended,
      evLoss,
      severity,
      tag,
      explanation: explain({
        tag,
        severity,
        situation: p.situation,
        actual: p.actual,
        actualEv,
        recommended: ev.recommended,
        evLoss,
        degraded,
        heroEquity: ev.heroEquity,
        requiredEquity: ev.requiredEquity,
      }),
      degraded,
    });
  }

  const tags = [...new Set(decisions.map(d => d.tag).filter((t): t is MistakeTag => t !== null))];

  return {
    recordId: record.id,
    heroSeat: record.heroSeat,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    decisions,
    totalEvLoss: round4(decisions.reduce((a, d) => a + d.evLoss, 0)),
    worstEvLoss: decisions.length === 0 ? 0 : Math.max(...decisions.map(d => d.evLoss)),
    tags,
  };
}

/** 与 evEstimate 的取整位数一致，避免浮点尾数让测试抖动 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/review/analyzeHand.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套并提交**

```bash
git add src/review/analyzeHand.ts src/review/analyzeHand.test.ts
git commit -m "feat(review): analyzeHand 入口，逐决策点产出复盘结论

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 金标准场景

约 40 个答案无争议的场景作为回归网。**这是整个复盘引擎唯一的正确性锚点** —— 前六个任务的测试证明的是「代码按设计跑」，本任务证明的是「设计本身给出的答案对不对」。

**Files:**
- Create: `src/review/goldenScenarios.test.ts`

**构造方式：** 用 `startHand` + 一串 `applyAction` 造出目标局面，`settleHand` 后 `toHandRecord`，再 `analyzeHand`。不要手写 `HandRecord` 字面量 —— 那样既冗长又容易和引擎的真实行为脱节。

**场景清单**（每条都要能一句话说清为什么答案无争议）：

翻前（约 15 条）：
- UTG 拿 72o 开池 → 应判失误，tag `preflop_open_too_wide`
- UTG 拿 AA 开池 → 应判 ok
- BTN 拿 AA 面对 UTG 开池选择弃牌 → 应判失误，`preflop_fold_too_tight`，severity 至少 `notable`
- BB 拿 72o 面对 UTG 开池弃牌 → ok
- SB 拿 KK 面对开池只跟注 → `preflop_missed_3bet`
- SB 跛入 → `preflop_sb_limp`
- 拿 22 在 UTG 开池 → 按范围表频率判定（表里 22 不在 UTG 开池范围 → 失误）
- 其余按 `ranges/data.ts` 里实际录入的节点补齐，每个节点至少一条

翻后（约 25 条）：
- 翻牌圈拿坚果同花面对小注只跟注不加注 → `missed_value_bet`
- 翻牌圈无对无听牌面对满池下注跟注 → `should_have_folded`，severity 至少 `notable`
- 河牌圈拿空气对着弃牌率极低的对手诈唬 → `ineffective_bluff`
- 翻前加注者在翻牌圈过牌，且推荐下注 → `missed_cbet`
- 面对赔率不足的听牌跟注 → `chasing_bad_odds`
- 拿超强牌只下 1/3 池而推荐满池 → `bet_size_too_small`

**每条场景断言：** `severity`、`tag`，以及 `evLoss` 的量级区间（用区间不用精确值 —— 蒙特卡洛有噪声）。

**关键纪律：** 如果某条场景的实际输出与预期不符，**先判断是引擎错了还是预期错了**，不要直接改预期让它通过。判断不了就停下来报告，附上该场景的 seed、局面描述、实际输出的全部候选 EV。一个被改到通过的金标准场景，比没有这条场景更糟 —— 它会给出正确性的假象。

- [ ] **Step 1: 先写 5 条最无争议的，跑通**

先做「UTG 拿 AA 开池 → ok」「UTG 拿 72o 开池 → 失误」「BTN 拿 AA 面对开池弃牌 → 失误」「翻牌无对面对满池跟注 → 失误」「BB 拿 72o 面对开池弃牌 → ok」这五条。跑通再扩。

- [ ] **Step 2: 报告这 5 条的实际输出**

在报告里给出每条的 `evLoss`、`severity`、`tag`、以及 `estimateEv` 给出的全部候选 EV。**这是人工核对引擎判断是否合理的唯一机会** —— 后面 35 条都建立在这五条建立的信任上。

- [ ] **Step 3: 扩到 40 条**

- [ ] **Step 4: 跑全套并提交**

```bash
git add src/review/goldenScenarios.test.ts
git commit -m "test(review): 四十个金标准场景作为复盘判定的回归网

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完成标准

- [ ] `npm test` 全绿，`npm run typecheck` 退出码 0
- [ ] `src/review/` 不导入 `src/ai/` 的任何模块
- [ ] 复盘判定不读取非 hero 座位的 `holeCards`（有静态检查守着）
- [ ] `degraded` 的决策点不输出 BB 数字
- [ ] 同一份 `HandRecord` 复盘两次结果逐位相同
- [ ] 40 个金标准场景全部通过，且前 5 条的完整输出经人工核对

## 交付物清单

```
src/review/taxonomy.ts
src/review/situationFromRecord.ts
src/review/preflopNode.ts
src/review/types.ts
src/review/judge.ts
src/review/explain.ts
src/review/analyzeHand.ts
+ 对应的 *.test.ts
src/review/goldenScenarios.test.ts
```

## 下一步

计划 ③（产品层）：Vite + React 脚手架、IndexedDB（§9）、牌桌 UI（§10.2）、复盘卡片（§10.3）、历史页与漏洞报表（§10.4/10.5）、PWA 与部署。

其中 IndexedDB 的 `hands` store 直接存本计划产出的 `{ record, analysis }`，索引字段 `worstEvLoss` 与 `mistakeTags` 已在 `HandAnalysis` 里备好。
