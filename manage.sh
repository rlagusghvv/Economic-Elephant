#!/bin/bash
set -e

# ===== 설정 =====
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"

SERVER_ENTRY="${SERVER_ENTRY:-server.js}"          # 네 서버 엔트리 파일
TUNNEL_MODE="${TUNNEL_MODE:-url}"                  # url | named
TUNNEL_URL="${TUNNEL_URL:-http://localhost:$PORT}" # url 모드일 때
TUNNEL_NAME="${TUNNEL_NAME:-econ-kokkiri}"         # named 모드일 때 (cloudflared tunnel run)
TUNNEL_CONFIG="${TUNNEL_CONFIG:-}"                 # named 모드에서 config 파일 쓰면 경로

LOG_DIR="$APP_DIR/.run"
SERVER_LOG="$LOG_DIR/server.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
SERVER_PID="$LOG_DIR/server.pid"
TUNNEL_PID="$LOG_DIR/tunnel.pid"

notify_ok() {
  local msg="${1:-정상 작동 중}"
  local title="${2:-경제 코끼리 🐘}"

  # 1) terminal-notifier 있으면 이게 최우선(가장 안정)
  if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "$title" -message "$msg" >/dev/null 2>&1 && return 0
  fi

  # 2) 기본 알림(가끔 안 보일 수 있음)
  osascript -e "display notification \"${msg}\" with title \"${title}\"" >/dev/null 2>&1 && return 0

  # 3) 마지막 fallback(확실히 뜨지만 방해됨) — 원하면 주석 해제
  # osascript -e "display dialog \"${msg}\" with title \"${title}\" buttons {\"확인\"} default button 1" >/dev/null 2>&1
}

mkdir -p "$LOG_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ---- helpers ----
log() { echo "[$(date '+%H:%M:%S')] $*"; }

notify_ok() {
  local msg="${1:-정상 작동 중}"
  local title="${2:-경제 코끼리 🐘}"

  if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "$title" -message "$msg" >/dev/null 2>&1 && return 0
  fi

  osascript -e "display notification \"${msg}\" with title \"${title}\"" >/dev/null 2>&1 && return 0
}

notify_mac() {
  # macOS 우상단 알림(팝업)
  # 사용: notify_mac "타이틀" "메시지"
  local title="$1"
  local msg="$2"
  # 따옴표 깨짐 방지
  title="${title//\"/\\\"}"
  msg="${msg//\"/\\\"}"
  /usr/bin/osascript -e "display notification \"${msg}\" with title \"${title}\"" >/dev/null 2>&1 || true
}

is_port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

http_ok() {
  local url="$1"
  curl -sS -o /dev/null -m 6 -L -w "%{http_code}" "$url" 2>/dev/null | grep -Eq '^(2|3)[0-9]{2}$'
}

is_running_pid() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

# ---- health/status checks ----
check_server() {
  local port="$1"
  local ok=0

  if is_port_listening "$port"; then
    log "✅ 서버 포트 리슨 중: $port"
    ok=1
  else
    log "❌ 서버 포트 미리슨: $port"
    return 1
  fi

  # /health 라우트가 있으면 가장 좋음. 없으면 / 로 바꿔도 됨.
  local health_url="http://127.0.0.1:${port}/health"
  if http_ok "$health_url"; then
    log "✅ 서버 헬스체크 OK: $health_url"
  else
    log "⚠️ 서버 응답 확인 실패(health 없음/라우트 다름 가능): $health_url"
    log "   → 서버에 /health 라우트가 없으면 / 로 바꿔도 됨"
  fi

  [[ "$ok" -eq 1 ]]
}

check_tunnel() {
  local url="$1"
  url="$(echo "$url" | tr -d '\r' | xargs)"

  if [[ -z "$url" ]]; then
    log "⚠️ 터널 URL 없음(미설정)"
    return 1
  fi

  if http_ok "$url"; then
    log "✅ 터널 응답 OK: $url"
    return 0
  else
    log "⚠️ 터널 응답 확인 실패: $url"
    log "   → 터널이 막 뜬 직후면 3~10초 뒤 재시도 필요"
    return 1
  fi
}

