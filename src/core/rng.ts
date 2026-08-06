/** 可复现的伪随机数发生器。core 层禁止使用 Math.random()，一律走这里。 */
export interface Rng {
  /** 下一个 32 位无符号整数 */
  nextU32(): number;
  /** [0, 1) 区间的浮点数 */
  nextFloat(): number;
  /** [0, n) 区间的整数 */
  nextInt(n: number): number;
}

/** FNV-1a：把字符串 seed 压成一个 32 位整数 */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：状态小、速度快、统计质量足够本项目使用 */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);

  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat = (): number => nextU32() / 4294967296;

  return {
    nextU32,
    nextFloat,
    nextInt: (n: number) => Math.floor(nextFloat() * n),
  };
}

/** Fisher-Yates 洗牌。返回新数组，不修改入参。 */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
