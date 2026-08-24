import { situationFromGameState } from '../core/situation';
import { equityVsRanges, InfeasibleSamplingError } from '../core/equity';
import { fullRange } from '../core/rangeSet';
import { createRng } from '../core/rng';
import { HERO_SEAT } from '../core/types';
import type { HandSessionState } from './handSession';

/**
 * 牌桌上那个可开关的胜率读数。
 *
 * 口径是 hero 对所有未弃牌对手**范围**的胜率，不是对他们的底牌——底牌在
 * GameState 里唾手可得，拿它算出来的是"结果论"的胜率，和复盘引擎那条
 * 「不得使用对手实际底牌」的红线是同一个问题：牌桌上真人也只能对范围下注。
 * 这也让这个数与 AI 决策、复盘 EV 走的是同一套世界观（都过 equityVsRanges）。
 */
export interface HeroEquity {
  /** 0..1。平局按 1/并列人数 计入，与 equityVsRanges 语义一致 */
  equity: number;
  /** 参与比牌的对手数（含已全下的：他们不再行动，但仍要摊牌） */
  opponents: number;
  /**
   * 采样降级。对手范围互相冲突到牌堆凑不出互不冲突的发牌时，这个数是
   * 放宽成全范围之后重算的，不是按各自范围算的。界面必须把它标出来，
   * 理由与 ②-B-2 那条「估值降级时不报数字」相同：一个建立在替换范围上的
   * 胜率，读起来和正常的胜率一模一样。
   */
  degraded: boolean;
}

/** 显示用的默认迭代数。比 EV 引擎的 2000 低——这个数只用来读大概，
 *  且每次 hero 行动都要算一遍，卡在主线程上比少两位精度更难受。 */
export const EQUITY_DISPLAY_ITERATIONS = 1200;

/**
 * 算当前待决策局面下 hero 的胜率。
 *
 * 非 hero 回合、手牌已结束、或场上已无对手时返回 null —— 这几种情况下
 * 「当前胜率」没有意义，返回一个 0 会被界面当成"你必输"渲染出来。
 *
 * rng 与 stepAi 一样每次现造而不是存进状态：同一个局面重复调用必须得到
 * 逐位相同的数字，否则 React 每重渲染一次，屏幕上的胜率就自己跳一下。
 */
export function heroEquityNow(
  s: HandSessionState,
  iterations: number = EQUITY_DISPLAY_ITERATIONS,
): HeroEquity | null {
  if (s.phase !== 'awaitingHero') return null;
  if (s.game.handOver || s.game.toAct !== HERO_SEAT) return null;

  const situation = situationFromGameState(s.game, {
    ranges: new Map(s.ranges),
    personaIds: new Map(s.personaIds),
  });
  if (situation.opponents.length === 0) return null;

  // 同一手同一步恒定：seed 里带 stepIndex，不带任何随重渲染变化的量
  const seedOf = (tag: string) => createRng(`${s.seed}-h${s.handIndex}-eq${s.stepIndex}-${tag}`);

  const ranges = situation.opponents.map(o => o.range);
  try {
    return {
      equity: equityVsRanges(situation.heroCards, situation.board, ranges, iterations, seedOf('a')),
      opponents: situation.opponents.length,
      degraded: false,
    };
  } catch (e) {
    if (!(e instanceof InfeasibleSamplingError)) throw e;
    // 全部放宽成全范围重算一次。EV 引擎那边是「最窄的先逐个放宽」，更精细；
    // 这里不照抄的理由是这个数只用于显示，而放宽到什么程度都已经不是原始
    // 口径了——与其做一个看着更讲究、实则同样失真的近似，不如放到底并如实
    // 打上 degraded，让界面去说"这个数不准"。
    return {
      equity: equityVsRanges(
        situation.heroCards,
        situation.board,
        ranges.map(() => fullRange()),
        iterations,
        seedOf('wide'),
      ),
      opponents: situation.opponents.length,
      degraded: true,
    };
  }
}
