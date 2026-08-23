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
    let countAtOrAboveLevel = 0;
    const eligible: number[] = [];

    for (const [seat, c] of contributions) {
      if (c >= level) {
        countAtOrAboveLevel++;
        if (!folded.has(seat)) eligible.push(seat);
      }
    }
    // 对本层总额只在最后取整一次，而不是逐个座位累加取整：逐步取整对
    // 分单位（例如两人各投 0.005）的输入不等价于对总额取整一次，会凭空
    // 铸币（0.005+0.005 逐步取整会变成 0.02，真实总额是 0.01）。
    const amount = round2(layer * countAtOrAboveLevel);

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

  // 走到这里，每一层理论上都应该有非空资格集：孤儿层已经在上面的循环里
  // 继承了「上一个非空池」的资格集（没有上一个池时兜底给全体未弃牌者）。
  // 唯一还会剩下空资格集的情况是调用方传入的 contributions 里全员弃牌——
  // 这是调用方的状态错误（全员弃牌根本不该走到 buildPots，应在更早处判定
  // 唯一未弃牌者赢下全部，或干脆是个 bug）。以前这里用 filter 把这种池
  // 悄悄丢弃，代价是它装着的真实筹码也被一并丢弃，调用方后续按 pots 派彩
  // 会派得比总投入少，筹码守恒不变量在别处爆炸，错误现场却在这里——所以
  // 改成直接抛错，而不是沉默地吃掉筹码。
  for (const pot of merged) {
    if (pot.eligible.length === 0) {
      throw new Error(
        'buildPots：出现资格集为空但金额非零的池（多半是全员弃牌的非法调用），调用方状态有误',
      );
    }
  }
  return merged;
}

function sameEligible(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * 实际被争夺的底池：总投入减去「无人跟满、结算时原样退回给下注方」的那部分。
 *
 * 界面上手牌结束那一刻要显示的是这个数，而不是各座位投入之和。两者在有人
 * 全下却无人跟满时会差得离谱——实测过的一手：对手全下 4,000、只有 433 被跟到，
 * 投入之和是 4,453，而真正易手的只有 886。把 4,453 摆出来是在说一个从未存在过
 * 的底池。
 *
 * 算法就是德扑的退回规则本身：最高投入超出「第二高投入」的部分从未被任何人
 * 跟上，结算时退回原主，因此不属于底池。两人及以上并列最高时差额为 0，不扣。
 *
 * 注意这是**结束时**的口径。牌局进行中显示的仍是投入之和——那时下注还可能被
 * 跟，先把它从池子里减掉会让底池数字在等待对手行动时诡异地缩水。
 */
export function contestedTotal(contributions: readonly number[]): number {
  if (contributions.length === 0) return 0;
  const total = contributions.reduce((a, b) => a + b, 0);

  let max = -Infinity;
  let second = -Infinity;
  for (const c of contributions) {
    if (c > max) {
      second = max;
      max = c;
    } else if (c > second) {
      second = c;
    }
  }
  // 只有一个座位时没有「第二高」，等于全部退回：无人与之相争
  const uncalled = second === -Infinity ? max : max - second;
  return round2(total - uncalled);
}
