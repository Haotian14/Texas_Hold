import { useId, useState } from 'react';
import type { AiMode } from '../prefs';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { allHands, importHands, resetAll, storageStatus } from '../../storage/repo';
import { buildTransfer, parseTransfer, transferFileName } from '../../storage/transfer';

/**
 * 设置页（spec §10.6）。
 *
 * 开关本身的状态由 App 持有并落 localStorage —— 这一页只负责渲染与回调，
 * 不自己读偏好。理由与胜率开关一样：牌桌那边要用同一个值，两处各读一次
 * localStorage 就会出现「设置页显示开着、牌桌行为是关着」的分叉。
 *
 * 数据区（导出/导入/重置）反过来自己管：它不产生任何要给牌桌用的状态，
 * 只有一句回执要显示，往上提没有收益。导出/导入是从历史页搬过来的，
 * 接口没动（见 HistoryPage 里那条注释的约定）。
 */

export interface SettingsPageProps {
  aiMode: AiMode;
  onAiMode: (v: AiMode) => void;
  fastMode: boolean;
  onFastMode: (v: boolean) => void;
  vibrate: boolean;
  onVibrate: (v: boolean) => void;
  autoReview: boolean;
  onAutoReview: (v: boolean) => void;
  showEquity: boolean;
  onShowEquity: (v: boolean) => void;
  muted: boolean;
  onMuted: (v: boolean) => void;
  /** 重置成功后通知 App 把当前会话也归零 */
  onDataReset: () => void;
}

/** 一行开关。label 左、控件右，整行可点 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // label 与控件用 htmlFor/id 关联，而不是把控件包在 label 里面：Radix 的
  // Switch 渲染的是 button，包起来不会像原生 checkbox 那样自动转发点击。
  // button 是 HTML 规定的可标注元素，for 指过来同样能整行可点。
  const id = useId();
  return (
    <div className="set-row">
      <label className="set-row-text" htmlFor={id}>
        <span className="set-row-label">{label}</span>
        {hint !== undefined && <span className="set-row-hint">{hint}</span>}
      </label>
      {/* ml-auto 把控件顶到行尾。.set-row 是 flex，.set-row-text 不撑开，
          原来这件事由 .set-switch 的 margin-left:auto 做，那条规则随控件
          一起删掉了 */}
      <Switch id={id} className="ml-auto" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** 二选一。比开关多的那点表达力用在「两个都有名字」的场合 */
function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; text: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="set-row">
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint !== undefined && <span className="set-row-hint">{hint}</span>}
      </span>
      {/* 分段控件：一条浅底轨道上放两颗按钮，选中的那颗浮起来。没有用
          shadcn 的 ToggleGroup——那个组件的语义是"一组可切换项"，而这里
          两项永远必选其一，aria-pressed 比 ToggleGroup 的 data-state 更
          直白，读屏也念得对 */}
      <span
        className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-secondary p-0.5"
        role="group"
        aria-label={label}
      >
        {options.map(o => (
          <Button
            key={o.value}
            size="sm"
            variant={o.value === value ? 'outline' : 'ghost'}
            className={
              o.value === value
                ? 'bg-accent text-accent-foreground border-transparent hover:bg-accent hover:text-accent-foreground'
                : 'hover:bg-transparent hover:text-foreground'
            }
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.text}
          </Button>
        ))}
      </span>
    </div>
  );
}

