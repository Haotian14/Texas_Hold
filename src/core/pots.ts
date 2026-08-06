export interface Pot {
  /** 该池的筹码总额 */
  amount: number;
  /** 有资格争夺该池的座位号，升序 */
  eligible: number[];
}

/**
 * 按 all-in 金额分层计算主池与边池。
 *
 * @param contributions 座位号 -> 本手总投入（含已弃牌者的死钱）
 * @param folded        已弃牌的座位号
 */
export function buildPots(
  contributions: Map<number, number>,
  folded: ReadonlySet<number>,
): Pot[] {
  const levels = [...new Set([...contributions.values()])]
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  const raw: Pot[] = [];
  let prev = 0;

  for (const level of levels) {
    const layer = level - prev;
    let amount = 0;
    const eligible: number[] = [];

    for (const [seat, c] of contributions) {
      if (c >= level) {
        amount += layer;
        if (!folded.has(seat)) eligible.push(seat);
      }
    }

    // If no one is eligible at this level (dead money), make all unfolded players eligible
    if (eligible.length === 0 && amount > 0) {
      for (const [seat] of contributions) {
        if (!folded.has(seat)) {
          eligible.push(seat);
        }
      }
    }

    if (amount > 0) {
      raw.push({ amount, eligible: eligible.sort((a, b) => a - b) });
    }
    prev = level;
  }

  // 资格集合相同的相邻层合并，避免产生一堆等价的小池
  const merged: Pot[] = [];
  for (const pot of raw) {
    const last = merged[merged.length - 1];
    if (last && sameEligible(last.eligible, pot.eligible)) {
      last.amount += pot.amount;
    } else {
      merged.push({ ...pot });
    }
  }

  // 全员弃牌的层（死钱无人争夺）归入下一个有资格者的池；
  // 若整体无人有资格，说明调用方状态有误
  return merged.filter(p => p.eligible.length > 0);
}

function sameEligible(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
