/**
 * 미배정 수업을 그리드에 놓을 때 쓸 「배치 대상」 복원 (2026-08-22 신설)
 *
 * 왜 이 파일이 생겼나 — 실사고:
 *   `TimetableDraftUnplaced.label`은 **사람이 읽는 표시 문자열**인데, 화면이 그것을
 *   띄어쓰기로 잘라 `[학급, 과목, 교사]`로 되읽고 있었다. 그런데 솔버는 라벨을 네 곳
 *   전부에서 `"2-3반 통합과학"` **두 토막**으로만 만든다(`solver.ts`의 label 조립부).
 *   타입 주석만 `"2-3반 통합과학 김○○"` 세 토막이라고 적혀 있었다. 결과적으로 세 번째
 *   토막을 읽는 교사 이름이 **항상 빈 문자열**이었고, 미배정 수업을 놓으면 담당 교사가
 *   없는 수업이 그리드에 들어갔다(교사 주간표·시수 집계에서 사라진다).
 *
 * 처방 — 표시 문자열을 파싱하지 않는다:
 *   솔버는 이미 `SolverSection.lessonsByClass`에 **진짜 `TimetableLesson`**(교사 포함)을
 *   갖고 있다. 그것을 `unplaced` 항목에 그대로 실어 저장하고, 화면은 그 필드를 쓴다.
 *   라벨은 표시 전용으로 되돌아간다.
 *
 * 라벨 파싱은 **옛 초안 되돌림 경로로만** 남는다 — 이 파일 신설 이전에 저장된 초안에는
 * 구조화 필드가 없기 때문이다. 그 경로는 교사를 복원할 수 없으므로 `fromLabel: true`로
 * 표시해 호출부가 구분할 수 있게 한다.
 */

import type { TimetableDraftUnplaced, TimetableLesson } from "./types";

export interface UnplacedTarget {
  grade: number;
  classNum: number;
  lessons: TimetableLesson[];
  /**
   * 표시 문자열을 뜯어 복원했는가.
   * true = 구조화 필드가 없는 **옛 초안**이라 교사 정보가 없을 수 있다.
   */
  fromLabel: boolean;
}

/**
 * 미배정 항목 하나를 「어느 학급 어느 수업인가」로 푼다.
 *
 * @param fallback 학급을 못 알아냈을 때 쓸 값 (화면이 지금 보고 있는 학급)
 */
export function resolveUnplacedTarget(
  u: TimetableDraftUnplaced,
  fallback: { grade: number; classNum: number }
): UnplacedTarget {
  // ── 새 경로: 솔버가 실어 준 원본을 그대로 쓴다 ──
  if (
    typeof u.grade === "number" &&
    typeof u.classNum === "number" &&
    Array.isArray(u.lessons) &&
    u.lessons.length > 0
  ) {
    return { grade: u.grade, classNum: u.classNum, lessons: u.lessons, fromLabel: false };
  }

  // ── 옛 경로: 표시 문자열 복원 (교사는 대개 복원 불가) ──
  const tokens = (u.label || "").split(" ").filter(Boolean);
  const classToken = tokens[0] || "";
  const [gStr, cStr] = classToken.replace(/반$/, "").split("-");
  const g = parseInt(gStr, 10);
  const c = parseInt(cStr, 10);
  const subject = tokens[1] || "미배정과목";
  // 이름에 공백이 있을 수 있으므로 나머지를 전부 합친다 (옛 라벨이 3토막이던 시절 대비)
  const teacherName = tokens.slice(2).join(" ");

  return {
    grade: Number.isFinite(g) && g > 0 ? g : fallback.grade,
    classNum: Number.isFinite(c) && c > 0 ? c : fallback.classNum,
    lessons: [
      {
        subjectName: subject,
        subjectShort: subject,
        // 이름이 없으면 **빈 배열**이다 — 종전에는 `[{email:"", name:""}]`를 넣어
        // "이름 없는 교사가 있다"는 거짓 상태를 만들었다. 없으면 없는 것이 맞다.
        teachers: teacherName ? [{ email: "", name: teacherName }] : [],
      },
    ],
    fromLabel: true,
  };
}
