#!/bin/bash
# macOS/Linux: 以调试模式启动 Chrome/Edge/Chromium 并打开外贸通登录页
# 用法: bash start_chrome.sh
# 说明: 优先复用已在跑的 9222 调试端口；不会强杀用户正在使用的浏览器（避免丢未保存工作）
PORT=9222
PROFILE=${WM_PROFILE:-/tmp/wm-chrome-profile}

# 检测浏览器路径（Chrome > Edge > Chromium，可用 WM_BROWSER 覆盖）
detect_browser() {
  if [ -n "$WM_BROWSER" ] && [ -x "$WM_BROWSER" ]; then echo "$WM_BROWSER"; return 0; fi
  # macOS
  for p in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  # Linux / 命令名
  for c in google-chrome microsoft-edge chromium chromium-browser; do
    command -v "$c" >/dev/null 2>&1 && { echo "$c"; return 0; }
  done
  return 1
}

# 若 9222 已在跑，直接复用（不重启、不打扰用户）
if curl -s --noproxy '*' --max-time 2 http://127.0.0.1:$PORT/json/version >/dev/null 2>&1; then
  echo "✅ 调试端口 9222 已在运行，直接复用（未重启浏览器）"
else
  BROWSER=$(detect_browser) || { echo "❌ 未找到 Chrome/Edge/Chromium，请先安装其中之一"; exit 1; }
  echo "→ 启动浏览器调试模式: $BROWSER (profile=$PROFILE)…"
  "$BROWSER" --remote-debugging-port=$PORT --remote-debugging-address=127.0.0.1 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
  # 等待端口就绪（最多 10s）
  for i in $(seq 1 10); do
    sleep 1
    curl -s --noproxy '*' --max-time 1 http://127.0.0.1:$PORT/json/version >/dev/null 2>&1 && break
  done
fi

# 打开外贸通登录页
curl -s --noproxy '*' -X PUT "http://127.0.0.1:$PORT/json/new?https://waimao.office.163.com/" >/dev/null 2>&1 || true
echo "✅ 已在浏览器打开外贸通登录页，请登录后回到 WorkBuddy 继续"
