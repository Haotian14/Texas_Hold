import { useEffect, useRef } from 'react';
import type { SeatState } from '../../core/types';
import { isZeroChips, round2 } from '../../core/chips';
import { chips } from '../format';
import { CardView } from './Card';
import { Chips } from './Chips';

export function HeroHand({ seat, isButton }: { seat: SeatState; isButton: boolean }) {
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
      <div className="hero-info">
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
