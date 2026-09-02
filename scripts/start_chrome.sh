#!/bin/bash
# macOS/Linux: 以调试模式启动 Chrome 并打开外贸通登录页
# 用法: bash start_chrome.sh
PORT=9222
PROFILE=/tmp/wm-chrome-profile

# 检测 Chrome 路径
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME="google-chrome"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="chromium"
else
  echo "❌ 未找到 Chrome，请先安装 Google Chrome"
  exit 1
fi

# 若 9222 已在跑，直接复用
if curl -s --noproxy '*' --max-time 2 http://127.0.0.1:$PORT/json/version >/dev/null 2>&1; then
  echo "✅ Chrome 调试端口已运行 (9222)"
else
  echo "→ 启动 Chrome (调试模式, profile=$PROFILE)…"
  pkill -x "Google Chrome" 2>/dev/null; sleep 2
  "$CHROME" --remote-debugging-port=$PORT --remote-debugging-address=127.0.0.1 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
  sleep 4
fi

# 打开外贸通登录页
curl -s --noproxy '*' -X PUT "http://127.0.0.1:$PORT/json/new?https://waimao.office.163.com/" >/dev/null 2>&1 || true
echo "✅ 已在 Chrome 打开外贸通登录页，请登录后回到 WorkBuddy 继续"
