/**
 * users 문서 ↔ GWS 실계정 대조 정리 (정지·유령 문서 자가 치유)
 *
 * ── 왜 "정지 액션에 붙이지 않고" 대조하는가 ────────────────────────────────
 * 이 시스템의 규약은 **"users 문서의 부재 = 차단"**이다(`admin.ts`의 `verifyAuthAccess`
 * 주석 참조). 삭제 경로에는 `deleteFirestoreUserDocsByEmail`이 이미 물려 있어 규약이
 * 지켜지지만, **정지(suspend)에는 아무것도 물려 있지 않았다** — 정지 계정의 users 문서가
 * 살아남아 권한이 유지되고 고지 현황 등 전수 화면에도 계속 뜬다.
 *
 * 정지를 거는 자리(`lifecycle/route.ts` 4곳)마다 삭제를 붙이는 방법은 채택하지 않았다.
 * **GWS 콘솔에서 직접 정지·삭제한 건 플랫폼이 영영 알 수 없기 때문이다.** 실제로 유령
 * 문서 `24343@`이 그 경우였다(콘솔 삭제, 플랫폼 삭제 흐름 미경유). 액션마다 붙이면 4곳을
 * 고쳐도 콘솔 경로는 계속 샌다. 대조는 경로와 무관하게 자가 치유하며 소재지도 한 곳이다.
 *
 * ── 무손실인 이유 ────────────────────────────────────────────────────────
 * 정지가 풀리면 그 사람이 로그인하는 순간 `sync-user`가 문서를 다시 만든다. 정지 중에는
 * 구글 로그인 자체가 안 되므로 문서가 할 일이 없다. 즉 이 정리는 "지우는" 게 아니라
 * **규약이 이미 정한 상태로 되돌리는 것**이다.
 *
 * ── 안전 규칙 (하나라도 어기면 전 사용자 문서가 날아간다) ──────────────────
 *  ⓐ GWS 조회가 실패하면 **아무것도 지우지 않는다**. 조회 실패를 "전원 삭제됨"으로 오독하는
 *     것이 이 기능의 유일한 파국이다. 목록이 비어 있어도 같은 이유로 중단한다.
 *  ⓑ 보호 계정(`isProtectedAccountEmail`)은 어떤 경우에도 대상에서 제외한다.
 *  ⓒ 지운 건 감사 로그에 남긴다.
 *  ⓓ **읽기 순서**: Firestore 문서를 먼저 읽고 GWS 목록을 나중에 받는다. 반대로 하면 그
 *     사이에 새로 만들어진 계정이 "GWS에 없는 유령"으로 오판돼 방금 만든 문서가 지워진다.
 *  ⓔ **신규 유예**: 만들어진 지 1시간 이내인 문서는 유령 판정에서 제외한다(디렉터리 목록
 *     반영 지연 대비). 크론은 하루 1회이므로 유예 비용은 사실상 0이다.
 *  ⓕ **상한**: 후보가 전체의 30%(최소 5건)를 넘으면 삭제하지 않고 중단·기록한다. 목록이
 *     부분적으로만 받아졌을 때의 최후 방어선 — 대량 정리는 사람이 판단한다.
 */
import { adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { listUsersInOUs, invalidateUserCache, isMock } from "@/lib/google/workspace";
import { isProtectedAccountEmail } from "@/lib/auth/blockedOu";

/** 신규 문서 유예 (안전 규칙 ⓔ) */
const RECENT_DOC_GRACE_MS = 60 * 60 * 1000;
/** 대량 삭제 상한 (안전 규칙 ⓕ) */
const MAX_DELETE_RATIO = 0.3;
const MAX_DELETE_FLOOR = 5;

export interface ReconcileUserDocsResult {
  /** 삭제를 수행하지 않고 중단했는가 (안전 규칙 발동 또는 dryRun) */
  skipped: boolean;
  /** 중단 사유 (skipped일 때만) */
  reason?: string;
  gwsUserCount: number;
  userDocCount: number;
  /** GWS에 아예 없는 계정의 문서 (유령) */
  ghosts: string[];
  /** GWS에 있으나 정지된 계정의 문서 */
  suspended: string[];
  /** 보호 계정이라 건너뛴 것 */
  protectedSkipped: string[];
  /** 신규 유예로 건너뛴 것 */
  graceSkipped: string[];
}

/**
 * users 컬렉션을 GWS 실계정과 대조해 정지·유령 문서를 정리한다.
 *
 * @param opts.dryRun      true면 대상만 계산하고 삭제·감사로그를 하지 않는다.
 * @param opts.refreshCache true면 GWS 사용자 캐시(60초)를 비우고 새로 받는다.
 *                          같은 실행에서 방금 정지시킨 계정까지 반영하려면 필요.
 * @param opts.operator    감사 로그에 남길 실행 주체 (기본: 크론). 수동 스크립트로 돌릴 때
 *                         크론이 한 것처럼 기록되면 이력 추적이 틀어진다.
 * @param opts.only        삭제 범위 제한 (기본 "all"). 수동으로 유령만 먼저 정리하고 정지분은
 *                         크론에 맡기는 식의 부분 실행용 — 판정 자체는 항상 전수로 한다.
 */
export async function reconcileUserDocsWithWorkspace(
  opts: {
    dryRun?: boolean;
    refreshCache?: boolean;
    operator?: { email: string; name: string };
    only?: "all" | "ghosts" | "suspended";
  } = {}
): Promise<ReconcileUserDocsResult> {
  const {
    dryRun = false,
    refreshCache = false,
    operator = { email: "system@cron", name: "[자동 처리] 크론 스케줄러" },
    only = "all",
  } = opts;
  const empty = (reason: string): ReconcileUserDocsResult => ({
    skipped: true,
    reason,
    gwsUserCount: 0,
    userDocCount: 0,
    ghosts: [],
    suspended: [],
    protectedSkipped: [],
    graceSkipped: [],
  });

  // 안전 규칙 ⓐ — 자격증명이 없으면 workspace 라이브러리가 목 데이터를 돌려준다.
  // 그 목록으로 대조하면 실사용자 전원이 "유령"이 된다.
  if (isMock) return empty("GWS 자격증명 없음(목 모드) — 대조 생략");

  // 안전 규칙 ⓓ — 문서를 먼저 읽는다.
  const docsSnap = await adminDb.collection("users").get();

  if (refreshCache) invalidateUserCache();
  let gwsUsers: any[];
  try {
    gwsUsers = await listUsersInOUs(["all"]);
  } catch (err: any) {
    // 안전 규칙 ⓐ — 조회 실패는 "전원 삭제됨"이 아니다.
    return empty(`GWS 사용자 조회 실패 — 삭제 생략: ${err?.message || err}`);
  }
  if (!Array.isArray(gwsUsers) || gwsUsers.length === 0) {
    return empty("GWS 사용자 목록이 비어 있음 — 삭제 생략");
  }

  const gwsByEmail = new Map<string, { suspended: boolean }>();
  for (const u of gwsUsers) {
    const email = String(u?.primaryEmail || "").trim().toLowerCase();
    if (!email) continue;
    gwsByEmail.set(email, { suspended: u?.suspended === true });
  }

  const now = Date.now();
  const ghosts: { email: string; ref: FirebaseFirestore.DocumentReference }[] = [];
  const suspended: { email: string; ref: FirebaseFirestore.DocumentReference }[] = [];
  const protectedSkipped: string[] = [];
  const graceSkipped: string[] = [];

  for (const doc of docsSnap.docs) {
    const data = doc.data() || {};
    const email = String(data.email || "").trim().toLowerCase();

    // 안전 규칙 ⓑ — 보호 계정은 어떤 판정에도 걸리지 않는다.
    if (email && isProtectedAccountEmail(email)) {
      protectedSkipped.push(email);
      continue;
    }

    const gws = email ? gwsByEmail.get(email) : undefined;

    if (!gws) {
      // 안전 규칙 ⓔ — 갓 만들어진 문서는 디렉터리 반영 지연일 수 있다.
      const createdAtMs =
        data.createdAt?.toDate?.() instanceof Date ? data.createdAt.toDate().getTime() : null;
      if (createdAtMs !== null && now - createdAtMs < RECENT_DOC_GRACE_MS) {
        graceSkipped.push(email || `(email 없음, uid ${doc.id})`);
        continue;
      }
      // email 필드가 없는 문서도 유령으로 본다 — sync-user는 항상 email을 기록한다.
      ghosts.push({ email: email || `(email 없음, uid ${doc.id})`, ref: doc.ref });
      continue;
    }

    if (gws.suspended) suspended.push({ email, ref: doc.ref });
  }

  // 판정은 항상 전수로 하고(위 결과 배열은 그대로 보고된다), 삭제 범위만 좁힌다.
  const targets =
    only === "ghosts" ? ghosts : only === "suspended" ? suspended : [...ghosts, ...suspended];
  const result: ReconcileUserDocsResult = {
    skipped: false,
    gwsUserCount: gwsByEmail.size,
    userDocCount: docsSnap.size,
    ghosts: ghosts.map((t) => t.email),
    suspended: suspended.map((t) => t.email),
    protectedSkipped,
    graceSkipped,
  };

  if (targets.length === 0) return result;

  // 안전 규칙 ⓕ — 상한 초과는 사람이 판단한다.
  const ceiling = Math.max(MAX_DELETE_FLOOR, Math.floor(docsSnap.size * MAX_DELETE_RATIO));
  if (targets.length > ceiling) {
    const reason = `정리 대상 ${targets.length}건이 상한(${ceiling}건)을 초과 — 삭제 생략, 수동 확인 필요`;
    if (!dryRun) {
      await writeAuditLog({
        operatorEmail: operator.email,
        operatorName: operator.name,
        action: "users 문서 대조 정리 중단(상한 초과)",
        targetEmail: "-",
        details:
          `${reason}. users 문서 ${docsSnap.size}건 / GWS 실계정 ${gwsByEmail.size}명. ` +
          `대상: ${targets.map((t) => t.email).join(", ").slice(0, 1500)}`,
        status: "failure",
      });
    }
    return { ...result, skipped: true, reason };
  }

  if (dryRun) return { ...result, skipped: true, reason: "dryRun — 변경 없음" };

  const batch = adminDb.batch();
  targets.forEach((t) => batch.delete(t.ref));
  await batch.commit();

  // 안전 규칙 ⓒ — 지운 건 남긴다.
  await writeAuditLog({
    operatorEmail: operator.email,
    operatorName: operator.name,
    action: "정지·유령 users 문서 정리",
    targetEmail: targets.length === 1 ? targets[0].email : "복수 문서",
    details: (
      `GWS 대조로 users 문서 ${targets.length}건 삭제` +
      (only === "all" ? "" : ` (범위 제한: ${only})`) +
      `: ${targets.map((t) => t.email).join(", ")}. ` +
      `전수 판정 결과 — 정지 ${suspended.length}건 / 유령 ${ghosts.length}건, ` +
      `대조 기준 users 문서 ${docsSnap.size}건·GWS 실계정 ${gwsByEmail.size}명. ` +
      `정지 해제 후 재로그인하면 문서는 자동 재생성된다.`
    ).slice(0, 2000),
    status: "success",
  });

  return result;
}
