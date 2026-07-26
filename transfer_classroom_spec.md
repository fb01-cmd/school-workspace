# 전입생 학급 클래스룸 자동 편성 — 상세 스펙 (2026-07-26)

> 작성: Claude (실현 가능성 검토는 project_notes.md 2026-07-26 기록 참조).
> 구현: Antigravity. 이 문서의 §7 구현 순서대로 진행하고, 완료 시 project_notes.md에 기록한다.

## 1. 목표와 배경

전입생 처리(`enroll_students` 액션, `TransferInTab.tsx`)는 계정 생성 + 반별 그룹 추가까지만 수행한다.
교사들이 학생을 **개별 등록**한 학급 단위 클래스룸(담임 학급방, 그 반 전체가 듣는 교과방)에는 전입생이 들어가지 못한다.
이 기능은 **그 반 학생들이 대부분 가입돼 있는 클래스룸을 역으로 찾아내, 실무사 확인 후 전입생을 일괄 추가**한다.

핵심 원칙 (사용자 확정):
- **전자동 금지** — 스캔 결과는 후보 목록으로 제안하고, 실무사가 확인·선택한 뒤에만 실행한다.
- **상시 모니터링 금지** — 전입 처리 시점에만 온디맨드 스캔.

## 2. 범위

**포함**: ACTIVE 코스 대상 스캔, 매칭 후보 제안 UI, 선택 항목 일괄 추가, 감사 로그.
**제외 (v1)**:
- 전출생의 클래스룸 자동 **제거** (향후 아이디어로만 메모)
- ARCHIVED/삭제 코스, 선택과목·수준별 등 혼성 코스(매칭 조건에서 자연 탈락)
- 스캔 결과 캐싱/스케줄링

## 3. 권한과 데이터 소스

- **엔드포인트 권한**: `super_admin` 전용 (관리자 impersonation을 쓰므로 교사에게 열지 않는다).
- **코스 스캔**: `GOOGLE_WORKSPACE_ADMIN_EMAIL` impersonation으로 `courses.list`를 **teacherId 없이** 호출하면 도메인 전체 코스가 반환된다(관리자 특권). `courseStates: ["ACTIVE"]`.
- **로스터 조회**: 같은 admin impersonation으로 `courses.students.list`.
- **반 재적 명단**: `settings.{domain}.ouMapping.students`의 OU 경로에서 `listUsersInOUs` → `parseStudentUser`로 학년·반 파싱 (roster feed와 동일 방식). **suspended 계정은 제외**하고, **전입생 본인도 제외**한 집합을 기준으로 삼는다.
- 필요 스코프(`classroom.courses`, `classroom.rosters`)는 기존 DWD 부여분으로 충분. 신규 스코프 없음.

## 4. 매칭 알고리즘

반 재적 집합을 `CLASS`(이메일 소문자 기준), 코스 로스터 집합을 `COURSE`라 할 때:

```
coverage = |COURSE ∩ CLASS| / |CLASS|      // 우리 반 학생 중 이 코스에 가입된 비율
purity   = |COURSE ∩ CLASS| / |COURSE|     // 이 코스 인원 중 우리 반 학생 비율
```

**후보 판정: `coverage ≥ 0.8 && purity ≥ 0.7 && |COURSE| ≥ 5`**

- coverage가 학급 단위성(우리 반이 다 들어가 있나), purity가 배타성(다른 반 위주 코스 배제)을 담당한다.
- 임계값은 상수로 분리해 두되 v1에서는 고정값 사용 (튜닝은 실사용 후).
- 결과는 coverage 내림차순 정렬. 각 후보에 `{courseId, name, section, ownerName, ownerEmail, coverage, purity, courseSize, alreadyEnrolled}` 포함.
  - ownerName/ownerEmail은 `userProfiles.get(ownerId)`(admin impersonation)로 해석. 실패 시 ownerId 그대로 노출.
  - `alreadyEnrolled`: 전입생이 이미 로스터에 있으면 true (UI에서 비활성 표시).

## 5. API 설계 — 신규 라우트 `/api/workspace/classroom/transfer-enroll/route.ts`

