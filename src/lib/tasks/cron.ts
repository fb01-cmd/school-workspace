// 업무 지시 크론 — D-1 기한 리마인드 + 보존 만료 파기 (phase8_tasks_spec §6·§8)
// daily-sync(새벽)에 통합 — Vercel Hobby 크론 2개 한도 준수 (신규 크론 0).
import { adminDb } from "@/lib/firebase/admin";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import { notifyTask } from "@/lib/push/webpush";
import { deleteTaskFolderTree } from "./drive";
import { TaskDoc, isDueTomorrowKST, isOrphanDraft, kstDateStr, nudgeTargets } from "./logic";

const tasksColRef = (domain: string) =>
  adminDb.collection("tasks").doc(domain).collection("items");

export interface TaskSweepResult {
  remindedTasks: number;
  remindedPeople: number;
  purged: number;
  /** 고아 초안 정리 건수 (피드백 4-ⓑ) */
  orphanedDrafts: number;
}

export async function runTaskSweep(
  domains: string[],
  opts: { dryRun?: boolean } = {}
): Promise<TaskSweepResult> {
  const now = Date.now();
  const result: TaskSweepResult = { remindedTasks: 0, remindedPeople: 0, purged: 0, orphanedDrafts: 0 };

  for (const domain of domains) {
    // ① D-1 리마인드 — 기한이 KST 내일인 미철회 업무의 미처리자에게 1회 (§6, 본인 리마인드라 원칙 정합)
    // 쿼리 창: 지금~+48h면 "내일" 후보를 전부 덮는다 — 정밀 판정은 isDueTomorrowKST
    const dueSnap = await tasksColRef(domain)
      .where("dueAt", ">", now)
      .where("dueAt", "<", now + 48 * 3600 * 1000)
      .get();
    for (const doc of dueSnap.docs) {
      const task = doc.data() as TaskDoc;
      if (task.canceledAt || task.recipientCount === 0) continue;
      if (!isDueTomorrowKST(task.dueAt, now)) continue;
      const targets = nudgeTargets(task);
      if (targets.length === 0) continue;
      result.remindedTasks++;
      result.remindedPeople += targets.length;
      if (opts.dryRun) continue;
      await notifyTask(domain, targets, task.senderName, task.title, doc.id, "내일까지인 업무");
      await emitNotificationsBatch(
        domain,
        targets.map((r) => ({
          recipientEmail: r,
          type: "task-due" as const,
          title: `[내일 마감] ${task.title}`,
          refType: "task",
          refId: doc.id,
        }))
      );
    }

    // ② 보존 만료 파기 — 문서와 공유드라이브 폴더(양식·제출물)를 함께 (§8)
    const expiredSnap = await tasksColRef(domain).where("expireAt", "<", now).limit(50).get();
    for (const doc of expiredSnap.docs) {
      const task = doc.data() as TaskDoc;
      result.purged++;
      if (opts.dryRun) continue;
      try {
        await deleteTaskFolderTree(kstDateStr(task.createdAt).slice(0, 4), doc.id);
      } catch (e: any) {
        console.error(`[task_sweep] 폴더 파기 실패(${doc.id}):`, e?.message || e);
      }
      await doc.ref.delete();
    }

    // ③ 고아 초안 정리 (피드백 4-ⓑ) — prepare만 하고 send가 안 된 문서(수신 0명)를
    // 24시간 후 폴더째 삭제. 판정은 isOrphanDraft가 단일 소재지 — 작성 중 문서 오삭제 방지.
    const draftSnap = await tasksColRef(domain).where("recipientCount", "==", 0).limit(50).get();
    for (const doc of draftSnap.docs) {
      const task = doc.data() as TaskDoc;
      if (!isOrphanDraft(task, now)) continue;
      result.orphanedDrafts++;
      if (opts.dryRun) continue;
      try {
        await deleteTaskFolderTree(kstDateStr(task.createdAt).slice(0, 4), doc.id);
      } catch (e: any) {
        console.error(`[task_sweep] 고아 초안 폴더 정리 실패(${doc.id}):`, e?.message || e);
      }
      await doc.ref.delete();
    }
  }
  return result;
}
