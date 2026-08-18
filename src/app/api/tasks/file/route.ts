// 업무 파일 내려받기 프록시 (phase8_tasks_spec §5-2·§5-5)
// 양식 = 그 업무의 발신자·수신자 전원 / 제출물 = 제출 본인 + 발신자(담당자)만.
// 쿠키 인증(<a download>·<img> 자동 동봉) — 인라인 이미지 프록시(§13)와 같은 구조.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { downloadTaskFile } from "@/lib/tasks/drive";
import { TaskDoc } from "@/lib/tasks/logic";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "hmh.or.kr";

    const taskId = req.nextUrl.searchParams.get("taskId") || "";
    const fileId = req.nextUrl.searchParams.get("fileId") || "";
    if (!taskId || taskId.includes("/") || taskId.length > 128 || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) {
      return NextResponse.json({ error: "요청 형식이 유효하지 않습니다." }, { status: 400 });
    }

    const snap = await adminDb.collection("tasks").doc(domain).collection("items").doc(taskId).get();
    if (!snap.exists) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    const task = snap.data() as TaskDoc;

    const isSender = task.senderEmail === email;
    const isRecipient = task.recipientEmails.includes(email);
    if (!isSender && !isRecipient) {
      return NextResponse.json({ error: "이 파일을 볼 권한이 없습니다." }, { status: 403 });
    }

    const form = (task.formFiles || []).find((f) => f.driveFileId === fileId);
    let allowed = false;
    let fileName = "";
    let mimeType = "application/octet-stream";
    if (form) {
      allowed = true; // 양식 = 발신자·수신자 전원
      fileName = form.name;
      mimeType = form.mimeType || mimeType;
    } else {
      const entry = Object.entries(task.submissions || {}).find(([, s]) => s.driveFileId === fileId);
      if (entry) {
        const [submitter, sub] = entry;
        allowed = isSender || submitter === email; // 제출물 = 본인 + 담당자
        fileName = sub.name;
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "이 파일을 볼 권한이 없습니다." }, { status: 403 });
    }

    const bytes = await downloadTaskFile(fileId);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName || "file")}`,
        "Cache-Control": "private, max-age=0, no-store", // 제출물은 교체될 수 있어 캐시 금지
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e: any) {
    console.error("[api/tasks/file] 실패:", e?.message || e);
    return NextResponse.json({ error: "파일을 불러오지 못했습니다." }, { status: 502 });
  }
}