> **[v2.0 개정, 2026-07-26] 로스터 방식 전면 폐기 → 역방향 멤버십 집계로 재설계.**
> **운영 사고 2호(silent 미탐, 실측으로 확정)**: v1.1 배치 스캔이 실서버에서 오류 없이 후보 0건 반환.
> 원인: `courses.students.list`의 `profile.emailAddress`는 **`classroom.profile.emails` 스코프가 있어야 응답에 포함**되는데,
> 이 스코프는 코드(`getClassroomClient`)에도 없고 **DWD 허용 목록에도 없다**(토큰 발급 거부 실측). 따라서 모든 코스의
> 이메일 집합이 빈 값 → 교집합 0 → 무오류 0건. mock은 emailAddress를 스텁으로 채워주기 때문에 mock 검증으로는 절대 못 잡는다.
> 동시에 확인된 사실: 반 재적 27명에 대해 `courses.list(studentId=이메일)` 27회로 코스별 가입 수를 직접 집계하면
> **1,257개 로스터 조회가 ~30여 회 호출로 대체**되고, 이메일 스코프 자체가 불필요해진다. (실측: "통합사회 1-10" 26/27,
> "한국사 1-10" 26/27, "공통수학1 (1학년 10반)" 26/27, "2026 과학탐구실험 1학년 10반" 25/27 — 모두 기준 충족.)
>
> ### v2.0 프로토콜
> - **`scan_init`**: 반 명단(§3)만 구성해 `{ classEmails, totalClassCount }` 반환. `listAllDomainCourses` 호출 삭제 (더 이상 코스 목록 불필요).
> - **신규 `POST { action: "scan_members", studentEmail, classEmails }`** (v1.1의 scan_batch 대체·삭제):
>   1. super_admin 검사. `classEmails` 3~40명 검증.
>   2. 멤버별 `classroom.courses.list({ studentId, courseStates: ["ACTIVE"] })`(pageToken 루프)를 **동시성 3**으로 실행,
>      코스별 가입 수 집계. 실패 멤버는 버리지 말고 `failedMemberEmails`로 반환 (silent 미탐 금지).
>   3. `가입수/유효멤버수 >= 0.8` 코스만 후보로 남기고, 각 후보의 `students.list` **인원수만 카운트**(이메일 불필요)하여
>      purity(가입수/코스인원) ≥ 0.7, size ≥ 5 판정. 후보는 실무상 수 개이므로 추가 호출 부담 없음.
>   4. `alreadyEnrolled`: 전입생 본인의 `courses.list(studentId=전입생)` 1회로 판정.
>   5. ownerName/ownerEmail은 기존 `getClassroomUserProfile` 유지 (emailAddress는 DWD 스코프 추가 전까지 ownerId 폴백 허용).
>   6. 반환: `{ candidates, failedMemberEmails, checkedMemberCount }`.
> - **클라이언트(TransferInTab)**: 배치 루프·진행률 제거 → `scan_init` → `scan_members` 1회 호출(수 초 내 완료), 실패 시
>   1회 재시도. `failedMemberEmails` 잔존 시 "⚠️ N명 명단 대조 실패 — 결과가 불완전할 수 있음" 경고 표시. `safeFetchJson` 유지.
> - **회귀 판정 기준(실서버, 이번 실측값)**: 1학년 10반 스캔 시 위 4개 코스가 후보로 떠야 하며, "공통영어 교수학습 자료"
>   (coverage 78%, purity 7%)는 탈락해야 한다. mock 검증만으로 완료 처리 금지.
>
> ### 별도 트랙 — DWD 스코프 추가 (스캔과 무관하게 필요)
> `classroom.profile.emails` 부재로 **① 강제 배정 페이지의 학생 이메일 표시·제거, ② 후보 담당교사 이메일 표시**가
> 프로덕션에서 깨져 있다(이메일 필드 미수신). 수정 순서 엄수: **사용자가 관리 콘솔 DWD 허용 목록에 스코프를 먼저 추가**
> (admin.google.com → 보안 → API 제어 → 도메인 전체 위임 → 해당 클라이언트 ID 스코프에
> `https://www.googleapis.com/auth/classroom.profile.emails` 추가) → 검증 후 → `getClassroomClient` scopes에 추가·배포.
> **코드를 먼저 배포하면 DWD 거부로 모든 Classroom 호출이 즉사하므로 순서 역전 금지.**
>
> <details><summary>[폐기] v1.1 배치 프로토콜 (2026-07-26, scan_batch — silent 미탐으로 폐기)</summary>
>
> **[v1.1 개정, 2026-07-26]** 단일 요청 `action: "scan"`은 실서버에서 **폐기**한다.
> 운영 사고: 실제 규모(수백 코스)에서 Classroom API 분당 사용자별 쿼터 429 폭주 + gaxios 내부 재시도 증폭 → Vercel 60초 타임아웃 → 비JSON 응답으로 프런트 파싱 실패 (Vercel 로그로 확정).
> 아래 **클라이언트 주도 배치 프로토콜**로 대체한다.
>
> </details>

### `POST { action: "scan_init", grade, classNum, studentEmail }`
1. `verifyAuthAccess` + `super_admin` 검사.
2. 반 재적 집합 구성 (§3). `|CLASS| < 3`이면 400.
3. `listAllDomainCourses`로 ACTIVE 코스 목록만 조회 (로스터 조회 없음 — 빠름).
4. 반환: `{ classEmails: string[], courses: [{id, name, section, ownerId}] }`.

