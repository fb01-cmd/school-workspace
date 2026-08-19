# Phase 8 피드백 배치 3 — 화면 몫 인계 (Antigravity)

> 원본 = `development_roadmap.md` Phase 8 피드백 목록 32·33·35·36번.
> 코어 몫(36 양식 세션 액션 2종 + 32-ⓑ 양식 폴더 지연 생성)은 Claude 구현 완료 — 이 문서는 화면 몫만.
> 완료 후: AGENTS.md ④-3 인계 게이트 3종(핸드오버는 project_notes **하단**), push 금지 — Claude 검수 후 일괄 배포.
> 훅 규칙(useState/useEffect는 어떤 조기 return보다 위에)과 색인 규칙(색인 의존 쿼리 신설 금지) 준수.

## 36. 업무 양식 첨부 30MB — 세션 경로 분기

코어 완료 명세: `POST /api/tasks`
- `{ action: "form_session_start", taskId, fileName, size, mimeType }` → `{ sessionUrl }` (발신자 전용·5개 한도·확장자/30MB 검증·양식 폴더 없으면 서버가 지연 생성)
- 브라우저가 sessionUrl로 PUT (제출물 세션 업로드와 동일 패턴 — PUT 응답 JSON의 `id`가 driveFileId)
- `{ action: "form_session_finish", taskId, driveFileId }` → `{ formFile }` (서버 재검증 후 formFiles에 추가)

화면(TaskComposerModal):
- 양식 파일 선택 시 4MB 이하 → 기존 multipart `form_upload` 그대로 / **4MB 초과~30MB → 위 세션 3단 흐름**.
- 안내 문구 "(파일당 4MB 이하)" → **"(파일당 30MB 이하)"**. 30MB 초과 거부 시 사유 표시(29번 원칙 — 버튼·카드·사유 동시).
- finish 응답의 `formFile`을 양식 목록에 즉시 반영.

## 32. [내 할 일 추가]에 서식 + 참고 파일

- **ⓐ 서식**: 미니 입력의 내용 칸을 쪽지·업무 작성기와 같은 MemoEditorToolbar+contenteditable로 교체(PC·모바일). `bodyHasMd1Formatting(body)`가 true일 때만 `contentFormat: "md1"`을 self_add payload에 포함 — 서식 없으면 평문(기존 검수 원칙).
- **ⓑ 참고 파일**: 미니 입력에 "참고 파일 추가 (선택, 최대 5개)" — 파일은 로컬 대기해 두었다가 **self_add 성공 응답의 taskId로** `form_upload`(≤4MB) / 양식 세션 3단(>4MB)을 순차 호출. 서버가 폴더를 지연 생성하므로 클라 분기 불요. 업로드 실패분은 사유와 함께 표시(업무는 이미 생성된 상태임을 안내 — "할 일은 등록됐고 파일 N개만 실패").
- 내 할 일 카드 상세에서 formFiles가 있으면 내려받기 목록 표시(기존 양식 표시 재사용).

## 33. 전체·완료 탭 페이지네이션 + 월 구분선

- TasksSection·MobileTasksSection의 **전체·완료(·철회) 탭**: 처음 20~30개만 렌더 + [더 보기] 버튼으로 이어 붙이기 (클라 페이지네이션 — 구독 데이터는 이미 메모리에 있으므로 추가 읽기 0).
- 목록이 한 달을 넘으면 **월 구분선**("2026년 8월" 등, dueAt 기준) 삽입.
- 기본 "진행할 일" 탭은 대상 아님(처리하면 빠지는 구조).

## 35. 직권 배정 — 담기와 선택 교사의 수명 통일

DirectSubstituteTab: 담기 목록은 보존되는데 선택 교사가 초기화돼, 재진입 후 **같은 교사를 다시 선택해도** "전환하면 비워집니다" 확인창이 뜸(실기기).
- **선택 교사를 담기 목록과 같은 저장소·같은 수명으로 보존** — 재진입 시 교사 자동 복원 + 담기 유지.
- 같은 교사 재선택은 "전환"으로 취급하지 않는다(확인창 없음). 확인창은 실제로 다른 교사를 고를 때만.
- 담기 이탈 경고 등 기존 담기 기능 4종은 건드리지 않는다(①-1 회귀 전례 파일 — check_ui_removals 소명 필수).

## 완료 정의

tsc·build 통과 / check_ui_removals 소명 / 명시 add 커밋 / project_notes 하단 핸드오버 / push 금지.
