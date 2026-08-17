/**
 * 임시 연결(느슨 매칭 폴백) 잔존 감사 — 폴백 제거(subject_dictionary_spec §5 2단계)의 조건 점검
 *
 * 실행: npx tsx --env-file=.env.local scripts/audit_subject_loose_binds.ts [termId ...]
 *   (인자 없으면 운영 학기 + timetable_terms의 전 비보관 학기)
 *
 * 판정: 등록부(이동수업·특별실) 과목 표기 × 그 그룹 범위의 수업 이름(그리드 lesson + 최신
 * 시수 계획 행) 쌍마다 — 사전 정확 일치가 판정 불능(null)인데 느슨 매칭이 이어붙일 쌍을
 * 센다. 이 수가 전 학기 0건이면 폴백을 제거해도 잃는 연결이 없다.
 */
import {
  loadTimetableSettings,
  loadAllTerms,
  loadTimetableTerm,
  loadAllClassGrids,
  loadSimulGroups,
  loadVenueGroups,
  listHoursPlans,
  getHoursPlan,
} from "../src/lib/timetable/server";
import { buildSubjectIndex, sameSubjectExact } from "../src/lib/timetable/subjectDict";
import { subjectMatches, subjectStemLoose } from "../src/lib/timetable/hoursAssignment";

const DOMAIN = "hmh.or.kr";

async function auditTerm(termId: string): Promise<number> {
  const [term, grids, simulGroups, venueGroups, plans] = await Promise.all([
    loadTimetableTerm(DOMAIN, termId),
    loadAllClassGrids(DOMAIN, termId).catch(() => []),
    loadSimulGroups(DOMAIN, termId),
    loadVenueGroups(DOMAIN, termId),
    listHoursPlans(DOMAIN),
  ]);
  const index = buildSubjectIndex(term?.subjects || []);
  // 그룹 범위의 수업 이름 수집: (grade, classNum) → 이름 집합
  const namesByClass = new Map<string, Set<string>>();
  const addName = (grade: number, classNum: number, name: string) => {
    if (!name) return;
    const key = `${grade}-${classNum}`;
    if (!namesByClass.has(key)) namesByClass.set(key, new Set());
    namesByClass.get(key)!.add(name.trim());
  };
  for (const g of grids)
    for (const cell of g.cells || [])
      for (const l of cell.lessons || []) addName(g.grade, g.classNum, l.subjectName);
  const targetPlans = plans.filter((p) => p.targetTermId === termId);
  for (const summary of targetPlans.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1)) {
    const plan = await getHoursPlan(DOMAIN, summary.id);
    for (const r of plan?.rows || []) addName(r.grade, r.classNum, r.subjectName);
  }
  let count = 0;
  const report = (kind: string, label: string, tag: string, name: string) => {
    count++;
    console.log(`  · [${kind} "${label}"] 표기 「${tag}」 ↔ 수업 「${name}」 — 사전 판정 불능, 느슨 매칭이 결정`);
  };
  const groups = [
    ...simulGroups.filter((g) => g.active !== false).map((g) => ({ kind: "이동수업", g })),
    ...venueGroups.filter((g) => g.active !== false).map((g) => ({ kind: "특별실", g: g as unknown as (typeof simulGroups)[number] })),
  ];
  for (const { kind, g } of groups) {
    const seen = new Set<string>();
    for (const cn of g.classNums || []) {
      for (const name of namesByClass.get(`${g.grade}-${cn}`) || []) {
        for (const tag of g.subjectNames || []) {
          const pairKey = `${tag}|${name}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          if (sameSubjectExact(index, tag, name) !== null) continue; // 사전이 판정함 (일치든 격리든)
          if (subjectMatches(tag, name) || subjectStemLoose(tag, name))
            report(kind, (g as { label?: string; roomName?: string }).label || (g as { roomName?: string }).roomName || "?", tag, name);
        }
      }
    }
  }
  console.log(`[${termId}] 임시 연결 잔존 ${count}건 (사전 ${term?.subjects?.length ?? 0}과목 · 그리드 ${grids.length}학급 · 등록부 ${groups.length}그룹)`);
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  let termIds = args;
  if (!termIds.length) {
    const settings = await loadTimetableSettings(DOMAIN);
    const all = await loadAllTerms(DOMAIN);
    termIds = [...new Set([settings.activeTermId, ...all.filter((t) => t.status !== "archived").map((t) => t.id)])].filter(
      Boolean
    ) as string[];
  }
  let total = 0;
  for (const t of termIds) total += await auditTerm(t);
  console.log(total === 0 ? "\n✅ 전 학기 0건 — 폴백 제거 조건 충족 (spec §5 2단계 착수 가능)" : `\n⏳ 총 ${total}건 — 관문 확정으로 0건을 만든 뒤 제거`);
  process.exit(0);
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
