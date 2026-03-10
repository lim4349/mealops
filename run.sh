#!/bin/bash

# MeaLOps Bot 통합 실행 스크립트
# 사용법:
#   ./run.sh          - 서버 및 tunnel 시작
#   ./run.sh start    - 서버 및 tunnel 시작
#   ./run.sh stop     - 모든 프로세스 종료 및 로그 삭제
#   ./run.sh status   - 현재 서버 상태 확인

NGROK_DOMAIN="janella-interjugular-topographically.ngrok-free.dev"

# 함수: 서버 시작
start_server() {
  # DB 파일이 git 버전과 다른 경우 경고 (이전에 gitignore 상태에서 생성된 빈 DB일 수 있음)
  if [ -f "data/lunch.db" ]; then
    GIT_DB_SIZE=$(git show HEAD:data/lunch.db 2>/dev/null | wc -c)
    LOCAL_DB_SIZE=$(wc -c < "data/lunch.db")
    if [ "$GIT_DB_SIZE" -gt 0 ] && [ "$LOCAL_DB_SIZE" -lt "$GIT_DB_SIZE" ]; then
      echo "⚠️  로컬 DB(${LOCAL_DB_SIZE}B)가 git DB(${GIT_DB_SIZE}B)보다 작습니다."
      echo "   식당 데이터가 없을 수 있습니다. git 버전으로 교체합니다..."
      rm -f data/lunch.db data/lunch.db-shm data/lunch.db-wal
      git checkout HEAD -- data/lunch.db
      echo "✅ DB 복원 완료"
    fi
  fi

  echo "🛑 기존 프로세스 정리 중..."
  # 포트 3978을 점유한 프로세스만 종료 (VS Code Remote SSH 등 다른 node 프로세스 보호)
  fuser -k 3978/tcp 2>/dev/null || true
  # ngrok 프로세스 종료
  pkill -f "ngrok http" 2>/dev/null || true
  sleep 2

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
  rm -f /tmp/server.log
  npm start > /tmp/server.log 2>&1 &
  SERVER_PID=$!
  sleep 5

  # 서버 시작 확인
  if ps -p $SERVER_PID > /dev/null; then
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
  if curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | jq -e '.tunnels[0]' > /dev/null 2>&1; then
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
  echo "ngrok 로그:   tail -f /tmp/ngrok.log"
  echo "ngrok 대시보드: http://127.0.0.1:4040"
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

  # 포트 3978을 점유한 프로세스 종료
  fuser -k 3978/tcp 2>/dev/null || true

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
  if curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | jq -e '.tunnels[0]' > /dev/null 2>&1; then
    echo "✅ ngrok: 정상 작동 (https://$NGROK_DOMAIN)"
  else
    echo "❌ ngrok: 연결 불가"
  fi

  # Node 프로세스 확인
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔍 프로세스 목록:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ps aux | grep -E "npm start|node dist|ngrok http" | grep -v grep || echo "실행 중인 프로세스 없음"
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