### `POST { action: "scan_batch", studentEmail, classEmails, courses: [{id,...}] }` (코스 ≤ **15개**)
1. 동일 권한 검사. `classEmails`는 scan_init 결과를 그대로 되돌려 받는다(super_admin 전용이므로 신뢰 가능, 재조회 비용 절약).
2. 배치 내 로스터 조회 **동시성 3**으로 §4 판정 → `{ candidates: [...], failedCourseIds: [...] }` 반환.
3. **429/오류 코스를 조용히 버리지 말 것** — `failedCourseIds`로 반드시 노출한다 (silent 미탐 금지).

### 클라이언트 루프 (TransferInTab)
- scan_init → 코스 목록을 15개씩 순차 배치 호출(병렬 금지, 배치 간 500ms 대기) → 진행률 표시 "코스 검사 중 N/M".
- 전 배치 종료 후 `failedCourseIds` 합집합이 있으면 1초 대기 후 **1회 일괄 재시도**, 그래도 실패분은 "⚠️ N개 코스 검사 실패(쿼터) — 잠시 후 재스캔 권장"으로 표시.
- 후보 0개면 "해당 반의 학급 단위 클래스룸을 찾지 못했습니다" 표시.
- **fetch 응답 방어**: `res.json()` 전에 `res.ok`와 Content-Type 확인, 비JSON이면 상태코드 포함 안내 메시지 표시 (타임아웃 등 인프라 오류 대비).

### `POST { action: "enroll", ... }` — 변경 없음 (기존 유지)

### `POST { action: "enroll", studentEmail, courseIds: string[] }`
1. 동일 권한 검사. `courseIds` 1~30개 제한.
2. 각 코스에 기존 `addStudentToClassroom`(admin impersonation) 순차 실행.
   - **409(ALREADY_EXISTS)는 성공("이미 가입")으로 분류** — 실패로 표시하지 않는다.
   - 개별 실패가 나머지를 중단시키지 않는다 (per-course 결과 배열 반환).
3. `writeAuditLog(action: "CLASSROOM_TRANSFER_ENROLL", targetEmail: studentEmail, details: 코스명 목록)`.

## 6. UI — `TransferInTab.tsx` 확장

- 전입 처리 결과 행(계정 생성 성공 학생)마다 **[학급 클래스룸 스캔]** 버튼 추가.
- 클릭 시 스캔 실행(로딩 표시 — 수십 초 걸릴 수 있음을 안내) → 모달로 후보 목록 표시:
  - 행: 체크박스(기본 전체 선택) · 코스명/섹션 · 담당 교사 · "우리 반 N/M명 가입(coverage%)" · 이미 가입 시 배지+비활성.
  - 하단: [선택 n개 클래스룸에 추가] → 실행 결과(추가됨/이미 가입/실패 사유)를 같은 모달에 표시.
- 별도 메뉴 신설 금지 — v1은 전입 플로 안에서만 노출.

## 7. 구현 순서 (각 단계 tsc 통과 후 다음으로)

1. `workspace.ts` 헬퍼: `listAllDomainCourses`(admin impersonation, 페이지네이션), `listClassroomStudents` 페이지네이션 보강(현재 단일 페이지만 조회 — 기존 호출부 영향 없는지 확인), `getClassroomUserProfile(userId)`.
2. `/api/workspace/classroom/transfer-enroll/route.ts` — scan/enroll 액션.
3. `TransferInTab.tsx` UI.
4. 검증: 테스트 반(test OU) 학생들로 클래스룸 1개 구성 → 가상 전입생 처리 → 스캔이 해당 코스만 잡는지(다른 코스 미포함), 추가 실행/이미 가입 409 처리, 감사 로그 기록을 화면으로 확인.

## 8. 엣지 케이스와 주의

- **계정 전파 지연**: 방금 생성된 전입생 계정은 Directory 전파 전에 `students.create`가 404를 낼 수 있다. enroll 실패 사유에 "잠시 후 재시도" 안내를 포함하고, 스캔 버튼은 전입 처리 직후에도 누를 수 있게 하되 실행은 재시도 가능하게 설계.
- **mock 모드**: `isMock` 분기 필수 — mockCourses에 학급 단위 코스 샘플(같은 반 학생 다수 가입) 1개 추가해 스캔~추가 흐름을 로컬에서 재현 가능하게.
- **응답 시간**: 스캔이 Vercel 함수 제한(기본 10s~)을 넘을 수 있음 — `maxDuration` 60 설정(기존 라우트 관례 확인 후 동일하게).
- 임계값·동시성 상수는 파일 상단에 모아 주석으로 근거 표기.
