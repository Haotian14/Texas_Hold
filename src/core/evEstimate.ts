import type { ActionType } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { Card } from './cards';
import type { RangeSet } from './rangeSet';
import { rangeCombos, fullRange } from './rangeSet';
import { equityVsRanges, InfeasibleSamplingError } from './equity';
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
  /**
   * 本次估算里是否发生过采样兜底放宽（某个对手的范围因物理无解被替换成
   * 宽范围）。null 表示 heroEquity 与所有候选的 W' 全部用的是对手的真实
   * 范围，没有任何替换发生——这时 EvResult 里的数字可以直接采信。
   * 'widened-ranges' 表示至少一次放宽发生过：可能只影响了某一个候选的
   * W'，也可能连 heroEquity 本身都被放宽过，具体是谁被替换、替换成什么
   * 已经不可追溯（放宽后的范围不是真实信息），下游（复盘引擎）看到这个
   * 标记时应当认为 heroEquity / 相关候选的 ev 不完全可信，不能直接拿来
   * 对人报「你输了 X BB」这类具体数字。
   */
  degraded: 'widened-ranges' | null;
  /**
   * degraded 不为 null 时，本次估算过程中单次放宽最多替换掉的对手数
   * （heroEquity 和每个下注候选的 W' 各自独立触发放宽、各自可能放宽不同
   * 数量的对手，这里取其中最多的一次，作为「放宽严重到什么程度」的粗量级
   * 指标，不是被替换对手的精确并集）。degraded 为 null 时恒为 0。
   */
  degradedOpponentCount: number;
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
  // opponentCount 数上全部对手（含已全下的）——他们的牌照样要从牌堆里发出来。
  const opponentCount = sit.opponents.length;

  // 宽范围兜底：只有在采样物理无解（多个对手的范围收窄到互相冲突、拒绝采样
  // 找不到任何一组不冲突的手牌组合，equityVsRanges 抛 InfeasibleSamplingError）
  // 时才需要——正常情况下 narrowByAction 收窄出的范围即使很窄，也是物理可行的，
  // 不应该被这里的兜底替换掉、丢失它承载的真实信息。
  //
  // rankRange(fullRange(), …) 是全代码库里最贵的调用，且对同一次 estimateEv
  // 调用（同一个 board/dead/strengthIterations/rng）结果完全相同，因此惰性
  // 计算并缓存在这个闭包里：本次调用里不管多少个对手、多少个下注尺度触发
  // 兜底，全范围排序最多算一次。闭包只在本次 estimateEv 调用内存活，不会
  // 跨调用共享——不同调用的 board/dead/rng 不同，共享会破坏可复现性。
  let wideRankedCache: RankedCombo[] | null = null;
  const widenedRange = (): RangeSet => {
    if (!wideRankedCache) {
      wideRankedCache = rankRange(fullRange(), sit.board, dead, strengthIterations, rng);
    }
    const needed = MIN_COMBOS_PER_OPPONENT * Math.max(1, opponentCount);
    const startFraction = needed / Math.max(1, wideRankedCache.length);
    return continueRangeWithFloor(wideRankedCache, startFraction, opponentCount, dead);
  };

  // W：对当前对手范围的胜率。先按对手的真实（可能已被 narrowByAction 收窄的）
  // 范围采样；只有真的采样无解时才退化成宽范围重试——且只放宽真正造成冲突
  // 的那些对手，见 equityWithSelectiveWidening 上的注释。
  const heroOppRanges: RangeSet[] = sit.opponents.map(o => o.range);
  const heroResult = equityWithSelectiveWidening(
    sit.heroCards, sit.board, heroOppRanges, iterations, rng, dead, widenedRange,
  );
  const heroEquity = heroResult.equity;
  // 记录本次估算里放宽的最严重程度，最终写进 EvResult.degraded /
  // degradedOpponentCount（见 makeBetCandidate 调用处的另一次可能更新）。
  const degradeTracker = { maxWidened: heroResult.widenedCount };

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
        makeBetCandidate(sit, size.label, b, rankedFoldable, iterations, rng, dead, widenedRange, degradeTracker),
      );
    }

    // all-in 永远是一个候选
    candidates.push(
      makeBetCandidate(sit, 'all-in', maxInvest, rankedFoldable, iterations, rng, dead, widenedRange, degradeTracker),
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
    degraded: degradeTracker.maxWidened > 0 ? 'widened-ranges' : null,
    degradedOpponentCount: degradeTracker.maxWidened,
  };
}

