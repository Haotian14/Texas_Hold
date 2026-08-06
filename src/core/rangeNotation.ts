import type { HandClass } from './handClass';
import { RANK_CHARS, allHandClasses, parseHandClass } from './handClass';

/** 由点数下标与类型拼回类别字符串 */
function makeClass(hiIdx: number, loIdx: number, kind: 'pair' | 's' | 'o'): HandClass {
  const h = RANK_CHARS[hiIdx];
  const l = RANK_CHARS[loIdx];
  return kind === 'pair' ? h + l : h + l + kind;
}

/** 展开 `XX+` 记法 */
function expandPlus(spec: string, token: string): HandClass[] {
  const base = spec.slice(0, -1);
  const { hiIdx, loIdx, kind } = parseHandClass(base);
  const out: HandClass[] = [];

  if (kind === 'pair') {
    // 对子向上展开到 AA
    for (let i = hiIdx; i <= 12; i++) out.push(makeClass(i, i, 'pair'));
    return out;
  }

  // 非对子：大牌固定，小牌从当前值递增到「大牌下一位」
  for (let lo = loIdx; lo < hiIdx; lo++) out.push(makeClass(hiIdx, lo, kind));
  if (out.length === 0) throw new Error(`记法无法展开: "${token}"`);
  return out;
}

/** 展开 `XX-YY` 记法 */
function expandDash(spec: string, token: string): HandClass[] {
  const parts = spec.split('-');
  if (parts.length !== 2) throw new Error(`区间记法格式错误: "${token}"`);
  const a = parseHandClass(parts[0]);
  const b = parseHandClass(parts[1]);

  if (a.kind !== b.kind) throw new Error(`区间两端类型不一致: "${token}"`);

  if (a.kind === 'pair') {
    const lo = Math.min(a.hiIdx, b.hiIdx);
    const hi = Math.max(a.hiIdx, b.hiIdx);
    const out: HandClass[] = [];
    for (let i = lo; i <= hi; i++) out.push(makeClass(i, i, 'pair'));
    return out;
  }

  if (a.hiIdx !== b.hiIdx) throw new Error(`区间两端大牌不一致: "${token}"`);
  const lo = Math.min(a.loIdx, b.loIdx);
  const hi = Math.max(a.loIdx, b.loIdx);
  const out: HandClass[] = [];
  for (let i = lo; i <= hi; i++) out.push(makeClass(a.hiIdx, i, a.kind));
  return out;
}

/**
 * 解析紧凑范围记法，返回「手牌类别 -> 权重」。
 * 同一类别多次出现时取较大的权重。
 */
export function parseRange(notation: string): Map<HandClass, number> {
  const out = new Map<HandClass, number>();
  const trimmed = notation.trim();
  if (trimmed === '') return out;

  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;

    let spec = token;
    let weight = 1;

    const colon = token.indexOf(':');
    if (colon >= 0) {
      spec = token.slice(0, colon).trim();
      const weightStr = token.slice(colon + 1).trim();
      weight = Number(weightStr);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`权重必须是 [0,1] 内的数值: "${token}"`);
      }
    }

    let classes: HandClass[];
    if (spec.endsWith('+')) {
      classes = expandPlus(spec, token);
    } else if (spec.includes('-')) {
      classes = expandDash(spec, token);
    } else {
      parseHandClass(spec);   // 校验，非法会抛错
      classes = [spec];
    }

    for (const hc of classes) {
      const prev = out.get(hc);
      if (prev === undefined || weight > prev) out.set(hc, weight);
    }
  }

  return out;
}

/** 按 allHandClasses 的固定顺序输出，权重为 1 时省略。仅用于测试与调试。 */
export function formatRange(range: ReadonlyMap<HandClass, number>): string {
  const parts: string[] = [];
  for (const hc of allHandClasses()) {
    const w = range.get(hc);
    if (w === undefined) continue;
    parts.push(w === 1 ? hc : `${hc}:${w}`);
  }
  return parts.join(', ');
}
