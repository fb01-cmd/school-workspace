/**
 * 쪽지 서버 로직 자가 테스트 (docs/memo_spec.md §8) — 네트워크·Firestore 무의존
 *
 * 사용법: npx tsx scripts/memo_selftest.ts
 */
import {
  MEMO_DEFAULT_RETENTION_DAYS,
  computeRecall,
  expandGroupEmails,
  resolveHideEligibility,
  resolveReplyContext,
  resolveStarEligibility,
  resolveRecipients,
  resolveRetentionDays,
  resolveRetentionMonths,
  memoExpireAtKST,
  MEMO_RETENTION_MONTHS,
  validateMemoContent,
} from "../src/lib/memo/logic";

let failed = 0;
function expect(name: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

async function main() {
  console.log("── 본문 검증 ──");
  {
    const ok = validateMemoContent({ title: " 회의 안내 ", body: "내용", links: [{ url: "https://drive.google.com/x", label: "양식" }] });
    expect("정상 입력 통과 + 트림", ok.ok && ok.content.title === "회의 안내");
    // 제목 선택화 (2026-08-19 피드백 31번) — 빈 제목 허용, 문서엔 "" 저장 (표기 폴백은 발신 표면·화면 몫)
    expect("빈 제목 허용 (31번 — 메신저 문법)", (() => { const r = validateMemoContent({ title: "  ", body: "x" }); return r.ok && r.content.title === ""; })());
    expect("제목 필드 부재도 허용", (() => { const r = validateMemoContent({ body: "x" }); return r.ok && r.content.title === ""; })());
    expect("빈 본문 거부", !validateMemoContent({ title: "t", body: "" }).ok);
    expect("제목 상한 초과 거부", !validateMemoContent({ title: "가".repeat(201), body: "x" }).ok);
    expect("본문 상한 초과 거부", !validateMemoContent({ title: "t", body: "가".repeat(10001) }).ok);
    expect("http 링크 거부", !validateMemoContent({ title: "t", body: "x", links: [{ url: "http://a.com" }] }).ok);
    expect("링크 6개 거부", !validateMemoContent({ title: "t", body: "x", links: Array(6).fill({ url: "https://a.com" }) }).ok);
    expect("링크 생략 허용", validateMemoContent({ title: "t", body: "x" }).ok);
    const sum = validateMemoContent({ title: "t", body: "x", recipientSummary: "요".repeat(200) });
    expect("요약 100자 절단", sum.ok && sum.content.recipientSummary.length === 100);
  }

  console.log("── 그룹 확장 ──");
  {
    const tree: Record<string, Array<{ email: string; type: string }>> = {
      "all@hmh.or.kr": [
        { email: "t1@hmh.or.kr", type: "USER" },
        { email: "sub@hmh.or.kr", type: "GROUP" },
      ],
      "sub@hmh.or.kr": [
        { email: "t2@hmh.or.kr", type: "USER" },
        { email: "all@hmh.or.kr", type: "GROUP" }, // 순환
      ],
    };
    const lister = async (g: string) => {
      if (!tree[g]) throw new Error("group not found: " + g);
      return tree[g];
    };
    const r = await expandGroupEmails(["all@hmh.or.kr"], lister);
    expect("중첩 그룹 재귀 확장", r.users.includes("t1@hmh.or.kr") && r.users.includes("t2@hmh.or.kr"));
    expect("순환 그룹 무한 루프 없음", r.users.length === 2);

    const deep: Record<string, Array<{ email: string; type: string }>> = {
      "g1@h.kr": [{ email: "g2@h.kr", type: "GROUP" }],
      "g2@h.kr": [{ email: "g3@h.kr", type: "GROUP" }],
      "g3@h.kr": [{ email: "g4@h.kr", type: "GROUP" }, { email: "u3@h.kr", type: "USER" }],
      "g4@h.kr": [{ email: "u4@h.kr", type: "USER" }],
    };
    const rd = await expandGroupEmails(["g1@h.kr"], async (g) => deep[g] || []);
    expect("깊이 3까지 확장", rd.users.includes("u3@h.kr"));
    expect("깊이 초과 그룹 미확장·보고", !rd.users.includes("u4@h.kr") && rd.skippedDepth.includes("g4@h.kr"));

    let threw = false;
    try {
      await expandGroupEmails(["none@hmh.or.kr"], lister);
    } catch {
      threw = true;
    }
    expect("존재하지 않는 그룹은 throw (삼키지 않음)", threw);
  }

  console.log("── 수신자 확정 ──");
  {
    const directory = [
      { primaryEmail: "T1@hmh.or.kr", orgUnitPath: "/교직원" },
      { primaryEmail: "t2@hmh.or.kr", orgUnitPath: "/교직원/부장" },
      { primaryEmail: "25001@hmh.or.kr", orgUnitPath: "/학생/1학년" },
      { primaryEmail: "ch_01@hmh.or.kr", orgUnitPath: "/학생/공동교육과정(26)" },
      { primaryEmail: "root@hmh.or.kr", orgUnitPath: "/" },
    ];
    const r = resolveRecipients(
      ["t1@hmh.or.kr", "T1@HMH.or.kr", "t2@hmh.or.kr", "25001@hmh.or.kr", "ch_01@hmh.or.kr", "ghost@hmh.or.kr", "out@gmail.com", "broken@@", "root@hmh.or.kr"],
      directory,
      "hmh.or.kr"
    );
    expect("교직원 수용 + 대소문자 정규화·중복 제거", r.accepted.filter((e) => e === "t1@hmh.or.kr").length === 1);
    expect("하위 OU 교직원 수용", r.accepted.includes("t2@hmh.or.kr"));
    expect("학생(/학생 하위) 제외", r.students.includes("25001@hmh.or.kr"));
    expect("공동교육 계정도 /학생 하위라 제외", r.students.includes("ch_01@hmh.or.kr"));
    expect("실존하지 않는 계정 제외", r.notFound.includes("ghost@hmh.or.kr"));
    expect("도메인 외 제외", r.outOfDomain.includes("out@gmail.com"));
    expect("형식 불량 제외", r.invalidFormat.length === 1);
    expect("루트 OU 계정은 학생 아님", r.accepted.includes("root@hmh.or.kr"));
    expect("확정 인원 정확", r.accepted.length === 3);
  }

  console.log("── 보존 일수 ──");
  {
    expect("미설정 → 기본 365", resolveRetentionDays(undefined) === MEMO_DEFAULT_RETENTION_DAYS);
    expect("정상값 반영", resolveRetentionDays(180) === 180);
    expect("소수점 내림", resolveRetentionDays(90.9) === 90);
    expect("0 이하 → 기본", resolveRetentionDays(0) === MEMO_DEFAULT_RETENTION_DAYS);
    expect("과대값 → 기본", resolveRetentionDays(99999) === MEMO_DEFAULT_RETENTION_DAYS);
    expect("문자열 → 기본", resolveRetentionDays("365" as any) === MEMO_DEFAULT_RETENTION_DAYS);
  }

  console.log("\n── 회수 (§12-2) ──");
  {
    const base = { recipientEmails: ["a@x.kr", "b@x.kr", "c@x.kr"] };

    // 일부만 읽은 경우 — 읽은 사람은 남고 안 읽은 사람만 거둬진다
    const r1 = computeRecall({ ...base, reads: { "a@x.kr": 1, "c@x.kr": 2 } });
    expect("읽은 사람만 남는다", JSON.stringify(r1.keep) === JSON.stringify(["a@x.kr", "c@x.kr"]));
    expect("안 읽은 사람만 회수된다", JSON.stringify(r1.recalled) === JSON.stringify(["b@x.kr"]));

    // 아무도 안 읽은 경우 — 전원 회수, 수신자 0명
    const r2 = computeRecall({ ...base, reads: {} });
    expect("아무도 안 읽었으면 전원 회수", r2.recalled.length === 3 && r2.keep.length === 0);

    // 전원이 읽은 경우 — 거둘 것이 없다 (서버는 0건 성공으로 응답)
    const r3 = computeRecall({ ...base, reads: { "a@x.kr": 1, "b@x.kr": 1, "c@x.kr": 1 } });
    expect("전원 읽었으면 회수 대상 0", r3.recalled.length === 0 && r3.keep.length === 3);

    // 회수 후 재회수 — 남은 사람은 모두 읽은 사람이므로 다시 거둘 것이 없다(멱등)
    const r4 = computeRecall({ recipientEmails: r1.keep, reads: { "a@x.kr": 1, "c@x.kr": 2 } });
    expect("재회수는 0건(멱등)", r4.recalled.length === 0 && r4.keep.length === 2);

    // reads는 건드리지 않으므로 남은 수신자와 읽음 기록이 저절로 정합
    expect("남는 수신자 = 읽음 기록 보유자", r1.keep.every((e) => ["a@x.kr", "c@x.kr"].includes(e)));

    // 수신자 0명 / reads 누락 방어
    const r5 = computeRecall({ recipientEmails: [], reads: {} });
    expect("수신자 0명이면 양쪽 다 빈 배열", r5.keep.length === 0 && r5.recalled.length === 0);
    const r6 = computeRecall({ recipientEmails: ["a@x.kr"] } as any);
    expect("reads 필드가 없어도 죽지 않는다", r6.recalled.length === 1);
  }

  console.log("\n── 답장 (reply spec §6) ──");
  {
    const root = {
      id: "memo_root",
      senderEmail: "boss@x.kr",
      recipientEmails: ["a@x.kr", "b@x.kr"],
    };

    // 수신자 본인 — 통과, 수신자는 원 발신자 1인으로 강제, 뿌리 쪽지라 threadId = 부모 id
    const ok = resolveReplyContext(root, "a@x.kr");
    expect("수신자의 답장 통과", ok.ok);
    if (ok.ok) {
      expect("답장 수신자 = 원 발신자 1인", ok.ctx.recipientEmail === "boss@x.kr");
      expect("뿌리 쪽지의 threadId = 부모 id", ok.ctx.threadId === "memo_root");
      expect("replyTo = 부모 id", ok.ctx.replyTo === "memo_root");
    }

    // 답장의 답장 — threadId는 뿌리를 계승, replyTo는 직접 부모
    const mid = {
      id: "memo_reply1",
      senderEmail: "a@x.kr",
      recipientEmails: ["boss@x.kr"],
      threadId: "memo_root",
    };
    const chained = resolveReplyContext(mid, "boss@x.kr");
    expect(
      "답장의 답장 — threadId 뿌리 계승·replyTo 직접 부모",
      chained.ok && chained.ctx.threadId === "memo_root" && chained.ctx.replyTo === "memo_reply1"
    );

    // 발신자 본인(수신자 아님) — 자기 쪽지에 답장 불가
    const bySender = resolveReplyContext(root, "boss@x.kr");
    expect("발신자 본인의 답장 403", !bySender.ok && bySender.status === 403);

    // 비당사자 — 403 (회수된 수신자도 recipientEmails에서 빠져 같은 경로로 거부)
    const outsider = resolveReplyContext(root, "c@x.kr");
    expect("비당사자의 답장 403", !outsider.ok && outsider.status === 403);

    // 자기에게 보낸 쪽지 — 본인이 수신자이므로 허용(수신자 = 자신)
    const selfMemo = { id: "m_self", senderEmail: "a@x.kr", recipientEmails: ["a@x.kr"] };
    const selfReply = resolveReplyContext(selfMemo, "a@x.kr");
    expect("자기 쪽지 답장 허용(수신자=자신)", selfReply.ok && selfReply.ctx.recipientEmail === "a@x.kr");

    // 대소문자 정규화
    const upper = resolveReplyContext(root, "A@X.KR");
    expect("발신자 이메일 대소문자 정규화", upper.ok);
  }

  console.log("\n── 삭제(내 화면 감추기) (§12-1) ──");
  {
    const memo = {
      senderEmail: "boss@x.kr",
      recipientEmails: ["a@x.kr", "b@x.kr"],
      reads: { "a@x.kr": 1 },
    };
    expect("읽은 수신자 감추기 허용", resolveHideEligibility(memo, "a@x.kr").ok);
    const unread = resolveHideEligibility(memo, "b@x.kr");
    expect("안 읽은 수신자 감추기 거부(400) — 수신확인 왜곡 방지", !unread.ok && unread.status === 400);
    expect("발신자 감추기 제약 없음", resolveHideEligibility(memo, "boss@x.kr").ok);
    const outsider = resolveHideEligibility(memo, "c@x.kr");
    expect("비당사자 감추기 403", !outsider.ok && outsider.status === 403);
    expect("대소문자 정규화", resolveHideEligibility(memo, "A@X.KR").ok);
    // 발신자가 수신자이기도 한 자기 쪽지 — 안 읽었어도 발신자 자격으로 허용
    const selfMemo = { senderEmail: "a@x.kr", recipientEmails: ["a@x.kr"], reads: {} };
    expect("자기 쪽지는 발신자 자격으로 허용", resolveHideEligibility(selfMemo, "a@x.kr").ok);
  }

  console.log("\n── 즐겨찾기 (star/search spec §1-2) ──");
  {
    const memo = { senderEmail: "boss@x.kr", recipientEmails: ["a@x.kr"] };
    expect("수신자 별표 허용(읽음 무관)", resolveStarEligibility(memo, "a@x.kr").ok);
    expect("발신자 별표 허용", resolveStarEligibility(memo, "boss@x.kr").ok);
    const outsider = resolveStarEligibility(memo, "c@x.kr");
    expect("비당사자 별표 403", !outsider.ok && outsider.status === 403);
    expect("대소문자 정규화", resolveStarEligibility(memo, "A@X.KR").ok);
  }

  console.log("\n── 검색 매칭 (star/search spec §2-3) ──");
  {
    const { memoMatchesSearch, parseSearchKeywords } = await import("../src/lib/memo/search_logic");
    const t = {
      title: "2학기 수행평가 일정 안내",
      body: "수학과 수행평가는 9월 첫 주입니다.",
      senderName: "김한별",
      senderDisplayName: "김한별",
      recipientSummary: "수학과 외 3명",
    };
    expect("제목 단일 키워드", memoMatchesSearch(t, "수행평가"));
    expect("본문 매칭", memoMatchesSearch(t, "9월"));
    expect("발신자 이름 매칭", memoMatchesSearch(t, "김한별"));
    expect("다중 키워드 AND — 서로 다른 필드에 걸쳐도 참", memoMatchesSearch(t, "김한별 수행평가"));
    expect("다중 키워드 AND — 하나라도 없으면 거짓", !memoMatchesSearch(t, "김한별 소풍"));
    expect("대소문자 무시", memoMatchesSearch({ ...t, title: "NEIS 입력 안내" }, "neis"));
    expect("빈 검색어는 항상 참", memoMatchesSearch(t, "   "));
    expect("키워드 파싱 — 중복 제거·공백 분리", JSON.stringify(parseSearchKeywords("  A  a b ")) === JSON.stringify(["a", "b"]));
    expect("수신자 요약 매칭(보낸쪽지함)", memoMatchesSearch(t, "외 3명"));
    expect("표시 이름만 있고 스탬프 없어도 매칭", memoMatchesSearch({ title: "t", body: "b", senderDisplayName: "박새로이" }, "박새로이"));
  }

  console.log("\n── 검색 범위 (§2-4a) ──");
  {
    const {
      computeSearchRangeBoundary,
      filterMemosByRangeBoundary,
      MEMO_SEARCH_RANGE_LABELS,
    } = await import("../src/lib/memo/search_logic");

    const now = 1755475200000; // 기준 시각 고정
    const b3m = computeSearchRangeBoundary("3m", now);
    const b6m = computeSearchRangeBoundary("6m", now);
    const b1y = computeSearchRangeBoundary("1y", now);

    expect("3개월 경계 = now - 90일", b3m === now - 90 * 86400000);
    expect("6개월 경계 = now - 180일", b6m === now - 180 * 86400000);
    expect("1년 경계 = now - 365일", b1y === now - 365 * 86400000);
    expect("라벨 확인", MEMO_SEARCH_RANGE_LABELS["3m"] === "최근 3개월" && MEMO_SEARCH_RANGE_LABELS["6m"] === "최근 6개월" && MEMO_SEARCH_RANGE_LABELS["1y"] === "최근 1년");

    // 상위 캐시로부터 하위 범위 파생 필터링 검증
    const sampleMemos = [
      { id: "m1", createdAt: now - 10 * 86400000 },  // 10일 전 (3m, 6m, 1y 모두 포함)
      { id: "m2", createdAt: now - 100 * 86400000 }, // 100일 전 (6m, 1y 포함, 3m 제외)
      { id: "m3", createdAt: now - 200 * 86400000 }, // 200일 전 (1y 포함, 3m/6m 제외)
      { id: "m4", createdAt: now - 400 * 86400000 }, // 400일 전 (전부 제외)
    ];

    const derived3m = filterMemosByRangeBoundary(sampleMemos, b3m);
    const derived6m = filterMemosByRangeBoundary(sampleMemos, b6m);
    const derived1y = filterMemosByRangeBoundary(sampleMemos, b1y);

    expect("3개월 파생 필터 (90일 이내만)", derived3m.map((m) => m.id).join(",") === "m1");
    expect("6개월 파생 필터 (180일 이내만)", derived6m.map((m) => m.id).join(",") === "m1,m2");
    expect("1년 파생 필터 (365일 이내만)", derived1y.map((m) => m.id).join(",") === "m1,m2,m3");
  }



  console.log("\n── 달 단위 파기 (2026-08-20 A안) ──");
  {
    const KST = 9 * 3600 * 1000;
    const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
    const day = 24 * 3600 * 1000;

    const aug1 = Date.UTC(2026, 7, 1, 0, 0, 0);      // 2026-08-01 09:00 KST
    const aug31 = Date.UTC(2026, 7, 31, 14, 0, 0);   // 2026-08-31 23:00 KST
    const dec15 = Date.UTC(2026, 11, 15, 3, 0, 0);   // 2026-12-15 12:00 KST

    expect("8/1 발송 → 이듬해 8/1 파기", kstDay(memoExpireAtKST(aug1)) === "2027-08-01");
    expect("8/31 발송도 같은 날 파기 (달 단위로 뭉친다)", kstDay(memoExpireAtKST(aug31)) === "2027-08-01");
    expect("12월 발송 → 이듬해 12/1 (해 넘김)", kstDay(memoExpireAtKST(dec15)) === "2027-12-01");

    // ⭐ A안의 핵심 안전 조건 — 기존 고지(365일)를 절대 넘지 않는다
    expect("보존이 365일을 넘지 않는다 (8/1 발송)", memoExpireAtKST(aug1) - aug1 <= 365 * day);
    expect("보존이 365일을 넘지 않는다 (8/31 발송)", memoExpireAtKST(aug31) - aug31 <= 365 * day);
    expect("보존이 11개월 이상이다 (8/31 발송)", memoExpireAtKST(aug31) - aug31 >= 330 * day);

    expect("설정: 개월 값이 우선", resolveRetentionMonths(6, 365) === 6);
    expect("설정: 개월이 없으면 일수를 내림 환산", resolveRetentionMonths(undefined, 365) === 11);
    expect("설정: 둘 다 없으면 기본 12개월", resolveRetentionMonths(undefined, undefined) === MEMO_RETENTION_MONTHS);
  }

  console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
