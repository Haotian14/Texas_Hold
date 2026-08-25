import { SMALL_BLIND, BIG_BLIND, SEAT_COUNT } from '../../core/types';
import { chips } from '../format';
import { Badge } from './ui/badge';

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
}

export function TopBar({ handsPlayed, inProgress, deepStack, storageOk }: TopBarProps) {
  // handsPlayed 在手牌结算时（advance 的 handOver 分支）就已经自增过了，
  // 所以结算后（含补码等待中）它本身就是当前手的序号，不能再 +1；
  // 只有手牌还没打完时，它才是「已打完的手数」，要 +1 换算成「正在打第几手」。
  const handNumber = handsPlayed + (inProgress ? 1 : 0);
  return (
    <div className="topbar">
      {/* 游戏类型胶囊：设计稿这里带一个「▾」暗示可切换游戏，但本项目只有
          德州扑克一种玩法，渲染成可切换控件是「列一个点了没反应的入口」，
          所以做成静态标签胶囊——尺寸/圆角/边框/内边距照抄设计稿。 */}
      <span className="topbar-game">德州扑克</span>
      <span className="topbar-meta">
        {chips(SMALL_BLIND)} / {chips(BIG_BLIND)} · {SEAT_COUNT}-max · 第 {handNumber} 手
      </span>
      {/* 设计稿这里还有三个图标按钮（▤ 表格视图 / ✎ 编辑 / ···
          更多），一个都不接，本项目原则是「列一个点了没反应的入口比不列
          更糟」，所以不渲染。净盈亏/买入/静音也不在这里——它们搬到了
          Nav 底部的「会话盈亏」区块，见 Nav.tsx。 */}
      <div className="topbar-flags">
        {/* warn 这一档标的是"注意但不是错"：存储不可用与深筹码都不是用户打错了。
            用琥珀不用红，免得和复盘里那个"你打错了"的红抢同一个语义 */}
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
    </div>
  );
}
