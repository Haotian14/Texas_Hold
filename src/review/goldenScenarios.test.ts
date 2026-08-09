import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, legalActions, currentPot } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { GameState } from '../core/types';
import { classifyHand } from '../core/handClass';
import { chipsGreater, round2 } from '../core/chips';
import { analyzeHand } from './analyzeHand';
import type { Severity } from './taxonomy';

/**
 * 金标准场景库（Step 1：前五条，见任务书 §Step1）。
 *
 * 每条场景的种子都是"搜出来的"，不是编出来的：startHand 从种子发牌，
 * 没有办法指定 hero 拿到哪手牌，只能枚举种子直到发到目标牌（见任务书
 * "How to build them"）。搜索脚本本身不留在这里——它慢、且只在选中种子
 * 那一刻有意义；选中的种子连同"它发出的是哪手牌"写死在下面的注释里，
 * 并且每条用例都会用 classifyHand 断言一次，牌面判定逻辑一旦变化，
 * 这里会当场报错，而不是悄悄地在测错的东西。
 */

const EV_OPTS = { iterations: 2000, strengthIterations: 60 } as const;

/** severity 的顺序等级，用于"至少 notable"这类比较；不改 taxonomy.ts，只在本文件内部比较用 */
const SEVERITY_RANK: Record<Severity, number> = { ok: 0, minor: 1, notable: 2, severe: 3 };
function atLeast(actual: Severity, floor: Severity): boolean {
  return SEVERITY_RANK[actual] >= SEVERITY_RANK[floor];
}

/** legalActions 里找不到要求的动作类型就直接抛错，不静默退化成别的动作（任务书点名的坑） */
function requireLegal(state: GameState, type: string) {
  const found = legalActions(state).find(a => a.type === type);
  if (!found) {
    throw new Error(
      `场景脚本错误：座位 ${state.toAct} 在此处没有合法动作 ${type}，` +
        `可选：${legalActions(state).map(a => a.type).join('/')}`,
    );
  }
  return found;
}

/** hero 是第一个行动的人（UTG），开池加注，其余所有座位依次弃牌 */
function driveHeroOpensAndAllFold(seed: string, buttonSeat: number, openAmount: number): GameState {
  let s = startHand({ seed, buttonSeat });
  if (s.toAct !== HERO_SEAT) {
    throw new Error(`场景脚本错误：期望 hero 是第一个行动者（UTG），实际是座位 ${s.toAct}`);
  }
  const raise = requireLegal(s, 'raise');
  if (chipsGreater(raise.min, openAmount) || chipsGreater(openAmount, raise.max)) {
    throw new Error(`场景脚本错误：开池额 ${openAmount} 超出合法区间 [${raise.min}, ${raise.max}]`);
  }
  s = applyAction(s, { type: 'raise', amount: openAmount });
  while (!s.handOver) {
    requireLegal(s, 'fold');
    s = applyAction(s, { type: 'fold' });
  }
  return s;
}

/** 座位表配置好后第一个行动的人（UTG，非 hero）开池，行动轮转到谁就弃牌，包括 hero 自己 */
function driveFacingOpenHeroFolds(seed: string, buttonSeat: number, openAmount: number): GameState {
  let s = startHand({ seed, buttonSeat });
  if (s.toAct === HERO_SEAT) {
    throw new Error('场景脚本错误：本场景要求 hero 不是第一个行动者（要面对开池）');
  }
  const raise = requireLegal(s, 'raise');
  if (chipsGreater(raise.min, openAmount) || chipsGreater(openAmount, raise.max)) {
    throw new Error(`场景脚本错误：开池额 ${openAmount} 超出合法区间 [${raise.min}, ${raise.max}]`);
  }
  s = applyAction(s, { type: 'raise', amount: openAmount });
  while (!s.handOver) {
    requireLegal(s, 'fold');
    s = applyAction(s, { type: 'fold' });
  }
  return s;
}

/**
 * UTG（非 hero）开池，中间座位弃牌，hero（BB）跟注进翻牌圈；
 * hero 翻牌圈先行动过牌，对手满池下注，hero 跟注（这是被测决策点）；
 * 之后转牌、河牌一路过牌到摊牌，让 settleHand 有一个完整、合法的终局可结。
 */
