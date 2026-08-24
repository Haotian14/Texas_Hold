import { describe, it, expect } from 'vitest';
import { startSession, stepAi, applyHero } from './handSession';
import type { HandSessionState, SessionConfig } from './handSession';
import { heroEquityNow } from './heroEquity';
import { HERO_SEAT } from '../core/types';
import { makeDeck, cardToString } from '../core/cards';

const cfg: SessionConfig = { seed: 'eq-test', iterations: 200, strengthIterations: 8 };

/** 推进到 hero 需要行动为止 */
function toHero(s: HandSessionState): HandSessionState {
  let cur = s;
  let guard = 0;
  while (cur.phase === 'aiToAct') {
    if (++guard > 60) throw new Error('推进失败：一直没轮到 hero');
    cur = stepAi(cur, cfg);
  }
  return cur;
}

describe('heroEquityNow', () => {
  it('轮到 hero 时给出 0..1 的胜率与对手数', () => {
    const s = toHero(startSession(cfg));
    expect(s.phase).toBe('awaitingHero');

    const eq = heroEquityNow(s, 400);
    expect(eq).not.toBeNull();
    expect(eq!.equity).toBeGreaterThan(0);
    expect(eq!.equity).toBeLessThan(1);
    // 对手数与局面里未弃牌的对手一致
    const alive = s.game.seats.filter(x => x.seat !== HERO_SEAT && !x.folded).length;
    expect(eq!.opponents).toBe(alive);
  });

  it('同一个局面重复调用给出逐位相同的数字', () => {
    // 界面每重渲染一次就重算一次，数字跳动的话读数毫无意义。
    // rng 由 seed + handIndex + stepIndex 派生，不含任何随渲染变化的量。
    const s = toHero(startSession(cfg));
    const a = heroEquityNow(s, 400);
    const b = heroEquityNow(s, 400);
    expect(a!.equity).toBe(b!.equity);
  });

  it('不是 hero 回合时返回 null，而不是 0', () => {
    // 返回 0 会被界面当成「你必输」渲染出来
    const s = startSession(cfg);
    expect(s.phase).toBe('aiToAct');
    expect(heroEquityNow(s)).toBeNull();
  });

  it('手牌结束后返回 null', () => {
    let s = toHero(startSession(cfg));
    let guard = 0;
    while (s.phase !== 'handOver') {
      if (++guard > 60) throw new Error('牌局没有结束');
      s = s.phase === 'awaitingHero' ? applyHero(s, { type: 'fold' }) : stepAi(s, cfg);
    }
    expect(heroEquityNow(s)).toBeNull();
  });

  it('不使用对手的实际底牌：把对手底牌换掉，胜率不变', () => {
    // 这是 ②-B-2 那条红线在牌桌侧的同一道闸。用对手真实底牌算出来的胜率
    // 是结果论——换掉底牌若结果跟着变，说明它读了不该读的东西。
    // 只换未弃牌对手的底牌，且避开 hero 底牌与公共牌，避免造出重复牌。
    const s = toHero(startSession(cfg));
    const base = heroEquityNow(s, 400);

    const used = new Set(
      [...s.game.board, ...s.game.seats[HERO_SEAT].holeCards].map(cardToString),
    );
    const spare = makeDeck().filter(c => !used.has(cardToString(c)));

    let k = 0;
    const swapped: HandSessionState = {
      ...s,
      game: {
        ...s.game,
        seats: s.game.seats.map(seat =>
          seat.seat === HERO_SEAT || seat.folded
            ? seat
            : { ...seat, holeCards: [spare[k++], spare[k++]] as typeof seat.holeCards },
        ),
      },
    };

    expect(heroEquityNow(swapped, 400)!.equity).toBe(base!.equity);
  });
});
