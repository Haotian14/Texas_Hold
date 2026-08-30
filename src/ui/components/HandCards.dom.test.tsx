// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { HandRecord } from '../../core/types';
import { parseCard } from '../../core/cards';
import { HandCards } from './HandCards';

/**
 * 复盘页的「本手牌面」。
 *
 * 钉住的是**信息完整**这件事：复盘要回答的是「他拿那手牌为什么这么打」，
 * 而这个问题在只给对手底牌、不给公共牌的时候没法回答——公共牌得靠脑子记。
 * hero 自己的两张牌同理：五个人里独独缺他一个，对比无从谈起。
 */
function record(over: Partial<HandRecord> = {}): HandRecord {
  return {
    id: 's1700000000000-h0',
    heroSeat: 0,
    seats: [
      { seat: 0, position: 'BTN', personaId: 'hero', holeCards: [parseCard('Ah'), parseCard('Qs')] },
      { seat: 1, position: 'SB', personaId: 'tag', holeCards: [parseCard('Kc'), parseCard('Kh')] },
      { seat: 2, position: 'BB', personaId: 'rock', holeCards: [parseCard('8d'), parseCard('3c')] },
    ],
    board: ['As', 'Kd', '7h', '2c', '9s'].map(parseCard),
    actions: [{ seat: 2, street: 'preflop', type: 'fold', amount: 0 }],
    results: [],
    ...over,
  } as unknown as HandRecord;
}

describe('复盘页的本手牌面', () => {
  it('公共牌一行，桌上每个人各一行——hero 不缺席', () => {
    const { container } = render(<HandCards record={record()} />);
    expect(container.querySelectorAll('.hc-seat')).toHaveLength(3);
    const board = container.querySelector('.hc-board');
    expect(board!.querySelectorAll('.card')).toHaveLength(5);
  });

  it('每个座位都亮两张真牌，一张牌背都没有', () => {
    const { container } = render(<HandCards record={record()} />);
    for (const row of container.querySelectorAll('.hc-seat')) {
      expect(row.querySelectorAll('.card')).toHaveLength(2);
    }
    expect(container.querySelectorAll('.card-back')).toHaveLength(0);
  });

  it('hero 排第一行并标「你」，其余按座位号跟在后面', () => {
    const { container } = render(<HandCards record={record()} />);
    const rows = container.querySelectorAll('.hc-seat');
    expect(rows[0].querySelector('.hc-you')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('BTN');
    expect(rows[1].querySelector('.hc-you')).toBeNull();
    expect(rows[1]).toHaveTextContent('SB');
    expect(rows[2]).toHaveTextContent('BB');
  });

  it('弃牌的座位灰显并标注，没弃的不标', () => {
    const { container } = render(<HandCards record={record()} />);
    const rows = [...container.querySelectorAll('.hc-seat')];
    const bb = rows.find(r => r.textContent?.includes('BB'))!;
    expect(bb).toHaveClass('hc-folded');
    expect(bb).toHaveTextContent('已弃牌');
    expect(rows[0]).not.toHaveClass('hc-folded');
    expect(rows[0]).not.toHaveTextContent('已弃牌');
  });

  it('hero 自己弃的牌一样标出来——这一行不是特权行', () => {
    const rec = record({
      actions: [{ seat: 0, street: 'preflop', type: 'fold', amount: 0 }],
    } as unknown as Partial<HandRecord>);
    const { container } = render(<HandCards record={rec} />);
    const rows = container.querySelectorAll('.hc-seat');
    expect(rows[0]).toHaveClass('hc-folded');
    expect(rows[0]).toHaveTextContent('已弃牌');
  });

  it('翻前就结束的手不画空的公共牌盒，写明未发出', () => {
    const { container } = render(<HandCards record={record({ board: [] })} />);
    const board = container.querySelector('.hc-board')!;
    expect(board.querySelectorAll('.card')).toHaveLength(0);
    expect(board).toHaveTextContent('未发出公共牌');
  });
});
