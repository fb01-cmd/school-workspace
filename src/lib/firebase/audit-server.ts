import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { AuditLog } from "./audit";

/**
 * Write a new audit log record to Firestore 'audit_logs' collection.
 * Server-only utility using Firebase Admin SDK.
 */
export async function writeAuditLog(payload: Omit<AuditLog, "timestamp">) {
  try {
    await adminDb.collection("audit_logs").add({
      ...payload,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to write audit log to Firestore:", error);
  }
}
