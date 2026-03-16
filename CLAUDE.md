# MeaLOps - MS Teams 점심 투표 봇

## 프로젝트 개요
사내에서 점심 메뉴 선정의 어려움을 해결하기 위한 MS Teams 봇입니다.
- TypeScript + Clean Architecture
- SQLite DB + Repository 패턴
- Ollama (로컬 LLM) 추천
- setInterval 기반 KST 스케줄링

## 기술 스택
- **언어**: Node.js + TypeScript
- **프레임워크**: Express + MS Bot Framework (botbuilder)
- **DB**: SQLite (better-sqlite3)
- **LLM**: Ollama (gemma3:12b)
- **인증**: SingleTenant (CloudAdapter)

## 프로젝트 구조
```
src/
├── bot/           # MS Teams Bot (모든 카드 액션 처리)
├── cards/         # Adaptive Card 빌더 (투표/목록/히스토리 등)
├── core/          # 타입 정의 (DI 인터페이스)
├── db/            # SQLite DB 초기화
├── handlers/      # 명령어 핸들러
├── repositories/  # Repository 패턴 (데이터 접근)
├── services/      # 비즈니스 로직 (vote, recommendation, favorite 등)
├── scheduler/     # KST 기반 스케줄 알림 (11:00, 11:30)
├── index.ts       # Express 서버 진입점
└── seed.ts        # 초기 식당 데이터
```

## 주요 기능
- **투표**: 다중 선택, 혼밥, 아무거나 / 토글 취소 / 사용자별 선택 상태 표시
- **식당목록**: 이름/거리/가격/⭐점수 다중 정렬, 카테고리 그룹핑, 평균 리뷰 표시
- **히스토리**: 주간/월간 조회, 리뷰 완료 여부 표시(✅/⭐), 리뷰 후 즉시 복귀
- **리뷰**: 방문일 기준 저장, 날짜별 독립 평점, 덮어쓰기 가능
- **동점처리**: 최근 방문 적은 곳 → 평점 높은 곳 → 랜덤
- **배달모드**: 배달 가능 식당만 필터링
- **AI추천**: Ollama 기반, 블랙리스트·최근방문·날씨 반영, 새로고침 지원

## 카드 액션 verb 목록 (bot/index.ts)
| verb | 설명 |
|------|------|
| main_menu | 메인 메뉴 |
| show_vote | 투표 카드 |
| vote / vote_solo / vote_any | 투표 (토글) |
| recommend / refresh_recommend | AI 추천 |
| show_list / sort_list | 식당 목록 / 정렬 |
| add_restaurant_form / create_restaurant | 식당 추가 |
| edit_restaurant / save_restaurant | 식당 수정 |
| delete_restaurant | 식당 삭제 |
| blacklist_toggle / blacklist_add / blacklist_remove | 블랙리스트 |
| my_favorites / my_blacklist | 최애·블랙 조회 |
| show_settings / set_budget | 설정 |
| toggle_force_decision / toggle_delivery_setting | 강제결정·배달 토글 |
| decide_now | 즉시 결정 |
| dashboard / dashboard_view | 히스토리 (주간/월간) |
| show_review / review | 리뷰 카드 / 리뷰 저장 |

## 스케줄 (KST, 평일만)
- **11:00** - 투표 알림 카드 발송 (VOTE_HOUR:VOTE_MINUTE 환경변수)
- **11:30** - 강제 결정 (설정 시, FORCE_DECISION_MINUTE)
- **12:50** - 리뷰 요청 카드 발송

## 개발 작업 시 주의사항
1. 항상 TypeScript strict 모드 준수
2. DI 패턴 유지 (core/types.ts 인터페이스)
3. 비즈니스 로직은 Service, 데이터는 Repository
4. 새로운 기능은 Handler → Service → Repository 순서로 구현
5. 카드 UI는 cards/index.ts에서만 수정
6. 스케줄러는 UTC 기준 서버에서 KST(+9h) 변환해서 동작
