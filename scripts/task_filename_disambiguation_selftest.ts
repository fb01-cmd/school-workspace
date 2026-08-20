/**
 * task_filename_disambiguation_selftest.ts
 *
 * 과제 G 셀프테스트 (2026-08-20)
 * ⓐ 구분자 없을 때 종전과 완전히 동일
 * ⓑ 동명이인 두 번째 제출자에게만 아이디가 붙는다
 * ⓒ 같은 사람이 재제출하면 이름이 바뀌지 않는다 (덮어쓰기 대상 유지)
 * ⓓ 이름·소속·업무명·구분자에 특수문자가 있어도 깨지지 않는다
 *
 * 실행: npx tsx scripts/task_filename_disambiguation_selftest.ts
 */

import { normalizeSubmissionFileName } from "../src/lib/tasks/logic";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log("=== 과제 G: 업무 제출 파일명 동명이인 구분 셀프테스트 ===");

// ── Case 1 (ⓐ): 구분자 없을 때 결과가 종전과 완전히 동일 ──
console.log("\n[Case 1] 구분자 없을 때 결과가 종전과 완전히 동일한지 검증");
const legacyHomeroom = normalizeSubmissionFileName({
  taskTitle: "현장체험 동의서",
  submitterName: "홍길동",
  homeroom: { grade: 2, class: 3 },
  departments: ["교무부"],
  originalName: "동의서.hwp",
});
assert(
  legacyHomeroom === "2학년3반_홍길동_현장체험 동의서.hwp",
  `담임 제출 파일명 불일치: ${legacyHomeroom}`
);

const legacyDept = normalizeSubmissionFileName({
  taskTitle: "파일제출",
  submitterName: "이현준",
  departments: ["휴직 교사"],
  originalName: "스크린샷.jpg",
});
assert(
  legacyDept === "휴직 교사_이현준_파일제출.jpg",
  `부서 제출 파일명 불일치: ${legacyDept}`
);
console.log("  ✅ Case 1 통과: 구분자 없을 때 종전 생성 규칙 100% 일치");

// ── Case 2 (ⓑ): 동명이인 두 번째 제출자에게만 아이디가 붙는다 ──
console.log("\n[Case 2] 동명이인 두 번째 제출자에게만 아이디가 붙는지 시뮬레이션");
const taskSubmissions: Record<string, { name: string }> = {};

// 첫 번째 제출자: user1@school.kr (이현준)
const user1Email = "user1@school.kr";
let user1FileName = normalizeSubmissionFileName({
  taskTitle: "파일제출",
  submitterName: "이현준",
  departments: ["휴직 교사"],
  originalName: "screen.png",
});
const user1Dup = Object.entries(taskSubmissions).some(
  ([subEmail, sub]) => subEmail !== user1Email && sub.name === user1FileName
);
if (user1Dup) {
  user1FileName = normalizeSubmissionFileName({
    taskTitle: "파일제출",
    submitterName: "이현준",
    departments: ["휴직 교사"],
    originalName: "screen.png",
    disambiguator: user1Email.split("@")[0],
  });
}
taskSubmissions[user1Email] = { name: user1FileName };
assert(
  user1FileName === "휴직 교사_이현준_파일제출.png",
  `첫 번째 제출자 파일명 오류: ${user1FileName}`
);

// 두 번째 제출자: user2@school.kr (이현준 - 동명이인 같은 부서)
const user2Email = "user2@school.kr";
let user2FileName = normalizeSubmissionFileName({
  taskTitle: "파일제출",
  submitterName: "이현준",
  departments: ["휴직 교사"],
  originalName: "screen.png",
});
const user2Dup = Object.entries(taskSubmissions).some(
  ([subEmail, sub]) => subEmail !== user2Email && sub.name === user2FileName
);
if (user2Dup) {
  user2FileName = normalizeSubmissionFileName({
    taskTitle: "파일제출",
    submitterName: "이현준",
    departments: ["휴직 교사"],
    originalName: "screen.png",
    disambiguator: user2Email.split("@")[0],
  });
}
taskSubmissions[user2Email] = { name: user2FileName };
assert(
  user2FileName === "휴직 교사_이현준(user2)_파일제출.png",
  `두 번째 제출자 파일명 오류: ${user2FileName}`
);
assert(
  taskSubmissions[user1Email].name === "휴직 교사_이현준_파일제출.png",
  "첫 번째 제출자 파일명이 불변이어야 함"
);
console.log("  ✅ Case 2 통과: 첫 번째는 원본 유지, 두 번째에만 (아이디) 구분자 추가");

// ── Case 3 (ⓒ): 같은 사람이 재제출하면 이름이 바뀌지 않는다 (덮어쓰기 대상 유지) ──
console.log("\n[Case 3] 같은 사람이 재제출할 때 파일명 불변 검증");

// user1 재제출
let user1Resubmit = normalizeSubmissionFileName({
  taskTitle: "파일제출",
  submitterName: "이현준",
  departments: ["휴직 교사"],
  originalName: "screen_new.png",
});
const user1ResubmitDup = Object.entries(taskSubmissions).some(
  ([subEmail, sub]) => subEmail !== user1Email && sub.name === user1Resubmit
);
if (user1ResubmitDup) {
  user1Resubmit = normalizeSubmissionFileName({
    taskTitle: "파일제출",
    submitterName: "이현준",
    departments: ["휴직 교사"],
    originalName: "screen_new.png",
    disambiguator: user1Email.split("@")[0],
  });
}
assert(
  user1Resubmit === taskSubmissions[user1Email].name,
  `user1 재제출 파일명이 기존과 다름: ${user1Resubmit} vs ${taskSubmissions[user1Email].name}`
);

