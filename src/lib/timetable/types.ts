/**
 * Phase 9a: 시간표 도입 데이터 구조 및 DTO 정의
 * 
 * 상위 스펙: phase9a_spec.md
 */

// ── Firestore 저장 데이터 구조 ────────────────────────────────

export interface TimetableSettings {
  managerEmails: string[];
  activeTermId: string | null;
  days: number; // 기본 5 (월~금)
  periodsPerDay: number; // 일별 최대 교시 수 (가져오기 시 자동 계산)
  lunchAfterPeriod: number; // "N교시 후 점심" — 점심 전후 연속 감점 판정 기준 (phase9b_spec §2)
  observerEmails: string[]; // 열람 전용 참관자(교무부장 등) — 요청대장 읽기만 (phase9b_spec §5)
  teacherOpen?: boolean; // 오픈 게이트: true면 전 교사에게 '내 시간표' 노출 (기본 false)
  teacherPilotEmails?: string[]; // 오픈 게이트 전 파일럿 허용 명단 — 테스트·실무사 계정만 교사 화면 접근 (2026-08-04)
  publishWeeksAhead?: number; // 학사일정 주차 자동 파생 범위 — 오늘 주부터 몇 주 앞까지 (기본 2, pre_opening_3features_spec §B)
  lastNeisSyncAt?: number; // 나이스 학사일정 마지막 수집 시각 (ms epoch)
  icsToken?: string; // 구독형 학사일정 캘린더 피드 무인 인증 토큰 (calendar_ics_feed_spec)
  icsStaffToken?: string; // 교직원용 학사일정 캘린더 피드 무인 인증 토큰 (calendar_ics_feed_spec §4-2)
}

// ── 학사일정 (pre_opening_3features_spec §B) ────────────────────

export type CalendarEventType = "행사" | "휴업일" | "재량휴업" | "단축수업" | "고사";
export const SCHEDULE_AFFECTING_TYPES = ["휴업일", "재량휴업", "단축수업", "고사"] as const;

export interface TimetableCalendarEvent {
  id?: string;
  termId: string;
  type: CalendarEventType;
  startDate: string; // "YYYY-MM-DD" (단일일은 start=end)
  endDate: string;
  title?: string; // 일정 이름. 행사는 필수, 일과 영향 타입은 선택(없으면 type명)
  grades?: number[]; // 해당 학년(1~3). 없으면 전 학년
  periodsByGrade?: Record<string, number>; // 단축수업·고사 — 요일별 시수
  note?: string;
  staffOnly?: boolean; // 교직원 전용 일정 여부 (calendar_ics_feed_spec §4-2)
  source?: "neis" | "manual"; // 없으면 manual로 간주(레거시). neis 항목은 재수집이 관리
  neisKey?: string; // source=neis 전용 dedupe 키: `${AA_YMD}|${EVENT_NM}`
  createdBy?: string;
  createdAt?: number;
}

// ── 기초시간표 개정 (pre_opening_3features_spec §E) ─────────────

export type BaseRevisionOp =
  | {
      type: "swap"; // 같은 학급 두 슬롯 맞바꿈 (빈 슬롯 허용 = 이동)
      grade: number;
      classNum: number;
      a: { day: number; period: number };
      b: { day: number; period: number };
    }
  | {
      type: "edit_cell"; // 셀 통째 교체 (교사·과목 변경 등 만능 탈출구)
      grade: number;
      classNum: number;
      day: number;
      period: number;
      lessons: TimetableLesson[];
    }
  | {
      /** 학급 간 교환 (timetable_fix_assist_spec §7 v2) — 여러 학급이 **같은 두 슬롯**을
       *  동시에 맞바꾼다. 한 학급만 바꾸면 상대 학급에서 교사 겹침(H2)이 나는 경우,
       *  그 상대 학급이 같은 슬롯 쌍을 함께 바꾸면 겹침이 정확히 상쇄된다.
       *  하나의 연산이므로 적용·미리보기·undo가 원자적이다 (반쪽 적용 상태가 생기지 않는다). */
      type: "swap_pair";
      a: { day: number; period: number };
      b: { day: number; period: number };
      classes: Array<{ grade: number; classNum: number }>;
    };

export interface TimetableBaseRevision {
  id?: string;
  termId: string;
  status: "draft" | "applied";
  effectiveFrom?: string; // 적용 시작 주 월요일 (applied일 때 필수)
  ops: BaseRevisionOp[];
  note?: string;
  createdBy?: string;
  createdAt?: number;
  appliedBy?: string;
  appliedAt?: number;
}

export type TermStatus = "draft" | "active" | "archived";

export interface TimetableSubject {
  name: string; // 정식 과목명 (NEIS 일치)
  shortName: string; // 약칭 (한글 2자)
  teacherEmails: string[];
  /** 사람이 관문(배정표 불러오기)에서 확정한 다른 표기 — 시스템이 추측해 넣지 않는다 (subject_dictionary_spec §1-1) */
  aliases?: string[];
}

/** 과목 사전 이름 항목 — 판정 배선용 최소형 (teacherEmails 불요, subject_dictionary_spec §2) */
export interface SubjectNameEntry {
  name: string;
  shortName: string;
  aliases?: string[];
}

export interface TimetableTeacher {
  email: string;
  name: string;
}

export interface TimetableLesson {
  subjectName: string;
  subjectShort: string;
  teachers: TimetableTeacher[];
  room?: string;
  /** 동시수업(분반 이동수업) 그룹 라벨 — 저장 필드가 아니라 로드 시 등록부 대조로 스탬프 (pre_opening_3features_spec §A) */
  simul?: string;
}

/** 동시수업 교시 제한 (pre_opening_3features_spec §A-2) */
export interface SimulSlot {
  day: number; // 1=월..5=금
  period: number;
}

/** 동시수업(분반 이동수업) 그룹 — timetable_simul_groups/{domain}/groups (pre_opening_3features_spec §A-2).
 *  id·생성 정보는 서버 로더가 채우므로 클라이언트 폼 상태에서는 없을 수 있다 (선택 필드). */
