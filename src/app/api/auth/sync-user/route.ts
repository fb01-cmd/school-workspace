import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { google } from "googleapis";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { isBlockedOuPath, isProtectedAccountEmail } from "@/lib/auth/blockedOu";

/**
 * POST /api/auth/sync-user
 * 로그인 직후 users/{uid} 문서를 서버에서 upsert한다 (역할 부여 포함).
 *
 * 기존에는 클라이언트(auth.ts)가 role을 포함해 users 문서를 직접 썼는데,
 * Firestore 보안 규칙을 잠그면 이 경로가 권한 상승 통로가 된다
 * (누구든 자기 role을 super_admin으로 써넣을 수 있음). 역할 판정과 기록을
 * 서버로 옮기고, 규칙에서는 users에 대한 클라이언트 쓰기를 차단한다.
 *
 * 판정 로직은 기존 auth.ts의 handleUserRoles와 동일하게 유지:
 *  - 학번 형식(5자리@hmh.or.kr) 이메일 → student
 *  - 그 외 → Workspace Directory에서 isAdmin이면 super_admin, 아니면 teacher
 */

const STUDENT_EMAIL_REGEX = /^\d{5}@hmh\.or\.kr$/;

/**
 * GWS 디렉터리 프로필 — isAdmin(역할 판정)과 orgUnitPath(차단 OU 판정)를 한 호출로.
 * 조회 실패는 fail-open: isAdmin=false(→teacher 승인 대기)·orgUnitPath=null(→차단 판정 불가
 * 시 통과). 차단이 가용성보다 우선할 위협 모델이 아니며 오승인 관문이 후방에 있다 (spec §2-3).
 */
const getWorkspaceProfile = async (
  email: string
): Promise<{ isAdmin: boolean; orgUnitPath: string | null }> => {
  const hasCredentials =
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;
  if (!hasCredentials) return { isAdmin: false, orgUnitPath: null };

  try {
    const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
      subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
    });
    const admin = google.admin({ version: "directory_v1", auth });
    const res = await admin.users.get({ userKey: email, projection: "basic" });
    return {
      isAdmin: res.data.isAdmin === true,
      orgUnitPath: typeof res.data.orgUnitPath === "string" ? res.data.orgUnitPath : null,
    };
  } catch (error: any) {
    console.error("Failed to fetch Workspace profile:", error.message);
    return { isAdmin: false, orgUnitPath: null };
  }
};

/** settings/{domain}.blockedOuPaths — 없으면 빈 목록 (기능 자연 비활성) */
const loadBlockedOuPaths = async (domain: string): Promise<string[]> => {
  try {
    const snap = await adminDb.collection("settings").doc(domain).get();
    const raw = snap.exists ? snap.data()?.blockedOuPaths : null;
    return Array.isArray(raw) ? raw.filter((p: unknown) => typeof p === "string") : [];
  } catch (e: any) {
    console.warn(`[sync-user] blockedOuPaths 로드 실패 (${domain}): ${e.message}`);
    return [];
  }
};

