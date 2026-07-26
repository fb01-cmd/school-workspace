# 삭제된 클래스룸 고아 드라이브 폴더 탐지·정리 — 상세 스펙 (2026-07-26)

> 작성: Claude. 배경은 project_notes.md 2026-07-26 향후 고려 사항 메모 참조.
> 구현: Antigravity. §6 구현 순서대로 진행하고 완료 시 project_notes.md 기록.

## 1. 목표와 배경

교사가 클래스룸을 보관 없이 **삭제**하면 코스 객체가 API에서 열거 불가라 역방향 잔여 정리로 잡을 수 없다.
캘린더는 코스와 함께 소멸하지만 **드라이브의 코스 폴더는 "Classroom" 루트 아래 고아로 남는다.**
이 기능은 현존 코스가 참조하지 않는 Classroom 하위 폴더를 찾아 제안하고, 교사 확인 후 아카이브로 이동한다.

원칙: 역방향 잔여 정리와 동일 — **검사는 읽기 전용**(폴더 생성 금지), **자동 정리 금지**(제안-확인), 복원 로그 필수.

## 2. 탐지 알고리즘 (교사 본인 드라이브 기준)

1. `listClassroomCourses(teacherEmail, ["ACTIVE", "ARCHIVED"])` → 모든 현존 코스의 `teacherFolder.id` 집합 `REFERENCED` 구성.
2. **Classroom 루트 폴더 식별** (v1.1 개정 — b96c232 리뷰에서 구멍 확인): 샘플은 **ACTIVE 코스의 `teacherFolder`만** 사용해 `files.get(fields: "parents")`으로 부모를 얻는다. ARCHIVED 코스는 샘플 금지 — 학기말 정리를 거친 ARCHIVED 코스의 폴더는 이미 "이전년도 클래스룸/<년도>학년도"로 이동돼 있어, 그 부모를 루트로 삼으면 아카이브 폴더에서 고아를 찾는 silent 미탐이 된다.
   어떤 경로로 얻었든 **후보 루트를 `files.get(fields: "name")`으로 검증해 name이 "Classroom"이 아니면 기각**한다(교사가 ACTIVE 폴더를 수동 이동한 경우 방어).
   샘플이 없거나 기각되면 `files.list(q: name = 'Classroom' and 'root' in parents and mimeType = folder and trashed = false)`로 폴백. 둘 다 실패하면 "탐지 불가" 응답(에러 아님).
3. 루트 하위 폴더 목록 조회 — **`'루트ID' in parents and mimeType = folder and trashed = false and 'me' in owners`** (pageToken 루프 필수).
   `'me' in owners` 조건이 핵심: 공동 교사였던 코스의 폴더(소유자가 타인)는 이동 시 권한 문제가 생기므로 **본인 소유 폴더만** 후보로 삼는다.
4. `REFERENCED`에 없는 폴더 = 고아 후보. 각 후보에 `{folderId, name, webViewLink, modifiedTime}` 반환.

## 3. 정리 실행

- 이동 목적지: **"이전년도 클래스룸/삭제된 클래스룸"** 고정. 삭제된 코스의 학년도는 알 수 없으므로 연도 폴더에 거짓 분류하지 않는다.
  실행 시점에만 `findOrCreateArchiveFolder` 패턴으로 루트("이전년도 클래스룸")와 "삭제된 클래스룸" 하위 폴더를 find-or-create (검사 시점 생성 금지 — 잔여 정리 리뷰에서 확정된 원칙).
- 이동은 기존 `moveDriveFolderToArchive` 재사용 (originalParentFolderId 반환 활용).
- 로그: `classroom_cleanup_logs`에 `mode: "orphan"`으로 저장. **courseId가 없으므로** `courseId: null, folderId, originalName: 폴더명, driveFolderId: folderId, driveOriginalParentFolderId` 형태.

## 4. 복원 경로 수정 (주의 — 기존 코드 변경)

cleanup route의 `action: "restore"`는 현재 ① courseId 필수(400), ② `mode === "residual"`일 때만 코스 복원 생략이다. 다음처럼 확장:
- `mode === "orphan"` 로그: courseId 검사 생략(폴더 단독 복원), `restoreClassroomCourse`·캘린더 복원 모두 건너뛰고 **드라이브 이동만 원복**. audit 문구 "고아 폴더 원복".
- 기존 cleanup·residual 로그의 동작은 변경 금지 (회귀 주의 — 조건 분기 추가만).

## 5. API·UI

- **API**: 기존 `/api/workspace/classroom/cleanup/route.ts`에 통합.
  - `GET ?mode=orphan` → §2 탐지 결과 (teacher/super_admin 권한 — 기존 GET과 동일).
  - `POST action: "execute_orphan"` `{ folderIds: [{folderId, name}] }` (≤30개) → §3 실행, per-folder 결과 배열.
- **UI**: `ClassroomCleanupTab.tsx`의 "보관된 클래스룸 잔여 정리" 섹션 아래 "삭제된 클래스룸 고아 폴더" 서브섹션 추가.
  - `[고아 폴더 검사]` 버튼 온디맨드 실행 (자동 로드 금지).
  - 후보 행: 체크박스 · 폴더명(webViewLink 새 탭 링크) · 최종 수정일 · ⚠️ 안내 문구 1줄: "Classroom 폴더 안에 직접 만든 폴더가 있다면 선택 해제하세요."
  - 검사 결과 0개면 "고아 폴더가 없습니다" 표시. 실행 결과/복원은 기존 패턴 준수.

## 6. 구현 순서

1. cleanup route GET `?mode=orphan` + 탐지 로직 (읽기 전용 — files.create 호출이 GET 경로에 없음을 diff에서 자가 확인).
2. `execute_orphan` + "삭제된 클래스룸" find-or-create + 로그 저장.
3. restore 확장 (§4 — 기존 모드 회귀 없음 확인).
4. UI 서브섹션.
5. 검증: 테스트 계정에서 코스 1개 생성→삭제(고아 폴더 생성) + Classroom 루트에 수동 폴더 1개 생성 → 검사 시 고아만 후보로 뜨고 수동 폴더도 후보에 뜨는지(소유자 본인이므로 뜨는 게 정상 — 안내 문구로 방어), 이동 실행/복원 후 위치 원복, 기존 cleanup·residual 복원 회귀 없음을 화면으로 확인.

## 7. 엣지·주의

- 검사·실행 모두 교사 본인 impersonation (admin 아님 — 본인 드라이브 작업).
- `files.list` 결과에 `fields: "files(id, name, webViewLink, modifiedTime), nextPageToken"` 명시(기본 필드 절약).
- Classroom 루트 식별 실패(코스 0개 + 이름 검색 실패)는 에러가 아닌 안내 응답으로 — 신규 교사에게 흔한 상태.
- mock 모드: mockCourses/mockCourseStudents에 고아 폴더 시나리오 추가 (참조되지 않는 mock 폴더 1개).
