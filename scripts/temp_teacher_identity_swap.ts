/**
 * [임시·테스트 전용] 교사 포털 실기기 테스트를 위한 한시 이메일 치환 — 휴직 계정(playviolin@)을
 * 기초 그리드에서 특정 교사의 수업에 매칭시킨다. 테스트 후 반드시 RESTORE로 원복한다.
 *
 * 원리: classGrids 문서의 teachers[].email만 결정적 치환(이름·과목·room 등 불변).
 * 신청·승인은 timetable_changes에만 쓰므로 기초 그리드 원복은 언제나 안전.
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/temp_teacher_identity_swap.ts                    # DRY (선정·검사만)
 *   npx tsx --env-file=.env.local scripts/temp_teacher_identity_swap.ts APPLY [교사이메일]  # 치환 (이메일 생략 시 특별실 최다 교사 자동 선정)
 *   npx tsx --env-file=.env.local scripts/temp_teacher_identity_swap.ts RESTORE            # 원복
 *
 * 안전장치: ① playviolin@이 그리드에 이미 존재하면 중단 ② 적용된 개정판 ops에 대상 교사
 * 이메일이 있으면 중단(치환 표면 불일치 방지) ③ APPLY 전 문서 원본 백업 ④ 치환 전후
 * 발생 건수 대조 ⑤ view 캐시 버전 범프.
 */
import * as fs from "fs";
import * as path from "path";
import {
  classGridsColRef,
  listWeeks,
  loadBaseGridsForWeek,
  loadBaseRevisions,
  loadTimetableSettings,
} from "../src/lib/timetable/server";
import { bumpTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";

const DOMAIN = "hmh.or.kr";
const TEST_EMAIL = "playviolin@hmh.or.kr";
const STATE_FILE = path.join(__dirname, ".temp_identity_swap_state.json"); // gitignore 대상 (점 파일)
const MODE = (process.argv[2] || "DRY").toUpperCase();

type AnyObj = Record<string, any>;

/** 객체 트리에서 email 필드가 target과 일치하는 것만 치환. 반환 = 치환 수 */
function swapEmails(node: AnyObj, from: string, to: string): number {
  let n = 0;
  if (Array.isArray(node)) {
    for (const item of node) n += swapEmails(item, from, to);
    return n;
  }
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (key === "email" && typeof v === "string" && v.trim().toLowerCase() === from) {
        node[key] = to;
        n++;
      } else {
        n += swapEmails(v, from, to);
      }
    }
  }
  return n;
}

function countEmails(node: AnyObj, target: string): number {
  let n = 0;
  if (Array.isArray(node)) return node.reduce((s, x) => s + countEmails(x, target), 0);
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (key === "email" && typeof v === "string" && v.trim().toLowerCase() === target) n++;
      else n += countEmails(v, target);
    }
  }
  return n;
}

