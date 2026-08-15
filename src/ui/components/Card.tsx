import type { Card as CardModel } from '../../core/cards';
import { cardText, suitClass } from '../format';

export function CardView({ card, size = 'md' }: { card: CardModel; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} ${suitClass(card)}`}>{cardText(card)}</span>;
}

/** 背面朝上的牌 */
export function CardBack({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-back`} />;
}
