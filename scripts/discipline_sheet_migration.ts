import "./_force_notify_mock"; // DM 차단 관례 (이 스크립트는 알림 경로 없음 — 미리보기는 쓰기 자체가 없음)
import { google } from "googleapis";
import * as XLSX from "xlsx";
import * as fs from "fs";

// ── 설정 ─────────────────────────────────────────────
const IMPERSONATE = "admin@hmh.or.kr"; // mock이 env를 지우므로 상수 사용 (읽기 전용 사칭)
const SHEETS: Record<number, string> = {
  1: "1T50su8s2SCYJ96koiGxwugrWEADLLHFmZ2-LOVxf4VY",
  2: "1GarUv1xBpi_8Xht9cD9-UsDkEZnGI2iLFj-NGbrhf-s",
  3: "1p9CGMtQl953T7Y_o88dalNG52tifzBJPia_AO6Dryf0",
};
// 열 → 항목/회차 매핑 (C=2 … I=8, 0-based)
const COLS: { col: number; itemId: string; nth: number; label: string }[] = [
  { col: 2, itemId: "item_uniform", nth: 1, label: "교복1회(담임)" },
  { col: 3, itemId: "item_uniform", nth: 2, label: "교복2회(생활지도교사)" },
  { col: 4, itemId: "item_uniform", nth: 3, label: "교복3회(위원회)" },
  { col: 5, itemId: "item_smoking", nth: 1, label: "흡연1회(1단계)" },
  { col: 6, itemId: "item_smoking", nth: 2, label: "흡연2회(위원회)" },
  { col: 7, itemId: "item_phone",   nth: 1, label: "휴대폰1회(1단계)" },
  { col: 8, itemId: "item_phone",   nth: 2, label: "휴대폰2회(위원회)" },
];
const TERM_START = Date.parse("2026-03-01"); // 복원 날짜가 이보다 이르면 미상 처리
const FALLBACK_DATE = Date.parse("2026-06-30T03:00:00Z"); // 근사일(1학기 말, KST 정오)

function jwt(scopes: string[]) {
  const key = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key, scopes, subject: IMPERSONATE,
  });
}

interface SheetRecord {
  grade: number; classNum: number; num: number; name: string;
  itemId: string; nth: number; colLabel: string; note: string;
  dateSource: "revision" | "note" | "fallback"; occurredAt: number;
  studentEmail?: string; studentId?: string;
}

