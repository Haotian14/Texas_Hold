import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RaiseModel } from '../../session/actionBarModel';
import { chipsGreater } from '../../core/chips';
import { SMALL_BLIND } from '../../core/types';
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
      {/* --fill 是滑块已走过的比例，给 CSS 画左半段的蓝色填充用。
          原生 <input type="range"> 没有"已填充轨道"这个概念（只有 Firefox 的
          ::-moz-range-progress，Chrome 没有对应物），设计稿里那截蓝条只能靠
          背景渐变自己画，而渐变需要知道当前值——所以这个数必须从 React 传下去。
          model.max === model.min 时（只剩一个合法额度）分母为 0，取 0 避免 NaN。 */}
      <div
        className="raise-slider"
        style={
          {
            '--fill': `${
              model.max === model.min
                ? 0
                : ((clamped - model.min) / (model.max - model.min)) * 100
            }%`,
          } as CSSProperties
        }
      >
        <input
          type="range"
          min={model.min}
          max={model.max}
          // HTML range 的步进网格是从 min 开始按 step 累加的，不是从 0 开始，
          // 所以预设档位金额（不一定落在 min + k*step 上）以及 max 本身，
          // 常常够不到滑块能停的格子——滑块永远只能落在网格点上。这不是这
          // 里能修的：换成 SMALL_BLIND 只是让步进值有名有姓，网格错位是
          // <input type="range"> 本身的行为。
          step={SMALL_BLIND}
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
