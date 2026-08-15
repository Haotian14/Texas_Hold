import { useEffect, useState } from 'react';
import type { RaiseModel } from '../../session/actionBarModel';
import { chips } from '../format';

export interface RaiseControlProps {
  model: RaiseModel;
  label: string;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}

export function RaiseControl({ model, label, onSubmit, onCancel }: RaiseControlProps) {
  const [amount, setAmount] = useState(model.min);

  // 局面变了就把滑块拉回最小值，避免残留一个已经非法的额度
  useEffect(() => setAmount(model.min), [model.min, model.max]);

  const clamped = Math.min(Math.max(amount, model.min), model.max);

  return (
    <div className="raise-panel">
      <div className="raise-presets">
        {model.presets.map(p => (
          <button key={p.label} className="preset" onClick={() => setAmount(p.amount)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="raise-slider">
        <input
          type="range"
          min={model.min}
          max={model.max}
          step={0.5}
          value={clamped}
          onChange={e => setAmount(Number(e.target.value))}
        />
        <span className="raise-amount">{chips(clamped)}</span>
      </div>
      <div className="raise-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={() => onSubmit(clamped)}>
          {label} {chips(clamped)}
        </button>
      </div>
    </div>
  );
}
