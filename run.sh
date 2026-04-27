#!/bin/bash

# MeaLOps Bot 통합 실행 스크립트
# 사용법:
#   ./run.sh          - 서버 및 tunnel 시작
#   ./run.sh start    - 서버 및 tunnel 시작
#   ./run.sh stop     - 모든 프로세스 종료 및 로그 삭제
#   ./run.sh status   - 현재 서버 상태 확인

NGROK_DOMAIN="janella-interjugular-topographically.ngrok-free.dev"

has_systemd_services() {
  systemctl list-unit-files mealops.service mealops-ngrok.service >/dev/null 2>&1
}

systemctl_restart_mealops() {
  local err_file=/tmp/mealops-systemctl.err

  if systemctl restart mealops.service mealops-ngrok.service 2>"$err_file"; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n systemctl restart mealops.service mealops-ngrok.service 2>"$err_file"; then
    return 0
  fi

  cat "$err_file" 2>/dev/null || true
  return 1
}

systemctl_stop_mealops() {
  systemctl stop mealops-ngrok.service mealops.service 2>/dev/null ||
    { command -v sudo >/dev/null 2>&1 && sudo -n systemctl stop mealops-ngrok.service mealops.service 2>/dev/null; } ||
    true
}

kill_mealops_server() {
  # 포트 점유 프로세스를 먼저 종료한다.
  fuser -k 3978/tcp 2>/dev/null || true

  # 같은 작업 디렉터리에서 뜬 node/tsx 잔여 프로세스만 정리한다.
  for pid in $(pgrep -x node 2>/dev/null || true); do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    if [ "$cwd" = "$(pwd)" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

ngrok_api_url() {
  for port in 4040 4041 4042 4043 4044 4045; do
    if curl -s "http://127.0.0.1:$port/api/tunnels" > /dev/null 2>&1; then
      echo "http://127.0.0.1:$port/api/tunnels"
      return 0
    fi
  done
  return 1
}

ensure_ollama_server() {
  if ! command -v ollama > /dev/null 2>&1; then
    echo "⚠️  ollama 명령을 찾을 수 없습니다. AI 추천은 fallback으로 동작합니다."
    return
  fi

  if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama 서버: 정상 작동"
    return
  fi

  echo "🚀 Ollama 서버 시작 중..."
  rm -f /tmp/ollama.log
  setsid bash -c 'exec ollama serve >> /tmp/ollama.log 2>&1' < /dev/null &
  sleep 5

  if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama 서버 시작됨"
  else
    echo "⚠️  Ollama 서버 시작 실패. AI 추천은 fallback으로 동작합니다."
    tail -20 /tmp/ollama.log 2>/dev/null || true
  fi
}

# 함수: 서버 시작
start_server() {
  mkdir -p data

  if has_systemd_services; then
    ensure_ollama_server

    echo "🔁 systemd 서비스 재시작 중..."
    if ! systemctl_restart_mealops; then
      echo "❌ systemd 재시작 권한이 없습니다."
      echo "   권한 있는 계정에서 실행: sudo systemctl restart mealops.service mealops-ngrok.service"
      echo ""
      show_status
      exit 1
    fi
    sleep 5

    echo ""
    echo "✅ systemd 서비스 재시작 완료"
    show_status

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 로그 보기 (선택사항):"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "서버 로그:    journalctl -u mealops.service -f"
    echo "Ollama 로그:  tail -f /tmp/ollama.log"
    echo "ngrok 로그:   journalctl -u mealops-ngrok.service -f"
    echo "상태 확인:    ./run.sh status"
    echo "모두 종료:    ./run.sh stop"
    echo ""
    echo "✅ 모든 서비스가 systemd로 실행 중입니다."
    echo "🎯 준비 완료! Teams에서 DM을 보내세요."
    echo ""
    return
  fi

  echo "🛑 기존 프로세스 정리 중..."
  kill_mealops_server
  # ngrok 프로세스 종료
  pkill -f "ngrok http" 2>/dev/null || true
  sleep 2
  while pgrep -f "ngrok http" > /dev/null 2>&1; do
    sleep 1
  done

  # ngrok authtoken 확인
  if ! ngrok config check 2>/dev/null | grep -qi "valid"; then
    echo "❌ ngrok authtoken이 설정되지 않았습니다!"
    echo ""
    echo "1. https://dashboard.ngrok.com/signup 에서 계정 생성"
    echo "2. https://dashboard.ngrok.com/get-started/your-authtoken 에서 토큰 확인"
    echo "3. ngrok config add-authtoken <YOUR_TOKEN> 실행"
    echo ""
    exit 1
  fi

  ensure_ollama_server

  echo ""
  echo "🔨 TypeScript 빌드 중..."
  if npm run build > /tmp/build.log 2>&1; then
    echo "✅ 빌드 완료"
  else
    echo "❌ 빌드 실패!"
    cat /tmp/build.log
    exit 1
  fi

  echo ""
  echo "🚀 서버 시작 중... (포트 3978)"
  rm -f /tmp/server.log /tmp/server.out
  node dist/index.js > /tmp/server.out 2>&1 &
  SERVER_PID=$!
  sleep 5

  # 서버 시작 확인
  if ps -p $SERVER_PID > /dev/null && curl -s http://127.0.0.1:3978/health > /dev/null 2>&1; then
    echo "✅ 서버 프로세스 시작됨 (PID: $SERVER_PID)"
  else
    echo "❌ 서버 시작 실패!"
    cat /tmp/server.log
    exit 1
  fi

  echo ""
  echo "🌐 ngrok 터널 시작 중... ($NGROK_DOMAIN)"
  rm -f /tmp/ngrok.log
  ngrok http 3978 --domain=$NGROK_DOMAIN --log=stdout > /tmp/ngrok.log 2>&1 &
  NGROK_PID=$!
  sleep 3

  # ngrok 상태 확인
  NGROK_API=$(ngrok_api_url || true)
  if [ -n "$NGROK_API" ] && curl -s "$NGROK_API" 2>/dev/null | jq -e '.tunnels[0]' > /dev/null 2>&1; then
    echo "✅ ngrok 터널 활성화: https://$NGROK_DOMAIN"
  else
    echo "❌ ngrok 터널 시작 실패!"
    cat /tmp/ngrok.log | tail -20
    exit 1
  fi

  echo ""
  echo "✅ 모든 서비스 시작됨!"
  echo ""
  show_status

  # 서버 상태 확인
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "⚙️  설정 정보:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if curl -s http://127.0.0.1:3978/health | jq '.' 2>/dev/null; then
    echo "✅ 서버 헬스 체크: 정상"
  else
    echo "✅ 서버가 시작 중입니다... (초기 로드 대기)"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📝 로그 보기 (선택사항):"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "서버 로그:    tail -f /tmp/server.log"
  echo "Ollama 로그:  tail -f /tmp/ollama.log"
  echo "ngrok 로그:   tail -f /tmp/ngrok.log"
  echo "ngrok 대시보드: ${NGROK_API%/api/tunnels}"
  echo "상태 확인:    ./run.sh status"
  echo "모두 종료:    ./run.sh stop"
  echo ""
  echo "✅ 모든 서비스가 백그라운드에서 실행 중입니다."
  echo "🎯 준비 완료! Teams에서 DM을 보내세요."
  echo ""
}

# 함수: 서버 종료
stop_server() {
  echo "🛑 모든 프로세스 종료 중..."

  if has_systemd_services; then
    systemctl_stop_mealops
  fi

  kill_mealops_server

  # ngrok 프로세스 종료
  pkill -f "ngrok http" 2>/dev/null || true

  sleep 2

  # 로그 파일 삭제
  echo "🗑️  로그 파일 정리 중..."
  rm -f /tmp/server.log /tmp/ngrok.log /tmp/build.log

  echo "✅ 모든 프로세스가 종료되었습니다."
  echo "📝 로그 파일이 삭제되었습니다."
  echo ""
}

# 함수: 상태 확인
show_status() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 현재 상태:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 서버 상태 확인
  if curl -s http://127.0.0.1:3978/health > /dev/null 2>&1; then
    echo "✅ 서버: 정상 작동 (포트 3978)"
  else
    echo "❌ 서버: 연결 불가"
  fi

  # ngrok 상태 확인
  NGROK_API=$(ngrok_api_url || true)
  if [ -n "$NGROK_API" ] && curl -s "$NGROK_API" 2>/dev/null | jq -e '.tunnels[0]' > /dev/null 2>&1; then
    echo "✅ ngrok: 정상 작동 (https://$NGROK_DOMAIN)"
  else
    echo "❌ ngrok: 연결 불가"
  fi

  if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama: 정상 작동"
  else
    echo "⚠️  Ollama: 연결 불가 (AI 추천 fallback)"
  fi

  # Node 프로세스 확인
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔍 프로세스 목록:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ps aux | grep -E "node dist|ngrok http" | grep -v grep || echo "실행 중인 프로세스 없음"
  echo ""
}

# 인자에 따라 분기
case "${1:-start}" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  status)
    show_status
    ;;
  *)
    echo "사용법: ./run.sh {start|stop|status}"
    echo ""
    echo "옵션:"
    echo "  start  - 서버 및 ngrok 터널 시작 (기본값)"
    echo "  stop   - 모든 프로세스 종료 및 로그 삭제"
    echo "  status - 현재 서버 상태 확인"
    echo ""
    exit 1
    ;;
esac
