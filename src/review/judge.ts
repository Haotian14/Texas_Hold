import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import { classifyHand } from '../core/handClass';
import { actionFreqs } from '../core/ranges';
import { chipsGreater } from '../core/chips';
import type { MistakeTag } from './taxonomy';
import { PREFLOP_OK_FREQ, VALUE_BET_EQUITY_FLOOR } from './taxonomy';
import type { PreflopNode } from './preflopNode';
import { isForcedShortStackAllin } from './preflopNode';

/**
 * matchCandidate 里「进攻类」动作互相兼容的类型族。
 *
 * 根因与 src/ai/decide.ts 的 BET_LIKE 完全同源：estimateEv（core/evEstimate.ts）
 * 按 `chipsGreater(sit.toCall, 0) ? 'raise' : 'bet'` 给下注/加注候选定类型，
 * 这条规则从不产出 'allin'——唯一的例外是筹码不足以跟平时的「不足额跟注」
 * 分支（makeBetCandidate 完全不参与，见 evEstimate.ts 'call all-in' 那个候选，
 * actionType 硬编码为 'allin'，语义是「跟注」不是「加注」，下面单独处理）。
 * 而引擎记录用户实际动作时（core/gameEngine.ts legalActions/applyAction），
 * 只要玩家有加注权，'raise'（或 toCall===0 时的 'bet'）与 'allin' 是两个
 * 同时合法、玩家可以任选其一的动作类型——选 'allin' 只是「自愿把加注封顶到
 * 全部筹码」，跟选 'raise' 后把金额填到 stack 上限是同一个决定的两种记录方式。
 * 旧实现按 actionType 字符串精确相等匹配，导致玩家选 'allin' 时永远配不上
 * estimateEv 只会给出的 'raise'/'bet' 候选——这正是本次修复的缺陷本体：
 * 100 BB 的自愿全下被静默判成"没有问题"。
 *
 * 与 decide.ts 的 BET_LIKE 不同的是，这里不需要处理 bet/raise 命名歧义（那是
 * toCall 与 currentBet 在大盲被平跟到选项上的分歧，属于 legalActions 与
 * estimateEv 之间的另一对命名不一致，decide.ts 的 matchesLegal 已经在那一层
 * 解决过）——matchCandidate 匹配的是「玩家选了哪个 actionType」对「EV 引擎
 * 算了哪个 actionType」，两边对 bet/raise 的判断依据相同（是否有活跃下注），
 * 从不分歧，只有 allin 这一个类型字符串会分歧，所以这里只需要把 allin 也
 * 并入 bet/raise 的同一族，不需要再区分 bet 与 raise。
 */
const AGGRESSIVE_ACTION_TYPES: ReadonlySet<Action['type']> = new Set(['bet', 'raise', 'allin']);

/**
 * 判断用户实际动作的类型能否对应到某个 EV 候选的类型。
 *
 * 两条规则：
 * 1) 字符串相等，直接匹配（fold/check/call 之间从不分歧，原样保留）。
 * 2) 'bet'/'raise'/'allin' 互相兼容——见上面 AGGRESSIVE_ACTION_TYPES 的注释。
 *
 * 刻意不做的第三条：不把 'call' 与 'allin' 做成对称的双向兼容。'allin' 只在
 * 一种情况下语义等于"跟注"——estimateEv 的强制短筹码分支（sit.toCall > 0 且
 * sit.heroStack <= sit.toCall，玩家没有加注权，被迫把仅剩的筹码跟出去，
 * 见 evEstimate.ts "call all-in" 候选）。这个分支永远不会同时产出 bet/raise
 * 候选（同一个 if/else，见 evEstimate.ts 第 171 行），所以 actionType==='allin'
 * 的候选只可能是这一种「跟注」语义，把它加进 'call' 能匹配的类型里是安全的、
 * 不会误配到别的东西。但反过来不能把这条规则做成对称的——如果 'call' 也
 * 被塞进 AGGRESSIVE_ACTION_TYPES、允许 'allin' 反向匹配 'call' 候选，会让一次
 * 真正的自愿加注全下（玩家有加注权、选了 'allin' 表示"封顶到底"）在候选集
 * 里同时有 call 候选（stack > toCall 时才会产出，即玩家本可以只跟注）的场景下
 * 被错误地配成"跟注"，把一次进攻动作的 EV 算成跟注的 EV——这正是任务书点名
 * 要提防的"更隐蔽的错误答案"。所以只在 actual.type==='call' 时额外放行
 * candidateType==='allin'，方向不对称。
 */
