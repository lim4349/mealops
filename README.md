# MeaLOps 🍽️

MS Teams용 점심 투표 봇

## 기능

- 🗳️ 매일 점심 투표 (다중 선택, 혼밥, 아무거나)
- 🤖 AI 추천 (Ollama / gemma3:12b)
- ⭐ 날짜별 별점 리뷰 (방문일 기준 저장, 덮어쓰기 가능)
- 🚫 블랙리스트 (개인 + 전체)
- 🏆 개인별 최애 식당 통계
- 📊 히스토리 (주간/월간) — 리뷰 완료 여부 표시
- 📋 식당 목록 — 평균 점수 표시, 다중 정렬 (이름/거리/가격/⭐점수)
- 🛵 배달 모드
- ⏰ 11:30 강제 결정 (on/off)
- 🎯 동점 처리: 최근 방문 적은 곳 → 평점 높은 곳 → 랜덤

## 설치

```bash
npm install
cp .env.example .env
# .env 설정
npm run db:init
npm run seed
```

## 실행

```bash
# Ollama 실행 (별도 터미널)
ollama serve
ollama pull gemma3:12b

# Bot 실행
npm run dev
```

## 환경 변수

`.env` 파일에 설정:

```env
MICROSOFT_APP_ID=
MICROSOFT_APP_PASSWORD=
MICROSOFT_APP_TENANT_ID=
MICROSOFT_APP_TYPE=SingleTenant

TEAMS_CHANNEL_ID=          # 그룹채팅 ID (선택)

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:12b

WEATHER_API_KEY=           # OpenWeatherMap (선택)
WEATHER_CITY=Seoul

VOTE_HOUR=11               # 투표 알림 시각 (KST)
VOTE_MINUTE=00
FORCE_DECISION_MINUTE=30   # 강제결정 분 (기본 30)

DB_PATH=./data/lunch.db
PORT=3978
```

## UI 메뉴

| 버튼 | 설명 |
|------|------|
| 🗳️ 투표하기 | 오늘 점심 투표 카드 |
| 🤖 AI 추천 | Ollama 기반 추천 (🔄 새로고침 가능) |
| 📋 식당목록 | 전체 목록 — 이름/거리/가격/⭐점수 정렬, 카테고리 그룹핑 |
| ⭐ 내최애 | 자주 간 식당 TOP5 + 높은 평점 TOP5 |
| 🚫 블랙리스트 | 내 블랙리스트 관리 |
| ⚙️ 설정 | 식대 / 강제결정 / 배달모드 |
| 📊 히스토리 | 주간/월간 점심 기록 + 리뷰 바로가기 |

## 투표 흐름

1. **11:00** 투표 알림 카드 자동 발송 (각 사용자별 선택 상태 표시)
2. 사용자가 식당 선택 → 재클릭 시 취소 (토글)
3. **혼밥** / **아무거나** 선택 가능
4. **⏰ 오늘 메뉴 결정!** 버튼 또는 11:30 강제결정으로 우승 식당 확정
5. **12:50** 리뷰 알림 발송

## 동점 처리

1. 최근 30일 방문 가장 적은 식당 우선
2. 그래도 동점이면 평균 평점 높은 곳
3. 그래도 동점이면 랜덤

## 스케줄

| 시각 (KST) | 동작 |
|------------|------|
| 11:00 | 투표 알림 카드 발송 |
| 11:30 | 강제 결정 (설정 시) |
| 12:50 | 리뷰 요청 카드 발송 |

## 프로젝트 구조

```
src/
├── bot/           # MS Teams Bot (카드 액션 처리)
├── cards/         # Adaptive Card 빌더
├── core/          # 타입 정의 (DI 인터페이스)
├── db/            # SQLite 초기화
├── handlers/      # 명령어 핸들러
├── repositories/  # Repository 패턴 (DB 접근)
├── services/      # 비즈니스 로직
├── scheduler/     # 스케줄 알림 (KST 기반)
├── index.ts       # Express 서버 진입점
└── seed.ts        # 초기 식당 데이터
```
