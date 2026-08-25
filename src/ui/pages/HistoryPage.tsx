import { useCallback, useEffect, useState } from 'react';
import type { Position, Street } from '../../core/types';
import type { MistakeTag } from '../../review/taxonomy';
import { PREFLOP_TAGS, POSTFLOP_TAGS } from '../../review/taxonomy';
import type { StoredHand } from '../../storage/schema';
import type { HandFilter } from '../../storage/filter';
import { listHands, storageStatus } from '../../storage/repo';
import { handGrade, TAG_TEXT } from '../reviewModel';
import { chips, dateText } from '../format';
import { chipsGreater } from '../../core/chips';

const PAGE_SIZE = 30;

const POSITIONS: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const STREETS: readonly { id: Street; label: string }[] = [
  { id: 'preflop', label: '翻前' },
  { id: 'flop', label: '翻牌' },
  { id: 'turn', label: '转牌' },
  { id: 'river', label: '河牌' },
];
const ALL_TAGS: readonly MistakeTag[] = [...PREFLOP_TAGS, ...POSTFLOP_TAGS];

type SortBy = 'worstEvLoss' | 'timestamp';

/** 空列表的四种原因，各说各的话 */
type Empty = 'loading' | 'unavailable' | 'no-data' | 'no-match';

function Row({ hand, onOpen }: { hand: StoredHand; onOpen: (h: StoredHand) => void }) {
  const net = hand.record.results.find(r => r.seat === hand.record.heroSeat)?.netBB ?? 0;
  const isNeg = chipsGreater(0, net);
  const grade = hand.view === null ? null : handGrade(hand.view);

  return (
    <button type="button" className="hist-row" onClick={() => onOpen(hand)}>
      <span
        className={`rv-dot rv-dot-${grade === null ? 'unknown' : grade.grade}`}
        aria-hidden="true"
      />
      <span className="hist-pos">{hand.heroPosition}</span>
      <span className={`hist-net ${isNeg ? 'neg' : 'pos'}`}>
        {isNeg ? '' : '+'}
        {chips(net)}
      </span>
      <span className="hist-loss">
        {hand.view === null ? '分析失败' : `损失 ${hand.worstEvLoss.toFixed(1)} BB`}
      </span>
      <span className="hist-tags">
        {hand.mistakeTags.slice(0, 2).map(t => (
          <span key={t} className="hist-tag">
            {TAG_TEXT[t]}
          </span>
        ))}
        {hand.mistakeTags.length > 2 && (
          <span className="hist-tag hist-tag-more">+{hand.mistakeTags.length - 2}</span>
        )}
      </span>
      {hand.disputed && <span className="hist-disputed">有异议</span>}
      <span className="hist-time">{dateText(hand.timestamp)}</span>
    </button>
  );
}

/**
 * 历史页（规格 §10.4）。
 *
 * 默认按 worstEvLoss 倒序——规格明写的默认排序。理由与漏洞榜同源：一个 3 BB
 * 的大错比十个 0.3 BB 的小偏差更该先看到，按时间排会把它埋在最近打的一堆
 * 平淡手里。
 */
