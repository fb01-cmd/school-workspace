/**
 * 부서가 몇 학년부인가 — **단일 원본** (docs/grade_dept_spec.md §3-2)
 *
 * ⚠️ 부서 이름에 학년 정규식을 직접 쓰지 마라. 이 함수만 쓴다.
 *    `npm run check:ui`의 검사 ④가 막는다.
 *
 * 왜 이 파일이 생겼나 (2026-08-21 사용자 발안 + 실측)
 * ─────────────────────────────────────────────────────────
 * 부서 이름은 관리자가 Workspace 환경 설정 §11에서 **자유 문자열로 입력**한다.
 * 그런데 학년부 판정이 이름 정규식이었고, 그 정규식이 **서로 달랐다**:
 *
 *   화면 (OrgChartBuilder·OrgChartTree)  /^([1-3])학년$/   ← 끝까지 일치
 *   정렬 (sort.ts)                        /^([1-3])학년/    ← 끝 고정 없음
 *
 * 그래서 부서를 「1학년부」로 개명하면 **정렬은 학년부로 보는데 화면은 아니게 되어
 * 담임 반 선택이 조용히 사라졌다.** 에러도 안 났다.
 *
 * 그리고 `[1-3]` 하드코딩 탓에 학년 수(`gradesCount`, 설정 화면에서 1~12를 받는다)를
 * 4 이상으로 올려도 4학년부는 인식되지 않았다.
 *
 * 핵심은 **재료가 이미 다 있었다는 것**이다 — 학년 수·학년별 반 수·담임 학년/반이
 * 전부 구조적 필드다. 빠져 있던 것은 「부서 ↔ 학년」 연결 하나뿐이라, 설정에 표
 * 하나를 더하는 것으로 끝난다. 프로필·보안 규칙은 건드리지 않는다(마이그레이션 0).
 */

/** 이 함수가 필요로 하는 설정 조각만 받는다 — SchoolSettings 전체를 요구하지 않는다 */
export interface GradeDeptSettings {
  /** 부서 이름 → 학년 번호. 이름을 바꿔도 연결이 따라오도록 여기에 적어 둔다 */
  gradeDepartments?: Record<string, number>;
  /** 학교 학년 수 (Workspace 환경 설정 §1) */
  gradesCount?: number;
}

/** 설정이 아예 없을 때 쓰는 학년 수. AuthContext의 폴백과 같은 값이다 */
export const DEFAULT_GRADES_COUNT = 3;

/**
 * 부서가 몇 학년부인가. **0이면 학년부가 아니다.**
 *
 * 판정 순서:
 *   1. 설정의 연결 표에 있으면 그것이 답이다 (이름을 무엇으로 바꿔도 유지된다)
 *   2. 없으면 이름에서 짐작한다 — 「N학년」으로 **시작**하면 N. 「1학년부」도 인정된다.
 *      단 N은 1..gradesCount 안이어야 한다 (「11학년」·「4학년」(3학년제)은 탈락)
 *   3. 둘 다 아니면 0
 */
export function gradeOfDepartment(
  deptName: string,
  settings?: GradeDeptSettings | null
): number {
  if (!deptName) return 0;

  // 연결 표에 **키가 있으면** 그것이 답이다 — 값이 0이어도 마찬가지다.
  // 0은 「이름이 「N학년」처럼 보여도 학년부가 아니다」를 못 박는 수단이라,
  // 여기서 폴백으로 흘리면 관리자가 아니라고 지정할 방법이 없어진다.
  const table = settings?.gradeDepartments;
  if (table && Object.prototype.hasOwnProperty.call(table, deptName)) {
    const mapped = table[deptName];
    return Number.isInteger(mapped) && mapped > 0 ? mapped : 0;
  }

  const max = Number(settings?.gradesCount) || DEFAULT_GRADES_COUNT;

  // 끝을 고정하지 않는다 — 「1학년」도 「1학년부」도 같은 답이어야 한다.
  // 그것이 이 파일이 생긴 이유다.
  const m = deptName.trim().match(/^(\d+)\s*학년/);
  if (!m) return 0;

  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : 0;
}

/** 학년부인가 — 뜻이 드러나는 이름이 필요한 자리를 위해 */
export function isGradeDepartment(
  deptName: string,
  settings?: GradeDeptSettings | null
): boolean {
  return gradeOfDepartment(deptName, settings) > 0;
}
