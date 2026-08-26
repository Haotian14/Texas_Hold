import type { ActionType, Street } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { Card } from './cards';
import type { RangeSet } from './rangeSet';
import { rangeCombos, fullRange, totalWeight } from './rangeSet';
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
  /**
   * 该候选的 EV 照常计算、照常参与「用户实际打的是哪一档」的匹配，但**不参与
   * 推荐动作的选取**。目前只有一个取值 'deep-stack-allin'，原因见
   * ALLIN_MAX_SPR 上的注释。
   *
   * 刻意做成「照算不推荐」而不是「干脆不产出这个候选」：候选一旦消失，
   * 用户真的全下时 matchCandidate（review/judge.ts）会把这次全下就近配到
   * 'bet pot' 上，拿一个小得多的尺度的 EV 去描述他没打过的那手牌——那正是
   * judge.ts 顶部记着的那个「自愿全下被静默判成没问题」缺陷的另一种形态。
   */
  notRecommendable?: 'deep-stack-allin';
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

/**
 * 下注尺度 → 本次投入额。**全项目唯一的尺度换算点**。
 *
 * `pot` 是跟平之前的底池（含对手这条街已下、尚未被跟的注），`toCall` 是
 * 欠注额：先把欠的跟平，再按**跟平前**的底池下 fraction 倍。toCall 为 0
 * 时退化成「下注 fraction 倍底池」。
 *
 * 动作条的快捷档位（session/actionBarModel.ts）必须走这里而不是自己再写
 * 一遍公式：两处一旦分歧，用户点着写「满池」的按钮打出的却是复盘引擎
 * 认不出的尺度，而复盘给出的 EV 描述的是他没打过的那手牌。
 */
export function betInvestment(pot: number, toCall: number, fraction: number): number {
  return round2(pot * fraction + toCall);
}

/**
 * 全下还能被**推荐**的最大 SPR（heroStack / pot）。超过这条线的全下照常算 EV，
 * 但不参与推荐动作的选取。
 *
 * 理由是这个引擎的单步近似在深筹码全下上有一个结构性偏差，而且是**只偏一边**的：
 * 全下之后没有后续街，`W' × calledPot − b` 恰好就是它真实的期望；而任何一个
 * 正常尺度的下注之后其实还有两条街可打，模型却同样把它当成「这手牌到此为止、
 * hero 按 W' 分走底池」来估——后续街能赚到的钱一分都没算进去。于是两边一比，
 * 唯一被算准的那个动作（全下）系统性地压过每一个被算少的动作。筹码越深，
 * 被漏掉的后续价值越多，偏差越大：实测 95BB 深度下，只要跟注范围前的胜率
 * W' 过半，全下的 EV 就随筹码线性增长，60 个随机翻牌局面里有 20% 推荐把
 * 95BB 全下进 10BB 底池。
 *
 * 取 2 的含义：全下的额度不超过两个满池下注。低于这条线时「全下」本来就是
 * 一个正常尺度（短筹码、或者池子已经很大），单步模型对它的估计是可信的；
 * 高于这条线时它是一个模型没有能力评价的动作，引擎的正确姿态是不给建议，
 * 而不是给一个被结构性高估的建议。
 *
 * 注意这不是「深筹码不许全下」——用户真的全下时，这个候选的 EV 照样算、照样
 * 拿来跟推荐动作比，亏了多少照样报（对手范围里没人会弃牌时，全下的 EV 会是
 * 一个很大的负数，复盘会狠狠地标出来）。被关掉的只是「引擎主动劝你全下」。
 */
