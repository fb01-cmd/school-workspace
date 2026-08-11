/**
 * 차단 OU 매칭 자가 테스트 (coop_account_block_spec §6-1) — 네트워크·Firestore 무의존
 *
 * 사용법: npx tsx scripts/blocked_ou_selftest.ts
 */
import { isBlockedOuPath, isProtectedAccountEmail } from "../src/lib/auth/blockedOu";

let failed = 0;
function expect(name: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

const LIST = ["/학생/공동교육", "/학생/공동교육과정(26)/"];

console.log("── 차단 OU 매칭 ──");
expect("정확 일치", isBlockedOuPath("/학생/공동교육", LIST));
expect("하위 OU 포함", isBlockedOuPath("/학생/공동교육/1반", LIST));
expect("등록 항목 후행 슬래시 정규화", isBlockedOuPath("/학생/공동교육과정(26)", LIST));
expect("대상 경로 후행 슬래시 정규화", isBlockedOuPath("/학생/공동교육/", LIST));
expect("이름 프리픽스만 겹침 → 통과", !isBlockedOuPath("/학생/공동교육심화", LIST));
expect("무관 OU 통과", !isBlockedOuPath("/학생/1학년", LIST));
expect("상위 OU 통과 (하위가 차단이어도 상위는 무관)", !isBlockedOuPath("/학생", LIST));
expect("빈 경로 통과", !isBlockedOuPath("", LIST) && !isBlockedOuPath(null, LIST));
expect("루트 경로 통과", !isBlockedOuPath("/", LIST));
expect("빈 목록 통과", !isBlockedOuPath("/학생/공동교육", []));
expect("루트 등록은 무시 (전면 차단 오등록 방어)", !isBlockedOuPath("/학생/1학년", ["/"]));
expect("빈 문자열 등록은 무시", !isBlockedOuPath("/학생/1학년", ["", "  "]));

console.log("── 보호 계정 ──");
expect("fb01 보호", isProtectedAccountEmail("fb01@hmh.or.kr"));
expect("대소문자 무시", isProtectedAccountEmail("Admin@HMH.or.kr"));
expect("hmnotice 보호", isProtectedAccountEmail("hmnotice@hmh.or.kr"));
expect("일반 계정 비보호", !isProtectedAccountEmail("s10@hmh.or.kr"));

console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