async function main() {
  const settings = await loadTimetableSettings(DOMAIN);
  const termId = settings.activeTermId;
  if (!termId) throw new Error("활성 학기 없음");

  if (MODE === "RESTORE") {
    if (!fs.existsSync(STATE_FILE)) throw new Error("상태 파일이 없습니다 — APPLY 이력이 없거나 이미 원복됨");
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const { teacherEmail, termId: appliedTermId, expectedCount } = state;
    console.log(`원복: ${TEST_EMAIL} → ${teacherEmail} (학기 ${appliedTermId}, 기대 ${expectedCount}건)`);
    const snap = await classGridsColRef(DOMAIN, appliedTermId).get();
    let restored = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const n = swapEmails(data, TEST_EMAIL, teacherEmail);
      if (n > 0) {
        await doc.ref.set(data);
        restored += n;
      }
    }
    if (restored !== expectedCount)
      console.error(`⚠️ 원복 건수 불일치: ${restored} ≠ 기대 ${expectedCount} — 백업 대조 필요`);
    // 검증: 테스트 이메일 잔존 0
    const after = await classGridsColRef(DOMAIN, appliedTermId).get();
    let residue = 0;
    for (const doc of after.docs) residue += countEmails(doc.data(), TEST_EMAIL);
    console.log(`원복 완료: ${restored}건 되돌림, ${TEST_EMAIL} 잔존 ${residue}건 (0이어야 정상)`);
    if (residue === 0) fs.unlinkSync(STATE_FILE);
    await bumpTimetableCacheVersion(DOMAIN);
    console.log("view 캐시 버전 범프 완료 ✅");
    return;
  }

  // ── DRY / APPLY 공통: 대상 교사 자동 선정 (이번 주 기준 구장·특별실 수업 최다 단일 교사) ──
  const weeks = (await listWeeks(DOMAIN, termId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!weeks.length) throw new Error("등록된 주 없음");
  const baseGrids = await loadBaseGridsForWeek(DOMAIN, termId, weeks[0].startDate);

  const roomCount = new Map<string, { name: string; rooms: number; total: number }>();
  for (const g of baseGrids as AnyObj[]) {
    for (const cell of g.cells || []) {
      for (const lesson of cell.lessons || []) {
        const ts = lesson.teachers || [];
        if (ts.length !== 1) continue;
        const email = (ts[0].email || "").trim().toLowerCase();
        if (!email) continue;
        const e = roomCount.get(email) || { name: ts[0].name, rooms: 0, total: 0 };
        e.total++;
        if (lesson.room) e.rooms++;
        roomCount.set(email, e);
      }
    }
  }
  const wanted = (process.argv[3] || "").trim().toLowerCase();
  let teacherEmail: string, info: { name: string; rooms: number; total: number };
  if (wanted) {
    const hit = roomCount.get(wanted);
    if (!hit) throw new Error(`지정 교사(${wanted})의 단일 담당 수업을 그리드에서 찾을 수 없습니다.`);
    teacherEmail = wanted;
    info = hit;
    console.log(`대상 교사 지정: ${info.name} (${teacherEmail}) — 특별실 수업 ${info.rooms}건 / 총 ${info.total}시수`);
  } else {
    const ranked = [...roomCount.entries()].sort((a, b) => b[1].rooms - a[1].rooms);
    [teacherEmail, info] = ranked[0];
    console.log(`대상 교사 선정: ${info.name} (${teacherEmail}) — 특별실 수업 ${info.rooms}건 / 총 ${info.total}시수`);
  }

  // 안전장치 ①: 테스트 이메일이 그리드에 이미 존재하면 중단
  const gridsSnap = await classGridsColRef(DOMAIN, termId).get();
  let testResidue = 0, targetCount = 0;
  for (const doc of gridsSnap.docs) {
    testResidue += countEmails(doc.data(), TEST_EMAIL);
    targetCount += countEmails(doc.data(), teacherEmail);
  }
  if (testResidue > 0) throw new Error(`${TEST_EMAIL}이 이미 그리드에 ${testResidue}건 존재 — 치환 불가(원복 안 된 상태?)`);
  console.log(`그리드 문서 ${gridsSnap.size}개, 대상 이메일 발생 ${targetCount}건, 테스트 이메일 잔존 0 ✅`);

  // 안전장치 ②: 적용된 개정판 ops에 대상 이메일이 있으면 중단
  const revisions = (await loadBaseRevisions(DOMAIN, termId)).filter((r) => r.status === "applied");
  let revHits = 0;
  for (const r of revisions) revHits += countEmails(r as AnyObj, teacherEmail);
  console.log(`적용된 개정판 ${revisions.length}건 내 대상 이메일 ${revHits}건 ${revHits === 0 ? "✅" : "❌ 중단"}`);
  if (revHits > 0) throw new Error("개정판 ops에 대상 교사 존재 — 다른 교사를 선정하거나 수동 검토 필요");

  if (MODE !== "APPLY") {
    console.log("(DRY 종료 — 치환하려면 APPLY 인자로 재실행)");
    return;
  }

  // 백업 (안전장치 ③) 후 치환
  const backup: Record<string, AnyObj> = {};
  let swapped = 0;
  for (const doc of gridsSnap.docs) {
    const data = doc.data();
    if (countEmails(data, teacherEmail) === 0) continue;
    backup[doc.id] = JSON.parse(JSON.stringify(data));
    const n = swapEmails(data, teacherEmail, TEST_EMAIL);
    await doc.ref.set(data);
    swapped += n;
  }
  fs.writeFileSync(STATE_FILE.replace(".json", ".backup.json"), JSON.stringify(backup));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ teacherEmail, teacherName: info.name, termId, expectedCount: swapped, appliedAt: new Date().toISOString() }, null, 2));
  if (swapped !== targetCount) console.error(`⚠️ 치환 건수 불일치: ${swapped} ≠ 사전 계수 ${targetCount}`);
  console.log(`치환 완료: ${info.name}의 ${swapped}건 → ${TEST_EMAIL} (백업·상태 파일 기록)`);
  await bumpTimetableCacheVersion(DOMAIN);
  console.log("view 캐시 버전 범프 완료 ✅ — 이제 교사 포털 '내 시간표'에 해당 수업이 보입니다");
  console.log("테스트 후 반드시: npx tsx --env-file=.env.local scripts/temp_teacher_identity_swap.ts RESTORE");
}

main().then(() => process.exit(0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
