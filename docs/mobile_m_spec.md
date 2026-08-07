# 모바일 전용 경로 `/m` 스펙 (2026-08-08, Claude)

로드맵 §2 "모바일 사용성 — 동일 도메인 `/m` 확정안"(2026-08-08 사용자·Claude 합의)의 구현 스펙.
원칙 재확인: **전 화면 반응형 폐기, 서브도메인 폐기(푸시·설치 앱·세션이 origin에 묶임), 관리 업무는 PC.**
학생은 기존 `/student-portal`이 이미 /m 역할이므로 **이번 범위는 교사(teacher·super_admin) 전용**이다.

## §1. 범위

**신규**
- `src/app/m/page.tsx` — 모바일 교사 홈 (client 컴포넌트, RouteGuard `["teacher","super_admin"]`)
- `src/components/mobile/TodayTimetableCard.tsx` — 오늘·내일 내 시간표 카드 (§4)

**수정 (각 1곳)**
- `src/app/login/page.tsx` — 역할 리다이렉트에 모바일 분기 추가 (§2)
- `src/app/admin/page.tsx` — 사이드바 모바일 기본 닫힘 (§5)

**수정 금지**: `public/sw.js`, push 발송부(`src/lib/push/*`), `student-portal`, `RouteGuard.tsx`.
푸시 랜딩 URL은 손대지 않는다 — 교사 기본 `/` → `redirect("/login")` → §2 분기를 자연 통과하므로 발송부 변경 없이 알림 랜딩 분기가 달성된다.

## §2. 진입 분기 규칙

분기는 **`/login`의 역할 리다이렉트 한 곳에서만** 한다 (`login/page.tsx`의 useEffect, 현재 student→`/student-portal` else→`/admin`인 곳):

```
role === "student"            → /student-portal (기존 그대로)
그 외 + 모바일 뷰포트         → /m
그 외                         → /admin (기존 그대로)
```

- **모바일 판정**: `window.matchMedia("(max-width: 767px)").matches` (Tailwind `md` 미만). UA 스니핑 금지. 폰의 설치 앱(standalone)도 뷰포트로 자연 포섭된다.
- **`/admin` 직접 접근은 리다이렉트하지 않는다.** /m의 "PC 화면" 링크가 /admin으로 가야 하므로 강제하면 루프가 된다. 폰에서 /admin을 열면 그대로 보여준다(§5의 최소 보정만).
- PC에서 /m을 열어도 튕기지 않는다 (무해).
- 학생이 /m에 오면 RouteGuard가 기존 로직으로 `/student-portal`로 보낸다 — 추가 코드 불요.

## §3. /m 화면 구성

사이드바·메뉴 없음. 단일 세로 컬럼(`max-w-md mx-auto` 정도), 위에서부터:

1. **헤더(간단)**: "효명고등학교" + 사용자 이름 + 로그아웃 버튼. 높이 최소화.
2. **알림 켜기**: `PushNotificationManager` 그대로 재사용 (props 없음).
3. **오늘·내일 내 시간표**: 신규 `TodayTimetableCard` (§4).
4. **오늘 급식**: `MealCard` 그대로 재사용.
5. **PC 화면 링크**: 하단 텍스트 링크 — "전체 기능(관리 화면)은 PC 화면에서 →" → `/admin` 이동. 새 창 아님, 같은 탭.

순서 근거: 교사 홈 확정 순서(알림 → 시간표 → 급식, 2026-08-07 사용자 지시)를 따른다.
super_admin도 동일 구성(역할 분기 없음). 시간표가 비면 카드의 빈 상태 문구로 처리.

## §4. TodayTimetableCard

주간 그리드(`MyTimetableCard`)는 `min-w-[500px]` 표라 폰에 부적합 — 재사용하지 않고 신규 작성.

