export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.OnePair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.Trips]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.Quads]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
};

/**
 * 把牌型与决胜点数打包成一个可直接比大小的整数。
 * 编码：category 占最高位，其后 5 个 4-bit 槽位存决胜点数（不足补 0）。
 * 点数最大为 14 < 16，因此每个槽位 4 bit 足够。
 */
export function pack(category: number, tiebreak: number[]): number {
  let v = category;
  for (let i = 0; i < 5; i++) {
    v = v * 16 + (tiebreak[i] ?? 0);
  }
  return v;
}

export function categoryOf(score: number): HandCategory {
  return Math.floor(score / 16 ** 5) as HandCategory;
}

export function describeHand(score: number): string {
  return CATEGORY_NAMES[categoryOf(score)];
}