export interface SimulGroup {
  id?: string;
  termId: string;
  label: string;
  grade: number;
  classNums: number[];
  subjectNames: string[];
  /** 지정 시 이 교시들만 대상 (과목명만으로 모호할 때). 미지정이면 과목명 일치 셀 전부 */
  slots?: SimulSlot[];
  /** 연속시수 콤마 표기 "2"·"2,2" (phase9c_spec §2-3 소유 규칙 — 연속수업이 동시수업이면 이 등록부가 연속 속성을 소유) */
  consecutive?: string;
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** 특별실 배정 등록부 — timetable_venue_groups/{domain}/groups (pre_opening_3features_spec §F).
 *  일치 lesson에 로드 시 room(특별실명)을 스탬프하며, 엔진의 기존 특별실 충돌 하드 제외
 *  (buildSlotIndex.roomUse + isRoomFree)가 그 값을 소비한다. 수용력은 전 실 공통 1반. */
export interface VenueGroup {
  id?: string;
  termId: string;
  /** 특별실명 (다윗관·탁구장·정보실·생명과학실 …) — lesson.room 스탬프 값이자 충돌 판정 키 */
  roomName: string;
  label: string;
  grade: number;
  classNums: number[];
  subjectNames: string[];
  /** 지정 시 이 교시들만 대상 (과탐 실험처럼 일부 시수만 특별실인 경우). 미지정이면 과목명 일치 셀 전부 */
  slots?: SimulSlot[];
  /** 연속시수 콤마 표기 (phase9c_spec §2-3 소유 규칙 — 연속수업이 특별실이면 이 등록부가 연속 속성을 소유, 매뉴얼 §6-바) */
  consecutive?: string;
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

export interface TimetableCell {
  day: number; // 1~5 (월~금)
  period: number; // 1~8
  lessons: TimetableLesson[];
}

export interface ClassGrid {
  grade: number;
  classNum: number;
  cells: TimetableCell[];
}

export interface TimetableTerm {
  id: string; // e.g. "2026-2"
  name: string; // e.g. "2026학년도 2학기"
  status: TermStatus;
  subjects: TimetableSubject[];
  importedAt: number; // timestamp
  importedBy: string; // email
  activatedAt?: number | null;
  sourceNote?: string;
}

// ── 가져오기 중간 형식 (엑셀 2D 웹시트 붙여넣기 파싱 결과) ────

export interface IntermediateCell {
  day: number; // 1~5
  period: number; // 1~8
  subjectName: string;
  subjectShort?: string;
  teacherName: string;
  room?: string;
  coTeachingKey?: string; // 동시수업/이동수업 동일 그룹 식별용
}

export interface IntermediateClassGrid {
  grade: number;
  classNum: number;
  cells: IntermediateCell[];
}

export interface TeacherTimeCount {
  teacherName: string;
  subjectName: string;
  targetHours: number; // 시수표 상 총 주당 시수
}

export interface IntermediateImportPayload {
  termId: string;
  termName: string;
  sourceNote?: string;
  rawClassGrids: IntermediateClassGrid[];
  teacherTimeCounts?: TeacherTimeCount[];
  teacherEmailMap: Record<string, string>; // teacherName -> GWS email
  // 가상 교사(SLAT·창체 등 컴시간 자리표시 이름) — 계정 매핑 없이 저장 허용 (2026-08-02)
  virtualTeacherNames?: string[];
}

// ── 검증 리포트 DTO ──────────────────────────────────────────

export interface TeacherOverlapIssue {
  teacherName: string;
  teacherEmail?: string;
  day: number;
  period: number;
  classes: { grade: number; classNum: number; subjectName: string }[];
}

export interface ClassCellIssue {
  grade: number;
  classNum: number;
  issue: string;
}

export interface TimeCountMismatchIssue {
  teacherName: string;
  teacherEmail?: string;
  subjectName: string;
  gridHours: number;
  targetHours: number;
}

export interface UnmatchedTeacherIssue {
  teacherName: string;
  occurrenceCount: number;
}

/** 매핑 이메일이 의심스러운 경우 — 학생 계정·형식 오류·가상 교사 충돌 (저장 차단, 2026-08-02) */
export interface SuspiciousMappingIssue {
  teacherName: string;
  email: string;
  reason: string;
}

export interface TimetableValidationReport {
  isValid: boolean;
  canCommit: boolean;
  overlaps: TeacherOverlapIssue[];
  cellIssues: ClassCellIssue[];
  timeMismatches: TimeCountMismatchIssue[];
  unmatchedTeachers: UnmatchedTeacherIssue[];
  suspiciousMappings: SuspiciousMappingIssue[];
  summary: {
    totalClasses: number;
    totalTeachers: number;
    totalLessons: number;
    maxPeriodsPerDay: number;
  };
}

// ── API DTO (View & Manage) ──────────────────────────────────

export type ViewAction = "my" | "teacher" | "class" | "school" | "free" | "teachers" | "classes";

export interface TeacherTimetableCell {
  day: number;
  period: number;
  grade: number;
  classNum: number;
  subjectName: string;
  subjectShort: string;
  room?: string;
  changed?: WeeklyLessonChange; // 주간 합성 시 변경 셀 표시 (phase9b_spec §3)
  simul?: string; // 동시수업(분반) 그룹 라벨 — 그리드 구분 표시용 (pre_opening_3features_spec §A)
}

export interface TeacherTimetable {
  teacherEmail: string;
  teacherName: string;
  cells: TeacherTimetableCell[];
}

export interface FreeTeacher {
  email: string;
  name: string;
}

export interface ViewTimetableRequest {
  action: ViewAction;
  teacherEmail?: string;
  grade?: number;
  classNum?: number;
  day?: number;
  period?: number;
  termId?: string;
  weekId?: string; // 지정 시 주간 합성본 (phase9b_spec §3-6). 미지정 시 현재 주 폴백 → 기초
}

export interface ViewTimetableResponse {
  term: {
    id: string;
    name: string;
    status: TermStatus;
  } | null;
  action: ViewAction;
  data: ClassGrid | ClassGrid[] | TeacherTimetable | FreeTeacher[] | Record<number, number[]> | null;
  week?: { id: string; startDate: string; days: TimetableWeekDay[] } | null; // 합성 적용 시
  integrityWarnings?: string[]; // 일과계·super_admin에게만 동봉 (phase9b_spec §3-4)
  /** free 전용 (consent_swap_opening_spec §4-1b): 해당 교시가 전교 공통 활동(SLAT·창체 등)이라
   *  공강 개념이 적용되지 않음 — 그리드상 비어 보여도 실교사들은 담임·부담임·교과·동아리로 투입됨 */
  commonActivitySlot?: boolean;
  /** my 전용 (consent_swap_opening_spec §3-2d S1): 이 주의 전교 공통 활동 교시 전체 목록 —
   *  UI는 체인 목적지 등 "내 공강" 개념 렌더에서 이 교시들을 제외한다 (U4) */
  commonActivitySlots?: Array<{ day: number; period: number }>;
}

export type ManageAction =
  | "get_settings"
  | "set_managers"
  | "set_observers"  // phase9b_spec §5 — observerEmails (열람 전용 참관자) 저장, super_admin 전용
  | "set_publish_weeks_ahead"
  | "import_validate"
  | "import_commit"
  | "activate_term"
  | "delete_term"
  // ── Phase 9b (phase9b_spec §6) ──
  | "week_register"
  | "week_update"
  | "week_list"
  | "request_list"
  | "approve"
  | "reject"
  | "revert_change"
  | "direct_candidates"
  | "direct_candidates_all" // §14 직권 배정 교사 기점 — 소스 셀 1개 → 등록 전 주 맞교환 후보 일괄
  | "direct_commit"
  | "direct_commit_batch" // §14-4 직권 담기 일괄 반영 — direct_commit을 항목별 순차 실행 (부분 성공 허용)
  | "direct_projected" // §14-4 담기 가상 반영 그리드 — 대상 교사 전 주 시간표에 pendingItems 가상 적용 (my_projected의 직권 대응)
  | "chain_search" // §C 징검다리 체인 — 소스 수업이 목적지 슬롯에 도달하는 교환 수열 역방향 탐색 (pre_opening_3features_spec §C-2)
  // ── 동시수업 묶음 통 이동 (consent_swap_opening_spec §5b-4·§5c-3) — 직권 즉시 반영은 보조 경로
  //    (주 경로는 requests의 candidates 혼입 + simul_move_create 신청·approve 승인, §5c-7) ──
  | "simul_move_candidates" // 그룹·소스 슬롯 → 이동 가능 후보 (steps·coordination·warnings·score 동봉)
  | "simul_move_commit"     // 재계산 대조 + consent 필수 + 반별 change 단일 트랜잭션 원자 커밋
  // ── Phase 9b 순서 5 운영 도구 (phase9b_spec §8) ──
  | "neis_list"
  | "hour_totals"
  // ── 동시수업(분반) 그룹 등록부 (pre_opening_3features_spec §A-4) ──
  | "simul_list"
  | "simul_save"
  | "simul_delete"
  // ── 특별실 배정 등록부 (pre_opening_3features_spec §F) ──
  | "venue_list"
  | "venue_save"
  | "venue_delete"
  // ── 학사일정 (pre_opening_3features_spec §B) ──
  | "calendar_list"
  | "calendar_save"
  | "calendar_delete"
  | "calendar_ics_info"
  | "calendar_neis_sync"
  // ── 기초시간표 개정 (pre_opening_3features_spec §E) ──
  | "revision_list"
  | "revision_save_draft"
  | "revision_apply"
  | "revision_delete"
  // ── Phase 9c 등록부 (phase9c_spec §2-3) ──
  | "slot_ban_list"
  | "slot_ban_save"
  | "slot_ban_delete"
  | "consecutive_rule_list"
  | "consecutive_rule_save"
  | "consecutive_rule_delete"
  | "co_teaching_rule_list"
  | "co_teaching_rule_save"
  | "co_teaching_rule_delete"
  // ── Phase 9c-D 자동 작성 초안 (phase9c_d_spec §7) ──
  | "draft_list"
  | "draft_create"
  | "draft_get"
  | "draft_delete"
  | "draft_model" // 제약 모델 + 기준 그리드 한번에 로드 (편집 진입 시 1회 요청, spec §5)
  | "draft_op"    // op 1건 적용 (재생 → 검사 → 하드 신규 발생 시 409)
  | "draft_undo"  // opCursor - 1
  | "draft_redo"  // opCursor + 1
  // ── Phase 9c-F NEIS 일괄 내보내기 (phase9c_f_spec §4) ──
  | "neis_map_get"   // 매핑 등록부 + 학기 과목 seed
  | "neis_map_save"  // 등록부 전체 교체 (sanitize·감사 로그)
  | "neis_precheck"
  | "neis_csv"  // 사전 검증 리포트 (termId 또는 draftId 대상)
  // ── Phase 9c-E AI 보조층 (phase9c_e_spec §4) ──
  | "ai_diagnose"    // E1 불능 진단 (draftId 대상, 표시 전용, 키 미설정 시 enabled:false)
  | "ai_formalize"   // E2 선호 정식화 (aiText → slot_ban 제안, 저장은 UI 확인 후 slot_ban_save로만)
  | "ai_explain"     // E3 결과 설명 (draftId 대상, 표시 전용)
  | "ai_critique"    // E4 정성 비평 (draftId 대상, 표시 전용, v1은 셀 연동 없음)
  // ── Phase 9c-H 신학기 편성 입력 2종 (phase9c_h_spec) ──
  | "hours_plan_derive"
  | "hours_plan_list"
  | "hours_plan_get"
  | "hours_plan_save"
  | "hours_plan_delete"
  | "hours_plan_solve_input" // Phase 9c-I 시수 계획 백지 솔버 입력 조립 (phase9c_i_spec §5-1)
  | "hours_assignment_prepare" // 배정표 자동 생성 작업 준비 (hours_source_files_analysis §5ⓓ)
  | "hours_assignment_extract" // 부서 1개 AI 추출 (요청당 1콜 — 함수 시간 제한 대응)
  | "hours_assignment_finalize" // 교차 검증·조립 결과 (저장은 hours_plan_save로만)
  | "cohort_list"
  | "cohort_save"
  | "cohort_delete"
  // ── 창체·SLAT 학년도 재정의 (fixed_slot_override_spec §4) ──
  | "cohort_override_list"
  | "cohort_override_save"
  | "cohort_override_delete"
  // ── 학기 전환 스펙 (term_transition_spec) ──
  | "term_create_draft"
  | "registry_inherit"
  | "draft_adopt";

export interface ManageTimetableRequest {
  // 배정표 자동 생성 (hours_assignment_*)
  assignmentPdfB64?: string;
  creativePdfB64?: string;
  simulXlsxB64?: string;
  simulXlsxB64List?: string[]; // 학년별 이동수업 현황이 여러 파일일 때 (2·3학년 실물)
  targetYear?: number;
  targetSemester?: number;
  jobId?: string;
  deptIndex?: number;
  action: ManageAction;
  managerEmails?: string[];
  observerEmails?: string[]; // set_observers action 전용 (phase9b_spec §5)
  publishWeeksAhead?: number;
  importPayload?: IntermediateImportPayload;
  termId?: string;
  // ── Phase 9b ──
  week?: WeekRegisterInput;
  weekId?: string;
  targetWeekId?: string; // 교차 주 맞교환 (§4-3b) — direct_candidates / direct_commit
  requestId?: string;
  changeId?: string;
  decisionNote?: string;
  status?: SwapRequestStatus;
  // 직권 배정 (direct_candidates / direct_commit)
  source?: SwapSourceSlot;
  teacherEmail?: string; // direct_candidates_all 전용 — 대상 교사 (소스 셀 소유 검증에 사용)
  type?: SwapRequestType; // direct_* 및 neis_list 유형 필터 겸용
  candidate?: SwapCandidateSnapshot;
  reason?: SwapRequestReason;
  consent?: SwapConsentInput; // direct_commit: 조율 필요 후보의 양해 확인 (consent_swap_opening_spec §3, §14-4 동등성)
  // §14-4 직권 담기 — 후보 재탐색 가상 적용(direct_candidates_all) / 일괄 반영(direct_commit_batch)
  pendingItems?: DirectPendingOverlayItem[];
  extraWeeks?: number; // direct_projected — 기본 노출 창 밖으로 더 볼 주 수 ([이후 주 더 보기], 상한 52)
  items?: DirectCommitBatchItem[];
  // 운영 도구 (neis_list / hour_totals) — phase9b_spec §8
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;
  // 동시수업(분반) 그룹 등록부 (pre_opening_3features_spec §A-4)
  simulGroup?: Partial<SimulGroup>; // simul_save 본문 / simul_list 미리보기(previewCells) 요청
  simulGroupId?: string; // simul_save(수정)·simul_delete 대상
  venueGroup?: Partial<VenueGroup>; // venue_save 본문 / venue_list 미리보기(previewCells) 요청 (§F)
  venueGroupId?: string; // venue_save(수정)·venue_delete 대상
  chainTarget?: { weekId?: string; day: number; period: number }; // chain_search 목적지 (weekId 없으면 소스 주)
  chainMaxDepth?: number; // chain_search 최대 교환 수 (기본 2, 상한 3 — §C-2)
  // 동시수업 묶음 통 이동 (consent_swap_opening_spec §5b-4) — weekId·simulGroupId·reason·consent 재사용
  simulMoveSource?: { day: number; period: number }; // simul_move_candidates·commit 소스 슬롯
  simulMoveTarget?: { day: number; period: number }; // simul_move_commit 목적지 슬롯
  // 학사일정 (pre_opening_3features_spec §B)
  calendarEvent?: Partial<TimetableCalendarEvent>; // calendar_save 본문
  calendarEventId?: string; // calendar_save(수정)·calendar_delete 대상
  // 기초시간표 개정 (pre_opening_3features_spec §E)
  revisionId?: string; // revision_save_draft(기존 draft)·revision_apply·revision_delete 대상
  revisionOps?: BaseRevisionOp[]; // revision_save_draft 본문 (전체 교체)
  revisionNote?: string; // revision_save_draft 메모
  effectiveFrom?: string; // revision_apply — 적용 시작 주 월요일 (기본: 다음 주 월요일)
  // Phase 9c 등록부 (phase9c_spec §2-3)
  rule?: Partial<TeacherSlotBan> | Partial<ConsecutiveRule> | Partial<CoTeachingRule>;
  ruleId?: string;
  // Phase 9c-D 자동 작성 초안 (phase9c_d_spec §7)
  draftId?: string;
  draftLabel?: string;
  draftOrigin?: TimetableDraftOrigin;
  draftGrids?: ClassGrid[]; // draft_create 시 솔버 산출 그리드 (optional — 없으면 서버가 현행 복제)
  draftUnplaced?: TimetableDraftUnplaced[];
  draftReport?: TimetableAuditReport; // draft_create 시 클라에서 검사기 실행 결과 동봉
  draftOp?: BaseRevisionOp; // draft_op 적용 연산 1건
  draftHours?: HoursRequirement[]; // Phase 9c-I 시수 계획 원본 스냅샷 (phase9c_i_spec §5-2)
  draftFixedBlocks?: FixedBlock[]; // Phase 9c-I 교육과정 고정 블록 스냅샷
  draftPlanId?: string; // Phase 9c-I 출처 계획 ID
  // Phase 9c-F NEIS 매핑 (phase9c_f_spec §4) — neis_precheck 대상은 termId/draftId 재사용
  neisMap?: Partial<NeisMapRegistry>; // neis_map_save 본문 (전체 교체)
  // Phase 9c-E AI 보조 (phase9c_e_spec §3) — ai_formalize 자연어 문장 (실명 포함 가능, 서버가 가명화)
  aiText?: string;
  // Phase 9c-H 신학기 편성 입력 (phase9c_h_spec)
  sourceTermId?: string;
  targetTermId?: string;
  planId?: string;
  planLabel?: string;
  planRows?: HoursPlanRow[];
  gradeDayPeriods?: Record<number, Record<number, number>>;
  planStatus?: "draft" | "ready";
  reviewNotes?: HoursPlanReviewNote[];
  /** 편성 등록부 잠금 해제 사유 (registry_lock_spec §3) — 운영 학기 편집 10종 동반, 2~200자 */
  unlockReason?: string;
  /** 관문 과목 확정 (subject_dictionary_spec §3-2) — hours_plan_save 동반 */
  subjectConfirmations?: Array<{
    rawName: string;
    action: "link" | "create";
    canonicalName: string;
    shortName?: string;
  }>;
  cohort?: Partial<CurriculumCohort>;
  cohortId?: string;
  override?: Partial<FixedSlotOverride>;
  overrideId?: string;
  // ── 학기 전환 스펙 (term_transition_spec) ──
  newTermId?: string;
  newTermName?: string;
  fromTermId?: string;
  toTermId?: string;
}

export interface ManageTimetableResponse {
  success: boolean;
  action: ManageAction;
  message?: string;
  settings?: TimetableSettings;
  validationReport?: TimetableValidationReport;
  terms?: TimetableTerm[];
  term?: TimetableTerm | null;
  plans?: HoursPlanSummary[];
  plan?: HoursPlan | null;
  cohorts?: CurriculumCohort[];
  cohort?: CurriculumCohort | null;
  overrides?: FixedSlotOverride[];
  override?: FixedSlotOverride | null;
  inheritedCounts?: Record<string, number>; // registry_inherit 종별 복사 건수
  adoptedGridCount?: number; // draft_adopt 반영된 그리드 학급 수
}

// ═════════════════════════════════════════════════════════════
// Phase 9b: 주 단위 운영 · 변경 오버레이 · 수업교환 신청
// 상위 스펙: phase9b_spec.md §2~§6
// ═════════════════════════════════════════════════════════════

// ── 주 등록 (timetable_weeks) ────────────────────────────────

export interface TimetableWeekDay {
  day: number; // 1~5 (월~금)
  date: string; // "2026-09-07"
  holiday: boolean; // 휴업일 (공휴일·재량휴업)
  periodsByGrade?: Record<string, number>; // 요일별 시수 축소 {"1": 6, ...}. 없으면 설정값
}

export interface TimetableWeek {
  id: string; // weekId = 월요일 날짜 "2026-09-07"
  termId: string;
  startDate: string;
  days: TimetableWeekDay[];
  dayOverrides?: number[]; // 수동 오버라이드된 요일(1~5). 없으면 레거시 주(§4 자가 이행 대상), 빈 배열이면 전 요일 파생 추종.
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface WeekRegisterInput {
  termId: string;
  startDate: string; // 월요일
  days?: Array<{ day: number; holiday?: boolean; periodsByGrade?: Record<string, number> }>;
  dayOverrides?: number[];
  note?: string;
}

// ── 변경 오버레이 (timetable_changes — 불변 로그) ─────────────

export type ChangeType = "swap" | "substitute" | "cross_swap" | "move" | "revert";

export interface SwapChangeSlot {
  day: number;
  period: number;
  subjectName: string;
  teacherEmail: string;
  teacherName: string;
}

// ── 교차 주(cross-week) 맞교환 (phase9b_spec §4-3b) ───────────

/** 교차 주 치환에 들어가고 나가는 수업 — 상대 주에서 재구성해야 하므로 표기 정보 전부 보유 */
export interface CrossSwapLessonRef {
  subjectName: string;
  subjectShort: string;
  teacherEmail: string;
  teacherName: string;
  room?: string;
  /** 여러 반이 함께 움직이는 수업의 묶음 라벨 (§5c-8). 다른 주로 옮겨도 묶음 표시가 살아 있어야
   *  같은 주 이동(수업 객체를 그대로 옮긴다)과 결과가 같아진다 — 교차 주만 수업을 재구성하므로
   *  이 필드로 명시 계승한다. 일반 교차 주 맞교환은 묶음 수업을 다루지 않아 항상 비어 있다. */
  simul?: string;
}

/**
 * 교차 주 교환 1건 = change 문서 2개(각 주에 1개), 공통 exchangeId로 연결.
 * 각 문서는 자기 주(weekId)의 셀 1개 치환만 기술 — 주간 합성 로더의 weekId 등호 조회 유지 목적.
 * 적용 시 셀 현재 수업이 out과 일치할 때만 in으로 치환, 불일치는 integrityWarning.
 */
export interface CrossSwapChange {
  exchangeId: string;
  otherWeekId: string;
  grade: number;
  classNum: number;
  day: number; // 이 문서 주(weekId)의 슬롯
  period: number;
  /** 이 슬롯에서 빠지는 수업. null = 원래 빈 교시였다(상대 주에서 수업이 들어오기만 한다).
   *  §5c-8 교차 주 통 이동에서 목적지 반이 빈 교시일 때 필요 — 한쪽만 있는 이동의 표현. */
  out: CrossSwapLessonRef | null;
  /** 상대 주에서 넘어와 들어오는 수업. null = 이 슬롯이 비워진다(수업이 상대 주로 떠난다). */
  in: CrossSwapLessonRef | null;
}

export interface TimetableChange {
  id: string;
  termId: string;
  weekId: string;
  type: ChangeType;
  requestId?: string; // 신청 경유 시. 일과계 직권이면 없음
  swap?: {
    grade: number;
    classNum: number;
    a: SwapChangeSlot; // 신청자 원 슬롯
    b: SwapChangeSlot; // 교환 상대 슬롯
  };
  substitute?: {
    grade: number;
    classNum: number;
    day: number;
    period: number;
    subjectName: string;
    absentTeacherEmail: string;
    absentTeacherName: string;
    subTeacherEmail: string;
    subTeacherName: string;
    subSubjectName?: string;
  };
  crossSwap?: CrossSwapChange; // 교차 주 맞교환 (phase9b_spec §4-3b) — revert는 exchangeId 단위로만
  /** 상대 없는 단순 이동 (consent_swap_opening_spec §5b-1) — 통 이동에서 대상 슬롯이 빈 반의 표현.
   *  applySwap은 양쪽 lesson 실재를 요구해 빈 교시 이동을 기존 swap으로 표현할 수 없다 (§5b-0). */
  move?: {
    grade: number;
    classNum: number;
    from: { day: number; period: number };
    to: { day: number; period: number };
    subjectName: string; // 이동하는 수업 식별 (applySwap의 SwapChangeSlot 대조와 같은 정신)
    teacherEmail: string;
    teacherName: string;
  };
  revertOf?: string; // 취소 대상 changeId (역방향 기록)
  appliedBy: string;
  appliedAt: number;
}

// ── 수업교환 신청 (swap_requests) ─────────────────────────────

export type SwapRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
// "chain" = 교사 징검다리 체인 신청 (consent_swap_opening_spec §4-3) — 승인 시 단계별 swap/cross_swap change로 전개
// "simul_move" = 동시수업 묶음 통 이동 (§5b·§5c) — 교사 신청(PENDING→승인)이 주 경로, 일과계 직권(즉시
//   APPROVED)은 보조. 어느 경로든 반별 swap/move change 원자 커밋 + requestId 묶음 전량 revert.
export type SwapRequestType = "swap" | "substitute" | "cross_swap" | "chain" | "simul_move";

export const SWAP_REASON_TYPES = ["출장", "연수", "병가", "공가", "학교행사", "기타"] as const;
export type SwapReasonType = (typeof SWAP_REASON_TYPES)[number];

export interface SwapRequestReason {
  type: SwapReasonType;
  note?: string; // "기타" 선택 시 필수
}

export interface SwapSourceSlot {
  grade: number;
  classNum: number;
  day: number;
  period: number;
  subjectName: string;
}

export interface SwapCandidateSnapshot {
  targetDay?: number; // swap: 옮겨갈 슬롯
  targetPeriod?: number;
  targetWeekId?: string; // 교차 주 맞교환: 상대 슬롯이 속한 주 (§4-3b). 없으면 같은 주
  counterpartEmail: string; // swap 상대 / substitute 보강 교사
  counterpartName: string;
  counterpartSubjectName?: string;
  score: number;
  penalties: string[];
  coordination?: CandidateCoordination; // 조율 필요 후보 (consent_swap_opening_spec §2) — 있으면 신청에 consent 필수
}

// ── 양해 기반 교체 개방 (consent_swap_opening_spec §2·§3) ─────

/** 조율 필요 후보의 충돌 슬롯을 점유 중인 수업 = 양해 필요 당사자 */
export interface CoordinationOccupant {
  grade: number;
  classNum: number;
  subjectName: string;
  teacherEmail: string;
  teacherName: string;
}

/**
 * 조율 필요 후보의 묶음(동시수업) 이동 명세 (consent_swap_opening_spec §5c-7).
 * 통 이동은 별도 기능이 아니라 조율 필요 후보의 종류 하나 — 실제 상대 목록의 원본은 steps다
 * (후보의 counterpartName은 그룹 라벨 요약뿐, chain 전례). 화면은 steps로 렌더한다.
 */
export interface CoordinationSimulInfo {
  groupId: string;
  label: string; // SimulGroup 라벨 (사람용)
  grade: number;
  classNums: number[];
  steps: SimulMoveStep[]; // 반별 전개 — 서버 계산값
  warnings?: string[]; // 연속시수 경고 등 — 차단하지 않는다 (§5b-2)
}

/**
 * 조율 필요 후보의 충돌 명세 (consent_swap_opening_spec §2-2·§5c-7).
 * "venue" = 특별실 충돌(conflicts 1건 이상) / "simul" = 묶음 이동(simul 블록) /
 * "venue+simul" = 둘 다. 소비처는 kind 등호 비교 대신 conflicts·simul 존재로 분기할 것.
 */
export interface CandidateCoordination {
  kind: "venue" | "simul" | "venue+simul";
  conflicts: Array<{
    roomName: string; // 겹치는 특별실 (예: "탁구장")
    slot: { weekId: string; day: number; period: number }; // 충돌이 나는 슬롯
    occupants: CoordinationOccupant[];
  }>;
  simul?: CoordinationSimulInfo; // kind에 simul이 포함될 때만
}

/**
 * 양해 기록 (swap_requests 원장 — 불변, consent_swap_opening_spec §3-1).
 * parties는 서버가 재계산된 coordination에서 도출 — 클라이언트 값 불신.
 */
export interface SwapConsent {
  confirmed: true;
  parties: Array<{ email: string; name: string }>;
  note?: string; // 예: "체육관 합반으로 양해" (선택, 200자)
  confirmedAt: number; // 서버 시각
  /** 양해 경로 (notification_center_spec §4 후속 배선): manual = 구두 양해 후 수동 체크(기존),
   *  in-app = 알림 수락(consentStatus=CONSENTED)이 검증을 대체. 미기록 = manual(과거 데이터) */
  method?: "manual" | "in-app";
  /** in-app일 때 — 수락이 일어난 초안 id (감사 추적) */
  consentDraftId?: string;
}

/** 신청 body의 양해 입력 — confirmed 체크와 메모만 받는다 (당사자 명단은 서버 도출) */
export interface SwapConsentInput {
  confirmed?: boolean;
  note?: string;
}

// ── 동시수업 묶음 통 이동 (consent_swap_opening_spec §5b) ─────

/** 반별 전개 1건: 상대 수업이 있으면 swap change, 빈 교시면 move change로 커밋된다 (§5b-1) */
export interface SimulMoveStep {
  classNum: number;
  kind: "swap" | "move";
  groupLesson: { subjectName: string; teacherEmail: string; teacherName: string };
  counterpart?: { subjectName: string; teacherEmail: string; teacherName: string }; // kind==="swap"일 때
}

/** SwapRequest.simulMove — 통 이동 원본 (candidate 스냅샷은 사람용 요약만, chain 패턴) */
export interface SimulMoveInfo {
  groupId: string;
  label: string; // SimulGroup 라벨 스냅샷 (사람용)
  grade: number;
  classNums: number[];
  from: { day: number; period: number };
  to: { day: number; period: number };
  steps: SimulMoveStep[]; // 반별 전개 — 서버 재계산 스냅샷 (chainSteps와 같은 정신)
}

/** 통 이동 후보 (findSimulGroupMoveCandidates 출력 — §5b-2) */
export interface SimulGroupMoveCandidate {
  targetDay: number;
  targetPeriod: number;
  steps: SimulMoveStep[];
  score: number; // 감점 합 (0이 최선)
  penalties: string[];
  penaltyDetails: PenaltyDetail[];
  coordination?: CandidateCoordination; // 특별실 충돌 — §2 조율 분류 재사용
  warnings?: string[]; // 연속시수 경고 등 — 차단하지 않는다 (§5b-2, 판단은 일과계 몫)
}

export interface SwapRequest {
  id: string;
  termId: string;
  weekId: string;
  type: SwapRequestType;
  targetWeekId?: string; // 교차 주 맞교환 (§4-3b) — 없으면 기존 같은-주 교환
  requesterEmail: string;
  requesterName: string;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
  reason: SwapRequestReason;
  status: SwapRequestStatus;
  decidedBy?: string;
  decidedAt?: number;
  decisionNote?: string; // 반려 사유 (반려 시 필수)
  appliedChangeIds?: string[];
  createdAt: number;
  direct?: boolean; // 일과계 직권 배정 경유 (교사 사전 신청 없음)
  batchId?: string; // 장바구니 일괄 제출 묶음 (phase9b_spec §14-2) — 같은 제출의 신청들이 공유
  consent?: SwapConsent; // 조율 필요 후보의 양해 기록 (consent_swap_opening_spec §3-1) — 승인 판단·책임 보호 근거
  // ── type === "chain" 전용 (consent_swap_opening_spec §4-3) ──
  chainSteps?: ChainStepItem[]; // 서버 재계산 스냅샷 — 승인 시 이 단계열을 순차 재검증 후 원자 커밋
  chainTarget?: { weekId?: string; day: number; period: number }; // 목적지 (weekId 없으면 소스 주)
  // ── type === "simul_move" 전용 (consent_swap_opening_spec §5b) ──
  simulMove?: SimulMoveInfo; // 통 이동 원본 — 반별 전개 스냅샷 (revert는 requestId 묶음 전량)
}

// ── 사전 양해 임시저장 (swap_drafts — phase9b_spec §13-1) ─────

export type ConsentStatus = "NONE" | "REQUESTED" | "CONSENTED" | "DECLINED";

export interface SwapDraft {
  id: string;
  requesterEmail: string;
  requesterName: string;
  termId: string;
  sourceWeekId: string;
  targetWeekId?: string;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
  reason?: SwapRequestReason;
  note?: string;
  consentStatus: ConsentStatus;
  consentNote?: string; // 당사자의 한 줄 사유 (DECLINED/CONSENTED)
  consentRequestMessage?: string; // 요청 때 보낸 부탁 한 줄
  createdAt: number;
  updatedAt: number;
  conditional?: boolean; // 조건부 후보 여부 (2026-08-05)
  /** 직권 담기 초안 (일과계) — 교사 포털 목록과 분리 (notification_center_spec §4 직권 동등성) */
  direct?: boolean;
  /** 직권 담기 대상 교사 이메일 (일과계 직권 배정) */
  sourceTeacherEmail?: string;
  /** 직권 담기 대상 교사 실명 (일과계 직권 배정) */
  sourceTeacherName?: string;
}

// ── 주간 합성 (weekly.ts 출력) ────────────────────────────────

export interface WeeklyLessonChange {
  changeId: string;
  type: "swap" | "substitute" | "cross_swap" | "move";
  origin?: { day: number; period: number }; // "화3 ← 월2에서 이동" 출처
  otherWeekId?: string; // cross_swap: 이 수업이 넘어온 상대 주 (§4-3b)
}

export interface WeeklyLesson extends TimetableLesson {
  changed?: WeeklyLessonChange;
}

export interface WeeklyCell {
  day: number;
  period: number;
  lessons: WeeklyLesson[];
}

export interface WeeklyClassGrid {
  grade: number;
  classNum: number;
  cells: WeeklyCell[];
}

export interface WeeklySynthesisResult {
  grids: WeeklyClassGrid[];
  integrityWarnings: string[]; // 적용 불능 change 수집 — 일과계 화면 노출용
}

// ── 운영 도구 (phase9b_spec §8 — neis_list / hour_totals) ─────

/**
 * NEIS 입력용 수업교환 목록 1행 — 컴시간 양식 계승:
 * 변경있는 교시(일자·교시) | 교사 | 과목 | 변경전 교시 | 비고(특별보강 대체교사)
 * swap 1건 = 2행(교사별), substitute 1건 = 1행. revert된 변경은 제외.
 */
export interface NeisRow {
  changeId: string;
  weekId: string;
  type: "swap" | "substitute" | "cross_swap" | "move";
  grade: number;
  classNum: number;
  date: string; // 변경 있는 교시의 일자 (YYYY-MM-DD)
  day: number; // 1~5
  period: number;
  teacherName: string;
  teacherEmail: string;
  subjectName: string;
  prevDate: string; // 변경전 교시 일자 (substitute는 동일 슬롯)
  prevDay: number;
  prevPeriod: number;
  note: string; // 비고 — 특별보강 대체 교사
}

/** 시수 집계 (§8) — 저장하지 않고 합성본에서 계산. 실제 운영된 수업만 센다(§12-3). */
export interface HourTotalsResult {
  termId: string;
  endDate: string; // 집계 종료일 (이 날짜까지의 등록 주·요일만)
  weeksCounted: number;
  byTeacher: Array<{ email: string; name: string; total: number; substituteCount: number }>;
  bySubject: Array<{ subjectName: string; total: number }>;
  byClass: Array<{ grade: number; classNum: number; total: number }>;
}

// ── 후보 탐색 엔진 (swap.ts 출력) ─────────────────────────────

/** 감점 대상 분류 (§14-2 v2) — 교사 화면은 counterpart만 표시, 일과계는 전체 열람 */
export type PenaltyScope = "mine" | "counterpart" | "class";

export interface PenaltyDetail {
  scope: PenaltyScope;
  text: string;
  points: number;
}

export interface SwapCandidate {
  targetDay: number;
  targetPeriod: number;
  targetWeekId?: string; // 다른 주로 가는 후보 — 후보가 목적지 주를 직접 들고 다닌다 (교차 주 통 이동 §5c-8)
  counterpartEmail: string;
  counterpartName: string;
  counterpartSubjectName: string;
  score: number; // 전체 감점 합 (0이 최선) — 일과계 스냅샷·정렬 보조
  penalties: string[]; // 사람이 읽는 감점 사유 전체 (일과계 요청대장 표시용 유지)
  penaltyDetails: PenaltyDetail[]; // 분류된 감점 (§14-2 v2 — 교사 화면은 scope==="counterpart"만)
  counterpartScore: number; // 상대 교사 관련 감점 합 — 교사 화면 표시·1차 정렬 기준
  conditional?: boolean; // 내 대기 신청 승인 전제 성립 여부 (2026-08-05)
  coordination?: CandidateCoordination; // 조율 필요 후보 — 정렬은 깨끗한 후보 뒤 (consent_swap_opening_spec §2-2)
}

export interface SubstituteCandidate {
  teacherEmail: string;
  teacherName: string;
  substituteCount: number; // 이번 학기 특별보강 누계 (공평 정렬 기준)
  sameSubject: boolean; // 결강 과목 담당 교사 여부
}

export interface SwapCandidatesResult {
  source: SwapSourceSlot;
  swapCandidates: SwapCandidate[];
  substituteCandidates: SubstituteCandidate[];
  assumedPendingCount?: number;
  assumedDraftCount?: number;
  projectedDayLoads?: ProjectedDayLoad[];
  projectedTargetDayLoads?: ProjectedDayLoad[];
}

export interface SwapCandidatesAllWeek {
  weekId: string;
  startDate: string;
  swapCandidates: SwapCandidate[];
}

export interface SwapCandidatesAllResult {
  sourceSubjectName: string;
  weeks: SwapCandidatesAllWeek[];
  assumedPendingCount?: number;
  assumedDraftCount?: number;
}

// ── 신청 라우트 DTO (/api/timetable/requests) ─────────────────

export type SwapRequestAction =
  | "candidates"
  | "candidates_all" // §14-2 v2.1: 소스 셀 1개 → 등록 전 주 후보 일괄 (그리드 인라인 하이라이트)
  | "consent_request" // 양해 요청 발송 (notification_center_spec §4) — 초안 당사자들에게 수락 알림
  | "create"
  | "create_batch"
  | "my_list"
  | "my_projected" // §14-2 v2: 등록 전 주 예상 내 시간표 (PENDING·초안 가상 반영)
  | "cancel"
  | "draft_save"
  | "draft_list"
  | "draft_delete"
  | "draft_delete_all" // §3-2d S2: 본인 초안 전량 일괄 삭제 (U3 "초안 전체 비우기")
  | "chain_search" // 교사 체인 탐색 — 소스 본인 소유 검증 후 computeChainSearch (consent_swap_opening_spec §4-2)
  | "chain_create" // 체인 신청 생성 — 서버 재탐색 대조 + consent 필수 (§4-3)
  | "simul_move_create"; // 묶음 수업 통 이동 신청 — 소유 검증·재계산 대조·consent 필수, 그룹·슬롯 단위 중복 차단 (§5c-2)

/** 장바구니 일괄 제출 항목 (phase9b_spec §14-2). 교차 주는 type:"swap"+targetWeekId — create와 동일 규약 */
export interface SwapBatchCreateItem {
  weekId: string;
  targetWeekId?: string;
  type: SwapRequestType;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
  reason?: SwapRequestReason; // 없으면 일괄 제출의 공통 reason 적용
  draftId?: string; // 접수 성공 시 정리할 초안 (본인 소유 검증은 서버)
  consent?: SwapConsentInput; // 조율 필요 후보 항목의 양해 확인 (consent_swap_opening_spec §3)
}

export interface SwapBatchItemResult {
  index: number;
  ok: boolean;
  requestId?: string;
  error?: string; // 재검증 탈락 사유 — 초안 카드에 표기 (부분 성공 허용, §14-2)
  draftId?: string;
}

/**
 * §14-4 직권 담기 누적분 — direct_candidates_all 후보 재탐색에 가상 적용할 항목.
 * 교사 초안(swap_drafts)과 달리 서버에 저장하지 않는다 — 담기는 일과계 화면 세션 상태이며,
 * 재탐색 때마다 클라이언트가 전량 명시 전달한다.
 */
export interface DirectPendingOverlayItem {
  weekId: string;
  targetWeekId?: string; // 교차 주 맞교환 — 없거나 weekId와 같으면 같은-주
  type: SwapRequestType;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
  /** §C 체인 단계처럼 담기 항목이 선택 교사가 아닌 다른 교사의 수업일 때의 소스 담당자.
   *  없으면 오버레이는 선택 교사를 담당자로 간주한다(기존 담기 동작 그대로). 커밋은 어차피
   *  서버가 소스 슬롯에서 교사를 재해석하므로(resolveDirectSource) 이 필드는 가상 반영·표시용. */
  sourceTeacherEmail?: string;
  sourceTeacherName?: string;
}

/** §C 징검다리 체인 한 단계 — 담기(pendingItems) 호환 + 사람용 요약 (pre_opening_3features_spec §C-2) */
export interface ChainStepItem extends DirectPendingOverlayItem {
  sourceTeacherEmail: string;
  sourceTeacherName: string;
  stepSummary: string; // "① 김OO 수3 → 금2 (이OO와 맞교환)"
  score: number;
  penalties: string[];
}

export interface ChainSearchChain {
  steps: ChainStepItem[];
  totalScore: number;
  summary: string; // 단계 요약 연결
}

/** §14-4 직권 일괄 반영 항목 — direct_commit 단건과 동일 규약 + 항목별 사유 */
export interface DirectCommitBatchItem extends DirectPendingOverlayItem {
  draftId?: string; // 직권 담기 서버 초안 — 알림 수락 효력·반영 후 정리 (notification_center_spec §4)
  reason?: SwapRequestReason; // 없으면 일괄 반영의 공통 reason 적용
  consent?: SwapConsentInput; // 조율 필요 후보 항목의 양해 확인 — §14-4 동등성 (직권도 양해는 받아야 함)
}

/** §14-4 직권 일괄 반영 항목별 결과 (부분 성공 허용 — create_batch와 동일 방침) */
export interface DirectCommitBatchItemResult {
  index: number;
  ok: boolean;
  requestId?: string;
  changeId?: string;
  error?: string; // 승인 재검증 탈락 사유 — 담기 카드에 표기
}

/** 요일별 예상 시수 (phase9b_spec §14-1) — 가상 합성 반영 후, 현재 검토 중 후보는 미포함(±1은 UI가 계산) */
export interface ProjectedDayLoad {
  day: number; // 1~5
  count: number;
}

export interface SwapRequestApiRequest {
  action: SwapRequestAction;
  weekId?: string;
  targetWeekId?: string; // 교차 주 맞교환 (§4-3b) — candidates·create에서 사용, 없거나 weekId와 같으면 같은-주
  source?: Omit<SwapSourceSlot, "subjectName"> & { subjectName?: string };
  type?: SwapRequestType;
  candidate?: SwapCandidateSnapshot;
  reason?: SwapRequestReason; // create: 신청 사유 / create_batch: 항목별 reason 없을 때의 공통 사유
  consent?: SwapConsentInput; // create: 조율 필요 후보의 양해 확인 (consent_swap_opening_spec §3) — 명단은 서버 도출
  requestId?: string;
  // 가상 합성 what-if (candidates — §14-1)
  includeMyPending?: boolean;
  includeDrafts?: boolean;
  // 장바구니 일괄 제출 (create_batch — §14-2)
  items?: SwapBatchCreateItem[];
  // 교사 체인 (chain_search / chain_create — consent_swap_opening_spec §4-2·§4-3)
  chainTarget?: { weekId?: string; day: number; period: number };
  chainMaxDepth?: number; // 기본 2, 상한 3 (§C-2)
  chainSteps?: ChainStepItem[]; // chain_create: 화면에서 선택한 체인의 단계열 — 서버가 재탐색 대조 후 서버 값 스냅샷
  // 묶음 수업 통 이동 신청 (simul_move_create — consent_swap_opening_spec §5c-2). 소스는 body.source 재사용
  simulMoveTarget?: { day: number; period: number };
  // 임시저장 (draft_save / draft_delete)
  draftId?: string;
  consentMessage?: string;
  directOnly?: boolean; // draft_list — 직권 담기 초안만 조회 (일과계 화면 전용) // 양해 요청(consent_request)에 붙이는 부탁 한 줄 (선택, 200자)
  draft?: {
    termId?: string;
    sourceWeekId?: string;
    targetWeekId?: string;
    source?: SwapSourceSlot;
    candidate?: SwapCandidateSnapshot;
    reason?: SwapRequestReason;
    note?: string;
  };
}

// ── Phase 9c: 기초시간표 제약 모델·검사기 (phase9c_spec §2-3·§3) ──

/** 특별교사 금지 속성 (매뉴얼 §6-가): assign=배정금지(아예 배정 불가 — 정적 검사 대상),
 *  move=이동금지(솔버가 옮기지 못함 — 완성본 정적 검사에서는 위반이 성립하지 않음) */
export type SlotBanKind = "assign" | "move";

/** 특별교사 이동금지/배정금지 등록부 — 교사별 금지 교시 집합.
 *  요일 전체·교시 전체 토글은 UI가 슬롯 목록으로 전개해 저장한다 (저장 모델은 슬롯 나열 단일형). */
export interface TeacherSlotBan {
  id?: string;
  termId: string;
  teacherEmail: string;
  teacherName?: string;
  kind: SlotBanKind;
  slots: SimulSlot[];
  note?: string;
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** 일괄 배정 등록부 (매뉴얼 §6-나) — 한 (요일,교시)에 여러 학급 고정 배치(창체·SLAT·재량).
 *  로테이션(주중 여러 교시)은 블록 여러 건으로 표현한다. 배정된 교사는 자동 이동금지(매뉴얼 규칙 — 솔버 단계 적용). */
export interface FixedBlock {
  id?: string;
  termId: string;
  label: string;
  day: number; // 1~5
  period: number;
  entries: Array<{
    grade: number;
    classNum: number;
    subjectName: string;
    /** 지정 시 해당 교사 배치까지 검사 (가상 교사는 이름 기준) */
    teacherName?: string;
  }>;
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

// ── Phase 9c-H: 신학기 시수 조정 계획 (phase9c_h_spec §1-2) ────

export interface HoursPlan {
  id: string;
  label: string;              // "2027학년도 1학기 시수" — 사람이 붙임
  sourceTermId?: string;      // 파생 원본 학기 (예: "2026-2", 엑셀 업로드 시 "upload")
  targetTermId?: string;      // 소속 대상 학기 (예: "2027-1", term_transition_spec §4)
  derivedAt: number;          // 파생/업로드 시각 — 이후 원본이 바뀌어도 이 사본은 불변
  rows: HoursPlanRow[];
  gradeDayPeriods: Record<number, Record<number, number>>;  // 부족정보 #5
  status: "draft" | "ready";  // ready = 솔버에 넘길 수 있음
  /** 배정표 자동 생성 확인 목록 사본 — 없으면 빈 배열 취급 */
  reviewNotes?: HoursPlanReviewNote[];
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

/** 배정표 자동 생성이 남긴 확인 목록 — 불러온 뒤에도 복기·체크할 수 있게 계획에 동봉 */
export interface HoursPlanReviewNote {
  severity: "error" | "notice";
  text: string;
  /** 사용자가 "처리 완료" 표시한 항목 */
  done?: boolean;
}

export interface HoursPlanRow {
  id: string;                 // 행 고유 id (편집 추적용)
  grade: number;
  classNum: number;
  subjectName: string;        // 시스템 과목명 (단축과목명 우선, §0-1a-②')
  subjectShort?: string;      // 단축과목명
  neisName?: string;          // 정식과목명 (나이스 등재 과목명 원천, §0-1a-②')
  teacherEmail: string;       // "" = 가상 교사(창체·SLAT) — 코호트 등록부가 위치를 준다
  teacherName: string;        // 표시용 스냅샷. 판정은 email로만 한다
  hours: number;              // 주당 시수
  /** 부족정보 #2 — 이 행이 동시수업 그룹 몫인가 */
  simulGroupId?: string | null;
  /** 부족정보 #4 — 이 시수 중 특별실을 쓰는 시간 수. null = 전 시수(보수) */
  venueHours?: number | null;
}

export interface HoursPlanSummary {
  id: string;
  label: string;
  sourceTermId?: string;
  targetTermId?: string;
  derivedAt: number;
  rowCount: number;
  status: "draft" | "ready";
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

/** 교육과정 코호트 등록부 (9c-H §2) — 창체·SLAT 고정 슬롯의 축은 「학년」이 아니라 「교육과정」.
 *  학년은 저장하지 않는다(3월 함정) — cohort.ts의 역산 함수가 유일한 파생 소재지. */
export interface CurriculumCohort {
  id: string;
  /** "2022 개정 교육과정" — 사람이 붙임. 화면 문구는 「교육과정」·「○○년 입학생부터」만 사용 */
  label: string;
  /** 이 교육과정이 처음 적용된 입학년도. 예: 2025 */
  startAdmissionYear: number;
  fixedSlots: CohortFixedSlot[];
  active: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

/** 판정 키는 (day, period). displayName은 표시용이자 시수표 행 과목명과의 연결 고리 —
 *  컴파일러가 fixedBlock entry의 subjectName으로 시수표 행을 찾으므로 "창체"·"SLAT" 표기가 일치해야 한다. */
export interface CohortFixedSlot {
  displayName: string; // "창체" / "SLAT"
  day: number; // 1=월 … 5=금
  period: number;
}

/** 창체·SLAT 배치의 학년도 재정의 층 (fixed_slot_override_spec §1).
 *  코호트 축(교육과정)이 기본값이고, 이 재정의가 「○○학년도부터」 그 위를 덮는다.
 *  gradeSlots에 키가 있는 학년만 덮는다 — 키 없는 학년은 코호트를 그대로 따른다.
 *  저장은 학년별 전체 사본이다(차분 아님 — 9c-H §0-2와 같은 원칙). */
export interface FixedSlotOverride {
  id: string;
  /** "2027학년도 창체 수요일 이동" — 사람이 붙임. 화면 문구에 「재정의」·「오버라이드」 금지 */
  label: string;
  /** 이 학년도부터 적용. 끝 학년도는 없다 — 더 나중의 재정의가 나오면 그것이 대신한다 */
  effectiveFromSchoolYear: number;
  /** 학년(1~3) → 그 학년의 고정 슬롯 전체 사본. 빈 배열 [] = "이 학년은 고정 슬롯 없음"(의미 있는 값) */
  gradeSlots: Record<number, FixedSlotOverrideGrade>;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

export interface FixedSlotOverrideGrade {
  /** 작성 시점(effectiveFromSchoolYear 기준)에 이 학년이 따르던 교육과정 id.
   *  서버가 저장 시 직접 계산해 찍는다 — 클라이언트 값을 믿지 않는다.
   *  해석 시점에 실제 교육과정과 다르면 이 재정의는 그 학년에 적용하지 않는다(스펙 §2 부적용 규칙). */
  basedOnCohortId: string | null;
  slots: CohortFixedSlot[];
}

/** 연속수업 등록부 (매뉴얼 §6-라) — 콤마 표기 "2"·"2,2"·"3" = 연속 블록 길이 목록(잔여 시수는 단독 1교시).
 *  소유 규칙: 대상이 동시수업·특별실 그룹이면 이 등록부가 아니라 그 그룹의 consecutive 필드에 등재한다 (이중 등재 금지). */
export interface ConsecutiveRule {
  id?: string;
  termId: string;
  grade: number;
  classNums: number[];
  subjectName: string;
  /** 지정 시 해당 교사 수업만 대상 */
  teacherEmail?: string;
  pattern: string;
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** 복수교사 등록부 (매뉴얼 §6-사) — 동일 학급·동일 슬롯에 2교사 이상 동시 투입, 시수 동일 강제 */
export interface CoTeachingRule {
  id?: string;
  termId: string;
  grade: number;
  classNums: number[];
  subjectName: string;
  teacherEmails: string[];
  active: boolean;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** 시수표 1행 (phase9c_spec §2-1) — teacher × subject × class → 주당 시수.
 *  teacherKey는 이메일(소문자) 우선, 가상 교사(이메일 없음)는 "name:이름" 형식. */
export interface HoursRequirement {
  grade: number;
  classNum: number;
  subjectName: string;
  teacherKey: string;
  hours: number;
  /** 9c-I-2 힌트 — 동시수업 그룹 소속. 계획 행에서 전달, 없으면 컴파일러가 종전대로 추정.
   *  검사기(validateTimetable)는 이 필드를 읽지 않는다 — 컴파일 전용. */
  simulGroupId?: string | null;
  /** 9c-I-2 힌트 — hours 중 특별실 점유 시수. 없으면 종전대로 전 시수 보수 처리. */
  venueHours?: number | null;
}

/** 검사기 입력 제약 모델 (phase9c_spec §2) — 등록부가 아직 없는 항목은 생략 가능(해당 검사만 건너뜀) */
export interface TimetableConstraintModel {
  lunchAfterPeriod: number;
  periodsPerDay: number;
  /** 학년별 요일별 운영 교시수 — grade → day(1~5) → periods. 없으면 그리드에서 역산(자기 일관 검사만 수행) */
  gradeDayPeriods?: Record<number, Record<number, number>>;
  /** 시수표 — 없으면 H1·H4 생략 */
  hours?: HoursRequirement[];
  simulGroups?: SimulGroup[];
  venueGroups?: VenueGroup[];
  teacherSlotBans?: TeacherSlotBan[];
  fixedBlocks?: FixedBlock[];
  consecutiveRules?: ConsecutiveRule[];
  coTeaching?: CoTeachingRule[];
  /** 과목 사전(term.subjects 유래) — 등록부 표기↔계획 표기 대조의 정확 일치 다리 (subject_dictionary_spec §4).
   *  없으면 소비자들은 기존 느슨 매칭 폴백만으로 동작한다 (전환 1단계 호환). */
  subjects?: SubjectNameEntry[];
}

export type HardViolationCode =
  | "H1" // 미배정 시수 (시수표 대비 부족)
  | "H2" // 교사 동시 2곳 배정
  | "H3" // 학급 슬롯 중복 (같은 슬롯 이중 배정)
  | "H4" // 시수 초과 배정
  | "H5" // 배정금지 교시 위반
  | "H6" // 일괄 배정 고정 위반
  | "H7" // 동시수업 그룹 동시성 위반
  | "H8" // 특별실 초과 점유
  | "H9" // 연속수업 패턴 위반
  | "H10" // 복수교사 동시성 위반
  | "H11"; // 미편성 교시 배정

export interface HardViolation {
  code: HardViolationCode;
  text: string; // 사람이 읽는 문장 (눈높이 원칙 — 개발 용어 금지)
  grade?: number;
  classNum?: number;
  day?: number;
  period?: number;
  teacherEmail?: string;
  teacherName?: string;
  subjectName?: string;
  /** 등록부 미비로 추정되는 위반 (§3-4 문제점만 검색) — 기본 노출에서 접고 등재 후보·질문지 문항으로 안내 */
  registryGap?: boolean;
  hint?: string;
}

export type SoftPenaltyCode =
  | "S1" // 요일 시수 쏠림 (기존 '최적')
  | "S2" // 연속 3교시 이상 (기존 '연속3')
  | "S3" // 점심 전후 연속 (기존 '점심')
  | "S4" // 같은 학급 같은 요일 동일 과목 중복 (기존 '중복')
  | "S5" // 교사 같은 요일 3과목 이상 (매뉴얼 '학년')
  | "S6" // 오전/오후 균형 (매뉴얼 '오후' — 가중치 잠정, 질문지 회수 후 확정)
  | "S7"; // 순배 (v1 미구현 — 실효 검증 후)

/** 학기 전체 감점 1건 — (scope, text, points) 규약 유지 (수집 18 점수 병기·21 3인칭 라벨) */
export interface TermPenaltyDetail {
  code: SoftPenaltyCode;
  scope: "teacher" | "class";
  /** teacherEmail 또는 "grade-classNum" */
  key: string;
  label: string;
  day: number; // 1~5
  text: string;
  points: number;
}

/** 검사기 출력 (phase9c_spec §3) — 솔버·AI·수동 편집 공통 관문 */
export interface TimetableAuditReport {
  hard: HardViolation[];
  soft: {
    total: number;
    byCode: Partial<Record<SoftPenaltyCode, number>>;
    details: TermPenaltyDetail[];
  };
  summary: {
    classes: number;
    lessons: number;
    teachers: number;
    hardByCode: Partial<Record<HardViolationCode, number>>;
    /** 등록부 미비 추정(registryGap) 제외 — 지금 조치 가능한 위반 수 (§3-4) */
    actionableHard: number;
  };
}

// ═════════════════════════════════════════════════════════════
// Phase 9c-D: 자동 작성 초안 (phase9c_d_spec §2)
// ═════════════════════════════════════════════════════════════

export interface TimetableDraftOrigin {
  kind: "solver" | "copy";
  seed?: number; // solver 전용
  ranking?: number; // 포트폴리오 내 순위 (1-based)
}

/** 솔버 미배정 항목 — SolverResult.unplaced와 동형 (저장 후 재사용) */
export interface TimetableDraftUnplaced {
  sectionId: string;
  label: string;   // "2-3반 통합과학 김○○" 형태 (솔버가 조립)
  remaining: number; // 미배정 시수
}

export interface TimetableDraftLastReport {
  hardCount: number;
  actionableHard: number;
  softTotal: number;
}

/** 초안 메타 문서 (timetable_drafts/{domain}/drafts/{id}) — §2 스펙 */
export interface TimetableDraft {
  id?: string;
  label: string;
  sourceTermId: string;
  origin: TimetableDraftOrigin;
  ops: BaseRevisionOp[]; // 조정 연산 로그 (undo/redo 재생 원본)
  opCursor: number; // 현재 그리드 = base + ops[0..opCursor)
  unplaced: TimetableDraftUnplaced[];
  lastReport?: TimetableDraftLastReport;
  /** 시수 계획으로 만든 초안의 시수 원본. 없으면 종전대로 그리드에서 역산 */
  hoursSnapshot?: HoursRequirement[];
  /** 시수 계획으로 만든 초안의 교육과정 고정 슬롯. 없으면 H6 검사 생략(종전 동작) */
  fixedBlocksSnapshot?: FixedBlock[];
  /** 출처 표시용 */
  sourcePlanId?: string;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

// ═════════════════════════════════════════════════════════════
// Phase 9c-F: NEIS 일괄 내보내기 — 매핑 등록부·사전 검증 (phase9c_f_spec)
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// 과목 이름 단일 사전 — 확정 이력 (subject_dictionary_spec §1-2)
// ═════════════════════════════════════════════════════════════

/** 관문에서 사람이 확정한 이름 쌍 1건 — 학습이 아니라 기록. 소비처는 관문 후보 랭킹뿐,
 *  런타임 판정(솔버·검사기·스탬프)은 이 문서를 절대 읽지 않는다. */
export interface SubjectNameHistoryEntry {
  alias: string; // 확정된 표기 ("과탐")
  canonicalName: string; // 그때 연결된 정식명 ("과학탐구실험2")
  shortName?: string; // 그때의 약칭 (신규 등록·신학기 시딩 기본값 재료)
  confirmedBy: string;
  confirmedAt: number;
}

/** timetable_subject_history/{domain} 단일 문서 — 학기 무관 영속 (NeisMapRegistry와 같은 패턴) */
export interface SubjectNameHistory {
  entries: SubjectNameHistoryEntry[];
  updatedAt?: number;
}

/** 과목 NEIS 등재명 매핑 1행 — neisName "" = 미확정 (동일해도 명시 저장 = 확인의 의미) */
export interface NeisSubjectMapping {
  platformName: string; // 우리 정식 과목명 (term.subjects[].name)
  neisName: string;
}

/** NEIS 매핑 등록부 — timetable_neis_map/{domain} 단일 문서, 학기 무관 영속 (spec §2).
 *  term.subjects는 가져오기마다 재생성되므로 거기에 두면 신학기마다 유실 — 별도 문서가 원칙. */
export interface NeisMapRegistry {
  subjects: NeisSubjectMapping[];
  /** "NEIS에 교원 등재 확인함" — teacherKey(이메일 소문자) 집합 */
  confirmedTeachers: string[];
  /** "NEIS에 담당 등록 확인함" — 서버 리포트가 산출한 pair key를 그대로 반송 (클라 조립 금지) */
  confirmedPairs: string[];
  updatedBy?: string;
  updatedAt?: number;
}

/** B1 — NEIS명 미확정 과목 (차단) */
export interface NeisPrecheckSubjectIssue {
  platformName: string;
  lessonCount: number;
  classCount: number;
  text: string;
}

/** W1(가상 교사 수업)·W2(교원 등재 미확인) 공용 행 */
export interface NeisPrecheckTeacherIssue {
  teacherKey: string; // W1은 "name:이름" 형식
  teacherName: string;
  lessonCount: number;
  text: string;
}

/** W3 — 담당 등록 미확인 (교사×과목) */
export interface NeisPrecheckPairIssue {
  key: string; // confirmedPairs 저장용 — 서버 산출 값 그대로 반송
  teacherKey: string;
  teacherName: string;
  platformName: string;
  neisName?: string; // 매핑 확정 시 병기
  classCount: number;
  text: string;
}

/** 사전 검증 리포트 (spec §3) — 빈칸 3원인 예방. 차단=플랫폼이 아는 것, 체크리스트=NEIS 쪽 상태(자가 확인) */
export interface NeisPrecheckReport {
  readyForExport: boolean; // B1 == 0
  blockers: {
    unmappedSubjects: NeisPrecheckSubjectIssue[]; // B1
  };
  warnings: {
    virtualLessons: NeisPrecheckTeacherIssue[]; // W1 — 창체·SLAT, NEIS 표현은 F-2 열린 질문
    unconfirmedTeachers: NeisPrecheckTeacherIssue[]; // W2
    unconfirmedPairs: NeisPrecheckPairIssue[]; // W3
  };
  summary: {
    classes: number;
    lessons: number;
    subjects: number;
    mappedSubjects: number;
    teachers: number; // 실교사만
    confirmedTeachers: number;
    pairs: number;
    confirmedPairs: number;
  };
}

/** neis_precheck 응답의 대상 표식 */
// ── 나이스 CSV 내보내기 (phase9c_f_spec F-2) ──
export interface NeisCsvFile {
  /** 학급 라벨 (1-1 등) */
  label: string;
  grade: number;
  classNum: number;
  /** BOM 포함 UTF-8 CSV 본문 */
  csv: string;
  unmapped: string[];
  multiTeacher: string[];
}

export interface NeisCsvBundle {
  files: NeisCsvFile[];
  /** 전 학급 합집합 — 화면이 한 번에 경고할 수 있도록 */
  unmappedAll: string[];
  multiTeacherAll: string[];
}

export interface NeisPrecheckTarget {
  kind: "term" | "draft";
  id: string;
  label: string;
}
