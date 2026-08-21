#!/usr/bin/env npx tsx
/**
 * 화면 머리 규칙 검사 (AGENTS.md 개발 체크리스트 7)
 *
 * 왜 기계가 보는가 — 2026-08-21에 사이드 메뉴 21개의 머리 모양이 세 종류로 갈려 있었다.
 * 짙은 배너 4 · 흰 카드 9 · 없음 8. 누가 게을러서가 아니라 **새 메뉴를 만들 때 참고할
 * 원본이 없어서** 그때그때 옆 화면을 베낀 결과였다. 규칙을 문서에만 적으면 같은 일이
 * 다시 벌어진다(AGENTS.md ④-3의 「안 지켜지는 규칙은 잊혀서면 자동화한다」).
 *
 * 검사 두 가지:
 *
 *  ① 사이드바에서 누른 이름 == 맨 위 줄에 뜨는 이름
 *     다르면 다른 데로 온 것처럼 읽힌다. 2026-08-21에 7곳이 어긋나 있었다.
 *
 *  ② 화면 컴포넌트 안에 페이지 제목을 다시 두지 않는다
 *     맨 위 줄이 이미 이름을 띄우므로 같은 말이 두 번 나온다.
 *     정당한 예외는 그 줄 위·같은 줄에 `header-ok:` 주석을 달아 사유를 남긴다.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const PAGE = path.join(ROOT, "src/app/teacher/page.tsx");

const src = fs.readFileSync(PAGE, "utf-8");
const lines = src.split("\n");

let fail = false;
const say = (s = "") => console.log(s);

// ── 맨 위 줄(h1)의 메뉴 이름 ──────────────────────────────
// {activeMenu === "users" && "사용자 전체관리"}
const topBar = new Map<string, string>();
for (const m of src.matchAll(/\{activeMenu === "(\w+)" && "([^"]+)"\}/g)) {
  topBar.set(m[1], m[2]);
}
// 여러 키가 한 이름을 쓰는 줄: {(activeMenu === "hub" || activeMenu === "memo") && "쪽지·업무"}
for (const m of src.matchAll(/\{\(([^)]*activeMenu === "[^)]*)\) && "([^"]+)"\}/g)) {
  for (const k of m[1].matchAll(/activeMenu === "(\w+)"/g)) topBar.set(k[1], m[2]);
}

// ── 사이드바 버튼의 이름 ─────────────────────────────────
const asideEnd = lines.findIndex((l) => l.includes("</aside>"));
const aside = lines.slice(0, asideEnd === -1 ? lines.length : asideEnd);

const sidebar = new Map<string, string>();
for (let i = 0; i < aside.length; i++) {
  const key = aside[i].match(/setActiveMenu\("(\w+)"\)/)?.[1];
  if (!key) continue;
  // 이 onClick이 버튼의 것인지 확인 — 위로 3줄 안에 <button 이 있어야 한다
  if (!aside.slice(Math.max(0, i - 3), i + 1).some((l) => l.includes("<button"))) continue;
  // 버튼이 닫히기 전까지의 <span> 중 한글/영문이 있는 첫 번째가 이름이다
  // (앞의 span은 아이콘 이모지, 뒤의 span은 안읽음 배지일 수 있다)
  for (let j = i; j < Math.min(aside.length, i + 25); j++) {
    if (j > i && aside[j].includes("</button>")) break;
    const t = aside[j].match(/<span[^>]*>([^<{}]+)<\/span>/)?.[1]?.trim();
    if (t && /[가-힣A-Za-z]/.test(t)) {
      sidebar.set(key, t);
      break;
    }
  }
}

// ── ① 이름 대조 ─────────────────────────────────────────
say("── 1/2 사이드바 이름 == 맨 위 줄 이름 ──────────");
const mismatches: string[] = [];
for (const [key, side] of sidebar) {
  const top = topBar.get(key);
  if (top === undefined) {
    mismatches.push(`  ❌ ${key}: 사이드바에 「${side}」가 있는데 맨 위 줄에 이름이 없다`);
  } else if (top !== side) {
    mismatches.push(`  ❌ ${key}: 눌렀을 때 「${side}」 / 떴을 때 「${top}」`);
  }
}
for (const key of topBar.keys()) {
  if (key !== "home" && !sidebar.has(key)) {
    // 사이드바 버튼이 없는 화면(딥링크·배너로만 진입)은 대조 대상이 아니다
  }
}
if (mismatches.length) {
  mismatches.forEach((m) => say(m));
  say(`  → 맨 위 줄은 「누른 이름」과 글자까지 같아야 한다. ${PAGE.replace(ROOT + "/", "")}를 고쳐라.`);
  fail = true;
} else {
  say(`  ✅ ${sidebar.size}개 메뉴 전부 일치`);
}

// ── ② 화면 안 페이지 제목 재사용 ─────────────────────────
say("");
say("── 2/2 화면 안에 페이지 제목이 다시 있는가 ─────");

const menuNames = [...topBar.values()];
const norm = (s: string) =>
  s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "src"));

const hits: string[] = [];
for (const f of files) {
  if (f === PAGE) continue; // 머리줄 자신
  const fl = fs.readFileSync(f, "utf-8").split("\n");
  for (let i = 0; i < fl.length; i++) {
    if (!/<h[12]\b/.test(fl[i])) continue;
    // 예외 표시: 같은 줄이나 위 4줄 안에 header-ok
    if (fl.slice(Math.max(0, i - 4), i + 1).some((l) => l.includes("header-ok:"))) continue;
    const text = norm(fl.slice(i, i + 4).join(" ").match(/>\s*([^<>{}]*[가-힣][^<>{}]*)</)?.[1] ?? "");
    if (!text) continue;
    const dup = menuNames.find((n) => {
      const a = norm(n);
      return a.length >= 4 && (text === a || text.startsWith(a) || a.startsWith(text));
    });
    if (dup) {
      hits.push(`  ❌ ${f.replace(ROOT + "/", "")}:${i + 1}  「${text}」 = 메뉴 이름 「${dup}」`);
    }
  }
}
if (hits.length) {
  hits.forEach((h) => say(h));
  say("  → 화면 이름은 맨 위 줄 하나에만 둔다. 제목을 지우고 버튼·딱지는 남겨라.");
  say('  → 정당한 예외라면 그 줄 위에 `{/* header-ok: 사유 */}` 를 달아라.');
  fail = true;
} else {
  say("  ✅ 페이지 제목을 다시 쓰는 화면 없음");
}

say("");
if (fail) {
  say("❌ 화면 머리 규칙 위반 — AGENTS.md 「개발 체크리스트」 7 참조");
  process.exit(1);
}
say("✅ 화면 머리 규칙 통과");
