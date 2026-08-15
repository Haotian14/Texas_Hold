import { useEffect, useState } from 'react';
import type { ActionInput } from '../../core/gameEngine';
import type { ActionBarModel } from '../../session/actionBarModel';
import { chips } from '../format';
import { RaiseControl } from './RaiseControl';

type Panel = 'none' | 'raise' | 'allin';

export function ActionBar({
  model,
  onAction,
}: {
  model: ActionBarModel;
  onAction: (input: ActionInput) => void;
}) {
  const [panel, setPanel] = useState<Panel>('none');

  // 轮到别人时把展开的面板收起来，防止下一次轮到自己时残留旧面板
  useEffect(() => {
    if (!model.enabled) setPanel('none');
  }, [model.enabled]);

  if (!model.enabled) {
    return (
      <div className="actionbar actionbar-idle">
        <span className="waiting">等待其他玩家…</span>
      </div>
    );
  }

  if (panel === 'raise' && model.raise) {
    return (
      <div className="actionbar">
        <RaiseControl
          model={model.raise}
          label={model.raise.type === 'bet' ? '下注' : '加注'}
          onCancel={() => setPanel('none')}
          onSubmit={amount => {
            setPanel('none');
            onAction({ type: model.raise!.type, amount });
          }}
        />
      </div>
    );
  }

  if (panel === 'allin' && model.allin) {
    return (
      <div className="actionbar">
        <div className="confirm">
          <span className="confirm-text">全下 {chips(model.allin.amount)}？</span>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setPanel('none')}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setPanel('none');
                onAction({ type: 'allin' });
              }}
            >
              确认全下
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="actionbar">
      <div className="actionbar-row">
        {model.fold && (
          <button className="btn btn-ghost" onClick={() => onAction({ type: 'fold' })}>
            弃牌
          </button>
        )}
        {model.passive && (
          <button
            className="btn btn-primary"
            onClick={() => onAction({ type: model.passive!.type })}
          >
            {model.passive.type === 'check'
              ? '过牌'
              : `跟注 ${chips(model.passive.amount)}`}
          </button>
        )}
        {model.raise && (
          <button className="btn btn-primary" onClick={() => setPanel('raise')}>
            {model.raise.type === 'bet' ? '下注' : '加注'}
          </button>
        )}
        {model.allin && (
          <button className="btn btn-danger" onClick={() => setPanel('allin')}>
            全下
          </button>
        )}
      </div>
    </div>
  );
}
