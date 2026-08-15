import type { SeatState } from '../../core/types';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';
import { CardView } from './Card';

export function HeroHand({ seat, isButton }: { seat: SeatState; isButton: boolean }) {
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
        {chipsGreater(seat.streetContribution, 0) && (
          <span className="hero-bet">投入 {chips(seat.streetContribution)}</span>
        )}
      </div>
    </div>
  );
}