const ALLIN_MAX_SPR = 2;

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
      const b = betInvestment(sit.pot, sit.toCall, size.fraction);
      if (!chipsGreater(maxInvest, b)) continue;   // 筹码不足以打出这个尺度
      candidates.push(
        makeBetCandidate(sit, size.label, b, rankedFoldable, iterations, rng, dead, widenedRange, degradeTracker),
      );
    }

    // all-in 永远是一个候选；深筹码时它只算 EV、不参与推荐（见 ALLIN_MAX_SPR）。
    const allin = makeBetCandidate(
      sit, 'all-in', maxInvest, rankedFoldable, iterations, rng, dead, widenedRange, degradeTracker,
    );
    if (chipsGreater(sit.heroStack, ALLIN_MAX_SPR * sit.pot)) {
      allin.notRecommendable = 'deep-stack-allin';
    }
    candidates.push(allin);
  }

  // ── 选出推荐动作。跳过 notRecommendable 的候选（见 ALLIN_MAX_SPR）；
  // fold / check 永远没有这个标记，所以 eligible 不可能为空。
  const eligible = candidates.filter(c => c.notRecommendable === undefined);
  let best = eligible[0];
  for (const c of eligible) if (c.ev > best.ev) best = c;
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
 * 继续比例在面对巨大尺度时会低到个位数百分比，切出来只剩一个类别（通常是
 * AA，六个组合）。可牌桌上只有四张 A —— 几个对手不可能同时握着同一小撮
 * 组合，采样永远凑不出互不冲突的配置。按对手数把范围放宽到物理可行为止。
 *
 * 这个地板只是**采样兜底**，不是策略模型的一部分：它一旦生效，W' 对的就不再
 * 是 continueFraction 切出来的那份范围，Fe 与 W' 会失去共同的范围基准。旧的
 * MDF 弃牌率模型下它经常生效——MDF 在全下尺度上会掉到 1.5%，地板于是把 W'
 * 托了起来，让超池全下凭空拿到「弃牌率接近 1、跟注后胜率还不低」的两头好处，
 * 这正是「什么局面都推荐全下」那个缺陷的一半成因。改成价格模型后继续比例
 * 有了物理下限（拿得动的牌不会因为尺度大就弃掉），地板在正常局面下不再生效，
 * 但仍然保留：范围被上游收窄到只剩几个组合时，它是采样能不能跑起来的保证。
 */
const MIN_COMBOS_PER_OPPONENT = 8;

function continueRangeWithFloor(
  ranked: readonly RankedCombo[],
  continueFraction: number,
  opponentCount: number,
  dead: readonly Card[],
): RangeSet {
  const needed = MIN_COMBOS_PER_OPPONENT * Math.max(1, opponentCount);
  let fraction = Math.min(1, continueFraction);
  for (let i = 0; i < 12; i++) {
    const r = topFraction(ranked, fraction);
    if (rangeCombos(r, dead).length >= needed || fraction >= 1) return r;
    fraction = Math.min(1, fraction * 1.6);
  }
  return topFraction(ranked, 1);
}

/**
 * 一个「下注范围」对随机手的平均胜率。**弃牌率模型里唯一一个自由参数**，
 * 调整松紧改这一个即可。
 *
 * 用途见 strengthThresholdForPrice：对手拿到的底池赔率给出的是「我需要多少
 * 胜率**对着下注者的范围**」，而 rangeStrength.ts 给每个组合打的分是「对着一个
 * **随机手**的胜率」，两个量纲不能直接比。这个常数是把前者换算成后者时对
 * 「下注者的范围有多强」的估计。
 *
 * **翻前翻后取值不同，这不是拍脑袋，是牌力刻度本身在两边不一样。**
 *
 * 翻后（0.65）照着教科书的 MDF 标定：面对 1/3 池、1/2 池、2/3 池、满池，
 * 防守方应当继续 75% / 67% / 60% / 50%。让一个「平均范围」（全范围、以及 BB
 * 的防守范围，各取 25 个随机翻牌）跑本模型，S=0.65 实测继续 79% / 68% / 60%
 * / 49%，四档全部落在教科书值几个百分点内。
 *
 * 于是有了新模型与旧模型的关键区别：**MDF 不再是输入，而是输出**。旧实现把
 * MDF 当成对手的行为直接写死，于是对手拿 {AA} 也按尺度弃牌；新实现只问
 * 「这个价格下这手牌跟不跟得起」，平均范围算出来的结果自然逼近 MDF，而范围
 * 异常强（{AA}：继续 100%）或异常弱（收窄到只剩空气：继续接近 0）时，模型
 * 会正确地偏离 MDF——那正是 MDF 作为「平均情形下的均衡量」本来就不该覆盖的
 * 两端。
 *
 * 翻前（0.72）不能用同一个数，有两条独立的原因：
 *
 *   1）**刻度被压扁了**。rangeStrength 的牌力是「对随机手的胜率」，翻前这个量
 *      挤在 0.38～0.86 之间（全范围实测 p10=0.377、p50=0.492、p75=0.573），
 *      而翻牌圈会摊开到接近 0～1。同一个门槛在翻前扫过的组合比例因此陡得多：
 *      S=0.65 时满池加注还有 55% 的人跟得起，S=0.78 时只剩 9%。
 *   2）**翻前弃牌本来就不是由即时赔率决定的**。翻前弃 72o 不是因为它对开池
 *      范围没有 25% 的胜率（它有），而是因为它翻后没法打——那是后续街的代价，
 *      单步模型看不见（spec §12）。所以翻前照 MDF 标定反而是错的：MDF 会把
 *      对手建模得比任何真实牌桌都松。
 *
 * 0.72 是照**行为**标定的：AI 自对弈 60 手里翻前结束的手数。真实 6-max 里
 * 相当一部分手牌在翻前就收掉，S=0.65 时只剩 8/60（几乎每手都进翻牌，对手
 * 面对开池几乎从不弃牌），0.72 把它带回 20 手上下的量级。对应的继续比例是
 * 1/3 池 86%、1/2 池 62%、2/3 池 46%、满池 29%——满池加注打出约七成弃牌率，
 * 这与真实牌桌上「开池后每个对手大概率弃牌」相符，而 MDF 说的 50% 不符。
 */
