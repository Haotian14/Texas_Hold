import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { ActionInput } from '../core/gameEngine';
import { HERO_SEAT } from '../core/types';
import { chipsGreater, round2 } from '../core/chips';
import { playSound, soundFor, unlockAudio } from './sound';
import {
  startSession,
  heroNeedsRebuy,
  isDeepStackHand,
  REBUY_OPTIONS,
} from '../session/handSession';
import type { HandSessionState, SessionConfig } from '../session/handSession';
import { heroNet } from '../session/ledger';
import { actionBarModel } from '../session/actionBarModel';
import { heroEquityNow } from '../session/heroEquity';
import type { HeroEquity } from '../session/heroEquity';
import { TopBar } from './components/TopBar';
import { Table } from './components/Table';
import { HeroHand } from './components/HeroHand';
import { ActionBar } from './components/ActionBar';
import { SummaryBar } from './components/SummaryBar';
import { RebuyPrompt } from './components/RebuyPrompt';
import { analyzeHand } from '../review/analyzeHand';
import { viewOf } from '../review/view';
import type { HandView } from '../review/view';
import { saveHand, loadStats, storageStatus, setDisputed } from '../storage/repo';
import { requestPersistence } from '../storage/db';
import type { Stats } from '../storage/stats';
import { handGrade } from './reviewModel';
import { opponentsRevealed } from './tableModel';
import { ReviewTrigger, type ReviewStatus } from './components/ReviewTrigger';
import { Nav, type PageId } from './components/Nav';
import { HistoryPage } from './pages/HistoryPage';
import { ReviewPage } from './pages/ReviewPage';
import { ReportPage } from './pages/ReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { HandRanksPage } from './pages/HandRanksPage';
import type { StoredHand } from '../storage/schema';
import type { HandRecord } from '../core/types';
import { sessionReducer } from './sessionReducer';
import { useAppPreferences, VIBRATE_MS } from './hooks/useAppPreferences';

/**
 * 复盘页当前在看哪一手。
 *
 * 'live' 不是「当前这一手」而是「最近打完的那一手」—— 新一手开局后
 * state.record 会被置 null（见 handSession.beginHand），若复盘页跟着它走，
 * 用户点导航进复盘会看到一片空白。所以刚算完的 record 由本组件自己留一份
 * （下面的 review 状态），它比 state.record 活得久一手。
 */
type ReviewTarget = { kind: 'live' } | { kind: 'stored'; hand: StoredHand };

const CFG: SessionConfig = {
  // 正常使用每次刷新换一局；E2E 通过构建环境注入固定 seed，验证刷新可复现。
  seed: import.meta.env.VITE_FIXED_SEED?.trim() || `s${Date.now()}`,
  now: Date.now,
};

/** AI 思考延迟区间（毫秒）。设置页的「极速模式」把它整段跳过 */
const THINK_MIN = 300;
const THINK_MAX = 600;

