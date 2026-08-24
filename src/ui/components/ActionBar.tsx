import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ActionInput } from '../../core/gameEngine';
import type { ActionBarModel } from '../../session/actionBarModel';
import { chipsGreater, round2 } from '../../core/chips';
import { SMALL_BLIND } from '../../core/types';
import { chips } from '../format';

/**
 * 牌桌底部动作条。
 *
 * 设计稿是「两行常驻」：上行（预设 + 滑块 + 金额框）与下行（弃牌/跟注/加注
 * 三个大按钮）同屏共存，不是点了「加注」才展开出来的独立面板——三态互斥
 * 切换（默认/加注面板/全下确认）是改版前的形状，已废弃，`RaiseControl.tsx`
 * 随之删除，逻辑并进这一个组件。
 *
 * 全下的二次确认没有丢，只是换了形式：滑块/预设只负责"选一个额度"，
 * 真正提交永远要点下行那颗主按钮——选额度与点确认天然是两步，不需要再
 * 弹一层专门的确认面板。主按钮在选中额度等于全部筹码时文案变成
 * 「全下 $X」，用户点之前已经从文案上知道这一下是全下。
 */
export function ActionBar({
  model,
  onAction,
}: {
  model: ActionBarModel;
  onAction: (input: ActionInput) => void;
}) {
  const raiseMin = model.raise?.min ?? 0;
  const raiseMax = model.raise?.max ?? 0;
  const [amount, setAmount] = useState(raiseMin);

  // 局面变了（新的一手/新的一街/额度区间变化）就把选中额度收回最小值，
  // 不然会残留一个已经非法的数字挂在滑块上。
  useEffect(() => setAmount(raiseMin), [raiseMin, raiseMax]);

  if (!model.enabled) {
    return (
      <div className="actionbar actionbar-idle">
        <span className="waiting">等待其他玩家…</span>
      </div>
    );
  }

  const clamped = Math.min(Math.max(amount, raiseMin), raiseMax);
  // model.raise 存在时 model.allin 必然存在且金额恒等于 raiseMax（两者都是
  // legalActions 里同一个 seat.stack）——见 actionBarModel.ts 的注释。用
  // chipsGreater 而不是裸 === 比较，恰好相等时才判定为全下，浮点尾数不会
  // 被误判成"还差一点"从而漏判。
  const isAllin = model.allin !== null && !chipsGreater(model.allin.amount, clamped);

  const chipsEqual = (a: number, b: number): boolean =>
    !chipsGreater(a, b) && !chipsGreater(b, a);

  // 滑块与预设走的是引擎口径的**本次投入额**，而按钮上写的是「加注到 X」
  // ——本街已投入的部分（大盲、或自己先下注后被再加注的那笔）也算在「加注
  // 到」里面，不加回去就会少报一个 committed。BB 防守时这个差额恰好是 1BB：
  // 界面会写着「加注到 $720」而实际加注到 $760。
  // 下注（committed 恒为 0）与全下不受影响：全下写的是"你推出去多少"，
  // 也就是你面前那摞筹码本身，不是加注到的总额。
  const raiseTo = model.raise ? round2(clamped + model.raise.committed) : clamped;

  let primaryLabel: string | null = null;
  if (model.raise) {
    primaryLabel = isAllin
      ? `全下 ${chips(clamped)}`
      : `${model.raise.type === 'bet' ? '下注' : '加注到'} ${chips(raiseTo)}`;
  } else if (model.allin) {
    primaryLabel = `全下 ${chips(model.allin.amount)}`;
  }

  const handlePrimary = () => {
    if (model.raise) {
      if (isAllin) onAction({ type: 'allin' });
      else onAction({ type: model.raise.type, amount: clamped });
    } else if (model.allin) {
      onAction({ type: 'allin' });
    }
  };

  return (
    <div className="actionbar">
      {model.raise && (
        <div className="raise-panel">
          {[...model.raise.presets, { label: '全下', amount: model.raise.max }].map(p => (
            <button
              key={p.label}
              type="button"
              className={chipsEqual(amount, p.amount) ? 'preset preset-on' : 'preset'}
              onClick={() => setAmount(p.amount)}
            >
              {p.label}
            </button>
          ))}

          {/* --fill 是滑块已走过的比例，给 CSS 画左半段的蓝色填充用。原生
              <input type="range"> 没有"已填充轨道"这个概念（只有 Firefox 的
              ::-moz-range-progress，Chrome 没有对应物），只能靠背景渐变自己
              画，而渐变需要知道当前值——这个数必须从 React 传下去。
              raiseMax === raiseMin 时（只剩一个合法额度）分母为 0，取 0 避免
              NaN。 */}
          <div
            className="raise-slider"
            style={
              {
                '--fill': `${
                  raiseMax === raiseMin ? 0 : ((clamped - raiseMin) / (raiseMax - raiseMin)) * 100
                }%`,
              } as CSSProperties
            }
          >
            <input
              type="range"
              min={raiseMin}
              max={raiseMax}
              // HTML range 的步进网格是从 min 开始按 step 累加的，不是从 0
              // 开始，所以预设档位金额（不一定落在 min + k*step 上）以及
              // max 本身，常常够不到滑块能停的格子——滑块永远只能落在网格
              // 点上。这不是这里能修的：换成 SMALL_BLIND 只是让步进值有名
              // 有姓，网格错位是 <input type="range"> 本身的行为。
              step={SMALL_BLIND}
              value={clamped}
              onChange={e => setAmount(Number(e.target.value))}
            />
          </div>

          <div className="raise-amount-box">
            {/* 与主按钮印同一个数：两处一旦口径不同，用户没有办法判断该信哪个 */}
            <span className="raise-amount">{chips(isAllin ? clamped : raiseTo)}</span>
            <span className="raise-amount-sep" aria-hidden="true" />
            <button
              type="button"
              className="raise-max"
              onClick={() => setAmount(model.raise!.max)}
            >
              最大
            </button>
          </div>
        </div>
      )}

      <div className="actionbar-row">
        {model.fold && (
          <button className="btn btn-ghost" onClick={() => onAction({ type: 'fold' })}>
            弃牌
          </button>
        )}
        {model.passive && (
          <button className="btn" onClick={() => onAction({ type: model.passive!.type })}>
            {model.passive.type === 'check'
              ? '过牌'
              : `跟注 ${chips(model.passive.amount)}`}
          </button>
        )}
        {primaryLabel !== null && (
          <button className="btn btn-primary" onClick={handlePrimary}>
            {primaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