function driveHeroFacesPotBetOnFlop(seed: string, buttonSeat: number, openAmount: number): GameState {
  let s = startHand({ seed, buttonSeat });
  if (s.toAct === HERO_SEAT) {
    throw new Error('场景脚本错误：本场景要求 hero 不是第一个行动者');
  }
  const openerSeat = s.toAct;
  const raise = requireLegal(s, 'raise');
  if (chipsGreater(raise.min, openAmount) || chipsGreater(openAmount, raise.max)) {
    throw new Error(`场景脚本错误：开池额 ${openAmount} 超出合法区间 [${raise.min}, ${raise.max}]`);
  }
  s = applyAction(s, { type: 'raise', amount: openAmount });

  while (s.toAct !== HERO_SEAT) {
    requireLegal(s, 'fold');
    s = applyAction(s, { type: 'fold' });
  }
  requireLegal(s, 'call');
  s = applyAction(s, { type: 'call' });

  if (s.street !== 'flop') throw new Error(`场景脚本错误：跟注后期望进入翻牌圈，实际是 ${s.street}`);
  if (s.toAct !== HERO_SEAT) throw new Error(`场景脚本错误：期望 hero 在翻牌圈先行动，实际是座位 ${s.toAct}`);
  requireLegal(s, 'check');
  s = applyAction(s, { type: 'check' });

  if (s.toAct !== openerSeat) throw new Error(`场景脚本错误：期望对手在 hero 过牌后行动，实际是座位 ${s.toAct}`);
  const bet = requireLegal(s, 'bet');
  const betAmount = round2(currentPot(s)); // 满池下注：toCall 为 0 时本次投入额即整个底池
  if (chipsGreater(bet.min, betAmount) || chipsGreater(betAmount, bet.max)) {
    throw new Error(`场景脚本错误：满池下注额 ${betAmount} 超出合法区间 [${bet.min}, ${bet.max}]`);
  }
  s = applyAction(s, { type: 'bet', amount: betAmount });

  if (s.toAct !== HERO_SEAT) throw new Error(`场景脚本错误：期望 hero 面对下注行动，实际是座位 ${s.toAct}`);
  requireLegal(s, 'call');
  s = applyAction(s, { type: 'call' }); // ← 被测决策点：hero 面对满池下注选择跟注

  // 转牌、河牌一路过牌到摊牌——只是为了让这手牌能正常结算，不是被测决策点
  while (!s.handOver) {
    const legal = legalActions(s);
    if (legal.some(a => a.type === 'check')) s = applyAction(s, { type: 'check' });
    else if (legal.some(a => a.type === 'call')) s = applyAction(s, { type: 'call' });
    else throw new Error(`场景脚本错误：座位 ${s.toAct} 在 ${s.street} 既不能过牌也不能跟注`);
  }
  return s;
}

