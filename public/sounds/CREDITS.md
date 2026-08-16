# 音效来源与许可

本目录下的音频文件全部来自 **CC0 公有领域**，可商用、可修改、可再分发，署名可选。
下载日期与来源逐个记录如下。

## 真实录音（4 个）

| 文件 | 来源 | 原名 | 许可 | 大小 | 下载日期 |
|---|---|---|---|---|---|
| `chip-light.mp3` | https://bigsoundbank.com/poker-chips-3-s0944.html | Poker Chips #3 | CC0 | 10,944 B | 2026-08-15 |
| `chip-heavy.mp3` | https://bigsoundbank.com/poker-chips-2-s0943.html | Poker Chips #2 | CC0 | 20,736 B | 2026-08-15 |
| `pot-win.mp3` | https://bigsoundbank.com/poker-chips-4-s0945.html | Poker Chips #4 | CC0 | 11,520 B | 2026-08-15 |
| `allin.mp3` | https://bigsoundbank.com/poker-chips-s0942.html | Poker Chips | CC0 | 11,520 B | 2026-08-15 |

四个均为 48 kHz / 16 bit 立体声录音棚录制。BigSoundBank 明示「无需付费、无需注册账号、
无需征求许可」即可使用。

## 合成音效（4 个，无文件）

`deal-card`、`board-flip`、`fold`、`check` **没有对应文件**——它们在 `src/ui/sound.ts`
里用 Web Audio 实时合成（滤波噪声 + 包络）。

原因：在 CC0 来源里找不到合适的卡牌与敲桌音效（BigSoundBank 搜 `card` 零结果，
搜 `carte` 返回的是翻地图的纸张声，敲击类只有敲门与敲玻璃）。主流免费音效库
（Freesound、Zapsplat）下载均需注册账号。

这个分法落在对的一边：**筹码撞击是多体金属碰撞，合成器做出来一听就假**，而这四个恰好
有真实录音；缺的四个都是**短噪声瞬态**（发牌的滑擦、翻牌的脆响、搓牌、敲桌），
滤波噪声加包络正是最擅长的。

## 维护须知

若日后替换或新增任何文件，**这张表必须同步更新**——许可信息丢失比文件丢失更麻烦。
新增来源必须确认是 CC0 或等价的免版权许可，并记下来源 URL。
