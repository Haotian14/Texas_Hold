import type { HandRecord } from '../../core/types';
import { foldedSeatsOf } from '../reviewModel';
import { CardView } from './Card';

/**
 * 对手底牌。对局中永远看不到，只有复盘才给 —— 标注写死在这里。
 *
 * 弃牌的座位灰显并标注：牌本身仍然显示（复盘要看的正是「他拿这手牌
 * 为什么弃」），只是视觉上退后一层。
 */
export function OpponentCards({ record }: { record: HandRecord }) {
  const folded = new Set(foldedSeatsOf(record));
  const others = record.seats.filter(s => s.seat !== record.heroSeat);
  return (
    <div className="opp-cards">
      <div className="opp-cards-title">对手底牌（仅复盘可见）</div>
      {others.map(s => (
        <div className={folded.has(s.seat) ? 'opp-row opp-folded' : 'opp-row'} key={s.seat}>
          <span className="opp-pos">{s.position}</span>
          <span className="opp-hand">
            <CardView card={s.holeCards[0]} size="sm" />
            <CardView card={s.holeCards[1]} size="sm" />
          </span>
          {folded.has(s.seat) ? <span className="opp-note">已弃牌</span> : null}
        </div>
      ))}
    </div>
  );
}
