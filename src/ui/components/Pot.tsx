import { chips } from '../format';

export function Pot({ amount }: { amount: number }) {
  return (
    <div className="pot">
      <span className="pot-label">底池</span>
      <span className="pot-amount">{chips(amount)}</span>
    </div>
  );
}
