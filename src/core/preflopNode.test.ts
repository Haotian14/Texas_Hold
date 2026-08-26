import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from './gameEngine';
import { hasNode } from './ranges';
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

  // ───────────────────────────────────────────────────────────────────────
  // "phantom open" 缺陷复现与回归（评审发现④）：raises 原来只按
  // `a.type === 'raise' || a.type === 'allin'` 过滤，分不清"真正推高
  // currentBet 的加注"与"筹码不够、被迫按当前下注跟出的 call-for-less"。
  // UTG 用 0.8 BB（小于大盲 1 BB）全下时，这是一次跟注不是加注——currentBet
  // 应该维持在 1，不动——但旧实现会把它计成一次加注，让 HJ 的节点从
  // HJ_rfi 变成 HJ_vs_UTG_open，带来三重后果（见任务书）：HJ 开池过宽被
  // 误判成"面对加注又加注"；HJ 的真实开池被错误地按 3bet 查频率表（查到
  // 频率 0，回落成纯 EV 判定）；HJ 跛入会命中 HJ_vs_UTG_open.call 的频率
  // 短路，一个真实失误被静默判成"没问题"（fail open）。
  // ───────────────────────────────────────────────────────────────────────
  it('UTG 筹码不足以覆盖大盲（0.8 BB）的自愿全下不推高 currentBet，不计入加注 —— HJ 仍看到开池节点，不是 phantom open（评审发现④）', () => {
    let s = startHand({ seed: 'node-6', buttonSeat: 0, startingStacks: [100, 100, 100, 0.8, 100, 100] });
    expect(s.toAct).toBe(3); // UTG，先手
    expect(s.currentBet).toBe(1); // 大盲注额

    s = applyAction(s, { type: 'allin' }); // UTG 筹码不够跟平大盲，被迫全下（call-for-less）
    expect(s.currentBet).toBe(1); // 没有真正的加注，currentBet 维持不变——这是 phantom open 的物理前提
    expect(s.toAct).toBe(4); // 行动权转到 HJ

    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('rfi'); // HJ 看到的仍是"还没有人开池"，不是 vs-open
    expect(n.opener).toBeNull();
  });

  it('UTG 筹码充足的自愿全下正常推高 currentBet，仍计入加注 —— 不因修复 phantom open 而把真实开池也误判成未开池', () => {
    let s = startHand({ seed: 'node-7', buttonSeat: 0 }); // 默认起始筹码，UTG 有 100 BB
    expect(s.toAct).toBe(3); // UTG，先手
    const utgPos = s.seats.find(x => x.seat === 3)!.position;
    expect(utgPos).toBe('UTG');

    s = applyAction(s, { type: 'allin' }); // UTG 自愿把加注封顶到底（100 BB），真正提高了 currentBet
    expect(s.currentBet).toBeGreaterThan(1);
    expect(s.toAct).toBe(4); // 行动权转到 HJ

    const n = preflopNodeFor(s)!;
    expect(n.kind).toBe('vs-open'); // 真实开池，HJ 应该看到 vs-open
    expect(n.opener).toBe('UTG');
  });
});
