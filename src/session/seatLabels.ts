import { getPersona, GTO_PERSONA } from '../ai/personas';
import type { Position } from '../core/types';

/**
 * 座位的展示标签。
 *
 * 存在的唯一理由是**分层**：persona 的中文名住在 `src/ai/personas.ts`，而
 * `src/ui/` 不该直接从 AI 层取值（见 architecture.test.ts 的守卫，以及它守着
 * 的那条更大的规矩——界面不参与牌局判断）。让这一层做 id → 文案的翻译，
 * UI 只消费字符串。
 *
 * 顺带把「hero 座位没有 persona」这件事收在一处：handSession 给 hero 记的
 * personaId 是字面量 'hero'，不是任何一个真实 persona 的 id，getPersona 对它
 * 会落到兜底分支。调用点每处各判一次早晚会漏。
 */

/** hero 座位在 personaIds 里的哨兵值（见 handSession.ts::startHand） */
export const HERO_PERSONA_ID = 'hero';

/**
 * persona id → 面向用户的名字。
 *
 * hero 显示「你」而不是 persona 名：hero 的范围虽然按 GTO_PERSONA 建模，
 * 但那是引擎内部的事，界面上把自己标成「平衡」只会让人以为那是个 AI。
 */
export function personaLabel(personaId: string | undefined): string {
  if (personaId === undefined) return GTO_PERSONA.name;
  if (personaId === HERO_PERSONA_ID) return '你';
  return getPersona(personaId).name;
}

/**
 * 座位胶囊里的小字位置标记（BTN/SB/…）。
 *
 * 曾经这个值放在头像方块里代替名字缩写（"在扑克里坐在哪比叫什么重要"）。
 * 头像方块现在改放性格首字（见 personaAvatarLetter），位置退回胶囊内的一枚
 * 小标记——信息一个没少，只是换了个位置：性格是"这个人怎么打"，位置是
 * "他现在坐在哪"，两者都要留，缺哪个都会让读桌变难。
 */
export function seatBadge(position: Position): string {
  return position;
}

/**
 * persona id → 头像方块里的字（一个汉字，或 hero 的固定标记）。
 *
 * 不用"姓名首字母"那种通用算法（取 persona.name 的第一个字）：GTO 原型的
 * 中文名是"平衡"，首字"平"和缩写"GTO"对不上号，这张表由产品直接指定
 * 六个字，逐个对应，不做推导。
 */
const AVATAR_LETTERS: Readonly<Record<string, string>> = {
  gto: 'G',
  tag: '紧',
  lag: '松',
  station: '跟',
  rock: '岩',
  maniac: '疯',
};

export function personaAvatarLetter(personaId: string | undefined): string {
  if (personaId === HERO_PERSONA_ID) return 'YOU';
  const id = personaId === undefined ? GTO_PERSONA.id : getPersona(personaId).id;
  return AVATAR_LETTERS[id] ?? getPersona(id).name.slice(0, 1);
}
