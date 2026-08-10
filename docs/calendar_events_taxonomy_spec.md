# 학사일정 개편 통합 스펙 v2 (calendar_events_taxonomy) — 나이스 마스터 수집 + 행사/일과 영향 이원화

2026-08-10 사용자 확정(2단계에 걸쳐):
1. 학사일정을 **행사(일과 무영향)** 와 **일과 영향(휴업·시수 조정)** 으로 이원화한다.
2. **나이스가 학사일정의 마스터다** — SchoolSchedule API로 매일 자동 수집하므로 **수동 등록은 원칙적으로 불필요**해지고, 수동 입력은 ⓐ 시수 조정(단축수업·고사 — 나이스에 없는 유일한 정보) ⓑ 나이스 미반영 돌발 건 보정, 두 가지로 축소한다.

마스터 체인 완성형: **나이스(학교 공식 입력) → 플랫폼 학사일정 → 주간 파생·동기화(calendar_master_sync_spec) → (Phase 3) 구독 캘린더**. 각 층의 갱신 보호는 동일 패턴 — 상류 갱신이 하류를 덮되, 하류의 수동 항목은 불가침.

## §0 실증 근거 (2026-08-10 전수 209건, ATPT=J10 SCHUL=7530601)

- 공제구분 3종: 공휴일 / 휴업일(방학 79일·토요휴업 49일·재량휴업 5/4와 11/20·수능일 11/19) / 해당없음(입학식·광암제·체육대회·학평·정기시험 등).
- **모의고사(학평·수능모평)=해당없음** — "모의고사는 일반 일과" 실무가 나이스 데이터로 실증. **정기시험도 해당없음** — 나이스엔 시수 정보가 전무, "단축수업" 항목 자체가 없음 → 시수 조정은 영원히 플랫폼 몫.
- 학년별 YN 실사용(입학식=1, 체험학습=2, 졸업식=3 등). LOAD_DTM 일 단위 갱신. 키 적용 시 pSize=500 1콜 전량.

## §1 타입·필드 (types.ts)

```ts
export type CalendarEventType = "행사" | "휴업일" | "재량휴업" | "단축수업" | "고사";
export const SCHEDULE_AFFECTING_TYPES = ["휴업일", "재량휴업", "단축수업", "고사"] as const;
```

`TimetableCalendarEvent` 필드 추가:

```ts
title?: string;       // 일정 이름. 행사는 필수, 일과 영향 타입은 선택(없으면 type명)
grades?: number[];    // 해당 학년(1~3). 없으면 전 학년. 주 파생은 grades 무시(시수는 periodsByGrade가 담당)
source?: "neis" | "manual"; // 없으면 manual로 간주(레거시). neis 항목은 재수집이 관리
neisKey?: string;     // source=neis 전용 dedupe 키: `${AA_YMD}|${EVENT_NM}`
```

## §2 검증 (validateCalendarEventPayload)

- `CALENDAR_TYPES`에 "행사" 추가. 행사: title 필수(1~100자), periodsByGrade 버림. 기존 4종: 기존 규칙 + title·grades 선택 수용.
- source·neisKey는 클라이언트 제출값 무시 — 서버 경로가 부여(수동 API는 항상 manual).

## §3 나이스 수집기 (신규)

- **엔드포인트**: `/api/cron/neis-calendar` — 기존 크론 패턴(CRON_SECRET Bearer, 401 fail-closed) 답습, vercel.json에 일 1회(새벽) 등록. **Vercel 환경변수에 `NEIS_API_KEY` 추가 필요**(현재 .env.local에만 있음).
- **수집 범위**: 보관 아닌 각 학기(term)에 대해 `[term.startDate, term.endDate]` 구간의 SchoolSchedule 전량(pSize=500).
- **매핑 규칙**:
  | 나이스 | 플랫폼 |
  |---|---|
  | 공제 "공휴일" | **스킵** (공휴일 정적 표 `holidayNameOf`가 이미 파생 처리 — 중복 등록 금지) |
  | EVENT_NM "토요휴업일" | **스킵** (주간 그리드는 월~금) |
  | 공제 "휴업일" (방학·재량휴업·수능일 등) | type=휴업일, title=EVENT_NM |
  | 공제 "해당없음" | type=행사, title=EVENT_NM |
  | EVENT_CNTNT | note |
  | 학년 YN(1~3) | grades (전부 Y면 생략=전 학년) |
