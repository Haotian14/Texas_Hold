/**
 * 6-max 100BB 翻前范围表。
 *
 * 每个节点只列出非 fold 动作，fold 为补集，因此各动作频率之和恒为 1。
 * 数据为公开 GTO 近似范围的整理，初版以纯策略为主（频率 0 或 1），
 * 仅在公认的边界手牌上使用混合频率。
 *
 * 后续可整体替换为更精细的数据，查询接口与本文件的格式保持不变。
 */
export const PREFLOP_NODES: Record<string, Partial<Record<string, string>>> = {
  // ── 首次进池（RFI）。BB 无 RFI 节点：前面全弃牌时大盲直接获胜。
  UTG_rfi: {
    raise: '55+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo',
  },
  HJ_rfi: {
    raise: '44+, A7s+, A5s-A3s, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+',
  },
  CO_rfi: {
    raise: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QJo',
  },
  BTN_rfi: {
    raise: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
  },
  SB_rfi: {
    raise: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, A2o+, K9o+, QTo+, JTo',
  },

  // ── 面对单一开池：大盲防守
  BB_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo:0.5',
    call: '22-JJ, AQs-A6s, A4s-A2s, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-ATo, KJo+, QJo',
  },
  BB_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: '22-TT, AJs-A6s, A3s-A2s, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-ATo, KTo+, QTo+, JTo',
  },
  BB_vs_CO_open: {
    '3bet': 'TT+, AJs+, A5s-A3s, KQs, AQo+',
    call: '22-99, ATs-A6s, A2s, KJs-K4s, Q7s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, AJo-A8o, K9o+, Q9o+, J9o+, T9o',
  },
  BB_vs_BTN_open: {
    '3bet': '88+, ATs+, A5s-A2s, KJs+, AJo+, KQo',
    call: '22-77, A9s-A6s, KTs-K2s, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, ATo-A2o, KJo-K8o, Q8o+, J8o+, T8o, 98o, 87o',
  },
  BB_vs_SB_open: {
    '3bet': '77+, A9s+, A5s-A2s, KTs+, QTs+, JTs, ATo+, KJo+',
    call: '22-66, A8s-A6s, K9s-K2s, Q9s-Q5s, J9s-J6s, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, A9o-A2o, KTo-K9o, Q9o+, J9o+, T9o, 98o',
  },

  // ── 面对单一开池：按钮位防守
  BTN_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo',
    call: '22-JJ, AJs-ATs, KTs+, QTs+, JTs, T9s, 98s, AQo',
  },
  BTN_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: '22-TT, A9s-AJs, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, AQo-AJo, KQo',
  },
  BTN_vs_CO_open: {
    '3bet': '99+, ATs+, A5s-A4s, KJs+, AQo+',
    call: '22-88, A9s-A6s, A3s-A2s, KTs-K9s, QTs+, J9s+, T9s, 98s, 87s, 76s, AJo-ATo, KQo',
  },

  // ── 面对单一开池：小盲防守（位置劣势，3bet 更多、跟注更少）
  SB_vs_CO_open: {
    '3bet': 'TT+, ATs+, A5s-A3s, KJs+, AQo+',
    call: '77-99, A9s, KTs, QTs+, JTs, T9s',
  },
  SB_vs_BTN_open: {
    '3bet': '88+, A9s+, A5s-A2s, KTs+, QTs+, JTs, ATo+, KJo+',
    call: '22-77, A8s-A6s, K9s, Q9s, J9s, T9s, 98s',
  },

  // ── 面对 3bet（开池者视角）
  UTG_vs_BB_3bet: {
    '4bet': 'QQ+, AKs, A5s:0.5',
    call: 'JJ-99, AQs-AJs, KQs, AKo',
  },
  CO_vs_BTN_3bet: {
    '4bet': 'QQ+, AKs, A5s-A4s',
    call: 'JJ-88, AQs-ATs, KQs-KJs, QJs, JTs, T9s, AKo-AQo',
  },
  BTN_vs_BB_3bet: {
    '4bet': 'JJ+, AKs, A5s-A4s, AKo',
    call: 'TT-66, AQs-A9s, KQs-KTs, QJs-QTs, JTs, T9s, 98s, AQo-AJo, KQo',
  },
  BTN_vs_SB_3bet: {
    '4bet': 'JJ+, AKs, A5s-A4s, AKo',
    call: 'TT-77, AQs-ATs, KQs-KJs, QJs, JTs, T9s, AQo-AJo, KQo',
  },
};