# 터널 URL을 로그에서 뽑아오는 보조 함수(있으면 사용)
# cloudflared 로그에 https://xxxxx.trycloudflare.com 또는 https://xxxxx.ngrok-free.app 같은 게 찍히는 경우가 많음
extract_tunnel_url_from_log() {
  if [[ -f "$TUNNEL_LOG" ]]; then
    # https:// 로 시작하는 URL 하나 추출(마지막 것 우선)
    grep -Eo 'https://[^ ]+' "$TUNNEL_LOG" 2>/dev/null | tail -n 1 || true
  fi
}

post_start_verify() {
  local port="$1"

  log "---- 시작 후 상태 점검 ----"

  local server_ok=0
  if check_server "$port"; then server_ok=1; fi

  # 터널은 기동 지연이 있어서 재시도
  local tunnel_url="$TUNNEL_URL"
  local tunnel_ok=0

  # url 모드면 TUNNEL_URL 체크, named 모드면 로그에서 URL 뽑아 체크(가능하면)
  if [[ "$TUNNEL_MODE" == "named" ]]; then
    local from_log
    from_log="$(extract_tunnel_url_from_log)"
    if [[ -n "$from_log" ]]; then
      tunnel_url="$from_log"
      log "ℹ️ (named) 터널 URL(로그 추정): $tunnel_url"
    else
      log "ℹ️ (named) 터널 URL을 로그에서 찾지 못함. 응답 체크는 생략될 수 있음."
      tunnel_url=""
    fi
  fi

  # 최대 4번 재시도
  for i in 1 2 3 4; do
    if [[ -n "$tunnel_url" ]]; then
      if check_tunnel "$tunnel_url"; then
        tunnel_ok=1
        break
      fi
    fi
    sleep 2
  done

  log "---- 점검 끝 ----"

  # 알림 정책
  if [[ "$server_ok" -eq 1 && "$tunnel_ok" -eq 1 ]]; then
    notify_mac "경제 코끼리 🐘" "서버+터널 정상 작동 중 (PORT ${port})"
  elif [[ "$server_ok" -eq 1 && "$tunnel_ok" -eq 0 ]]; then
    notify_mac "경제 코끼리 🐘" "서버는 정상. 터널 확인 실패(지연/URL 문제 가능)"
  else
    notify_mac "경제 코끼리 ⚠️" "서버 실행/헬스 체크 실패. 로그 확인 필요"
  fi
}

WATCH_INTERVAL="${WATCH_INTERVAL:-20}"  # 20초마다 체크
WATCH_PID="$LOG_DIR/watch.pid"
WATCH_LOG="$LOG_DIR/watch.log"

start_watch() {
  if is_running_pid "$WATCH_PID"; then
    log "✅ watch already running (pid $(cat "$WATCH_PID"))"
    return 0
  fi

  log "👀 starting watch (interval=${WATCH_INTERVAL}s) ..."

  (
    while true; do
      # 1) 서버 체크
      if ! is_running_pid "$SERVER_PID" || ! is_port_listening "$PORT"; then
        echo "[watch] server down -> restart" >> "$WATCH_LOG"
        notify_ok "서버가 꺼짐 감지 → 재시작 시도" "경제 코끼리 🐘"
        start_server || notify_ok "서버 재시작 실패(로그 확인)" "경제 코끼리 🐘"
      fi

      # 2) 터널 체크(프로세스 기준 + URL 응답 체크)
      if ! is_running_pid "$TUNNEL_PID"; then
        echo "[watch] tunnel down -> restart" >> "$WATCH_LOG"
        notify_ok "터널이 꺼짐 감지 → 재시작 시도" "경제 코끼리 🐘"
        start_tunnel || notify_ok "터널 재시작 실패(로그 확인)" "경제 코끼리 🐘"
      else
        # url 모드일 때만 외부 응답 체크 (named는 URL을 알아내기 어렵고, 로그 파싱 필요)
        if [[ "$TUNNEL_MODE" == "url" ]]; then
          check_tunnel "$TUNNEL_URL" >/dev/null 2>&1 || {
            echo "[watch] tunnel not responding -> restart" >> "$WATCH_LOG"
            notify_ok "터널 응답 불가 → 재시작 시도" "경제 코끼리 🐘"
            stop_one "tunnel" "$TUNNEL_PID"
            start_tunnel || notify_ok "터널 재시작 실패(로그 확인)" "경제 코끼리 🐘"
          }
        fi
      fi

      sleep "$WATCH_INTERVAL"
    done
  ) >/dev/null 2>&1 & echo $! > "$WATCH_PID"

  log "✅ watch started (pid $(cat "$WATCH_PID"))"
}

