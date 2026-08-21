#!/usr/bin/env npx tsx
/**
 * 부서 개명 마이그레이션 — **부서 이름이 박혀 있는 모든 곳을 함께 옮긴다**
 * (docs/grade_dept_spec.md §3-5·§6-1)
 *
 * 사용법:
 *   OLD="1학년" NEW="1학년부" npx tsx --env-file=.env.local scripts/migrate_dept_rename.ts
 *   OLD="1학년" NEW="1학년부" APPLY=1 npx tsx --env-file=.env.local scripts/migrate_dept_rename.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 새로 쓰는가 — `migrate_dept_rename_2026_08_13.ts`가 **절반만 옮겼다.**
 * 그 스크립트는 `settings.departments`와 `teacher_profiles.departments` 두 배열만
 * 치환했다. 2026-08-21 전수 조사에서 빠진 곳이 드러났다:
 *
 *   ① teacher_profiles.deptHeadMap — **부서명이 객체 키**다.
 *      옛 키가 남으면 **부장 표시가 조용히 사라진다.**
 *   ② teacher_profiles_pending — 개명 시점에 승인 대기 중인 신청.
 *      승인되는 순간 옛 이름이 확정 프로필로 되살아난다.
 *   ③ teacher_profiles_archive — 전출·명퇴 보관본. **전출 취소로 복원되면** 옛 이름이 돌아온다.
 *   ④ org_index/{domain} — 명단 사본(프로필 통째 복제). 그냥 두면 최대 48시간 낡은 이름.
 *   ⑤ settings.gradeDepartments — 부서↔학년 연결 표. **여기도 키가 부서명**이다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 손대지 않는 것 (일부러 — §6-2)
 *
 *   · memos·tasks 의 `recipientMeta.depts` — **발송 시점의 사실 기록**이다.
 *     소급해 고치면 "그때 그 부서로 보냈다"는 기록이 거짓이 된다.
 *   · audit_logs.details — 같은 이유.
 *   · Drive에 이미 만들어진 제출 파일 이름(`{부서명}_{이름}_{제목}`) — 되돌릴 수 없다(§6-3).
 */
import { adminDb } from "../src/lib/firebase/admin";
import { buildRosterIndex } from "../src/lib/org/roster_index";

const DOMAIN = process.env.DOMAIN || "hmh.or.kr";
const OLD = process.env.OLD || "";
const NEW = process.env.NEW || "";
const APPLY = process.env.APPLY === "1";

if (!OLD || !NEW) {
  console.error('OLD 와 NEW 를 지정하라. 예: OLD="1학년" NEW="1학년부" npx tsx scripts/migrate_dept_rename.ts');
  process.exit(1);
}
if (OLD === NEW) {
  console.error("OLD 와 NEW 가 같다.");
  process.exit(1);
}

const plan: string[] = [];
const renameArr = (arr: unknown): string[] | null => {
  if (!Array.isArray(arr) || !arr.includes(OLD)) return null;
  return arr.map((x) => (x === OLD ? NEW : x));
};
/** 부서명이 키인 객체 — 키를 옮긴다. 값은 그대로 */
const renameKey = (obj: unknown): Record<string, unknown> | null => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(o, OLD)) return null;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) next[k === OLD ? NEW : k] = v;
  return next;
};

async function migrateProfileLike(collection: string) {
  const snap = await adminDb.collection(collection).get();
  for (const d of snap.docs) {
    const data = d.data();
    const patch: Record<string, unknown> = {};

    const depts = renameArr(data.departments);
    if (depts) patch.departments = depts;

    const heads = renameKey(data.deptHeadMap);
    if (heads) patch.deptHeadMap = heads;

    if (Object.keys(patch).length === 0) continue;
    plan.push(
      `${collection}/${d.id} — ${depts ? "departments " : ""}${heads ? "deptHeadMap(키) " : ""}"${OLD}" → "${NEW}"`
    );
    if (APPLY) await d.ref.update(patch);
  }
}

