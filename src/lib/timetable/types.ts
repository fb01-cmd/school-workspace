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

export type ViewAction = "my" | "teacher" | "class" | "school" | "free" | "teachers";

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
  data: ClassGrid | ClassGrid[] | TeacherTimetable | FreeTeacher[] | null;
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
  | "revision_delete";

export interface ManageTimetableRequest {
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
  // 학사일정 (pre_opening_3features_spec §B)
  calendarEvent?: Partial<TimetableCalendarEvent>; // calendar_save 본문
  calendarEventId?: string; // calendar_save(수정)·calendar_delete 대상
  // 기초시간표 개정 (pre_opening_3features_spec §E)
  revisionId?: string; // revision_save_draft(기존 draft)·revision_apply·revision_delete 대상
  revisionOps?: BaseRevisionOp[]; // revision_save_draft 본문 (전체 교체)
  revisionNote?: string; // revision_save_draft 메모
  effectiveFrom?: string; // revision_apply — 적용 시작 주 월요일 (기본: 다음 주 월요일)
}

export interface ManageTimetableResponse {
  success: boolean;
  action: ManageAction;
  message?: string;
  settings?: TimetableSettings;
  validationReport?: TimetableValidationReport;
  terms?: TimetableTerm[];
  term?: TimetableTerm | null;
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

export type ChangeType = "swap" | "substitute" | "cross_swap" | "revert";

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
  out: CrossSwapLessonRef; // 이 슬롯에서 빠지는 수업
  in: CrossSwapLessonRef; // 상대 주에서 넘어와 대신 들어오는 수업
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
  revertOf?: string; // 취소 대상 changeId (역방향 기록)
  appliedBy: string;
  appliedAt: number;
}

// ── 수업교환 신청 (swap_requests) ─────────────────────────────

export type SwapRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
// "chain" = 교사 징검다리 체인 신청 (consent_swap_opening_spec §4-3) — 승인 시 단계별 swap/cross_swap change로 전개
export type SwapRequestType = "swap" | "substitute" | "cross_swap" | "chain";

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
 * 조율 필요 후보의 충돌 명세 (consent_swap_opening_spec §2-2).
 * 1차는 특별실(venue)만 — 다른 하드 제외의 조율 후보화는 실수요 신호 후.
 */
export interface CandidateCoordination {
  kind: "venue";
  conflicts: Array<{
    roomName: string; // 겹치는 특별실 (예: "탁구장")
    slot: { weekId: string; day: number; period: number }; // 충돌이 나는 슬롯
    occupants: CoordinationOccupant[];
  }>;
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
}

/** 신청 body의 양해 입력 — confirmed 체크와 메모만 받는다 (당사자 명단은 서버 도출) */
export interface SwapConsentInput {
  confirmed?: boolean;
  note?: string;
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
  createdAt: number;
  updatedAt: number;
  conditional?: boolean; // 조건부 후보 여부 (2026-08-05)
}

// ── 주간 합성 (weekly.ts 출력) ────────────────────────────────

export interface WeeklyLessonChange {
  changeId: string;
  type: "swap" | "substitute" | "cross_swap";
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
  type: "swap" | "substitute" | "cross_swap";
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
  | "chain_create"; // 체인 신청 생성 — 서버 재탐색 대조 + consent 필수 (§4-3)

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
  // 임시저장 (draft_save / draft_delete)
  draftId?: string;
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

