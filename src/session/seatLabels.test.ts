import { describe, it, expect } from 'vitest';
import { personaLabel, seatBadge, personaAvatarLetter, HERO_PERSONA_ID } from './seatLabels';
import { PERSONAS, GTO_PERSONA } from '../ai/personas';

describe('personaLabel', () => {
  it('每个真实 persona 都翻出中文名，没有一个漏成 id', () => {
    for (const p of PERSONAS) {
      const label = personaLabel(p.id);
      expect(label, p.id).toBeTruthy();
      // 关键断言：不能等于 id 本身。id 是英文小写（tag/lag/station…），
      // 漏翻的样子就是牌桌上蹦出一个 "station"。
      expect(label, p.id).not.toBe(p.id);
      expect(label, p.id).toBe(p.name);
    }
    expect(PERSONAS.length).toBeGreaterThan(0);
  });

  it('hero 显示「你」，不是 persona 名 —— 自己不该被标成一个 AI 性格', () => {
    expect(personaLabel(HERO_PERSONA_ID)).toBe('你');
    expect(personaLabel(HERO_PERSONA_ID)).not.toBe(GTO_PERSONA.name);
  });

  it('id 缺失时兜到平衡，而不是抛错或显示 undefined', () => {
    expect(personaLabel(undefined)).toBe(GTO_PERSONA.name);
  });
});

describe('seatBadge', () => {
  it('胶囊内小字位置标记放的是位置本身', () => {
    expect(seatBadge('BTN')).toBe('BTN');
    expect(seatBadge('SB')).toBe('SB');
  });
});

describe('personaAvatarLetter', () => {
  it('每个真实 persona 都能查到头像字，六个各不相同', () => {
    const letters = PERSONAS.map(p => personaAvatarLetter(p.id));
    expect(letters).toEqual(['G', '紧', '松', '跟', '岩', '疯']);
    expect(new Set(letters).size).toBe(PERSONAS.length);
  });

  it('hero 显示 YOU，不是任何一个 persona 的头像字', () => {
    expect(personaAvatarLetter(HERO_PERSONA_ID)).toBe('YOU');
  });

  it('id 缺失时兜到 GTO 原型的头像字', () => {
    expect(personaAvatarLetter(undefined)).toBe(personaAvatarLetter(GTO_PERSONA.id));
  });
});
