import { SMALL_BLIND, BIG_BLIND, SEAT_COUNT } from '../../core/types';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';
import { Badge } from './ui/badge';
import { QuickToggles } from './QuickToggles';

export interface TopBarProps {
  /** 已结算的手数（recordHandPlayed 在手牌结算那一刻就自增，见 handSession.ts advance） */
  handsPlayed: number;
  /** true 表示当前手牌尚在进行中（aiToAct / awaitingHero），还没结算 */
  inProgress: boolean;
  deepStack: boolean;
  /**
   * 落库是否可用。false = 隐私模式 / 配额满 / 存储被禁用。
   *
   * 必须让用户看得见：牌局照常能打，但历史与统计不再累积。不说的话，他会
   * 以为自己打的每一手都被记着了，等到想去翻历史才发现是空的——那时已经
   * 打了几百手，什么都补不回来。
   */
  storageOk: boolean;
  /** hero 本次会话累计净盈亏，BB */
  netBB: number;
  muted: boolean;
  onToggleMute: () => void;
  showEquity: boolean;
  onToggleEquity: () => void;
  onSettings: () => void;
}

/**
 * 牌桌页顶栏。一行装下三样东西：身份（这是什么牌局）、进度（第几手、赢了多少）、
 * 开关。
 *
 * 会话盈亏从 Nav 底部搬到了这里。原来放在 Nav 是因为「切到历史/报表页时这块
 * 信息照样要显示」——那个理由随导航移到底部一起失效了：底部导航条只有三个
 * 图标的高度，塞不下一个金额块，而牌桌页本来就是唯一需要盯着会话盈亏的地方
 * （复盘页与报表页回答的是「你打得多好」，用的是 BB/100 与 EV 损失，不是钱）。
 *
 * 手数与会话盈亏同一行、用「·」分隔，而不是各占一行：两者都是"这次坐下之后
 * 发生了什么"，分开写会让顶栏长到两行，那是牌桌最缺的纵向空间。
 */
export function TopBar({
  handsPlayed,
  inProgress,
  deepStack,
  storageOk,
  netBB,
  muted,
  onToggleMute,
  showEquity,
  onToggleEquity,
  onSettings,
}: TopBarProps) {
  // handsPlayed 在手牌结算时（advance 的 handOver 分支）就已经自增过了，
  // 所以结算后（含补码等待中）它本身就是当前手的序号，不能再 +1；
  // 只有手牌还没打完时，它才是「已打完的手数」，要 +1 换算成「正在打第几手」。
  const handNumber = handsPlayed + (inProgress ? 1 : 0);
  const isNeg = chipsGreater(0, netBB);
  return (
    <div className="topbar">
      {/* 游戏类型：设计稿这里带一个「▾」暗示可切换游戏，但本项目只有德州扑克
          一种玩法，渲染成可切换控件是「列一个点了没反应的入口」，所以做成
          静态标记。窄屏上它缩成一枚黑桃图标——盲注与 6-max 已经说清这是什么局。 */}
      <span className="topbar-mark" aria-hidden="true">
        ♠
      </span>
      <span className="topbar-text">
        <span className="topbar-game">
          {chips(SMALL_BLIND)} / {chips(BIG_BLIND)} · {SEAT_COUNT}-max
        </span>
        <span className="topbar-meta">
          第 {handNumber} 手 · 会话{' '}
          <span className={isNeg ? 'neg' : 'pos'}>
            {isNeg ? '' : '+'}
            {chips(netBB)}
          </span>
        </span>
      </span>
      {/* warn 这一档标的是"注意但不是错"：存储不可用与深筹码都不是用户打错了。
          用琥珀不用红，免得和复盘里那个"你打错了"的红抢同一个语义 */}
      <div className="topbar-flags">
        {!storageOk && (
          <Badge variant="warn" title="本机存储不可用（隐私模式或配额已满），本次牌局不会被记录">
            未记录
          </Badge>
        )}
        {deepStack && (
          <Badge variant="warn" title="筹码深度超过 150BB，复盘精度下降">
            深筹码
          </Badge>
        )}
      </div>
      <QuickToggles
        muted={muted}
        onToggleMute={onToggleMute}
        showEquity={showEquity}
        onToggleEquity={onToggleEquity}
        onSettings={onSettings}
      />
    </div>
  );
}
