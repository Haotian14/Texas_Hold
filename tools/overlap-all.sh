#!/bin/sh
# 一组真实视口尺寸跑一遍遮挡检测，每档一行摘要。
# 用法：sh tools/overlap-all.sh
#
# 尺寸取的是**浏览器里的可见区域**，不是屏幕分辨率：真机上地址栏与底部手势条
# 会吃掉一大截高度（实测一台 360×801 的安卓机，Chrome 里只剩 360×688）。
# 高度和宽度一样要紧——座位靠纵向错开避免碰撞，高度一压就全撞回去。
# 服务没起来时要明确报错——静默打一行空值太容易被当成"全绿"（踩过一次）。
# 浏览器不在 Playwright 默认位置时，用 PLAYWRIGHT_CHROMIUM 指过去，例如：
#   PLAYWRIGHT_CHROMIUM=/path/to/chrome sh tools/overlap-all.sh
# 全绿退出码 0，任一档 ❌ 退出码 1（可以直接串进别的脚本）。
if ! curl -sf -o /dev/null "${PREVIEW_URL:-http://127.0.0.1:4173/}"; then
  echo "预览服务不可达：${PREVIEW_URL:-http://127.0.0.1:4173/}" >&2
  echo "先跑：npm run build && npx vite preview --port 4173 &" >&2
  exit 1
fi

# 768x1024 与 830x900 在容器查询阈值（牌桌 700px）的两侧，是窄桌/宽桌两套
# 版式的交接带——历史上出过两次问题都在这里，不要从清单里删掉。
fail=0
for v in 320x568 360x640 360x688 390x664 390x844 414x736 430x740 480x800 \
         560x800 768x1024 830x900 900x900 1000x800 1280x800 1440x900; do
  # o/f 初值是 "?" 而不是空：检测脚本崩掉时（浏览器没装、页面没加载出来）
  # 一行都匹配不上，而 awk 的未初始化变量与 0 相等——原来那版会给每一档
  # 打一个 ✅，整张表全绿而其实一次都没跑起来。实际踩过：Playwright 的
  # 浏览器版本与 @playwright/test 对不上，15 档全绿，全是假的。
  line=$(node tools/overlap-check.mjs "$v" 2>&1 | awk -v v="$v" '
    BEGIN { o = "?"; f = "?" }
    /组遮挡/    { o = $0; sub(/.*❌ /, "", o); sub(/ 组遮挡.*/, "", o) }
    /没有相互遮挡/ { o = "0" }
    /个元素超出视口/ { f = $0; sub(/.*❌ /, "", f); sub(/ 个元素.*/, "", f) }
    /没有元素被挤出视口/ { f = "0" }
    END { printf "%10s  遮挡 %-3s  出界 %-3s  %s\n", v, o, f, (o == "0" && f == "0" ? "✅" : "❌") }')
  echo "$line"
  case "$line" in *❌*) fail=1 ;; esac
done

exit $fail
