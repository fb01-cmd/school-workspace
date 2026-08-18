/**
 * 유령 씨앗 탐지기 — 문서에 새로 생기는 "상태 표기"를 기계적으로 잡는다 (AGENTS.md ④-4)
 *
 * 배경: 2026-08-18 하루에 유령(끝났는데 열린 것으로 읽히는 항목) 8건. 전부 로드맵·스펙·
 * 질문지 본문의 상태 문구("남은 선행 = …", "(UI 대기)", "회수 시점 = 9월")가 완료 후에도
 * 남은 것이었다. 열린 항목의 단일 원본은 STATUS.md(④-3)로 분리했지만, 본문에 상태 표기를
 * 계속 새로 쓰면 유령 씨앗도 계속 생긴다 — 이 스크립트가 그 씨앗을 커밋 전에 잡는다.
 *
 * 동작: git 추적 .md 파일(STATUS.md·archive/ 제외)에서 상태 표기 패턴이 든 줄을 수집해
 * 기준선(docs/ghost_marker_baseline.txt)과 대조한다. 기준선에 없는 **신규** 줄이 있으면
 * 목록을 찍고 실패(exit 1)한다. 기존 재고는 개수만 보고한다(점진 소각 대상).
 *
 * 사용:
 *   npx tsx scripts/check_ghost_markers.ts               # 검사 (신규 감지 시 실패)
 *   npx tsx scripts/check_ghost_markers.ts --rebaseline  # 기준선 재작성
 *
 * 신규가 잡히면: ① 그 항목을 STATUS.md에 행으로 올렸는지 확인하고(확인 방법 필수)
 * ② 본문에는 가급적 상태 표기 대신 STATUS.md 링크를 쓰고 ③ 그래도 남길 이유가 있으면
 * --rebaseline으로 수용한다. 목적은 금지가 아니라 **한 번 멈춰서 대장을 갱신하게 하는 것**.
 *
 * 기준선은 "파일경로\t줄내용" 형태(위치 무관·내용 기반)라 줄 이동에는 반응하지 않는다.
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const BASELINE = join(ROOT, "docs", "ghost_marker_baseline.txt");

const MARKERS = [
  "미착수",
  "착수 대기",
  "구현 대기",
  "검수 대기",
  "UI 대기",
  "배선 대기",
  "수령 필요",
  "남은 선행",
  "잔여 =",
  "잔여:",
  "미구현",
  "미완결",
  "착수 예정",
  "대기 중)",
  "(대기)",
  "보류 중",
];

function trackedMdFiles(): string[] {
  return execSync('git ls-files "*.md"', { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(
      (f) =>
        f &&
        f !== "STATUS.md" && // 대장 자신은 상태 표기가 본업
        !f.startsWith("archive/") // 아카이브는 동결된 일지
    );
}

function collect(): string[] {
  const hits: string[] = [];
  for (const f of trackedMdFiles()) {
    const lines = readFileSync(join(ROOT, f), "utf-8").split("\n");
    for (const line of lines) {
      if (MARKERS.some((m) => line.includes(m))) hits.push(`${f}\t${line.trim()}`);
    }
  }
  return hits;
}

const rebaseline = process.argv.includes("--rebaseline");
const current = collect();

if (rebaseline) {
  writeFileSync(BASELINE, current.sort().join("\n") + "\n", "utf-8");
  console.log(`기준선 재작성 — 상태 표기 재고 ${current.length}건 수용`);
  process.exit(0);
}

const base = new Set(
  existsSync(BASELINE) ? readFileSync(BASELINE, "utf-8").split("\n").filter(Boolean) : []
);
const fresh = current.filter((h) => !base.has(h));

console.log(`상태 표기 재고 ${current.length}건 (기준선 ${base.size}건)`);
if (fresh.length) {
  console.log(`\n❌ 신규 상태 표기 ${fresh.length}건 — 유령 씨앗일 수 있다:`);
  for (const h of fresh) {
    const [f, l] = h.split("\t");
    console.log(`  ${f} → ${l.slice(0, 100)}`);
  }
  console.log(
    "\n조치: STATUS.md에 행을 올렸는지 확인(확인 방법 필수) → 본문엔 가급적 STATUS.md 링크로 대체 →\n남길 이유가 있으면 npx tsx scripts/check_ghost_markers.ts --rebaseline 으로 수용"
  );
  process.exit(1);
}
console.log("✅ 신규 상태 표기 없음");
