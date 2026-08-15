import type { ActionType } from '../core/types';
import { chipsGreater } from '../core/chips';

export type SoundName =
  | 'chip-light'
  | 'chip-heavy'
  | 'deal-card'
  | 'board-flip'
  | 'fold'
  | 'check'
  | 'pot-win'
  | 'allin';

/**
 * 动作 → 音效。amount 与 pot 都是 BB。
 *
 * 轻重按**相对底池**分界而不是绝对金额：同样 2BB，在 3.5BB 的池里是
 * 大注，在 100BB 的池里是零头，绝对金额分不出这个差别。
 *
 * 穷尽 switch，不返回 null——六个动作类型每个都有音效。将来 ActionType
 * 若新增成员，这里会编译失败，比静默少播一个音效要好。「不播声音」的
 * 场景（如开局那一刻没有动作）由调用方守卫，不由本函数表达。
 */
export function soundFor(type: ActionType, amount: number, pot: number): SoundName {
  switch (type) {
    case 'fold':
      return 'fold';
    case 'check':
      return 'check';
    case 'allin':
      return 'allin';
    case 'bet':
    case 'raise':
    case 'call': {
      const halfPot = pot / 2;
      // chipsGreater(halfPot, amount) 为真即 amount < halfPot（轻）；
      // 相等归入重注。禁止裸 >= ，见 Global Constraints。
      return chipsGreater(halfPot, amount) ? 'chip-light' : 'chip-heavy';
    }
  }
}
