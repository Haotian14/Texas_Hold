import { useEffect, useState } from 'react';
import type { ActionInput } from '../../core/gameEngine';
import type { ActionBarModel } from '../../session/actionBarModel';
import { chipsGreater, round2 } from '../../core/chips';
import { chips, CHIPS_PER_BB } from '../format';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { PRIMARY_BTN, TABLE_BTN } from './ui/tableButton';

/**
 * 加价档，单位是**实额筹码**（$），不是 BB。
 *
 * 这是界面上唯一一处刻意以实额定义的金额：按钮上印的就是这几个数，用户
 * 说的也是这几个数（"加 500"），换算成 BB 只是为了喂给引擎。反过来写成
 * BB（1 / 2.5 / 12.5 / 25）的话，改盲注级别时按钮会变成 "+$50" 这种不
 * 圆整的数——用 CHIPS_PER_BB 换算能保证印出来的永远是这四个数。
 *
 * 为什么是加价而不是原来的底池比例档（1/3 池、1/2 池…）：牌局后段筹码
 * 很深时，底池比例档与滑块的每一格都是几百上千，想在两档之间选一个数
 * 根本停不住。加价档的粒度不随筹码量变化，$40 永远是 $40。
 */
const RAISE_STEP_CHIPS: readonly number[] = [40, 100, 500, 1000];

/**
 * 加价档与「全下」共用的尺寸。tailwind-merge 保证覆盖掉 Button 的默认档。
 *
 * 开头那个 `raise-step` 不上样式，只是给 tools/overlap-check.mjs 一个抓手：
 * 那个检测器按选择器取元素两两求交，而这几颗按钮的样式全是工具类，没有
 * 类名就等于不在它的视野里。上一版的预设按钮就是这样——检测器的清单里写着
 * `.preset`，而界面上从来没有过这个类名，那一条空跑了整整一轮改版。
 */
const STEP_BTN =
  'raise-step min-h-[calc(3.6*var(--u))] rounded-[calc(0.89*var(--u))] px-[calc(1.11*var(--u))] text-[calc(1.33*var(--u))] font-semibold tabular-nums';

/**
 * 牌桌底部动作条。
 *
 * 「两行常驻」：上行（加价档 + 全下 + 金额框）与下行（弃牌/跟注/加注三个
 * 大按钮）同屏共存，不是点了「加注」才展开出来的独立面板——三态互斥切换
 * （默认/加注面板/全下确认）是改版前的形状，已废弃，`RaiseControl.tsx`
 * 随之删除，逻辑并进这一个组件。
 *
 * 上行是**步进器**，不是滑块：金额框里的数是当前选中额度，四颗加价按钮
 * 往上加，「重置」收回最小额。滑块与底池比例预设在筹码变深之后不可用——
 * 轨道两端相距几千，拖动一像素跳几十刀，选不中想要的数。
 *
 * 全下的二次确认没有丢，只是换了形式：上行只负责"选一个额度"，真正提交
 * 永远要点下行那颗主按钮——选额度与点确认天然是两步，不需要再弹一层专门
 * 的确认面板。主按钮在选中额度等于全部筹码时文案变成「全下 $X」，用户点
 * 之前已经从文案上知道这一下是全下。
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
  // 不然会残留一个已经非法的数字挂在金额框上。
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

  // 金额框与加价档走的是引擎口径的**本次投入额**，而按钮上写的是「加注到 X」
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
          {/* 尺寸全部由 --u 推出来，不用组件自带的固定档。--u 是牌桌的比例
              单位（见 app.css 的 .app-main > *）——整条动作条跟着牌桌缩放，
              换成固定像素会让它在手机上和牌桌脱节 */}
          {RAISE_STEP_CHIPS.map(step => {
            const next = round2(clamped + step / CHIPS_PER_BB);
            // 加过头就禁用，而不是夹到 max：夹到 max 等于点一下 "+$1,000"
            // 就悄悄变成全下，而全下要走它自己那颗按钮。剩余额度不够一档时
            // 这几颗会一起变灰，此时能出的加注本来也只剩全下附近那一点。
            const over = chipsGreater(next, raiseMax);
            return (
              <Button
                key={step}
                size="sm"
                variant="ghost"
                disabled={over}
                className={cn(STEP_BTN, 'border border-input text-secondary-foreground')}
                onClick={() => setAmount(next)}
              >
                +${step.toLocaleString('en-US')}
              </Button>
            );
          })}

          <Button
            size="sm"
            variant={isAllin ? 'outline' : 'ghost'}
            aria-pressed={isAllin}
            className={cn(
              STEP_BTN,
              isAllin
                ? 'border-primary/45 bg-accent text-accent-foreground'
                : 'border border-input text-secondary-foreground',
            )}
            onClick={() => setAmount(raiseMax)}
          >
            全下
          </Button>

          <div className="raise-amount-box">
            {/* 与主按钮印同一个数：两处一旦口径不同，用户没有办法判断该信哪个 */}
            <span className="raise-amount">{chips(isAllin ? clamped : raiseTo)}</span>
            <span className="raise-amount-sep" aria-hidden="true" />
            {/* 加价档只能往上，没有这颗就没有回头路——加过头只能等下一街 */}
            <Button
              variant="ghost"
              size="sm"
              disabled={!chipsGreater(clamped, raiseMin)}
              className="min-h-0 px-0 text-[calc(1.28*var(--u))] font-semibold text-primary hover:bg-transparent hover:underline"
              onClick={() => setAmount(raiseMin)}
            >
              重置
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
