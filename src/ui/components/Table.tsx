import type { ActionType, GameState } from '../../core/types';
import { HERO_SEAT } from '../../core/types';
import { Board } from './Board';
import { Pot } from './Pot';
import { Seat } from './Seat';

export interface TableProps {
  game: GameState;
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 手牌结束且走到摊牌时为 true */
  revealed: boolean;
  /** 本手已结束且 hero 赢下底池时为 true，触发赢池脉冲 */
  heroWon: boolean;
}

export function Table({ game, lastAction, revealed, heroWon }: TableProps) {
  const others = game.seats.filter(s => s.seat !== HERO_SEAT);
  const pot = game.seats.reduce((a, s) => a + s.totalContribution, 0);

  return (
    <div className="table">
      <div className="opponents">
        {others.map((seat, i) => (
          <div key={seat.seat} className={`opponent-slot slot-${i}`}>
            <Seat
              seat={seat}
              isButton={seat.seat === game.buttonSeat}
              isToAct={game.toAct === seat.seat}
              bubble={lastAction?.seat === seat.seat ? lastAction : null}
              revealed={revealed}
            />
          </div>
        ))}
      </div>
      <div className="table-center">
        <Pot amount={pot} won={heroWon} />
        <Board board={game.board} />
      </div>
    </div>
  );
}
