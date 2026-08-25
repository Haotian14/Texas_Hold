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
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

const PAGE_SIZE = 30;

/**
 * 「不筛这一项」的哨兵值。
 *
 * 不能用空串：Radix 的 Select 拿空串表示"没有选中任何项"，一个 value="" 的
 * Item 会被它当成清空指令并直接报错。原来那四个筛选器的「全部位置/全部街道」
 * 用的正是空串——换成自绘下拉时这是必须动的一处，不是风格问题。
 *
 * 这个值只活在界面里，`patch()` 会把它翻回 null，交给存储层的条件里永远
 * 不会出现它。
 */
const ALL = '__all__';

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
          {(
            [
              ['worstEvLoss', '按最大损失'],
              ['timestamp', '按时间'],
            ] as const
          ).map(([id, text]) => (
            <Button
              key={id}
              size="sm"
              variant={sortBy === id ? 'outline' : 'ghost'}
              className={sortBy === id ? 'bg-accent text-accent-foreground border-transparent' : ''}
              aria-pressed={sortBy === id}
              onClick={() => setSortBy(id)}
            >
              {text}
            </Button>
          ))}
        </div>
      </header>

      <div className="hist-filters">
        <Select
          value={filter.position ?? ALL}
          onValueChange={v => patch({ position: v === ALL ? null : (v as Position) })}
        >
          <SelectTrigger aria-label="按位置筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部位置</SelectItem>
            {POSITIONS.map(p => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.street ?? ALL}
          onValueChange={v => patch({ street: v === ALL ? null : (v as Street) })}
        >
          <SelectTrigger aria-label="按街道筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部街道</SelectItem>
            {STREETS.map(s => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}有失误
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.tag ?? ALL}
          onValueChange={v => patch({ tag: v === ALL ? null : (v as MistakeTag) })}
        >
          <SelectTrigger aria-label="按失误分类筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部分类</SelectItem>
            {ALL_TAGS.map(t => (
              <SelectItem key={t} value={t}>
                {TAG_TEXT[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.disputed === undefined ? ALL : String(filter.disputed)}
          onValueChange={v => patch({ disputed: v === ALL ? null : v === 'true' })}
        >
          <SelectTrigger aria-label="按是否有异议筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>不限异议</SelectItem>
            <SelectItem value="true">只看有异议</SelectItem>
            <SelectItem value="false">只看无异议</SelectItem>
          </SelectContent>
        </Select>

        {Object.keys(filter).length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setFilter({})}>
            清除筛选
          </Button>
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
            <Button variant="outline" className="hist-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '加载更多'}
            </Button>
          )}
        </>
      ) : (
        <p className="hist-empty">
          {empty === 'loading' && '读取中…'}
          {empty === 'unavailable' && (
            <>
              本机存储不可用（隐私模式或配额已满），历史无法读取。牌局不受影响。
              <Button variant="outline" size="sm" className="hist-retry" onClick={reload}>
                重试
              </Button>
            </>
          )}
          {empty === 'no-data' && '还没有记录。每打完一手就会自动存下来。'}
          {empty === 'no-match' && '没有符合这些条件的手牌。'}
        </p>
      )}
    </div>
  );
}
