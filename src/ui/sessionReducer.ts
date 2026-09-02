import type { ActionInput } from '../core/gameEngine';
import {
  applyHero,
  heroNeedsRebuy,
  nextHand,
  rebuyHero,
  stepAi,
  type HandSessionState,
  type SessionConfig,
} from '../session/handSession';

export type SessionAction =
  | { kind: 'stepAi'; cfg: SessionConfig }
  | { kind: 'hero'; input: ActionInput; cfg: SessionConfig }
  | { kind: 'nextHand'; cfg: SessionConfig }
  | { kind: 'rebuy'; targetStack: number };

/** Pure reducer: configuration is carried by actions instead of module state. */
export function sessionReducer(state: HandSessionState, action: SessionAction): HandSessionState {
  switch (action.kind) {
    case 'stepAi':
      return state.phase === 'aiToAct' ? stepAi(state, action.cfg) : state;
    case 'hero':
      return state.phase === 'awaitingHero' ? applyHero(state, action.input, action.cfg) : state;
    case 'nextHand':
      return state.phase === 'handOver' && !heroNeedsRebuy(state)
        ? nextHand(state, action.cfg)
        : state;
    case 'rebuy':
      return heroNeedsRebuy(state) ? rebuyHero(state, action.targetStack) : state;
  }
}