export const BETTOR_RANGE_STRENGTH = { preflop: 0.72, postflop: 0.65 } as const;

/**
 * 把「对手需要多少胜率才跟得起」换算成 rangeStrength 的牌力刻度。
 *
 * 对手的底池赔率 e = villainCall / calledPot 说的是「我对着下注者的范围要有
 * e 的胜率」。而范围里每个组合身上带的 strength 是「对随机手的胜率」
 * （见 core/rangeStrength.ts 的 RankedCombo）。两者用 Bradley–Terry 换算：
 * 两个量都是对**同一个参照物**（随机手）的胜率时，头对头胜率的赔率比等于
 * 各自赔率之比，即
 *
 *     e/(1−e) = [s/(1−s)] ÷ [S/(1−S)]     s = 对手这手牌的 strength
 *                                          S = BETTOR_RANGE_STRENGTH 的对应档
 *                                              （翻前 / 翻后，见那个常量的注释）
 *
 * 反解出门槛 s：strength 不低于它的组合跟得起这个价格，低于它的跟不起。
 *
 * 一个值得记住的性质：e = 0.5（对手要付的钱和跟注后底池的一半一样多，也就是
 * 尺度无穷大的极限）时门槛恰好等于 S —— 「要跟这种尺度，你得跟下注者的范围
 * 一样强」。弃牌率的平台正是由这条线切出来的，全下不会再拿到趋于 1 的弃牌率。
 */
function strengthThresholdForPrice(requiredEquity: number, street: Street): number {
  const e = Math.min(0.999, Math.max(0, requiredEquity));
  if (e <= 0) return 0;
  const S = street === 'preflop' ? BETTOR_RANGE_STRENGTH.preflop : BETTOR_RANGE_STRENGTH.postflop;
  const odds = (e / (1 - e)) * (S / (1 - S));
  return odds / (1 + odds);
}

/**
 * 范围里牌力不低于门槛的那部分占多少权重 —— 也就是「这个价格下对手会继续
 * 的比例」。ranked 已按 strength 降序（rankRange 的后置条件），但这里仍然
 * 整表扫一遍而不是二分：范围最多几百个组合，扫一遍的开销可以忽略，而依赖
 * 排序做二分会在将来有人改动 rankRange 的排序约定时静默出错。
 */
function priceContinueFraction(ranked: readonly RankedCombo[], threshold: number): number {
  const total = totalWeight(ranked);
  if (total <= 0) return 0;
  let cont = 0;
  for (const c of ranked) {
    if (c.strength >= threshold) cont += c.weight;
  }
  return cont / total;
}

