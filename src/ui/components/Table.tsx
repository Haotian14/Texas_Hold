import { useEffect, useRef } from 'react';
import type { ActionType, GameState } from '../../core/types';
import { HERO_SEAT } from '../../core/types';
import { isZeroChips, round2 } from '../../core/chips';
import { Board } from './Board';
import { Pot } from './Pot';
import { Seat } from './Seat';

export interface TableProps {
  game: GameState;
  /** 座位号 -> persona id（handSession 的同名字段），座位上显示性格名要用 */
  personaIds: ReadonlyMap<number, string>;
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 手牌结束且走到摊牌时为 true */
  revealed: boolean;
  /** 本手已结束且 hero 赢下底池时为 true，触发赢池脉冲 */
  heroWon: boolean;
}

export function Table({ game, personaIds, lastAction, revealed, heroWon }: TableProps) {
  const others = game.seats.filter(s => s.seat !== HERO_SEAT);
  // settleHand 结算时会把所有 totalContribution 清零(那笔钱已派回 stack，
  // 不清零会破坏筹码守恒)，而底池正是从这些字段求和得来的——于是手牌结束
  // 那一刻底池会显示 0，偏偏赢池脉冲就在此刻触发。冻结最后一个非零值，
  // 让脉冲打在真正赢下的那个数字上。
  // ref 在 effect 里写，不在渲染中写——渲染必须是纯的。与 Seat.tsx 同一模式。
  const potNow = game.seats.reduce((a, s) => a + s.totalContribution, 0);
  const lastPotRef = useRef(0);
  const potEmpty = isZeroChips(round2(potNow));
  const pot = potEmpty ? lastPotRef.current : potNow;
  useEffect(() => {
    if (!potEmpty) lastPotRef.current = potNow;
  });

  return (
    <div className="table">
      <div className="opponents">
        {others.map((seat, i) => (
          <div key={seat.seat} className={`opponent-slot slot-${i}`}>
            <Seat
              seat={seat}
              isButton={seat.seat === game.buttonSeat}
              isToAct={game.toAct === seat.seat}
              personaId={personaIds.get(seat.seat)}
              slot={i}
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
