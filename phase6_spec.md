# Phase 6 스펙 — 명단 공급 허브(6a) + 생활지도 기록(6b)

> 작성: 2026-07-25 Claude (아키텍처/스펙 판단). 배경: 사용자가 운영 중인 외부 앱들(지필평가·모의고사 현황판, 생활지도 시트, 교육과정 선택 플랫폼)의 공통 급소가 "학생 명단 수동 최신화"임을 확인. 1차로 명단 자동 공급, 이후 생활지도 기록을 플랫폼 안에 신축한다.
>
> **대원칙**: ① 명단의 단일 원본은 GWS 디렉터리(성 필드 5자리 학번 규칙)다. 플랫폼은 저장하지 않고 가공·공급한다. ② 생활지도의 규정·권한은 매년/수시로 바뀌므로 **코드에 하드코딩하지 않고 전부 Firestore 설정 데이터로 둔다.** ③ 모든 데이터 접근은 기존 패턴대로 API 라우트 + admin SDK + 서버 사이드 권한 검사로 한다(클라이언트 직접 Firestore 접근 금지).

---

## Phase 6a — 명단 공급 허브 (먼저 구현)

외부 앱 2종류에 맞는 공급 채널 2개. 모두 읽기 전용.

### 6a-1. 읽기 전용 명단 API

- **엔드포인트**: `GET /api/roster/feed`
- **인증**: `Authorization: Bearer <API키>`. API 키는 소비자(앱)별로 발급.
  - Firestore `roster_api_keys/{domain}/keys/{keyId}`: `{ name(용도 라벨), hashedKey(SHA-256), createdAt, lastUsedAt, revoked }`
  - **평문 키는 발급 순간 1회만 표시**하고 해시만 저장. 검증은 해시 비교.
- **응답(JSON)**: `{ students: [{ studentId: "10101", grade: 1, classNum: 1, number: 1, name: "고보경", email: "10101@hmh.or.kr", suspended: false }], generatedAt }`
  - `?format=csv` 지원 (앱스스크립트/시트 직접 소비용). `?grade=1` 필터 지원.
  - 정지 계정은 `suspended: true`로 포함(소비자가 결시 처리 등에 활용) — 단 기본은 `suspended=false`만, `?includeSuspended=true`로 옵션.
- **구현**: 기존 `listUsersInOUs` + `StudentRoster.tsx`의 학번 파싱 규칙(`/^(\d)(\d{2})(\d{2})$/`)을 서버 유틸로 추출해 재사용. 파싱 실패 학생은 `unparsed` 배열로 분리 반환.
- **관리 UI**: 수퍼어드민 설정 화면에 "명단 API 키 관리" 탭 — 발급(용도 입력)·폐기·마지막 사용 시각 표시.
- **감사 로그**: 키 발급/폐기만 기록(호출마다 기록하면 폭주 — `lastUsedAt` 갱신으로 갈음).

### 6a-2. 명렬표 마스터 시트 자동 갱신

- **대상**: 공유 드라이브의 지정 스프레드시트 1장(시트 ID는 설정에 저장). 학년별 탭(1학년/2학년/3학년), 열: 학번·반·번호·성명·이메일.
- **갱신 트리거**: ① 매일 크론(기존 lifecycle 크론에 스텝 추가), ② 관리 화면의 "지금 갱신" 수동 버튼.
- **방식**: 전체 클리어 후 재작성(diff 관리 불필요, 수백 행 규모라 충분).
- **필요 스코프**: 서비스 계정 도메인 위임에 `https://www.googleapis.com/auth/spreadsheets` **추가 등록 필요** → `deployment_checklist.md` §2에 추가할 것.
- 기존 현황판들은 참조원만 이 시트로 교체(IMPORTRANGE 또는 앱스스크립트 읽기). 기존 앱 코드 수정 최소화.

### 6a-3. 교육과정 선택 앱 연동

- 별도 Firebase 프로젝트·별도 계정 유지. **이전/병합하지 않는다**(잘 작동하는 것을 부수지 않음).
- 해당 앱의 서버(API 라우트)에서 6a-1 API를 호출해 CSV 업로드 단계 제거. API 키 1개 발급.
- 소유권 이전(학교 관리 계정으로)은 별도 판단 사항으로 보류 — 병합과 혼동하지 말 것.

---

## Phase 6b — 생활지도 기록 모듈

### 핵심 설계 원칙

규정(항목·횟수·단계)과 권한(누가 어디까지)이 **전부 학생부 커스터마이징 대상**이다. 따라서:

- 규정 = `discipline_config` 설정 문서 (학생부가 UI에서 편집)
- 권한 = 기본 규칙(담임=자기 반) + **개별 부여(grant) 테이블** (학생부장/수퍼어드민이 UI에서 부여·회수)
- 코드는 "설정을 해석하는 엔진"만 담당

### 데이터 모델 (Firestore, 모두 admin SDK 전용)

