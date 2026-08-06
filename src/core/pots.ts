import { round2 } from './chips';

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
        amount = round2(amount + layer);
        if (!folded.has(seat)) eligible.push(seat);
      }
    }

    // 孤儿层：本层没有任何未弃牌者的投入达到该档位（例如唯一投入到此档位的
    // 人弃牌了），导致 eligible 为空但这层钱是真实存在的死钱，不能丢弃。
    //
    // 真实牌局中这种情况不可能发生：弃牌的前提是面对高于自己本街投入的下注，
    // 而下注方本街投入等于当前最高额；双方在此前各街必然已跟平，所以下注方
    // 的总投入严格大于弃牌方。因此真实牌局中弃牌者永远不可能是唯一的最高投
    // 入者，孤儿层不会出现。这里的兜底只是为了让 buildPots 对任意输入（例如
    // 属性测试的随机生成器）都保持金额守恒。
    if (eligible.length === 0 && amount > 0) {
      if (raw.length > 0) {
        // 归入最近一个非空池的资格集（标准边池算法：多出的钱扫入上一个有
        // 活跃投入边界的池）
        eligible.push(...raw[raw.length - 1].eligible);
      } else {
        // 前面没有任何非空池，说明这是第一层就孤儿了：钱归全体未弃牌者
        for (const [seat] of contributions) {
          if (!folded.has(seat)) {
            eligible.push(seat);
          }
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
      last.amount = round2(last.amount + pot.amount);
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
