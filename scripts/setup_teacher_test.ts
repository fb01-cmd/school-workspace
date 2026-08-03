// 일반 교사 시점 테스트 세팅: 실교사 1명의 이메일을 테스트 계정으로 임시 교체 + 파일럿 명단 등록.
// (2026-08-04, 8/2 오매핑 교정 스크립트와 동일 패턴 — 백업→교체→재검증. DM 발송 코드 경로 없음)
//
// 사용법:
//   드라이런:  npx tsx --env-file=.env.local scripts/setup_teacher_test.ts map <실교사이메일> <테스트이메일>
//   적용:      ... map <실교사이메일> <테스트이메일> --commit
//   원복:      ... revert <실교사이메일> <테스트이메일> --commit
// map    = 학기 데이터의 실교사 이메일 → 테스트 이메일 교체, teacherPilotEmails에 테스트 계정 추가
// revert = 반대로 되돌리고 파일럿 명단에서 제거
import * as fs from "fs";
import { google } from "googleapis";
import {
  loadTimetableTerm,
  loadTimetableSettings,
  saveTimetableSettings,
  timetableTermsColRef,
  classGridsColRef,
} from "../src/lib/timetable/server";

const domain = "hmh.or.kr";
const termId = "2026-2";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const [mode, realEmailArg, testEmailArg] = process.argv.slice(2);
const COMMIT = process.argv.includes("--commit");

async function replaceEmail(from: string, to: string) {
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error("학기 없음");

  let subjectHits = 0;
  const newSubjects = (term.subjects || []).map((s) => ({
    ...s,
    teacherEmails: (s.teacherEmails || []).map((e) => {
      if (e.trim().toLowerCase() === from) { subjectHits++; return to; }
      return e;
    }),
  }));

  const gridsSnap = await classGridsColRef(domain, termId).get();
  let lessonHits = 0;
  const backup: any = { termSubjects: term.subjects, grids: {} };
  const gridUpdates: Array<{ id: string; cells: any[] }> = [];
  for (const doc of gridsSnap.docs) {
    const data = doc.data();
    let touched = false;
    const cells = (data.cells || []).map((cell: any) => ({
      ...cell,
      lessons: (cell.lessons || []).map((lesson: any) => ({
        ...lesson,
        teachers: (lesson.teachers || []).map((t: any) => {
          if ((t.email || "").trim().toLowerCase() === from) {
            touched = true;
            lessonHits++;
            return { ...t, email: to };
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

  console.log(`교체 대상: subjects ${subjectHits}건 / 레슨 ${lessonHits}건 / 학급 문서 ${gridUpdates.length}개 (${from} → ${to})`);
  if (subjectHits + lessonHits === 0) throw new Error(`학기 데이터에 ${from} 이 없습니다 — 이메일을 확인하세요.`);

  if (!COMMIT) {
    console.log("드라이런 종료 — 쓰기 없음. --commit 로 적용.");
    return false;
  }

  const backupPath = `/tmp/claude-1000/backup_teacher_test_swap_${Date.now()}.json`;
  fs.mkdirSync("/tmp/claude-1000", { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ from, to, ...backup }, null, 2));
  console.log(`백업: ${backupPath}`);

  await timetableTermsColRef(domain).doc(termId).update({ subjects: newSubjects });
  for (const g of gridUpdates) {
    await classGridsColRef(domain, termId).doc(g.id).update({ cells: g.cells });
  }

  // 재검증: from 잔존 0건, to 등장 수 = 교체 수
  const after = await loadTimetableTerm(domain, termId);
  let fromLeft = 0, toSeen = 0;
  for (const s of after!.subjects || []) for (const e of s.teacherEmails || []) {
    if (e.toLowerCase() === from) fromLeft++;
    if (e.toLowerCase() === to) toSeen++;
  }
  const gridsAfter = await classGridsColRef(domain, termId).get();
  for (const doc of gridsAfter.docs) {
    for (const cell of doc.data().cells || []) for (const lesson of cell.lessons || []) for (const t of lesson.teachers || []) {
      const e = (t.email || "").toLowerCase();
      if (e === from) fromLeft++;
      if (e === to) toSeen++;
    }
  }
  console.log(`재검증: ${from} 잔존 ${fromLeft}건(기대 0) / ${to} 등장 ${toSeen}건(기대 ${subjectHits + lessonHits})`);
  if (fromLeft !== 0 || toSeen !== subjectHits + lessonHits) throw new Error("재검증 실패 — 백업으로 수동 확인 필요");
  return true;
}

async function main() {
  if (!["map", "revert"].includes(mode) || !EMAIL_RE.test(realEmailArg || "") || !EMAIL_RE.test(testEmailArg || "")) {
    console.log("사용법: setup_teacher_test.ts <map|revert> <실교사이메일> <테스트이메일> [--commit]");
    process.exit(1);
  }
  const realEmail = realEmailArg.toLowerCase();
  const testEmail = testEmailArg.toLowerCase();
  if (/^\d+@/.test(testEmail)) throw new Error("테스트 계정이 학번형입니다 — 교직원 OU 계정을 쓰세요.");

  // 테스트 계정 실존·OU 확인 (읽기 전용)
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  const admin = google.admin({ version: "directory_v1", auth });
  const u = (await admin.users.get({ userKey: testEmail })).data;
  console.log(`테스트 계정 확인: ${u.name?.fullName} | OU ${u.orgUnitPath}${u.suspended ? " | ⚠️ 정지됨" : ""}`);
  if (String(u.orgUnitPath || "").startsWith("/학생")) throw new Error("테스트 계정이 학생 OU입니다 — 중단.");

  if (mode === "map") {
    const applied = await replaceEmail(realEmail, testEmail);
    if (applied) {
      const settings = await loadTimetableSettings(domain);
      const pilot = new Set(settings.teacherPilotEmails || []);
      pilot.add(testEmail);
      await saveTimetableSettings(domain, { teacherPilotEmails: Array.from(pilot) });
      console.log(`파일럿 명단 등록: [${Array.from(pilot).join(", ")}]`);
      console.log("\n✅ 세팅 완료 — 테스트 계정으로 로그인해 '내 시간표'에서 테스트하세요. 승인 버튼은 누르지 말 것(실교사 DM).");
    }
  } else {
    const applied = await replaceEmail(testEmail, realEmail);
    if (applied) {
      const settings = await loadTimetableSettings(domain);
      const pilot = (settings.teacherPilotEmails || []).filter((e) => e !== testEmail);
      await saveTimetableSettings(domain, { teacherPilotEmails: pilot });
      console.log(`파일럿 명단 제거 후: [${pilot.join(", ")}]`);
      console.log("\n✅ 원복 완료.");
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("오류:", e.message || e); process.exit(1); });
