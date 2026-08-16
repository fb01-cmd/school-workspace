/**
 * 이동수업 현황 보강 양식 생성기 (2026-08-17 사용자 지시)
 * — 시트 1: 빈 작성 양식(안내 포함) / 시트 2: 2026-2 완성 샘플(시스템 실증으로 자동 기입)
 * 목적: "이 다섯 정보가 적혀 있었으면 추리가 필요 없었다"를 이전·이후 비교로 보여주는 실물.
 * 원천: 이동수업 등록부 + 현행 그리드(개설 반·단독 개설 실증) + 특별실 등록부. AI 불요·읽기 전용.
 */
import {
  loadTimetableSettings, loadSimulGroups, loadVenueGroups, loadAllClassGrids,
} from "../src/lib/timetable/server";
import { subjectMatches } from "../src/lib/timetable/hoursAssignment";

// 정식 명칭 사전 — 이번 사가에서 배정표 실물로 검증된 쌍 (약칭→정식). 샘플 설명용.
const FULL: Record<string, string> = {
  중화: "중국어회화", 일화: "일본어회화", 기하: "기하", 인공Ⅱ: "인공지능기초", 인공Ⅲ: "인공지능기초",
  지구: "지구시스템과학", 세포: "세포와물질대사", 전자: "전자기와양자", 양자: "전자기와양자",
  물Ⅱ: "물리학Ⅱ", 화Ⅱ: "화학Ⅱ", 생Ⅱ: "생명과학Ⅱ", 지Ⅱ: "지구과학Ⅱ",
  중문: "중국문화", 일문: "일본문화", 수탐: "수학과제탐구", 수탐A: "수학과제탐구", 수탐B: "수학과제탐구",
  논술B: "논술", 과탐: "과학탐구실험", 물질대사: "세포와물질대사",
};

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const D = "hmh.or.kr";
  const s = await loadTimetableSettings(D);
  const termId = s.activeTermId!;
  const [groups, venues, grids] = await Promise.all([
    loadSimulGroups(D, termId), loadVenueGroups(D, termId), loadAllClassGrids(D, termId),
  ]);
  const active = groups.filter((g) => g.active !== false);

  type Row = { grade: number; name: string; short: string; host: string; band: string; kind: string; venue: string };
  const rows: Row[] = [];
  const seen = new Set<string>();
  const venueOf = (grade: number, classNum: number, subj: string) => {
    const v = venues.find((g) => g.grade === grade && g.classNums.includes(classNum) && g.subjectNames.some((n) => subjectMatches(n, subj)));
    return v ? `${v.roomName}${v.slots?.length ? ` ${v.slots.length}시간` : " 전 시수"}` : "";
  };

  // ① 이동수업: 그리드 스탬프 실증 (개설 반 = 그 수업이 앉아 있는 반)
  const movingSubjectsByGrade = new Map<number, Set<string>>();
  for (const grid of grids)
    for (const cell of grid.cells)
      for (const l of cell.lessons || []) {
        if (!l.simul) continue;
        const group = active.find((g) => g.grade === grid.grade && g.label === l.simul);
        if (!group) continue;
        const key = `${grid.grade}|${l.subjectName}|${grid.classNum}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          grade: grid.grade, name: FULL[l.subjectName] || l.subjectName, short: l.subjectName,
          host: `${grid.classNum}반`, band: group.classNums.map((c) => `${c}반`).join("·"),
          kind: "이동수업", venue: venueOf(grid.grade, grid.classNum, l.subjectName),
        });
        if (!movingSubjectsByGrade.has(grid.grade)) movingSubjectsByGrade.set(grid.grade, new Set());
        movingSubjectsByGrade.get(grid.grade)!.add(l.subjectName);
      }

  // ② 단독 개설: 이동수업으로도 존재하는 과목이 딱지 없이 앉아 있는 반 — 부재 모호성의 해답
  for (const grid of grids)
    for (const cell of grid.cells)
      for (const l of cell.lessons || []) {
        if (l.simul) continue;
        const movingSet = movingSubjectsByGrade.get(grid.grade);
        if (!movingSet || ![...movingSet].some((m) => subjectMatches(m, l.subjectName))) continue;
        const key = `${grid.grade}|${l.subjectName}|${grid.classNum}|단독`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          grade: grid.grade, name: FULL[l.subjectName] || l.subjectName, short: l.subjectName,
          host: `${grid.classNum}반`, band: "-", kind: "단독 개설", venue: venueOf(grid.grade, grid.classNum, l.subjectName),
        });
      }

  rows.sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, "ko") || a.host.localeCompare(b.host, "ko"));

  const HEADER = ["학년", "과목명(정식)", "약칭", "개설 반", "함께 이동하는 반", "구분", "특별실(시수)"];
  const GUIDE = [
    ["이동수업 현황 — 보강 작성 양식"],
    ["작성 요령: 선택·이동 과목마다 한 줄씩 적습니다. 같은 과목이 여러 반에 개설되면 반마다 한 줄입니다."],
    ["구분: '이동수업' = 여러 반이 함께 움직이는 수업 / '단독 개설' = 이동 없이 그 반만 듣는 수업."],
    ["'단독 개설'도 반드시 적어 주세요 — 적혀 있지 않은 반의 배정은 오기재로 판정됩니다."],
    [],
    HEADER,
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(GUIDE), "작성 양식");
  const sample = [
    [`2026학년도 2학기 완성 샘플 — 시스템(시간표·등록부) 실증으로 자동 기입 (${rows.length}행)`],
    ["기존 파일과 비교: 개설 반·단독 개설·정식 명칭·전 학년·특별실이 이렇게 명시돼 있었어야 합니다."],
    [],
    HEADER,
    ...rows.map((r) => [r.grade, r.name, r.short, r.host, r.band, r.kind, r.venue]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample), "2026-2 완성 샘플");
  const out = "docs/이동수업_현황_보강양식_2026-2샘플.xlsx";
  XLSX.writeFile(wb, out);
  console.log(`생성: ${out} — 샘플 ${rows.length}행 (이동수업 ${rows.filter((r) => r.kind === "이동수업").length} · 단독 개설 ${rows.filter((r) => r.kind === "단독 개설").length})`);
  for (const r of rows.slice(0, 8)) console.log(`  ${r.grade}학년 ${r.name}(${r.short}) 개설 ${r.host} | 밴드 ${r.band} | ${r.kind}${r.venue ? ` | ${r.venue}` : ""}`);
  process.exit(0);
})();
