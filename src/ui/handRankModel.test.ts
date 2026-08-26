import { describe, it, expect } from 'vitest';
import { cardToString, sameCard } from '../core/cards';
import { evaluate5Slow } from '../core/handEvalSlow';
import { HandCategory, categoryOf, describeHand } from '../core/handScore';
import { HAND_RANKS, handRankName } from './handRankModel';

/**
 * 牌型对照表的正确性。
 *
 * 这一页是给新手看「哪个牌型更大」的，一旦顺序错了或者示例牌凑错了形状，
 * 它教出来的东西就是反的——而这种错误看着完全正常（五张牌摆在那里，标题写着
 * 「葫芦」，谁会去数）。所以不靠人校对：**每个示例都真的丢进引擎跑一遍**。
 *
 * 用 evaluate5Slow（穷举参考实现）而不是 evaluate7：它正好收五张牌，而对照表
 * 展示的就是五张成手牌。这也是这个"仅测试对拍用"的模块唯一一次被产品路径的
 * 测试用到——它在这里的身份仍然是标尺。
 */
describe('牌型对照表', () => {
  it('九档牌型不重不漏', () => {
    const cats = HAND_RANKS.map(r => r.category);
    expect(new Set(cats).size).toBe(cats.length);
    // HandCategory 是连续枚举 0..8，全部到齐
    const all = Object.values(HandCategory).filter(v => typeof v === 'number') as HandCategory[];
    expect([...cats].sort((a, b) => a - b)).toEqual([...all].sort((a, b) => a - b));
  });

  it('每个示例都是五张互不相同的牌', () => {
    for (const row of HAND_RANKS) {
      expect(row.cards.length).toBe(5);
      for (let i = 0; i < row.cards.length; i++) {
        for (let j = i + 1; j < row.cards.length; j++) {
          expect(sameCard(row.cards[i], row.cards[j])).toBe(false);
        }
      }
    }
  });

  // 这一条是全表的地基：示例牌凑出来的形状必须真的是标题写的那个牌型
  it('每个示例跑引擎得到的牌型与标注一致', () => {
    for (const row of HAND_RANKS) {
      const score = evaluate5Slow([...row.cards]);
      const actual = categoryOf(score);
      expect(
        actual,
        `${handRankName(row.category)} 那一行的示例 ` +
          `${row.cards.map(cardToString).join(' ')} ` +
          `实际是「${describeHand(score)}」`,
      ).toBe(row.category);
    }
  });

  // 顺序的权威是引擎，不是表里的排列
  it('整列分值严格递减', () => {
    const scores = HAND_RANKS.map(r => evaluate5Slow([...r.cards]));
    for (let i = 1; i < scores.length; i++) {
      expect(
        scores[i],
        `第 ${i + 1} 行「${handRankName(HAND_RANKS[i].category)}」` +
          `不比第 ${i} 行「${handRankName(HAND_RANKS[i - 1].category)}」小`,
      ).toBeLessThan(scores[i - 1]);
    }
  });

  it('牌型名取自 core，不是界面另存的一份', () => {
    for (const row of HAND_RANKS) {
      const score = evaluate5Slow([...row.cards]);
      expect(handRankName(row.category)).toBe(describeHand(score));
    }
  });

  it('最大的那一档是同花顺，最小的是高牌', () => {
    expect(HAND_RANKS[0].category).toBe(HandCategory.StraightFlush);
    expect(HAND_RANKS[HAND_RANKS.length - 1].category).toBe(HandCategory.HighCard);
  });
});
