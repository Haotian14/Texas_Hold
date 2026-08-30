// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { GameState, SeatState } from '../../core/types';
import { parseCard } from '../../core/cards';
import { Table } from './Table';

/**
 * 牌桌亮牌的边界。
 *
 * 「什么时候亮」由 tableModel.opponentsRevealed 决定（那边有自己的用例）；
 * 这里钉的是「亮的时候亮谁」——已经弃掉的对手不亮。他的牌是死牌，亮出来
 * 既是噪音，又会让「谁还在这手里」变难认，而后者是读桌的第一件事。
 */
const HANDS = ['AhQs', 'KcKh', '8d3c', 'TsTd', 'Jh4s'];

function seats(foldedSeats: number[] = []): SeatState[] {
  return ['BTN', 'SB', 'BB', 'UTG', 'MP'].map((position, i) => ({
    seat: i,
    position,
    stack: 100,
    startingStack: 100,
    holeCards: [parseCard(HANDS[i].slice(0, 2)), parseCard(HANDS[i].slice(2))],
    folded: foldedSeats.includes(i),
    allIn: false,
    streetContribution: 0,
    totalContribution: 2,
    hasActedSinceLastFullRaise: false,
  })) as unknown as SeatState[];
}

function game(over: Partial<GameState> = {}): GameState {
  return {
    buttonSeat: 0,
    toAct: 1,
    board: [],
    seats: seats(),
    ...over,
  } as unknown as GameState;
}

function draw(g: GameState, revealed: boolean) {
  return render(
    <Table game={g} personaIds={new Map()} lastAction={null} revealed={revealed} heroWon={false} />,
  );
}

describe('牌桌上的对手底牌', () => {
  it('不亮的时候一个座位都不画牌', () => {
    const { container } = draw(game(), false);
    expect(container.querySelectorAll('.seat-cards')).toHaveLength(0);
  });

  it('亮的时候每个还在牌里的对手都亮两张真牌', () => {
    const { container } = draw(game(), true);
    const blocks = container.querySelectorAll('.seat-cards');
    // hero 的座位不由 Table 画（他有自己的 HeroHand），所以是四个对手
    expect(blocks).toHaveLength(4);
    for (const b of blocks) expect(b.querySelectorAll('.card')).toHaveLength(2);
  });

  it('已经弃牌的对手即便在亮牌时也不亮', () => {
    const { container } = draw(game({ seats: seats([2, 4]) }), true);
    expect(container.querySelectorAll('.seat-cards')).toHaveLength(2);
  });
});
