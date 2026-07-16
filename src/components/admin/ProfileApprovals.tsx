"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/config";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { TeacherProfile } from "@/context/AuthContext";

interface PendingProfile extends TeacherProfile {
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt?: any;
  rejectedReason?: string;
}

export default function ProfileApprovals() {
  const { userData } = useAuth();
  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    if (!userData?.domain) return;
    const q = query(
      collection(db, "teacher_profiles_pending"),
      where("status", "==", "PENDING")
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => d.data() as PendingProfile);
      setPending(items.sort((a, b) => (a.requestedAt?.seconds || 0) - (b.requestedAt?.seconds || 0)));
      setLoading(false);
    });
    return () => unsub();
  }, [userData?.domain]);

  const handleApprove = async (profile: PendingProfile) => {
    if (!profile.email) return;
    setProcessing(profile.email);
    try {
      // 1. Copy to teacher_profiles (approved)
      const profileRef = doc(db, "teacher_profiles", profile.email);
      await setDoc(profileRef, {
        email: profile.email,
        name: profile.name,
        departments: profile.departments,
        noDept: profile.noDept || false,
        position: profile.position,
        isDeptHead: profile.isDeptHead || false,
        deptHeadMap: (profile as any).deptHeadMap || {},
        isHomeroom: profile.isHomeroom,
        homeroom: profile.homeroom || null,
        updatedAt: serverTimestamp(),
      });
      // 2. Update pending status
      const pendingRef = doc(db, "teacher_profiles_pending", profile.email);
      await updateDoc(pendingRef, { status: "APPROVED" });
    } catch (err) {
      console.error("승인 처리 실패", err);
      alert("승인 처리 중 오류가 발생했습니다.");
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (email: string) => {
    setProcessing(email);
    try {
      const pendingRef = doc(db, "teacher_profiles_pending", email);
      await updateDoc(pendingRef, {
        status: "REJECTED",
        rejectedReason: rejectReason,
      });
      setRejectTarget(null);
      setRejectReason("");
    } catch (err) {
      console.error("반려 처리 실패", err);
      alert("반려 처리 중 오류가 발생했습니다.");
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <p className="text-center text-gray-500 py-8">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">📥 조직 정보 승인 대기</h2>
        <p className="text-sm text-gray-500">
          교직원이 제출한 소속/직책 정보 신청을 검토하고 승인 또는 반려하세요.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-600 font-semibold">현재 대기 중인 신청이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map(profile => (
            <div key={profile.email} className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
              {/* 헤더 */}
              <div className="bg-indigo-50 px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-900">{profile.email}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    신청일:{" "}
                    {profile.requestedAt?.toDate
                      ? profile.requestedAt.toDate().toLocaleString("ko-KR")
                      : "—"}
                  </p>
                </div>
                <span className="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full border border-amber-200 animate-pulse">
                  승인 대기
                </span>
              </div>

              {/* 신청 내용 */}
              <div className="px-6 py-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">소속 부서</p>
                  {profile.noDept ? (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md text-xs font-semibold border border-gray-200">소속 없음</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {profile.departments?.map(d => {
                        const isHead = !!(profile as any).deptHeadMap?.[d];
                        return (
                          <span
                            key={d}
                            className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${
                              isHead
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-indigo-50 text-indigo-700 border-indigo-100"
                            }`}
                          >
                            {d}{isHead ? " (부장)" : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">직책</p>
                  <p className="text-gray-900 font-medium">{profile.position || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">담임</p>
                  <p className="text-gray-900 font-medium">
                    {profile.isHomeroom && profile.homeroom
                      ? `🏫 ${profile.homeroom.grade}학년 ${profile.homeroom.class}반`
                      : "담임 아님"}
                  </p>
                </div>
              </div>

              {/* 반려 사유 입력 (반려 모드) */}
              {rejectTarget === profile.email && (
                <div className="px-6 pb-4 space-y-2">
                  <label className="text-xs font-semibold text-gray-700">반려 사유 (선택)</label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={2}
                    placeholder="사유를 입력하거나 비워두셔도 됩니다."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(profile.email)}
                      disabled={processing === profile.email}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {processing === profile.email ? "처리 중..." : "반려 확정"}
                    </button>
                    <button
                      onClick={() => { setRejectTarget(null); setRejectReason(""); }}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              {/* 액션 버튼 */}
              {rejectTarget !== profile.email && (
                <div className="border-t border-gray-100 px-6 py-3 flex gap-3">
                  <button
                    onClick={() => handleApprove(profile)}
                    disabled={processing === profile.email}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {processing === profile.email ? "처리 중..." : "✅ 승인"}
                  </button>
                  <button
                    onClick={() => setRejectTarget(profile.email)}
                    disabled={processing === profile.email}
                    className="flex-1 py-2.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    ❌ 반려
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
