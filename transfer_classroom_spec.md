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

### `POST { action: "scan", grade, classNum, studentEmail }`
1. `verifyAuthAccess` + `super_admin` 검사.
2. 반 재적 집합 구성 (§3). `|CLASS| < 3`이면 400 (신뢰할 매칭 불가).
3. 도메인 ACTIVE 코스 전체 조회 — **pageToken 루프 필수** (`pageSize: 500`, 새 헬퍼 `listAllDomainCourses`).
4. 각 코스 로스터 조회 — **pageToken 루프 필수** + **동시성 제한 5** (배치 단위 Promise.all; 코스 수백 개 대비 per-minute 쿼터 보호).
5. §4 판정 후 후보 배열 반환. 후보 0개면 빈 배열 (UI가 "해당 반의 학급 단위 클래스룸을 찾지 못했습니다" 표시).

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
