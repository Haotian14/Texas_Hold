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
 * 座位头像方块里的字。
 *
 * 设计稿放的是名字缩写（`wide_lag` → WL），纯装饰。这里改放**位置**——
 * 在扑克里"这个人坐在哪"比"他叫什么"重要得多：同一个性格在 UTG 和在 BTN
 * 是两种威胁。名字仍在旁边一行，信息一个没少，装饰位换成了有用的东西。
 */
export function seatBadge(position: Position): string {
  return position;
}
