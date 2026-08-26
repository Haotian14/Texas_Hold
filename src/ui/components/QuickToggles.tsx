import { ListOrdered, Percent, Settings, Volume2, VolumeX } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * 右上角那一组图标按钮：胜率读数 · 音效 · 牌型 · 设置。
 *
 * 胜率与音效是**牌桌专属**的显示偏好（胜率读数画在牌桌上、音效是发牌与下注的
 * 声音），所以它们只在牌桌页出现。牌型对照与设置是全局的，所以复盘页与报表页
 * 的页头也各挂这两颗——导航只有三项，这两页没有自己的导航项，一个只能从牌桌
 * 进的全局入口会让人在别的页面找不到它。
 *
 * 牌型对照放这里而不是进导航：它是新手在**牌桌上**打到一半会想翻一眼的东西，
 * 埋进二级页面等于没有；而它又不值得占掉底部三个常驻位置之一。
 *
 * 值仍由 App 持有（见 SettingsPage 顶部那段：两处各读一次 localStorage
 * 会出现「设置页显示开着、牌桌行为是关着」的分叉）。
 */
export function QuickToggles({
  muted,
  onToggleMute,
  showEquity,
  onToggleEquity,
  onHandRanks,
  onSettings,
  /** false 时不渲染胜率与音效（它们是牌桌专属的），用在其他页面的页头 */
  tableToggles = true,
}: {
  muted?: boolean;
  onToggleMute?: () => void;
  showEquity?: boolean;
  onToggleEquity?: () => void;
  /** 不传则不渲染这颗——牌型页自己不需要一个指向自己的入口 */
  onHandRanks?: () => void;
  onSettings: () => void;
  tableToggles?: boolean;
}) {
  return (
    <div className="quick-toggles">
      {tableToggles && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className={cn('quick-btn', showEquity && 'quick-btn-on')}
            onClick={onToggleEquity}
            aria-pressed={showEquity}
            // 图标是 aria-hidden 的，按钮里没有别的文字——可访问名字只能由
            // aria-label 给，且必须随状态翻转
            aria-label={showEquity ? '隐藏胜率' : '显示胜率'}
            title={showEquity ? '隐藏胜率' : '显示胜率'}
          >
            <Percent className="size-[1em]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="quick-btn"
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? '取消静音' : '静音'}
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? <VolumeX className="size-[1em]" /> : <Volume2 className="size-[1em]" />}
          </Button>
        </>
      )}
      {onHandRanks !== undefined && (
        <Button
          variant="ghost"
          size="icon"
          className="quick-btn"
          onClick={onHandRanks}
          aria-label="牌型大小"
          title="牌型大小"
        >
          <ListOrdered className="size-[1em]" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="quick-btn"
        onClick={onSettings}
        aria-label="设置"
        title="设置"
      >
        <Settings className="size-[1em]" />
      </Button>
    </div>
  );
}
