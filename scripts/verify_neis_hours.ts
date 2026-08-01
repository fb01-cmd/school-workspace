// Phase 9b 순서 5 서버 실측: neis_list / hour_totals (실데이터 2026-2, 테스트 주 등록→전삭제)
// 실행: npx tsx --env-file=.env.local scripts/verify_neis_hours.ts
import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단
import {
  registerWeek,
  updateWeek,
  computeDirectCandidates,
  directCommit,
  revertTimetableChange,
  listNeisRows,
  computeHourTotals,
  timetableWeeksColRef,
  timetableChangesColRef,
  swapRequestsColRef,
} from "../src/lib/timetable/server";

const domain = "hmh.or.kr";
const managerEmail = "admin@hmh.or.kr";
const activeTermId = "2026-2";
const testWeekId = "2026-12-28"; // 월요일

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  await timetableWeeksColRef(domain).doc(testWeekId).delete();
  for (const col of [timetableChangesColRef(domain), swapRequestsColRef(domain)]) {
    const snap = await col.where("weekId", "==", testWeekId).get();
    for (const d of snap.docs) await d.ref.delete();
  }
}

async function main() {
  console.log("=== [neis_list / hour_totals 실측] ===");
  await cleanup(); // 사전 청소

  // 1. 테스트 주 등록 (변경 없음 기준선)
  await registerWeek(domain, { termId: activeTermId, startDate: testWeekId, note: "순서5 실측" }, managerEmail);
  const base = await computeHourTotals(domain, { termId: activeTermId, endDate: "2027-01-01" });
  console.log(`\n[1] 기준선: 주 ${base.weeksCounted}개, 교사 ${base.byTeacher.length}명, 과목 ${base.bySubject.length}개, 학급 ${base.byClass.length}개`);
  check("주 1개 집계", base.weeksCounted === 1);
  check("학급 30개 집계", base.byClass.length === 30);
  const c11 = base.byClass.find((c) => c.grade === 1 && c.classNum === 1);
  check("1-1 주간 34교시 (월~목 7·금 6)", c11?.total === 34, `실측 ${c11?.total}`);
  const sumClass = base.byClass.reduce((s, c) => s + c.total, 0);
  const sumSubject = base.bySubject.reduce((s, c) => s + c.total, 0);
  check("학급 합계 ≤ 과목 합계 (분반 셀은 과목별 중복 집계)", sumClass <= sumSubject, `${sumClass} vs ${sumSubject}`);
  check("보강 누계 전원 0", base.byTeacher.every((t) => t.substituteCount === 0));

  // 2. endDate 주 중간(수요일)까지 → 월~수만 집계
  const midweek = await computeHourTotals(domain, { termId: activeTermId, endDate: "2026-12-30" });
  const c11mid = midweek.byClass.find((c) => c.grade === 1 && c.classNum === 1);
  check("[2] endDate 수요일: 1-1 = 21교시 (7×3)", c11mid?.total === 21, `실측 ${c11mid?.total}`);

  // 3. 금요일 휴업일 지정 → 1-1 = 28
  await updateWeek(domain, testWeekId, { days: [{ day: 5, holiday: true }] }, managerEmail);
  const holi = await computeHourTotals(domain, { termId: activeTermId, endDate: "2027-01-01" });
  const c11holi = holi.byClass.find((c) => c.grade === 1 && c.classNum === 1);
  check("[3] 금 휴업: 1-1 = 28교시", c11holi?.total === 28, `실측 ${c11holi?.total}`);
  await updateWeek(domain, testWeekId, { days: [] }, managerEmail); // 원복

  // 4. 직권 맞교환 (1-1 월 1교시) → neis 2행·시수 불변
  const swapCand = await computeDirectCandidates(domain, testWeekId, {
    grade: 1, classNum: 1, day: 1, period: 1, subjectName: "",
  });
  if (swapCand.error || !("sourceTeacher" in swapCand)) throw new Error(`후보 실패: ${swapCand.error}`);
  const sc = swapCand.swapCandidates[0];
  if (!sc) throw new Error("맞교환 후보 없음");
  const swapCommit = await directCommit(domain, managerEmail, {
    weekId: testWeekId,
    type: "swap",
    source: { grade: 1, classNum: 1, day: 1, period: 1, subjectName: swapCand.sourceSubjectName },
    candidate: { ...sc },
    reason: { type: "기타", note: "순서5 실측 맞교환" },
  });
  console.log(`\n[4] 맞교환: ${swapCand.sourceTeacher.teacherName} ↔ ${sc.counterpartName} (${sc.targetDay}일 ${sc.targetPeriod}교시)`);
  let rows = await listNeisRows(domain, { startDate: testWeekId, endDate: "2027-01-01" });
  check("NEIS 행 2건 (swap 교사별)", rows.length === 2, `실측 ${rows.length}`);
  const rowA = rows.find((r) => r.teacherEmail === swapCand.sourceTeacher.teacherEmail);
  check("A 교사 행: 변경 교시 = 상대 슬롯", rowA?.day === sc.targetDay && rowA?.period === sc.targetPeriod);
  check("A 교사 행: 변경전 교시 = 월 1", rowA?.prevDay === 1 && rowA?.prevPeriod === 1);
  const expDate = new Date(Date.UTC(2026, 11, 28 + (sc.targetDay - 1))).toISOString().slice(0, 10);
  check("A 행 일자 = 상대 슬롯 요일의 실제 날짜", rowA?.date === expDate, `기대 ${expDate}, 실측 ${rowA?.date}`);
  check("A 행 변경전 일자 = 월요일(12-28)", rowA?.prevDate === "2026-12-28", `실측 ${rowA?.prevDate}`);
  const afterSwap = await computeHourTotals(domain, { termId: activeTermId, endDate: "2027-01-01" });
  const tA = (list: typeof base.byTeacher) => list.find((t) => t.email === swapCand.sourceTeacher.teacherEmail)?.total;
  const tB = (list: typeof base.byTeacher) => list.find((t) => t.email === sc.counterpartEmail)?.total;
  check("맞교환 후 두 교사 시수 불변", tA(afterSwap.byTeacher) === tA(base.byTeacher) && tB(afterSwap.byTeacher) === tB(base.byTeacher),
    `A ${tA(base.byTeacher)}→${tA(afterSwap.byTeacher)}, B ${tB(base.byTeacher)}→${tB(afterSwap.byTeacher)}`);

  // 5. 직권 특별보강 (다른 슬롯: 1-2 화 2교시) → neis +1행(비고)·시수 ±1
  const subCandRes = await computeDirectCandidates(domain, testWeekId, {
    grade: 1, classNum: 2, day: 2, period: 2, subjectName: "",
  });
  if (subCandRes.error || !("sourceTeacher" in subCandRes)) throw new Error(`보강 후보 실패: ${subCandRes.error}`);
  const sub = subCandRes.substituteCandidates[0];
  if (!sub) throw new Error("보강 후보 없음");
  await directCommit(domain, managerEmail, {
    weekId: testWeekId,
    type: "substitute",
    source: { grade: 1, classNum: 2, day: 2, period: 2, subjectName: subCandRes.sourceSubjectName },
    candidate: { counterpartEmail: sub.teacherEmail, counterpartName: sub.teacherName, score: 0, penalties: [] },
    reason: { type: "출장" },
  });
  console.log(`\n[5] 특별보강: ${subCandRes.sourceTeacher.teacherName} 결강 → ${sub.teacherName} 보강`);
  rows = await listNeisRows(domain, { startDate: testWeekId, endDate: "2027-01-01" });
  check("NEIS 행 3건 (swap 2 + substitute 1)", rows.length === 3, `실측 ${rows.length}`);
  const subRow = rows.find((r) => r.type === "substitute");
  check("보강 행 비고에 대체 교사", !!subRow && subRow.note.includes(sub.teacherName), subRow?.note);
  check("보강 행 변경전 = 동일 슬롯", subRow?.prevDay === subRow?.day && subRow?.prevPeriod === subRow?.period);
  const typeFiltered = await listNeisRows(domain, { startDate: testWeekId, endDate: "2027-01-01", type: "substitute" });
  check("type=substitute 필터 1건", typeFiltered.length === 1 && typeFiltered[0].type === "substitute");
  const afterSub = await computeHourTotals(domain, { termId: activeTermId, endDate: "2027-01-01" });
  const absentT = (list: typeof base.byTeacher) => list.find((t) => t.email === subCandRes.sourceTeacher.teacherEmail)?.total || 0;
  const subT = (list: typeof base.byTeacher) => list.find((t) => t.email === sub.teacherEmail)?.total || 0;
  check("결강 교사 시수 -1", absentT(afterSub.byTeacher) === absentT(afterSwap.byTeacher) - 1,
    `${absentT(afterSwap.byTeacher)}→${absentT(afterSub.byTeacher)}`);
  check("보강 교사 시수 +1", subT(afterSub.byTeacher) === subT(afterSwap.byTeacher) + 1,
    `${subT(afterSwap.byTeacher)}→${subT(afterSub.byTeacher)}`);
  check("보강 교사 substituteCount = 1", afterSub.byTeacher.find((t) => t.email === sub.teacherEmail)?.substituteCount === 1);

  // 6. 맞교환 revert → NEIS에서 swap 2행 소멸, substitute 잔존
  await revertTimetableChange(domain, managerEmail, swapCommit.change.id);
  rows = await listNeisRows(domain, { startDate: testWeekId, endDate: "2027-01-01" });
  check("[6] revert 후 NEIS 1건 (substitute만)", rows.length === 1 && rows[0].type === "substitute", `실측 ${rows.length}`);

  // 7. 기간 밖 조회 → 0건
  const outOfRange = await listNeisRows(domain, { startDate: "2026-09-01", endDate: "2026-09-30" });
  check("[7] 기간 밖 0건", outOfRange.length === 0, `실측 ${outOfRange.length}`);

  // 8. 입력 검증
  let threw = false;
  try { await listNeisRows(domain, { startDate: "2026-12-31", endDate: "2026-12-01" }); } catch { threw = true; }
  check("[8] start>end 거부", threw);
  threw = false;
  try { await computeHourTotals(domain, { endDate: "잘못된값" }); } catch { threw = true; }
  check("endDate 형식 오류 거부", threw);

  await cleanup();
  console.log(`\n결과: ${pass}/${pass + fail} 통과${fail ? " — 실패 있음!" : ""}. 테스트 데이터 전삭제 완료.`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("실측 중 오류:", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
