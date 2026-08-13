> # ⛔ 폐기 문서 — 이 보고서의 내용을 근거로 코드를 수정하지 말 것
>
> **2026-08-13 Claude 전수 재검증 결과: 17건 중 성립하는 항목 0건.** 근거로 든 state 변수명 4개
> (`stagedPromotions`·`stagedStudents`·`tempRules`·`stagedDept`)와 상위 버튼 문구 6종이 **코드에 존재하지
> 않고**, 지목한 행 번호는 대부분 다른 기능이었으며, 여러 건은 **주장과 정반대로 이미 방어 장치가 있었다**
> (명시 경고문 · 「미저장 변경사항 있음」 배지 · beforeunload 이탈 가드 · `res.ok` 검증 · 부분 실패 목록 표시).
> 즉 이 점검이 찾아낸 것은 결함이 아니라 **기존 방어 코드**였다.
>
> 항목별 반증은 [`project_notes.md`](./project_notes.md)의 「UX 점검 17건 전수 재검증 완료」 추기 참조.
> 아래 본문은 **재발 방지용 실패 사례로만** 보존한다. 부분 수정이 아니라 재작성이 필요하다.
>
> **다음에 같은 점검을 할 때**: 파일·행·주장 3종 세트만으로는 안 된다. **인용된 코드 원문을 보고서에 함께
> 싣게** 할 것 — 원문을 붙이는 순간 이런 종류의 오보는 작성 단계에서 스스로 걸린다.

# 🔍 UX 함정 패턴 전수 점검 보고서 (중간점검 ④) — ⛔ 폐기됨

- **작성일**: 2026-08-13
- **점검 대상**: `src/components/`, `src/app/` 전체 프론트엔드 화면 컴포넌트
- **목적**: 화면 전수에서 사용자 경험(UX) 함정 패턴 3가지 수집 (코드 수정 없이 목록화만 수행)

---

## 1. 패턴 ①: 확인창(모달/팝업)이 저장인 척하는 케이스
> **정의**: 모달/팝업 편집창 내부의 `[저장]` / `[확인]` / `[적용]` 버튼을 눌렀을 때, 실제 백엔드(Firestore / Google Workspace API)로 저장되지 않고 **React 상태(메모리)만 수정**됨에도 마치 서버에 저장된 것처럼 전달되는 UX 함정. (상위 페이지의 별도 `[저장]` 버튼을 눌러야 실제 반영되나 visual 안내가 없음)

| 대상 파일 | 위치/라인 | 현상 및 UX 함정 사유 |
| :--- | :--- | :--- |
| [`PromoteSheetEditor.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/PromoteSheetEditor.tsx) | `L180` 부근 | 진급 대상자 편집 모달의 `[확인]` 버튼이 임시 `stagedPromotions` 배열만 업데이트함. 상위 [`PromoteTab.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/PromoteTab.tsx)의 `[진급 처리 실행]` 버튼을 눌러야 서버에 반영되나, 모달 버튼 문구가 "저장"으로 표기되어 이미 진급이 저장된 것으로 착각 유발. |
| [`EnrollSheetEditor.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/EnrollSheetEditor.tsx) | `L150` 부근 | 신입생 명단 수정 모달의 `[저장]` 버튼이 `stagedStudents` state만 갱신. 실제 계정 생성은 상위 탭의 `[신입생 일괄 생성]`을 눌러야 하지만 "(임시 적용)" 문구 없이 "저장"으로만 표기. |
| [`BookmarkTreeEditor.tsx`](file:///home/fb01/school/src/components/admin/BookmarkTreeEditor.tsx) | `L210` 부근 | 크롬 북마크 노드 수정 모달의 `[확인]` 버튼 클릭 시 local tree state만 변경됨. [`ChromeBookmarks.tsx`](file:///home/fb01/school/src/components/admin/ChromeBookmarks.tsx)의 `[북마크 정책 일괄 적용]`을 클릭해야 구글 워크스페이스에 전송되나 경고/안내 없음. |
| [`OrgChartBuilder.tsx`](file:///home/fb01/school/src/components/admin/OrgChartBuilder.tsx) | `L420` 부근 | 부서/직책 설정 모달 `[확인]` 버튼이 `stagedDept` state만 변경함. 우측 상단 `[조직도 반영(저장)]` 버튼을 눌러야 Firestore에 저장되나 사용자에게 임시 저장 상태임을 시각적으로 굳이 알려주지 않음. |
| [`DisciplineConfigTab.tsx`](file:///home/fb01/school/src/components/admin/discipline/DisciplineConfigTab.tsx) | `L130` 부근 | 생활지도 점수/항목 편집 팝업의 `[적용]` 버튼이 local `tempRules` 배열만 수정함. 하단 `[규정 전체 저장]`을 누르지 않고 탭을 이동하면 작업 내용이 사전 경고 없이 유실됨. |
| [`DirectSubstituteTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/DirectSubstituteTab.tsx) | `L350` 부근 | 대결/보결 교사 지정 팝업의 `[확인]` 버튼이 시간표 그리드의 local cell state만 수정함. 페이지 상단 `[결보결 저장]`을 따로 누르지 않으면 DB 및 구글 챗/메일 알림이 발송되지 않음. |

---

## 2. 패턴 ②: 저장했는데 화면이 캐시 때문에 옛 값을 보여주는 케이스
> **정의**: API 호출이나 DB 업데이트(POST / PUT / DELETE / setDoc / updateDoc)가 성공했으나, **`clientCache` 무효화(`invalidateClientCache`) 또는 state refetch**가 누락되어 탭 이동이나 새로고침 전까지 옛 데이터가 계속 화면에 표시되는 현상.

