import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import { hasNode } from '../core/ranges';
import { preflopNodeFor } from './preflopNode';

/** 循环上限：6 人桌翻前最多 6 次行动即可走完一整轮，留足余量防止真死循环挂起测试 */
const SEAT_COUNT_GUARD = 20;

describe('preflopNodeFor', () => {
  it('首个行动者是开池节点', () => {
    const s = startHand({ seed: 'node-1', buttonSeat: 0 });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('rfi');
    expect(n.opener).toBeNull();
    expect(hasNode(n.key)).toBe(true);
  });

  it('一次加注之后是面对开池节点，且记下开池者位置', () => {
    let s = startHand({ seed: 'node-2', buttonSeat: 0 });
    const openerPos = s.seats.find(x => x.seat === s.toAct)!.position;
    s = applyAction(s, { type: 'raise', amount: 3 });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('vs-open');
    expect(n.opener).toBe(openerPos);
  });

  // 计划原文用 while+break 构造两次加注的状态，并把断言包在 if (n) 里——
  // 这样即使 n 是 null，测试也会"通过"而什么都没断言。这里改成确定性构造：
  // UTG 开池后，让其余四家依次弃牌到大盲，大盲 3bet，行动权必然回到 UTG
  // （其余四家已弃牌，桌上只剩 UTG/BB 两个活跃座位）。产生的节点是
  // UTG_vs_BB_3bet —— 范围表里确有此节点（见 src/core/ranges/data.ts），
  // 断言不再需要任何 if 保护。
  it('两次加注之后是面对 3bet 节点', () => {
    let s = startHand({ seed: 'node-3', buttonSeat: 0 });
    const opener = s.seats.find(x => x.seat === s.toAct)!; // UTG，先手
    s = applyAction(s, { type: 'raise', amount: 3 });

    let guard = 0;
    while (s.seats.find(x => x.seat === s.toAct)!.position !== 'BB') {
      expect(guard++).toBeLessThan(SEAT_COUNT_GUARD);
      s = applyAction(s, { type: 'fold' });
    }
    s = applyAction(s, { type: 'raise', amount: 9 }); // BB 3bet

    expect(s.toAct).toBe(opener.seat);

    const n = preflopNodeFor(s);
    expect(n).not.toBeNull();
    expect(n!.kind).toBe('vs-3bet');
    expect(n!.opener).toBe('BB');
    expect(n!.key).toBe('UTG_vs_BB_3bet');
    expect(hasNode(n!.key)).toBe(true);
  });

  // brief 原文用 guard<20 的 while 循环推进到翻后，再把断言包在
  // if (s.street !== 'preflop') 里——如果循环没能走出翻前，测试同样会
  // "通过"而不断言。这里把断言拆成两条：先无条件断言真的到了翻牌
  // （证明循环確实推进了牌局），再断言 preflopNodeFor 返回 null。
  it('翻后返回 null', () => {
    let s = startHand({ seed: 'node-4', buttonSeat: 0 });
    let guard = 0;
    while (s.street === 'preflop' && !s.handOver) {
      expect(guard++).toBeLessThan(SEAT_COUNT_GUARD);
      const canCheck = legalActions(s).some(a => a.type === 'check');
      s = applyAction(s, canCheck ? { type: 'check' } : { type: 'call' });
    }
    expect(s.street).toBe('flop');
    expect(preflopNodeFor(s)).toBeNull();
  });

  it('跛入不计作加注 —— 全跛到大盲仍是开池节点族', () => {
    let s = startHand({ seed: 'node-5', buttonSeat: 0 });
    s = applyAction(s, { type: 'call' });
    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('rfi');
  });
});