// user2 재제출
let user2Resubmit = normalizeSubmissionFileName({
  taskTitle: "파일제출",
  submitterName: "이현준",
  departments: ["휴직 교사"],
  originalName: "screen_v2.png",
});
const user2ResubmitDup = Object.entries(taskSubmissions).some(
  ([subEmail, sub]) => subEmail !== user2Email && sub.name === user2Resubmit
);
if (user2ResubmitDup) {
  user2Resubmit = normalizeSubmissionFileName({
    taskTitle: "파일제출",
    submitterName: "이현준",
    departments: ["휴직 교사"],
    originalName: "screen_v2.png",
    disambiguator: user2Email.split("@")[0],
  });
}
assert(
  user2Resubmit === taskSubmissions[user2Email].name,
  `user2 재제출 파일명이 기존과 다름: ${user2Resubmit} vs ${taskSubmissions[user2Email].name}`
);
console.log("  ✅ Case 3 통과: user1/user2 모두 재제출 시 기존 파일명과 일치하여 덮어쓰기 대상 유지");

// ── Case 4 (ⓓ): 이름·소속·업무명·구분자에 특수문자가 있어도 깨지지 않는다 ──
console.log("\n[Case 4] 특수문자 및 확장자 대소문자 정규화 검증");
const specialCharFileName = normalizeSubmissionFileName({
  taskTitle: "체험<학습>|동의서*?",
  submitterName: "홍/길:동",
  departments: ["교무/연구부"],
  disambiguator: "user:01*test",
  originalName: "REPORT.PDF",
});
assert(
  specialCharFileName === "교무_연구부_홍_길_동(user_01_test)_체험_학습__동의서__.pdf",
  `특수문자 파일명 정규화 불일치: ${specialCharFileName}`
);
assert(!/[\/\\:*?"<>|\u0000-\u001f]/.test(specialCharFileName), "금지된 파일명 특수문자가 포함됨");
assert(specialCharFileName.endsWith(".pdf"), "확장자가 소문자로 정상 변환되지 않음");
console.log("  ✅ Case 4 통과: 특수문자가 언더스코어로 안전 치환되고 확장자 소문자 변환 완료");

// ── Case 5 (ⓔ): 150자 상한에서도 확장자가 살아남는다 (2026-08-21, Codex 발견 결함) ──
console.log("\n[Case 5] 이름이 아주 길 때 확장자가 잘리지 않는지 검증");

// 경계: base 길이가 (150 - 확장자길이) 를 넘는 순간부터 확장자가 잘렸다.
// ".hwpx"(5자) 기준 base 146자부터 결함이 나고, 150자부터는 확장자가 통째로 사라진다.
// 아래 입력은 base 185자로 경계를 확실히 넘긴다 — 종전 코드로는 반드시 실패한다.
const longDept = "가".repeat(120);
const longTitle = "나".repeat(80); // 내부에서 60자로 잘린다
const longFileName = normalizeSubmissionFileName({
  taskTitle: longTitle,
  submitterName: "홍길동",
  departments: [longDept],
  originalName: "제출물.hwpx",
});
assert(
  longFileName.length <= 150,
  `150자 상한 위반: ${longFileName.length}자`
);
assert(
  longFileName.endsWith(".hwpx"),
  `확장자가 잘렸다 — 이 파일은 열리지 않는다: ...${longFileName.slice(-12)}`
);

// 경계 바로 위(base 146자) — 종전 코드는 여기서 ".hwp" 로 한 글자만 갉아먹어
// "형식은 맞는데 열리는 프로그램이 다른" 가장 알아채기 어려운 형태가 됐다.
const boundary = normalizeSubmissionFileName({
  taskTitle: "나".repeat(60),
  submitterName: "홍길동",
  departments: ["가".repeat(81)], // 81 + 1 + 3 + 1 + 60 = 146
  originalName: "제출물.hwpx",
});
assert(
  boundary.endsWith(".hwpx"),
  `경계(base 146자)에서 확장자가 변형됐다: ...${boundary.slice(-8)}`
);

// 구분자까지 붙은 최악의 경우에도 확장자가 남아야 한다.
const longWithDis = normalizeSubmissionFileName({
  taskTitle: longTitle,
  submitterName: "가".repeat(40),
  departments: [longDept],
  disambiguator: "verylongaccountname12",
  originalName: "스캔본.jpeg",
});
assert(longWithDis.length <= 150, `150자 상한 위반(구분자): ${longWithDis.length}자`);
assert(
  longWithDis.endsWith(".jpeg"),
  `구분자 포함 시 확장자가 잘렸다: ...${longWithDis.slice(-12)}`
);

// 회귀 방어: 150자 안에 들어가는 평범한 입력은 결과가 종전과 한 글자도 달라지면 안 된다.
const shortUnchanged = normalizeSubmissionFileName({
  taskTitle: "현장체험 동의서",
  submitterName: "홍길동",
  homeroom: { grade: 2, class: 3 },
  originalName: "동의서.hwp",
});
assert(
  shortUnchanged === "2학년3반_홍길동_현장체험 동의서.hwp",
  `짧은 입력에서 회귀 발생: ${shortUnchanged}`
);
console.log("  ✅ Case 5 통과: 상한 초과 시 base 만 잘리고 확장자는 보존, 짧은 입력은 종전과 동일");

console.log("\n🎉 모든 5개 케이스 셀프테스트 성공 (5/5 passed)!");
