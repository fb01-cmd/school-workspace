// Phase 9a-1 데이터 교정: 교사 자동 매핑이 동명이인 학생 계정을 잡은 4건을 교직원 계정으로 교체.
// 발견 경위: 2026-08-02 순서 5 서버 실측 중 결강 교사 DM 수신자가 학번형 계정(24029@)으로 찍힘.
// GWS 디렉터리 대조: 4건 모두 OU /학생/*, 각 이름당 교직원 OU 계정이 정확히 1개 존재.
// 실행: npx tsx --env-file=.env.local scripts/migrate_fix_student_mapped_teachers.ts [--commit]
//   기본은 드라이런. --commit 시 실제 쓰기. 수정 전 문서는 백업 JSON으로 저장.
import "./_force_notify_mock";
import * as fs from "fs";
import {
  loadTimetableTerm,
  timetableTermsColRef,
  classGridsColRef,
} from "../src/lib/timetable/server";

const domain = "hmh.or.kr";
const termId = "2026-2";
const COMMIT = process.argv.includes("--commit");

// 오매핑(학생 계정) → 교정(교직원 계정). 이름은 확인용.
const FIX: Record<string, { to: string; name: string }> = {
  "24029@hmh.or.kr": { to: "xmandh57@hmh.or.kr", name: "김동현" },
  "24071@hmh.or.kr": { to: "jhkk17@hmh.or.kr", name: "김지현" },
  "24062@hmh.or.kr": { to: "eunho-1@hmh.or.kr", name: "김은호" },
  "25163@hmh.or.kr": { to: "sub613@hmh.or.kr", name: "조수빈" },
};

async function main() {
  console.log(`=== 교사 오매핑 교정 (${COMMIT ? "실제 커밋" : "드라이런"}) ===`);
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error("학기 없음");

  // 사전 검증: 교정 대상 이메일이 이미 학기 데이터에 존재하면 중단 (동명 교사 2명 의심)
  const allEmails = new Set<string>();
  for (const s of term.subjects || []) for (const e of s.teacherEmails || []) allEmails.add(e.toLowerCase());
  for (const bad of Object.keys(FIX)) {
    if (allEmails.has(FIX[bad].to)) throw new Error(`교정 대상 ${FIX[bad].to}가 이미 학기 데이터에 존재 — 수동 확인 필요`);
  }

  let subjectFixes = 0;
  const newSubjects = (term.subjects || []).map((s) => ({
    ...s,
    teacherEmails: (s.teacherEmails || []).map((e) => {
      const norm = e.trim().toLowerCase();
      if (FIX[norm]) { subjectFixes++; return FIX[norm].to; }
      return e;
    }),
  }));

  const gridsSnap = await classGridsColRef(domain, termId).get();
  let lessonFixes = 0;
  const gridUpdates: Array<{ id: string; cells: any[] }> = [];
  const backup: any = { termSubjects: term.subjects, grids: {} };

  for (const doc of gridsSnap.docs) {
    const data = doc.data();
    let touched = false;
    const cells = (data.cells || []).map((cell: any) => ({
      ...cell,
      lessons: (cell.lessons || []).map((lesson: any) => ({
        ...lesson,
        teachers: (lesson.teachers || []).map((t: any) => {
          const norm = (t.email || "").trim().toLowerCase();
          if (FIX[norm]) {
            if (t.name !== FIX[norm].name) throw new Error(`${doc.id} 교사 이름 불일치: ${t.name} vs ${FIX[norm].name}`);
            touched = true;
            lessonFixes++;
            return { ...t, email: FIX[norm].to };
          }
          return t;
        }),
      })),
    }));
    if (touched) {
      backup.grids[doc.id] = data;
      gridUpdates.push({ id: doc.id, cells });
    }
  }

  console.log(`subjects 교체: ${subjectFixes}건 / 레슨 교사 교체: ${lessonFixes}건 / 대상 학급 문서: ${gridUpdates.length}개`);
  for (const [bad, { to, name }] of Object.entries(FIX)) {
    console.log(`  - ${name}: ${bad} → ${to}`);
  }

  if (!COMMIT) {
    console.log("\n드라이런 종료 — 쓰기 없음. --commit로 실행하면 적용됩니다.");
    process.exit(0);
  }

  // 백업 저장 (git 밖 로컬)
  const backupPath = `/tmp/claude-1000/backup_teacher_mapping_fix_${termId}.json`;
  fs.mkdirSync("/tmp/claude-1000", { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\n백업 저장: ${backupPath}`);

  // 적용: term subjects + 학급 그리드
  await timetableTermsColRef(domain).doc(termId).update({ subjects: newSubjects });
  for (const g of gridUpdates) {
    await classGridsColRef(domain, termId).doc(g.id).update({ cells: g.cells });
  }
  console.log("적용 완료.");

  // 재검증: 학기 전체에서 학번형 이메일 잔존 0건 확인
  const after = await loadTimetableTerm(domain, termId);
  const badLeft: string[] = [];
  for (const s of after!.subjects || []) for (const e of s.teacherEmails || []) if (/^\d+@/.test(e)) badLeft.push(e);
  const gridsAfter = await classGridsColRef(domain, termId).get();
  let lessonCount = 0;
  let fixedSeen = 0;
  for (const doc of gridsAfter.docs) {
    for (const cell of doc.data().cells || []) {
      for (const lesson of cell.lessons || []) {
        for (const t of lesson.teachers || []) {
          lessonCount++;
          const norm = (t.email || "").trim().toLowerCase();
          if (/^\d+@/.test(norm)) badLeft.push(`${doc.id}:${norm}`);
          if (Object.values(FIX).some((f) => f.to === norm)) fixedSeen++;
        }
      }
    }
  }
  console.log(`재검증: 학번형 잔존 ${badLeft.length}건 / 교정 계정 등장 ${fixedSeen}건 (기대 ${lessonFixes}) / 전체 교사 항목 ${lessonCount}`);
  if (badLeft.length > 0 || fixedSeen !== lessonFixes) {
    console.error("❌ 재검증 실패:", badLeft.slice(0, 10));
    process.exit(1);
  }
  console.log("✅ 교정·재검증 완료.");
  process.exit(0);
}

main().catch((e) => { console.error("오류:", e); process.exit(1); });
