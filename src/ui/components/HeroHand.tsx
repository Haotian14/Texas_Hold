import { useEffect, useRef } from 'react';
import type { SeatState } from '../../core/types';
import type { HeroEquity } from '../../session/heroEquity';
import { isZeroChips, round2 } from '../../core/chips';
import { chips } from '../format';
import { CardView } from './Card';
import { Chips } from './Chips';

/**
 * hero 的手牌与信息条。
 *
 * isToAct 只驱动一个蓝色高亮环——设计稿里"轮到你"是靠信息卡亮起来说的，
 * 不是靠底部按钮出现。若把高亮做成常驻，那个环就不再表示任何状态，只是
 * 一圈装饰；而这一圈恰恰是牌桌上唯一告诉你"该你了"的视觉信号。
 */
export function HeroHand({
  seat,
  isButton,
  isToAct,
  equity,
}: {
  seat: SeatState;
  isButton: boolean;
  isToAct: boolean;
  /** 胜率读数。关掉开关、非 hero 回合、或还没算完时为 null */
  equity: HeroEquity | null;
}) {
  const lastBetRef = useRef(0);
  const betEmpty = isZeroChips(round2(seat.streetContribution));
  const shownBet = betEmpty ? lastBetRef.current : seat.streetContribution;
  useEffect(() => {
    if (!betEmpty) lastBetRef.current = seat.streetContribution;
  });

  return (
    <div className="hero">
      <div className="hero-cards">
        {seat.holeCards.map((c, i) => (
          <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="lg" />
        ))}
      </div>
      {/* 胜率读数。贴着底牌放而不是塞进下面那张信息卡：它讲的是"这两张牌
          现在值多少"，与筹码、位置不是一类信息。
          写明「对范围」不是啰嗦——不写的话它会被读成"对他们的牌"，而后者
          是个完全不同（且不可能知道）的数。 */}
      {equity !== null && (
        <div className={equity.degraded ? 'hero-equity degraded' : 'hero-equity'}>
          <span className="hero-equity-num">{(equity.equity * 100).toFixed(1)}%</span>
          <span className="hero-equity-label">
            对 {equity.opponents} 人范围
            {/* 降级时这个数是放宽成全范围之后算的，读起来和正常值一模一样，
                不标出来就是在拿一个失真的数字冒充正常读数 */}
            {equity.degraded && ' · 范围冲突，仅供参考'}
          </span>
        </div>
      )}
      {/* 版式与对手座位完全一致（头像方块 + 两行），只是头像底色与「你」的
          标记不同。设计稿把 hero 的卡做成同一个组件的一个变体，而不是另造一个
          ——牌桌上六个人用两套版式，眼睛每次都要重新找筹码在哪一行。
          头像方块固定写「YOU」——hero 没有性格字可放（不是 AI 对手），
          位置信息跟对手座位一样降到胶囊内的小标记（.seat-pos），不丢。 */}
      <div className={isToAct ? 'hero-info hero-to-act' : 'hero-info'}>
        {isButton && (
          <span className="dealer-btn" aria-hidden="true">
            D
          </span>
        )}
        <span className="seat-badge hero-badge">YOU</span>
        <span className="seat-meta">
          <span className="seat-name-row">
            <span className="seat-name">你</span>
            <span className="seat-pos">{seat.position}</span>
            <span className="hero-you">YOU</span>
          </span>
          <span className="hero-stack">{chips(seat.stack)}</span>
        </span>
        <span className="hero-bet" data-empty={betEmpty ? 'true' : 'false'}>
          <Chips bb={shownBet} />
          投入 {chips(shownBet)}
        </span>
      </div>
      {/* 「轮到你了」写成一行字，而不是只靠上面那圈蓝环。设计稿这里有一行
          「Your turn · 18s」，它存在的理由是：环是纯颜色编码，色觉障碍用户
          与读屏用户都拿不到。倒计时不做——本项目没有行动时限。 */}
      {isToAct && <div className="hero-turn">轮到你了</div>}
    </div>
  );
}
