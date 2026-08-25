#!/bin/sh
# 四档手机屏宽跑一遍遮挡检测，每档一行摘要。
# 用法：sh tools/overlap-all.sh
for w in 320 360 390 414 430 480 560 768 1280; do
  node tools/overlap-check.mjs "$w" 2>&1 | awk -v w="$w" '
    /组遮挡/    { o = $0; sub(/.*❌ /, "", o); sub(/ 组遮挡.*/, "", o) }
    /没有相互遮挡/ { o = 0 }
    /个元素超出视口/ { f = $0; sub(/.*❌ /, "", f); sub(/ 个元素.*/, "", f) }
    /没有元素被挤出视口/ { f = 0 }
    END { printf "%4spx  遮挡 %-3s  出界 %-3s  %s\n", w, o, f, (o == 0 && f == 0 ? "✅" : "❌") }'
done
