# 🔍 UX 함정 패턴 전수 스캔 및 검증 보고서 (2026-08-14)

- **작성자**: Antigravity (생산 몫)
- **근거 규칙**: `AGENTS.md` §1-1 (2단계 점검 절차 Tiered Audit)
- **점검 요약**:
  - **1단계 탐색/스캔 대상 (미검증)**: 6건
  - **2단계 상세 검증 완료 (확정)**: 3건
  - **총 검증 완료 건수**: 3건 / **미검증 잔여 건수**: 6건

> ⚠️ **AGENTS.md §1-1 준수 선언**: 본 보고서는 전건을 "점검 완료"로 보고하지 않으며, 1단계 탐색 항목은 추정형 표현("…로 보임", "…확인 필요")과 `미검증` 표기를 유지합니다. 실제 수정 지시로 연결할 3개 항목만 2단계로 올려 **실제 파일 경로 + 1~3줄 코드 스니펫 + 실재하는 변수/함수명**을 붙여 확정 검증했습니다.

---

## 📌 1. 점검 대상 UX 함정 패턴 정의

1. **Pattern A: "확인창이 저장인 척" (Confirm / Modal != DB Save)**
   - Confirm/Prompt/Modal 등에서 "확인" 또는 "적용"을 눌렀으나 실제 DB/API 저장은 메인 화면의 별도 "저장" 버튼을 눌러야 전달되어 저장이 완료된 줄 아는 착시.
2. **Pattern B: "캐시 착시" (Cache Illusion / UI Stale)**
   - CUD(생성/수정/삭제/전입/전출) 조작 후 `clientCache`(`users:all` 등)를 무효화(`invalidateClientCache`)하지 않아 화면에 캐시된 옛 값이 남아 조작 결과가 안 된 것처럼(또는 된 것처럼) 보이는 지점.
3. **Pattern C: 되돌릴 수 없는 조작의 경고 부재/약화**
   - 영구 삭제, 일괄 초기화 등 파괴적 조작임에도 `confirm()`이나 2차 검증 없이 1-Click으로 즉시 백엔드 실행되는 버튼.
4. **Pattern D: 부분 실패가 성공 처리에 묻힘 (Partial Fail Masked as Success)**
   - 일괄 처리 API 호출 결과 일부 항목이 실패했음에도 `toast.success`나 모달 닫기(`onSave`, `onDone`)가 성공 여부와 상관없이 무조건 실행되어 실패 내역이 유실되는 지점.
5. **Pattern E: 프로젝트 특화 UX 함정 (project_notes 지적 사항)**
   - E-1: null/undefined/빈값일 때 UI rendering용 폴백(fallback) 값이 Form 제출 시 DB로 전달되어 저장되는 지점.
   - E-2: 단일 소재지(`src/lib/org/departments.ts`) 미준수 및 하드코딩 배열 복붙 잔존 지점.

---

## 📋 2. 1단계 — 추정 항목 목록 (미검증 6건)

> ⚠️ 아래 목록은 1단계 탐색 산출물이며 **확정 진단이 아닙니다.** 파일 경로와 현상 요약만 기록하며 추정형으로 서술합니다.

1. **`[미검증]` `src/components/admin/StudentRoster.tsx` (Pattern B - 캐시 착시 추정)**
   - **현상 요약**: `loadStudents` 함수 실행 시 `getClientCache("users:all")`을 강제 갱신 옵션 없이 참조하고 있어, 타 탭에서 학적 변동 발생 후 명렬표 조회 시 이전 캐시가 표출될 수 있음 (확인 필요).
2. **`[미검증]` `src/components/admin/lifecycle/TransferInTab.tsx` (Pattern B - 캐시 착시 추정)**
   - **현상 요약**: 전입생 등록 처리 완료 후 `invalidateClientCache("users:all")` 호출이 누락되어 사용자 목록 탭으로 전환 시 전입생이 즉시 안 보일 수 있음 (확인 필요).
3. **`[미검증]` `src/components/admin/lifecycle/TeacherLifecycle.tsx` (Pattern B - 캐시 착시 추정)**
   - **현상 요약**: 교직원 전출/명예퇴임/복구 처리 성공 후 캐시 무효화(`invalidateClientCache`)가 실행되지 않아 전체 사용자 목록과 불일치할 수 있음 (확인 필요).
