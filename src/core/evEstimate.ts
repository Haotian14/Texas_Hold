import type { ActionType } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { Card } from './cards';
import type { RangeSet } from './rangeSet';
import { rangeCombos, fullRange } from './rangeSet';
import { equityVsRanges } from './equity';
import type { RankedCombo } from './rangeStrength';
import { rankRange, topFraction } from './rangeStrength';
import { classifyHand } from './handClass';

export interface EvCandidate {
  /** 面向人的标签：'fold' / 'call' / 'bet 1/2' / 'all-in' */
  label: string;
  actionType: ActionType;
  /** 本次需要投入的筹码 */
  investment: number;
  /** 以「此刻起」为基准的期望值，单位 BB */
  ev: number;
  isRecommended: boolean;
  /** 仅下注/加注候选有：所有对手都弃牌的概率 */
  foldEquity?: number;
  /** 仅下注/加注候选有：对手跟注后 hero 的胜率（W'） */
  equityWhenCalled?: number;
  /** 仅跟注候选可能有：计入 ev 的隐含赔率修正额 */
  impliedOdds?: number;
}

export interface EvResult {
  candidates: EvCandidate[];
  /** hero 对当前对手范围的胜率 */
  heroEquity: number;
  /** 跟注所需的最低胜率；无需跟注时为 null */
  requiredEquity: number | null;
  recommended: EvCandidate;
  iterations: number;
}

export interface EvOptions {
  /** 主胜率估算的蒙特卡洛迭代数 */
  iterations?: number;
  /** 范围牌力排序的迭代数（每个组合一次小规模模拟） */
  strengthIterations?: number;
  rng?: Rng;
  /** 是否加入隐含赔率修正，默认开启 */
  impliedOdds?: boolean;
}

/** 候选下注尺度，占底池的比例。spec §8.3 固定这五档，不做连续搜索。 */
const BET_SIZES: Array<{ label: string; fraction: number }> = [
  { label: 'bet 1/3', fraction: 1 / 3 },
  { label: 'bet 1/2', fraction: 1 / 2 },
  { label: 'bet 2/3', fraction: 2 / 3 },
  { label: 'bet pot', fraction: 1 },
];

/**
 * 估算局面下各候选动作的期望值。
 *
 * 以「此刻起」为基准：已经投进池子的筹码是沉没成本，不参与计算。
 * 这是单步近似，不展开未来街的博弈树 —— 它能可靠指出明显错误，
 * 但不应被当作 solver 的精确输出（见设计文档 §12）。
 */
