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
  muted: boolean;
  onToggleMute: () => void;
}

export function TopBar({
  handsPlayed,
  inProgress,
  netBB,
  totalBuyIn,
  deepStack,
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
