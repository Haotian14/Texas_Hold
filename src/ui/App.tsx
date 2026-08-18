import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { ActionInput } from '../core/gameEngine';
import { HERO_SEAT } from '../core/types';
import { chipsGreater, round2 } from '../core/chips';
import { playSound, soundFor, isMuted, setMuted, unlockAudio } from './sound';
import {
  startSession,
  stepAi,
  applyHero,
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  isDeepStackHand,
  REBUY_OPTIONS,
} from '../session/handSession';
import type { HandSessionState, SessionConfig } from '../session/handSession';
import { heroNet } from '../session/ledger';
import { actionBarModel } from '../session/actionBarModel';
import { TopBar } from './components/TopBar';
import { Table } from './components/Table';
import { HeroHand } from './components/HeroHand';
import { ActionBar } from './components/ActionBar';
import { SummaryBar } from './components/SummaryBar';
import { RebuyPrompt } from './components/RebuyPrompt';
import { analyzeHand } from '../review/analyzeHand';
import type { HandAnalysis } from '../review/types';
import { handGrade } from './reviewModel';
import { ReviewSheet } from './components/ReviewSheet';
import { ReviewTrigger, type ReviewStatus } from './components/ReviewTrigger';

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

  const [muted, setMutedState] = useState(isMuted);

  // 复盘分析与它属于哪一手绑在一起。只要 recordId 与屏幕上这一手对不上，
  // 就当作「还没算好」—— 这是「连打十手不串手」那条验收的唯一防线。
  // analysis 为 null 表示这一手分析失败（见下面的 catch）。
  const [review, setReview] = useState<{ recordId: string; analysis: HandAnalysis | null } | null>(
    null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  const onToggleMute = useCallback(() => {
    setMutedState(prev => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  // 浏览器在用户第一次手势前不允许播放音频。任何一次点击都算手势，
  // 所以挂在根节点上捕获一次就够，之后自行解绑。
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // 时间只存在于这一层：会话层没有 setTimeout、没有 async。
  // 延迟值只由 handIndex 与 stepIndex 派生（不读 CFG.seed），同一局内每一步
  // 的节奏因此是确定、可复现的；但换一次 seed（刷新页面）不会让延迟序列变化，
  // 它不是随 seed 变化的随机量。
  useEffect(() => {
    if (state.phase !== 'aiToAct') return;
    const span = THINK_MAX - THINK_MIN;
    const jitter = (state.handIndex * 7919 + state.stepIndex * 104729) % (span + 1);
    const id = setTimeout(() => dispatch({ kind: 'stepAi' }), THINK_MIN + jitter);
    return () => clearTimeout(id);
  }, [state.phase, state.handIndex, state.stepIndex]);

  // hero 座位的筹码显示来源要按 phase 二选一，两个来源在不同阶段各只有
  // 一个是新鲜的：
  // - 手牌进行中（aiToAct / awaitingHero）：state.stacks 是「本手开局时」
  //   的快照，advance() 的结算分支才会回写它，非结算分支原样透传
  //   `...s`，所以手牌进行中它不随动作更新，只有 state.game.seats 才是
  //   实时值。
  // - 手牌结束后（handOver）：state.game 在补码（rebuyHero）时不会被
  //   触碰，只有 state.stacks 会更新，所以结算后要改看 state.stacks，
  //   否则补码后屏幕仍显示补码前的筹码。
  const hero =
    state.phase === 'handOver'
      ? { ...state.game.seats[HERO_SEAT], stack: state.stacks[HERO_SEAT] }
      : state.game.seats[HERO_SEAT];
  const netBB = useMemo(
    () => heroNet(state.ledger, state.stacks[HERO_SEAT]),
    [state.ledger, state.stacks],
  );
  const revealed =
    state.phase === 'handOver' &&
    (state.record?.results.some(r => r.showdown) ?? false);

  // 本手已结束且 hero 净盈亏为正 —— 触发底池的赢池脉冲
  const heroWon =
    state.phase === 'handOver' &&
    chipsGreater(state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0, 0);

  // 动作音：以 stepIndex 为单调 key。用它而不是 lastAction 本身作依赖，
  // 是因为两个相邻动作可能完全相同（例如连续两个 fold），对象比较会漏播。
  // 必须先判 lastAction 存在——新一手开局时 stepIndex 也会变，但那一刻
  // 没有动作，不判会把上一手的残留动作重播一次。
  // 依赖数组刻意只放 stepIndex，不放 state.lastAction / state.game：
  // 这个 effect 要的是「步进了一次」这个事件，不是「这些对象变了」。
  // 本项目没有 eslint，不需要写 disable 注释；这条注释才是给人看的。
  useEffect(() => {
    const a = state.lastAction;
    if (!a) return;
    // state.game 的 totalContribution 已经含了本次动作的投入（gameEngine 在
    // applyAction 内部就累加了），而轻/重的判据要的是**决策时**的底池。
    // Action.amount 记的正是本次实际投入额，减掉即得动作前的底池——
    // 不减的话判据会退化成 amount ≥ potBefore，也就是「满池下注才算重」。
    const potAfter = state.game.seats.reduce((sum, s) => sum + s.totalContribution, 0);
    const pot = round2(potAfter - a.amount);
    playSound(soundFor(a.type, a.amount, pot));
  }, [state.stepIndex]);

  // 公共牌翻开。依赖只放长度——牌面对象每手都会换新，放进依赖会每手多响一次
  useEffect(() => {
    if (state.game.board.length === 0) return;
    playSound('board-flip');
  }, [state.game.board.length]);

  // 新一手开局发牌。第一手不会响——那时用户还没做过任何手势，
  // 浏览器不允许播放。这是自动播放策略的必然结果，不特殊处理。
  useEffect(() => {
    playSound('deal-card');
  }, [state.handIndex]);

  // hero 赢下底池
  useEffect(() => {
    if (heroWon) playSound('pot-win');
  }, [heroWon]);

  // 手牌结束后算复盘。analyzeHand 每手约 25–200ms，够快，不需要 Worker，
  // 但仍会占住主线程 —— 用 setTimeout 让出当前这一帧，先把 ③-A 的赢池
  // 脉冲放完再算。
  //
  // 依赖只放 record?.id：record 对象每手都是新引用，放它本身会多跑一遍；
  // 而 id 变了才真的是换了一手。
  const recordId = state.record?.id ?? null;
  useEffect(() => {
    const rec = state.record;
    if (rec === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        const analysis = analyzeHand(rec);
        if (!cancelled) setReview({ recordId: rec.id, analysis });
      } catch {
        // 复盘算不出来不该掀掉牌桌 —— 记成「这一手分析失败」，牌局继续。
        if (!cancelled) setReview({ recordId: rec.id, analysis: null });
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recordId]);

  // 新一手开始就关掉卡片
  useEffect(() => {
    setSheetOpen(false);
  }, [state.handIndex]);

  const onHero = useCallback((input: ActionInput) => dispatch({ kind: 'hero', input }), []);
  const onNext = useCallback(() => dispatch({ kind: 'nextHand' }), []);
  const onRebuy = useCallback(
    (targetStack: number) => dispatch({ kind: 'rebuy', targetStack }),
    [],
  );

  // 只认属于当前这一手的分析
  const currentReview = review !== null && review.recordId === recordId ? review : null;
  const currentAnalysis = currentReview?.analysis ?? null;
  // 三态，不是 grade|null：见 ReviewTrigger 里 ReviewStatus 的注释。
  // currentReview 为 null = 还没算好；算好了但 analysis 为 null = 算失败了。
  const reviewStatus: ReviewStatus =
    currentReview === null
      ? { kind: 'pending' }
      : currentReview.analysis === null
        ? { kind: 'failed' }
        : { kind: 'ready', grade: handGrade(currentReview.analysis).grade };

  // 本手 hero 净盈亏。**与上面第 112 行那个 netBB 不是一回事** —— 那个是
  // 整局累计（heroNet(ledger, stack)），这个是这一手。同一个作用域里两个
  // 同名概念很容易被后来的人「顺手简化」成一个，所以这里显式另起名字。
  const handNetBB = state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0;

  const onOpenSheet = useCallback(() => setSheetOpen(true), []);
  const onCloseSheet = useCallback(() => setSheetOpen(false), []);
  const onNextFromSheet = useCallback(() => {
    setSheetOpen(false);
    dispatch({ kind: 'nextHand' });
  }, []);

  return (
    <div className="app">
      <TopBar
        handsPlayed={state.ledger.handsPlayed}
        inProgress={state.phase !== 'handOver'}
        netBB={netBB}
        totalBuyIn={state.ledger.totalBuyIn}
        deepStack={isDeepStackHand(state)}
        muted={muted}
        onToggleMute={onToggleMute}
      />
      <Table
        game={state.game}
        lastAction={state.lastAction}
        revealed={revealed}
        heroWon={heroWon}
      />
      <HeroHand seat={hero} isButton={state.game.buttonSeat === HERO_SEAT} />
      <BottomSlot
        state={state}
        onHero={onHero}
        onNext={onNext}
        onRebuy={onRebuy}
        reviewStatus={reviewStatus}
        onOpenReview={onOpenSheet}
      />
      {/* pending 时按钮是禁用的，走不到这里；failed 时 currentAnalysis 为
          null，卡片壳照开，body 显示「本手复盘失败」——见 Step 0。 */}
      {sheetOpen && currentReview !== null && state.record !== null ? (
        <ReviewSheet
          analysis={currentAnalysis}
          record={state.record}
          netBB={handNetBB}
          onNext={onNextFromSheet}
          onClose={onCloseSheet}
        />
      ) : null}
    </div>
  );
}

/** 底部区域：动作条、结算条、补码选择三态互斥 */
function BottomSlot({
  state,
  onHero,
  onNext,
  onRebuy,
  reviewStatus,
  onOpenReview,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
  reviewStatus: ReviewStatus;
  onOpenReview: () => void;
}) {
  if (state.phase === 'handOver') {
    // 复盘按钮在两个结算形态下都要在 —— hero 破产那一手底部显示的是
    // RebuyPrompt，而那恰恰是最该复盘的一手。
    const trigger = <ReviewTrigger status={reviewStatus} onOpen={onOpenReview} />;

    if (heroNeedsRebuy(state)) {
      return (
        <div className="bottom">
          {trigger}
          <RebuyPrompt
            options={REBUY_OPTIONS}
            buyInCount={state.ledger.buyIns.length}
            totalBuyIn={state.ledger.totalBuyIn}
            onRebuy={onRebuy}
          />
        </div>
      );
    }
    const netBB = state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0;
    const showdown = state.record?.results.some(r => r.showdown) ?? false;
    return (
      <div className="bottom">
        {trigger}
        <SummaryBar netBB={netBB} showdown={showdown} onNext={onNext} />
      </div>
    );
  }

  const model = actionBarModel(state.game);
  return (
    <div className="bottom">
      <ActionBar model={model} onAction={onHero} />
    </div>
  );
}
