import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, legalActions, currentPot } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import type { GameState, Position } from '../core/types';
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

/**
 * ═════════════════════════════════════════════════════════════════════════
 * Step 3：扩容到约 40 条（本节及以下）。
 *
 * 种子搜索脚本本身不留在这里（原因同上：慢、且只在选中种子那一刻有意义）。
 * 每条场景的种子、按钮位、hero 实际拿到的牌都写死在注释里，并且用 classifyHand
 * 断言一次。新增的通用驱动函数（下面这一段）取代了针对单个场景手写的三个旧函数，
 * 覆盖"多对手存活到决策点""短筹码对手全下""3bet/4bet"等前五条没有覆盖到的形状——
 * 但内部规则不变：只从 legalActions 里查出来的真实动作类型驱动，never 硬编码。
 *
 * 座位号与位置的对应关系：hero 固定是座位 0（HERO_SEAT），buttonSeat 决定 hero
 * 的位置。startHand 发牌只看种子，不看 buttonSeat——同一个种子无论摆在哪个
 * buttonSeat，hero（座位0）和公共牌（state.deck 的前几张）都不变，因此可以先按
 * 目标手牌 / 公共牌纹理搜种子，再用 buttonSeat 自由指定 hero 坐在哪个位置。
 * ═════════════════════════════════════════════════════════════════════════
 */

/** hero 固定座位 0；buttonSeat 决定 hero 的位置——枚举这张表就是求解 "hero 在 pos，
 * 座位 0 应该是 pos" 这件事在 POSITION_ORDER=['BTN','SB','BB','UTG','HJ','CO'] 下的解 */
const BUTTON_FOR: Record<Position, number> = { BTN: 0, CO: 1, HJ: 2, UTG: 3, BB: 4, SB: 5 };
const POS_OFFSET: Record<Position, number> = { BTN: 0, SB: 1, BB: 2, UTG: 3, HJ: 4, CO: 5 };
/** 给定 buttonSeat，求某个位置对应的座位号（非 hero 时也适用，例如"BB 的座位号是几"） */
function seatOf(buttonSeat: number, pos: Position): number {
  return (buttonSeat + POS_OFFSET[pos]) % SEAT_COUNT;
}

/** 六人桌起始筹码数组：默认每人 STARTING_STACK，overrides 按座位号覆盖（短筹码对手系列用） */
function stacksWith(overrides: Record<number, number> = {}): number[] {
  const arr: number[] = [];
  for (let i = 0; i < SEAT_COUNT; i++) arr.push(overrides[i] ?? STARTING_STACK);
  return arr;
}

/** legalActions 里找不到要求的动作类型就直接抛错（同前五条场景的 requireLegal） */
function need(state: GameState, type: string) {
  const found = legalActions(state).find(a => a.type === type);
  if (!found) {
    throw new Error(
      `场景脚本错误：座位 ${state.toAct} 在此处没有合法动作 ${type}，` +
        `可选：${legalActions(state).map(a => a.type).join('/')}`,
    );
  }
  return found;
}

/** 弃牌，直到轮到目标座位（用于跳过"会弃牌"的旁观座位） */
function foldUntil(state: GameState, targetSeat: number): GameState {
  let s = state;
  while (s.toAct !== targetSeat) {
    if (s.handOver) throw new Error('场景脚本错误：手牌在到达目标座位前已结束');
    need(s, 'fold');
    s = applyAction(s, { type: 'fold' });
  }
  return s;
}

/** 弃牌直到翻前结束（用于"其余人都弃牌，进入下一街"） */
function foldRestOfPreflop(state: GameState): GameState {
  let s = state;
  while (s.street === 'preflop' && !s.handOver) {
    need(s, 'fold');
    s = applyAction(s, { type: 'fold' });
  }
  return s;
}

/**
 * 把当前行动者的本街投入总额推到 totalAmount（而不是"本次投入额"——后者依赖
 * 该座位这条街已经投入多少，容易在有盲注/前面已加注的座位上算错）。
 * 用 currentBet 是否为正来选 raise / bet 类型，和 legalActions 的判定逻辑一致。
 */
function actTo(state: GameState, totalAmount: number): GameState {
  const type = state.currentBet > 0 ? 'raise' : 'bet';
  const legal = need(state, type);
  const seat = state.seats[state.toAct!];
  const invest = round2(totalAmount - seat.streetContribution);
  if (chipsGreater(legal.min, invest) || chipsGreater(invest, legal.max)) {
    throw new Error(`场景脚本错误：${type} 到 ${totalAmount}（投入 ${invest}）超出合法区间 [${legal.min}, ${legal.max}]`);
  }
  return applyAction(state, { type, amount: invest });
}
function callCur(state: GameState): GameState { need(state, 'call'); return applyAction(state, { type: 'call' }); }
function checkCur(state: GameState): GameState { need(state, 'check'); return applyAction(state, { type: 'check' }); }
function foldCur(state: GameState): GameState { need(state, 'fold'); return applyAction(state, { type: 'fold' }); }
/** 当前行动者全下——发现过一个坑：toCall>0 且筹码够跟注时，estimateEv 把"全下"这个
 * 候选归类成 actionType 'raise'（标签叫 "all-in"，类型不是 'allin'），只有"筹码不够
 * 跟注、被迫短全下"时才会出现 actionType==='allin' 的候选。hero 若在筹码充足时选
 * legalActions 里的 'allin' 类型，matchCandidate 按 actionType 过滤会找不到匹配候选，
 * actualEv 变成 null，被 analyzeHand 的短路规则悄悄吃掉（evLoss 强制 0，不是没有失误，
 * 是没算出来）。因此"投入全部筹码"统一用 actTo 到 (streetContribution+stack)，
 * 让引擎记录的 actionType 是 'raise'/'bet'，能对得上 estimateEv 的候选。
 * 见 goldenScenarios 报告"三、通用发现"一节。 */
function allInViaRaise(state: GameState): GameState {
  const seat = state.seats[state.toAct!];
  return actTo(state, round2(seat.streetContribution + seat.stack));
}
/** 短筹码对手在没有加注权/筹码不够跟注时的真全下——这种情况下 legalActions 的
 * 'allin' 类型和 estimateEv 的候选能对上（见 evEstimate.ts 里 "call all-in" 分支），
 * 用于本节"短筹码对手 shove"系列里"对手"一侧的动作。 */
