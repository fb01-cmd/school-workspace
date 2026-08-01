import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단
import { adminDb } from "../src/lib/firebase/admin";
import {
  registerWeek,
  computeDirectCandidates,
  directCommit,
  revertTimetableChange,
  timetableWeeksColRef,
  timetableChangesColRef,
  swapRequestsColRef,
} from "../src/lib/timetable/server";

async function runRehearsal() {
  const domain = "hmh.or.kr";
  const managerEmail = "admin@hmh.or.kr";
  const activeTermId = "2026-2";
  const testWeekId = "2026-12-28";

  console.log("=== [Phase 9b 일과계 화면 리허설 시작] ===");

  try {
    // 0. 기존 테스트 주 잔재 제거
    console.log("0. 사전 청소...");
    await timetableWeeksColRef(domain).doc(testWeekId).delete();
    const oldChangesSnap = await timetableChangesColRef(domain).where("weekId", "==", testWeekId).get();
    for (const d of oldChangesSnap.docs) {
      await d.ref.delete();
    }
    const oldReqSnap = await swapRequestsColRef(domain).where("weekId", "==", testWeekId).get();
    for (const d of oldReqSnap.docs) {
      await d.ref.delete();
    }

    // 1. 주 등록
    console.log("\n1. [주 등록] 테스트 주(2026-12-28) 등록 중...");
    const registeredWeek = await registerWeek(
      domain,
      {
        termId: activeTermId,
        startDate: testWeekId,
        note: "실서버 일과계 화면 리허설 테스트 주",
      },
      managerEmail
    );
    console.log(`✅ 주 등록 성공: ID=${registeredWeek.id}, startDate=${registeredWeek.startDate}`);

    // 2. 직권 배정 후보 탐색 및 직권 배정
    console.log("\n2. [직권 배정] 1학년 1반 월요일 1교시 슬롯 후보 탐색 중...");
    const sourceSlot = { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" };
    const candResult = await computeDirectCandidates(domain, testWeekId, sourceSlot);

    if (candResult.error || !("sourceTeacher" in candResult)) {
      throw new Error(`직권 후보 탐색 실패: ${candResult.error}`);
    }

    console.log(`   - 원본 수업 담당: ${candResult.sourceTeacher.teacherName} (${candResult.sourceTeacher.subjectName})`);
    const swapCands = candResult.swapCandidates || [];
    const subCands = candResult.substituteCandidates || [];
    const type: "swap" | "substitute" = swapCands.length > 0 ? "swap" : "substitute";

    // DirectSubstituteTab.tsx와 동일한 SwapCandidateSnapshot 변환
    let topCandidate;
    if (type === "swap") {
      const sc = swapCands[0];
      topCandidate = sc && {
        targetDay: sc.targetDay,
        targetPeriod: sc.targetPeriod,
        counterpartEmail: sc.counterpartEmail,
        counterpartName: sc.counterpartName,
        counterpartSubjectName: sc.counterpartSubjectName,
        score: sc.score,
        penalties: sc.penalties || [],
      };
    } else {
      const subc = subCands[0];
      topCandidate = subc && {
        counterpartEmail: subc.teacherEmail,
        counterpartName: subc.teacherName,
        score: 0,
        penalties: [] as string[],
      };
    }

    if (!topCandidate) {
      throw new Error("탐색된 배정 후보가 없습니다.");
    }

    console.log(`   - 배정 유형: ${type}`);
    console.log(`   - 탐색된 맞교환 후보 ${swapCands.length}개 / 특별보강 후보 ${subCands.length}개`);
    console.log(`   - 1순위 후보: ${topCandidate.counterpartName} (점수: ${topCandidate.score})`);

    console.log("   - 직권 배정(direct_commit) 실행 중...");
    const commitResult = await directCommit(domain, managerEmail, {
      weekId: testWeekId,
      type,
      source: {
        ...sourceSlot,
        subjectName: candResult.sourceTeacher.subjectName,
      },
      candidate: topCandidate,
      reason: { type: "기타", note: "실서버 일과계 화면 리허설 직권 배정 테스트" },
    });

    console.log(`✅ 직권 배정 성공: changeId=${commitResult.change.id}, requestId=${commitResult.request.id}`);

    // 3. revert 원복
    console.log("\n3. [revert 원복] 직권 배정 취소(revert_change) 실행 중...");
    const revertChange = await revertTimetableChange(domain, managerEmail, commitResult.change.id);
    console.log(`✅ revert 원복 성공: revertChangeId=${revertChange.id}, revertOf=${revertChange.revertOf}`);

    // Firestore에서 request 상태가 CANCELED로 갱신되었는지 확인
    const reqSnap = await swapRequestsColRef(domain).doc(commitResult.request.id).get();
    const updatedReq = reqSnap.data();
    console.log(`   - swap_request 상태 확인: status=${updatedReq?.status} (기대값: CANCELED)`);

    if (updatedReq?.status !== "CANCELED") {
      throw new Error(`revert 후 swap_request 상태가 CANCELED가 아닙니다: ${updatedReq?.status}`);
    }

    // 4. 테스트 주 및 테스트 데이터 삭제
    console.log("\n4. [테스트 주 삭제] 리허설 데이터 전삭제 중...");
    await timetableWeeksColRef(domain).doc(testWeekId).delete();
    const changesSnap = await timetableChangesColRef(domain).where("weekId", "==", testWeekId).get();
    for (const d of changesSnap.docs) {
      await d.ref.delete();
    }
    const requestsSnap = await swapRequestsColRef(domain).where("weekId", "==", testWeekId).get();
    for (const d of requestsSnap.docs) {
      await d.ref.delete();
    }

    console.log("✅ 리허설 테스트 데이터 삭제 완료 (주 2026-12-28, changes, requests)");
    console.log("\n🎉 === [Phase 9b 일과계 화면 리허설 완주 성공!] ===");
    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ 리허설 중 오류 발생:", err);
    process.exit(1);
  }
}

runRehearsal();
