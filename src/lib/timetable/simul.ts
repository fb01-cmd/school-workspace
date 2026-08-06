/**
 * 동시수업(분반 이동수업) 데이터 모델 및 판정 로직
 * 스펙 문서: docs/pre_opening_3features_spec.md §A
 */

export interface SimulSlot {
  day: number; // 1=월..5=금
  period: number; // 1~7교시
}

export interface SimulGroup {
  id?: string;
  termId: string;
  label: string; // 사람용 이름 (예: "1학년 제2외국어")
  grade: number; // 1~3학년
  classNums: number[]; // 묶인 반 (예: [1, 2, 3])
  subjectNames: string[]; // 대상 과목명 (예: ["중국어Ⅰ", "일본어Ⅰ"])
  slots?: SimulSlot[]; // 선택 (지정 시 특정 교시만, 미지정 시 해당 과목 전부)
  active: boolean;
  createdBy?: string;
  createdAt?: any;
  updatedBy?: string;
  updatedAt?: any;
}

export interface SimulCheckResult {
  hit: boolean;
  groupLabel?: string;
}

/**
 * 단일 셀이 동시수업(분반) 그룹에 해당하는지 판정하는 순수 함수
 */
export function isSimulCell(
  grade: number,
  classNum: number,
  day: number,
  period: number,
  subjectName: string,
  groups: SimulGroup[]
): SimulCheckResult {
  if (!subjectName || !groups || groups.length === 0) {
    return { hit: false };
  }

  const cleanSubject = subjectName.trim().toLowerCase();

  for (const group of groups) {
    if (!group.active) continue;
    if (group.grade !== grade) continue;
    if (!group.classNums || !group.classNums.includes(classNum)) continue;

    const matchedSubject = group.subjectNames?.some(
      (s) => s.trim().toLowerCase() === cleanSubject
    );
    if (!matchedSubject) continue;

    if (group.slots && group.slots.length > 0) {
      const slotMatched = group.slots.some(
        (slot) => slot.day === day && slot.period === period
      );
      if (!slotMatched) continue;
    }

    return {
      hit: true,
      groupLabel: group.label,
    };
  }

  return { hit: false };
}

/**
 * 클라이언트에서 이동수업 그룹 목록(simul_list)을 fetch하는 헬퍼 함수
 */
export async function fetchSimulGroups(termId?: string): Promise<SimulGroup[]> {
  try {
    const res = await fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simul_list", termId }),
    });

    if (!res.ok) {
      // manage가 접근 제한될 경우 view 백업 액션 호출 시도
      const viewRes = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simul_list", termId }),
      });
      if (viewRes.ok) {
        const data = await viewRes.json();
        return data.groups || data.data || [];
      }
      return [];
    }

    const data = await res.json();
    return data.groups || data.data || [];
  } catch (err) {
    console.error("Failed to fetch simul groups:", err);
    return [];
  }
}