function candidateTypeMatches(actualType: Action['type'], candidateType: EvCandidate['actionType']): boolean {
  if (actualType === candidateType) return true;
  if (AGGRESSIVE_ACTION_TYPES.has(actualType) && AGGRESSIVE_ACTION_TYPES.has(candidateType)) {
    return true;
  }
  if (actualType === 'call' && candidateType === 'allin') return true;
  return false;
}

/**
 * 把用户的实际动作对应到一个 EV 候选。
 *
 * 已知近似：用户的下注尺度可能落在两个候选档之间（比如 0.4 池），
 * 此时取最接近的一档，EV 会有偏差。候选尺度固定为五档是 spec §8.3
 * 的决定（连续尺度搜索收益低、开销大），所以这个偏差是设计的一部分，
 * 不是缺陷 —— 但要在 UI 与文档里说明。
 */
export function matchCandidate(ev: EvResult, actual: Action): EvCandidate | null {
  const same = ev.candidates.filter(c => candidateTypeMatches(actual.type, c.actionType));
  if (same.length === 0) return null;
  if (same.length === 1) return same[0];

  const target = actual.amount;
  let best = same[0];
  let bestGap = Math.abs(best.investment - target);
  for (const c of same) {
    const gap = Math.abs(c.investment - target);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * 翻前按频率表判定是否算失误（spec §8.2）。
 *
 * 范围表只存频率不存 EV，所以它只回答「这算不算失误」，
 * 不回答「亏了多少」—— 后者由同一套 EV 估算给出，量纲才能和翻后相加。
 *
 * 均衡策略是混合的：同一手牌在同一节点可能 30% 加注、70% 跟注。
 * 用户选了低频但合法的那一支不该被判错，所以阈值取 0.15 而不是「最高频动作」。
 */
export function judgePreflopFrequency(
  node: PreflopNode | null,
  situation: Situation,
  actual: Action,
): boolean {
  if (!node) return false;
  const hc = classifyHand(situation.heroCards[0], situation.heroCards[1]);
  const freqs = actionFreqs(node.key, hc);
  if (!freqs) return false;

  // 引擎的动作类型与范围表的动作名对不上：表里用 raise / call / 3bet / 4bet / fold
  const key = preflopActionKey(node, actual.type);
  if (!key) return false;
  return (freqs[key] ?? 0) >= PREFLOP_OK_FREQ;
}

function preflopActionKey(node: PreflopNode, type: Action['type']): string | null {
  if (type === 'fold') return 'fold';
  if (type === 'call') return 'call';
  if (type === 'raise' || type === 'allin') {
    if (node.kind === 'rfi') return 'raise';
    if (node.kind === 'vs-open') return '3bet';
    return '4bet';
  }
  return null;
}

/**
 * 按局面特征给失误打分类标签（spec §8.7）。
 *
 * 规则按「最具体的先判」排序 —— 一个决策可能同时符合多条描述，
 * 取最能说明问题的那一条。返回 null 表示能算出损失但归不进任何一类，
 * 此时 UI 只显示损失额与推荐动作。
 */
export function tagFor(
  situation: Situation,
  actual: Action,
  actualCand: EvCandidate | null,
  ev: EvResult,
  node: PreflopNode | null = null,
): MistakeTag | null {
  const rec = ev.recommended;
  const isPreflop = situation.street === 'preflop';
  // "hero 是否在开池"问的是「有没有人已经加注」，不是「要不要付钱」——
  // UTG 开池也要付 1 BB 的大盲、SB 补齐也要付 0.5 BB，toCall 在这两个分支里
  // 恒为正，用它来分辨"开池"与"面对加注"在物理上不可能成立（这正是缺陷本身）。
  // node.kind === 'rfi' 直接回答"还没有人加注"，node === null 在翻前只可能
  // 表示 4bet 及以上（范围表未覆盖的节点，见 preflopNode.ts 的注释），
  // 4bet 显然不是"开池"，所以 node === null 时 isOpen 取 false 是对的。
  const isOpen = node?.kind === 'rfi';

  if (isPreflop) {
    // 'allin' 补入这条判据（评审发现③）：短筹码翻前场景里 EV 引擎推荐的往往
    // 是 estimateEv 强制短筹码分支产出的 'call all-in' 候选（actionType 硬编码
    // 为 'allin'，语义是"跟注"，见 evEstimate.ts 170-182 行），这类候选此前
    // 不满足 `rec.actionType === 'call' || rec.actionType === 'raise'`，弃牌
    // 该继续的失误因此完全判不出来——损失照常算（actualEv/evLoss 不受影响），
    // 但归不进 preflop_fold_too_tight，也不会计入 tags 索引供 spec §9 的漏洞
    // 统计使用。这是短筹码翻前最常见的失误形态之一（面对多人入池全下跟注的
    // 赔率判断），不能漏判。
    if (actual.type === 'fold' &&
        (rec.actionType === 'call' || rec.actionType === 'raise' || rec.actionType === 'allin')) {
      return 'preflop_fold_too_tight';
    }
    // !isOpen 守卫（评审发现②）：missed_3bet 说的是"面对一次加注，只跟注、
    // 没有反加"——这句话只有在真的有人加注过时才成立。node.kind === 'rfi'
    // （isOpen）意味着桌上还没有人加注：小盲补齐大盲、或跛入者身后再跛入，
    // 都会落进 actual.type==='call'，但两者都不是"面对加注"。没有这条守卫时，
    // 这个分支排在 sb_limp 检查之前，会把 SB 跛入误判成 missed_3bet（渲染出
    // "面对加注只跟注了 0.5 BB"这种没有加注者存在的假句子），也会把跛入者
    // 身后的跛入误判成 missed_3bet（如果 rec 恰好是 raise）。
    if (actual.type === 'call' && !isOpen && rec.actionType === 'raise') {
      return 'preflop_missed_3bet';
    }
    // sb_limp 排在 cold_call_too_wide 前面（原顺序相反）：SB 补齐大盲时没有人
    // 加注过，"跛入"描述的是这个动作本身的性质（该开池却选择了补齐），跟
    // "冷跟一次加注却手牌不够格"是两件不同的事——即使这一步的推荐动作恰好也是
    // fold，"补齐大盲"仍然是更具体、更贴切的描述，本文件顶部"规则按最具体的
    // 先判排序"的原则要求它优先命中。
    if (actual.type === 'call' && isOpen && situation.heroPosition === 'SB') {
      return 'preflop_sb_limp';
    }
    // 同样的 !isOpen 守卫（评审发现②）：cold_call_too_wide 说的是"冷跟一次
    // 加注却手牌不够格"，没有 !isOpen 时，跛入者身后再跛入（isOpen 仍为
    // true，因为跛入不计入 preflopNodeFor 的加注计数）在 rec 是 fold 时会被
    // 误判成这一类，渲染出"面对加注跟注 X BB……不在冷跟范围内"——同样是没有
    // 加注者存在的假句子。SB 补齐大盲的情况已经被上面的 sb_limp 分支截走，
    // 这里只需要处理"非 SB 的跛入者身后再跛入"这一种此前会被误判的处境。
    if (actual.type === 'call' && !isOpen && rec.actionType === 'fold') {
      return 'preflop_cold_call_too_wide';
    }
    if (isAggressiveActual(actual, situation) && rec.actionType === 'fold') {
      return isOpen ? 'preflop_open_too_wide' : 'preflop_over_aggressive';
    }
    return null;
  }

  // ── 翻后
  if (actual.type === 'fold' && rec.actionType !== 'fold') {
    // 该继续却弃了。§8.7 的翻后分类里没有「弃得太紧」这一条 ——
    // 翻后弃牌过紧的形态太多（弃掉听牌、弃掉成手、弃掉底池赔率足够的边缘牌），
    // 归成一个标签没有指导意义。返回 null，UI 只显示损失额与推荐动作。
    return null;
  }
  if ((actual.type === 'call' || actual.type === 'raise' || actual.type === 'allin') &&
      rec.actionType === 'fold') {
    if (actual.type !== 'call') return 'should_have_folded';
    return isRaiseFaced(situation) ? 'call_too_light_vs_raise' : 'chasing_bad_odds';
  }
  if ((actual.type === 'check' || actual.type === 'call') && (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (situation.street === 'flop' && situation.heroIsPreflopAggressor && actual.type === 'check') {
      // c-bet 本来就常常是弱牌下的：持续下注是在利用翻前主动权和范围优势，
      // 不是在宣称这手牌是价值牌。missed_cbet 的文案也没有提"价值"或胜率，
      // 所以这里刻意不设胜率门槛 —— 见 taxonomy.ts 对 VALUE_BET_EQUITY_FLOOR 的说明。
      return 'missed_cbet';
    }
    // missed_value_bet 的字面意思是"这手牌该拿价值却没下注"——只有 hero 的
    // 胜率达到 VALUE_BET_EQUITY_FLOOR（至少在对手跟注范围前占先）时，
    // 把推荐的下注称为"价值"才站得住。低于这条线时推荐的下注实质是诈唬，
    // 归不进"价值"这一类，返回 null（宁可少标一类，也不能贴错标签 ——
    // 损失额与推荐动作仍然会正常展示，只是不带这个具体分类）。
    // heroEquity 是概率不是筹码金额，这里用普通数值比较是对的，
    // 不需要也不应该换成 chips.ts 里给筹码用的容差比较。
    if (ev.heroEquity < VALUE_BET_EQUITY_FLOOR) return null;
    return 'missed_value_bet';
  }
  if (isAggressiveActual(actual, situation) && rec.actionType === 'fold') {
    return 'over_bluffing';
  }
  if (isAggressiveActual(actual, situation) && rec.actionType === 'check') {
    // 下注但推荐过牌：弃牌率不足的诈唬
    if (rec.foldEquity !== undefined && rec.foldEquity < 0.2) return 'ineffective_bluff';
    return 'over_bluffing';
  }
  if (actualCand && isAggressiveActual(actual, situation) &&
      (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (chipsGreater(rec.investment, actualCand.investment)) return 'bet_size_too_small';
    if (chipsGreater(actualCand.investment, rec.investment)) return 'bet_size_too_large';
  }
  return null;
}

/**
 * 判断用户在这个决策点的实际动作是不是「进攻类」（主动下注/加注，含自愿
 * 全下）——tagFor 里每一处需要回答"这是不是一次主动加码"的分支都必须走
 * 这一个函数，不能各自重复 `actual.type === 'bet' || actual.type === 'raise'`
 * 的字面量列表：下一次有人加一条新分支，忘了把 'allin' 一起加进去，就是本次
 * 修复的同一个缺陷再犯一遍。
 *
 * 'bet'/'raise' 没有歧义，直接判进攻。'allin' 有歧义，需要看 situation 消歧——
 * gameEngine.legalActions（core/gameEngine.ts 第 161-169 行）在两种物理上完全
 * 不同的处境下都会把 'allin' 列为合法选项：
 *   1）玩家有加注权、筹码又够（!( toCall>0 且 heroStack<=toCall )）：'allin'
 *      只是把 'raise'/'bet' 填到筹码上限的另一种写法——玩家本可以选 'raise'
 *      把金额手动拉到 stack，选 'allin' 是同一个决定的另一种记录方式，语义
 *      是进攻。
 *   2）toCall > 0 且 heroStack <= toCall（筹码不够完整跟注，没有加注权可言，
 *      见 legalActions 第 136 行 call 的筹码门槛）：'call' 因为筹码不够被
 *      legalActions 排除，'allin' 是这种处境下唯一能表达"跟注"的动作类型，
 *      语义是跟注，不是进攻。
 *
 * 这个二选一的边界——toCall > 0 且 !chipsGreater(heroStack, toCall)——与
 * estimateEv 划分"下注/加注候选" vs "call all-in 候选"用的是同一个条件
 * （evEstimate.ts 第 171 行），不是巧合：两处问的是同一个物理问题（这个人
 * 手上的筹码够不够做一次真正的加注），只是分别站在"引擎记录用户选了什么"
 * 与"EV 引擎能产出哪些候选"两侧回答。用同一个判据，保证这里对 'allin' 的
 * 分类与 rec.actionType 会不会是 'bet'/'raise' 永远同步——判成"进攻"的处境，
 * ev.candidates 里一定有 bet/raise 候选（evEstimate.ts 183-197 行的 else 分支）；
 * 判成"跟注"的处境，ev.candidates 只可能有 fold 与强制跟注的 allin 候选，不会有
 * bet/raise（evEstimate.ts 170-182 行的 if 分支，两个分支互斥），下面几个要求
 * rec.actionType 是 bet/raise 的分支天然不会被"跟注"误配上进攻类的判断依据。
 *
 * 这个边界判据与 preflopNode.ts::preflopNodeFor 判断"这次 allin 该不该计入
 * 翻前加注次数"用的是同一个物理问题（评审发现④），因此直接复用
 * preflopNode.ts 导出的 isForcedShortStackAllin，不在这里再写一遍
 * `chipsGreater(toCall, 0) && !chipsGreater(heroStack, toCall)`——preflopNode.ts
 * 原来就是因为没有这条判据（把任何 allin 都当真正加注）才产生了"phantom
 * open"缺陷，两处各自维护一份同样的算式，早晚会有一处漏改。
 *
 * 刻意不覆盖 should_have_folded / call_too_light_vs_raise / chasing_bad_odds
 * 那一组分支（本文件 tagFor 里 184-187 行）：那一组问的是"选了 call/raise/allin
 * 中的任意一个而不是 fold"，跟"是不是主动进攻"是两个不同的问题——强制全下
 * 跟注本来就该被那一组按"没弃牌"处理，不需要也不应该用这个函数去过滤。
 */
function isAggressiveActual(actual: Action, situation: Situation): boolean {
  if (actual.type === 'bet' || actual.type === 'raise') return true;
  if (actual.type !== 'allin') return false;
  return !isForcedShortStackAllin(situation.toCall, situation.heroStack);
}

/**
 * 面对的是不是一个「大注」——用于区分「面对加注跟太松」与「赔率不足追听牌」。
 *
 * 用 toCall 超过半个底池作为代理，而不是去 actions 里找有没有 raise：
 * 半池以上的下注要求跟注方有 33% 以上的胜率，这个门槛本身就是
 * 「跟太松」的判定依据，比「技术上是不是一次 raise」更贴近要表达的意思。
 */
function isRaiseFaced(situation: Situation): boolean {
  return chipsGreater(situation.toCall, situation.pot * 0.5);
}
