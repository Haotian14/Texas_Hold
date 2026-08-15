import type { ActionType, SeatState } from '../../core/types';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';
import { CardBack, CardView } from './Card';
import { Chips } from './Chips';

const ACTION_TEXT: Record<ActionType, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  allin: '全下',
};

export interface SeatProps {
  seat: SeatState;
  isButton: boolean;
  isToAct: boolean;
  /** 本座位最近一个动作；不是本座位或本手尚无动作时为 null */
  bubble: { type: ActionType; amount: number } | null;
  /** 摊牌后亮底牌 */
  revealed: boolean;
}

export function Seat({ seat, isButton, isToAct, bubble, revealed }: SeatProps) {
  const cls = [
    'seat',
    seat.folded ? 'seat-folded' : '',
    isToAct ? 'seat-to-act' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      {bubble && (
        <div className="bubble">
          {ACTION_TEXT[bubble.type]}
          {chipsGreater(bubble.amount, 0) && ` ${chips(bubble.amount)}`}
        </div>
      )}
      <div className="seat-cards">
        {revealed && !seat.folded ? (
          seat.holeCards.map((c, i) => (
            <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="sm" />
          ))
        ) : (
          <>
            <CardBack />
            <CardBack />
          </>
        )}
      </div>
      <div className="seat-info">
        <span className="seat-pos">
          {seat.position}
          {isButton && <span className="button-chip">D</span>}
        </span>
        <span className="seat-stack">{chips(seat.stack)}</span>
      </div>
      {chipsGreater(seat.streetContribution, 0) && (
        <div className="seat-bet">
          <Chips bb={seat.streetContribution} />
          <span className="seat-bet-amount">{chips(seat.streetContribution)}</span>
        </div>
      )}
    </div>
  );
}
