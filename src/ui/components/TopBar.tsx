import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

export interface TopBarProps {
  /** 已结算的手数（recordHandPlayed 在手牌结算那一刻就自增，见 handSession.ts advance） */
  handsPlayed: number;
  /** true 表示当前手牌尚在进行中（aiToAct / awaitingHero），还没结算 */
  inProgress: boolean;
  /** hero 净盈亏，BB */
  netBB: number;
  /** hero 累计买入，BB */
  totalBuyIn: number;
  deepStack: boolean;
  /**
   * 落库是否可用。false = 隐私模式 / 配额满 / 存储被禁用。
   *
   * 必须让用户看得见：牌局照常能打，但历史与统计不再累积。不说的话，他会
   * 以为自己打的每一手都被记着了，等到想去翻历史才发现是空的——那时已经
   * 打了几百手，什么都补不回来。
   */
  storageOk: boolean;
  muted: boolean;
  onToggleMute: () => void;
}

export function TopBar({
  handsPlayed,
  inProgress,
  netBB,
  totalBuyIn,
  deepStack,
  storageOk,
  muted,
  onToggleMute,
}: TopBarProps) {
  const isNeg = chipsGreater(0, netBB);
  // handsPlayed 在手牌结算时（advance 的 handOver 分支）就已经自增过了，
  // 所以结算后（含补码等待中）它本身就是当前手的序号，不能再 +1；
  // 只有手牌还没打完时，它才是「已打完的手数」，要 +1 换算成「正在打第几手」。
  const handNumber = handsPlayed + (inProgress ? 1 : 0);
  return (
    <div className="topbar">
      <span className="topbar-item">第 {handNumber} 手</span>
      <span className={`topbar-item ${isNeg ? 'neg' : 'pos'}`}>
        {isNeg ? '' : '+'}
        {chips(netBB)}
      </span>
      <span className="topbar-item dim">买入 {chips(totalBuyIn)}</span>
      {!storageOk && (
        <span className="topbar-item warn" title="本机存储不可用（隐私模式或配额已满），本次牌局不会被记录">
          未记录
        </span>
      )}
      {deepStack && (
        <span className="topbar-item warn" title="筹码深度超过 150BB，复盘精度下降">
          深筹码
        </span>
      )}
      <button
        type="button"
        className="topbar-mute"
        onClick={onToggleMute}
        aria-pressed={muted}
        title={muted ? '取消静音' : '静音'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}
