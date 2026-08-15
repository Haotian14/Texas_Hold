import type { ActionInput } from '../core/gameEngine';
import { createRng } from '../core/rng';
import { decide } from '../ai/decide';
import type { HandSessionState, SessionConfig } from './handSession';

/**
 * 测试用的脚本化 hero：用 EV 引擎以 GTO 原型代打。
 *
 * 刻意不用「总是跟注」这类退化脚本 —— 退化脚本永远走不到加注与全下
 * 路径，而那正是动作合法性最容易出错的地方。decide 内部已把 'hero'
 * 映射到 GTO_PERSONA，直接调用即可。
 */
export function scriptedHeroAction(s: HandSessionState, cfg: SessionConfig): ActionInput {
  const d = decide(s.game, {
    ranges: new Map(s.ranges),
    personaIds: new Map(s.personaIds),
    rng: createRng(`${cfg.seed}-hero-h${s.handIndex}-s${s.stepIndex}`),
    iterations: cfg.iterations,
    strengthIterations: cfg.strengthIterations,
  });
  return d.action;
}
