# Phase 9a 상세 스펙 — 시간표 도입 + 전 구성원 열람 (컴시간알리미 대체)

> 2026-07-26 Claude 작성 (아키텍처·데이터 모델·권한 판단). 상위 문서: [`phase9_spec.md`](./phase9_spec.md).
> §6 미결정 5건 중 4건이 사용자 답변으로 확정됨 (아래 §0). 남은 1건 = 실데이터 샘플 2종.

## 0. 확정 답변 (2026-07-26 사용자)

| §6 항목 | 답변 | 스펙 반영 |
|---|---|---|
| 1. 컴시간 계약 | 종료는 2027-02이라도 **재계약 여부는 2026-12 이전 결판** | 9c 실사용 검증을 **2026-11 말까지** 완료해야 함 (킬 스위치 판단 시한) |
| 2. 도입 시점 | **여름방학 중 구축 → 2학기 개학과 동시 오픈** | 9a 완성 목표 = 2026-08 개학 전. 2학기 기초시간표를 컴시간에서 가져와 병행 운영 |
| 3. 승인 권한 | **실무사 단독 승인 + 교무부장은 알림만** — 진짜 승인은 NEIS에서 하므로 플랫폼 결재는 무의미 | 결재 단계 없음. 9b-3 승인 시 교무부장·관련 교사에게 구글 챗 알림(발신자 규칙 준수) |
| 4. 학생 열람 | **자기 반만** | 학생 API는 서버에서 학번→반 도출, 요청 파라미터 무시 |
| 5. 샘플 2종 | **미확보** — 컴시간 "엑셀로 인쇄" 전체시간표 + 교사별 시수표 엑셀 | §4 파서의 열 매핑만 이 샘플 대기. 나머지는 전부 착수 가능 |

**전체 일정 역산**: 9a = 8월 개학 전 → 9b = 9~10월 구축·실사용 → 9c = 11월 말 검증 완료 → 12월 전 재계약 결정.

## 1. 권한 모델 (생활지도보다 단순 — 의도적)

시간표는 개인정보가 아니라 **전 구성원 공유 운영 정보**다. 생활지도의 scope·expiry grant 기계를 그대로 복제하지 않고 의도적으로 단순화한다.

| 역할 | 열람 | 변경 |
|---|---|---|
| super_admin | 전체 | 전체 (설정·관리자 지정 포함) |
| 관리자(일과계) — `timetable_settings.managerEmails`에 등록된 교직원 | 전체 | 가져오기, 학기 활성화, 설정 |
| teacher | **전체** (내·타 교사·전 학급·공강 조회 — 컴시간알리미와 동일) | 없음 (9b에서 교체 신청만 추가) |
| student | **자기 반만** (서버가 학번에서 반 도출 — `loadMyHomeroomClasses` 계열의 생활지도 패턴 재사용) | 없음 |

- 관리자 지정은 grant 컬렉션 대신 **`timetable_settings/{domain}.managerEmails: string[]`** 한 필드로 관리한다. 대상이 실무사 1~2명이고 scope·만료 개념이 필요 없으므로 grant 기계는 과잉. super_admin만 이 필드를 수정할 수 있다.
- 판정은 전부 **서버 사이드** (API 라우트 + admin SDK). Firestore 클라이언트 직접 접근 금지 — 기존 대전제 ⑤ 그대로.
- 학생 요청은 어떤 파라미터를 보내든 서버가 본인 반으로 강제 덮어쓴다 (생활지도 0번 교훈: 학생 통과 여부를 가드 최우선 점검).

## 2. 데이터 모델 (Firestore, admin SDK 전용)

```
timetable_settings/{domain}
  ├ managerEmails: string[]          ← 일과계 실무사 이메일
  ├ activeTermId: string | null      ← 현재 활성 학기
  ├ days: number = 5                 ← 월~금
  └ periodsPerDay: number = 7~8      ← 학년 공통 최대 교시 (가져오기 때 자동 산출)

timetable_terms/{domain}/terms/{termId}       ← 예: "2026-2"
  ├ name: "2026학년도 2학기"
  ├ status: "draft" | "active" | "archived"   ← 가져오기는 draft에, 검증 후 활성화
  ├ subjects: [{ name(정식·NEIS 일치), shortName(한글2자), teacherEmails: string[] }]
  ├ importedAt, importedBy, activatedAt?
  └ sourceNote: "컴시간 엑셀로 인쇄 역파싱" 등

timetable_terms/{domain}/terms/{termId}/classGrids/{grade}-{classNum}
  ├ grade, classNum
  └ cells: [{
      day: 1~5, period: 1~8,
      lessons: [{                    ← 배열인 이유: 수준별 이동수업·선택교육과정 분반은
        subjectName, subjectShort,      한 학급 한 교시에 복수 수업이 실존 (고교 필수)
        teachers: [{ email, name }],  ← 배열인 이유: 복수교사(2교사 동시 수업)
        room?: string
      }]
    }]
```

### 왜 학급 단위 문서인가 (엔트리 1건 1문서가 아니라)

- 전교 규모 ≈ 학급 30 × 주 35교시 ≈ **1,000+ 엔트리**. 엔트리 문서로 쪼개면 "교시별 공강 교사"·전체시간표 뷰마다 1,000 reads. 학급 문서면 **어떤 뷰든 최대 ≈30 reads** (교사 뷰·공강 뷰는 서버가 30개 문서를 합성).
- 문서 크기: 학급당 35셀 × ~100B ≈ 4KB — 1MB 한도와 무관.
- 교사별·공강 뷰는 **저장하지 않고 계산** (기초+오버레이 합성 원칙, phase9_spec §3). 파생 문서를 만들지 않는다.
- 9b의 변경 오버레이(`timetable_changes`)는 별도 컬렉션에서 `{termId, weekId, grade, classNum, day, period}`로 셀을 참조하므로 이 구조와 충돌 없음.

