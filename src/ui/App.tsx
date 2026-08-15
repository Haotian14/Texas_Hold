import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ActionInput } from '../core/gameEngine';
import { HERO_SEAT } from '../core/types';
import {
  startSession,
  stepAi,
  applyHero,
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  isDeepStackHand,
} from '../session/handSession';
import type { HandSessionState, SessionConfig } from '../session/handSession';
import { heroNet } from '../session/ledger';
import { actionBarModel } from '../session/actionBarModel';
import { TopBar } from './components/TopBar';
import { Table } from './components/Table';
import { HeroHand } from './components/HeroHand';
import { ActionBar } from './components/ActionBar';

const CFG: SessionConfig = {
  // 每次刷新换一局。③-C 会把 seed 一并持久化，届时刷新可续上。
  seed: `s${Date.now()}`,
  now: Date.now,
};

/** AI 思考延迟区间（毫秒）。极速模式在 ③-D 的设置里接通 */
const THINK_MIN = 300;
const THINK_MAX = 600;

type Action =
  | { kind: 'stepAi' }
  | { kind: 'hero'; input: ActionInput }
  | { kind: 'nextHand' }
  | { kind: 'rebuy'; targetStack: number };

function reducer(s: HandSessionState, a: Action): HandSessionState {
  switch (a.kind) {
    case 'stepAi':
      // StrictMode 下 effect 会双跑，这个守卫让第二次成为无操作。
      // stepAi 本身也是幂等的（派生 seed，不存有状态 Rng），
      // 两道保险都要有：守卫防的是状态被推进两步。
      return s.phase === 'aiToAct' ? stepAi(s, CFG) : s;
    case 'hero':
      return s.phase === 'awaitingHero' ? applyHero(s, a.input, CFG) : s;
    case 'nextHand':
      return s.phase === 'handOver' && !heroNeedsRebuy(s) ? nextHand(s, CFG) : s;
    case 'rebuy':
      return heroNeedsRebuy(s) ? rebuyHero(s, a.targetStack) : s;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, CFG, startSession);

  // 时间只存在于这一层：会话层没有 setTimeout、没有 async。
  // 延迟值由 seed 与步数派生，使同一局的节奏也是可复现的。
  useEffect(() => {
    if (state.phase !== 'aiToAct') return;
    const span = THINK_MAX - THINK_MIN;
    const jitter = (state.handIndex * 7919 + state.stepIndex * 104729) % (span + 1);
    const id = setTimeout(() => dispatch({ kind: 'stepAi' }), THINK_MIN + jitter);
    return () => clearTimeout(id);
  }, [state.phase, state.handIndex, state.stepIndex]);

  const hero = state.game.seats[HERO_SEAT];
  const netBB = useMemo(
    () => heroNet(state.ledger, state.stacks[HERO_SEAT]),
    [state.ledger, state.stacks],
  );
  const revealed =
    state.phase === 'handOver' &&
    (state.record?.results.some(r => r.showdown) ?? false);

  const onHero = useCallback((input: ActionInput) => dispatch({ kind: 'hero', input }), []);
  const onNext = useCallback(() => dispatch({ kind: 'nextHand' }), []);
  const onRebuy = useCallback(
    (targetStack: number) => dispatch({ kind: 'rebuy', targetStack }),
    [],
  );

  return (
    <div className="app">
      <TopBar
        handsPlayed={state.ledger.handsPlayed}
        netBB={netBB}
        totalBuyIn={state.ledger.totalBuyIn}
        deepStack={isDeepStackHand(state)}
      />
      <Table game={state.game} lastAction={state.lastAction} revealed={revealed} />
      <HeroHand seat={hero} isButton={state.game.buttonSeat === HERO_SEAT} />
      <BottomSlot state={state} onHero={onHero} onNext={onNext} onRebuy={onRebuy} />
    </div>
  );
}

/** 底部区域：Task 9 接动作条，Task 10 接结算条与补码 */
function BottomSlot({
  state,
  onHero,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
}) {
  const model = actionBarModel(state.game);
  return (
    <div className="bottom">
      <ActionBar model={model} onAction={onHero} />
    </div>
  );
}