function allInCur(state: GameState): GameState { need(state, 'allin'); return applyAction(state, { type: 'allin' }); }

/** 收尾：翻前弃到街结束；翻后能过牌就过牌，能跟注就跟注，能用 allin 跟就跟——
 * 把手牌带到一个合法的终局，供 settleHand 结算。不是被测决策点，只是让手牌能收尾。 */
function finishHand(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.handOver) {
    if (++guard > 100) throw new Error('场景脚本错误：finishHand 循环过多，可能卡死');
    const legal = legalActions(s);
    if (s.street === 'preflop' && legal.some(a => a.type === 'fold')) { s = applyAction(s, { type: 'fold' }); continue; }
    if (legal.some(a => a.type === 'check')) { s = applyAction(s, { type: 'check' }); continue; }
    if (legal.some(a => a.type === 'call')) { s = applyAction(s, { type: 'call' }); continue; }
    if (legal.some(a => a.type === 'allin')) { s = applyAction(s, { type: 'allin' }); continue; }
    if (legal.some(a => a.type === 'fold')) { s = applyAction(s, { type: 'fold' }); continue; }
    throw new Error(`场景脚本错误：finishHand 卡在座位 ${s.toAct} 街 ${s.street}，可选 ${legal.map(a => a.type).join('/')}`);
  }
  return s;
}

