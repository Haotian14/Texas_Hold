import type { Position, Street } from '../core/types';
import type { MistakeTag } from '../review/taxonomy';
import type { StoredHand } from './schema';

/**
 * 历史页的筛选条件（规格 §10.4：可按位置、街道、mistakeTag、是否 disputed 筛选）。
 *
 * 纯函数放在这里而不是写进组件：筛选的语义有几处不显然（见下面每个字段的
 * 注释），而组件层没有测试。
 *
 * 每个字段 undefined / null 都表示「不筛这一项」。用可选字段而不是「全部」
 * 这样的哨兵值，是为了让 `{}` 天然表示"什么都不筛"。
 */
export interface HandFilter {
  position?: Position | null;
  /** 该手出现过这个失误分类 */
  tag?: MistakeTag | null;
  /**
   * 该手**在这条街上有失误**，而不是"这手打到了这条街"。
   *
   * 后者几乎筛不掉任何东西（绝大多数手都打过翻前），而历史页的用途是"找出
   * 我在哪条街上漏得最多"。所以判据是：这条街上存在 tag 非空的决策点。
   */
  street?: Street | null;
  /**
   * 三态：`null`/`undefined` = 不筛，`true` = 只看标记过「我不认同」的，
   * `false` = 只看**没**标记的。
   *
   * 规格 §10.4 写的是「按**是否** disputed 筛选」，两个方向都要。曾经把
   * `false` 当成"不筛"，结果是 isFilterEmpty 与 matchesFilter 对同一个值
   * 的理解不同——前者认为在筛、后者放行一切。测试当场撞出来了。
   */
  disputed?: boolean | null;
}

export function isFilterEmpty(f: HandFilter): boolean {
  return (
    (f.position ?? null) === null &&
    (f.tag ?? null) === null &&
    (f.street ?? null) === null &&
    (f.disputed ?? null) === null
  );
}

export function matchesFilter(hand: StoredHand, f: HandFilter): boolean {
  if (f.position != null && hand.heroPosition !== f.position) return false;

  // 用顶层的 mistakeTags 而不是 view.tags：分析失败的那些手 view 为 null，
  // 走 view 会需要到处判空，而顶层字段在 storedHandOf 里已经统一成空数组。
  if (f.tag != null && !hand.mistakeTags.includes(f.tag)) return false;

  if (f.disputed != null && hand.disputed !== f.disputed) return false;

  if (f.street != null) {
    // 分析失败的手没有决策点，任何街道筛选都不该命中它 —— 我们并不知道
    // 它在哪条街上错了，把它算进来是在猜。
    if (hand.view === null) return false;
    const hit = hand.view.decisions.some(d => d.street === f.street && d.tag !== null);
    if (!hit) return false;
  }

  return true;
}
