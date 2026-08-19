// 교직원 명단 색인 — teacher_profiles 89건 전수 읽기를 문서 1건 읽기로 바꾼다.
// 스펙: docs/roster_index_spec.md
//
// ⚠️ 안전 규칙이 코드 구조 자체인 곳이다 (AGENTS.md §1-2). 고치기 전에 스펙 §2-3을 읽어라.
//   ① 재조립은 프로필 쓰기가 **확정된 뒤에만** 호출한다. 앞이나 동시에 부르면 옛 값으로
//      색인이 만들어지고, 그 색인이 다음 보정까지 진실 행세를 한다.
//   ② 재조립은 **언제나 전수**다. 증분 갱신(그 사람만 고쳐 넣기)을 넣지 마라 —
//      두 관리자가 동시에 다른 사람을 고치면 나중 증분이 앞의 변경을 지운다.
//      전수 재조립은 누가 이기든 결과가 원본과 일치하므로 경합이 무해해진다.
//   ③ 원본을 읽는 주체는 **서버(admin SDK)**다. 클라이언트가 명단을 올려 보내는 형태를
//      만들면 교사 1명이 전원의 명단을 오염시킬 수 있다.
import { adminDb } from "@/lib/firebase/admin";
import {
  ROSTER_INDEX_COLLECTION,
  ROSTER_INDEX_DEBOUNCE_MS,
  ROSTER_INDEX_MAX_BYTES,
  ROSTER_INDEX_SCHEMA_VERSION,
  RosterIndexDoc,
} from "./roster_index_shared";

export * from "./roster_index_shared";

export interface BuildRosterIndexResult {
  built: boolean;
  /** built=false일 때의 사유 — "debounced" | "too_large" */
  reason?: string;
  count: number;
  bytes: number;
  builtAt: number;
}

export const rosterIndexRef = (domain: string) =>
  adminDb.collection(ROSTER_INDEX_COLLECTION).doc(domain);

/**
 * teacher_profiles 전수를 읽어 색인 문서 1건으로 재조립한다.
 *
 * @param domain 색인 문서 키 (memos/settings와 같은 도메인 키를 쓴다)
 * @param opts.builtBy 진단용 출처 표기 ("daily-sync" | "write" | "manual")
 * @param opts.force true면 디바운스를 무시한다 (하루 1회 보정은 항상 force)
 */
export async function buildRosterIndex(
  domain: string,
  opts: { builtBy?: string; force?: boolean } = {}
): Promise<BuildRosterIndexResult> {
  const now = Date.now();
  const ref = rosterIndexRef(domain);

  // ── 디바운스 (스펙 §2-4) — 보정(force)은 건너뛰지 않는다 ──
  if (!opts.force) {
    const prev = await ref.get();
    const prevBuiltAt = prev.exists ? Number((prev.data() as RosterIndexDoc).builtAt || 0) : 0;
    if (prevBuiltAt && now - prevBuiltAt < ROSTER_INDEX_DEBOUNCE_MS) {
      return { built: false, reason: "debounced", count: 0, bytes: 0, builtAt: prevBuiltAt };
    }
  }

  // ── 전수 재조립 (스펙 §2-3-②) ──
  const snap = await adminDb.collection("teacher_profiles").get();
  const profiles = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    // 문서 ID(=이메일)가 단일 원본이다. data.email이 비었거나 대소문자가 달라도
    // 여기서 맞춰 둬야 소비자가 원본 경로와 같은 결과를 본다.
    return { ...data, email: String((data.email as string) || d.id).toLowerCase() };
  });

  const payload: RosterIndexDoc = {
    schemaVersion: ROSTER_INDEX_SCHEMA_VERSION,
    domain,
    builtAt: now,
    builtBy: opts.builtBy || "manual",
    count: profiles.length,
    profiles,
  };

  // ── 크기 가드 (스펙 §1) — 조용한 절단 금지 ──
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > ROSTER_INDEX_MAX_BYTES) {
    // 색인을 갱신하지 않고 둔다 → 소비자는 낡음 판정으로 원본 폴백에 들어가고,
    // 명단이 잘린 채 진실 행세를 하는 상황은 생기지 않는다.
    console.error(
      `[roster_index] 색인이 한도를 넘어 쓰지 않았다: ${bytes} bytes / ${profiles.length}건 (한도 ${ROSTER_INDEX_MAX_BYTES})`
    );
    return { built: false, reason: "too_large", count: profiles.length, bytes, builtAt: 0 };
  }

  await ref.set(payload);
  return { built: true, count: profiles.length, bytes, builtAt: now };
}
