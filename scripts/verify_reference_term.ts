/**
 * 참조 학기 우선순위 규칙 셀프테스트 (development_roadmap §2, 2026-08-17)
 * 실행: npx tsx scripts/verify_reference_term.ts
 */
import { rankReferenceTerms } from "../src/lib/timetable/utils";

const ok = (b: boolean) => (b ? "✅" : "❌");
let fails = 0;
const check = (label: string, got: string[], want: string[]) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${ok(pass)} ${label} — [${got.join(", ")}]${pass ? "" : ` (기대: [${want.join(", ")}])`}`);
};

// 1년치 축적 후: 전전학기(전년도 같은 학기) 먼저, 그다음 과거 최신순
check("2027-1 대상, 1년치 축적", rankReferenceTerms("2027-1", ["2026-1", "2026-2", "2027-1"]), ["2026-1", "2026-2"]);
check("2027-2 대상 (2026-2가 전전학기)", rankReferenceTerms("2027-2", ["2026-1", "2026-2", "2027-1", "2027-2"]), ["2026-2", "2027-1", "2026-1"]);
// 축적 전(현재 실물): 전전학기가 없으면 자연히 전 학기부터
check("2027-1 대상, 2026-2만 존재", rankReferenceTerms("2027-1", ["2026-2", "2027-1"]), ["2026-2"]);
// 미래 학기·대상 자신 제외, 형식 오류 내성
check("미래 학기 제외", rankReferenceTerms("2026-2", ["2026-1", "2026-2", "2027-1"]), ["2026-1"]);
check("잘못된 형식", rankReferenceTerms("이상한값", ["2026-1"]), []);

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
