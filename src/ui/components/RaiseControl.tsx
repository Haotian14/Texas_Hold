import { useEffect, useState } from 'react';
import type { RaiseModel } from '../../session/actionBarModel';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

export interface RaiseControlProps {
  model: RaiseModel;
  label: string;
  /** 全下额；没有全下项（如没有加注权时不会走到这个面板，但仍防御性处理）时为 null */
  allinAmount: number | null;
  onSubmit: (amount: number, isAllin: boolean) => void;
  onCancel: () => void;
}

export function RaiseControl({ model, label, allinAmount, onSubmit, onCancel }: RaiseControlProps) {
  const [amount, setAmount] = useState(model.min);

  // 局面变了就把滑块拉回最小值，避免残留一个已经非法的额度
  useEffect(() => setAmount(model.min), [model.min, model.max]);

  const clamped = Math.min(Math.max(amount, model.min), model.max);
  // 滑块拉到全下额时，这次提交在牌局语义上就是全下（applyAction 会因为筹码归零
  // 把该座位标记为 all-in），必须走全下确认路径，不能悄悄提交成一个恰好等于全部
  // 筹码的加注。用 chipsGreater 而不是裸 === 比较：allinAmount 为 null（没有全下
  // 项）时天然不判定为全下，恰好相等时判定为全下，差一分钱之类的浮点尾数不会被
  // chipsGreater 判成"还差一点"从而误判成普通加注。
  const isAllin = allinAmount !== null && !chipsGreater(allinAmount, clamped);

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
        <button
          className={isAllin ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={() => onSubmit(clamped, isAllin)}
        >
          {isAllin ? `确认全下 ${chips(clamped)}` : `${label} ${chips(clamped)}`}
        </button>
      </div>
    </div>
  );
}
