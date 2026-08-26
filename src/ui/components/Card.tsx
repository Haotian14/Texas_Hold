import type { Card as CardModel } from '../../core/cards';
import { rankText, suitText, suitClass } from '../format';

export function CardView({ card, size = 'md' }: { card: CardModel; size?: 'sm' | 'md' | 'lg' }) {
  const rank = rankText(card);
  return (
    <span className={`card card-${size} ${suitClass(card)}`}>
      {/* 「10」是唯一两个字符的点数。字号与单字符点数**相同**（2026-08-25 用户
          决定），card-rank-wide 现在只收紧字距，不再缩字号——牌宽容得下，
          tools/card-fit-check.mjs 逐张量过 */}
      <span className={rank.length > 1 ? 'card-rank card-rank-wide' : 'card-rank'}>{rank}</span>
      <span className="card-suit">{suitText(card)}</span>
    </span>
  );
}

/** 背面朝上的牌 */
export function CardBack({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card card-${size} card-back`} />;
}
