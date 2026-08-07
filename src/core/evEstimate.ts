import type { ActionType } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { RangeSet } from './rangeSet';
import { equityVsRanges } from './equity';
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

  const oppRanges: RangeSet[] = sit.opponents.map(o => o.range);
  const dead = [...sit.heroCards, ...sit.board];

  // W：对当前对手范围的胜率
  const heroEquity = equityVsRanges(sit.heroCards, sit.board, oppRanges, iterations, rng);

  // 各对手范围按牌力排好序，供后续切「继续范围」用。排序开销大，只做一次。
  const rankedPerOpp = sit.opponents.map(o =>
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
      candidates.push(makeBetCandidate(sit, size.label, b, rankedPerOpp, iterations, rng));
    }

    // all-in 永远是一个候选
    candidates.push(makeBetCandidate(sit, 'all-in', maxInvest, rankedPerOpp, iterations, rng));
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
 * EV(投入 b) = Fe × 底池 + (1 − Fe) × [ W' × calledPot − b ]
 *
 * Fe        所有对手都弃牌的概率
 * W'        对手跟注后的胜率 —— 必须对「继续范围」单独算，
 *           沿用 W 会系统性高估诈唬价值
 * calledPot 对手跟注后的最终底池 = sit.pot + b + villainCall；
 *           未加注下注（toCall === 0）时精确退化为 pot + 2b
 */
function makeBetCandidate(
  sit: Situation,
  label: string,
  investment: number,
  rankedPerOpp: ReturnType<typeof rankRange>[],
  iterations: number,
  rng: Rng,
): EvCandidate {
  const b = investment;

  // 每个对手面对该尺度时理论上必须防守的比例（MDF）。
  // 推导：诈唬（W'=0）时 hero 的 EV = (1-mdf)*sit.pot - mdf*b（calledPot 项的
  // 系数是 W'，W'=0 时直接消掉），令其为 0 得 mdf = sit.pot/(sit.pot+b)。
  // b 已经把 sit.toCall 算在内了（见下方调用处 b = pot*fraction + toCall），
  // 所以这条公式对下注和加注都成立，不需要因为 toCall > 0 而改写。
  const mdf = Math.min(1, sit.pot / (sit.pot + b));
  const continueRanges: RangeSet[] = rankedPerOpp.map(r => topFraction(r, mdf));

  // 所有人都弃牌的概率：每个对手独立以 (1 - mdf) 的概率弃牌
  const foldEquity = Math.pow(1 - mdf, continueRanges.length);

  // W'：对手跟注后的胜率。必须对「继续范围」单独算 ——
  // 沿用 W 会系统性高估诈唬价值，因为对手跟注时留下的是更强的那部分范围。
  // 若任一继续范围被死牌清空，回落到原范围（此时该近似会偏保守）。
  const allUsable = continueRanges.every(r => r.size > 0);
  const rangesForCalled = allUsable ? continueRanges : sit.opponents.map(o => o.range);
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

  const effectiveStack = Math.min(sit.heroStack, ...sit.opponents.map(o => o.stack));
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
