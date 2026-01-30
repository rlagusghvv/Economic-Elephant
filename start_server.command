#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
hash -r
PROJECT_DIR="/Users/kimhyeonho/kakao-push-bot"
PORT=3000

LOG_LAUNCHER="$PROJECT_DIR/log_launcher.out"
LOG_OUT="$PROJECT_DIR/log_server.out"
LOG_ERR="$PROJECT_DIR/log_server.err"
LOG_NGROK="$PROJECT_DIR/log_ngrok.out"

mkdir -p "$PROJECT_DIR"
touch "$LOG_LAUNCHER"
exec >> "$LOG_LAUNCHER" 2>&1

notify() {
  # 알림센터 배너
  /usr/bin/osascript -e "display notification \"$1\" with title \"경제 코끼리\""
}

alert() {
  # 팝업(확인 버튼)
  /usr/bin/osascript -e "display dialog \"$1\" with title \"경제 코끼리\" buttons {\"OK\"} default button 1"
}

echo "=== LAUNCH $(date) ==="
set -euo pipefail
cd "$PROJECT_DIR"

echo "== PATH 확인 =="
echo "PATH=$PATH"
echo "which node: $(command -v node || echo 'NOT_FOUND')"
echo "node -v: $(node -v 2>/dev/null || echo 'NODE_FAIL')"
echo "which ngrok: $(command -v ngrok || echo 'NOT_FOUND')"
echo ""

# 0) 시작 알림
notify "실행 시작… 서버/NGROK 확인 중"

# 1) 서버 실행
if lsof -i :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✅ Server already running on $PORT"
else
  echo "🚀 Starting server on $PORT ..."
  nohup node server.js >> "$LOG_OUT" 2>> "$LOG_ERR" &
  sleep 1
fi

# 2) healthcheck
echo "== healthcheck =="
node healthcheck.js
echo "✅ healthcheck ok"

# 3) ngrok 실행
echo "== ngrok =="
if pgrep -f "ngrok http $PORT" >/dev/null 2>&1; then
  echo "✅ ngrok already running"
else
  echo "🌐 Starting ngrok..."
  nohup ngrok http $PORT > "$LOG_NGROK" 2>&1 &
  sleep 2
fi

# 4) ngrok public url 추출 (log에서 찾아봄)
PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.ngrok-free\.app' "$LOG_NGROK" | tail -n 1 || true)"

echo "ngrok status(UI): http://127.0.0.1:4040"
echo "server health: http://localhost:3000/health"
[ -n "$PUBLIC_URL" ] && echo "✅ Public URL: $PUBLIC_URL"

# 5) 사용자에게 “켜짐”을 확실히 알려주기
notify "서버 OK (3000) / ngrok OK"
if [ -n "$PUBLIC_URL" ]; then
  alert "✅ 서버가 켜졌습니다.\n\n헬스체크: http://localhost:3000/health\nngrok UI: http://127.0.0.1:4040\nPublic URL:\n$PUBLIC_URL"
else
  alert "✅ 서버가 켜졌습니다.\n\n헬스체크: http://localhost:3000/health\nngrok UI: http://127.0.0.1:4040\n\n(공개 URL 추출 실패: log_ngrok.out 확인)"
fi

echo "✅ DONE"
