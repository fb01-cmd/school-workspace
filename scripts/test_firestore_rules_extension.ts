/**
 * 읽기 전용 — §11-7 2계층 저장 규칙을 Rules API 시뮬레이터(projects.test)로 검증한다.
 * 게시하지 않고 임의 소스를 그대로 평가하므로, **게시 전에** 돌려서 판정을 받는 것이 목적이다.
 *
 * 검증 항목 (스펙 §11-7 "완료 조건 — 2계층 검증"):
 *   ① 본인이 extension만 바꾸는 업데이트 → ALLOW
 *   ④ 본인이 departments를 바꾸는 업데이트 → DENY (2026-07-25 잠금이 유지되는가)
 *   + 회귀: 남의 문서 extension 수정 DENY / 20자 초과 DENY / updatedBy 위조 DENY /
 *          extension 비문자열 DENY / 수퍼어드민 전체 쓰기 ALLOW
 *
 *   npx tsx scripts/test_firestore_rules_extension.ts
 */
import * as fs from "fs";
import * as path from "path";
import { loadEnvLocal, rulesClient, RULES_API } from "./inspect_firestore_rules";

const TEACHER_UID = "uid_teacher";
const ADMIN_UID = "uid_admin";
const ME = "teacher@hmh.or.kr";
const OTHER = "other@hmh.or.kr";
const ADMIN = "admin@hmh.or.kr";

/** users/{uid} get() 호출을 가로채 role을 돌려준다 — isTeacher()/isSuperAdmin()이 이걸 읽는다 */
function userDocMocks(uid: string, role: string) {
  return [
    {
      function: "get",
      args: [{ exact_value: `/databases/(default)/documents/users/${uid}` }],
      result: { value: { data: { role } } },
    },
  ];
}

function authToken(email: string, uid: string) {
  return {
    uid,
    token: { email, email_verified: true, firebase: { sign_in_provider: "google.com" } },
  };
}

const BASE_PROFILE = {
  email: ME,
  name: "홍길동",
  departments: ["교무기획부"],
  position: "부장",
  extension: "1234",
  deptHeadMap: { 교무기획부: true },
  isHomeroom: false,
  updatedBy: ADMIN,
};

/** teacher_profiles/{email} 문서에 대한 update 테스트 케이스 하나 */
function updateCase(opts: {
  title: string;
  docEmail: string;
  auth: { uid: string; email: string; role: string };
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
  expect: "ALLOW" | "DENY";
}) {
  const before = opts.before ?? BASE_PROFILE;
  // API의 TestCase 스키마에는 title이 없다 — 제목은 로컬에만 두고 요청에서 분리한다.
  return {
    title: opts.title,
    testCase: {
      expectation: opts.expect,
      functionMocks: userDocMocks(opts.auth.uid, opts.auth.role),
      request: {
        auth: authToken(opts.auth.email, opts.auth.uid),
        method: "update",
        path: `/databases/(default)/documents/teacher_profiles/${opts.docEmail}`,
        time: "2026-08-13T05:00:00Z",
        resource: { data: opts.after },
      },
      resource: { data: before },
    },
  };
}

const TEACHER = { uid: TEACHER_UID, email: ME, role: "teacher" };
const SUPER = { uid: ADMIN_UID, email: ADMIN, role: "super_admin" };

/** platform_config/{doc} 에 대한 접근 케이스 (절약 모드 스위치 — saving_mode_spec §3) */
function platformConfigCase(opts: {
  title: string;
  doc: string;
  method: "get" | "update";
  auth?: { uid: string; email: string; role: string };
  expect: "ALLOW" | "DENY";
}) {
  return {
    title: opts.title,
    testCase: {
      expectation: opts.expect,
      functionMocks: opts.auth ? userDocMocks(opts.auth.uid, opts.auth.role) : [],
      request: {
        ...(opts.auth ? { auth: authToken(opts.auth.email, opts.auth.uid) } : {}),
        method: opts.method,
        path: `/databases/(default)/documents/platform_config/${opts.doc}`,
        time: "2026-08-18T05:00:00Z",
        ...(opts.method === "update" ? { resource: { data: { on: true } } } : {}),
      },
      ...(opts.method === "update" ? { resource: { data: { on: false } } } : {}),
    },
  };
}