async function main() {
  console.log(`── 부서 개명: "${OLD}" → "${NEW}" (도메인 ${DOMAIN}) ──\n`);

  // ① settings — departments 배열 + gradeDepartments 키
  const sRef = adminDb.collection("settings").doc(DOMAIN);
  const sSnap = await sRef.get();
  const sData = sSnap.data() || {};
  const sPatch: Record<string, unknown> = {};

  const sDepts = renameArr(sData.departments);
  if (sDepts) sPatch.departments = sDepts;
  const sGrades = renameKey(sData.gradeDepartments);
  if (sGrades) sPatch.gradeDepartments = sGrades;

  if (Object.keys(sPatch).length) {
    plan.push(
      `settings/${DOMAIN} — ${sDepts ? "departments " : ""}${sGrades ? "gradeDepartments(키) " : ""}"${OLD}" → "${NEW}"`
    );
    if (APPLY) await sRef.update(sPatch);
  } else {
    plan.push(`settings/${DOMAIN} — "${OLD}" 없음 (건너뜀)`);
  }

  // ②③④ 프로필 3종 (확정 · 승인 대기 · 보관)
  await migrateProfileLike("teacher_profiles");
  await migrateProfileLike("teacher_profiles_pending");
  try {
    const archSnap = await adminDb
      .collection("teacher_profiles_archive").doc(DOMAIN)
      .collection("profiles").get();
    for (const d of archSnap.docs) {
      const data = d.data();
      const patch: Record<string, unknown> = {};
      const depts = renameArr(data.departments);
      if (depts) patch.departments = depts;
      const heads = renameKey(data.deptHeadMap);
      if (heads) patch.deptHeadMap = heads;
      if (Object.keys(patch).length === 0) continue;
      plan.push(`teacher_profiles_archive/${DOMAIN}/profiles/${d.id} — "${OLD}" → "${NEW}"`);
      if (APPLY) await d.ref.update(patch);
    }
  } catch (e: any) {
    plan.push(`teacher_profiles_archive — 조회 실패(건너뜀): ${e?.message}`);
  }

  console.log(APPLY ? "── 실행 완료 ──" : "── 미리보기 (실행하려면 APPLY=1) ──");
  for (const p of plan) console.log(`  ${p}`);

  if (!APPLY) {
    console.log(`\n총 ${plan.length}건. 실행하려면 APPLY=1 을 붙여라.`);
    return;
  }

  // ⑤ 명단 사본 강제 재조립 — 디바운스를 건너뛰어야 즉시 반영된다
  try {
    const r = await buildRosterIndex(DOMAIN, { builtBy: "migrate_dept_rename", force: true });
    console.log(`\n  org_index 재조립: ${JSON.stringify(r)}`);
  } catch (e: any) {
    console.log(`\n  ⚠️ org_index 재조립 실패 — 손으로 /api/org/roster 를 부르거나 하루 1회 보정을 기다려라: ${e?.message}`);
  }

  // ── 검증: 옛 이름이 어디에도 남아 있지 않아야 한다 ──
  console.log("\n── 검증 ──");
  const after = await sRef.get();
  const aData = after.data() || {};
  console.log(`  settings.departments 잔존: ${(aData.departments || []).includes(OLD) ? "❌" : "✅ 없음"}`);
  console.log(`  settings.gradeDepartments 키 잔존: ${aData.gradeDepartments && OLD in aData.gradeDepartments ? "❌" : "✅ 없음"}`);

  for (const col of ["teacher_profiles", "teacher_profiles_pending"]) {
    const s = await adminDb.collection(col).get();
    const left = s.docs.filter((d) => {
      const v = d.data();
      return (v.departments || []).includes(OLD) || (v.deptHeadMap && OLD in v.deptHeadMap);
    });
    console.log(`  ${col} 잔존: ${left.length ? `❌ ${left.map((d) => d.id).join(", ")}` : "✅ 없음"}`);
  }

  console.log(
    `\n  ※ 지난 쪽지·업무의 수신자 표기와 감사 로그, 이미 만들어진 제출 파일 이름에는 "${OLD}"가 그대로 남는다 — 일부러다(스펙 §6-2·§6-3).`
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