4. **`[미검증]` `src/components/admin/ChromeBookmarks.tsx` (Pattern A - 2단계 저장 구조 착시 추정)**
   - **현상 요약**: `BookmarkTreeEditor` 모달에서 "확인"을 누르면 local state만 변경되고, 메인 화면 하단의 "적용 및 즉시 배정" 버튼을 눌러야 최종 구글 정책이 업데이트되어 팝업 확인만으로 저장이 끝났다고 오해할 수 있음 (확인 필요).
5. **`[미검증]` `src/components/admin/OrgChartBuilder.tsx` (Pattern E-2 - 하드코딩 복붙 추정)**
   - **현상 요약**: `OrgChartBuilder.tsx:342` 등에 `["교장", "교감", "교목"]` 등의 부서/직위 판정용 하드코딩 배열이 부분적으로 잔존해 single source of truth에 어긋날 위험이 있음 (확인 필요).
6. **`[미검증]` `src/components/admin/timetable/DirectSubstituteTab.tsx` (Pattern A - 장바구니 일괄 반영 착시 추정)**
   - **현상 요약**: 결보강 수동 지정 시 후보 선택 후 장바구니(`cartItems`)에 담기는 로직과 실제 "일괄 실행" 버튼 누름의 단계가 분리되어 있어 장바구니 추가만으로 저장이 완료된 줄 아는 오해 가능성 있음 (확인 필요).

---

## 🎯 3. 2단계 — 검증 완료 항목 (확정 3건)

> ✅ 아래 3건은 실제 파일 조회(`view_file`) 및 스니펫 대조를 거쳐 **수정 지시의 입력이 될 수 있는 확정 항목**입니다.

