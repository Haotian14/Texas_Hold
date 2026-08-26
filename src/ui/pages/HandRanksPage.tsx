import { CardView } from '../components/Card';
import { QuickToggles } from '../components/QuickToggles';
import { HAND_RANKS, handRankName } from '../handRankModel';

/**
 * 牌型大小对照（新手用）。
 *
 * 从大到小列出九档牌型，每档给一个五张牌的示例。示例牌与顺序都由
 * `handRankModel` 提供，而那一份有测试拿引擎（evaluate5Slow）逐行验过——
 * 这一页只负责渲染，不做任何"哪个更大"的判断。
 *
 * 不做搜索、不做交互：新手在牌桌上翻开它就是为了扫一眼，任何需要先操作
 * 一下才能看到内容的设计都是在帮倒忙。
 */
export function HandRanksPage({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="hr">
      <header className="hr-head">
        <div>
          <h2 className="hr-title">牌型</h2>
          <div className="hr-sub">从大到小，上面的赢下面的</div>
        </div>
        <QuickToggles tableToggles={false} onSettings={onSettings} />
      </header>

      <ol className="hr-list">
        {HAND_RANKS.map((row, i) => (
          <li key={row.category} className="hr-row">
            <span className="hr-seq" aria-hidden="true">
              {i + 1}
            </span>
            <div className="hr-body">
              <div className="hr-name">{handRankName(row.category)}</div>
              <div className="hr-cards">
                {row.cards.map(c => (
                  <CardView key={`${c.rank}${c.suit}`} card={c} size="md" />
                ))}
              </div>
              <p className="hr-note">{row.note}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* 同一档里怎么比，是新手看完这张表之后必然会问的下一个问题。
          不解释的话，他会以为「两个人都是一对就平分」。 */}
      <section className="hr-tail">
        <h3 className="hr-tail-title">两个人牌型一样时</h3>
        <p className="hr-tail-note">
          先比构成牌型的那几张：都是一对时比对子大小，都是同花时比最大的那张。
          还相同就依次比剩下的牌（叫「踢脚」）。五张全一样才平分底池。
        </p>
        <p className="hr-tail-note">
          手上两张与公共牌五张里，<strong>任选五张</strong>组成最大的牌型——
          用不用得上手牌都可以，七张里最好的那五张说了算。
        </p>
      </section>
    </div>
  );
}