## 3. API 설계 (`src/app/api/timetable/`) — 생활지도 action 패턴 계승

### `POST /api/timetable/view` (교직원 + 학생)

| action | 대상 | 반환 |
|---|---|---|
| `my` | 교사 | 내 주간시간표 (전 학급 그리드에서 본인 이메일 추출·합성) |
| `teacher` | 교사 | 지정 교사의 주간시간표 (`AutocompleteInput`으로 선택) |
| `class` | 교사·**학생** | 지정 학급 시간표. **학생이면 파라미터 무시하고 본인 반 강제** |
| `school` | 교사 | 전 학급 그리드 일괄 (전자칠판·인쇄 뷰의 원료) |
| `free` | 교사 | 요일·교시 지정 → 그 교시에 수업 없는 교사 목록 |

- 응답에 `term` 메타(이름·상태)를 동봉해 클라이언트 왕복을 줄인다 (초기 로딩 최적화 A의 교훈).
- 클라이언트는 `clientCache` 키 `"timetable:term"`(TTL 5분)에 학급 그리드 전체(≈120KB)를 캐시하고 my/teacher/class/free를 **로컬 합성**해도 좋다 — 기초시간표는 학기 중 거의 불변이므로 서버 API는 `school` 1회면 충분. 화면 구현 시 이 방식을 기본으로 한다 (프리페치 규칙과 정합).

### `POST /api/timetable/manage` (super_admin + managerEmails만)

| action | 기능 |
|---|---|
| `get_settings` / `set_managers` | 설정 조회 / 관리자 지정 (set은 super_admin 전용) |
| `import_validate` | 파싱된 그리드+시수표 수신 → 검증 리포트만 반환 (저장 안 함) |
| `import_commit` | 검증 통과분을 draft 학기로 저장 |
| `activate_term` | draft → active (기존 active는 archived로) |
| `delete_term` | draft 학기 삭제 (active는 불가) |

## 4. 가져오기 파서 (9a-1의 몸통)

### 흐름 (UserSheetEditor 웹 시트 복붙 패턴 재사용)

1. **입력 화면**: 관리자가 컴시간 "엑셀로 인쇄" 전체시간표를 엑셀에서 복사 → 웹 시트에 붙여넣기 (`clipboardData.getData("text")` → 탭 분리, UserSheetEditor:582 패턴). 교사별 시수표도 같은 방식의 두 번째 탭.
2. **교사명 매칭**: 파싱된 교사명을 `users:all` 캐시(GWS 교사 목록)와 대조해 이메일 자동 매칭. 동명이인·미매칭은 **수동 매핑 UI**(AutocompleteInput)로 확정. 매핑 결과는 import payload에 포함.
3. **검증 (`import_validate`)** — 리포트 화면에 표시:
   - ① 교사 중복: 같은 요일·교시에 한 교사가 두 학급 (동시수업으로 표시된 것 제외)
   - ② 학급 셀 누락·이중: 학급별 교시 수가 학교 설정(`schoolSettings.classCounts`)과 어긋남
   - ③ 시수 대조: 학급 그리드 합계 vs 교사별 시수표 합계 (교사×과목 단위 불일치 목록)
   - ④ 미매칭 교사명 잔존 여부 (있으면 commit 차단)
4. **저장 (`import_commit`)**: draft 학기 생성 → 리포트 재확인 → `activate_term`.

### ⚠️ 샘플 대기 항목 (이것만 미확정)

- 컴시간 "엑셀로 인쇄" 전체시간표의 **정확한 셀 배치**(학급이 행인지 열인지, 단축과목·교사명 표기 형식, 분반·복수교사 표기)와 교사별 시수표의 열 구성은 **실파일 2종 확보 후 확정**한다.
- 그때까지 Antigravity는 **중간 형식 기준으로 구현**한다: 파서 입력을 "2차원 문자열 배열(붙여넣기 결과)" → 출력을 §2의 classGrids 구조로 정의해 두면, 열 매핑 함수 하나만 샘플 후 교체하면 된다. 화면·검증·API·저장은 전부 지금 만들 수 있다.

## 5. 화면 배치 (IA — 임의 배치 금지 규칙에 따라 명시)

- 관리자 대시보드 사이드바에 **"시간표" 최상위 메뉴 신설** (생활지도와 동급). 하위 탭: ① 시간표 조회(교사용 기본) ② 학급별 ③ 공강 교사 ④ 가져오기·설정 (④는 super_admin/관리자에게만 노출).
- 학생 포털: 기존 학생 화면에 **"우리 반 시간표" 카드** 추가 (생활지도 학생 뷰와 같은 위치 레벨).
- 전자칠판/인쇄용 학급 시간표는 ② 안의 "인쇄 보기" 버튼 (9a-2 후반, 우선순위 낮음).

## 6. 구현 순서 (Antigravity 착수 가능 순)

1. `src/lib/timetable/types.ts` + `authz.ts`(§1 판정, 순수 함수) — 소규모
2. `manage` 라우트 (설정·import·term 생명주기) + `view` 라우트
3. 가져오기 화면 (웹 시트 2탭 + 교사 매핑 + 검증 리포트)
4. 열람 화면 3종 (교사 주간·학급·공강) + 학생 카드
5. 샘플 2종 입수 → 열 매핑 확정 → 실데이터 가져오기 리허설

- DoD: 각 단계마다 `npx tsc --noEmit` + `npm run build` 통과 후 핸드오버 (규칙 ①).
- Claude 표적 리뷰 지점 (규칙 ③): `authz.ts` 판정, 학생 반 강제 덮어쓰기, import_commit의 draft/active 전이.
