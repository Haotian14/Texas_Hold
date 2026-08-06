/** 筹码金额的零值判定。浮点累加会产生 1e-16 量级的尾数，不能直接和 0 比。 */
export function isZeroChips(v: number): boolean {
  return Math.abs(v) < 1e-9;
}

/** 筹码金额的严格大于判定，容忍浮点尾数。a 恰好等于 b 时返回 false。 */
export function chipsGreater(a: number, b: number): boolean {
  return a - b > 1e-9;
}

/** 金额规整到 2 位小数，消除浮点累积误差 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
