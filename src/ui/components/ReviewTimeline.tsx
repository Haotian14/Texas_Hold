import { useState } from 'react';
import { chipsGreater } from '../../core/chips';
import type { Severity } from '../../review/taxonomy';
import type { StreetGroup } from '../reviewModel';
import { ACTION_TEXT } from '../format';
import { ReviewDecision } from './ReviewDecision';

/**
 * severity → 文字标签。颜色不是唯一编码。
 *
 * 用 Record<Severity, …> 而不是 if 链比 string：Severity 将来加一档时
 * 这里是编译错误，if 链只会静悄悄落到「没问题」——把新的失误档显示成
 * 没打错，正是本卡片最不能犯的错。
 */
const SEV_TEXT: Record<Severity, string> = {
  ok: '没问题',
  minor: '小偏差',
  notable: '明显失误',
  severe: '重大失误',
};

/** severity → CSS 类名后缀。degraded 单独一档，不复用 ok */
function dotClass(degraded: boolean, severity: Severity): string {
  return `rv-dot rv-dot-${degraded ? 'unknown' : severity}`;
}

function dotText(degraded: boolean, severity: Severity): string {
  return degraded ? '无法判定' : SEV_TEXT[severity];
}

/**
 * 街道时间线。展开状态用 TimelineRow.index（决策点在 decisions 里的
 * 原下标）做 key，不是行的名次 —— 见 reviewModel.timelineOf 的注释。
 */
export function ReviewTimeline({ groups }: { groups: StreetGroup[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (groups.length === 0) {
    return <p className="rv-empty">本手没有可判定的决策点。</p>;
  }

  return (
    <div className="rv-timeline">
      {groups.map(g => (
        <section className="rv-street" key={g.street}>
          <h3 className="rv-street-name">{g.label}</h3>
          {g.rows.map(({ decision: d, index }) => (
            <div className="rv-item" key={index}>
              <button
                className="rv-row"
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                <span className={dotClass(d.degraded, d.severity)} aria-hidden="true" />
                <span className="rv-act">
                  {ACTION_TEXT[d.actual.type]}
                  {chipsGreater(d.actual.amount, 0) ? ` ${d.actual.amount.toFixed(1)} BB` : ''}
                </span>
                <span className="rv-sev">{dotText(d.degraded, d.severity)}</span>
              </button>
              {open === index ? <ReviewDecision d={d} /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
