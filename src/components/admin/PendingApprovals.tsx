"use client";

import { useEffect, useState } from "react";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface PendingUser {
  uid: string;
  email: string;
  domain: string;
  status: string;
  createdAt: any;
}

export default function PendingApprovals() {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingUid, setApprovingUid] = useState<string | null>(null);
  const [rejectingUid, setRejectingUid] = useState<string | null>(null);

  const fetchPendingUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("status", "==", "pending_approval"));
      const snapshot = await getDocs(q);
      const users: PendingUser[] = snapshot.docs.map((doc) => ({
        uid: doc.id,
        ...(doc.data() as Omit<PendingUser, "uid">),
      }));
      setPendingUsers(users);
    } catch (error) {
      console.error("Failed to fetch pending users", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingUsers();
  }, []);

  // Approve: upgrade to super_admin
  const handleApprove = async (uid: string) => {
    setApprovingUid(uid);
    try {
      await updateDoc(doc(db, "users", uid), {
        role: "super_admin",
        isApproved: true,
        status: "approved",
      });
      // Remove from local list immediately for snappy UI
      setPendingUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (error) {
      console.error("Failed to approve user", error);
      alert("승인 처리 중 오류가 발생했습니다.");
    } finally {
      setApprovingUid(null);
    }
  };

  // Reject: revert status back to none (stays as teacher, isApproved: false)
  const handleReject = async (uid: string) => {
    if (!confirm("이 교사의 권한 요청을 거절하시겠습니까? 해당 교사는 다시 권한을 신청할 수 있습니다.")) return;
    setRejectingUid(uid);
    try {
      await updateDoc(doc(db, "users", uid), {
        status: "none",
      });
      setPendingUsers((prev) => prev.filter((u) => u.uid !== uid));
    } catch (error) {
      console.error("Failed to reject user", error);
      alert("거절 처리 중 오류가 발생했습니다.");
    } finally {
      setRejectingUid(null);
    }
  };

  if (loading) {
    return <p className="text-gray-500 text-center py-8">승인 대기 목록 불러오는 중...</p>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">교사 권한 승인 관리</h2>
          <p className="text-gray-500 text-sm mt-1">
            수퍼어드민 권한을 요청한 교사 목록입니다. 승인하면 즉시 수퍼어드민으로 격상됩니다.
          </p>
        </div>
        <button
          onClick={fetchPendingUsers}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          새로고침
        </button>
      </div>

      {pendingUsers.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="mx-auto h-12 w-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-base font-medium text-gray-500">승인 대기 중인 교사가 없습니다.</p>
          <p className="text-sm text-gray-400 mt-1">모든 권한 요청이 처리되었습니다.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {pendingUsers.map((user) => (
            <li key={user.uid} className="flex items-center justify-between py-4 gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {/* Avatar placeholder */}
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-indigo-700 font-bold text-sm">
                    {user.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{user.email}</p>
                  <p className="text-xs text-gray-500 mt-0.5">도메인: {user.domain}</p>
                </div>
              </div>

              {/* Status badge */}
              <span className="flex-shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                승인 대기 중
              </span>

              {/* Action buttons */}
              <div className="flex-shrink-0 flex items-center gap-2">
                <button
                  onClick={() => handleReject(user.uid)}
                  disabled={rejectingUid === user.uid || approvingUid === user.uid}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {rejectingUid === user.uid ? "처리 중..." : "거절"}
                </button>
                <button
                  onClick={() => handleApprove(user.uid)}
                  disabled={approvingUid === user.uid || rejectingUid === user.uid}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {approvingUid === user.uid ? "승인 중..." : "승인 (수퍼어드민 격상)"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