export function HistoryPage({
  onOpen,
  patched,
}: {
  onOpen: (hand: StoredHand) => void;
  /**
   * 刚在复盘卡片里被改过的那一手（目前只有 disputed 会变）。
   *
   * 用逐行替换而不是整列重取：重取会把用户「加载更多」翻出来的页全部丢掉，
   * 而改的只是一个布尔标注。列表短，每次渲染 map 一遍的代价可以忽略。
   */
  patched: StoredHand | null;
}) {
  const [sortBy, setSortBy] = useState<SortBy>('worstEvLoss');
  const [filter, setFilter] = useState<HandFilter>({});
  const [rows, setRows] = useState<StoredHand[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [empty, setEmpty] = useState<Empty>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  // 排序或筛选一变就整列重取。用一个自增的 token 拦住过期请求：
  // 快速连点筛选时，先发的请求可能后到，把新条件的结果覆盖掉。
  const [token, setToken] = useState(0);
  const reload = useCallback(() => setToken(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setEmpty('loading');
    void listHands({ sortBy, filter, limit: PAGE_SIZE }).then(page => {
      if (cancelled) return;
      setRows(page.rows);
      setNextOffset(page.nextOffset);
      if (page.rows.length > 0) {
        setEmpty('no-data'); // 有数据时这个值用不到，占位
      } else if (storageStatus() === 'unavailable') {
        setEmpty('unavailable');
      } else {
        // 「一手都没有」和「筛没了」是两回事，必须说不同的话：
        // 前者要说明手牌打完才会入库，后者要提示清掉筛选条件
        setEmpty(Object.keys(filter).length === 0 ? 'no-data' : 'no-match');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sortBy, filter, token]);

  const loadMore = useCallback(() => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    void listHands({ sortBy, filter, limit: PAGE_SIZE, offset: nextOffset }).then(page => {
      setRows(prev => [...prev, ...page.rows]);
      setNextOffset(page.nextOffset);
      setLoadingMore(false);
    });
  }, [sortBy, filter, nextOffset, loadingMore]);

  function patch(p: Partial<HandFilter>) {
    setFilter(prev => {
      const next = { ...prev, ...p };
      // null 的项直接删掉，让 isFilterEmpty 与「筛没了」的判断都基于键的有无
      for (const k of Object.keys(next) as (keyof HandFilter)[]) {
        if (next[k] === null || next[k] === undefined) delete next[k];
      }
      return next;
    });
  }

  // 把被改过的那一手贴回列表。放在渲染里算而不是写进 rows，是为了让
  // rows 始终等于"库里读出来的那一页"，只有这一处知道有覆盖这回事。
  const shown =
    patched === null ? rows : rows.map(r => (r.id === patched.id ? patched : r));

  return (
    <div className="hist">
      <header className="hist-head">
        <h2 className="hist-title">历史</h2>
        <div className="hist-sort">
          <button
            type="button"
            className={sortBy === 'worstEvLoss' ? 'pill pill-on' : 'pill'}
            onClick={() => setSortBy('worstEvLoss')}
          >
            按最大损失
          </button>
          <button
            type="button"
            className={sortBy === 'timestamp' ? 'pill pill-on' : 'pill'}
            onClick={() => setSortBy('timestamp')}
          >
            按时间
          </button>
        </div>
      </header>

      <div className="hist-filters">
        <select
          aria-label="按位置筛选"
          value={filter.position ?? ''}
          onChange={e => patch({ position: (e.target.value || null) as Position | null })}
        >
          <option value="">全部位置</option>
          {POSITIONS.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          aria-label="按街道筛选"
          value={filter.street ?? ''}
          onChange={e => patch({ street: (e.target.value || null) as Street | null })}
        >
          <option value="">全部街道</option>
          {STREETS.map(s => (
            <option key={s.id} value={s.id}>
              {s.label}有失误
            </option>
          ))}
        </select>

        <select
          aria-label="按失误分类筛选"
          value={filter.tag ?? ''}
          onChange={e => patch({ tag: (e.target.value || null) as MistakeTag | null })}
        >
          <option value="">全部分类</option>
          {ALL_TAGS.map(t => (
            <option key={t} value={t}>
              {TAG_TEXT[t]}
            </option>
          ))}
        </select>

        <select
          aria-label="按是否有异议筛选"
          value={filter.disputed === undefined ? '' : String(filter.disputed)}
          onChange={e =>
            patch({ disputed: e.target.value === '' ? null : e.target.value === 'true' })
          }
        >
          <option value="">不限异议</option>
          <option value="true">只看有异议</option>
          <option value="false">只看无异议</option>
        </select>

        {Object.keys(filter).length > 0 && (
          <button type="button" className="pill" onClick={() => setFilter({})}>
            清除筛选
          </button>
        )}
      </div>


      {shown.length > 0 ? (
        <>
          <div className="hist-list">
            {shown.map(h => (
              <Row key={h.id} hand={h} onOpen={onOpen} />
            ))}
          </div>
          {nextOffset !== null && (
            <button type="button" className="btn hist-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </>
      ) : (
        <p className="hist-empty">
          {empty === 'loading' && '读取中…'}
          {empty === 'unavailable' && (
            <>
              本机存储不可用（隐私模式或配额已满），历史无法读取。牌局不受影响。
              <button type="button" className="pill hist-retry" onClick={reload}>
                重试
              </button>
            </>
          )}
          {empty === 'no-data' && '还没有记录。每打完一手就会自动存下来。'}
          {empty === 'no-match' && '没有符合这些条件的手牌。'}
        </p>
      )}
    </div>
  );
}
