import { useEffect, useRef } from 'react';
import type { SeatState } from '../../core/types';
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
}: {
  seat: SeatState;
  isButton: boolean;
  isToAct: boolean;
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
      <div className={isToAct ? 'hero-info hero-to-act' : 'hero-info'}>
        <span className="hero-pos">
          {seat.position}
          {isButton && <span className="button-chip">D</span>}
        </span>
        <span className="hero-stack">{chips(seat.stack)}</span>
        <span className="hero-bet" data-empty={betEmpty ? 'true' : 'false'}>
          <Chips bb={shownBet} />
          投入 {chips(shownBet)}
        </span>
      </div>
    </div>
  );
}
