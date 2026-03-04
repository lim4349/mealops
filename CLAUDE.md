# MeaLOps - MS Teams 점심 투표 봇

## 프로젝트 개요
사내에서 점심 메뉴 선정의 어려움을 해결하기 위한 MS Teams 봇입니다.
- TypeScript + Clean Architecture
- SQLite DB + Repository 패턴
- Ollama (로컬 LLM) 추천
- node-cron 스케줄링

## 기술 스택
- **언어**: Node.js + TypeScript
- **프레임워크**: Express + MS Bot Framework (botbuilder)
- **DB**: SQLite (better-sqlite3)
- **LLM**: Ollama (gemma3:12b)
- **스케줄링**: node-cron

## 프로젝트 구조
```
src/
├── bot/           # MS Teams Bot
├── core/          # 타입 정의 (DI 인터페이스)
├── db/            # SQLite DB 초기화
├── handlers/      # 명령어 핸들러
├── repositories/  # Repository 패턴 (데이터 접근)
├── services/      # 비즈니스 로직
├── scheduler/     # 11:00, 11:30, 12:50 알림
├── index.ts       # Express 서버 진입점
└── seed.ts        # 초기 식당 데이터
```

## 명령어
| 명령어 | 설명 |
|--------|------|
| /도움 | 도움말 |
| /추가 [이름] [카테고리] [거리m] [가격] | 식당 추가 |
| /목록 [카테고리] | 식당 목록 |
| /투표 [식당] | 투표 |
| /추천 | AI 추천 |
| /블랙 [식당] | 블랙리스트 |
| /최애 | 내 최애 식당 |
| /리뷰 [식당] [1-5] | 별점 |
| /설정 식대 [금액] | 1인 식대 변경 |
| /설정 강제결정 on/off | 11:30 강제결정 |

## 스케줄
- **11:00** - 투표 알림
- **11:30** - 강제 결정 (설정 시)
- **12:50** - 리뷰 요청

## 개발 작업 시 주의사항
1. 항상 TypeScript strict 모드 준수
2. DI 패턴 유지 (core/types.ts 인터페이스)
3. 비즈니스 로직은 Service, 데이터는 Repository
4. 새로운 기능은 Handler → Service → Repository 순서로 구현