```
discipline_config/{domain}                    ← 규정 단일 문서
  items: [{ id, label(예: 흡연), category, active }]
  stages: [{ id, order, label(예: 담임지도→학년지도→학생부→선도위) }]
  rules: [{ id, trigger: { itemId 또는 category, countThreshold }, targetStageId }]
  countResetPolicy: "학기" | "학년도" | "없음"
  visibility: { homeroomCanViewOtherClasses: bool, gradeHeadScope: "own_grade"|"all", ... }

discipline_permissions/{domain}/grants/{grantId}   ← 개별 권한 부여
  { teacherEmail, scope: {type:"class",grade,classNum} | {type:"grade",grade} | {type:"all"},
    rights: ["view","record","resolve","manage_rules","manage_permissions"],
    grantedBy, grantedAt, expiresAt(선택, 학년도 말 자동 만료용) }

homeroom_assignments/{domain}                  ← 담임 배정표 (연 1회 갱신)
  { "1-1": "teacher-a@hmh.or.kr", "1-2": ..., updatedAt, updatedBy }

discipline_records/{domain}/records/{recordId} ← 지도 기록 (불변 지향)
  { studentId: "10101", studentEmail, grade, classNum,   ← 기록 시점 스냅샷
    itemId, occurredAt, note, recordedBy, recordedAt,
    voided: bool, voidedBy, voidReason }                 ← 삭제 대신 무효화

discipline_stage_events/{domain}/events/{eventId}  ← 단계 진입/처리 이력
  { studentId, stageId, enteredAt, cause: "auto"|"manual", causeRecordIds,
    resolvedAt, resolvedBy, resolution(조치 내용) }
```

- **학생의 현재 단계는 저장하지 않고 계산**한다(records + rules + resetPolicy로 서버에서 산출). 규정이 바뀌면 재계산으로 자연 반영. 수동 개입은 stage_events의 manual 이벤트로 우선 적용.
- **기록은 삭제 금지, 무효화(void)만 허용** — 징계성 데이터의 무결성·분쟁 대비. 모든 기록/무효화/단계 처리에 감사 로그.

### 권한 판정 순서 (서버 사이드)

1. 수퍼어드민 → 전체 권한
2. `discipline_permissions` grant에 해당 scope·right 있으면 허용
3. 담임 기본권: `homeroom_assignments`에서 자기 반이면 view+record
4. 열람 기본값: `visibility` 설정 적용 (예: 타반 열람 허용 여부)
5. 그 외 거부

→ "학생부 계원에게 이번 학기 수퍼 권한" = grant 1줄 추가로 해결. "학년부장에게 전 학년" = scope grade/all grant. 코드 변경 불필요.

### 화면 (전부 기존 /admin 아래)

1. **기록 입력** — 반 선택(권한 내) → 학생 목록(6a 명단 유틸 재사용) → 항목 체크 + 메모. 모바일 사용 고려(현장 적발 시 폰 입력).
2. **우리 반/학년 현황** — 학생별 항목·횟수·현재 단계 테이블. 단계 도달 학생 강조.
3. **단계 처리함** (학년부장·학생부) — 새로 단계에 도달한 학생 큐 → 조치 입력 → 처리 완료.
4. **규정 편집기** (manage_rules 권한) — 항목/단계/규칙/리셋 정책/열람 정책 편집. 규정 변경 시 "기존 기록에 소급 재계산됨" 경고 표시.
5. **권한 관리** (manage_permissions 권한) — grant 목록/부여/회수/만료일.
6. **담임 배정표** — 연 1회 갱신 UI (자동완성으로 교사 검색).

### 개인정보·보안 (필수 준수)

- `personal_data_inventory.md`에 생활지도 기록 항목 추가 — **민감도 최상** 분류.
- **파기 주기는 사용자(학교) 결정 필요**: 졸업/전출 시 즉시 파기? N년 보존? → 결정 전까지는 계정 삭제 크론과 **연동하지 않는다**(임의 파기 금지). 결정 후 lifecycle 크론에 파기 스텝 추가.
- Firestore 규칙: 이 컬렉션들은 클라이언트 접근 전면 차단(admin SDK 전용).
- 모든 조회 API에 서버 사이드 권한 검사(위 판정 순서). 가드 허용 목록 늘릴 때 "학생 역할 통과 여부 + 클라이언트 파라미터 신뢰 여부" 점검(2026-07-24 403 회귀의 교훈).

### 명시적 범위 제외 (이번 Phase에서 안 함)

- 범용 동적 폼 빌더로의 일반화 — 생활지도 규정 편집기가 사실상 그 첫 사례. 다른 수요(지필평가 입력 등)가 실제로 생기면 그때 일반화.
- 지필평가·모의고사 현황판 흡수, 전자칠판 키오스크 뷰 — 후속 Phase.
- 학부모 통지 자동화 — 아이디어로만 보관.

---

## 구현 순서와 분업

| 순서 | 작업 | 담당 |
|---|---|---|
| 1 | 6a-1 명단 API + 키 관리 (학번 파싱 유틸 추출 포함) | Antigravity 구현, Claude가 인증·키 해시 부분 표적 리뷰 |
| 2 | 6a-2 마스터 시트 갱신 (스코프 등록은 사용자가 GWS 콘솔에서) | Antigravity |
| 3 | 6b 데이터 모델·권한 엔진·판정 API | **Claude 직접 구현** (보안 핵심부, Max20 확장 적용) |
| 4 | 6b 화면 6종 | Antigravity (Claude 스펙 기준) |
| 5 | 개인정보 문서·파기 정책 반영 | Claude + 사용자 결정 |

## 미결정 사항 (사용자 답변 필요)

1. 생활지도 기록 **파기 주기** (졸업 시? N년?)
2. 마스터 시트를 둘 **공유 드라이브** 준비 (없으면 생성 필요 — 사용자가 GWS 관리콘솔에서)
3. 현행 규정표 샘플 (항목·단계·횟수 실물) — 규정 편집기 초기값과 UI 검증용
