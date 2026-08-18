import { useEffect, useRef } from 'react';
import type { ActionType, SeatState } from '../../core/types';
import { chipsGreater, isZeroChips, round2 } from '../../core/chips';
import { ACTION_TEXT, chips } from '../format';
import { CardBack, CardView } from './Card';
import { Chips } from './Chips';

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
  // 下注框常驻挂载，金额归零时靠 CSS 过渡滑向牌桌中心并淡出——
  // 卸载元素就没有过渡可言。淡出期间要显示最后一次的非零金额，
  // 否则数字会在滑动过程中突变成 0。
  const lastBetRef = useRef(0);
  const betEmpty = isZeroChips(round2(seat.streetContribution));
  const shownBet = betEmpty ? lastBetRef.current : seat.streetContribution;
  // ref 在 effect 里写，不在渲染中写——渲染必须是纯的。时序正好合用：
  // 金额归零的那一次渲染，读到的是上一次 effect 存下的非零值。
  useEffect(() => {
    if (!betEmpty) lastBetRef.current = seat.streetContribution;
  });

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
      <div className="seat-bet" data-empty={betEmpty ? 'true' : 'false'}>
        <Chips bb={shownBet} />
        <span className="seat-bet-amount">{chips(shownBet)}</span>
      </div>
    </div>
  );
}