export function SettingsPage(props: SettingsPageProps) {
  const [notice, setNotice] = useState<string | null>(null);
  /** 重置要二次确认：它删掉的是用户几百手的历史，且不可撤销 */
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Vibration API 在 iOS Safari 上不存在。给一个按了没有任何反应的开关，
  // 比不给更糟——用户会以为是自己的手机坏了。
  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  async function onExport() {
    const rows = await allHands();
    if (rows.length === 0) {
      setNotice('还没有可导出的手牌。');
      return;
    }
    const now = Date.now();
    const text = JSON.stringify(buildTransfer(rows, now));
    // Blob + 临时 <a download>：不经服务器，文件也不进内存两次以上。
    // URL 用完立刻 revoke，否则每导一次就泄漏一个对象 URL，直到页面关闭。
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = transferFileName(now);
    a.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${rows.length} 手。`);
  }

  async function onImportFile(file: File) {
    const parsed = parseTransfer(await file.text());
    if (!parsed.ok) {
      setNotice(`导入失败：${parsed.error}`);
      return;
    }
    const out = await importHands(parsed.hands);
    const parts = [`已导入 ${out.imported} 手`];
    // 跳过的条数必须说出来。静默丢数据比直接拒绝更糟——用户会以为全导进来了
    if (parsed.skipped > 0) parts.push(`跳过 ${parsed.skipped} 条无法识别的记录`);
    if (!out.ok) parts.push('部分写入失败，存储可能已满');
    setNotice(parts.join('，') + '。');
  }

  async function onReset() {
    const ok = await resetAll();
    setConfirmingReset(false);
    setNotice(ok ? '已清空所有手牌与统计。' : '清空失败，存储可能不可用。');
    if (ok) props.onDataReset();
  }

  return (
    <div className="set">
      <header className="set-head">
        <h2 className="set-title">设置</h2>
      </header>

      <section className="set-group">
        <h3 className="set-group-title">对局</h3>
        <Choice<AiMode>
          label="AI 模式"
          hint="下一手生效"
          value={props.aiMode}
          options={[
            { value: 'personas', text: '原型池' },
            { value: 'gto', text: '全 GTO' },
          ]}
          onChange={props.onAiMode}
        />
        <Toggle
          label="极速模式"
          hint="AI 不再模拟思考延迟"
          checked={props.fastMode}
          onChange={props.onFastMode}
        />
        <Toggle
          label="结算后自动打开复盘"
          checked={props.autoReview}
          onChange={props.onAutoReview}
        />
      </section>

      <section className="set-group">
        <h3 className="set-group-title">牌桌</h3>
        <Toggle
          label="显示胜率读数"
          hint="训练辅助，默认关"
          checked={props.showEquity}
          onChange={props.onShowEquity}
        />
        <Toggle label="音效" checked={!props.muted} onChange={v => props.onMuted(!v)} />
        {canVibrate && (
          <Toggle
            label="轮到我时震动"
            checked={props.vibrate}
            onChange={props.onVibrate}
          />
        )}
      </section>

      <section className="set-group">
        <h3 className="set-group-title">数据</h3>
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-label">导出 / 导入</span>
            <span className="set-row-hint">JSON 文件，只在本机之间搬</span>
          </span>
          <span className="set-actions">
            <Button variant="outline" size="sm" onClick={() => void onExport()}>
              导出
            </Button>
            {/* asChild：样式套在 label 上而不是渲染一个 button。点 label 会
                触发它裹着的 file input，这是唯一能自定义文件选择器外观的
                办法——input[type=file] 自带的那颗按钮改不动 */}
            <Button asChild variant="outline" size="sm" className="cursor-pointer">
              <label>
                导入
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    // 立刻清空 value：不清的话，用户导入同一个文件第二次不会触发
                    // change 事件（值没变），看起来像点了没反应
                    e.target.value = '';
                    if (f) void onImportFile(f);
                  }}
                />
              </label>
            </Button>
          </span>
        </div>

        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-label">重置数据</span>
            <span className="set-row-hint">删掉全部手牌与统计，不可撤销</span>
          </span>
          <span className="set-actions">
            <AlertDialog open={confirmingReset} onOpenChange={setConfirmingReset}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={storageStatus() === 'unavailable'}
                >
                  重置
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>清空全部手牌与统计？</AlertDialogTitle>
                <AlertDialogDescription>
                  这会删掉本机存下的每一手牌、它们的复盘结果与全部统计，
                  <strong className="font-semibold text-foreground">不可撤销</strong>
                  。想留个备份的话，先用上面的「导出」存一份 JSON。
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  {/* 点下去对话框立刻关闭（Radix 自带），回执由页面底部那句
                      role="status" 说——它在对话框外面，异步结果晚一点到也
                      有地方落。别在这里拦 Radix 的关闭去等异步：确认之后
                      对话框还杵着不动，用户不知道自己那一下有没有生效 */}
                  <AlertDialogAction onClick={() => void onReset()}>
                    确认清空
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        </div>
      </section>

      {notice !== null && (
        <p className="set-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
