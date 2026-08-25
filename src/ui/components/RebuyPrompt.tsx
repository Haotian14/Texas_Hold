import { chips } from '../format';
import { Button } from './ui/button';
import { PRIMARY_BTN } from './ui/tableButton';

export function RebuyPrompt({
  options,
  buyInCount,
  totalBuyIn,
  onRebuy,
}: {
  /** 可选的目标筹码额，BB */
  options: readonly number[];
  /** 已发生的买入次数（含开局那次） */
  buyInCount: number;
  /** 累计买入额，BB */
  totalBuyIn: number;
  onRebuy: (targetStack: number) => void;
}) {
  return (
    <div className="rebuy">
      <div className="rebuy-note">
        筹码不足，需要补码 · 这是第 {buyInCount + 1} 次买入 · 累计买入{' '}
        {chips(totalBuyIn)}
      </div>
      <div className="rebuy-actions">
        {options.map(o => (
          <Button key={o} className={PRIMARY_BTN} onClick={() => onRebuy(o)}>
            补 {chips(o)}
          </Button>
        ))}
      </div>
    </div>
  );
}
