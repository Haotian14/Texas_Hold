import { HERO_SEAT } from '../core/types';
import type { HandSessionState } from '../session/handSession';

/**
 * 牌桌上是否亮出对手的底牌。
 *
 * 两种情况：
 *
 * 1. **hero 已经弃牌。** 这手牌与他再无关系——他不会再有任何一个决策，
 *    看见别人的牌影响不了任何事，剩下的只是观战。不必等到结算：翻前一
 *    弃牌就该看得见，那正是这段观战时间最长、也最值得看的场合（AI 之间
 *    还要打完三条街）。
 * 2. **手牌结束且走到摊牌。** 原本就有的行为，一字未改。
 *
 * 这**不是**上帝视角：hero 还在牌里的时候一张都不亮，否则这个应用就不再
 * 是个训练器了。真正让人看不见的是第一个条件，不是别的地方。
 *
 * 另一半约束在 Seat.tsx——它另外要求 `!seat.folded`，所以亮出来的只有还在
 * 跟你抢底池的那几个人。已经弃掉的对手的牌是死牌，亮出来既是噪音，又会
 * 让「谁还在这手里」变难认。
 *
 * 只影响显示。AI 决策读的是 game/ranges，复盘判定读的是 HandRecord（且被
 * 禁止读非 hero 座位的 holeCards，见 review 的红线），两者都与这里无关。
 */
export function opponentsRevealed(s: HandSessionState): boolean {
  if (s.game.seats[HERO_SEAT].folded) return true;
  return s.phase === 'handOver' && (s.record?.results.some(r => r.showdown) ?? false);
}