# ---- start/stop ----
start_server() {
  if is_running_pid "$SERVER_PID"; then
    echo "✅ server already running (pid $(cat "$SERVER_PID"))"
    return 0
  fi

  echo "🚀 starting server on port $PORT ..."
  cd "$APP_DIR"
  nohup node "$SERVER_ENTRY" > "$SERVER_LOG" 2>&1 & echo $! > "$SERVER_PID"
  sleep 1
  echo "✅ server started (pid $(cat "$SERVER_PID"))"
}

start_tunnel() {
  if is_running_pid "$TUNNEL_PID"; then
    echo "✅ tunnel already running (pid $(cat "$TUNNEL_PID"))"
    return 0
  fi

  echo "🌐 starting cloudflare tunnel ..."
  cd "$APP_DIR"

  if [[ "$TUNNEL_MODE" == "named" ]]; then
    if [[ -n "$TUNNEL_CONFIG" ]]; then
      nohup cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME" > "$TUNNEL_LOG" 2>&1 & echo $! > "$TUNNEL_PID"
    else
      nohup cloudflared tunnel run "$TUNNEL_NAME" > "$TUNNEL_LOG" 2>&1 & echo $! > "$TUNNEL_PID"
    fi
  else
    nohup cloudflared tunnel --url "$TUNNEL_URL" > "$TUNNEL_LOG" 2>&1 & echo $! > "$TUNNEL_PID"
  fi

  sleep 1
  echo "✅ tunnel started (pid $(cat "$TUNNEL_PID"))"
}

stop_one() {
  local name="$1"
  local pid_file="$2"
  if is_running_pid "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    echo "🛑 stopping $name (pid $pid) ..."
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if ps -p "$pid" >/dev/null 2>&1; then
      echo "⚠️ $name still alive, force kill"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
    echo "✅ $name stopped"
  else
    echo "ℹ️ $name not running"
    rm -f "$pid_file" >/dev/null 2>&1 || true
  fi
}

stop_watch() {
  stop_one "watch" "$WATCH_PID"
}

status() {
  echo "== status =="
  if is_running_pid "$SERVER_PID"; then
    echo "✅ server: RUNNING (pid $(cat "$SERVER_PID"))"
  else
    echo "❌ server: STOPPED"
  fi

  if is_running_pid "$TUNNEL_PID"; then
    echo "✅ tunnel: RUNNING (pid $(cat "$TUNNEL_PID"))"
  else
    echo "❌ tunnel: STOPPED"
  fi

    if is_running_pid "$WATCH_PID"; then
    echo "✅ watch: RUNNING (pid $(cat "$WATCH_PID"))"
  else
    echo "❌ watch: STOPPED"
  fi

  echo ""
  echo "logs:"
  echo " - $SERVER_LOG"
  echo " - $TUNNEL_LOG"
}

health() {
  echo "== health =="

  if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "✅ /health OK"
  else
    echo "⚠️ /health FAIL (server may be up but route missing)"
  fi

  echo ""
  echo "tunnel last lines:"
  tail -n 10 "$TUNNEL_LOG" 2>/dev/null || true

  echo ""
  echo "try extract tunnel url from log:"
  extract_tunnel_url_from_log || true
}

case "${1:-}" in
  start)
    start_server
    start_tunnel
    status
    post_start_verify "$PORT" "$TUNNEL_URL"
    notify_ok "서버/터널 기동 완료. status 확인됨" "경제 코끼리 🐘"
    post_start_verify "$PORT"
    ;;
  stop)
    stop_one "tunnel" "$TUNNEL_PID"
    stop_one "server" "$SERVER_PID"
    notify_mac "경제 코끼리 🐘" "서버/터널 중지 완료"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    status
    ;;
      watch)
    start_watch
    ;;
  unwatch)
    stop_watch
    ;;
  health)
    health
    ;;
  *)
    echo "usage: ./manage.sh {start|stop|restart|status|health|watch|unwatch}"
    exit 1
    ;;
esac