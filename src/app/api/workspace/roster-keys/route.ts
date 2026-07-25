import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { writeAuditLog } from "@/lib/firebase/audit-server";

/**
 * Phase 6a-1: 수퍼어드민 명단 API 키 관리 API
 * 
 * POST /api/workspace/roster-keys
 * 
 * Actions:
 * - action: "list"   -> 키 목록 조회
 * - action: "create" -> 새 키 발급 (평문 키는 1회만 반환, SHA-256 해시 저장)
 * - action: "revoke" -> 키 폐기
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 수퍼어드민 권한 검증
    const authData = await verifyAuthAccess(req);
    if (!authData || authData.role !== "super_admin") {
      return NextResponse.json(
        { error: "권한이 없습니다. 수퍼어드민 계정만 접근할 수 있습니다." },
        { status: 403 }
      );
    }

    const domain = authData.email.split("@")[1];
    if (!domain) {
      return NextResponse.json(
        { error: "올바른 관리자 도메인 정보를 확인할 수 없습니다." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { action } = body;

    // 2. 키 목록 조회
    // 키는 플랫 최상위 컬렉션 roster_api_keys/{keyId}에 domain 필드와 함께 저장한다.
    // (서브컬렉션 + collectionGroup 조회는 수동 색인 필요 + 동명 컬렉션 충돌 위험 — feed 라우트 주석 참조)
    if (action === "list") {
      const snap = await adminDb
        .collection("roster_api_keys")
        .where("domain", "==", domain)
        .get();

      const keys = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || "",
          keyPrefix: data.keyPrefix || "hmh_sk_...",
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
          lastUsedAt: data.lastUsedAt?.toDate ? data.lastUsedAt.toDate().toISOString() : data.lastUsedAt,
          revoked: Boolean(data.revoked),
          createdBy: data.createdBy || "",
        };
      });

      // 생성일 기준 내림차순 정렬
      keys.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });

      return NextResponse.json({ keys });
    }

    // 3. API 키 신규 발급
    if (action === "create") {
      const { name } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json(
          { error: "API 키 용도(라벨)를 입력해 주세요. (예: 지필평가 현황판)" },
          { status: 400 }
        );
      }

      const keyLabel = name.trim();
      const rawKey = "hmh_sk_" + crypto.randomBytes(24).toString("hex");
      const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
      // 랜덤 접미사로 동시 발급 시 문서 ID 충돌 방지
      const keyId = "key_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      const keyPrefix = rawKey.substring(0, 11) + "..." + rawKey.slice(-4);

      const keyDocData = {
        id: keyId,
        domain,
        name: keyLabel,
        hashedKey,
        keyPrefix,
        createdAt: FieldValue.serverTimestamp(),
        lastUsedAt: null,
        revoked: false,
        createdBy: authData.email,
      };

      await adminDb
        .collection("roster_api_keys")
        .doc(keyId)
        .set(keyDocData);

      // 감사 로그 작성 (키 발급)
      await writeAuditLog({
        operatorEmail: authData.email,
        operatorName: "관리자",
        action: "명단 API 키 발급",
        targetEmail: domain,
        details: `명단 API 키 발급: ${keyLabel} (${keyPrefix})`,
        status: "success",
      });

      return NextResponse.json({
        success: true,
        key: rawKey, // 평문 키 1회 표시용
        keyId,
        name: keyLabel,
      });
    }

    // 4. API 키 폐기
    if (action === "revoke") {
      const { keyId } = body;
      if (!keyId || typeof keyId !== "string") {
        return NextResponse.json(
          { error: "폐기할 키 식별자(keyId)가 지정되지 않았습니다." },
          { status: 400 }
        );
      }

      const keyRef = adminDb.collection("roster_api_keys").doc(keyId);

      const keySnap = await keyRef.get();
      const existingData = keySnap.data() || {};
      // 플랫 컬렉션이므로 반드시 본인 도메인의 키인지 검증 (타 도메인 키 폐기 차단)
      if (!keySnap.exists || existingData.domain !== domain) {
        return NextResponse.json(
          { error: "해당 API 키를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      await keyRef.update({ revoked: true });

      // 감사 로그 작성 (키 폐기)
      await writeAuditLog({
        operatorEmail: authData.email,
        operatorName: "관리자",
        action: "명단 API 키 폐기",
        targetEmail: domain,
        details: `명단 API 키 폐기: ${existingData.name || keyId} (${existingData.keyPrefix || keyId})`,
        status: "success",
      });

      return NextResponse.json({ success: true, keyId });
    }

    return NextResponse.json(
      { error: "지원하지 않는 action 입니다." },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[Roster API Key Management Error]:", error);
    return NextResponse.json(
      { error: `API 키 관리 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
