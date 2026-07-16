import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, collection, addDoc, getDocs, query, orderBy, limit } from "firebase/firestore";
import { getChromeManagedBookmarks, updateChromeManagedBookmarks, ManagedBookmarksConfig } from "@/lib/google/bookmarks";
import { writeAuditLog } from "@/lib/firebase/audit";

// GET Handler
export async function GET(req: NextRequest) {
  try {
    const authUser = await verifyAuthAccess(req);
    if (!authUser) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const { role } = authUser;
    const domain = authUser.email.split("@")[1];

    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // A. Resolve current bookmarks config for a specific OU
    if (action === "get") {
      const orgUnitPath = searchParams.get("orgUnitPath");
      if (!orgUnitPath) {
        return NextResponse.json({ error: "orgUnitPath가 누락되었습니다." }, { status: 400 });
      }
      const data = await getChromeManagedBookmarks(orgUnitPath);
      return NextResponse.json(data);
    }

    // B. Fetch bookmark edit history logs
    if (action === "logs") {
      try {
        const logsRef = collection(db, "chrome_bookmark_logs");
        const q = query(logsRef, orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return NextResponse.json({ logs });
      } catch (err: any) {
        console.error("Failed to query chrome bookmark logs:", err);
        return NextResponse.json({ logs: [] });
      }
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

// Helper to check cascading OU permissions
function checkOUInheritance(allowedOUs: string[], targetOU: string): boolean {
  const cleanTarget = targetOU.trim().toLowerCase();
  
  return allowedOUs.some(allowed => {
    const cleanAllowed = allowed.trim().toLowerCase();
    if (cleanTarget === cleanAllowed) return true;
    
    // Check if target is a descendant of allowed parent OU
    const prefix = cleanAllowed.endsWith("/") ? cleanAllowed : `${cleanAllowed}/`;
    return cleanTarget.startsWith(prefix);
  });
}

// POST Handler
export async function POST(req: NextRequest) {
  try {
    const authUser = await verifyAuthAccess(req);
    if (!authUser) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const { email: operatorEmail, role } = authUser;
    const domain = operatorEmail.split("@")[1];
    const operatorName = operatorEmail.split("@")[0];

    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { action, orgUnitPath, toplevel_name, bookmarks } = body;

    if (action === "update") {
      if (!orgUnitPath || !toplevel_name || !Array.isArray(bookmarks)) {
        return NextResponse.json({ error: "필수 데이터(orgUnitPath, toplevel_name, bookmarks)가 누락되었습니다." }, { status: 400 });
      }

      // 1. Security Check: For regular teachers, verify against allowedBookmarkOUs in Firestore settings
      if (role !== "super_admin") {
        const settingsRef = doc(db, "settings", domain);
        const settingsSnap = await getDoc(settingsRef);
        
        let allowedBookmarkOUs: string[] = ["/교직원", "/학생"]; // Fallback defaults
        if (settingsSnap.exists()) {
          const settingsData = settingsSnap.data();
          if (Array.isArray(settingsData.allowedBookmarkOUs)) {
            allowedBookmarkOUs = settingsData.allowedBookmarkOUs;
          }
        }

        const isAllowed = checkOUInheritance(allowedBookmarkOUs, orgUnitPath);
        if (!isAllowed) {
          return NextResponse.json({ 
            error: `조직단위 [${orgUnitPath}]에 대한 북마크 배포 권한이 없습니다. 관리자 설정을 확인해 주세요.` 
          }, { status: 403 });
        }
      }

      // 2. Fetch old bookmarks config first (for logging differential changes)
      let beforeConfig: ManagedBookmarksConfig = { toplevel_name: "", bookmarks: [] };
      try {
        beforeConfig = await getChromeManagedBookmarks(orgUnitPath);
      } catch (e) {
        // Safe skip if fetching old fails
      }

      // 3. Update Managed Bookmarks
      const updateResult = await updateChromeManagedBookmarks(orgUnitPath, toplevel_name, bookmarks);
      if (!updateResult.success) {
        return NextResponse.json({ error: updateResult.error || "북마크 적용에 실패했습니다." }, { status: 500 });
      }
      const isFallback = !!updateResult.isLocalFallback;

      // 4. Log the audit details in Firestore custom logs
      const logData = {
        operatorEmail,
        operatorName,
        orgUnitPath,
        beforeConfig,
        afterConfig: {
          toplevel_name,
          bookmarks
        },
        isLocalFallback: isFallback,
        timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      };
      await addDoc(collection(db, "chrome_bookmark_logs"), logData);

      // 5. System wide Audit Log
      await writeAuditLog({
        operatorEmail,
        operatorName,
        action: "크롬 관리 북마크 변경",
        targetEmail: orgUnitPath,
        details: `조직단위 [${orgUnitPath}]의 크롬 북마크를 업데이트했습니다. (폴더명: '${toplevel_name}', 북마크 수: ${bookmarks.length}개)${isFallback ? " [구글 API 오류로 로컬 DB 임시 적용]" : ""}`,
        status: "success"
      });

      return NextResponse.json({ success: true, isLocalFallback: isFallback });
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