export function estimateEv(sit: Situation, opts: EvOptions = {}): EvResult {
  if (sit.opponents.length === 0) {
    throw new Error('Situation 中没有对手，无法估算 EV');
  }

  const iterations = opts.iterations ?? 2000;
  const strengthIterations = opts.strengthIterations ?? 120;
  const rng = opts.rng ?? createRng('ev-default');
  const useImplied = opts.impliedOdds ?? true;

  const dead = [...sit.heroCards, ...sit.board];

  // hero 必须打败牌桌上还留在池子里的每一个人，无论对方还能不能弃牌 ——
  // 已全下的对手的筹码已经在 sit.pot 里了，胜率计算不能把他们排除在外。
  // 每个对手的范围都要先过一遍物理下限：narrowByAction 在翻前全下这类场景
  // 会把范围收到不到 1%，而牌力表让排序变成确定性的，于是多个对手常常
  // 收窄到完全相同的类别（比如都只剩 AA）。若直接把这种收窄后的原始范围
  // 丢给采样，会出现「几个对手必须互不冲突地同时持有同一小撮组合」这种
  // 物理上无解的局面，equityVsRanges 耗尽重试后会抛错。opponentCount 必须
  // 数上全部对手（含已全下的）——他们的牌照样要从牌堆里发出来。
  const opponentCount = sit.opponents.length;
  const heroOppRanges: RangeSet[] = sit.opponents.map(o =>
    heroEquityRange(o.range, sit.board, dead, opponentCount, strengthIterations, rng),
  );

  // W：对当前对手范围的胜率
  const heroEquity = equityVsRanges(sit.heroCards, sit.board, heroOppRanges, iterations, rng);

  // 「继续范围」只对还能做决策的对手才有意义 —— 已全下的对手不会弃牌，
  // 谈不上什么范围要被下注挤掉。只对 canFold 的对手排序，且仍然只做一次。
  const foldableOpponents = sit.opponents.filter(o => o.canFold);
  const rankedFoldable = foldableOpponents.map(o =>
    rankRange(o.range, sit.board, dead, strengthIterations, rng),
  );

  const candidates: EvCandidate[] = [];

  // ── 弃牌 / 过牌
  if (chipsGreater(sit.toCall, 0)) {
    candidates.push({ label: 'fold', actionType: 'fold', investment: 0, ev: 0, isRecommended: false });
  } else {
    // 过牌：不投入、不弃权，期望等于「看到摊牌」的份额近似
    candidates.push({
      label: 'check',
      actionType: 'check',
      investment: 0,
      ev: round4(heroEquity * sit.pot),
      isRecommended: false,
    });
  }

  // ── 跟注
  if (chipsGreater(sit.toCall, 0) && chipsGreater(sit.heroStack, sit.toCall)) {
    const bonus = useImplied ? impliedOddsBonus(sit, heroEquity) : 0;
    const ev = heroEquity * (sit.pot + sit.toCall) - sit.toCall + bonus;
    candidates.push({
      label: 'call',
      actionType: 'call',
      investment: sit.toCall,
      ev: round4(ev),
      isRecommended: false,
      impliedOdds: bonus > 0 ? round4(bonus) : undefined,
    });
  }

  // ── 下注 / 加注
  if (chipsGreater(sit.toCall, 0) && !chipsGreater(sit.heroStack, sit.toCall)) {
    // 筹码不足以跟平时，全下只是「不足额跟注」：对手多出的部分会退还，
    // 他不会面临任何决策，因此没有弃牌率可言，底池也只涨到双方各投 heroStack 为止。
    const invest = sit.heroStack;
    const contested = round2(sit.pot - sit.toCall + 2 * invest);
    candidates.push({
      label: 'call all-in',
      actionType: 'allin',
      investment: invest,
      ev: round4(heroEquity * contested - invest),
      isRecommended: false,
    });
  } else {
    const maxInvest = sit.heroStack;
    for (const size of BET_SIZES) {
      const b = round2(sit.pot * size.fraction + sit.toCall);
      if (!chipsGreater(maxInvest, b)) continue;   // 筹码不足以打出这个尺度
      candidates.push(
        makeBetCandidate(sit, size.label, b, rankedFoldable, iterations, rng, dead, strengthIterations),
      );
    }

    // all-in 永远是一个候选
    candidates.push(
      makeBetCandidate(sit, 'all-in', maxInvest, rankedFoldable, iterations, rng, dead, strengthIterations),
    );
  }

  // ── 选出推荐动作
  let best = candidates[0];
  for (const c of candidates) if (c.ev > best.ev) best = c;
  best.isRecommended = true;

  return {
    candidates,
    heroEquity,
    requiredEquity: chipsGreater(sit.toCall, 0) ? sit.toCall / (sit.pot + sit.toCall) : null,
    recommended: best,
    iterations,
  };
}

/**
 * 继续范围的物理下限。
 *
 * MDF 在翻前全下这类场景会低到 1.5%，切出来只剩一个类别（通常是 AA，六个组合）。
 * 可牌桌上只有四张 A —— 几个对手不可能同时握着同一小撮组合，采样永远凑不出
 * 互不冲突的配置。按对手数把范围放宽到物理可行为止。
 *
 * 只影响 W'（对手跟注后 hero 的胜率）所对的范围。弃牌率 Fe 仍然按 MDF 算 ——
 * 那是教科书量，有测试钉着满池 1/2、半池 1/3、三分之一池 1/4，不能动。
 * 两者因此略有不一致，这是刻意的：Fe 回答「多少人会弃牌」，
 * 继续范围回答「跟下来的人可能拿着什么」，后者受牌堆里实际有多少张牌约束。
 */
