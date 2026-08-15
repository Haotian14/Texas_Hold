import type { Card } from '../core/cards';

/**
 * 一个大盲等于多少筹码。
 *
 * 这是整个项目里唯一的 BB ↔ 实额换算点。内部量纲（core / ai / review /
 * session）一律是 BB —— 范围表的标定、EV 的单位、534 个测试全都建立在
 * BB 上。实额只是显示。若日后要改盲注级别，只动这一个常量。
 *
 * 例外：EV 损失与复盘数字保持 BB。「你这一步亏了 2.3BB」比「亏了 92」
 * 有意义得多，且跨盲注级别可比。
 */
export const CHIPS_PER_BB = 40;

/** BB → 实额字符串，带千位分隔，取整到个位 */
export function chips(bb: number): string {
  const v = Math.round(bb * CHIPS_PER_BB) || 0;
  return v.toLocaleString('en-US');
}

const RANK_TEXT: Record<number, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: 'T',
};

/** 牌面文字，如 'A♠' */
export function cardText(c: Card): string {
  const rank = RANK_TEXT[c.rank] ?? String(c.rank);
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit];
  return `${rank}${suit}`;
}

/** 四色牌的 CSS 类名：♠黑 ♥红 ♦蓝 ♣绿 */
export function suitClass(c: Card): string {
  return `suit-${c.suit}`;
}
