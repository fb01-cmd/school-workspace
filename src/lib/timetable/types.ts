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
}

export type ManageAction =
  | "get_settings"
  | "set_managers"
  | "set_observers"  // phase9b_spec §5 — observerEmails (열람 전용 참관자) 저장, super_admin 전용
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
  | "direct_commit"
  // ── Phase 9b 순서 5 운영 도구 (phase9b_spec §8) ──
  | "neis_list"
  | "hour_totals";

export interface ManageTimetableRequest {
  action: ManageAction;
  managerEmails?: string[];
  observerEmails?: string[]; // set_observers action 전용 (phase9b_spec §5)
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
  type?: SwapRequestType; // direct_* 및 neis_list 유형 필터 겸용
  candidate?: SwapCandidateSnapshot;
  reason?: SwapRequestReason;
  // 운영 도구 (neis_list / hour_totals) — phase9b_spec §8
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;
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
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface WeekRegisterInput {
  termId: string;
  startDate: string; // 월요일
  days?: Array<{ day: number; holiday?: boolean; periodsByGrade?: Record<string, number> }>;
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
export type SwapRequestType = "swap" | "substitute" | "cross_swap";

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
  | "draft_delete";

/** 장바구니 일괄 제출 항목 (phase9b_spec §14-2). 교차 주는 type:"swap"+targetWeekId — create와 동일 규약 */
export interface SwapBatchCreateItem {
  weekId: string;
  targetWeekId?: string;
  type: SwapRequestType;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
  reason?: SwapRequestReason; // 없으면 일괄 제출의 공통 reason 적용
  draftId?: string; // 접수 성공 시 정리할 초안 (본인 소유 검증은 서버)
}

export interface SwapBatchItemResult {
  index: number;
  ok: boolean;
  requestId?: string;
  error?: string; // 재검증 탈락 사유 — 초안 카드에 표기 (부분 성공 허용, §14-2)
  draftId?: string;
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
  requestId?: string;
  // 가상 합성 what-if (candidates — §14-1)
  includeMyPending?: boolean;
  includeDrafts?: boolean;
  // 장바구니 일괄 제출 (create_batch — §14-2)
  items?: SwapBatchCreateItem[];
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