export async function POST(req: NextRequest) {
  // 방금 로그인한 본인의 ID 토큰으로만 호출 가능 — 서버가 토큰에서 uid/email을
  // 직접 꺼내므로, 호출자가 남의 계정 문서를 만들거나 역할을 지정할 방법이 없다.
  const authHeader = req.headers.get("authorization");
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: "인증 토큰이 없습니다." }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "유효하지 않은 토큰입니다." }, { status: 401 });
  }

  const { uid, email } = decoded;
  if (!email) {
    return NextResponse.json({ error: "토큰에 이메일이 없습니다." }, { status: 400 });
  }

  const tokenName = typeof decoded.name === "string" && decoded.name.trim() ? decoded.name.trim() : undefined;

  const domain = email.split("@")[1] || "";
  const userRef = adminDb.collection("users").doc(uid);
  const snap = await userRef.get();

  // 자가 치유: 같은 이메일로 남은 다른 uid 문서(계정 삭제·재생성 잔재)를 정리한다.
  // 로그인마다 최신 uid 문서 하나만 남아, 고지 현황 등 users 전수 화면의 중복이 자연 소멸.
  // 실패해도 로그인 흐름은 계속 (베스트 에포트).
  try {
    const dupSnap = await adminDb.collection("users").where("email", "==", email).get();
    const stale = dupSnap.docs.filter((d) => d.id !== uid);
    if (stale.length > 0) {
      const batch = adminDb.batch();
      stale.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      console.log(`[sync-user] ${email}의 구 uid 문서 ${stale.length}건 자가 정리`);
    }
  } catch (e: any) {
    console.warn(`[sync-user] 구문서 자가 정리 실패 (${email}): ${e.message}`);
  }

  try {
    if (STUDENT_EMAIL_REGEX.test(email)) {
      await userRef.set({
        email,
        domain,
        role: "student",
        createdAt: snap.exists ? (snap.data()?.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
        ...(tokenName ? { name: tokenName } : {}),
      });
      return NextResponse.json({ success: true, role: "student" });
    }

    const profile = await getWorkspaceProfile(email);

    // ── 포털 접속 차단 OU 관문 (coop_account_block_spec §2) ──
    // 공동교육과정 등 타교생용 계정은 포털 대상이 아니다. 보호 계정 3종은 항상 통과
    // (오등록으로 인프라 계정이 잠기는 사고 방지). orgUnitPath를 모르면(조회 실패) 통과.
    if (!isProtectedAccountEmail(email) && profile.orgUnitPath) {
      const blockedList = await loadBlockedOuPaths(domain);
      if (isBlockedOuPath(profile.orgUnitPath, blockedList)) {
        // 문서를 만들지 않고, 과거 잔재(teacher 오분류)가 있으면 그 자리에서 삭제 —
        // 차단 계정은 users 문서가 없어야 Firestore 규칙상 아무 권한도 갖지 않는다.
        try {
          const staleSnap = await adminDb.collection("users").where("email", "==", email).get();
          if (!staleSnap.empty) {
            const batch = adminDb.batch();
            staleSnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            console.log(`[sync-user] 차단 OU 계정 ${email}의 users 잔재 ${staleSnap.size}건 삭제`);
          }
        } catch (e: any) {
          console.warn(`[sync-user] 차단 계정 잔재 정리 실패 (${email}): ${e.message}`);
        }
        console.log(`[sync-user] 차단 OU 로그인 거부: ${email} (${profile.orgUnitPath})`);
        return NextResponse.json(
          { error: "이 포털은 효명고등학교 구성원 계정만 사용할 수 있습니다.", blocked: true },
          { status: 403 }
        );
      }
    }

    const isWorkspaceAdmin = profile.isAdmin;
    const role = isWorkspaceAdmin ? "super_admin" : "teacher";

    // 권한 판정의 단일 원본은 role뿐이다 (2026-08-13, 사용자 결정 ⓐ).
    // 예전엔 isApproved도 같이 썼는데, 이 필드는 이름과 달리 "워크스페이스 관리자인가"를
    // 담고 있었다 — 일반 교사는 구조적으로 항상 false, 학생은 항상 true. 이름에 속아
    // 쪽지 자격 판정에 쓴 적이 있고(수퍼어드민 전용이 돼 있었다) 관리자 승인 화면이
    // 이 필드를 true로 올려도 다음 로그인에 여기서 되돌아갔다. role과 100% 중복이므로
    // 남겨 두면 언젠가 또 관문으로 배선된다 → 쓰지 않고, 기존 문서에서도 지운다.
    // status도 같이 지운다 — 유일한 기록자였던 승인 화면을 함께 삭제했다.
    if (snap.exists) {
      await userRef.update({
        role,
        isApproved: FieldValue.delete(),
        status: FieldValue.delete(),
        ...(tokenName ? { name: tokenName } : {}),
      });
    } else {
      await userRef.set({
        email,
        domain,
        role,
        createdAt: FieldValue.serverTimestamp(),
        ...(tokenName ? { name: tokenName } : {}),
      });
    }
    return NextResponse.json({ success: true, role });
  } catch (error: any) {
    console.error("Error in POST /api/auth/sync-user:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
