import type { Rng } from '../core/rng';

/**
 * AI 对手的性格参数。
 *
 * 这些倍率不改变局面的客观估值 —— EV 由 core/evEstimate 统一算出，
 * 性格只影响「拿到这组 EV 之后怎么选」。这样 AI 的世界观和复盘引擎的
 * 判定标准始终是同一个，差别只在偏好。
 */
export interface Persona {
  id: string;
  name: string;
  /** 相对 GTO 范围的宽窄倍率，>1 更宽 */
  rangeWidthMul: number;
  /** 主动下注/加注倾向，>1 更爱进攻 */
  aggression: number;
  /** 在 EV 不占优时仍然选进攻动作的概率 */
  bluffFreq: number;
  /** 跟注所需 EV 的倍率，<1 跟得更松 */
  callThresholdMul: number;
  /** 作为翻前加注者在翻牌圈持续下注的倾向 */
  cbetFreq: number;
}

/** 全部中性的原型，用于设置里的「全 GTO 模式」 */
export const GTO_PERSONA: Persona = {
  id: 'gto',
  name: '平衡',
  rangeWidthMul: 1,
  aggression: 1,
  bluffFreq: 0,
  callThresholdMul: 1,
  // 0.5 才是中性值：decide.ts 的 personaScore 用 (cbetFreq - 0.5) 算 c-bet
  // 加成，0.55 会让「全中性」的 GTO 原型在翻牌圈也拿到一个不为零的
  // c-bet 加成（+0.005×pot），与其它四项倍率都恰好中性的设计意图不符。
  cbetFreq: 0.5,
};

export const PERSONAS: readonly Persona[] = [
  GTO_PERSONA,
  { id: 'tag',     name: '紧凶',   rangeWidthMul: 0.85, aggression: 1.25, bluffFreq: 0.12, callThresholdMul: 1.15, cbetFreq: 0.70 },
  { id: 'lag',     name: '松凶',   rangeWidthMul: 1.45, aggression: 1.40, bluffFreq: 0.28, callThresholdMul: 0.95, cbetFreq: 0.75 },
  { id: 'station', name: '跟注站', rangeWidthMul: 1.60, aggression: 0.55, bluffFreq: 0.03, callThresholdMul: 0.55, cbetFreq: 0.30 },
  { id: 'rock',    name: '岩石',   rangeWidthMul: 0.55, aggression: 0.80, bluffFreq: 0.02, callThresholdMul: 1.45, cbetFreq: 0.50 },
  { id: 'maniac',  name: '疯子',   rangeWidthMul: 1.90, aggression: 1.85, bluffFreq: 0.45, callThresholdMul: 0.75, cbetFreq: 0.85 },
];

export function getPersona(id: string): Persona {
  const p = PERSONAS.find(x => x.id === id);
  if (!p) throw new Error(`未知的性格原型: "${id}"`);
  return p;
}

/**
 * 给每个座位分配一个性格原型。hero 的座位固定为 'hero'，
 * 因为 hero 由人操作，没有 AI 性格。
 *
 * 座位与原型的绑定在一手牌内保持不变 —— 调用方每手牌调用一次即可。
 */
export function assignPersonas(
  seats: readonly number[],
  rng: Rng,
  heroSeat: number,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const seat of seats) {
    if (seat === heroSeat) {
      out.set(seat, 'hero');
      continue;
    }
    out.set(seat, PERSONAS[rng.nextInt(PERSONAS.length)].id);
  }
  return out;
}
