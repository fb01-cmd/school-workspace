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

export interface TimetableValidationReport {
  isValid: boolean;
  canCommit: boolean;
  overlaps: TeacherOverlapIssue[];
  cellIssues: ClassCellIssue[];
  timeMismatches: TimeCountMismatchIssue[];
  unmatchedTeachers: UnmatchedTeacherIssue[];
  summary: {
    totalClasses: number;
    totalTeachers: number;
    totalLessons: number;
    maxPeriodsPerDay: number;
  };
}

// ── API DTO (View & Manage) ──────────────────────────────────

export type ViewAction = "my" | "teacher" | "class" | "school" | "free";

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
  | "revert_change";

export interface ManageTimetableRequest {
  action: ManageAction;
  managerEmails?: string[];
  importPayload?: IntermediateImportPayload;
  termId?: string;
  // ── Phase 9b ──
  week?: WeekRegisterInput;
  weekId?: string;
  requestId?: string;
  changeId?: string;
  decisionNote?: string;
  status?: SwapRequestStatus;
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

export type ChangeType = "swap" | "substitute" | "revert";

export interface SwapChangeSlot {
  day: number;
  period: number;
  subjectName: string;
  teacherEmail: string;
  teacherName: string;
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
  revertOf?: string; // 취소 대상 changeId (역방향 기록)
  appliedBy: string;
  appliedAt: number;
}

// ── 수업교환 신청 (swap_requests) ─────────────────────────────

export type SwapRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
export type SwapRequestType = "swap" | "substitute";

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
}

// ── 주간 합성 (weekly.ts 출력) ────────────────────────────────

export interface WeeklyLessonChange {
  changeId: string;
  type: "swap" | "substitute";
  origin?: { day: number; period: number }; // "화3 ← 월2에서 이동" 출처
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

// ── 후보 탐색 엔진 (swap.ts 출력) ─────────────────────────────

export interface SwapCandidate {
  targetDay: number;
  targetPeriod: number;
  counterpartEmail: string;
  counterpartName: string;
  counterpartSubjectName: string;
  score: number; // 감점 합 (0이 최선)
  penalties: string[]; // 사람이 읽는 감점 사유
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
}

// ── 신청 라우트 DTO (/api/timetable/requests) ─────────────────

export type SwapRequestAction = "candidates" | "create" | "my_list" | "cancel";

export interface SwapRequestApiRequest {
  action: SwapRequestAction;
  weekId?: string;
  source?: Omit<SwapSourceSlot, "subjectName"> & { subjectName?: string };
  type?: SwapRequestType;
  candidate?: SwapCandidateSnapshot;
  reason?: SwapRequestReason;
  requestId?: string;
}
