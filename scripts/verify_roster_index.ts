/**
 * 명단 색인 검증 — 색인이 원본과 정말 같은가 (docs/roster_index_spec.md §7-1)
 *
 *   npx tsx --env-file=.env.local scripts/verify_roster_index.ts            ← 대조만 (읽기 전용)
 *   npx tsx --env-file=.env.local scripts/verify_roster_index.ts --rebuild  ← 재조립 후 대조
 *
 * 왜 필요한가: 색인은 원본의 사본이므로 **어긋날 수 있다.** 어긋난 색인은 조용하다 —
 * 화면은 아무 오류 없이 낡은 명단을 보여 준다. 그래서 "같다"를 기계로 확인할 수단을
 * 도입과 같은 커밋에 둔다. 일회성 관리 스크립트(스펙 §2-1 갈래 ③)를 돌린 뒤에도 이걸 쓴다.
 *
 * 읽기 예산: teacher_profiles 전수(약 89) + 색인 1 = 약 90 reads.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { buildRosterIndex } from "../src/lib/org/roster_index";
import { isRosterIndexUsable, ROSTER_INDEX_COLLECTION } from "../src/lib/org/roster_index_shared";

const DOMAIN = process.env.SCHOOL_DOMAIN || "hmh.or.kr";
const REBUILD = process.argv.includes("--rebuild");

/** 필드 단위 비교용 정규화 — 키 순서 차이를 동등하게 본다 */
function canonical(o: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(o)
      .sort()
      .reduce((acc: Record<string, unknown>, k) => {
        acc[k] = o[k];
        return acc;
      }, {})
  );
}

async function main() {
  if (REBUILD) {
    const r = await buildRosterIndex(DOMAIN, { builtBy: "manual", force: true });
    console.log(`재조립: built=${r.built} count=${r.count} bytes=${r.bytes}${r.reason ? ` reason=${r.reason}` : ""}`);
  }

  const [originSnap, indexSnap] = await Promise.all([
    adminDb.collection("teacher_profiles").get(),
    adminDb.collection(ROSTER_INDEX_COLLECTION).doc(DOMAIN).get(),
  ]);

  const index = indexSnap.exists ? (indexSnap.data() as any) : null;
  if (!index) {
    console.log("❌ 색인 문서가 없다 — 화면은 원본 폴백으로 정상 동작하지만 절감 효과가 0이다.");
    console.log("   → --rebuild 로 만들어라.");
    process.exit(1);
  }

  const usable = isRosterIndexUsable(index);
  const ageH = ((Date.now() - Number(index.builtAt || 0)) / 3600000).toFixed(1);
  console.log(`색인: count=${index.count} builtBy=${index.builtBy} builtAt=${ageH}시간 전 사용가능=${usable ? "예" : "아니오"}`);

  // ── 원본 vs 색인 필드 단위 대조 ──
  const origin = new Map<string, Record<string, unknown>>();
  originSnap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    origin.set(String((data.email as string) || d.id).toLowerCase(), {
      ...data,
      email: String((data.email as string) || d.id).toLowerCase(),
    });
  });

  const indexed = new Map<string, Record<string, unknown>>();
  (index.profiles || []).forEach((p: Record<string, unknown>) => {
    indexed.set(String(p.email || "").toLowerCase(), p);
  });

  const missing = [...origin.keys()].filter((e) => !indexed.has(e));
  const ghosts = [...indexed.keys()].filter((e) => !origin.has(e));
  const differing = [...origin.keys()]
    .filter((e) => indexed.has(e))
    .filter((e) => canonical(origin.get(e)!) !== canonical(indexed.get(e)!));

  console.log(`\n원본 ${origin.size}건 / 색인 ${indexed.size}건`);
  console.log(`  색인에 빠진 사람: ${missing.length}건${missing.length ? ` — ${missing.slice(0, 10).join(", ")}` : ""}`);
  console.log(`  색인에만 있는 유령: ${ghosts.length}건${ghosts.length ? ` — ${ghosts.slice(0, 10).join(", ")}` : ""}`);
  console.log(`  내용이 다른 사람: ${differing.length}건${differing.length ? ` — ${differing.slice(0, 10).join(", ")}` : ""}`);

  const ok = missing.length === 0 && ghosts.length === 0 && differing.length === 0 && usable;
  console.log(ok ? "\n✅ 색인이 원본과 일치한다." : "\n❌ 불일치 — 재조립(--rebuild) 후 다시 확인하라.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
