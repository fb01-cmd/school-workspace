/**
 * 안내문 템플릿에 포털 주소가 "치환자"로 들어 있는지 "직접 타이핑"돼 굳어 있는지 확인한다.
 *
 * 화면 주소 이름 통일(로드맵 §2) 착수 전 필수 점검 — 관리자가 화면에서 편집한 템플릿은
 * Firestore settings/{domain} 에 저장되고 코드 폴백보다 우선하므로, 주소를 직접 적어 넣었다면
 * 코드를 바꿔도 안내문은 옛 주소를 계속 내보낸다. 읽기는 settings 컬렉션 문서 수만큼(수 건).
 *
 * 실행: npx tsx --env-file=.env.local scripts/inspect_notice_templates.ts
 */
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

// 템플릿이 사는 자리 = settings/{domain} 의 이 세 묶음
const GROUPS = [
  { key: "transferOutSettings", label: "학생 전출·자퇴", fields: ["emailTemplateSubject", "emailTemplateBody"] },
  { key: "teacherTransferSettings", label: "교사 전출", fields: ["emailTemplateSubject", "emailTemplateBody", "chatTemplateBody", "reminderChatTemplateBody"] },
  { key: "graduationSettings", label: "졸업생", fields: ["emailTemplateSubject", "emailTemplateBody", "chatTemplateBody"] },
];

// 굳어 있으면 위험한 주소 패턴
const HARDCODED = /https?:\/\/[^\s)]*(?:hmh\.or\.kr|vercel\.app)[^\s)]*/gi;
const PLACEHOLDER = /\{(portalUrl|deadlineUrl)\}/g;

async function main() {
  const snap = await db.collection("settings").get();
  console.log(`settings 문서 ${snap.size}건 읽음\n`);

  let risky = 0;
  for (const doc of snap.docs) {
    console.log(`━━━ settings/${doc.id} ━━━`);
    const data = doc.data() || {};
    // 어떤 이름으로 저장돼 있는지 모를 수 있으므로 실제 키도 같이 보여준다
    const presentGroups = Object.keys(data).filter((k) => /Settings$/.test(k));
    console.log(`  이 문서의 *Settings 키: ${presentGroups.join(", ") || "(없음)"}`);

    for (const g of GROUPS) {
      const grp = (data as Record<string, any>)[g.key];
      if (!grp || typeof grp !== "object") {
        console.log(`  · ${g.label} (${g.key}): 저장된 템플릿 없음 → 코드 폴백 사용 (안전)`);
        continue;
      }
      for (const f of g.fields) {
        const v = grp[f];
        if (typeof v !== "string" || !v) continue;
        const hard = v.match(HARDCODED) || [];
        const ph = v.match(PLACEHOLDER) || [];
        if (hard.length > 0) {
          risky++;
          console.log(`  ⚠️  ${g.label}.${f} — 주소가 직접 박혀 있음: ${[...new Set(hard)].join(" , ")}`);
        } else if (ph.length > 0) {
          console.log(`  ✅ ${g.label}.${f} — 치환자 사용 (${[...new Set(ph)].join(",")}) → 주소 변경 자동 반영`);
        } else {
          console.log(`  ·  ${g.label}.${f} — 주소·치환자 없음`);
        }
      }
    }
    console.log();
  }

  console.log(risky === 0
    ? "결론: 직접 박힌 주소 0건 — 코드만 바꾸면 안내문은 새 주소를 자동으로 따라간다."
    : `결론: 직접 박힌 주소 ${risky}건 — 주소를 바꾸기 전에 이 템플릿들을 먼저 고쳐야 한다.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