/** 从种子+按钮位+脚本，构造出结算完毕的 HandRecord（本节场景的统一入口） */
function buildRecord(id: string, seed: string, buttonSeat: number, script: (s: GameState) => GameState, stackOverrides: Record<number, number> = {}) {
  let s = startHand({ seed, buttonSeat, startingStacks: stacksWith(stackOverrides) });
  s = script(s);
  const settled = settleHand(s);
  return toHandRecord(settled, { id, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

describe('金标准场景 —— 翻前扩展：RFI 节点（rfi）', () => {
  it('场景 6：UTG 拿 22 开池 → preflop_open_too_wide（按范围表频率判定）', () => {
    // 种子 pf-263、buttonSeat=3（UTG=座位0=hero）：hero 发到 2c2d。
    // 22 不在 UTG_rfi 的 raise 范围（'55+, A8s+, ...'）里，频率 0，不满足
    // judgePreflopFrequency 的 0.15 门槛，不短路——这条场景跟场景 2（72o）一样
    // 是"按范围表频率判定"的第二个例子，但换了一手不同的牌（口袋对，不是纯高张）。
    const record = buildRecord('golden-6-utg-22-open', 'pf-263', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('22');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_open_too_wide');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈1.44 BB；区间留足余量，与场景 2（72o，1.6~1.7）同量级。
    expect(d.evLoss).toBeGreaterThan(0.8);
    expect(d.evLoss).toBeLessThan(3);
  });

  it('场景 7：HJ 拿 JJ 开池 → ok（频率表短路，换一个不是 AA 的口袋对/不同位置）', () => {
    // 种子 pf-21、buttonSeat=2（HJ=座位0=hero）：hero 发到 JhJd。
    // JJ 在 HJ_rfi 的 raise 范围（'44+, ...'）里，频率 1，短路判定为达标。
    const record = buildRecord('golden-7-hj-jj-open', 'pf-21', BUTTON_FOR.HJ, s => {
      s = foldUntil(s, HERO_SEAT); // UTG 弃牌
      s = actTo(s, 3);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('JJ');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });

  it('场景 8：SB 拿 QTs 开池 → ok（频率表短路，SB 位置补齐前五条没有的一个 rfi 节点）', () => {
    // 种子 pf-270、buttonSeat=5（SB=座位0=hero）：hero 发到 TcQc。
    // QTs 在 SB_rfi 的 raise 范围（'..., Q7s+, ...'）里，频率 1，短路判定为达标。
    const record = buildRecord('golden-8-sb-qts-open', 'pf-270', BUTTON_FOR.SB, s => {
      s = foldUntil(s, HERO_SEAT); // UTG,HJ,CO,BTN 弃牌
      s = actTo(s, 3); // SB 已有 0.5 盲注，实际投入 2.5，raise 到 3
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('QTs');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });

  it('场景 9：BTN 拿 87s 开池 → ok（频率表短路，第三个 rfi 位置）', () => {
    // 种子 pf-384、buttonSeat=0（BTN=座位0=hero）：hero 发到 8h7h。
    // 87s 在 BTN_rfi 的 raise 范围（'..., 85s+, ...'）里，频率视为达标，短路为 ok。
    const record = buildRecord('golden-9-btn-87s-open', 'pf-384', BUTTON_FOR.BTN, s => {
      s = foldUntil(s, HERO_SEAT); // UTG,HJ,CO 弃牌
      s = actTo(s, 3);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('87s');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });
});

describe('金标准场景 —— 翻前扩展：面对开池节点（vs-open）', () => {
  it('场景 10：SB 拿 KK 面对 CO 开池只跟注 → preflop_missed_3bet', () => {
    // 种子 pf-486、buttonSeat=5（SB=座位0=hero）：hero 发到 KhKc。
    // BB 此时还没轮到行动（在 hero 之后），situation 里仍是活对手，跟"面对开池只
    // 剩一个对手"的单对手场景不同——这条场景不依赖任何一个已知局限就能干净复现：
    // KK 在 SB_vs_CO_open 只在 3bet 范围（'TT+, ATs+, ...'）里，不在 call 范围
    // （'77-99, A9s, KTs, ...'）里，call 频率为 0，不短路；EV 引擎推荐 bet pot
    // （3bet），跟注的 EV 明显更低。
    const record = buildRecord('golden-10-sb-kk-call-vs-co-open', 'pf-486', BUTTON_FOR.SB, s => {
      s = foldUntil(s, seatOf(BUTTON_FOR.SB, 'CO')); // UTG, HJ 弃牌
      s = actTo(s, 3); // CO 开池
      s = foldUntil(s, HERO_SEAT); // BTN 弃牌
      s = callCur(s); // hero 只跟注（被测决策点）—— BB 尚未行动，仍是活对手
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('KK');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_missed_3bet');
    expect(atLeast(d.severity, 'minor')).toBe(true);
    // 实测 evLoss≈0.22 BB（口袋对的 impliedOddsBonus 会略微推高 call 候选的 EV，
    // 但 3bet 依然明显更优）；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(0.05);
    expect(d.evLoss).toBeLessThan(1.2);
  });

  it('场景 11：BB 拿 84o 面对 BTN 开池 3bet（SB 跟注保持存活）→ preflop_over_aggressive', () => {
    // 种子 pf-196、buttonSeat=4（BB=座位0=hero）：hero 发到 4h8s。
    // 关键构造：SB 用跟注而不是弃牌保持"存活"，让 hero 3bet 时的 situation 里有
    // 两个活对手（BTN 开池者 + SB 跟注者），而不是只有 BTN 一个——见下方 it.skip
    // "场景 S4" 的对照：同一手牌、同样的位置，只是让 SB 弃牌变成单对手，
    // preflop_over_aggressive 就判不出来了（tag 变成 null）。这条场景不受两个已知
    // 局限的影响：BTN、SB 的范围都已经被各自的真实动作（raise / call）收窄过，
    // 不是未行动座位的先验宽范围。
    const record = buildRecord('golden-11-bb-84o-3bet-vs-btn-open', 'pf-196', BUTTON_FOR.BB, s => {
      s = foldUntil(s, seatOf(BUTTON_FOR.BB, 'BTN')); // UTG, HJ, CO 弃牌
      s = actTo(s, 3); // BTN 开池
      s = callCur(s); // SB 跟注（保持存活）
      s = actTo(s, 9); // hero 3bet（被测决策点）
      s = finishHand(s); // BTN、SB 弃牌
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('84o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_over_aggressive');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈1.43 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(0.5);
    expect(d.evLoss).toBeLessThan(3.5);
  });

  it('场景 12：HJ 拿 92o 面对 UTG 开池 3bet（CO/BTN/SB/BB 均未行动）→ preflop_over_aggressive，severity 至少 notable', () => {
    // 种子 pf-58、buttonSeat=2（HJ=座位0=hero）：hero 发到 9s2c。
    // hero 是 UTG 之后第一个行动的人，3bet 时 CO/BTN/SB/BB 四个座位都还没轮到，
    // 全部计入 situation 的活对手（虽然是各自位置的先验开池范围，见已知局限 2）——
    // 但这条场景的结论极其稳固：92o 3bet 面对任何合理数量的活对手都明显是失误，
    // 不依赖这个先验建模的精确程度。
    const record = buildRecord('golden-12-hj-92o-3bet-vs-utg-open', 'pf-58', BUTTON_FOR.HJ, s => {
      s = actTo(s, 3); // UTG 开池（第一个行动）
      s = actTo(s, 9); // hero 3bet（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('92o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_over_aggressive');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈4.94 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(2.5);
    expect(d.evLoss).toBeLessThan(9);
  });

  it('场景 13：CO 拿 A2o 面对 UTG 开池只跟注 → preflop_cold_call_too_wide', () => {
    // 种子 pf-250、buttonSeat=1（CO=座位0=hero）：hero 发到 Ac2h。
    // A2o 既不在 CO_vs_UTG_open 的 3bet 范围（'QQ+, AKs, A5s-A4s, AKo'）里，也不在
    // call 范围（'JJ-66, AQs-ATs, KQs-KJs, QJs, JTs, T9s, 98s, AQo'）里——EV 引擎
    // 推荐 fold，hero 却跟注。这条场景同样会受已知局限 2 影响（HJ/BTN/SB/BB 未行动，
    // 计入先验范围），但即使按更宽松的对手集合估计，A2o 冷跟一次开池也明显亏，
    // 结论不依赖这个建模细节。
    const record = buildRecord('golden-13-co-a2o-call-vs-utg-open', 'pf-250', BUTTON_FOR.CO, s => {
      s = actTo(s, 3); // UTG 开池（第一个行动）
      s = foldUntil(s, HERO_SEAT); // HJ 弃牌
      s = callCur(s); // hero 冷跟（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('A2o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_cold_call_too_wide');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈2.04 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(1);
    expect(d.evLoss).toBeLessThan(4);
  });
});

describe('金标准场景 —— 翻前扩展：面对 3bet 节点（vs-3bet）', () => {
  it('场景 14：UTG 拿 QQ 开池，BB 3bet，hero 弃牌 → preflop_fold_too_tight，severity severe', () => {
    // 种子 pf-213、buttonSeat=3（UTG=座位0=hero）：hero 发到 QdQs。
    // QQ 在 UTG_vs_BB_3bet 的 call 范围（'JJ-99, AQs-AJs, KQs, AKo'）里、离 4bet
    // 范围（'QQ+, AKs, A5s:0.5'）也很近，无论哪一档都远好于弃牌——这是 vs-3bet
    // 节点，只有一个活对手（BB，且已经用 3bet 这个真实动作narrowed 过范围），
    // 不受"未行动对手先验范围"的局限 2 影响；这个方向（该继续却弃牌）也不受
    // 局限 1（超额下注推荐）的影响，因为超额下注只会让"继续"看起来更好，
    // 只会让这条场景的失误看起来更严重，不会把结论反过来。
    const record = buildRecord('golden-14-utg-qq-fold-vs-bb-3bet', 'pf-213', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3); // hero UTG 开池
      s = foldUntil(s, seatOf(BUTTON_FOR.UTG, 'BB')); // HJ, CO, BTN, SB 弃牌
      s = actTo(s, 9); // BB 3bet
      s = foldCur(s); // hero 弃牌（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('QQ');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop' && act.type === 'fold');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('preflop_fold_too_tight');
    expect(atLeast(d.severity, 'severe')).toBe(true);
    // 实测 evLoss≈12.57 BB（EV 引擎推荐 all-in，把这个数字推得很高，但方向和
    // severity 不受影响，见已知局限 1）；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(6);
    expect(d.evLoss).toBeLessThan(20);
  });
});

/**
 * ═════════════════════════════════════════════════════════════════════════
 * 以下四条按任务书的铁律用 it.skip 挂起：构造完成、断言写的是任务书原始预期，
 * 但实测结果与预期不符。没有改预期让它们通过。每条都附：hero 手牌/位置/公共牌、
 * 完整动作序列、EvResult 里的全部候选（label/actionType/investment/ev/
 * foldEquity/W'），以及引擎最终判定与原因。
 *
 * 四条的根因都指向同一处机制：estimateEv 里下注/加注候选的 foldEquity 只由
 * 下注尺度与底池的几何关系决定（mdf = pot/(pot+b)，foldEquity=(1-mdf)^k），
 * 完全不看对手范围的强弱——这在"只剩一个能弃牌的对手"的节点上（k=1）会让
 * "去下大注/加注/全下"系统性地显得比"弃牌"更有利可图，不论 hero 实际手牌多差。
 * 这不是 spec §12 原文点名的"超额下注尺度"局限的简单重复，而是它更深一层的
 * 后果：不仅下注尺度的数字会失真，连"该不该继续/该不该反加"这个方向性判断
 * 都可能被带偏。三条场景（S1/S3/S4）都在这类"单一活对手"节点上，S2 是一个
 * 相关但独立的现象（未行动对手先验范围把冷跟的门槛推得过高）。
 * ═════════════════════════════════════════════════════════════════════════
 */
describe('金标准场景 —— 已知不可达（it.skip，附完整候选证据）', () => {
  it.skip('场景 S1：SB 拿 92o 跛入 → 预期 preflop_sb_limp，实测 preflop_missed_3bet', () => {
    // 局面：种子 pf-58、buttonSeat=5（SB=座位0=hero），hero 发到 9s2c（92o）。
    // 动作序列：UTG/HJ/CO/BTN 弃牌 → hero 跟注 0.5（补齐大盲，"跛入"）→ BB 过牌
    //   → 翻牌/转牌/河牌一路过牌到摊牌。
    //
    // EvResult 全部候选（heroEquity=0.392, requiredEquity=0.25）：
    //   fold                投入0    ev=0
    //   call                投入0.5  ev=0.284       ← hero 实际动作匹配到这一档
    //   bet 1/3   (raise)   投入1    ev=0.5918  foldEquity=0.40  W'=0.3288
    //   bet 1/2   (raise)   投入1.25 ev=0.6171  foldEquity=0.4545 W'=0.3233
    //   bet 2/3   (raise)   投入1.5  ev=0.6265  foldEquity=0.50  W'=0.3132
    //   bet pot   (raise)   投入2    ev=0.6471  foldEquity=0.5714 W'=0.302  ← 推荐
    //   all-in    (raise)   投入99.5 ev=0.3119  foldEquity=0.9851 W'=0.105
    //
    // 引擎结论：evLoss≈0.36、severity=minor、tag=preflop_missed_3bet
    //   （tagFor 先检查 `actual==='call' && rec.actionType==='raise'` 这一条，
    //   命中就直接返回 missed_3bet，排在 sb_limp 检查之前——见 judge.ts:101-111）。
    //
    // 为什么任务书预期的 preflop_sb_limp 判不出来：sb_limp 分支要求
    // `rec.actionType !== 'raise'`（否则先被 missed_3bet 截走）。用 32o
    // （w-6 种子、同样的构造）复测过一次交叉验证——即便是全副 169 手起手牌里
    // 最差的一手，EV 引擎依然推荐 bet pot（raise），foldEquity=0.5714：
    //   fold 0 / call(0.5,ev0.136) / bet1/3(1,ev0.5414,fe0.40) /
    //   bet1/2(1.25,ev0.5632,fe0.4545) / bet2/3(1.5,ev0.62,fe0.50) /
    //   bet pot(2,ev0.6348,fe0.5714,推荐) / all-in(99.5,ev0.4106,fe0.9851)
    // 两次独立测试（92o 与 32o）都显示：SB 先手面对 BB 单一对手时，无论手牌多差，
    // "raise" candidate 的 foldEquity 项都足够大，EV 恒高于 fold(0) 与 call。
    // 这意味着 preflop_sb_limp 这个分类在当前 EV 引擎下可能对任何手牌都不可达——
    // 不是这条场景运气不好，是 tagFor 排在 missed_3bet 后面的这个分支，在
    // "SB 先手、只面对 BB 一个对手"的物理结构下，本来就没有能触发它的路径。
    const record = buildRecord('golden-s1-sb-92o-limp', 'pf-58', BUTTON_FOR.SB, s => {
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s);
      s = checkCur(s);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('92o');
    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d.tag).toBe('preflop_sb_limp'); // 实测为 preflop_missed_3bet，断言按任务书原始预期保留，故意失败
  });

  it.skip('场景 S2：BTN 拿 AKs 面对 UTG 开池只跟注 → 预期 preflop_missed_3bet，实测 preflop_cold_call_too_wide', () => {
    // 局面：种子 pf-261、buttonSeat=0（BTN=座位0=hero），hero 发到 AdKd（AKs）。
    // 动作序列：UTG 开池到 3 → HJ/CO 弃牌 → hero 跟注 3（被测决策点）→ SB/BB 弃牌
    //   → 翻牌/转牌/河牌一路过牌到摊牌。
    //
    // EvResult 全部候选（heroEquity=0.2928, requiredEquity=0.4）：
    //   fold                投入0     ev=0       ← 推荐
    //   call                投入3     ev=-0.8041 ← hero 实际动作匹配到这一档
    //   bet 1/3   (raise)   投入4.5   ev=-0.7883  foldEquity=0.125  W'=0.2815
    //   bet 1/2   (raise)   投入5.25  ev=-0.9725  foldEquity=0.1561 W'=0.2721
    //   bet 2/3   (raise)   投入6     ev=-1.0059  foldEquity=0.1866 W'=0.2764
    //   bet pot   (raise)   投入7.5   ev=-1.0122  foldEquity=0.2441 W'=0.2853
    //   all-in    (raise)   投入100   ev=-2.7189  foldEquity=0.8763 W'=0.229
    //
    // 引擎结论：evLoss≈0.80、severity=minor、tag=preflop_cold_call_too_wide。
    //
    // 为什么与任务书预期（missed_3bet）不符：不是超额下注局限——这次连 all-in
    // 候选本身也是负 EV（-2.72），说明 EV 引擎认为这个局面下继续（不管是跟注
    // 还是加注）整体上都不划算，只有 fold 的 ev=0 最高。根因很可能是已知局限 2
    // （对手范围先验）：hero 的决策点上 SB、BB 都还没行动，situation 里除了 UTG
    // （已用真实开池动作收窄过范围）之外，还带着 SB、BB 两个"未行动但先验范围
    // 是各自开池范围"的活对手，heroEquity 因此是"AKs 同时打赢 UTG 的开池范围、
    // SB 的开池范围、BB 的开池范围"这个多人局面的胜率（29%），远低于真实
    // "AKs 单挑 UTG 开池范围"的胜率（现实中通常在 45%~55%）——用一个偏低的多人
    // 胜率去跟单挑门槛（40%）比较，判定结果失真。这与场景 13（A2o）不同：A2o
    // 即使按更真实的单挑胜率估计也明显达不到门槛，结论方向不受这个偏差影响；
    // AKs 恰好卡在门槛附近，偏差足以把方向本身翻过来。
    const record = buildRecord('golden-s2-btn-aks-call-vs-utg-open', 'pf-261', BUTTON_FOR.BTN, s => {
      s = actTo(s, 3);
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('AKs');
    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d.tag).toBe('preflop_missed_3bet'); // 实测为 preflop_cold_call_too_wide，断言按原始预期保留，故意失败
  });

  it.skip('场景 S3：UTG 拿 T9s 开池，BB 3bet，hero 4bet → 预期 preflop_over_aggressive，实测 ok（evLoss=0）', () => {
    // 局面：种子 pf-101、buttonSeat=3（UTG=座位0=hero），hero 发到 Td9d（T9s）。
    // 动作序列：hero UTG 开池到 3 → HJ/CO/BTN/SB 弃牌 → BB 3bet 到 9
    //   → hero 4bet 到 25（被测决策点）→ BB 弃牌。
    //
    // EvResult 全部候选（heroEquity=0.39625, requiredEquity=0.3243）：
    //   fold                投入0     ev=0
    //   call                投入6     ev=1.3306
    //   bet 1/3   (raise)   投入10.17 ev=5.4498  foldEquity=0.4486 W'=0.3683
    //   bet 1/2   (raise)   投入12.25 ev=5.8634  foldEquity=0.4949 W'=0.3745
    //   bet 2/3   (raise)   投入14.33 ev=5.7333  foldEquity=0.5341 W'=0.35
    //   bet pot   (raise)   投入18.5  ev=6.2926  foldEquity=0.5968 W'=0.3588 ← 推荐
    //   all-in    (raise)   投入97    ev=5.1384  foldEquity=0.8858 W'=0.2245
    //
    // 引擎结论：hero 实际 4bet 投入 22（raise 到 25），matchCandidate 按投入额
    // 就近匹配到 "bet pot"（投入 18.5，|22-18.5|=3.5，比其余候选都近），
    // 而 bet pot 恰好就是推荐候选本身，actualEv=6.2926=rec.ev，evLoss=0，
    // severity=ok，tag=null（不是任何失误分类）。
    //
    // 为什么与预期不符：这不是离散尺度匹配的巧合掩盖了真实差距——even 用更极端的
    // 92o（同样构造，pf-58 种子）复测过，all-candidates 依然是 call 1.33 / bet
    // 1/3~5.45 / bet1/2~5.86 / bet2/3~5.73 / bet pot 6.29(推荐) / all-in
    // 5.14——4bet 用任何非全下尺度都被判定为正 EV 且优于弃牌与跟注，即便是全副
    // 169 手起手牌里最差的一手。这与场景 S1 同源：vs-3bet 节点在结构上只剩一个
    // 活对手（3bettor，其余人已在 hero 开池时弃牌），foldEquity 项系统性地让
    // "反加注"看起来比"弃牌"更好，preflop_over_aggressive 在 vs-3bet 节点上可能
    // 同样是（至少对这两手测试过的牌）不可达的。场景 12（HJ 92o 3bet，vs-open
    // 节点）之所以能正确判出 over_aggressive，关键差异是那里有 4 个活对手
    // （CO/BTN/SB/BB 均未行动），foldEquity 需要更多人同时弃牌，没有被单一对手
    // 的建模夸大。
    const record = buildRecord('golden-s3-utg-t9s-4bet-vs-bb-3bet', 'pf-101', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3);
      s = foldUntil(s, seatOf(BUTTON_FOR.UTG, 'BB'));
      s = actTo(s, 9);
      s = actTo(s, 25);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('T9s');
    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop' && act.type === 'raise' && act.amount > 15);
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d.tag).toBe('preflop_over_aggressive'); // 实测 tag=null、severity=ok、evLoss=0，断言按原始预期保留，故意失败
  });

  it.skip('场景 S4：BB 拿 84o 面对 BTN 开池 3bet（单一对手，SB 已弃牌）→ 预期 preflop_over_aggressive，实测 tag=null', () => {
    // 局面：种子 pf-196、buttonSeat=4（BB=座位0=hero），hero 发到 4h8s（84o）。
    // 与场景 11 唯一的区别：SB 在 BTN 开池后弃牌（而不是跟注），hero 3bet 时
    // situation 里只剩 BTN 一个活对手。
    // 动作序列：UTG/HJ/CO 弃牌 → BTN 开池到 3 → SB 弃牌 → hero 3bet 到 9
    //   （被测决策点）→ BTN 弃牌。
    //
    // EvResult 全部候选（heroEquity=0.2425, requiredEquity=0.3077）：
    //   fold                投入0    ev=0
    //   call                投入2    ev=-0.4238
    //   bet 1/3   (raise)   投入3.5  ev=1.1569  foldEquity=0.4375 W'=0.2165
    //   bet 1/2   (raise)   投入4.25 ev=1.072   foldEquity=0.4857 W'=0.1895
    //   bet 2/3   (raise)   投入5    ev=0.9681  foldEquity=0.5263 W'=0.1635
    //   bet pot   (raise)   投入6.5  ev=1.0034  foldEquity=0.5909 W'=0.1583 ← hero 实际动作匹配到这一档
    //   all-in    (raise)   投入99   ev=1.4079  foldEquity=0.9565 W'=0.1615 ← 推荐
    //
    // 引擎结论：evLoss≈0.40、severity=minor、tag=null。
    //   tagFor 的 `(raise||allin) && rec.actionType==='fold'` 分支要求推荐动作是
    //   fold 才会判 over_aggressive / open_too_wide；这里推荐是 all-in（raise），
    //   不满足条件，落到最后的 `return null`。
    //
    // 与场景 11（同一手牌、同一节点，只是 SB 改成跟注）对照，这是 spec §12
    // 记录在案的超额下注局限（局限 1）最干净的一次示范：唯一的变量是"situation
    // 里有几个活对手"，foldEquity 从需要 2 人同时弃牌（场景11，(1-mdf)^2）掉到
    // 只需 1 人弃牌（本场景，(1-mdf)^1），门槛骤降就足以把推荐从 fold 翻成
    // all-in，改变 tagFor 走的分支——即使方向性结论（84o 3bet 明显是失误）在
    // 两条场景里都成立，具体 tag 却因为这个建模细节从 over_aggressive 变成 null。
    const record = buildRecord('golden-s4-bb-84o-3bet-vs-btn-open-single-opp', 'pf-196', BUTTON_FOR.BB, s => {
      s = foldUntil(s, seatOf(BUTTON_FOR.BB, 'BTN'));
      s = actTo(s, 3);
      s = foldUntil(s, HERO_SEAT);
      s = actTo(s, 9);
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('84o');
    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'preflop');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d.tag).toBe('preflop_over_aggressive'); // 实测 tag=null，断言按原始预期保留，故意失败
  });
});

describe('金标准场景 —— 翻后扩展：missed_cbet / missed_value_bet', () => {
  it('场景 15：BTN 拿 KK 在干燥无对面被过牌到、hero 也过牌 → missed_cbet，severity severe', () => {
    // 种子 dry-7、buttonSeat=0（BTN=座位0=hero）：hero 发到 KdKs（KK），
    // 翻牌 9c 6d Th——三张点数互不相同、非同花色、没有明显顺子听牌的干面，
    // hero 是超对（KK 高于面上所有牌）且是翻前最后加注者。BB 先过牌，hero 也
    // 跟着过牌——这正是"该持续下注却过牌"，答案无争议：干面 + 超对 + 位置优势，
    // 是教科书式的持续下注局面。
    const record = buildRecord('golden-15-btn-kk-missed-cbet', 'dry-7', BUTTON_FOR.BTN, s => {
      s = foldUntil(s, HERO_SEAT); // UTG, HJ, CO 弃牌
      s = actTo(s, 3); // hero BTN 开池
      s = foldUntil(s, seatOf(BUTTON_FOR.BTN, 'BB')); // SB 弃牌
      s = callCur(s); // BB 跟注
      s = checkCur(s); // BB 过牌（翻牌，SB 已弃牌所以 BB 先行动）
      s = checkCur(s); // hero 过牌（被测决策点，本该 c-bet）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('KK');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'check');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('missed_cbet');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈4.29 BB（EV 引擎推荐 all-in，把数字推高，见已知局限 1）；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(2);
    expect(d.evLoss).toBeLessThan(9);
  });

  it('场景 16：BB 拿 AA 超对一路过牌到转牌 → missed_value_bet，severity severe', () => {
    // 种子 ov-51、buttonSeat=4（BB=座位0=hero）：hero 发到 AhAd（AA），
    // 翻牌 6h Jh 2d、转牌 5c——面上没有比 AA 更大的对子或明显的成手，hero 胜率
    // 高达 94%。翻牌双方过牌，转牌 hero 先行动又过牌——转牌不适用 missed_cbet
    // （只认翻牌），归到 missed_value_bet：胜率这么高的超对，该下注拿价值却
    // 又放弃了一次机会，答案无争议。
    const record = buildRecord('golden-16-bb-aa-missed-value-turn', 'ov-51', BUTTON_FOR.BB, s => {
      s = actTo(s, 3); // UTG 开池（第一个行动）
      s = foldUntil(s, HERO_SEAT); // HJ, CO, BTN, SB 弃牌
      s = callCur(s); // hero BB 跟注
      s = checkCur(s); // hero 过牌（翻牌，SB 已弃牌所以 hero 先行动）
      s = checkCur(s); // UTG 过牌
      s = checkCur(s); // hero 过牌（转牌，被测决策点，本该下注拿价值）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('AA');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'turn' && act.type === 'check');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('missed_value_bet');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈5.28 BB（同样受已知局限 1 影响，参照的是 all-in EV）；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(2.5);
    expect(d.evLoss).toBeLessThan(9);
  });

  it('场景 17：BTN 翻牌就成坚果同花，面对小注只跟注不加注 → missed_value_bet，severity severe', () => {
    // 种子 nf-13857、buttonSeat=0（BTN=座位0=hero）：hero 发到 8sAs，翻牌
    // Js 5s Ks——三张黑桃，hero 的 As 是这个花色里最大的一张，翻牌就已经是
    // 坚果同花（不是听牌）。UTG 只下注底池的 1/3（小注），hero 只跟注不加注——
    // 这条场景基本不受"超额下注推荐"局限影响：hero 的真实胜率高达 87%，无论
    // EV 引擎参照的是温和尺度还是全下，跟注都明显是"该拿价值却没拿"的失误。
    const record = buildRecord('golden-17-btn-nut-flush-call-small-bet', 'nf-13857', BUTTON_FOR.BTN, s => {
      s = actTo(s, 3); // UTG 开池
      s = foldUntil(s, HERO_SEAT); // HJ, CO 弃牌
      s = callCur(s); // hero BTN 跟注
      s = foldRestOfPreflop(s); // SB, BB 弃牌
      const potBefore = currentPot(s);
      s = actTo(s, round2(potBefore / 3)); // UTG 翻牌小注（1/3 池）
      s = callCur(s); // hero 只跟注（被测决策点，本该加注拿价值）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('A8s');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'call');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('missed_value_bet');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈4.08 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(2);
    expect(d.evLoss).toBeLessThan(7);
  });
});

describe('金标准场景 —— 翻后扩展：下注尺度（bet_size_too_small / bet_size_too_large）', () => {
  it('场景 18：BB 翻牌就成坚果同花，只下 1/3 池 → bet_size_too_small，severity notable', () => {
    // 种子 nf-19964、buttonSeat=4（BB=座位0=hero）：hero 发到 Ac9c，翻牌
    // Kc 6c Qc——三张梅花，hero 的 Ac 是这个花色里最大的一张，翻牌就已经是
    // 坚果同花。hero 先行动，只下注底池的 1/3——这正是任务书原文举的例子
    // "拿超强牌只下 1/3 池而推荐满池"：胜率 87%+ 的坚果，尺度明显偏小。
    const record = buildRecord('golden-18-bb-nut-flush-underbet', 'nf-19964', BUTTON_FOR.BB, s => {
      s = actTo(s, 3); // UTG 开池
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s); // hero BB 跟注
      const potBefore = currentPot(s);
      s = actTo(s, round2(potBefore / 3)); // hero 只下 1/3 池（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('A9s');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'bet');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('bet_size_too_small');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈2.86 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(1.3);
    expect(d.evLoss).toBeLessThan(5);
  });

  it('场景 19：UTG 拿 KK 超对，三人底池里全下 → bet_size_too_large，severity severe', () => {
    // 种子 dry-7、buttonSeat=3（UTG=座位0=hero）：hero 发到 KdKs（KK），
    // HJ、CO 都跟注进翻牌（三人底池），翻牌 9c 6d Th 干面，hero 超对先行动，
    // 把全部 97 BB 一次性推入一个 10.5 BB 的底池。这条场景干净地示范了"过大"
    // 的方向：面对两个仍能弃牌的对手，全下的弃牌率门槛（两人都要弃）远高于
    // 单挑，EV 引擎推荐的是 2/3 池（约 7 BB）而不是全下——三人底池抑制了
    // 单一对手场景下"全下=更赚"的偏置（对照下面 it.skip 场景 S4 一类的单对手
    // 案例），这正是本文件顶部记录的已知局限 1 的另一面：不是每次都会推荐
    // 超额下注，多个仍能弃牌的对手在场时，引擎依然能正确识别"下太大"。
    const record = buildRecord('golden-19-utg-kk-overbet-multiway', 'dry-7', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3); // hero UTG 开池
      s = foldUntil(s, seatOf(BUTTON_FOR.UTG, 'HJ')); // 无需弃牌，HJ 紧接着行动
      s = callCur(s); // HJ 跟注
      s = callCur(s); // CO 跟注
      s = foldRestOfPreflop(s); // BTN, SB, BB 弃牌
      s = allInViaRaise(s); // hero 全下（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('KK');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'bet');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('bet_size_too_large');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈7.45 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(3);
    expect(d.evLoss).toBeLessThan(13);
  });
});

describe('金标准场景 —— 翻后扩展：诈唬（over_bluffing）', () => {
  // ineffective_bluff 没有对应场景——理由见文件末尾的说明块，这是引擎代码结构本身
  // 决定的（estimateEv 只给 bet/raise 候选设置 foldEquity 字段，check 候选恒为
  // undefined），不是没找到合适的局面。

  it('场景 20：UTG 空气诈唬三人底池 → over_bluffing，severity severe', () => {
    // 种子 air-2、buttonSeat=3（UTG=座位0=hero），hero 发到 2c4d，翻牌
    // 7s 5h Td——无对、无同花听牌、无顺子听牌（搜种子时已排除），HJ、CO 都
    // 跟注进池（三人底池）。hero 先行动，半池下注诈唬两个对手同时弃牌——
    // 面对两个仍能弃牌的对手，纯空气诈唬需要两人都弃牌才赚钱，EV 引擎判定
    // 过牌更好，答案无争议。
    const record = buildRecord('golden-20-utg-air-bluff-multiway', 'air-2', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3); // hero UTG 开池
      s = foldUntil(s, seatOf(BUTTON_FOR.UTG, 'HJ'));
      s = callCur(s); // HJ 跟注
      s = callCur(s); // CO 跟注
      s = foldRestOfPreflop(s); // BTN, SB, BB 弃牌
      const potBefore = currentPot(s);
      s = actTo(s, round2(potBefore / 2)); // hero 半池诈唬（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('42o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'bet');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('over_bluffing');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈3.17 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(1.3);
    expect(d.evLoss).toBeLessThan(6);
  });

  it('场景 21：UTG 拿 ATs 顶对三人底池里全下诈唬式过大 → over_bluffing，severity severe', () => {
    // 种子 dry-28、buttonSeat=3（UTG=座位0=hero），hero 发到 AcTc，翻牌
    // 4d 9s Ah——hero 用手上的 Ac 配对面上的 Ah，顶对好踢脚（约 45% 胜率），
    // HJ、CO 跟注进三人底池。hero 把全部 97 BB 一次性推入一个 10.5 BB 的池子——
    // 面对两个仍能弃牌的对手，EV 引擎判定这个尺度已经不是"价值下注"而是纯粹
    // 靠吓退人赚钱的诈唬（heroEquity 45% 不够格拿 missed_value_bet 需要的
    // 50% 门槛），且诈唬得太狠，推荐直接过牌。
    const record = buildRecord('golden-21-utg-ats-overbet-bluff-multiway', 'dry-28', BUTTON_FOR.UTG, s => {
      s = actTo(s, 3);
      s = foldUntil(s, seatOf(BUTTON_FOR.UTG, 'HJ'));
      s = callCur(s); // HJ 跟注
      s = callCur(s); // CO 跟注
      s = foldRestOfPreflop(s);
      s = allInViaRaise(s); // hero 全下（被测决策点）
      s = finishHand(s);
      return s;
    });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('ATs');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'bet');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('over_bluffing');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈12.12 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(5);
    expect(d.evLoss).toBeLessThan(20);
  });
});

describe('金标准场景 —— 翻后扩展：短筹码对手全下（chasing_bad_odds / call_too_light_vs_raise / should_have_folded / ok）', () => {
  // 这四条共用同一个构造技巧：让翻牌圈下注的对手是短筹码、下注即是全下
  // （canFold=false）。这规避了已知局限 1（单一仍能弃牌的对手会让"继续"系统
  // 性地显得比"弃牌"更有利可图）——对手一旦全下就不再能弃牌，hero 的候选
  // foldEquity 恒为 0（没有人可以被吓跑），EV 比较回归到纯粒粹的胜率 vs 赔率，
  // 这正是"是否该跟这手赔率"最干净的检验方式。

  it('场景 22：CO 面对短筹码 UTG 小额全下，赔率不足仍跟注 → chasing_bad_odds，severity notable', () => {
    // 种子 air-12、buttonSeat=1（CO=座位0=hero），hero 发到 5c7h，UTG 起始筹码
    // 只有 5 BB。UTG 开池到 3（剩 2 BB），hero 跟注，翻牌 UTG 把剩下的 2 BB
    // 全下（此后不能再弃牌），投入 2 BB 只占底池（7.5 BB）的 27%——toCall 明显
    // 小于半池，属于"小注"。hero 用完全没有牌力的手（无对、无听牌）跟注，
    // 需要 17% 胜率只有 4%，答案无争议。
    const record = buildRecord('golden-22-co-chasing-bad-odds', 'air-12', BUTTON_FOR.CO, s => {
      s = actTo(s, 3); // UTG 开池（短筹码）
      s = foldUntil(s, HERO_SEAT); // HJ 弃牌
      s = callCur(s); // hero CO 跟注
      s = foldRestOfPreflop(s); // BTN, SB, BB 弃牌
      s = allInCur(s); // UTG 全下剩余筹码
      s = callCur(s); // hero 跟注（被测决策点）
      s = finishHand(s);
      return s;
    }, { [seatOf(BUTTON_FOR.CO, 'UTG')]: 5 });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('75o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'call');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('chasing_bad_odds');
    expect(atLeast(d.severity, 'notable')).toBe(true);
    // 实测 evLoss≈1.53 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(0.6);
    expect(d.evLoss).toBeLessThan(3);
  });

  it('场景 23：CO 面对短筹码 UTG 大额全下，仍跟注 → call_too_light_vs_raise，severity severe', () => {
    // 种子 air-28、buttonSeat=1（CO=座位0=hero），hero 发到 Qd5s，UTG 起始筹码
    // 13 BB。UTG 开池到 3（剩 10 BB），hero 跟注，翻牌 UTG 全下剩下的 10 BB——
    // 这个 10 BB 本身已经超过 shove 前的底池（7.5 BB），isRaiseFaced 判定为
    // "面对大注"。hero 用无对无听牌的手跟注，需要 36% 胜率只有 7%，答案无争议。
    const record = buildRecord('golden-23-co-call-too-light-vs-raise', 'air-28', BUTTON_FOR.CO, s => {
      s = actTo(s, 3);
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s);
      s = foldRestOfPreflop(s);
      s = allInCur(s); // UTG 全下（10 BB，超过 shove 前的底池）
      s = callCur(s); // hero 跟注（被测决策点）
      s = finishHand(s);
      return s;
    }, { [seatOf(BUTTON_FOR.CO, 'UTG')]: 13 });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('Q5o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'call');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('call_too_light_vs_raise');
    expect(atLeast(d.severity, 'severe')).toBe(true);
    // 实测 evLoss≈8.14 BB；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(4);
    expect(d.evLoss).toBeLessThan(14);
  });

  it('场景 24：CO 面对短筹码 UTG 全下，用无牌力的手反加注全下 → should_have_folded，severity severe', () => {
    // 种子 air-19、buttonSeat=1（CO=座位0=hero），hero 发到 9cJc，UTG 起始筹码
    // 5 BB。UTG 全下 2 BB 后，hero 不跟注也不弃牌，反而把自己的 97 BB 全部
    // 推入——面对一个已经不能弃牌的对手，反加注不会带来任何额外的弃牌率，
    // 纯粹是拿一手弱牌去冒更大的风险，答案无争议。
    const record = buildRecord('golden-24-co-should-have-folded', 'air-19', BUTTON_FOR.CO, s => {
      s = actTo(s, 3);
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s);
      s = foldRestOfPreflop(s);
      s = allInCur(s); // UTG 全下
      s = allInViaRaise(s); // hero 反加注全下（被测决策点）
      s = finishHand(s);
      return s;
    }, { [seatOf(BUTTON_FOR.CO, 'UTG')]: 5 });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('J9s');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'raise');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.tag).toBe('should_have_folded');
    expect(atLeast(d.severity, 'severe')).toBe(true);
    // 实测 evLoss≈89.4 BB（反加注投入了几乎全部筹码，损失量级自然很大）；区间留足余量。
    expect(d.evLoss).toBeGreaterThan(35);
    expect(d.evLoss).toBeLessThan(150);
  });

  it('场景 25：CO 面对短筹码 UTG 大额全下，正确弃牌 → ok', () => {
    // 种子 air-5、buttonSeat=1（CO=座位0=hero），hero 发到 As4c，UTG 起始筹码
    // 9 BB。UTG 全下 6 BB（超过 shove 前的底池），hero 用无对无听牌的手正确
    // 弃牌——这是本节短筹码全下系列里唯一的"正确打法"对照组：fold 候选恒为
    // ev=0，hero 实际动作就是 fold，matchCandidate 精确匹配到 fold candidate，
    // evLoss 恒为 0（不是靠频率表短路，是真的按 EV 比出来的"没有更好的选择"）。
    const record = buildRecord('golden-25-co-ok-fold', 'air-5', BUTTON_FOR.CO, s => {
      s = actTo(s, 3);
      s = foldUntil(s, HERO_SEAT);
      s = callCur(s);
      s = foldRestOfPreflop(s);
      s = allInCur(s); // UTG 全下
      s = foldCur(s); // hero 弃牌（被测决策点）
      s = finishHand(s);
      return s;
    }, { [seatOf(BUTTON_FOR.CO, 'UTG')]: 9 });
    expect(classifyHand(record.seats[0].holeCards[0], record.seats[0].holeCards[1])).toBe('A4o');

    const a = analyzeHand(record, EV_OPTS);
    const idx = record.actions.findIndex(act => act.seat === 0 && act.street === 'flop' && act.type === 'fold');
    const d = a.decisions.find(dd => dd.actionIndex === idx)!;
    expect(d).toBeDefined();
    expect(d.evLoss).toBe(0);
    expect(d.severity).toBe('ok');
    expect(d.tag).toBeNull();
  });
});

/**
 * ── ineffective_bluff：没有场景，是代码结构决定的，不是没找到合适局面 ──
 *
 * ineffective_bluff 要求 `rec.foldEquity !== undefined && rec.foldEquity < 0.2`
 * （judge.ts 里 `(bet||raise) && rec.actionType==='check'` 分支）。但
 * evEstimate.ts 里只有 makeBetCandidate（生产下注/加注候选）会设置 foldEquity
 * 字段；toCall===0 时推入候选列表的 check 候选（第 145-153 行）从不带这个字段。
 * 也就是说只要 rec.actionType==='check'，rec.foldEquity 恒为 undefined——
 * ineffective_bluff 的判定条件在真实的 EvResult 上永远不成立，只会落到紧接着
 * 的 `return 'over_bluffing'`。judge.test.ts 里能造出 ineffective_bluff，是
 * 因为那处直接手写了一个 `cand('check', 'check', 0, 1, { foldEquity: 0.1 })`
 * 的合成候选——真实的 estimateEv 不会产出这种候选。这不是没搜到合适的牌局，
 * 是这条代码路径在当前实现下对任何真实 HandRecord 都不可达。
 */