/**
 * 采样一组对手范围的胜率；若物理无解（某个对手的范围与死牌/其他对手冲突到
 * 拒绝采样找不到解），只放宽真正造成冲突的那个对手，而不是把所有对手一并
 * 换成宽范围。
 *
 * 背景：旧实现一旦采样失败，就不分青红皂白地把全部对手的范围都替换成同一份
 * 宽范围重试。真实场景常常是「五个对手，一个被 4-bet 线收窄到 {AA} 这种
 * 只有几个组合的类别，另外四个还是正常的 ~40% 范围」——采样失败的原因只是
 * 那一个退化对手，另外四个的组合完全够互相不冲突地摸牌。全体替换会把四个
 * 健康范围也一起丢掉，hero 被错误地建模成面对五个顶级范围，heroEquity 系统性
 * 偏低。
 *
 * 做法：按「剔除死牌后的组合数」从少到多给对手排序——组合数最少的最可能是
 * 采样失败的元凶，最先被怀疑、最先被放宽；仍然失败就放宽次窄的一个，以此
 * 类推，直到成功或者所有对手都被放宽过。每次只替换一个，用尽量小的代价换
 * 到「能采样」这个目标，不多动一个健康范围。
 */
function equityWithSelectiveWidening(
  hero: [Card, Card],
  board: Card[],
  ranges: readonly RangeSet[],
  iterations: number,
  rng: Rng,
  dead: readonly Card[],
  widenedRange: () => RangeSet,
): { equity: number; widenedCount: number } {
  const current = [...ranges];
  const order = ranges
    .map((_, i) => i)
    .sort((a, b) => rangeCombos(ranges[a], dead).length - rangeCombos(ranges[b], dead).length);

  let widenedCount = 0;
  let cursor = 0;
  for (;;) {
    try {
      const equity = equityVsRanges(hero, board, current, iterations, rng);
      return { equity, widenedCount };
    } catch (err) {
      if (!(err instanceof InfeasibleSamplingError)) throw err;
      // 已经把所有对手都放宽过还是无解——牌桌本身容不下这么多对手（比如
      // 宽范围本身的组合数都不够这么多人互不冲突地摸两张），原样抛出，
      // 不静默吞掉；estimateEv 的两处调用点都不再捕获这个错误。
      if (cursor >= order.length) throw err;
      current[order[cursor]] = widenedRange();
      widenedCount++;
      cursor++;
    }
  }
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
  widenedRange: () => RangeSet,
  degradeTracker: { maxWidened: number },
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

  // 所有能弃牌的对手都弃牌的概率：每人独立以 (1 - mdf) 的概率弃牌。
  // k = 0（没有一个对手能弃牌，比如单挑面对全下）时没有人会弃牌，
  // Math.pow(1-mdf, 0) 恒等于 1，必须显式短路成 0，否则会凭空产生弃牌率。
  // k 只取决于能弃牌的对手数，不受下面 W' 是否需要宽范围兜底影响。
  const k = continueRanges.length;
  const foldEquity = k === 0 ? 0 : Math.pow(1 - mdf, k);

  // W'：对手跟注后的胜率。对能弃牌的对手必须用「继续范围」单独算 ——
  // 沿用 W 会系统性高估诈唬价值，因为对手跟注时留下的是更强的那部分范围。
  // 已全下的对手不受下注影响 —— 他们已经全部投入，无论 hero 打多大都稳坐池中，
  // 因此始终用其完整范围参与 W' 的计算。
  //
  // 先按真实的继续范围采样；如果上游（比如 narrowByAction）把多个对手的
  // 范围收窄到同一个类别，导致 continueRanges 之间物理上无法互不冲突地
  // 同时成立，equityVsRanges 会抛 InfeasibleSamplingError —— 此时才退化成
  // 宽范围重试，且只逐个放宽真正造成冲突的对手（见 equityWithSelectiveWidening），
  // 不预先猜测、不在没出问题时就替换掉真实的继续范围，也不会因为一个对手
  // 的问题连累其余健康的继续范围。
  //
  // 放宽之后有个刻意保留的不对称：foldEquity 上面已经算完了，用的是这个
  // 尺度真实的 mdf；这里 W' 一旦触发放宽，替换进来的宽范围来自
  // widenedRange()（按 MIN_COMBOS_PER_OPPONENT 的物理下限放宽），已经不再
  // 是这个尺度的 mdf 切出来的「继续范围」。也就是说 Fe 回答的是「这个具体
  // 尺度下按教科书 MDF 会有多少人弃牌」，W' 在放宽发生后回答的是「按物理
  // 下限能采到样的最窄范围，对手跟注后的胜率」，两个问题在放宽发生的那一刻
  // 已经不再是同一个「继续范围」的两面。这与 continueRangeWithFloor 上文档
  // 的不对称（Fe 用 mdf、继续范围用物理下限）同源，但是新的一层：那里是
  // 「未放宽时」两者的物理下限差异，这里是「放宽发生后」两者干脆不共享
  // 同一个范围对象了。EvResult.degraded 就是留给下游识别这种情况的标记。
  const allInOpponents = sit.opponents.filter(o => !o.canFold);
  const rangesForCalled: RangeSet[] = [...continueRanges, ...allInOpponents.map(o => o.range)];
  const wResult = equityWithSelectiveWidening(
    sit.heroCards, sit.board, rangesForCalled, iterations, rng, dead, widenedRange,
  );
  const wPrime = wResult.equity;
  degradeTracker.maxWidened = Math.max(degradeTracker.maxWidened, wResult.widenedCount);

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
