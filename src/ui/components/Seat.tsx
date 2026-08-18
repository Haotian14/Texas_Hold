import { useEffect, useRef } from 'react';
import type { ActionType, SeatState } from '../../core/types';
import { chipsGreater, isZeroChips, round2 } from '../../core/chips';
import { personaLabel, seatBadge } from '../../session/seatLabels';
import { ACTION_TEXT, chips } from '../format';
import { CardView } from './Card';
import { Chips } from './Chips';

export interface SeatProps {
  seat: SeatState;
  isButton: boolean;
  isToAct: boolean;
  /** 该座位的 persona id（见 handSession 的 personaIds），用于显示性格名 */
  personaId: string | undefined;
  /** 本座位最近一个动作；不是本座位或本手尚无动作时为 null */
  bubble: { type: ActionType; amount: number } | null;
  /** 摊牌后亮底牌 */
  revealed: boolean;
}

/**
 * 一个对手座位。
 *
 * 版式照设计稿：**横向**胶囊——左边一个圆角方块（放位置），右边两行（性格名 /
 * 筹码），动作徽章挂在胶囊**下方**。改版前是竖着堆的（两张牌背在最上，下面
 * 一个小方框），那个形状是暗色版留下的，和设计稿差得最远的就是它。
 *
 * 不再常驻画两张牌背。设计稿的座位上没有牌，"谁还在这手里"由整块的淡出与
 * FOLD 徽章表达；牌背既占掉了胶囊上方的一整块高度（正是它把座位顶出台面的
 * 原因），又没有任何信息——每个没弃牌的人当然都有两张牌。摊牌时照旧亮真牌，
 * 那一刻的牌是真信息。
 */
export function Seat({ seat, isButton, isToAct, personaId, bubble, revealed }: SeatProps) {
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

  const showCards = revealed && !seat.folded;

  return (
    <div className={cls}>
      {showCards && (
        <div className="seat-cards">
          {seat.holeCards.map((c, i) => (
            <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="sm" />
          ))}
        </div>
      )}
      <div className="seat-info">
        <span className="seat-badge">
          {seatBadge(seat.position)}
          {isButton && <span className="button-chip">D</span>}
        </span>
        <span className="seat-meta">
          <span className="seat-name">{personaLabel(personaId)}</span>
          <span className="seat-stack">{chips(seat.stack)}</span>
        </span>
      </div>
      {bubble && (
        <div className="bubble">
          {ACTION_TEXT[bubble.type]}
          {chipsGreater(bubble.amount, 0) && ` ${chips(bubble.amount)}`}
        </div>
      )}
      <div className="seat-bet" data-empty={betEmpty ? 'true' : 'false'}>
        <Chips bb={shownBet} />
        <span className="seat-bet-amount">{chips(shownBet)}</span>
      </div>
    </div>
  );
}
