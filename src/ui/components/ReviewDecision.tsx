import type { DecisionAnalysis } from '../../review/types';
import { chipsGreater } from '../../core/chips';
import { barsOf } from '../reviewModel';
import { EvBars } from './EvBars';

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 一行「名称 值」 */
function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="rv-stat">
      <span className="rv-stat-name">{name}</span>
      <span className="rv-stat-value">{value}</span>
    </div>
  );
}

/**
 * 单个决策点展开后的详情。
 *
 * degraded 分支是显式的 if，而不是靠「反正那些字段是 null，渲染出来是空」——
 * 把正确性寄托在上游置空上，等于让 review/types.ts 的注释成为唯一的防线。
 * 降级时只允许出现底池、待跟注、所需胜率（纯底池几何，与对手范围无关）。
 */
export function ReviewDecision({ d }: { d: DecisionAnalysis }) {
  const s = d.situation;
  return (
    <div className="rv-detail">
      <div className="rv-stats">
        <Stat name="底池" value={`${s.pot.toFixed(1)} BB`} />
        <Stat name="待跟注" value={`${s.toCall.toFixed(1)} BB`} />
        {d.requiredEquity !== null ? (
          <Stat name="所需胜率" value={pct(d.requiredEquity)} />
        ) : null}
        {!d.degraded && d.heroEquity !== null ? (
          <Stat name="你的胜率" value={pct(d.heroEquity)} />
        ) : null}
      </div>

      {d.degraded ? (
        <p className="rv-text rv-degraded">{d.explanation}</p>
      ) : (
        <>
          <EvBars chart={barsOf(d)} />
          {d.recommended !== null ? (
            <div className="rv-rec">
              推荐：{d.recommended.label}
              {/* evLoss 是 BB 金额，用 chipsGreater 而不是裸 >（见 Global Constraints） */}
              {chipsGreater(d.evLoss, 0) ? `　损失 ${d.evLoss.toFixed(2)} BB` : ''}
            </div>
          ) : null}
          {d.tag !== null ? <div className="rv-tag">{d.tag}</div> : null}
          <p className="rv-text">{d.explanation}</p>
        </>
      )}
    </div>
  );
}
