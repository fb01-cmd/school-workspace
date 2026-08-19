import type { TeacherProfile } from "@/context/AuthContext";

export interface SortMembersOptions<T> {
  profileMap?: Map<string, TeacherProfile>;
  getName?: (item: T, profile?: TeacherProfile) => string;
}

/**
 * 부서 내 교직원 정렬 단일 원본 함수 (스펙 §1, §6)
 *
 * 정렬 기준:
 * 1. 부서장 최상단 (deptHeadMap 우선, 단일 부서 isDeptHead 폴백)
 * 2. 학년부(1학년, 2학년, 3학년)인 경우 담임 반 번호순 (1반, 2반, 3반...)
 * 3. 나머지 비담임/일반 교원은 한글 이름 가나다순
 */
export function sortMembersForDept<T extends { email?: string }>(
  deptName: string,
  members: T[],
  options?: SortMembersOptions<T> | Map<string, TeacherProfile>
): T[] {
  const profileMap = options instanceof Map ? options : options?.profileMap;
  const customGetName = options instanceof Map ? undefined : options?.getName;

  const gradeMatch = deptName.match(/^([1-3])학년/);
  const gradeNum = gradeMatch ? Number(gradeMatch[1]) : 0;

  return [...members].sort((a, b) => {
    const emailA = (a.email || "").toLowerCase();
    const emailB = (b.email || "").toLowerCase();

    const profA: TeacherProfile | undefined =
      profileMap?.get(emailA) ??
      (("departments" in a || "deptHeadMap" in a) ? (a as unknown as TeacherProfile) : undefined);
    const profB: TeacherProfile | undefined =
      profileMap?.get(emailB) ??
      (("departments" in b || "deptHeadMap" in b) ? (b as unknown as TeacherProfile) : undefined);

    const aIsHead =
      !!profA?.deptHeadMap?.[deptName] ||
      (profA?.departments?.length === 1 && !!profA?.isDeptHead);
    const bIsHead =
      !!profB?.deptHeadMap?.[deptName] ||
      (profB?.departments?.length === 1 && !!profB?.isDeptHead);

    // 1. 부서장 우선
    if (aIsHead && !bIsHead) return -1;
    if (!aIsHead && bIsHead) return 1;

    // 2. 학년부인 경우 담임 반 번호순 (1반, 2반, 3반...)
    if (gradeNum > 0) {
      const aIsHomeroom = !!profA?.isHomeroom && Number(profA?.homeroom?.grade) === gradeNum;
      const bIsHomeroom = !!profB?.isHomeroom && Number(profB?.homeroom?.grade) === gradeNum;

      if (aIsHomeroom && !bIsHomeroom) return -1;
      if (!aIsHomeroom && bIsHomeroom) return 1;

      if (aIsHomeroom && bIsHomeroom) {
        const aClass = Number(profA?.homeroom?.class || 0);
        const bClass = Number(profB?.homeroom?.class || 0);
        if (aClass !== bClass) return aClass - bClass;
      }
    }

    // 3. 한국어 이름 가나다순
    const aName = customGetName
      ? customGetName(a, profA)
      : ("name" in a && typeof (a as any).name === "string"
          ? (a as any).name
          : (profA?.name || emailA));
    const bName = customGetName
      ? customGetName(b, profB)
      : ("name" in b && typeof (b as any).name === "string"
          ? (b as any).name
          : (profB?.name || emailB));

    return aName.localeCompare(bName, "ko");
  });
}