async function loadRoster() {
  const admin = google.admin({ version: "directory_v1", auth: jwt(["https://www.googleapis.com/auth/admin.directory.user"]) });
  const byKey = new Map<string, { name: string; email: string; suspended: boolean }>();
  let pageToken: string | undefined;
  do {
    const r = await admin.users.list({ customer: "my_customer", maxResults: 500, pageToken, projection: "basic" });
    for (const u of r.data.users || []) {
      const fam = (u.name?.familyName || "").trim();
      const m = fam.match(/^(\d)(\d{2})(\d{2})$/);
      if (!m) continue;
      byKey.set(`${+m[1]}-${+m[2]}-${+m[3]}`, { name: (u.name?.givenName || "").trim(), email: u.primaryEmail || "", suspended: Boolean(u.suspended) });
    }
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return byKey;
}

// 시트 최종 상태 읽기 → 체크 목록
async function loadFinalChecks() {
  const sheets = google.sheets({ version: "v4", auth: jwt(["https://www.googleapis.com/auth/spreadsheets"]) });
  const checks: { grade: number; classNum: number; num: number; name: string; col: number; note: string }[] = [];
  for (const [gradeStr, id] of Object.entries(SHEETS)) {
    const grade = +gradeStr;
    for (let c = 1; c <= 10; c++) {
      const tab = `${grade}-${c}`;
      const v = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A4:J80`, valueRenderOption: "UNFORMATTED_VALUE" });
      for (const row of v.data.values || []) {
        const num = Number(row[0]); const name = String(row[1] ?? "").trim();
        if (!Number.isInteger(num) || num < 1 || !name) continue;
        const note = String(row[9] ?? "").trim();
        for (const cd of COLS) if (row[cd.col] === true) checks.push({ grade, classNum: c, num, name, col: cd.col, note });
      }
    }
  }
  return checks;
}

// 버전 이력 diff → (grade|이름|col) 최초 등장 시각
async function recoverDates() {
  const drive = google.drive({ version: "v3", auth: jwt(["https://www.googleapis.com/auth/drive"]) });
  const auth = jwt(["https://www.googleapis.com/auth/drive"]);
  const token = (await auth.authorize()).access_token;
  const firstSeen = new Map<string, number>(); // `${grade}-${class}|${name}|${col}` → millis
  const dupNames = new Set<string>();          // 탭 내 동명이인 → 복원 불가 표시

  for (const [gradeStr, id] of Object.entries(SHEETS)) {
    const grade = +gradeStr;
    const revs: { id: string; modifiedTime: string; exportLinks?: Record<string, string> }[] = [];
    let pageToken: string | undefined;
    do {
      const r = await drive.revisions.list({ fileId: id, pageSize: 1000, pageToken, fields: "nextPageToken,revisions(id,modifiedTime,exportLinks)" });
      revs.push(...(r.data.revisions as any[] || []));
      pageToken = r.data.nextPageToken || undefined;
    } while (pageToken);
    revs.sort((a, b) => Date.parse(a.modifiedTime) - Date.parse(b.modifiedTime));
    console.log(`  ${grade}학년: 버전 ${revs.length}개 diff 중…`);

    for (const rev of revs) {
      const url = rev.exportLinks?.["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
      if (!url) continue;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { console.log(`    (버전 ${rev.id} 다운로드 실패 ${res.status} — 건너뜀)`); continue; }
      const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
      const t = Date.parse(rev.modifiedTime);
      for (let c = 1; c <= 10; c++) {
        const ws = wb.Sheets[`${grade}-${c}`]; if (!ws) continue;
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 }); // 4행부터
        const seenNames = new Set<string>();
        for (const row of rows) {
          const name = String(row[1] ?? "").trim(); if (!name) continue;
          if (seenNames.has(name)) dupNames.add(`${grade}-${c}|${name}`); seenNames.add(name);
          for (const cd of COLS) {
            if (row[cd.col] === true) {
              const key = `${grade}-${c}|${name}|${cd.col}`;
              if (!firstSeen.has(key)) firstSeen.set(key, t);
            }
          }
        }
      }
    }
  }
  return { firstSeen, dupNames };
}

function parseNoteDate(note: string): number | null {
  const m = note.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  const mm = +m[1], dd = +m[2];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return Date.parse(`2026-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T03:00:00Z`);
}

async function run() {
  console.log("① 플랫폼 학생 명단 로드…");
  const roster = await loadRoster();
  console.log(`  학번 파싱된 학생 ${roster.size}명`);
  console.log("② 시트 최종 상태 읽기…");
  const checks = await loadFinalChecks();
  console.log(`  체크 ${checks.length}건`);
  console.log("③ 버전 이력 날짜 복원…");
  const { firstSeen, dupNames } = await recoverDates();
  console.log(`  복원된 (학생,회차) ${firstSeen.size}건, 탭 내 동명이인 ${dupNames.size}명`);

  const records: SheetRecord[] = [];
  const excluded: { key: string; name: string; reason: string; checks: number }[] = [];
  const exclMap = new Map<string, { name: string; reason: string; checks: number }>();
  for (const ch of checks) {
    const key = `${ch.grade}-${ch.classNum}-${ch.num}`;
    const stu = roster.get(key);
    const colDef = COLS.find(cd => cd.col === ch.col)!;
    if (!stu || stu.name !== ch.name) {
      const reason = !stu ? "플랫폼에 해당 학번 없음" : `학번의 플랫폼 이름 불일치(플랫폼: ${stu.name})`;
      const e = exclMap.get(`${key}|${ch.name}`) || { name: ch.name, reason, checks: 0 };
      e.checks++; exclMap.set(`${key}|${ch.name}`, e);
      continue;
    }
    let dateSource: SheetRecord["dateSource"] = "fallback";
    let occurredAt = FALLBACK_DATE;
    const fsKey = `${ch.grade}-${ch.classNum}|${ch.name}|${ch.col}`;
    const rec = firstSeen.get(fsKey);
    if (rec && !dupNames.has(`${ch.grade}-${ch.classNum}|${ch.name}`) && rec >= TERM_START) {
      dateSource = "revision"; occurredAt = rec;
    } else {
      const nd = parseNoteDate(ch.note);
      const rowChecks = checks.filter(x => x.grade===ch.grade && x.classNum===ch.classNum && x.num===ch.num).length;
      if (nd && rowChecks === 1) { dateSource = "note"; occurredAt = nd; }
    }
    records.push({
      grade: ch.grade, classNum: ch.classNum, num: ch.num, name: ch.name,
      itemId: colDef.itemId, nth: colDef.nth, colLabel: colDef.label,
      note: ch.note, dateSource, occurredAt,
      studentEmail: stu.email, studentId: `${ch.grade}${String(ch.classNum).padStart(2,"0")}${String(ch.num).padStart(2,"0")}`,
    });
  }
  exclMap.forEach((v, k) => excluded.push({ key: k.split("|")[0], name: v.name, reason: v.reason, checks: v.checks }));

  // ── 보고서 ──
  console.log("\n========== 이관 미리보기 ==========");
  for (const g of [1,2,3]) {
    const rs = records.filter(r => r.grade === g);
    const byItem = (id: string) => rs.filter(r => r.itemId === id).length;
    console.log(`${g}학년: 기록 ${rs.length}건 (교복 ${byItem("item_uniform")} · 흡연 ${byItem("item_smoking")} · 휴대폰 ${byItem("item_phone")})`);
  }
  const bySrc = (s: string) => records.filter(r => r.dateSource === s).length;
  console.log(`날짜 출처: 버전복원 ${bySrc("revision")} · 비고파싱 ${bySrc("note")} · 근사일 ${bySrc("fallback")}`);
  console.log(`\n[제외 — 시트에만 있는 학생] ${excluded.length}명`);
  excluded.sort((a,b)=>a.key.localeCompare(b.key)).forEach(e => console.log(`  ${e.key} ${e.name}: ${e.reason} (체크 ${e.checks}건)`));
  console.log(`\n[학생별 상세] ${records.length}건`);
  records.sort((a,b)=>a.grade-b.grade||a.classNum-b.classNum||a.num-b.num||a.nth-b.nth)
    .forEach(r => console.log(`  ${r.studentId} ${r.name} | ${r.colLabel} | ${new Date(r.occurredAt).toISOString().slice(0,10)} (${r.dateSource})${r.note?` | 비고: ${r.note}`:""}`));

  const out = process.env.PREVIEW_OUT || "/tmp/discipline_migration_preview.json";
  fs.writeFileSync(out, JSON.stringify({ records, excluded, generatedAt: null }, null, 2));
  console.log(`\n미리보기 JSON 저장: ${out} (실행 단계에서 이 파일을 그대로 사용)`);
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e?.response?.data || e);process.exit(1);});
