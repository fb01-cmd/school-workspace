import { db } from "@/lib/firebase/config";
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from "firebase/firestore";

export interface AuditLog {
  id?: string;
  operatorEmail: string;
  operatorName?: string;
  action: string;
  targetEmail: string;
  details: string;
  timestamp: any;
  status: "success" | "failure";
  error?: string;
}

export async function writeAuditLog(payload: Omit<AuditLog, "timestamp">) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      ...payload,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to write audit log to Firestore:", error);
  }
}

/**
 * Fetch recent audit logs from Firestore ordered by newest first.
 */
export async function fetchAuditLogs(limitCount: number = 100): Promise<AuditLog[]> {
  try {
    const q = query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    const logs: AuditLog[] = [];
    
    snap.forEach((doc) => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        operatorEmail: data.operatorEmail,
        operatorName: data.operatorName || "",
        action: data.action,
        targetEmail: data.targetEmail,
        details: data.details,
        timestamp: data.timestamp,
        status: data.status,
        error: data.error || "",
      });
    });
    
    return logs;
  } catch (error) {
    console.error("Failed to fetch audit logs from Firestore:", error);
    return [];
  }
}
