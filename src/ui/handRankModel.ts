import type { Card } from '../core/cards';
import { parseCards } from '../core/cards';
import { HandCategory, categoryName } from '../core/handScore';

/**
 * 牌型大小对照（新手用）。
 *
 * **顺序不是手写的。** 这一列按 HandCategory 的枚举值从大到小排，而那个枚举
 * 正是引擎比大小时用的最高位（见 handScore.ts 的 pack）。配套测试还会把每个
 * 示例真的丢进 evaluate5Slow 跑一遍，断言它确实是标注的那个牌型、且整列分值
 * 严格递减——**排序的权威是引擎，不是这张表**。
 *
 * 牌型名同理，走 core 的 categoryName，不在这里另抄一份中文。
 *
 * 示例刻意都用同一批点数附近的牌，让人一眼看出「差别只在结构」：不是牌大就
 * 赢，而是五张牌凑成了什么形状。唯一的例外是同花顺那档用了 A-K-Q-J-10——
 * 那是新手最想认的一手（皇家同花顺），值得占一个位置。
 */
export interface HandRankRow {
  category: HandCategory;
  /** 五张示例牌，已解析好 */
  cards: readonly Card[];
  /** 一句话说清这个牌型是什么形状 */
  note: string;
}

/**
 * 皇家同花顺**不是**单独一档：它就是最大的那个同花顺（A 高），引擎里没有为它
 * 单开分类，这里也不开——多列一档会让人以为它要另外记一条规则。
 */
/**
 * 牌用的是**内部记法**（10 写作 `T`，见 core/handClass 的 RANK_CHARS），不是
 * 牌桌上显示的 '10'——parseCard 只认前者。显示交给 rankText，两者刻意不同。
 */
const ROWS: readonly { category: HandCategory; cards: string; note: string }[] = [
  {
    category: HandCategory.StraightFlush,
    cards: 'As Ks Qs Js Ts',
    note: '五张同花色且点数连续。这一手是同花顺里最大的，也就是常说的皇家同花顺。',
  },
  {
    category: HandCategory.Quads,
    cards: '9s 9h 9d 9c Kd',
    note: '四张同点数，加任意一张。',
  },
  {
    category: HandCategory.FullHouse,
    cards: '9s 9h 9d Kc Kd',
    note: '三张同点数 + 一对。',
  },
  {
    category: HandCategory.Flush,
    cards: 'As Js 9s 6s 3s',
    note: '五张同花色，点数不必连续。',
  },
  {
    category: HandCategory.Straight,
    cards: '9s 8h 7d 6c 5s',
    note: '五张点数连续，花色不必相同。A 既能当最大（A-K-Q-J-10）也能当 1（5-4-3-2-A）。',
  },
  {
    category: HandCategory.Trips,
    cards: '9s 9h 9d Kc 4s',
    note: '三张同点数。',
  },
  {
    category: HandCategory.TwoPair,
    cards: '9s 9h Kc Kd 4s',
    note: '两个不同点数的对子。',
  },
  {
    category: HandCategory.OnePair,
    cards: '9s 9h Kc 6d 4s',
    note: '一个对子。',
  },
  {
    category: HandCategory.HighCard,
    cards: 'Ks Jh 9d 6c 4s',
    note: '什么都没凑成，比最大的那张牌。',
  },
];

export const HAND_RANKS: readonly HandRankRow[] = ROWS.map(r => ({
  category: r.category,
  cards: parseCards(r.cards),
  note: r.note,
}));

/** 牌型名。走 core 的那一份，界面不另存中文 */
export function handRankName(c: HandCategory): string {
  return categoryName(c);
}
