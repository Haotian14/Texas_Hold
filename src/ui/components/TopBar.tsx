import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

export interface TopBarProps {
  handsPlayed: number;
  /** hero 净盈亏，BB */
  netBB: number;
  /** hero 累计买入，BB */
  totalBuyIn: number;
  deepStack: boolean;
}

export function TopBar({ handsPlayed, netBB, totalBuyIn, deepStack }: TopBarProps) {
  const isNeg = chipsGreater(0, netBB);
  return (
    <div className="topbar">
      <span className="topbar-item">第 {handsPlayed + 1} 手</span>
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
    </div>
  );
}
