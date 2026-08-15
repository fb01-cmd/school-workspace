import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단
import { adminDb } from "../src/lib/firebase/admin";
import {
  registerWeek,
  computeCandidates,
  computeDirectCandidates,
  directCommit,
  revertTimetableChange,
  synthesizeWeek,
  listNeisRows,
  computeHourTotals,
  loadWeek,
  timetableWeeksColRef,
  timetableChangesColRef,
  swapRequestsColRef,
} from "../src/lib/timetable/server";
import { TimetableChange } from "../src/lib/timetable/types";

/**
 * Phase 9b §4-3b 교차 주(cross-week) 맞교환 실서버 리허설.
 * 실측 항목: 후보 엔진(양주 공강) → 직권 커밋(문서쌍+exchangeId) → 양주 합성 반영
 *           → NEIS 목록(변경전 교시=상대 주 날짜) → 시수 집계 무해 통과
 *           → exchangeId 단위 revert(양쪽 동시) → 이중 revert 차단 → 청소.
 * 테스트 주는 원격 미래(2026-12-21·12-28)라 파일럿 주(2026-08-10)와 무관.
 */
async function run() {
  const domain = "hmh.or.kr";
  const managerEmail = "admin@hmh.or.kr";
  const termId = "2026-2";
  const weekA = "2026-12-21"; // 소스 주 (월요일)
  const weekB = "2026-12-28"; // 대상 주 (월요일)
  const source = { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" };

  const assert = (cond: unknown, label: string) => {
    if (!cond) throw new Error(`검증 실패: ${label}`);
    console.log(`   ✅ ${label}`);
  };

  const cleanup = async () => {
    for (const weekId of [weekA, weekB]) {
      await timetableWeeksColRef(domain).doc(weekId).delete();
      for (const col of [timetableChangesColRef(domain), swapRequestsColRef(domain)]) {
        const snap = await col.where("weekId", "==", weekId).get();
        for (const d of snap.docs) await d.ref.delete();
      }
    }
  };

  console.log("=== [Phase 9b §4-3b 교차 주 맞교환 리허설 시작] ===");
  try {
    console.log("\n0. 사전 청소...");
    await cleanup();

    console.log("\n1. [주 등록] 소스 주·대상 주 등록");
    await registerWeek(domain, { termId, startDate: weekA, note: "교차 주 리허설 소스 주" }, managerEmail);
    await registerWeek(domain, { termId, startDate: weekB, note: "교차 주 리허설 대상 주" }, managerEmail);
    console.log(`   ✅ ${weekA} / ${weekB} 등록 완료`);

    console.log("\n2. [음성 케이스] 미등록 대상 주 지정 시 거부");
    let threw = false;
    try {
      await computeDirectCandidates(domain, weekA, source, "2027-03-01");
    } catch (e: any) {
      threw = true;
      console.log(`   (거부 메시지: ${e.message})`);
    }
    assert(threw, "미등록 대상 주는 후보 탐색 자체가 거부됨");

    console.log("\n3. [교차 주 후보 탐색] 1-1 월 1교시 ↔ 대상 주 전 슬롯");
    const cand = await computeDirectCandidates(domain, weekA, source, weekB);
    if (cand.error || !("sourceTeacher" in cand)) throw new Error(`후보 탐색 실패: ${cand.error}`);
    assert((cand as any).targetWeekId === weekB, "응답에 targetWeekId 포함");
    assert(cand.substituteCandidates.length === 0, "교차 주에는 특별보강 후보 없음");
    assert(cand.swapCandidates.length > 0, `맞교환 후보 존재 (${cand.swapCandidates.length}건)`);
    const top = cand.swapCandidates[0];
    console.log(
      `   - 원본: ${cand.sourceTeacher.teacherName} ${cand.sourceTeacher.subjectName} / ` +
      `1순위: ${top.counterpartName} ${top.counterpartSubjectName} (대상 주 ${top.targetDay}요일 ${top.targetPeriod}교시, 감점 ${top.score})`
    );
    if (top.penalties.length) console.log(`   - 감점 사유: ${top.penalties.join(" · ")}`);

    // 커밋 전 기준 상태 저장 (원복 검증용)
    const wA = (await loadWeek(domain, weekA))!;
    const wB = (await loadWeek(domain, weekB))!;
    const cellOf = (grids: any[], day: number, period: number) =>
      grids.find((g) => g.grade === 1 && g.classNum === 1)
        ?.cells.find((c: any) => c.day === day && c.period === period);
    const baseA = cellOf((await synthesizeWeek(domain, wA)).grids, source.day, source.period);
    const baseB = cellOf((await synthesizeWeek(domain, wB)).grids, top.targetDay, top.targetPeriod);
    const baseATeacher = baseA.lessons[0].teachers[0].email;
    const baseBTeacher = baseB.lessons[0].teachers[0].email;

    console.log("\n4. [직권 커밋] 교차 주 맞교환 확정 (문서쌍 생성)");
    const commit = await directCommit(domain, managerEmail, {
      weekId: weekA,
      type: "swap",
      source: { ...source, subjectName: cand.sourceTeacher.subjectName },
      candidate: {
        targetDay: top.targetDay,
        targetPeriod: top.targetPeriod,
        counterpartEmail: top.counterpartEmail,
        counterpartName: top.counterpartName,
        counterpartSubjectName: top.counterpartSubjectName,
        score: top.score,
        penalties: top.penalties,
      },
      reason: { type: "기타", note: "교차 주 맞교환 실서버 리허설" },
      targetWeekId: weekB,
    });
    assert(commit.request.targetWeekId === weekB, "신청 문서에 targetWeekId 기록");
    assert(commit.request.candidate.targetWeekId === weekB, "후보 스냅샷에 targetWeekId 포함");
    assert(commit.request.appliedChangeIds?.length === 2, "appliedChangeIds = 문서 2개");

    const [idA, idB] = commit.request.appliedChangeIds!;
    const docA = (await timetableChangesColRef(domain).doc(idA).get()).data() as TimetableChange;
    const docB = (await timetableChangesColRef(domain).doc(idB).get()).data() as TimetableChange;
    assert(docA.type === "cross_swap" && docB.type === "cross_swap", "두 문서 모두 cross_swap");
    assert(docA.weekId === weekA && docB.weekId === weekB, "문서가 각 주에 1개씩");
    assert(
      docA.crossSwap!.exchangeId === docB.crossSwap!.exchangeId,
      `공통 exchangeId 연결 (${docA.crossSwap!.exchangeId})`
    );
    assert(
      docA.crossSwap!.otherWeekId === weekB && docB.crossSwap!.otherWeekId === weekA,
      "otherWeekId 상호 참조"
    );
    assert(
      // 교차 주 '맞교환'은 양쪽 수업이 모두 있다 (한쪽만 있는 §5c-8 통 이동과 구별)
      docA.crossSwap!.out?.teacherEmail === docB.crossSwap!.in?.teacherEmail &&
      docA.crossSwap!.in?.teacherEmail === docB.crossSwap!.out?.teacherEmail,
      "out/in 수업이 거울상"
    );

    console.log("\n5. [양주 합성 검증] 두 주 모두에 치환 반영");
    const synA = await synthesizeWeek(domain, wA);
    const synB = await synthesizeWeek(domain, wB);
    assert(synA.integrityWarnings.length === 0 && synB.integrityWarnings.length === 0, "integrityWarnings 없음");
    const afterA = cellOf(synA.grids, source.day, source.period);
    const afterB = cellOf(synB.grids, top.targetDay!, top.targetPeriod!);
    assert(afterA.lessons[0].teachers[0].email === baseBTeacher, "소스 주 셀 → 상대 수업으로 치환");
    assert(afterB.lessons[0].teachers[0].email === baseATeacher, "대상 주 셀 → 내 수업으로 치환");
    assert(
      afterA.lessons[0].changed?.type === "cross_swap" && afterA.lessons[0].changed?.otherWeekId === weekB,
      "변경 마킹 changed{type:cross_swap, otherWeekId}"
    );

    console.log("\n6. [NEIS 목록] 변경전 교시 = 상대 주 날짜");
    const rows = await listNeisRows(domain, { termId, startDate: weekA, endDate: "2027-01-03" });
    const crossRows = rows.filter((r) => r.type === "cross_swap");
    assert(crossRows.length === 2, `cross_swap 2행 (${crossRows.length}행)`);
    const rowA = crossRows.find((r) => r.weekId === weekA)!;
    const rowB = crossRows.find((r) => r.weekId === weekB)!;
    assert(rowA.prevDate >= weekB && rowB.prevDate >= weekA && rowB.prevDate < weekB,
      `prevDate가 상대 주 날짜 (A행: ${rowA.date}←${rowA.prevDate} / B행: ${rowB.date}←${rowB.prevDate})`);

    console.log("\n7. [시수 집계] cross_swap 문서가 있어도 집계 무해 통과");
    const totals = await computeHourTotals(domain, { termId, endDate: "2027-01-03" });
    assert(totals.byTeacher.length > 0, `집계 정상 (주 ${totals.weeksCounted}개)`);

    console.log("\n8. [revert] exchangeId 단위 — 한쪽 changeId로 양쪽 동시 취소");
    const revert = await revertTimetableChange(domain, managerEmail, idA);
    assert(revert.revertOf === idA, "revert 문서 생성");
    const revA = await timetableChangesColRef(domain).where("revertOf", "==", idA).get();
    const revB = await timetableChangesColRef(domain).where("revertOf", "==", idB).get();
    assert(revA.size === 1 && revB.size === 1, "두 문서 모두에 역기록 (단일 트랜잭션)");
    const reqAfter = (await swapRequestsColRef(domain).doc(commit.request.id).get()).data();
    assert(reqAfter?.status === "CANCELED", "신청 상태 CANCELED 전이");

    const synA2 = await synthesizeWeek(domain, wA);
    const synB2 = await synthesizeWeek(domain, wB);
    assert(
      cellOf(synA2.grids, source.day, source.period).lessons[0].teachers[0].email === baseATeacher &&
      cellOf(synB2.grids, top.targetDay!, top.targetPeriod!).lessons[0].teachers[0].email === baseBTeacher,
      "양주 모두 원상 복구"
    );
    assert(
      synA2.integrityWarnings.length === 0 && synB2.integrityWarnings.length === 0,
      "복구 후에도 integrityWarnings 없음"
    );

    console.log("\n9. [이중 revert 차단] 나머지 문서(idB)로 재취소 시도");
    let threw2 = false;
    try {
      await revertTimetableChange(domain, managerEmail, idB);
    } catch (e: any) {
      threw2 = true;
      console.log(`   (거부 메시지: ${e.message})`);
    }
    assert(threw2, "이미 취소된 교환의 재취소 거부");

    console.log("\n10. [같은-주 회귀 확인] targetWeekId 없이 기존 경로 정상");
    const sameWeek = await computeCandidates(
      domain, baseATeacher, weekA, source
    );
    assert(!sameWeek.error && sameWeek.swapCandidates.length >= 0 && !("targetWeekId" in sameWeek && sameWeek.targetWeekId),
      `같은-주 후보 탐색 회귀 정상 (맞교환 ${sameWeek.swapCandidates.length}건·보강 ${sameWeek.substituteCandidates.length}건)`);

    console.log("\n11. 테스트 데이터 청소...");
    await cleanup();
    console.log("   ✅ 청소 완료");

    console.log("\n=== 리허설 전 항목 통과 ✅ ===");
  } catch (e: any) {
    console.error(`\n❌ 리허설 실패: ${e.message}`);
    console.error(e.stack);
    console.log("\n(실패 시에도 테스트 데이터 청소 시도...)");
    try {
      await cleanup();
      console.log("청소 완료");
    } catch (ce: any) {
      console.error(`청소 실패 — 수동 정리 필요 (주 ${weekA}·${weekB}): ${ce.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

run();