describe('金标准场景（Step 1：前五条）', () => {
  it('场景 1：UTG 拿 AA 开池 → ok', () => {
    // 种子 g1-377、buttonSeat=3（UTG=座位0=hero）：hero 发到 AdAc。
    const state = driveHeroOpensAndAllFold('g1-377', 3, 3);
    const settled = settleHand(state);
    const record = toHandRecord(settled, {
      id: 'golden-1-utg-aa-open',
      heroSeat: HERO_SEAT,
      personaIds: {},
      timestamp: 0,
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('AA');

    const a = analyzeHand(record, EV_OPTS);
    expect(a.decisions).toHaveLength(1);
    const d = a.decisions[0];
    // AA 在 UTG_rfi 范围表里是纯策略 raise（freq=1），judgePreflopFrequency 短路判定为
    // "达标"，因此 evLoss 恒为 0——这不是蒙特卡洛估出来的数，是频率表短路的结果，
    // 断言精确值而不是区间是合理的（见 analyzeHand.ts 里 skip 的三条短路顺序）。
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });

  it('场景 3：BTN 拿 AA 面对 UTG 开池选择弃牌 → preflop_fold_too_tight，severity 至少 notable', () => {
    // 种子 g3-201、buttonSeat=0（BTN=座位0=hero）：hero 发到 AdAc。
    const state = driveFacingOpenHeroFolds('g3-201', 0, 3);
    const settled = settleHand(state);
    const record = toHandRecord(settled, {
      id: 'golden-3-btn-aa-fold',
      heroSeat: HERO_SEAT,
      personaIds: {},
      timestamp: 0,
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('AA');

    const a = analyzeHand(record, EV_OPTS);
    expect(a.decisions).toHaveLength(1);
    const d = a.decisions[0];
    expect(d.tag).toBe('preflop_fold_too_tight');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测三次 evLoss 落在 4.87～5.35 BB（iterations=2000, strengthIterations=60），
    // 区间留足余量：AA 面对 UTG 单开池弃牌，无论蒙特卡洛怎么抖，损失都是大注级别的。
    expect(d.evLoss).toBeGreaterThan(2);
    expect(d.evLoss).toBeLessThan(9);
  });

  it('场景 4：BB 拿 72o 面对 UTG 开池弃牌 → ok', () => {
    // 种子 g4-96、buttonSeat=4（BB=座位0=hero）：hero 发到 7c2d。
    const state = driveFacingOpenHeroFolds('g4-96', 4, 3);
    const settled = settleHand(state);
    const record = toHandRecord(settled, {
      id: 'golden-4-bb-72o-fold',
      heroSeat: HERO_SEAT,
      personaIds: {},
      timestamp: 0,
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('72o');

    const a = analyzeHand(record, EV_OPTS);
    expect(a.decisions).toHaveLength(1);
    const d = a.decisions[0];
    // 72o 在 BB_vs_UTG_open 节点不在 call/3bet 子范围内，fold 频率为 1，
    // judgePreflopFrequency 短路判定为"达标"，evLoss 恒为 0（同场景 1 的道理）。
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });

  it('场景 5：hero 无对无听牌跟注满池翻牌下注 → 失误，severity 至少 notable', () => {
    // 种子 g5-3、buttonSeat=4（BB=座位0=hero）：hero 发到 AhAh? 不——发到 4h/Ah（A4s 同花），
    // 翻牌 Kc 5h 6d：5 张牌（hero 两张 + 翻牌三张）点数互不相同、同花色最多 3 张
    // （不构成同花听牌）、也凑不出 4 张落入任意 5 连张窗口（不构成顺子听牌）。
    const state = driveHeroFacesPotBetOnFlop('g5-3', 4, 3);
    const settled = settleHand(state);
    const record = toHandRecord(settled, {
      id: 'golden-5-no-pair-no-draw-call',
      heroSeat: HERO_SEAT,
      personaIds: {},
      timestamp: 0,
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('A4s');

    const a = analyzeHand(record, EV_OPTS);
    const flopCallIdx = record.actions.findIndex(act => act.seat === record.heroSeat && act.street === 'flop' && act.type === 'call');
    expect(flopCallIdx).toBeGreaterThanOrEqual(0);
    const d = a.decisions.find(dd => dd.actionIndex === flopCallIdx)!;
    expect(d).toBeDefined();

    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测三次 evLoss 落在 6.40～6.69 BB，区间留足余量。
    expect(d.evLoss).toBeGreaterThan(3);
    expect(d.evLoss).toBeLessThan(12);
    // tag 为 null，不是 should_have_folded / chasing_bad_odds 之类的具体分类——
    // 原因见报告：EV 引擎在这个决策点推荐的是"all-in 加注"而不是"弃牌"
    // （spec §12 记录在案的超额下注局限：往 13 BB 的池子里推荐下 97 BB），
    // 这让 tagFor 落进"该下注/加注却只跟注"的分支，而不是"该弃牌却继续"的分支；
    // 又因为 hero 的胜率（≈14%）远低于 VALUE_BET_EQUITY_FLOOR，该分支主动放弃贴
    // missed_value_bet 标签，最终归为 null。severity/evLoss 本身不受这个影响——
    // 无论参照的推荐动作是"下注"还是"弃牌"，跟注都明显更差。
    expect(d.tag).toBeNull();
  });

  it('场景 2：UTG 拿 72o 开池 → preflop_open_too_wide，severity 至少 minor', () => {
    // 种子 g2-31、buttonSeat=3（UTG=座位0=hero）：hero 发到 7c2s。
    //
    // 这条场景此前用 it.skip 挂起：三次独立运行里 tag 稳定为
    // preflop_over_aggressive，从未出现过任务书预期的 preflop_open_too_wide——
    // 根因是 judge.ts::tagFor 用 situation.toCall > 0 判定"面对加注"，而 UTG
    // 开池时 toCall 恒等于大盲注额（=1，>0），与"面对别人的加注"在物理上无法
    // 区分。现在 tagFor 改用 preflopNodeFor 算出的节点种类（node.kind==='rfi'
    // 表示还没有人加注）来做这个判断，此处不再依赖 toCall 的符号。
    const state = driveHeroOpensAndAllFold('g2-31', 3, 3);
    const settled = settleHand(state);
    const record = toHandRecord(settled, {
      id: 'golden-2-utg-72o-open',
      heroSeat: HERO_SEAT,
      personaIds: {},
      timestamp: 0,
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('72o');

    const a = analyzeHand(record, EV_OPTS);
    expect(a.decisions).toHaveLength(1);
    const d = a.decisions[0];
    expect(d.tag).toBe('preflop_open_too_wide');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测三次 evLoss 落在 1.6181～1.6699 BB（iterations=2000, strengthIterations=60），
    // 区间留足余量：72o 在 UTG_rfi 不在 raise 范围内，EV 引擎推荐 fold，
    // 开池本身投入不大（3 BB 对 1.5 BB 底池），损失量级明显小于 AA 弃牌类场景，
    // 但仍稳定落在 notable 档（severe 门槛是 3）。
    expect(d.evLoss).toBeGreaterThan(1);
    expect(d.evLoss).toBeLessThan(3);
  });
});
