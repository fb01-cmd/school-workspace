import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { google } from "googleapis";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

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

const checkIsWorkspaceAdmin = async (email: string): Promise<boolean> => {
  const hasCredentials =
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;
  if (!hasCredentials) return false;

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
    return res.data.isAdmin === true;
  } catch (error: any) {
    console.error("Failed to check admin status from Google Workspace:", error.message);
    return false;
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

  const domain = email.split("@")[1] || "";
  const userRef = adminDb.collection("users").doc(uid);
  const snap = await userRef.get();

  try {
    if (STUDENT_EMAIL_REGEX.test(email)) {
      await userRef.set({
        email,
        domain,
        role: "student",
        isApproved: true,
        createdAt: snap.exists ? (snap.data()?.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true, role: "student" });
    }

    const isWorkspaceAdmin = await checkIsWorkspaceAdmin(email);
    const role = isWorkspaceAdmin ? "super_admin" : "teacher";

    if (snap.exists) {
      await userRef.update({ role, isApproved: isWorkspaceAdmin });
    } else {
      await userRef.set({
        email,
        domain,
        role,
        isApproved: isWorkspaceAdmin,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return NextResponse.json({ success: true, role });
  } catch (error: any) {
    console.error("Error in POST /api/auth/sync-user:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
