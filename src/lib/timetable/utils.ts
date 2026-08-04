/**
 * Phase 9b: 시간표 UI 및 날짜/슬롯 포맷터 공용 유틸 모듈
 */

export const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

/** weekStartDate(월요일 YYYY-MM-DD)와 요일 index(1~5)로 "8/13" 문자열 생성 */
export function getDayDateLabel(weekStartDate: string, day: number): string {
  if (!weekStartDate) return "";
  const parts = weekStartDate.split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0])) return "";
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + (day - 1));
  const m = d.getMonth() + 1;
  const dayNum = d.getDate();
  return `${m}/${dayNum}`;
}

/** weekStartDate(월요일 YYYY-MM-DD)로 "8/10(월)~8/14(금)" 문자열 생성 */
export function getWeekRangeLabel(weekStartDate: string): string {
  if (!weekStartDate) return "";
  const startMD = getDayDateLabel(weekStartDate, 1);
  const endMD = getDayDateLabel(weekStartDate, 5);
  return `${startMD}(월)~${endMD}(금)`;
}

/** weekId(월요일 YYYY-MM-DD), day(1~5), period(1~) 로 "8/13(목) 2교시" 형식 문자열 생성 */
export function formatSlotWithDate(weekId?: string, day?: number, period?: number): string {
  if (!day || !period) return "";
  const dayStr = DAY_LABEL[day] || `${day}`;
  if (!weekId) return `${dayStr}요일 ${period}교시`;

  const parts = weekId.split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0])) return `${dayStr}요일 ${period}교시`;

  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  dateObj.setDate(dateObj.getDate() + (day - 1));
  const m = dateObj.getMonth() + 1;
  const d = dateObj.getDate();

  return `${m}/${d}(${dayStr}) ${period}교시`;
}

/**
 * 사전 양해 요청 메시지 텍스트 생성 (13-1 공유 카드 텍스트 & 13-2 DM 본문 재사용)
 */
export function buildShareCardMessage(params: {
  requesterName: string;
  sourceWeekId: string;
  source: { day: number; period: number; grade: number; classNum: number; subjectName: string };
  targetWeekId?: string;
  candidate: {
    targetDay?: number;
    targetPeriod?: number;
    counterpartName?: string;
    counterpartSubjectName?: string;
  };
}): string {
  const sourceSlotStr = formatSlotWithDate(params.sourceWeekId, params.source.day, params.source.period);
  const targetWeek = params.targetWeekId || params.sourceWeekId;
  const targetSlotStr = formatSlotWithDate(targetWeek, params.candidate.targetDay, params.candidate.targetPeriod);

  const counterpartTitle = params.candidate.counterpartName
    ? `${params.candidate.counterpartName} 선생님`
    : "선생님";

  const counterpartLessonName = params.candidate.counterpartSubjectName
    ? `${params.source.grade}-${params.source.classNum}반 ${params.candidate.counterpartSubjectName}`
    : "수업";

  return `[수업교환 양해 요청]
안녕하세요, ${counterpartTitle}! 👋
${params.requesterName} 교사입니다. 이렇게 수업 교체가 가능할까요? 😊

• 선생님 수업: ${counterpartLessonName} (${targetSlotStr} → ${sourceSlotStr}로 이동)
• 제 수업: ${params.source.grade}-${params.source.classNum}반 ${params.source.subjectName} (${sourceSlotStr} → ${targetSlotStr}로 이동)

확인 부탁드립니다. 감사합니다!`;
}
