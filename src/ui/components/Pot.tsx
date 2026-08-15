import { chips } from '../format';

export function Pot({ amount, won = false }: { amount: number; won?: boolean }) {
  return (
    <div className={won ? 'pot pot-won' : 'pot'}>
      <span className="pot-label">底池</span>
      {/* key 随金额变化 → 元素重挂载 → CSS 入场动画重放。
          用它代替「在 React 里记住上一次金额再手动触发动画」。 */}
      <span key={chips(amount)} className="pot-amount">
        {chips(amount)}
      </span>
    </div>
  );
}
