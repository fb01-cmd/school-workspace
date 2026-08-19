/**
 * 업무 지시 순수 로직 셀프테스트 (phase8_tasks_spec §10) — 네트워크·Firestore 0회
 * 실행: npx tsx scripts/tasks_selftest.ts
 */
import {
  applyTaskTransition,
  buildSelfTaskDoc,
  canNudge,
  isDueTomorrowKST,
  isOrphanDraft,
  normalizeSubmissionFileName,
  nudgeTargets,
  validateTaskContent,
  validateTaskFileName,
  validateTaskFileSize,
  TASK_DRAFT_ORPHAN_MS,
  TASK_NUDGE_INTERVAL_MS,
  TASK_SERVER_UPLOAD_MAX_BYTES,
} from "../src/lib/tasks/logic";

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const pass = g === w;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n   got:  ${g}\n   want: ${w}`}`);
};

const NOW = 1_760_000_000_000;
const baseTask = (kind: "confirm" | "submit", statuses: any = {}) => ({
  kind,
  statuses,
  recipientEmails: ["a@hmh.or.kr", "b@hmh.or.kr"],
  canceledAt: undefined,
});

// ── ① 상태 전이 전 조합 (§3) ──
check("① 수락", applyTaskTransition(baseTask("confirm"), "a@hmh.or.kr", "accept", undefined, NOW), {
  ok: true, next: { state: "ACCEPTED", at: NOW },
});
check("① 중복 수락 거부", applyTaskTransition(baseTask("confirm", { "a@hmh.or.kr": { state: "ACCEPTED", at: 1 } }), "a@hmh.or.kr", "accept", undefined, NOW).ok, false);
check("① 거절 사유 없으면 거부", applyTaskTransition(baseTask("confirm"), "a@hmh.or.kr", "decline", "  ", NOW).ok, false);
check("① 거절 사유 있으면 통과", applyTaskTransition(baseTask("confirm"), "a@hmh.or.kr", "decline", "출장 기간과 겹칩니다", NOW), {
  ok: true, next: { state: "DECLINED", at: NOW, note: "출장 기간과 겹칩니다" },
});
check("① 거절 후 재수락 허용", applyTaskTransition(baseTask("confirm", { "a@hmh.or.kr": { state: "DECLINED", at: 1, note: "x" } }), "a@hmh.or.kr", "accept", undefined, NOW).ok, true);
check("① 확인형 완료", applyTaskTransition(baseTask("confirm", { "a@hmh.or.kr": { state: "ACCEPTED", at: 1 } }), "a@hmh.or.kr", "done", undefined, NOW), {
  ok: true, next: { state: "DONE", at: NOW },
});
check("① 제출형은 done 액션 거부", applyTaskTransition(baseTask("submit"), "a@hmh.or.kr", "done", undefined, NOW).ok, false);
check("① 완료 취소 → 수락 상태로", applyTaskTransition(baseTask("confirm", { "a@hmh.or.kr": { state: "DONE", at: 1 } }), "a@hmh.or.kr", "undone", undefined, NOW), {
  ok: true, next: { state: "ACCEPTED", at: NOW },
});
check("① 대상 아님 거부", applyTaskTransition(baseTask("confirm"), "x@hmh.or.kr", "accept", undefined, NOW).ok, false);
check("① 철회된 업무 거부", applyTaskTransition({ ...baseTask("confirm"), canceledAt: 1 } as any, "a@hmh.or.kr", "accept", undefined, NOW).ok, false);
check("① 완료 후 거절 불가", applyTaskTransition(baseTask("confirm", { "a@hmh.or.kr": { state: "DONE", at: 1 } }), "a@hmh.or.kr", "decline", "사유", NOW).ok, false);

// ── ② 파일명 정규화 3갈래 (§5-3) ──
check("② 담임", normalizeSubmissionFileName({
  taskTitle: "현장체험 동의서", submitterName: "홍길동",
  homeroom: { grade: 2, class: 3 }, departments: ["1학년부"], originalName: "제출본 최종.hwp",
}), "2학년3반_홍길동_현장체험 동의서.hwp");
check("② 부서(담임 아님)", normalizeSubmissionFileName({
  taskTitle: "연수 신청", submitterName: "김교사", homeroom: null, departments: ["교무기획부"], originalName: "a.XLSX",
}), "교무기획부_김교사_연수 신청.xlsx");
check("② 소속 없음 생략", normalizeSubmissionFileName({
  taskTitle: "설문", submitterName: "박교사", homeroom: null, departments: [], originalName: "x.pdf",
}), "박교사_설문.pdf");
check("② 금지 문자 정리", normalizeSubmissionFileName({
  taskTitle: 'a/b:c*d?"<>|', submitterName: "이/름", homeroom: null, departments: null, originalName: "f.zip",
}), "이_름_a_b_c_d_____.zip");

