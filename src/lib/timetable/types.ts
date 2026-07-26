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
}

export interface ViewTimetableResponse {
  term: {
    id: string;
    name: string;
    status: TermStatus;
  } | null;
  action: ViewAction;
  data: ClassGrid | ClassGrid[] | TeacherTimetable | FreeTeacher[] | null;
}

export type ManageAction =
  | "get_settings"
  | "set_managers"
  | "import_validate"
  | "import_commit"
  | "activate_term"
  | "delete_term";

export interface ManageTimetableRequest {
  action: ManageAction;
  managerEmails?: string[];
  importPayload?: IntermediateImportPayload;
  termId?: string;
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
