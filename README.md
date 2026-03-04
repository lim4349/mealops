# MeaLOps 🍽️

MS Teams용 점심 투표 봇

## 기능

- 🗳️ 매일 점심 투표
- 🤖 AI 추천 (Ollama)
- ⭐ 별점 리뷰
- 🚫 블랙리스트 (익명)
- 🏆 개인별 최애 식당
- ⏰ 11:30 강제 결정 (on/off)

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

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:12b

WEATHER_API_KEY=  # OpenWeatherMap (선택)
```

## 명령어

| 명령어 | 설명 |
|--------|------|
| /도움 | 도움말 |
| /추가 [이름] [카테고리] [거리] [가격] | 식당 추가 |
| /목록 [카테고리] | 목록 |
| /투표 [식당] | 투표 |
| /추천 | AI 추천 |
| /최애 | 내 최애 |
| /리뷰 [식당] [1-5] | 리뷰 |

## 스케줄

- 11:00 - 투표 알림
- 11:30 - 강제 결정 (설정 시)
- 12:50 - 리뷰 요청
