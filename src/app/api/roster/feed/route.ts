import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb, getStudentOUPaths } from "@/lib/firebase/admin";
import { listUsersInOUs } from "@/lib/google/workspace";
import { parseStudentUser, RosterFeedStudent, RosterFeedUnparsed } from "@/lib/roster";

/**
 * Phase 6a-1: 읽기 전용 명단 API
 * 
 * 엔드포인트: GET /api/roster/feed
 * 인증: Authorization: Bearer <API키>
 * 
 * 쿼리 파라미터:
 * - ?grade=1 (학년 필터)
 * - ?includeSuspended=true (정지 계정 포함 여부, 기본값 false)
 * - ?format=csv (CSV 포맷 출력)
 */
export async function GET(req: NextRequest) {
  try {
    // 1. 인증 헤더 검증
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "인증 실패: Authorization: Bearer <API키> 헤더가 필요합니다." },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7).trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "인증 실패: 유효한 API 키가 제공되지 않았습니다." },
        { status: 401 }
      );
    }

    // 2. 키 해시 비교 (SHA-256)
    // 플랫 최상위 컬렉션 조회 — collectionGroup은 수동 색인이 필요하고
    // 동명의 다른 서브컬렉션("keys")과 충돌할 수 있어 쓰지 않는다.
    const hashedKey = crypto.createHash("sha256").update(apiKey).digest("hex");

    const keyQuerySnap = await adminDb
      .collection("roster_api_keys")
      .where("hashedKey", "==", hashedKey)
      .limit(1)
      .get();

    if (keyQuerySnap.empty) {
      return NextResponse.json(
        { error: "인증 실패: 등록되지 않은 API 키입니다." },
        { status: 401 }
      );
    }

    const keyDoc = keyQuerySnap.docs[0];
    const keyData = keyDoc.data();

    if (keyData.revoked) {
      return NextResponse.json(
        { error: "인증 실패: 폐기된 API 키입니다." },
        { status: 401 }
      );
    }

    // 3. lastUsedAt 갱신 (감사로그 발송 없이 저소음 처리)
    keyDoc.ref.update({ lastUsedAt: new Date() }).catch((err) => {
      console.error("[Roster API] lastUsedAt 갱신 실패:", err);
    });

    const domain = keyData.domain;
    if (!domain) {
      return NextResponse.json(
        { error: "서버 오류: 키 정보에 도메인이 지정되어 있지 않습니다." },
        { status: 500 }
      );
    }

    // 4. 학교 설정(OU 매핑) 조회 (공통 getStudentOUPaths 헬퍼 사용)
    const orgUnitPaths = await getStudentOUPaths(domain);

    // 5. GWS에서 학생 사용자 데이터 조회 및 학번 파싱
    const rawUsers = await listUsersInOUs(orgUnitPaths);
    const parsedAll = rawUsers.map(parseStudentUser);

    // 6. 쿼리 옵션 필터링
    const { searchParams } = req.nextUrl;
    const gradeParam = searchParams.get("grade");
    const includeSuspendedParam = searchParams.get("includeSuspended");
    const formatParam = searchParams.get("format");

    const includeSuspended = includeSuspendedParam === "true";
    const selectedGrade = gradeParam ? parseInt(gradeParam, 10) : null;

    // 정지 계정 필터 적용
    let filtered = parsedAll;
    if (!includeSuspended) {
      filtered = filtered.filter((s) => !s.suspended);
    }

    // 학년 필터 적용 (파싱 성공 학생에 한함)
    if (selectedGrade !== null && !isNaN(selectedGrade)) {
      filtered = filtered.filter((s) => s.grade === selectedGrade);
    }

    // 학년/반/번호 순 정렬
    filtered.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.classNum !== b.classNum) return a.classNum - b.classNum;
      return a.studentNum - b.studentNum;
    });

    const students: RosterFeedStudent[] = [];
    const unparsed: RosterFeedUnparsed[] = [];

    for (const item of filtered) {
      if (item.isParsed) {
        students.push({
          studentId: item.rawStudentId,
          grade: item.grade,
          classNum: item.classNum,
          number: item.studentNum,
          name: item.name,
          email: item.email,
          suspended: item.suspended,
        });
      } else {
        unparsed.push({
          studentId: item.rawStudentId || "-",
          name: item.name,
          email: item.email,
          suspended: item.suspended,
        });
      }
    }

    // 7. CSV 포맷 처리
    if (formatParam?.toLowerCase() === "csv") {
      const headers = ["학번", "성명", "이메일", "학년", "반", "번호", "정지여부"];
      const rows: string[] = [];

      for (const s of students) {
        rows.push(
          [
            `"${s.studentId}"`,
            `"${s.name.replace(/"/g, '""')}"`,
            `"${s.email}"`,
            s.grade,
            s.classNum,
            s.number,
            s.suspended ? "Y" : "N",
          ].join(",")
        );
      }

      for (const u of unparsed) {
        rows.push(
          [
            `"${u.studentId}"`,
            `"${u.name.replace(/"/g, '""')}"`,
            `"${u.email}"`,
            "-",
            "-",
            "-",
            u.suspended ? "Y" : "N",
          ].join(",")
        );
      }

      const csvContent = [headers.join(","), ...rows].join("\n");
      const bom = "\uFEFF"; // UTF-8 BOM for Excel / Sheets compatibility

      return new Response(bom + csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'inline; filename="roster_feed.csv"',
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // 8. JSON 기본 응답
    return NextResponse.json(
      {
        students,
        unparsed,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("[Roster API Feed Error]:", error);
    return NextResponse.json(
      { error: `명단 데이터 생성 중 오류 발생: ${error.message}` },
      { status: 500 }
    );
  }
}