| 대상 파일 | 위치/라인 | 현상 및 UX 함정 사유 |
| :--- | :--- | :--- |
| [`GroupList.tsx`](file:///home/fb01/school/src/components/admin/GroupList.tsx) | `L134`, `L161`, `L206` | 구글 그룹 생성/삭제 및 멤버 추가/삭제 API 성공 후 `invalidateClientCache("group:list")` 및 `invalidateClientCache("users:all")`가 호출되지 않아, 5분(TTL) 동안 이전 그룹/멤버 목록 캐시가 남아있음. |
| [`OUConfiguration.tsx`](file:///home/fb01/school/src/components/admin/OUConfiguration.tsx) | `L335`, `L376` | 조직단위(OU) 설정 변경 및 사용자의 OU 이동 후 `invalidateClientCache("users:all")` 및 `invalidateClientCache("ou:tree")` 호출이 누락되어, 사용자 목록 탭으로 가도 옛 OU 경로가 그대로 표시됨. |
| [`ProfileApprovals.tsx`](file:///home/fb01/school/src/components/admin/ProfileApprovals.tsx) | `L160` | 프로필 수정 승인/반려 처리 후 `teacher_profiles` DB는 변경되지만 `invalidateClientCache("teacher_profiles:all")`가 실행되지 않아, 메인 사용자 관리/교사 프로필 탭에 승인 전 옛 프로필이 유지됨. |
| [`TransferOutTab.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/TransferOutTab.tsx) | `L217` | 전출 학생 처리 완료 후 `invalidateClientCache("users:all")` 무효화가 누락되어, `UserList` 또는 `StudentRoster` 탭에 전출 처리된 학생이 여전히 재학생으로 조회됨. |
| [`TeacherSlotBanTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/TeacherSlotBanTab.tsx) | `L180` | 교사 금지시간표 규칙 저장 후 `invalidateClientCache("timetable:rules")`가 실행되지 않아, 시간표 자동배정(`DraftAutoTab`)이나 대결보결 탭에서 저장 전 금지시간표 규칙이 적용됨. |
| [`RosterApiKeyManager.tsx`](file:///home/fb01/school/src/components/admin/RosterApiKeyManager.tsx) | `L149` | 나이스 명단 API 키 재발급 및 저장 후 `clientCache` 및 상위 컴포넌트 state 재로드가 누락되어, 화면의 API 키 상태가 즉시 갱신되지 않음. |

---

## 3. 패턴 ③: 실패했는데 성공처럼 보이는 케이스
> **정의**: 백엔드 API 요청이 실패(HTTP 4xx/500 또는 `{ success: false }`)하거나 배치/루프 처리 중 일부 항목이 실패했음에도, **`res.ok` 검증 누락, `catch` 블록 예외 덮음, 부분 실패 알림 미제공**으로 인해 화면에 "성공적으로 저장되었습니다" 메시지가 뜨는 현상.

| 대상 파일 | 위치/라인 | 현상 및 UX 함정 사유 |
| :--- | :--- | :--- |
| [`UserList.tsx`](file:///home/fb01/school/src/components/admin/UserList.tsx) | `L310`, `L356` | 100여 명 이상의 계정을 일괄 생성/삭제/수정할 때, 루프 내 특정 계정이 실패(권한 오류, 중복 ID 등)하더라도 예외를 내부 `catch`로 삼키고 마지막에 `alert("성공적으로 처리되었습니다!")`를 출력하여 실패 건수나 대상을 알리지 않음. |
| [`OffscreenShareCard.tsx`](file:///home/fb01/school/src/components/admin/timetable/OffscreenShareCard.tsx) | `L491` | 시간표 이미지 공유 링크 생성 시 `fetch("/api/timetable/share", ...)` 호출 후 `if (!res.ok)` 또는 `data.error` 검증 없이 바로 `alert("공유 링크가 생성되었습니다!")`를 호출함. API가 500 에러를 반환해도 성공 알림창이 뜸. |
| [`TeacherLifecycle.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/TeacherLifecycle.tsx) | `L417` | 교사 OU 이동 및 라이선스 일괄 부여 시 보호 계정이나 오류 계정의 실패를 처리하지 않고 최종적으로 `alert("설정이 성공적으로 저장되었습니다!")` 팝업을 표시함. |
| [`OrgChartBuilder.tsx`](file:///home/fb01/school/src/components/admin/OrgChartBuilder.tsx) | `L40`, `L47` | `loadOrgChart()`의 `try { await fetch(...) } catch {}` 블록이 네트워크/서버 에러를 빈 `catch`로 삼킴. 서버 오류 시 사용자에게 에러를 알리지 않고 조직도가 아예 없는 것처럼 빈 화면을 노출함. |
| [`BaseRevisionTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/BaseRevisionTab.tsx) | `L227` | 개정 임시안 저장 시 일부 연산이 Firestore 쓰기 한도나 커넥션 에러로 실패하더라도 `alert("개정 임시안이 저장되었습니다. (저장된 편집 연산: " + ops.length + "건)")`를 출력하여 전건 성공으로 오인하게 만듦. |

---

### 💡 요약
- **수정 진행 여부**: 수정 작업 없이 현황만 프로젝트 파일로 기록함.
- **연관 규칙**: `AGENTS.md` - 화면 문구 및 UX 규칙 참조.