const CASES = [
  updateCase({
    title: "① 본인이 내선번호만 수정 → 허용되어야 한다 (2계층 즉시 저장)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: "5678", updatedBy: ME },
    expect: "ALLOW",
  }),
  updateCase({
    title: "④ 본인이 소속(departments)을 변경 → 거부되어야 한다 (2026-07-25 잠금 유지)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, departments: ["연구부"], updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "④-b 본인이 내선과 소속을 함께 변경 → 거부 (내선을 방패로 쓰지 못한다)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: "5678", departments: ["연구부"], updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "④-c 본인이 담임 배정을 변경 → 거부 (생활지도 열람 권한 근거)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, isHomeroom: true, updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "남의 프로필 내선 수정 → 거부",
    docEmail: OTHER,
    auth: TEACHER,
    before: { ...BASE_PROFILE, email: OTHER },
    after: { ...BASE_PROFILE, email: OTHER, extension: "9999", updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "내선 20자 초과 → 거부 (클라이언트 maxLength 우회 방어)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: "1".repeat(21), updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "내선 20자 정확히 → 허용 (경계값)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: "1".repeat(20), updatedBy: ME },
    expect: "ALLOW",
  }),
  updateCase({
    title: "내선이 문자열이 아님(숫자) → 거부",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: 5678, updatedBy: ME },
    expect: "DENY",
  }),
  updateCase({
    title: "updatedBy를 남의 이메일로 위조 → 거부 (감사 흔적 위조 방지)",
    docEmail: ME,
    auth: TEACHER,
    after: { ...BASE_PROFILE, extension: "5678", updatedBy: OTHER },
    expect: "DENY",
  }),
  updateCase({
    title: "회귀: 수퍼어드민은 소속까지 전체 수정 가능 (승인 경로가 죽지 않았는가)",
    docEmail: ME,
    auth: SUPER,
    after: { ...BASE_PROFILE, departments: ["연구부"], updatedBy: ADMIN },
    expect: "ALLOW",
  }),
  updateCase({
    title: "회귀: 비로그인 사용자의 내선 수정 → 거부",
    docEmail: ME,
    auth: { uid: "uid_anon", email: "outsider@gmail.com", role: "teacher" },
    after: { ...BASE_PROFILE, extension: "5678", updatedBy: "outsider@gmail.com" },
    expect: "DENY",
  }),
  // ── 절약 모드 스위치 (2026-08-18 추가 규칙) ──
  platformConfigCase({
    title: "절약: 교사가 절약 모드 스위치를 읽음 → 허용 (구독이 성립해야 레버가 퍼진다)",
    doc: "saving_mode",
    method: "get",
    auth: TEACHER,
    expect: "ALLOW",
  }),
  platformConfigCase({
    title: "절약: 비로그인 사용자가 스위치를 읽음 → 거부",
    doc: "saving_mode",
    method: "get",
    expect: "DENY",
  }),
  platformConfigCase({
    title: "절약: 수퍼어드민이라도 클라이언트에서 직접 씀 → 거부 (쓰기는 서버 경유만)",
    doc: "saving_mode",
    method: "update",
    auth: SUPER,
    expect: "DENY",
  }),
  platformConfigCase({
    title: "절약: 같은 컬렉션의 다른 문서(첨부 폴더 캐시) 읽기 → 거부 (예외는 스위치 1건뿐)",
    doc: "attachment_folders",
    method: "get",
    auth: TEACHER,
    expect: "DENY",
  }),
];

async function main() {
  loadEnvLocal();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
  const client = rulesClient();
  const source = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

  const res: any = await client.request({
    url: `${RULES_API}/projects/${projectId}:test`,
    method: "POST",
    data: {
      source: { files: [{ name: "firestore.rules", content: source }] },
      testSuite: { testCases: CASES.map((c) => c.testCase) },
    },
  });

  const issues = res.data.issues || [];
  if (issues.length) {
    console.log("규칙 컴파일 문제:");
    issues.forEach((i: any) => console.log(" ", i.severity, i.description));
  }

  const results = res.data.testResults || [];
  let failed = 0;
  results.forEach((r: any, i: number) => {
    const ok = r.state === "SUCCESS";
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} [${CASES[i].testCase.expectation}] ${CASES[i].title}`);
    if (!ok) {
      console.log(`     실제 판정이 기대와 다름 (state=${r.state})`);
      (r.errorPosition ? [r.errorPosition] : []).forEach((p: any) =>
        console.log(`     line ${p.line}`)
      );
    }
  });

  console.log(`\n${results.length - failed}/${results.length} 통과`);
  if (failed || issues.some((i: any) => i.severity === "ERROR")) process.exit(1);
}

main().catch((e) => {
  console.error("실패:", JSON.stringify(e?.response?.data || e.message, null, 2));
  process.exit(1);
});