const MIN_COMBOS_PER_OPPONENT = 8;

function continueRangeWithFloor(
  ranked: readonly RankedCombo[],
  mdf: number,
  opponentCount: number,
  dead: readonly Card[],
): RangeSet {
  const needed = MIN_COMBOS_PER_OPPONENT * Math.max(1, opponentCount);
  let fraction = Math.min(1, mdf);
  for (let i = 0; i < 12; i++) {
    const r = topFraction(ranked, fraction);
    if (rangeCombos(r, dead).length >= needed || fraction >= 1) return r;
    fraction = Math.min(1, fraction * 1.6);
  }
  return topFraction(ranked, 1);
}

/**
 * 兜底：当传入的范围本身（即便不收窄）也凑不出 needed 张组合时，说明它
 * 物理上撑不住 opponentCount 个对手互不冲突地同时持有——退回全范围重新
 * 按牌力排序，再走一次 continueRangeWithFloor 的放宽逻辑。
 *
 * continueRangeWithFloor 只能从调用方给的 ranked 里挑，挑不出 ranked 本来
 * 就没有的类别；如果 ranked 是从一个已经被上游（比如 narrowByAction）
 * 收窄到只剩一个类别的 range 展开来的，不管传给 continueRangeWithFloor
 * 的起始 fraction 是多少，它能给出的最宽结果也只是那个类别本身。用
 * fullRange() 重新排序是唯一能真正撑宽的办法——把它也套进
 * continueRangeWithFloor 的放宽循环里，让「按牌力取前 N 张」这条既有逻辑
 * 在更宽的池子上重新走一遍，而不是直接甩出未经排序的整副牌。
 */
function widenIfPhysicallyInfeasible(
  candidate: RangeSet,
  board: Card[],
  dead: readonly Card[],
  opponentCount: number,
  strengthIterations: number,
  rng: Rng,
): RangeSet {
  const needed = MIN_COMBOS_PER_OPPONENT * Math.max(1, opponentCount);
  if (rangeCombos(candidate, dead).length >= needed) return candidate;

  const wideRanked = rankRange(fullRange(), board, dead, strengthIterations, rng);
  const startFraction = needed / Math.max(1, wideRanked.length);
  return continueRangeWithFloor(wideRanked, startFraction, opponentCount, dead);
}

/**
 * heroEquity 用的对手范围：先套物理下限，再兜底处理「range 本身（不收窄）
 * 都凑不出足够组合」这种更极端的塌缩。
 *
 * 复盘建议的写法是 continueRangeWithFloor(ranked, 1, opponentCount, dead)。
 * 核对了这个函数的实现（见上方 continueRangeWithFloor）：mdf 传 1 时，
 * `fraction = Math.min(1, 1) = 1`，循环第一轮 `fraction >= 1` 就成立，
 * 直接返回 topFraction(ranked, 1)，根本不看 needed 是否达标。而
 * topFraction(ranked, 1) 精确等于（剔除死牌后的）range 自身——ranked 就是
 * range 展开成组合后排的序，天然不含 range 之外的类别。也就是说它确实是
 * 「对已经够宽的 range 是 no-op」，但代价是对凑不够的 range 也是同一个
 * no-op：不管起始 fraction 传多少，continueRangeWithFloor 用 ranked 能给出
 * 的最宽结果，上限就是 range 自身，「用 range 自身的 fraction 代替 1」
 * 不会改变这个上限，只是少走几步循环、结果不变。
 *
 * 所以这里按字面用 continueRangeWithFloor(ranked, 1, …)：对已经够宽的
 * range 它确实什么也不做，行为与直接用 range 一致，这部分符合建议。
 * 真正让「物理上不可能」变得可行的是下一步——widenIfPhysicallyInfeasible
 * 的全范围兜底，这是建议之外新增的部分。
 */
