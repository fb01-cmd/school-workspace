// 생활지도 시트 3부 구조·현재 체크 실측 (읽기 전용 — 브리지 매핑 스펙용)
// 실행: npx tsx --env-file=.env.local scripts/inspect_discipline_sheets.ts
import { google } from "googleapis";

const IMPERSONATE = "admin@hmh.or.kr";
const SHEETS: Record<number, string> = {
  1: "1T50su8s2SCYJ96koiGxwugrWEADLLHFmZ2-LOVxf4VY",
  2: "1GarUv1xBpi_8Xht9cD9-UsDkEZnGI2iLFj-NGbrhf-s",
  3: "1p9CGMtQl953T7Y_o88dalNG52tifzBJPia_AO6Dryf0",
};
const COL_LABELS = ["번호","이름","교복1","교복2","교복3","흡연1","흡연2","휴대폰1","휴대폰2","비고"];

function jwt(scopes: string[]) {
  const key = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key, scopes, subject: IMPERSONATE,
  });
}

async function run() {
  const api = google.sheets({ version: "v4", auth: jwt(["https://www.googleapis.com/auth/spreadsheets"]) });
  let grandTotal = 0;
  for (const [gradeStr, id] of Object.entries(SHEETS)) {
    const grade = +gradeStr;
    const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))" });
    console.log(`\n===== ${grade}학년: "${meta.data.properties?.title}" =====`);
    console.log("탭:", (meta.data.sheets || []).map(s => `${s.properties?.title}(${s.properties?.gridProperties?.rowCount}x${s.properties?.gridProperties?.columnCount})`).join(", "));

    // 첫 학급 탭 머리글 확인
    const firstTab = `${grade}-1`;
    const head = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${firstTab}'!A1:J3` });
    console.log(`머리글 ('${firstTab}'!A1:J3):`);
    (head.data.values || []).forEach((r, i) => console.log(`  ${i + 1}행: ${JSON.stringify(r)}`));

    // 전 학급 체크 스캔
    let gradeTotal = 0;
    const perCol = new Array(7).fill(0);
    for (let c = 1; c <= 10; c++) {
      const tab = `${grade}-${c}`;
      let v;
      try {
        v = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A4:J80`, valueRenderOption: "UNFORMATTED_VALUE" });
      } catch { console.log(`  (탭 ${tab} 없음)`); continue; }
      let classChecks = 0;
      for (const row of v.data.values || []) {
        const num = Number(row[0]); const name = String(row[1] ?? "").trim();
        if (!Number.isInteger(num) || num < 1 || !name) continue;
        for (let col = 2; col <= 8; col++) if (row[col] === true) { classChecks++; perCol[col - 2]++; }
      }
      gradeTotal += classChecks;
      if (classChecks) console.log(`  ${tab}: 체크 ${classChecks}건`);
    }
    console.log(`${grade}학년 합계 ${gradeTotal}건 — 열별: ${COL_LABELS.slice(2, 9).map((l, i) => `${l}=${perCol[i]}`).join(" ")}`);
    grandTotal += gradeTotal;
  }
  console.log(`\n총 체크 ${grandTotal}건 (이관 시점 173건과 비교)`);
}
run().then(() => process.exit(0)).catch(e => { console.error(e?.response?.data || e); process.exit(1); });
