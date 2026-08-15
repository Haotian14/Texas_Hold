import type { Card as CardModel } from '../../core/cards';
import { rankText, suitText, suitClass } from '../format';

export function CardView({ card, size = 'md' }: { card: CardModel; size?: 'sm' | 'md' | 'lg' }) {
  const rank = rankText(card);
  return (
    <span className={`card card-${size} ${suitClass(card)}`}>
      {/* 「10」是唯一两个字符的点数，需要单独缩一档字号，否则会撑破牌面 */}
      <span className={rank.length > 1 ? 'card-rank card-rank-wide' : 'card-rank'}>{rank}</span>
      <span className="card-suit">{suitText(card)}</span>
    </span>
  );
}

/** 背面朝上的牌 */
export function CardBack({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-back`} />;
}
