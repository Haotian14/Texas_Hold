import { chipsGreater } from '../../core/chips';
import { chips } from '../format';
import { Button } from './ui/button';
import { PRIMARY_BTN } from './ui/tableButton';

export function SummaryBar({
  netBB,
  showdown,
  onNext,
}: {
  /** 本手 hero 的净盈亏，BB */
  netBB: number;
  showdown: boolean;
  onNext: () => void;
}) {
  const isNeg = chipsGreater(0, netBB);
  return (
    <div className="summary">
      <div className="summary-line">
        <span className={isNeg ? 'neg' : 'pos'}>
          本手 {isNeg ? '' : '+'}
          {chips(netBB)}
        </span>
        <span className="summary-note">{showdown ? '摊牌' : '未摊牌'}</span>
      </div>
      <Button className={PRIMARY_BTN} onClick={onNext}>
        下一手
      </Button>
    </div>
  );
}
