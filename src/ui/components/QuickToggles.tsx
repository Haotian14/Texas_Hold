import { Percent, Settings, Volume2, VolumeX } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * 右上角那一组图标按钮：胜率读数 · 音效 · 设置。
 *
 * 前两项是**牌桌专属**的显示偏好（胜率读数画在牌桌上、音效是发牌与下注的
 * 声音），所以它们只在牌桌页出现。设置是全局的，所以复盘页与报表页的页头
 * 也各挂一颗齿轮——导航从四项收成三项之后，设置不再有自己的导航项，
 * 一个只能从牌桌进的全局入口会让人在复盘页找不到它。
 *
 * 值仍由 App 持有（见 SettingsPage 顶部那段：两处各读一次 localStorage
 * 会出现「设置页显示开着、牌桌行为是关着」的分叉）。
 */
export function QuickToggles({
  muted,
  onToggleMute,
  showEquity,
  onToggleEquity,
  onSettings,
  /** false 时只渲染设置齿轮，用在复盘页与报表页的页头 */
  tableToggles = true,
}: {
  muted?: boolean;
  onToggleMute?: () => void;
  showEquity?: boolean;
  onToggleEquity?: () => void;
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
