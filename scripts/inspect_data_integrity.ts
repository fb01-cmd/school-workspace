/**
 * 데이터 정합성 점검 — 중간점검 잔여 3번 (읽기 전용)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_data_integrity.ts
 *
 * 배경: 중간점검 5축은 권한(②)·운영(③)·화면(④)을 봤지만 **데이터 자체가 맞는지**는
 *       어느 축도 보지 않았다. 그 사각지대를 메운다.
 *
 * 이미 다른 곳이 보는 것은 중복하지 않는다:
 *   - users ↔ GWS 대조는 lifecycle 크론의 reconcileUserDocsWithWorkspace가 매일 한다.
 *
 * 여기서 보는 것 — 아무도 안 보는 세 가지:
 *   ① teacher_profiles 에 GWS에 없는 사람이 남아 있는가 (조직도·쪽지에 유령이 뜬다)
 *   ② discipline_records 의 학생이 실재하는가 (개인정보 보존 대상이 유령이면 파기도 안 된다)
 *   ③ 시간표 그리드의 교사가 실재하는가 (9c 솔버 입력 품질 — 없는 교사에 수업이 걸려 있으면 배치 불가)
 *
 * 읽기 예산: teacher_profiles ~89 + discipline_records ~179 + classGrids ~60 + settings 1
 *            ≈ 330 읽기 (무료 일일 한도 50,000의 0.7%). GWS Directory 조회는 Firestore 아님.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { listUsersInOUs } from "../src/lib/google/workspace";

const DOMAIN = "hmh.or.kr";
const norm = (s: any) => String(s || "").trim().toLowerCase();

async function run() {
  console.log("데이터 정합성 점검 — 읽기 약 330회 예상 (한도의 0.7%)\n");

  // GWS 전 계정 (Firestore 읽기 아님)
  const gws = await listUsersInOUs(["all"]);
  const gwsByEmail = new Map<string, any>();
  for (const u of gws as any[]) gwsByEmail.set(norm(u.primaryEmail), u);
  console.log(`GWS 계정 ${gwsByEmail.size}개 조회 완료\n`);

  let issues = 0;

  // ── ① teacher_profiles 유령 ────────────────────────────
  const profs = await adminDb.collection("teacher_profiles").get();
  const ghostProfs: string[] = [];
  const suspendedProfs: string[] = [];
  for (const d of profs.docs) {
    const x: any = d.data();
    const email = norm(x.email || d.id);
    const g = gwsByEmail.get(email);
    if (!g) ghostProfs.push(email);
    else if (g.suspended) suspendedProfs.push(email);
  }
  console.log(`① 교직원 프로필 ${profs.size}건`);
  console.log(`   GWS에 없는 유령: ${ghostProfs.length}건${ghostProfs.length ? " — " + ghostProfs.join(", ") : ""}`);
  console.log(`   GWS에서 정지됨 : ${suspendedProfs.length}건${suspendedProfs.length ? " — " + suspendedProfs.join(", ") : ""}`);
  issues += ghostProfs.length;

  // ── ② discipline_records 의 학생 실재 ──────────────────
  const recs = await adminDb.collection("discipline_records").doc(DOMAIN).collection("records").get();
  const ghostStudents = new Map<string, number>();
  for (const d of recs.docs) {
    const x: any = d.data();
    const email = norm(x.studentEmail);
    if (!email) { ghostStudents.set("(이메일 없음)", (ghostStudents.get("(이메일 없음)") || 0) + 1); continue; }
    if (!gwsByEmail.has(email)) ghostStudents.set(email, (ghostStudents.get(email) || 0) + 1);
  }
  console.log(`\n② 생활지도 기록 ${recs.size}건`);
  console.log(`   계정이 없는 학생의 기록: ${[...ghostStudents.values()].reduce((a, b) => a + b, 0)}건 (학생 ${ghostStudents.size}명)`);
  for (const [e, n] of [...ghostStudents.entries()].slice(0, 8)) console.log(`     ${e} — ${n}건`);
  issues += ghostStudents.size;

  // ── ③ 시간표 그리드의 교사 실재 ────────────────────────
  const grids = await adminDb.collectionGroup("classGrids").get();
  const ghostTeachers = new Map<string, number>();
  let cellCount = 0;
  // 실제 스키마(types.ts ClassGrid → cells[].lessons[].teachers[].email).
  // ⚠️ 초판은 v.teacherEmail을 찾다가 0건이 나왔다 — 필드명을 확인하지 않아 **거짓 통과**가 날 뻔했다.
  //    "0건 발견"은 "없다"가 아니라 "못 찾았다"일 수 있다. 스키마를 먼저 본다.
  const gridsByDraft = { terms: 0, drafts: 0 };
  for (const d of grids.docs) {
    if (d.ref.path.startsWith("timetable_drafts/")) gridsByDraft.drafts++;
    else gridsByDraft.terms++;
    const x: any = d.data();
    for (const cell of (x.cells || []) as any[]) {
      for (const lesson of (cell?.lessons || []) as any[]) {
        for (const t of (lesson?.teachers || []) as any[]) {
          const e = norm(t?.email);
          if (!e) continue; // 가상 교사(창체·SLAT)는 이메일이 없다 — 정상
          cellCount++;
          if (!gwsByEmail.has(e)) ghostTeachers.set(e, (ghostTeachers.get(e) || 0) + 1);
        }
      }
    }
  }
  console.log(`\n③ 시간표 그리드 ${grids.size}건 (확정 학기 ${gridsByDraft.terms} / 초안 ${gridsByDraft.drafts}) — 교사 지정 ${cellCount}개`);
  if (cellCount === 0) console.log(`   ⚠️ 교사 지정이 0개다. 스키마가 바뀌었을 수 있으니 판정하지 말 것.`);
  console.log(`   계정이 없는 교사: ${ghostTeachers.size}명`);
  for (const [e, n] of [...ghostTeachers.entries()].slice(0, 8)) console.log(`     ${e} — ${n}칸`);
  issues += ghostTeachers.size;

  const total = profs.size + recs.size + grids.size + 1;
  console.log(`\n${"─".repeat(56)}`);
  console.log(issues === 0 ? "✅ 어긋난 데이터 없음" : `⚠️ 확인이 필요한 항목 ${issues}종`);
  console.log(`읽기 사용: ${total}회 (한도의 ${((total / 50000) * 100).toFixed(1)}%)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
