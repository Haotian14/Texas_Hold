import { chipDenominations } from '../format';

/**
 * 面额筹码堆。纯展示，无逻辑——拆分在 format.ts 的 chipDenominations 里。
 *
 * aria-hidden：金额已由相邻的文字节点念出，筹码只是同一信息的图形重复，
 * 让读屏软件念一串无意义的空 span 是噪音。
 */
export function Chips({ bb }: { bb: number }) {
  const denoms = chipDenominations(bb);
  if (denoms.length === 0) return null;
  return (
    <span className="chip-stack" aria-hidden="true">
      {denoms.map((d, i) => (
        <span key={i} className={`chip chip-d${d}`} />
      ))}
    </span>
  );
}
