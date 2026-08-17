/**
 * 편성 등록부 잠금 셀프테스트 (registry_lock_spec §6)
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_registry_lock.ts
 * [1]~[3] 순수 판정 매트릭스 (Firestore 무관) / [4] 실데이터 상태 대조 (읽기 전용 —
 * 사유 해제 통과 케이스는 감사 로그를 남기므로 순수 함수로만 시험, 가드 호출은 거부 경로만)
 */
import { judgeRegistryLock, assertRegistryEditable, loadTimetableSettings } from "../src/lib/timetable/server";

const ok = (b: boolean) => (b ? "✅" : "❌");
let fails = 0;
const check = (label: string, b: boolean, detail = "") => {
  if (!b) fails++;
  console.log(`${ok(b)} ${label}${detail ? ` — ${detail}` : ""}`);
};

// [1] 매트릭스 — 초안 자유 / 운영 잠금+사유 해제 / 보관 무조건 잠금
{
  const draft = judgeRegistryLock({ operating: false, archived: false }, undefined);
  const opNoReason = judgeRegistryLock({ operating: true, archived: false }, undefined);
  const opReason = judgeRegistryLock({ operating: true, archived: false }, "이동수업 등록 누락 정정");
  const arch = judgeRegistryLock({ operating: false, archived: true }, "사유가 있어도");
  check(
    "[1] 매트릭스",
    draft.allowed && !draft.unlocked &&
      !opNoReason.allowed && opNoReason.error?.termState === "operating" &&
      opReason.allowed && opReason.unlocked &&
      !arch.allowed && arch.error?.termState === "archived"
  );
}

// [2] 사유 길이 경계 — 2~200자 (공백 제거 기준)
{
  const r = (s: string) => judgeRegistryLock({ operating: true, archived: false }, s);
  check(
    "[2] 사유 길이 경계",
    !r(" ").allowed && !r("정").allowed && r("정정").allowed && r("가".repeat(200)).allowed && !r("가".repeat(201)).allowed
  );
}

// [3] 초안에서는 사유가 있어도 "해제"로 기록하지 않는다 (잠금이 없으니 해제도 없다)
{
  const d = judgeRegistryLock({ operating: false, archived: false }, "사유를 넣어도");
  check("[3] 초안 사유 무시", d.allowed && !d.unlocked);
}

async function main() {
  // [4] 실데이터 — 운영 학기 사유 없음(423 거부·쓰기 없음), 초안 학기 통과, 없는 학기 통과(초안 취급)
  const domain = "hmh.or.kr";
  const settings = await loadTimetableSettings(domain);
  const operating = settings.activeTermId;
  if (operating) {
    let rejected = false;
    let termState = "";
    try {
      await assertRegistryEditable(domain, operating, "selftest@local", undefined, "셀프테스트");
    } catch (e) {
      rejected = true;
      termState = (e as { termState?: string }).termState || "";
    }
    check(`[4a] 운영 학기(${operating}) 사유 없음 → 423`, rejected && termState === "operating");
  }
  let draftOk = true;
  try {
    await assertRegistryEditable(domain, "2027-1", "selftest@local", undefined, "셀프테스트");
  } catch {
    draftOk = false;
  }
  check("[4b] 초안 학기(2027-1) 자유 편집", draftOk);
  console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