function heroEquityRange(
  range: RangeSet,
  board: Card[],
  dead: readonly Card[],
  opponentCount: number,
  strengthIterations: number,
  rng: Rng,
): RangeSet {
  const ranked = rankRange(range, board, dead, strengthIterations, rng);
  const floored = continueRangeWithFloor(ranked, 1, opponentCount, dead);
  return widenIfPhysicallyInfeasible(floored, board, dead, opponentCount, strengthIterations, rng);
}

/**
 * EV(投入 b) = Fe × 底池 + (1 − Fe) × [ W' × calledPot − b ]
 *
 * Fe        所有「还能弃牌」的对手都弃牌的概率；已全下的对手不会弃牌，
 *           不参与这个指数。若没有一个对手能弃牌，Fe 恒为 0。
 * W'        对手跟注后的胜率 —— 对能弃牌的对手必须用「继续范围」单独算
 *           （沿用 W 会系统性高估诈唬价值），已全下的对手无论如何都在池子里，
 *           要用他们的完整范围。
 * calledPot 对手跟注后的最终底池 = sit.pot + b + villainCall；
 *           未加注下注（toCall === 0）时精确退化为 pot + 2b
 */
function makeBetCandidate(
  sit: Situation,
  label: string,
  investment: number,
  rankedFoldable: ReturnType<typeof rankRange>[],
  iterations: number,
  rng: Rng,
  dead: readonly Card[],
  strengthIterations: number,
): EvCandidate {
  const b = investment;

  // 每个能弃牌的对手面对该尺度时理论上必须防守的比例（MDF）。
  // 推导：诈唬（W'=0）时 hero 的 EV = (1-mdf)*sit.pot - mdf*b（calledPot 项的
  // 系数是 W'，W'=0 时直接消掉），令其为 0 得 mdf = sit.pot/(sit.pot+b)。
  // b 已经把 sit.toCall 算在内了（见下方调用处 b = pot*fraction + toCall），
  // 所以这条公式对下注和加注都成立，不需要因为 toCall > 0 而改写。
  const mdf = Math.min(1, sit.pot / (sit.pot + b));
  const continueRanges: RangeSet[] = rankedFoldable.map(r =>
    continueRangeWithFloor(r, mdf, rankedFoldable.length, dead),
  );

  // 兜底：continueRangeWithFloor 只能从 rankedFoldable 里挑，挑不出对手
  // 原始范围之外的类别。如果上游（比如 narrowByAction）已经把多个对手的
  // 范围收窄到同一个类别，上面这行不管 mdf 给多宽都凑不出足够组合，
  // W' 的采样会跟 heroEquity 撞上同一种物理不可行。这里不改 mdf、不改
  // 上面那行 continueRangeWithFloor 的调用参数——教科书 MDF 的行为不动——
  // 只在结果确实不够用时才用全范围重新排序补一刀。opponentCount 用全体
  // 对手数（含已全下的）：他们的牌也要从牌堆里发出来，即使全下对手本身
  // 不参与这次「继续范围」的收窄。
  const allOpponentCount = sit.opponents.length;
  const feasibleContinueRanges: RangeSet[] = continueRanges.map(r =>
    widenIfPhysicallyInfeasible(r, sit.board, dead, allOpponentCount, strengthIterations, rng),
  );

  // 所有能弃牌的对手都弃牌的概率：每人独立以 (1 - mdf) 的概率弃牌。
  // k = 0（没有一个对手能弃牌，比如单挑面对全下）时没有人会弃牌，
  // Math.pow(1-mdf, 0) 恒等于 1，必须显式短路成 0，否则会凭空产生弃牌率。
  const k = feasibleContinueRanges.length;
  const foldEquity = k === 0 ? 0 : Math.pow(1 - mdf, k);

  // W'：对手跟注后的胜率。对能弃牌的对手必须用「继续范围」单独算 ——
  // 沿用 W 会系统性高估诈唬价值，因为对手跟注时留下的是更强的那部分范围。
  // 若任一继续范围被死牌清空，回落到能弃牌对手的原始范围（此时该近似会偏保守）。
  // 已全下的对手不受下注影响 —— 他们已经全部投入，无论 hero 打多大都稳坐池中，
  // 因此始终用其完整范围参与 W' 的计算。
  const allInOpponents = sit.opponents.filter(o => !o.canFold);
  const allUsable = feasibleContinueRanges.every(r => r.size > 0);
  const foldableRangesForCalled = allUsable
    ? feasibleContinueRanges
    : sit.opponents.filter(o => o.canFold).map(o => o.range);
  const rangesForCalled: RangeSet[] = [
    ...foldableRangesForCalled,
    ...allInOpponents.map(o => o.range),
  ];
  const wPrime = equityVsRanges(sit.heroCards, sit.board, rangesForCalled, iterations, rng);

  // 对手跟注时还需再投入多少、跟注后真正的底池是多少 —— sit.pot 已经含有对手
  // 此前未被跟的下注（toCall），所以对手的跟注额是 b − toCall，最终底池是
  // sit.pot + b（hero 投入后）+ villainCall（对手再跟的部分），而不是 pot + 2b，
  // 否则会把 toCall 对应的那部分底池算两遍。toCall === 0 时 villainCall === b，
  // calledPot 精确退化为 pot + 2b，未加注下注的场景不受影响。
  const villainCall = round2(b - sit.toCall);
  const calledPot = round2(sit.pot + b + villainCall);
  const ev = foldEquity * sit.pot + (1 - foldEquity) * (wPrime * calledPot - b);

  return {
    label,
    actionType: chipsGreater(sit.toCall, 0) ? 'raise' : 'bet',
    investment: round2(b),
    ev: round4(ev),
    isRecommended: false,
    foldEquity: round4(foldEquity),
    equityWhenCalled: round4(wPrime),
  };
}