// ── ③ 기한 임박 KST 경계 (§6) ──
// 2026-08-19 00:00 KST = 2026-08-18 15:00 UTC
const KST_0819_0000 = Date.UTC(2026, 7, 18, 15, 0, 0);
check("③ 내일(8/20) 마감 → 리마인드", isDueTomorrowKST(KST_0819_0000 + 26 * 3600 * 1000, KST_0819_0000), true);
check("③ 오늘(8/19) 마감 → 아님", isDueTomorrowKST(KST_0819_0000 + 2 * 3600 * 1000, KST_0819_0000), false);
check("③ 모레(8/21) 마감 → 아님", isDueTomorrowKST(KST_0819_0000 + 50 * 3600 * 1000, KST_0819_0000), false);
check("③ KST 자정 직전 경계", isDueTomorrowKST(KST_0819_0000 + 24 * 3600 * 1000 + 23 * 3600 * 1000 + 59 * 60 * 1000, KST_0819_0000), true);

// ── ④ 재촉 24h 제한 (§6) ──
check("④ 첫 재촉 허용", canNudge(undefined, NOW), true);
check("④ 23시간 후 거부", canNudge(NOW - TASK_NUDGE_INTERVAL_MS + 3600 * 1000, NOW), false);
check("④ 24시간 후 허용", canNudge(NOW - TASK_NUDGE_INTERVAL_MS, NOW), true);
check("④ 재촉 대상 = 미완료·미거절만", nudgeTargets({
  recipientEmails: ["a@hmh.or.kr", "b@hmh.or.kr", "c@hmh.or.kr"],
  statuses: { "a@hmh.or.kr": { state: "DONE", at: 1 }, "b@hmh.or.kr": { state: "DECLINED", at: 1, note: "x" } },
} as any), ["c@hmh.or.kr"]);

// ── 검증·화이트리스트 ──
check("검증: 기한 과거 거부", validateTaskContent({ title: "t", body: "", kind: "confirm", dueAt: NOW - 1, now: NOW }).ok, false);
check("검증: 정상 통과", validateTaskContent({ title: "t", body: "b", kind: "submit", dueAt: NOW + 1000, now: NOW }).ok, true);
check("화이트리스트: hwp 통과", validateTaskFileName("양식.hwp").ok, true);
check("화이트리스트: exe 거부", validateTaskFileName("virus.exe").ok, false);
check("화이트리스트: 확장자 없음 거부", validateTaskFileName("noext").ok, false);
check("크기: 서버 경로 4MB 초과 거부", validateTaskFileSize(TASK_SERVER_UPLOAD_MAX_BYTES + 1, false).ok, false);
check("크기: 세션 경로 10MB 이하 통과", validateTaskFileSize(9 * 1024 * 1024, true).ok, true);
check("크기: 세션 경로 10MB 초과 거부", validateTaskFileSize(11 * 1024 * 1024, true).ok, false);
check("화이트리스트: gif 거부 (2026-08-19 피드백 9번 — 업무엔 불요)", validateTaskFileName("움짤.gif").ok, false);
check("화이트리스트: png은 유지", validateTaskFileName("사진.png").ok, true);

// ── 고아 초안 판정 (피드백 4-ⓑ) ──
check("고아: 수신 0 + 24h 경과 → 정리 대상", isOrphanDraft({ recipientCount: 0, createdAt: NOW - TASK_DRAFT_ORPHAN_MS }, NOW), true);
check("고아: 수신 0 + 23h → 아직 작성 중일 수 있음, 보존", isOrphanDraft({ recipientCount: 0, createdAt: NOW - TASK_DRAFT_ORPHAN_MS + 3600 * 1000 }, NOW), false);
check("고아: 발송된 업무(수신>0)는 절대 대상 아님", isOrphanDraft({ recipientCount: 3, createdAt: NOW - 100 * TASK_DRAFT_ORPHAN_MS }, NOW), false);

// ── 셀프 등록 (피드백 15번 — 수신자 자동 본인·즉시 수락·확인형 강제) ──
{
  const doc = buildSelfTaskDoc({
    email: "Me@hmh.or.kr", name: "홍길동", title: "성적 마감", body: "",
    dueAt: NOW + 86400_000, now: NOW, retentionDays: 365,
  });
  check("셀프: 확인형 강제", doc.kind, "confirm");
  check("셀프: 수신자 = 본인(소문자 정규화)", doc.recipientEmails, ["me@hmh.or.kr"]);
  check("셀프: 생성 즉시 수락", doc.statuses["me@hmh.or.kr"], { state: "ACCEPTED", at: NOW });
  check("셀프: selfAssigned 표시", doc.selfAssigned, true);
  check("셀프: 수신 요약 = 본인", doc.recipientSummary, "본인");
  check("셀프: 폴더 미생성 (양식·제출함 없음)", doc.formFolderId === undefined && doc.submitFolderId === undefined, true);
  check("셀프: 완료 전이 동작", applyTaskTransition(doc, "me@hmh.or.kr", "done", undefined, NOW + 1).ok, true);
  check("셀프: 고아 초안 스윕 대상 아님 (수신 1명)", isOrphanDraft(doc, NOW + 100 * TASK_DRAFT_ORPHAN_MS), false);
}

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
