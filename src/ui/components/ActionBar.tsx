import { useEffect, useState } from 'react';
import type { ActionInput } from '../../core/gameEngine';
import type { ActionBarModel } from '../../session/actionBarModel';
import { chipsGreater, round2 } from '../../core/chips';
import { SMALL_BLIND } from '../../core/types';
import { chips } from '../format';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { cn } from '../lib/utils';
import { PRIMARY_BTN, TABLE_BTN } from './ui/tableButton';

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
          {/* 尺寸全部由 --u 推出来，不用组件自带的固定档。--u 是牌桌宽度的
              比例单位（见 app.css 的 .app-main > *）——整条动作条跟着牌桌缩放，
              换成固定像素会让它在手机上和牌桌脱节。tailwind-merge 保证这里
              的 min-h/text/rounded 覆盖掉 Button 默认那三个，而不是叠上去 */}
          {[...model.raise.presets, { label: '全下', amount: model.raise.max }].map(p => (
            <Button
              key={p.label}
              size="sm"
              variant={chipsEqual(amount, p.amount) ? 'outline' : 'ghost'}
              aria-pressed={chipsEqual(amount, p.amount)}
              className={cn(
                'min-h-[calc(3.6*var(--u))] rounded-[calc(0.89*var(--u))] px-[calc(1.33*var(--u))] text-[calc(1.33*var(--u))] font-semibold tabular-nums',
                chipsEqual(amount, p.amount)
                  ? 'border-primary/45 bg-accent text-accent-foreground'
                  : 'border border-input text-secondary-foreground',
              )}
              onClick={() => setAmount(p.amount)}
            >
              {p.label}
            </Button>
          ))}

          {/* 原来这里有个 --fill 百分比变量，喂给 CSS 画左半段的蓝色填充：
              原生 <input type="range"> 没有"已填充轨道"这个概念（只有
              Firefox 的 ::-moz-range-progress，Chrome 没有对应物），只能靠
              背景渐变自己画。Radix 给了真的 Range 元素，那个变量、那段渐变、
              以及 raiseMax === raiseMin 时分母为 0 的那个 NaN 兜底，一起删掉了。

              步进网格那条老限制也一并解决：原生 range 的可停点是从 min 开始
              按 step 累加的，预设档位金额与 max 本身常常够不到格子；Radix 只
              在用户拖动/按键时吸附，受控值原样显示，所以预设设进来的金额能
              精确落上（下面 setAmount 的值不再被改写）。 */}
          <Slider
            className="min-w-[calc(6*var(--u))] flex-1"
            min={raiseMin}
            max={raiseMax}
            step={SMALL_BLIND}
            value={[clamped]}
            onValueChange={([v]) => setAmount(v ?? raiseMin)}
          />

          <div className="raise-amount-box">
            {/* 与主按钮印同一个数：两处一旦口径不同，用户没有办法判断该信哪个 */}
            <span className="raise-amount">{chips(isAllin ? clamped : raiseTo)}</span>
            <span className="raise-amount-sep" aria-hidden="true" />
            <Button
              variant="ghost"
              size="sm"
              className="min-h-0 px-0 text-[calc(1.28*var(--u))] font-semibold text-primary hover:bg-transparent hover:underline"
              onClick={() => setAmount(model.raise!.max)}
            >
              最大
            </Button>
          </div>
        </div>
      )}

      <div className="actionbar-row">
        {model.fold && (
          <Button variant="outline" className={cn(TABLE_BTN, 'flex-1 bg-transparent text-muted-foreground')} onClick={() => onAction({ type: 'fold' })}>
            弃牌
          </Button>
        )}
        {model.passive && (
          <Button variant="outline" className={cn(TABLE_BTN, 'flex-1')} onClick={() => onAction({ type: model.passive!.type })}>
            {model.passive.type === 'check'
              ? '过牌'
              : `跟注 ${chips(model.passive.amount)}`}
          </Button>
        )}
        {primaryLabel !== null && (
          <Button
            // flex-[1.5] 让主按钮比另外两颗宽——最常按的那颗该最好按
            className={cn(PRIMARY_BTN, 'flex-[1.5]')}
            onClick={handlePrimary}
          >
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