- **데이터**: 기존과 동일 `POST /api/timetable/view` `{action:"my"}` 1회. 응답의 `data.cells`(`TeacherTimetableCell[]`)와 `week`(`{id, startDate, days}`)를 소비. API·서버 수정 없음.
- **요일 매핑**: `week.startDate`(월요일 ISO)와 오늘·내일 날짜의 차로 `day`(1=월…5=금)를 계산. 날짜는 로컬(KST) 기준 `new Date()`.
- **섹션 2개 세로 나열**: "오늘 M/D(요일)" / "내일 M/D(요일)". 탭 없음.
- **섹션별 렌더 규칙** (우선순위 순):
  1. 해당 날짜가 이번 주(월~금) 밖(주말·다음 주) → "수업일이 아닙니다" 한 줄. 주 넘어가는 추가 조회는 하지 않는다(단순성; 월요일이 되면 현재 주 폴백이 자동 전환).
  2. `week.days`에서 해당 day가 `holiday` → "휴업일" 한 줄.
  3. 수업 셀 없음 → "수업이 없습니다".
  4. 그 외 → 셀을 `period` 오름차순 리스트로: **`N교시` + `학년-반` + 과목(subjectShort 우선, 없으면 subjectName) + 교실(room, 있을 때만 작게)**.
- **변경 강조**: `cell.changed`가 있으면 앰버 배경 + 라벨 1개 — `changed.type === "substitute"`면 "보강", 그 외 "교체". 상세 출처는 표기하지 않는다(폰에선 과함; 상세는 PC).
- **동시수업**: `cell.simul` 있으면 기존 색 관례대로 보라 계열 포인트만. 라벨 추가 없음.
- 로딩·오류 상태는 기존 카드들 문구 톤 따름. 오류 시 재시도 버튼 1개.

## §5. /admin 사이드바 모바일 기본 닫힘 (최소 보정)

`/m`에서 PC 링크로 폰에서 /admin을 열 수 있으므로, 현재 `useState(true)`로 첫 화면부터 사이드바가 본문을 뭉개는 문제만 보정한다:

- 마운트 시(기존 `admin_sidebar_collapsed` localStorage를 읽는 useEffect 근처에서) `matchMedia("(max-width: 767px)")`면 `setIsSidebarOpen(false)`.
- 딱 여기까지. **드로어/오버레이화·관리 화면 모바일 최적화는 범위 밖**(로드맵 §2 3단계 "관리 업무는 PC" 원칙 — 가로 스크롤로 기능만 보장).

## §6. UI 문구 규칙 (재확인)

- 화면 노출 문구에 개발 용어 금지: "PWA"·스펙 문서명·조항 번호 등 내부 참조를 쓰지 않는다. "앱으로 설치/실행" 눈높이 표현.
- 학생 눈높이 용어 규칙은 교사 화면이므로 해당 없음 — 단 "보강/교체" 라벨은 §4 그대로.

## §7. DoD (자가 검증)

1. `tsc` 0 · `next build` ✅ (이 기기는 `NODE_OPTIONS=--max-old-space-size=4096` 필요).
2. 데스크톱 뷰포트 로그인 → `/admin` 랜딩 (기존과 동일, 회귀 없음).
3. 375px 뷰포트(devtools 모바일 에뮬) 로그인 → `/m` 랜딩. 카드 3종 + PC 링크 렌더, 가로 스크롤 없음.
4. `/m` PC 링크 → `/admin` 이동, 사이드바 닫힌 상태로 본문이 전체 폭.
5. TodayTimetableCard: 오늘·내일 두 섹션 표기, 주말이면 "수업일이 아닙니다" 분기 확인(시스템 날짜 기준 — 8/8(토) 구현 시점엔 이 분기가 바로 보인다).
6. 학생 계정으로 `/m` 접근 → `/student-portal` 리다이렉트.
7. 변경 셀 강조는 실변경 데이터 없으면 코드 리뷰로 갈음(첫 결보강 실전 검증 체크리스트 C-13에 이미 포함).
