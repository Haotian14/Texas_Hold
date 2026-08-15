import type { Card as CardModel } from '../../core/cards';
import { CardView } from './Card';

export function Board({ board }: { board: readonly CardModel[] }) {
  return (
    <div className="board">
      {board.map((c, i) => (
        <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="lg" />
      ))}
    </div>
  );
}
