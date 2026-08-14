/**
 * 일과계 질문지를 구글 문서로 생성 (docs/questionnaire_handout.html → Google Docs)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/create_questionnaire_doc.ts
 *   npx tsx --env-file=.env.local scripts/create_questionnaire_doc.ts --owner=fb01@hmh.or.kr --name="..."
 *
 * 방식: Drive API가 업로드 시 HTML을 구글 문서로 자동 변환한다(Docs API 스코프 불요).
 *       표·체크박스(☐)·제목 구조가 그대로 넘어간다.
 *
 * 공유하지 않는다 — 소유자 본인만 볼 수 있는 상태로 만든다. 누구에게 언제 줄지는
 * 사용자가 정할 일이고, 시스템이 대신 보내지 않는다(AGENTS.md 정보 전달 경계).
 *
 * 원본은 저장소의 docs/questionnaire_handout.html 이다. 문구를 고칠 땐 그 파일을 고치고
 * 이 스크립트를 다시 돌려 새 문서를 만든다(기존 문서를 덮어쓰지 않는다).
 */
import * as fs from "fs";
import * as path from "path";
import { getDriveClient } from "../src/lib/google/workspace";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function run() {
  const owner = arg("owner") || "fb01@hmh.or.kr";
  const name = arg("name") || "시간표 자동 작성 준비 — 여쭤볼 것들 (일과계 질문지)";
  const src = path.join(__dirname, "..", "docs", "questionnaire_handout.html");

  if (!fs.existsSync(src)) throw new Error(`원본이 없다: ${src}`);
  const html = fs.readFileSync(src, "utf8");

  // 전달 금지 구역이 섞여 들어가지 않았는지 확인 — 원본 md의 [제2부]는 내부 메모다.
  if (/제2부|내부 메모|전달 금지/.test(html)) {
    throw new Error("중단: 내부 메모(제2부) 문구가 산출물에 섞여 있다. docs/questionnaire_handout.html을 확인하라.");
  }

  console.log(`구글 문서 생성 중...`);
  console.log(`  소유자 : ${owner}`);
  console.log(`  제목   : ${name}`);

  const drive = getDriveClient(owner);
  if (!drive) throw new Error("Drive 클라이언트를 만들지 못했다 — 서비스 계정 환경변수를 확인하라.");
  const res = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: "text/html", body: html },
    fields: "id, name, webViewLink, owners(emailAddress)",
    supportsAllDrives: true,
  });

  const f = res.data as any;
  console.log(`\n✅ 생성 완료`);
  console.log(`  제목   : ${f.name}`);
  console.log(`  소유자 : ${f.owners?.[0]?.emailAddress || owner}`);
  console.log(`  링크   : ${f.webViewLink}`);
  console.log(`\n공유는 하지 않았다 — 소유자만 볼 수 있다. 전달은 사용자가 직접 한다.`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error("\n생성 실패:", e?.errors?.[0]?.message || e.message);
  process.exit(1);
});