- **동기화 의미론(upsert·prune)**: source=neis 항목만 대상으로 neisKey 기준 upsert, 나이스에서 사라진 neis 항목은 삭제. **manual 항목 불가침.** 연속 일자·동일 EVENT_NM은 기간 이벤트 1건으로 병합(startDate~endDate — 방학 79건이 79문서가 되지 않게).
- **수집 후**: 휴업 계열(neis 유래 SCHEDULE_AFFECTING_TYPES) 변화가 있었을 때만 `syncDerivedWeeksWithCalendar` 호출 → 주간까지 자동 전파. 감사 로그 1건(추가/갱신/삭제 건수 요약).
- **읽기 규율**: 나이스 호출은 학기당 1콜, Firestore는 기존 neis 항목 조회 + 변경분 쓰기만.

## §4 서버 (server.ts / manage/route.ts)

- `loadCalendarEvents`: 신규 필드 통과. `deriveWeekInput`: 변경 없음(서두에 SCHEDULE_AFFECTING_TYPES 필터 한 줄 추가 권장 — 행위 동일, 의도 명시).
- 수동 `calendar_save`/`calendar_delete`: 일과 영향 타입일 때만 주 동기화 호출(삭제는 삭제 전 문서 type 기준). **source=neis 항목의 수동 수정·삭제는 400**("나이스에서 자동 관리되는 일정입니다" — 수정하려면 나이스에서, 시수 조정은 별도 등록 안내). 감사 로그에 title 포함.

## §5 UI (학사일정 탭 — 축소 재편)

1. **헤더**: "학사일정은 나이스에서 매일 자동으로 가져옵니다" + 마지막 수집 시각. 수동 새로고침 버튼(즉시 수집 1회 — 일과계가 나이스 입력 직후 당겨올 때).
2. **직접 등록 폼 축소**: 기본 노출은 **시수 조정 2종(단축수업·고사)** — 나이스가 못 주는 유일한 정보임을 안내("모의고사처럼 정상 시수 시험은 등록 불요 — 나이스 행사로 자동 수집됨. 교시 수가 바뀌는 지필평가·단축만 여기 등록"). "나이스에 없는 일정 직접 추가" 접힘 링크로 행사·휴업 수동 등록 예비 경로 유지.
3. **목록**: 나이스 자동 배지 vs 직접 등록 배지, 행사(회색)/일과 영향(색) 구분, title 굵게. 나이스 항목은 수정·삭제 버튼 대신 "나이스 자동" 표시.
4. 개발 용어 금지(NEIS→"나이스", source→"가져옴/직접" 등).

## §6 검증

- tsc·build(힙 4GB) 통과.
- 실측(테스트 데이터 종료 시 정리): ① 수집 실행 → 행사·휴업 항목 생성, 공휴일·토요휴업 미생성, 방학이 기간 1건으로 병합 ② 재실행 멱등(변경 0) ③ 수능일(11/19) 휴업이 해당 주 파생에 반영(노출 창 밖이면 주 등록 후 확인) ④ manual 항목이 수집에 안 지워짐 ⑤ neis 항목 수동 수정 시도 400 ⑥ 기존 `scripts/verify_calendar_sync.ts` 재통과.

## §7 Phase 3 — 구독형 캘린더 (범위 밖, 착수 시 별도 스펙)

학사일정(행사+일과 영향)을 ics 피드로 노출 → 구글 캘린더 구독. 자동 구독 방식 미결: ⓐ 앱 내 1클릭 안내(0원·권한 불요, 우선 후보) ⓑ Workspace 단 자동(DWD calendar 스코프 — 선배포 금지). 본 스펙의 title·grades·이원화가 피드 요건 선충족.