/**
 * 隐含赔率修正（spec §8.4）。
 *
 * 目前只覆盖口袋对（博暗三条）这一条：纯即时 EV 低估了小对子在深筹码下击中
 * 暗三条后能从对手后续街的下注里赚到的钱。
 *
 * 同花听牌与开口顺听同样属于 §8.4，但需要牌面感知的听牌检测，本代码库尚无该能力，
 * 留待下一阶段与复盘引擎的听牌判定一并实现。在此之前这两类手牌不会获得加成 ——
 * 宁可少算，也不要像先前那样用「胜率低于五成」当代理，那会让毫无听牌的空气牌
 * 拿到加成、而胜率过半的大听牌拿不到。
 */
function impliedOddsBonus(sit: Situation, heroEquity: number): number {
  if (sit.street === 'river') return 0;

  const hc = classifyHand(sit.heroCards[0], sit.heroCards[1]);
  if (hc.length !== 2) return 0;        // 非口袋对（对子的类别只有两个字符，如 '77'）

  const payableStacks = sit.opponents.filter(o => o.canFold).map(o => o.stack);
  if (payableStacks.length === 0) return 0;   // 没人还能在后续街付钱，谈不上隐含赔率
  const effectiveStack = Math.min(sit.heroStack, ...payableStacks);
  if (!chipsGreater(effectiveStack, 0)) return 0;

  // 击中暗三条的概率约 12%（两张牌到河牌），命中后能从对手那里多赚的比例按 0.35 估
  const hitChance = 0.12;
  const realiseRate = 0.35;
  return effectiveStack * hitChance * realiseRate * 0.1;
}

/** EV 保留 4 位小数，避免测试因浮点尾数抖动 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
