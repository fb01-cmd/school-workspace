/**
 * 표시이름 동기화 계획 셀프테스트 (피드백 22·23번) — 순수, 네트워크·Firestore 0회
 * 실행: npx tsx scripts/name_sync_selftest.ts
 */
import { computeNameSyncPlan } from "../src/lib/ops/name_sync_logic";

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const pass = g === w;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n   got:  ${g}\n   want: ${w}`}`);
};

const gws = new Map<string, string>([
  ["a@hmh.or.kr", "김철수"],
  ["b@hmh.or.kr", "이영희"],
  ["c@hmh.or.kr", "박민준"],
]);

const plan = computeNameSyncPlan({
  profiles: [
    { email: "a@hmh.or.kr", name: "김철수" },            // 일치 — 무변경
    { email: "b@hmh.or.kr", name: "이영희(Young Lee)" }, // 낡음 (22번 유형)
    { email: "c@hmh.or.kr", name: "" },                  // 빈 이름 (23번 유형)
    { email: "d@hmh.or.kr", name: "" },                  // GWS에 없음 — 임의 생성 금지
  ],
  users: [
    { id: "u1", email: "B@hmh.or.kr", name: "이영희(Young Lee)" }, // 대소문자 정규화 + 낡음
    { id: "u2", email: "a@hmh.or.kr", name: "김철수" },            // 일치
    { id: "u3", email: undefined, name: "" },                      // 이메일 없음 — 건너뜀
  ],
  gwsNames: gws,
});

check("낡은 프로필 이름 갱신 대상", plan.some((p) => p.kind === "profile" && p.id === "b@hmh.or.kr" && p.to === "이영희"), true);
check("빈 프로필 이름 채움 대상", plan.some((p) => p.kind === "profile" && p.id === "c@hmh.or.kr" && p.to === "박민준"), true);
check("GWS에 없는 이름은 건드리지 않음", plan.some((p) => p.email === "d@hmh.or.kr"), false);
check("일치 항목 무변경", plan.some((p) => p.email === "a@hmh.or.kr"), false);
check("users 사본도 대상 (대소문자 정규화)", plan.some((p) => p.kind === "user" && p.id === "u1" && p.to === "이영희"), true);
check("이메일 없는 users 문서 건너뜀", plan.some((p) => p.id === "u3"), false);
check("총 계획 건수", plan.length, 3);

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