### 2단계 항목 ①: `src/components/admin/lifecycle/EnrollTab.tsx` (Pattern B - 캐시 착시)
- **관련 파일**: [`src/components/admin/lifecycle/EnrollTab.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/EnrollTab.tsx#L40-L56)
- **실재 함수/변수명**: `enroll` 함수, `callAPI`, `invalidateClientCache` 미호출
- **실제 코드 스니펫**:
  ```typescript
  // src/components/admin/lifecycle/EnrollTab.tsx (lines 40-56)
  const enroll = async () => {
    if (!g1OU) { setErr("1학년 OU 경로를 먼저 설정해 주세요."); return; }
    if (!confirm(`${students.length}명의 신입생 계정을 생성합니다.`)) return;
    setRunning(true);
    setErr("");
    try {
      const response = await callAPI("enroll_students", { students, admissionYear: admYear, grade1OUPath: g1OU }, ud);
      setResult(response);
      if (response && (response.succeeded?.length || 0) > 0 && onDone) {
        onDone();
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };
  ```
- **검증 결과 및 결함 분석**:
  - `enroll` 함수는 신입생 계정을 일괄 생성(`enroll_students`)한 후 `onDone()`을 실행하지만, **`invalidateClientCache("users:all")` 또는 `invalidateClientCache()`를 전혀 호출하지 않는다.**
  - 이로 인해 관리자가 신입생 입학 처리를 완료한 후 곧바로 "사용자 목록(`UserList`)"이나 "명렬표(`StudentRoster`)" 탭으로 이동하면, 이전 캐시(`users:all`, TTL 5분)가 유지되어 **방금 입학 등록한 신입생들이 목록에 나타나지 않는 심각한 캐시 착시 현상**이 발생한다.

---

### 2단계 항목 ②: `src/components/admin/UserSheetEditor.tsx` (Pattern D - 부분 실패가 성공 닫기에 묻힘)
- **관련 파일**: [`src/components/admin/UserSheetEditor.tsx`](file:///home/fb01/school/src/components/admin/UserSheetEditor.tsx#L1280-L1289)
- **실재 함수/변수명**: `handleSave` 함수, `data.createFailures`, `data.updateFailures`, `onSave`
- **실제 코드 스니펫**:
  ```typescript
  // src/components/admin/UserSheetEditor.tsx (lines 1280-1289)
  if (res.ok) {
    if (data.createFailures?.length > 0 || data.updateFailures?.length > 0) {
      const createErrMsgs = (data.createFailures || []).map((f: any) => `[생성실패] ${f.email}: ${f.reason}`).join("\n");
      const updateErrMsgs = (data.updateFailures || []).map((f: any) => `[수정실패] ${f.email}: ${f.reason}`).join("\n");
      alert(`일부 저장 처리 실패:\n${createErrMsgs}\n${updateErrMsgs}`);
    } else {
      alert("모든 변경사항이 구글 워크스페이스에 실시간으로 성공 반영되었습니다!");
    }
    onSave();
  }
  ```
- **검증 결과 및 결함 분석**:
  - `handleSave` 함수에서 계정 일괄 반영 API 호출 성공(`res.ok`) 시, `data.createFailures` 또는 `data.updateFailures`가 존재하여 **일부 항목이 실패했더라도 `alert(...)`만 표시한 뒤 무조건 `onSave()`를 실행하여 모달/시트 편집기를 닫는다.**
  - 모달이 닫히면서 실패한 행의 데이터나 작업 내용이 에디터에서 모두 날아가고, 사용자는 단순 알림 확인 후 전체가 반영된 것으로 착각하거나 실패 행을 재시도할 기회를 잃게 된다.

---

### 2단계 항목 ③: `src/components/admin/lifecycle/PromoteTab.tsx` (Pattern D - 부분 실패 시 성공 콜백 즉시 실행)
- **관련 파일**: [`src/components/admin/lifecycle/PromoteTab.tsx`](file:///home/fb01/school/src/components/admin/lifecycle/PromoteTab.tsx#L100-L121)
- **실재 함수/변수명**: `promote` 함수, `response`, `onDone`
- **실제 코드 스니펫**:
  ```typescript
  // src/components/admin/lifecycle/PromoteTab.tsx (lines 117-121)
  setResult(response);
  if (response && onDone) {
    onDone();
  }
  ```
- **검증 결과 및 결함 분석**:
  - `promote` 함수에서 학생 진급 일괄 처리 API(`promote_students`)를 호출한 후, `response` 객체 내에 실패 목록(`response.failed`)이 존재하더라도 `response` 객체가 `null`이 아니기만 하면 `onDone()`이 즉시 호출된다.
  - 이로 인해 진급 실패 학생이 일부 발생했음에도 진급 단계 완료 처리 UI로 넘어가 버리는 결함이 존재한다.

---

## 📊 4. 종합 요약 및 향후 조치 제안

| 항목 구분 | 수치 | 비고 |
|---|---|---|
| **1단계 탐색/스캔 (미검증)** | **6건** | 추정형 서술 유지, 미검증 표기 |
| **2단계 상세 검증 (확정)** | **3건** | 실재 파일·스니펫·변수명 확인 완료 |
| **전체 점검 건수** | **9건** | **검증 완료 3건 / 미검증 6건** |

- **권고 수정 조치 (생산 몫 처리 후보)**:
  1. `EnrollTab.tsx`, `TransferInTab.tsx`, `TeacherLifecycle.tsx` 등 생애주기 액션 성공 시 `invalidateClientCache("users:all")` 호출 추가.
  2. `UserSheetEditor.tsx`에서 `createFailures` 또는 `updateFailures` 존재 시 `onSave()`를 바로 부르지 않고 모달을 유지하여 사용자가 실패 행을 확인/재시도할 수 있도록 개선.
  3. `PromoteTab.tsx`에서 `response.failed?.length > 0`인 경우 `onDone()` 실행을 보류하고 에러 내역을 우선 표출하도록 수정.

---

## ✅ 5. Claude 교차 검증 (2026-08-14, Opus 5) — 확정 3건 **전건 일치**

작성자가 자기 주장을 검증할 수 없으므로(`AGENTS.md` §2-⑨) 2단계 확정 3건을 실물로 대조했다. **스니펫 3건 모두 원문과 정확히 일치**했고, 결함 판정도 3건 다 성립한다. 2026-08-13 UX 점검이 17건 전수 오보였던 것과 대비된다.

### 판정을 강화하는 추가 사실 — 캐시 무효화는 **이미 확립된 관행**이다

①③이 "관행이 없어서 안 한 것"인지 "관행을 빠뜨린 것"인지가 판정의 갈림길이라 `invalidateClientCache` 호출부를 전수로 셌다. **12곳에서 호출된다**:

`GroupList.tsx:204,237,277,323` · `ProfileApprovals.tsx:146` · `ManualProfileEditor.tsx:226` · `MyProfileModal.tsx:37,152` · `DisciplineSection.tsx:68` · `DisciplinePermissionsTab.tsx:96,124` · `TimetableImportTab.tsx:727,761,783` · `AuthContext.tsx:245`

그런데 **생애주기 탭(`EnrollTab`·`PromoteTab`·`TransferInTab`·`TeacherLifecycle`)에는 한 건도 없다.** 관행 부재가 아니라 **한 디렉터리가 통째로 누락**된 형태다 → ①③은 확정, 1단계의 2·3번(`TransferInTab`·`TeacherLifecycle`)도 같은 근거로 실재 가능성이 높다(그래도 미검증 표기는 유지 — 원문 대조 전).

### 부모 콜백까지 확인 — 상위에서 보완해 주지 않는다

①③의 반증 가능성은 "`onDone`이 부모에서 캐시를 비워 줄 수도 있다"였다. 실제 구현은 그렇지 않다:
- `StudentLifecycle.tsx:340,343` — `onDone={() => markDone("promote")}` / `markDone("enroll")`. **위저드 단계 완료 표시만 하고 캐시는 건드리지 않는다.**

②의 반증 가능성은 "`onSave`가 편집기를 유지할 수도 있다"였다. 실제 구현은 반대다:
- `UserList.tsx:840-843` — `onSave={() => { setIsSheetMode(false); … loadUsers(…) }}` → **시트 모드를 끄므로 실패 행이 든 편집기가 사라진다.** 보고 내용대로다.

### Claude 의견 — 심각도 순서는 보고서의 권고 순서와 다르다

| 순위 | 항목 | 근거 |
|---|---|---|
| **1** | ② `UserSheetEditor` 부분 실패 후 편집기 소멸 | **사용자 작업물이 소멸**한다. 나머지 둘은 새로고침하면 진실이 보이지만 이건 실패 행을 다시 입력해야 한다 |
| **2** | ③ `PromoteTab` 부분 실패인데 단계 완료 표시 | 진급 위저드가 **틀린 상태로 다음 단계를 연다**. 학년 초 한 번뿐인 작업이라 되돌리기 어렵다 |
| **3** | ① `EnrollTab` 캐시 착시 | 최대 5분 뒤 저절로 해소된다(TTL). 놀라지만 데이터는 무사하다 |

②를 먼저 고치기를 권한다. ①은 생애주기 탭 4개를 한 번에 손보는 편이 낫다(같은 누락이므로).

---

## ✅ 6. 1단계 미검증 6건 전건 확인 완료 (2026-08-14, Claude Opus 5) — **확정 결함 0건**

§2의 「추정 6건」을 전부 원문 대조했다. 절차상 미검증으로 남겨 둔 것이 옳았고(6건 중 2건이 실제 결함이었다), **나머지 4건은 결함이 아니었다.** 이로써 §2의 미검증 목록이 남지 않는다.

| # | 항목 | 판정 |
|---|---|---|
| 1 | `StudentRoster` 캐시 착시 | 🟢 **해소됨** (원인이 다른 곳이었다) |
| 2 | `TransferInTab` | 🔴→✅ 실제 결함, `47783ba`에서 수정 |
| 3 | `TeacherLifecycle` | 🔴→✅ 실제 결함, `47783ba`에서 수정 |
| 4 | `ChromeBookmarks` 2단계 저장 착시 | 🟢 **오탐** |
| 5 | `OrgChartBuilder` 하드코딩 | 🟡 **경미** (성격이 추정과 다르다) |
| 6 | `DirectSubstituteTab` 장바구니 착시 | 🟢 **함정 아님** / 🟡 별건 1건 |

### 1. `StudentRoster` — 🟢 해소됨. 문제는 읽는 쪽이 아니라 쓰는 쪽이었다

`loadStudents`(`:53~69`)가 `getClientCache("users:all")`를 강제 갱신 없이 쓰는 것은 사실이다. 캐시가 있으면 API를 아예 부르지 않는다.

**그러나 그것 자체는 결함이 아니다.** 캐시를 쓰는 화면이 옛 값을 보는 이유는 **바꾸는 쪽이 캐시를 안 비웠기 때문**이고, 그건 §3-①·§5에서 확정해 `47783ba`로 고쳤다. 현재 무효화가 걸린 곳: `UserSheetEditor:1340` + 생애주기 4탭.

→ **학적을 바꾸는 모든 화면이 캐시를 비우므로 명렬표가 옛 목록을 볼 경로가 닫혔다.** 남는 경우는 서버 크론이나 GWS 콘솔에서 직접 바꾼 때인데, 그건 5분 TTL로 자연 해소된다(정상 동작).

### 4. `ChromeBookmarks` — 🟢 오탐. 모달이 아니라 인라인이다

추정은 *"모달에서 확인을 누르면 저장된 줄 안다"* 였는데 구조가 다르다.

- `BookmarkTreeEditor`는 **인라인**으로 렌더된다 (`ChromeBookmarks.tsx:326`, `<div className="max-h-[520px] overflow-y-auto">` 안).
- `BookmarkTreeEditor.tsx:115`의 `fixed inset-0` 모달은 **항목 하나를 추가·수정하는 하위 팝업**이다 (제목이 `"북마크 수정"`/`"폴더 추가"`).
- 편집기 **바로 아래 같은 화면에** 배포 버튼이 있고 문구가 명확하다 — `🚀 [{OU}] 조직단위 크롬 브라우저 정책 배포 적용` (`:337-340`), 옆에 안내문까지 붙어 있다(`:349-350`).

"확인창이 저장인 척"은 **저장 버튼이 시야 밖이거나 문구가 모호할 때** 성립한다. 둘 다 아니다.

### 5. `OrgChartBuilder` — 🟡 경미. 복붙 잔존이 아니라 **이름 없는 개념**이다

`OrgChartBuilder.tsx:342`:
```ts
if (["교장", "교감", "교목"].includes(deptName)) { positionVal = deptName; }
```

추정은 *"부서 목록 복붙 잔존"* 이었는데 **아니다.** `departments.ts`의 `DEFAULT_DEPARTMENTS`(28개)를 베낀 게 아니라, **"부서명이 곧 직책인 셋"** 을 판별하는 별개의 개념이다(`DEFAULT_POSITIONS`의 앞 3개와 일치).

문제는 **그 개념이 단일 소재지에 이름을 갖고 있지 않다는 것**이다. 부서명을 개명하면(2026-08-13 "휴직 및 퇴직 교사" → "휴직 교사" 같은 일이 실제로 있었다) 이 줄이 조용히 안 맞게 된다.

**처방(급하지 않음)**: `departments.ts`에 `POSITION_LIKE_DEPARTMENTS = ["교장","교감","교목"]`를 신설하고 이 줄이 그걸 쓰게 한다. 지금 동작에는 문제가 없다.

### 6. `DirectSubstituteTab` — 🟢 함정 아님. 다만 별건 🟡 하나

담기가 **화면에 시각적으로 반영된다** — `:202` 주석 *"그리드는 담긴 상태의 예상 시간표"*, `:923` 셀 툴팁 `"담기 가상 반영 — 일괄 반영 전"`. 반영 버튼도 명확하고 확인창이 붙는다(`:736` `담긴 N건의 직권 배정/수업교환을 승인 및 일괄 반영하시…`). 교사를 바꿀 때도 경고가 뜬다(`:256`).

→ **"담기만 하고 저장된 줄 아는" 조건이 성립하지 않는다.**

**🟡 별건**: 화면을 벗어나거나 새로고침하면 담긴 목록이 **말없이 사라진다**(`beforeunload` 경고 없음). 결보강 담기는 징검다리 체인까지 여러 건을 쌓는 작업이라 공들인 게 날아간다. 데이터 손상은 아니고 재입력 비용이다.

### 정리

**§2의 6건 = 실제 결함 2 / 오탐·해소 3 / 경미 2** (6번은 오탐이면서 별건 경미 1건을 남김).
**중간점검 ④에서 열려 있던 항목이 이로써 전부 닫힌다.** 남은 것은 위 🟡 2건뿐이고 둘 다 급하지 않다.