/**
 * EV(投入 b) = Fe × 底池 + (1 − Fe) × [ W' × calledPot − b ]
 *
 * Fe        所有「还能弃牌」的对手都弃牌的概率 = ∏(1 − 各人的继续比例)；
 *           已全下的对手不会弃牌，不参与这个连乘。若没有一个对手能弃牌，
 *           Fe 恒为 0。继续比例怎么来的见下方 continueFractions 处的长注释。
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

  // 对手跟注时还需再投入多少、跟注后真正的底池是多少 —— sit.pot 已经含有对手
  // 此前未被跟的下注（toCall），所以对手的跟注额是 b − toCall，最终底池是
  // sit.pot + b（hero 投入后）+ villainCall（对手再跟的部分），而不是 pot + 2b，
  // 否则会把 toCall 对应的那部分底池算两遍。toCall === 0 时 villainCall === b，
  // calledPot 精确退化为 pot + 2b，未加注下注的场景不受影响。
  //
  // 这两个量在下面的弃牌率模型里就要用到（对手面对的价格），不能再像以前那样
  // 拖到最后算 EV 时才出现。
  const villainCall = round2(b - sit.toCall);
  const calledPot = round2(sit.pot + b + villainCall);

  // ── 每个能弃牌的对手会继续多少：问他自己的问题——**这个价格下，我这手牌
  // 跟得起吗**。requiredEquity = villainCall / calledPot 是他拿到的底池赔率，
  // 范围里强到能满足这个赔率的部分继续，其余弃牌。
  //
  // 旧实现不是这么算的：它直接令继续比例 = MDF = pot/(pot+b)、弃牌率
  // = (1 - MDF)^k。MDF 是「防守方至少要防这么多，否则诈唬无脑赚」的均衡量，
  // 是用来让**诈唬方**无差异的，不是对手行为的预测。把它当预测用有两个后果，
  // 这就是本轮修复的缺陷本体：
  //   1）弃牌率与对手手上是什么牌完全无关——对手范围被收窄到只剩 {AA}，模型
  //      照样认为他面对全下会弃 90%，还会把「对着 AA 全下」算成 +7.4BB 的最优解。
  //      牌桌上辛苦建的松紧人格（ai/personaRange.ts）在 EV 这一层被整个抹掉。
  //   2）MDF 随 b 单调趋于 0，于是 Fe 随尺度单调趋于 1，超池全下的 EV 趋于
  //      2·pot·W'，压过一切正常尺度。实测 60 个随机翻牌局面里有 20% 直接推荐把
  //      95BB 全下进 10BB 底池；而正常的半池持续下注有 72% 被复盘判成失误，
  //      其中大半的标签是「下注太小」——用户看到的就是这个。
  //
  // 价格模型没有这两个后果：AA 满足任何价格，继续比例恒为 1、弃牌率恒为 0；
  // 尺度再大也只能挤掉「跟不起的那部分」，Fe 收敛到一个由范围决定的平台而不是 1。
  // 而对平均范围，它算出来的继续比例本身就逼近 MDF（见 BETTOR_RANGE_STRENGTH
  // 的标定说明）——教科书结论从假设变成了结果。
  const requiredEquity = calledPot > 0 ? Math.max(0, villainCall) / calledPot : 0;
  const continueThreshold = strengthThresholdForPrice(requiredEquity, sit.street);
  const continueFractions = rankedFoldable.map(r =>
    Math.min(1, priceContinueFraction(r, continueThreshold)),
  );
  const continueRanges: RangeSet[] = rankedFoldable.map((r, i) =>
    continueRangeWithFloor(r, continueFractions[i], rankedFoldable.length, dead),
  );

  // 所有能弃牌的对手都弃牌的概率：每人独立以 (1 - 自己的继续比例) 弃牌。
  // 继续比例现在按对手逐个算（各人范围不同，面对同一个价格的继续比例也不同），
  // 所以这里是连乘而不是旧实现的 Math.pow(1-mdf, k)。
  // k = 0（没有一个对手能弃牌，比如单挑面对全下）时没有人会弃牌，空连乘的
  // 结果是 1，必须显式短路成 0，否则会凭空产生弃牌率。
  // k 只取决于能弃牌的对手数，不受下面 W' 是否需要宽范围兜底影响。
  const k = continueRanges.length;
  const foldEquity = k === 0 ? 0 : continueFractions.reduce((acc, cf) => acc * (1 - cf), 1);

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
  // 放宽之后有个刻意保留的不对称：foldEquity 上面已经算完了，用的是各对手
  // 真实的继续比例；这里 W' 一旦触发放宽，替换进来的宽范围来自 widenedRange()
  // （按 MIN_COMBOS_PER_OPPONENT 的物理下限放宽），已经不再是那个继续比例
  // 切出来的「继续范围」。也就是说 Fe 回答的是「这个价格下有多少人跟得起」，
  // W' 在放宽发生后回答的是「按物理下限能采到样的最窄范围，对手跟注后的
  // 胜率」，两个问题在放宽发生的那一刻不再是同一份范围的两面。
  // EvResult.degraded 就是留给下游识别这种情况的标记。
  //
  // 注意这层不对称现在只在**放宽真的发生时**才出现。旧的 MDF 模型下还有一层
  // 常驻的不对称（Fe 按 mdf 算、继续范围按 MIN_COMBOS 的地板切），价格模型
  // 已经把它消掉了：continueFractions 同时喂给 Fe 和继续范围，正常局面下
  // 两者共享同一份范围。
  const allInOpponents = sit.opponents.filter(o => !o.canFold);
  const rangesForCalled: RangeSet[] = [...continueRanges, ...allInOpponents.map(o => o.range)];
  const wResult = equityWithSelectiveWidening(
    sit.heroCards, sit.board, rangesForCalled, iterations, rng, dead, widenedRange,
  );
  const wPrime = wResult.equity;
  degradeTracker.maxWidened = Math.max(degradeTracker.maxWidened, wResult.widenedCount);

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