export function App() {
  const {
    aiMode,
    autoReview,
    bgm,
    fastMode,
    muted,
    showEquity,
    vibrate,
    onSetAiMode,
    onSetAutoReview,
    onSetBgm,
    onSetFastMode,
    onSetMuted,
    onSetShowEquity,
    onSetVibrate,
    onToggleEquity,
    onToggleMute,
  } = useAppPreferences();

  // 每次渲染算一份 cfg 交给 dispatch。aiMode 变了就是一份新的 cfg，
  // 下一次 nextHand 才会用上——beginHand 是唯一读它的地方，所以切模式
  // 天然是「下一手生效」，不会在一手打到一半时换掉对手的性格。
  const cfg = useMemo<SessionConfig>(() => ({ ...CFG, aiMode }), [aiMode]);

  // 初始化也吃 cfg，不能图省事传模块里那份 CFG：上次存下的 aiMode 要在
  // **刷新后的第一手**就生效，传 CFG 的话第一手永远是随机原型池，只有从
  // 第二手起才对——一个只在第一手错的 bug，正是最难被看见的那种。
  // useReducer 的第二个参数只在首次渲染用，之后 cfg 再变也不会重新初始化。
  const [state, dispatch] = useReducer(sessionReducer, cfg, startSession);
  /**
   * 算好的胜率。与它属于哪一步绑在一起（handIndex + stepIndex）——不绑的话，
   * 上一步算出来的数会在新局面上多显示一帧，而那一帧里它是错的。
   * 这与复盘结果绑 recordId 是同一个理由。
   */
  const [equity, setEquity] = useState<{ key: string; value: HeroEquity | null } | null>(null);

  // 复盘分析与它属于哪一手绑在一起。只要 recordId 与屏幕上这一手对不上，
  // 就当作「还没算好」—— 这是「连打十手不串手」那条验收的唯一防线。
  // view 为 null 表示这一手分析失败（见下面的 catch）。
  // 存的是 HandView 而不是 HandAnalysis：后者带着对手范围（ReadonlyMap，序列化
  // 会静默变空）与一个共享对象引用，落不了库。让界面从一开始就只碰视图类型，
  // 「刚算完的」与「从库里取回来的」才是同一条渲染路径。见 review/view.ts。
  // 连同 record 一起存（不只是 recordId）：复盘页要在新一手开局之后仍然
  // 显示上一手，而那时 state.record 已经是 null 了。
  const [review, setReview] = useState<{ record: HandRecord; view: HandView | null } | null>(null);
  const [page, setPage] = useState<PageId>('table');
  // 复盘页在看哪一手。从历史点开的那一手与「刚打完这一手」走同一个 ReviewPage——
  // 两者都吃 HandRecord + HandView（见 review/view.ts），这正是当初让视图类型
  // 同时充当落库 DTO 的收益：历史里的手不需要任何"复原"步骤就能渲染。
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>({ kind: 'live' });
  /**
   * 历史列表里被改过的那一手，贴回列表用。
   *
   * 与 historyHand 分开存：那个在关卡片时会置 null，而这个必须留着——
   * 否则用户标完「我不认同」一关卡片，列表上那一行又变回没标记的样子，
   * 看起来像没保存。只保留最后改的一手：一次会话里连改几手是少数情况，
   * 而每改一手就整列重取会把「加载更多」翻出来的页全丢掉。
   */
  const [patchedHand, setPatchedHand] = useState<StoredHand | null>(null);
  /**
   * 「这一手我不认同」——只针对刚打完、还开在牌桌上的那一手。
   *
   * 存本地状态而不是每次去库里读：这一手刚写进去，值必然是 false，为一个
   * 必然已知的值多做一次事务往返没有意义。id 跟着 recordId 走，换手自然失效。
   */
  const [disputedNow, setDisputedNow] = useState<{ id: string; value: boolean } | null>(null);

  // 累计统计。开局读一次，之后每手写完由 saveHand 的返回值推进——
  // 不每次回库重读：那份文档只有本页在写（多标签页的取舍见 repo.ts 的注释）。
  const [stats, setStats] = useState<Stats | null>(null);
  // 落库是否可用。隐私模式、配额满、存储被禁用都会让它变 false，
  // 此时牌局照常，只是历史与统计不再累积——这一点必须让用户看得见，
  // 否则他会以为自己打的手都被记着了。
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    // 先申请持久化再读统计。默认的 IndexedDB 是 best-effort，浏览器可以在
    // 磁盘紧张时把整份数据丢掉且不通知任何人——对一个专门存历史的应用，
    // 那等于用户几百手记录随时可能蒸发。申请不到也不影响启动。
    void requestPersistence();
    void loadStats().then(s => {
      setStats(s);
      setStorageOk(storageStatus() !== 'unavailable');
    });
  }, []);

  /** 重置数据之后：统计归零、存储状态重新问一次。当前这局照常继续 */
  const onDataReset = useCallback(() => {
    void loadStats().then(st => {
      setStats(st);
      setStorageOk(storageStatus() !== 'unavailable');
    });
  }, []);

  /**
   * 算胜率。与复盘那次分析走同一套路数：蒙特卡洛是同步的，直接在渲染里算
   * 会把「轮到你了」那一帧卡住，用 setTimeout 让出一帧再算。
   *
   * 只在开关打开且轮到 hero 时算 —— 关着的时候一次都不算，这个功能对没开
   * 它的人是零成本。取消逻辑保证用户连点两下（或 StrictMode 双跑）时不会
   * 有一个过期的结果后到并覆盖新的。
   */
  const equityKey = `${state.handIndex}-${state.stepIndex}`;
  useEffect(() => {
    if (!showEquity || state.phase !== 'awaitingHero') {
      setEquity(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      let value: HeroEquity | null = null;
      try {
        value = heroEquityNow(state);
      } catch {
        // 算不出来不该掀掉牌桌：读数消失即可，牌局继续
        value = null;
      }
      if (!cancelled) setEquity({ key: equityKey, value });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // state 整体不进依赖：它每步都是新引用，而这一步该不该重算由
    // equityKey（handIndex + stepIndex）决定，那才是"局面变了"的判据。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEquity, state.phase, equityKey]);

  // 键对不上就当作"还没算好"，不显示上一步的数
  const shownEquity = equity !== null && equity.key === equityKey ? equity.value : null;

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
    // 极速模式把整段延迟跳过（0ms），而不是把 THINK_MIN 调小：这里要的是
    // 「立刻」，留一个小延迟只会变成另一个需要解释的魔法数字。
    const delay = fastMode ? 0 : THINK_MIN + jitter;
    const id = setTimeout(() => dispatch({ kind: 'stepAi', cfg }), delay);
    return () => clearTimeout(id);
  }, [state.phase, state.handIndex, state.stepIndex, fastMode, cfg]);

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
  // 何时亮对手底牌（hero 弃牌后 / 摊牌后）的规则在 tableModel，那边有用例。
  const revealed = opponentsRevealed(state);

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

  // 轮到 hero 行动时震一下。手机上应用常在后台或屏幕没在看，声音又可能
  // 是关的——震动是唯一还能把人叫回来的信号。
  // iOS Safari 没有 Vibration API，可选链在那里直接是无操作（设置页也不会
  // 显示这一项，见 SettingsPage 的 canVibrate）。
  useEffect(() => {
    if (!vibrate || state.phase !== 'awaitingHero') return;
    navigator.vibrate?.(VIBRATE_MS);
  }, [vibrate, state.phase, state.handIndex, state.stepIndex]);


  // 手牌结束后算复盘。analyzeHand 每手约 25–200ms，够快，不需要 Worker，
  // 但仍会占住主线程 —— 用 setTimeout 让出**结算这一帧**再算。
  //
  // 注意它让出的只有一帧：③-A 的赢池脉冲是 600ms 的 box-shadow 动画
  // （pot-win-pulse），box-shadow 不走合成层，每帧都在主线程重绘。所以
  // 这个 0 延时只保证结算帧本身不掉，脉冲的后半段仍可能被 analyzeHand
  // 的同步阻塞吃掉一截。若浏览器验收时看到脉冲卡顿，把延时提到 600ms；
  // 但那会让复盘按钮每手都晚 600ms 才可点，别在没观察到卡顿前就改。
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
      let view: HandView | null = null;
      try {
        view = viewOf(analyzeHand(rec));
      } catch {
        // 复盘算不出来不该掀掉牌桌 —— 记成「这一手分析失败」，牌局继续。
        view = null;
      }
      if (!cancelled) setReview({ record: rec, view });
      // 落库。故意**不**受 cancelled 影响：cancelled 只表示"这一手的分析结果
      // 已经没人要显示了"（用户翻到了下一手），不表示"这一手不该被记下来"。
      // 写入失败一律吞掉——storageStatus() 表达失败，牌局继续。
      // 分析失败（view 为 null）的那一手照样存：record 是完整的，规则修好后
      // 能重跑；因为分析失败就不存，等于把最值得看的那一手永久丢掉。
      void saveHand(rec, view).then(out => {
        setStats(out.stats);
        setStorageOk(out.ok);
        // 写进去了才谈得上标记；写失败的那一手没有可标的对象
        if (out.ok) setDisputedNow({ id: rec.id, value: false });
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recordId]);

  // 结算后自动打开复盘。等的是**分析算完**（currentReview 非空）而不是
  // phase 变成 handOver：后者一到就跳页，用户会先看到一个「正在分析」的
  // 空壳，还错过了结算区的赢池动画。
  // 只在牌桌页跳：用户此刻要是正在报表或设置页翻东西，把他拽走是抢方向盘。
  useEffect(() => {
    if (!autoReview || state.phase !== 'handOver') return;
    if (page !== 'table') return;
    if (review === null || review.record.id !== recordId) return;
    setReviewTarget({ kind: 'live' });
    setPage('review');
    // review 整体不进依赖：它每手都是新对象，靠 recordId 判断「换手了没」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReview, state.phase, page, recordId, review !== null]);

  const onHero = useCallback(
    (input: ActionInput) => dispatch({ kind: 'hero', input, cfg }),
    [cfg],
  );
  const onNext = useCallback(() => dispatch({ kind: 'nextHand', cfg }), [cfg]);
  const onRebuy = useCallback(
    (targetStack: number) => dispatch({ kind: 'rebuy', targetStack }),
    [],
  );

  // 只认属于当前这一手的分析（结算区那颗按钮上的色点必须说的是**这一手**）
  const currentReview = review !== null && review.record.id === recordId ? review : null;
  // 三态，不是 grade|null：见 ReviewTrigger 里 ReviewStatus 的注释。
  // currentReview 为 null = 还没算好；算好了但 view 为 null = 算失败了。
  const reviewStatus: ReviewStatus =
    currentReview === null
      ? { kind: 'pending' }
      : currentReview.view === null
        ? { kind: 'failed' }
        : (() => {
            const g = handGrade(currentReview.view);
            return { kind: 'ready', grade: g.grade, text: g.text };
          })();

  // 本手 hero 净盈亏。**与本函数上方那个 netBB 不是一回事** —— 那个是整局
  // 累计（heroNet(ledger, stack)），这个是这一手。同一个作用域里两个同名
  // 概念很容易被后来的人「顺手简化」成一个，所以这里显式另起名字。
  const handNetBB = state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0;

  // 破产那一手开不了下一手：reducer 拦着（App 的 nextHand 分支），
  // handSession.nextHand 更是直接抛。卡片底部那颗按钮必须跟着改口径，
  // 否则它写着「下一手」却什么也不做 —— 而破产恰恰是独立复盘按钮
  // 被设计出来的那一手。
  const needsRebuy = heroNeedsRebuy(state);

  // 结算区那颗按钮不再弹卡片：切到复盘页，并把它指回「刚打完这一手」——
  // 用户可能上一次看的是历史里翻出来的某一手，不重置的话点了会看到别的手。
  const onOpenReview = useCallback(() => {
    setReviewTarget({ kind: 'live' });
    setPage('review');
  }, []);

  const onOpenHistoryHand = useCallback((h: StoredHand) => {
    setReviewTarget({ kind: 'stored', hand: h });
    setPage('review');
  }, []);
  const onAllHands = useCallback(() => setPage('history'), []);
  const onBackToTable = useCallback(() => setPage('table'), []);
  // 设置从导航项变成了右上角的齿轮（见 QuickToggles），入口挂在这里
  const onOpenSettings = useCallback(() => setPage('settings'), []);
  const onOpenHandRanks = useCallback(() => setPage('handRanks'), []);

  // 复盘页要显示的那一手。stored 优先——它是用户明确点开的
  const storedTarget = reviewTarget.kind === 'stored' ? reviewTarget.hand : null;
  const shownRecord = storedTarget !== null ? storedTarget.record : (review?.record ?? null);
  const shownView = storedTarget !== null ? storedTarget.view : (review?.view ?? null);

  // 「下一手」只在看的正是**当前这一手**、且这一手已经打完、且不需要补码时
  // 才是一个真动作。历史里翻出来的手没有下一手可开，破产那一手也开不了
  // （reducer 拦着，handSession.nextHand 更是直接抛）——那两种情况下按钮
  // 必须改口径，否则它写着「下一手」却什么也不做。
  const canNext =
    storedTarget === null &&
    review !== null &&
    review.record.id === recordId &&
    state.phase === 'handOver' &&
    !needsRebuy;
  const onPrimary = useCallback(() => {
    // 先回牌桌再推进：留在复盘页会立刻变成「还没有打完的手牌」的空态
    setPage('table');
    if (canNext) dispatch({ kind: 'nextHand', cfg });
  }, [canNext, cfg]);

  // 只认属于**正在显示的那一手**的标记状态，与 currentReview 同一个口径
  const disputedForLive =
    review !== null && disputedNow !== null && disputedNow.id === review.record.id
      ? disputedNow.value
      : null;
  const shownDisputed = storedTarget !== null ? storedTarget.disputed : disputedForLive;

  const onToggleDisputedNow = useCallback(() => {
    if (review === null || disputedNow === null || disputedNow.id !== review.record.id) return;
    const next = !disputedNow.value;
    // 先改界面再写库：这是个纯标注，写失败的代价只是下次打开时它变回去，
    // 而让按钮等一次事务往返才响应，手感上像卡住了。失败时回滚并提示。
    setDisputedNow({ id: disputedNow.id, value: next });
    void setDisputed(disputedNow.id, next).then(ok => {
      if (!ok) {
        setDisputedNow({ id: disputedNow.id, value: !next });
        setStorageOk(false);
      }
    });
  }, [disputedNow, review]);

  const onToggleDisputedStored = useCallback(() => {
    if (reviewTarget.kind !== 'stored') return;
    const next = { ...reviewTarget.hand, disputed: !reviewTarget.hand.disputed };
    setReviewTarget({ kind: 'stored', hand: next });
    setPatchedHand(next);
    void setDisputed(next.id, next.disputed).then(ok => {
      if (ok) return;
      const rolled = { ...next, disputed: !next.disputed };
      // 回滚时先确认页面还停在这一手上：用户可能已经翻到了别的手
      setReviewTarget(t => (t.kind === 'stored' && t.hand.id === rolled.id ? { kind: 'stored', hand: rolled } : t));
      setPatchedHand(rolled);
      setStorageOk(false);
    });
  }, [reviewTarget]);

  const onToggleDisputed = storedTarget !== null ? onToggleDisputedStored : onToggleDisputedNow;

  return (
    <div className="app">
      <Nav page={page} onNav={setPage} />
      <div className="app-main">
        {page === 'history' ? (
          <HistoryPage onOpen={onOpenHistoryHand} patched={patchedHand} />
        ) : page === 'review' ? (
          <ReviewPage
            record={shownRecord}
            view={shownView}
            disputed={shownDisputed}
            onToggleDisputed={onToggleDisputed}
            onAllHands={onAllHands}
            onPrimary={onPrimary}
            primaryLabel={canNext ? '下一手' : '回到牌桌'}
            onSettings={onOpenSettings}
            onHandRanks={onOpenHandRanks}
          />
        ) : page === 'report' ? (
          <ReportPage onSettings={onOpenSettings} onHandRanks={onOpenHandRanks} />
        ) : page === 'handRanks' ? (
          <HandRanksPage onSettings={onOpenSettings} />
        ) : page === 'settings' ? (
          <SettingsPage
            aiMode={aiMode}
            onAiMode={onSetAiMode}
            fastMode={fastMode}
            onFastMode={onSetFastMode}
            vibrate={vibrate}
            onVibrate={onSetVibrate}
            autoReview={autoReview}
            onAutoReview={onSetAutoReview}
            showEquity={showEquity}
            onShowEquity={onSetShowEquity}
            muted={muted}
            onMuted={onSetMuted}
            bgm={bgm}
            onBgm={onSetBgm}
            onDataReset={onDataReset}
          />
        ) : (
          <>
            <TopBar
              handsPlayed={state.ledger.handsPlayed}
              inProgress={state.phase !== 'handOver'}
              deepStack={isDeepStackHand(state)}
              storageOk={storageOk}
              netBB={netBB}
              muted={muted}
              onToggleMute={onToggleMute}
              showEquity={showEquity}
              onToggleEquity={onToggleEquity}
              onSettings={onOpenSettings}
              onHandRanks={onOpenHandRanks}
            />
            <Table
              game={state.game}
              personaIds={state.personaIds}
              lastAction={state.lastAction}
              revealed={revealed}
              heroWon={heroWon}
            />
            <HeroHand
              seat={hero}
              isButton={state.game.buttonSeat === HERO_SEAT}
              isToAct={state.game.toAct === HERO_SEAT}
              equity={shownEquity}
            />
            <BottomSlot
              state={state}
              onHero={onHero}
              onNext={onNext}
              onRebuy={onRebuy}
              reviewStatus={reviewStatus}
              onOpenReview={onOpenReview}
              handNetBB={handNetBB}
            />
          </>
        )}
      </div>
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
  handNetBB,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
  reviewStatus: ReviewStatus;
  onOpenReview: () => void;
  /** 本手 hero 净盈亏，BB。由 App 算好传下来，不在这里重算第二遍 */
  handNetBB: number;
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
    const showdown = state.record?.results.some(r => r.showdown) ?? false;
    return (
      <div className="bottom">
        {trigger}
        <SummaryBar netBB={handNetBB} showdown={showdown} onNext={onNext} />
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
