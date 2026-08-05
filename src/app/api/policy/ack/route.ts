import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess, adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { POLICY_VERSION } from "@/lib/policy/version";

/**
 * Phase 11: 개인정보 고지 확인 API
 *
 * POST /api/policy/ack
 * - action: "ack" (또는 기본) → 본인의 개인정보 고지 확인 처리 (users 갱신 + policy_acks 이력 문서)
 * - action: "list"          → 수퍼어드민 전용 고지 확인 현황 조회
 */

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "ack";

    // ── 1. 본인 고지 확인 처리 ──
    if (action === "ack") {
      const now = Timestamp.now();

      // 1) users/{uid} 최신 상태 갱신
      await adminDb.collection("users").doc(auth.uid).set(
        {
          policyAck: {
            version: POLICY_VERSION,
            ackedAt: now,
          },
        },
        { merge: true }
      );

      // 2) policy_acks/{uid}_{version} 개정 이력 문서 생성 (서버 전용, 위조 방지)
      const ackDocId = `${auth.uid}_${POLICY_VERSION}`;
      await adminDb.collection("policy_acks").doc(ackDocId).set({
        uid: auth.uid,
        email: auth.email,
        role: auth.role,
        version: POLICY_VERSION,
        ackedAt: now,
      });

      // 3) 감사 로그 기록
      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: auth.email,
        action: "개인정보 고지 확인",
        targetEmail: auth.email,
        details: `개인정보 처리 안내 고지 확인 완료 (버전: ${POLICY_VERSION})`,
        status: "success",
      });

      return NextResponse.json({
        success: true,
        version: POLICY_VERSION,
        ackedAt: now.toDate().toISOString(),
      });
    }

    // ── 2. 수퍼어드민 전용 고지 현황 조회 ──
    if (action === "list") {
      if (auth.role !== "super_admin") {
        return NextResponse.json(
          { error: "수퍼어드민 권한만 이현황을 조회할 수 있습니다." },
          { status: 403 }
        );
      }

      // 전체 유저 및 policy_acks 가져오기
      const [usersSnap, acksSnap] = await Promise.all([
        adminDb.collection("users").get(),
        adminDb.collection("policy_acks").get(),
      ]);

      const allUsers = usersSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          email: data.email || "",
          name: data.name || data.displayName || data.email || "",
          role: data.role || "student",
          grade: data.grade,
          classNum: data.classNum,
          policyAck: data.policyAck || null,
        };
      });

      const acksHistory = acksSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          uid: data.uid,
          email: data.email,
          role: data.role,
          version: data.version,
          ackedAt: data.ackedAt?.toDate ? data.ackedAt.toDate().toISOString() : data.ackedAt,
        };
      });

      // 현재 버전(POLICY_VERSION) 확인자 및 미확인자 분류
      const ackedUsers: any[] = [];
      const pendingUsers: any[] = [];

      for (const u of allUsers) {
        if (u.policyAck && u.policyAck.version === POLICY_VERSION) {
          ackedUsers.push(u);
        } else {
          pendingUsers.push(u);
        }
      }

      return NextResponse.json({
        currentVersion: POLICY_VERSION,
        totalCount: allUsers.length,
        ackedCount: ackedUsers.length,
        pendingCount: pendingUsers.length,
        pendingUsers,
        ackedUsers,
        history: acksHistory,
      });
    }

    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("[Policy Ack API Error]:", error);
    return NextResponse.json(
      { error: `고지 확인 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
