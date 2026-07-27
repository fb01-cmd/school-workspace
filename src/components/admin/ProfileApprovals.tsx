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
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import OrgChartTree from "@/components/admin/OrgChartTree";
import OrgChartBuilder from "@/components/admin/OrgChartBuilder";

interface PendingProfile extends TeacherProfile {
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt?: any;
  rejectedReason?: string;
}

interface ApprovedTeacherInfo {
  email: string;
  name: string;
}

type SubTabType = "pending" | "manual" | "tree";

export default function ProfileApprovals() {
  const { userData } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>("pending");
  const [selectedTeacherForEdit, setSelectedTeacherForEdit] = useState<string>("");

  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const isSuperAdmin = userData?.role === "super_admin";

  useEffect(() => {
    if (userData && !isSuperAdmin) {
      setActiveSubTab("tree");
    }
  }, [userData, isSuperAdmin]);

  // 이미 승인된 담임 현황 (`${grade}-${classNum}` -> 교사 정보 목록)
  const [approvedHomerooms, setApprovedHomerooms] = useState<
    Map<string, ApprovedTeacherInfo[]>
  >(new Map());

  // 1. 신청 대기 목록 구독 — 승인 큐는 super_admin 전용 정보
  useEffect(() => {
    if (!userData?.domain || userData.role !== "super_admin") return;
    const q = query(
      collection(db, "teacher_profiles_pending"),
      where("status", "==", "PENDING")
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => d.data() as PendingProfile);
      setPending(items.sort((a, b) => (a.requestedAt?.seconds || 0) - (b.requestedAt?.seconds || 0)));
      setLoading(false);
    });
    return () => unsub();
  }, [userData?.domain, userData?.role]);

  // 2. 이미 승인된 담임 프로필 실시간 구독 (공동담임 겹침 경고 검출용 — 승인 탭 전용)
  useEffect(() => {
    if (!userData?.domain || userData.role !== "super_admin") return;
    const qApproved = query(
      collection(db, "teacher_profiles"),
      where("isHomeroom", "==", true)
    );
    const unsubApproved = onSnapshot(qApproved, (snap) => {
      const map = new Map<string, ApprovedTeacherInfo[]>();
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.isHomeroom && data.homeroom) {
          const g = Number(data.homeroom.grade);
          const c = Number(data.homeroom.class ?? data.homeroom.classNum);
          if (g && c) {
            const key = `${g}-${c}`;
            const list = map.get(key) || [];
            list.push({
              email: (data.email || docSnap.id).toLowerCase(),
              name: data.name || data.email || docSnap.id,
            });
            map.set(key, list);
          }
        }
      });
      setApprovedHomerooms(map);
    });
    return () => unsubApproved();
  }, [userData?.domain, userData?.role]);

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

  const handleTriggerEditFromTree = (email: string) => {
    setSelectedTeacherForEdit(email);
    setActiveSubTab("manual");
  };

  return (
    <div className="space-y-6">
      {/* Sub-tab Navigation */}
      <div className="flex border border-gray-200 bg-white rounded-lg p-1.5 shadow-sm gap-2 flex-wrap sm:flex-nowrap">
        {isSuperAdmin && (
        <button
          type="button"
          onClick={() => setActiveSubTab("pending")}
          className={`flex-1 py-2.5 px-4 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            activeSubTab === "pending"
              ? "bg-indigo-600 text-white shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <span>📥</span>
          <span>조직 정보 승인 대기</span>
          {pending.length > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
              activeSubTab === "pending" ? "bg-white text-indigo-700" : "bg-amber-100 text-amber-800"
            }`}>
              {pending.length}
            </span>
          )}
        </button>
        )}

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setActiveSubTab("manual")}
            className={`flex-1 py-2.5 px-4 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeSubTab === "manual"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <span>🏗️</span>
            <span>조직도 빌더 (수동 배치)</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveSubTab("tree")}
          className={`flex-1 py-2.5 px-4 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            activeSubTab === "tree"
              ? "bg-indigo-600 text-white shadow-xs"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <span>🌳</span>
          <span>조직도 트리 뷰</span>
        </button>
      </div>

      {/* Sub-tab 1: Pending Approvals — super_admin 전용 */}
      {activeSubTab === "pending" && isSuperAdmin && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">📥 조직 정보 승인 대기</h2>
            <p className="text-sm text-gray-500">
              교직원이 제출한 소속/직책 정보 신청을 검토하고 승인 또는 반려하세요.
            </p>
          </div>

          {loading ? (
            <p className="text-center text-gray-500 py-8">불러오는 중...</p>
          ) : pending.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-600 font-semibold">현재 대기 중인 신청이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((profile) => {
                const isHomeroomApply = profile.isHomeroom && profile.homeroom;
                const hGrade = isHomeroomApply ? Number(profile.homeroom?.grade) : 0;
                const hClass = isHomeroomApply ? Number(profile.homeroom?.class ?? (profile.homeroom as any)?.classNum) : 0;
                const hKey = isHomeroomApply ? `${hGrade}-${hClass}` : "";

                // 이미 승인된 다른 교사 중 동일 담임 반이 있는지 확인
                const approvedTeachersForClass = isHomeroomApply
                  ? (approvedHomerooms.get(hKey) || []).filter(
                      (t) => t.email.toLowerCase() !== profile.email.toLowerCase()
                    )
                  : [];

                const isCoHomeroomWarning = approvedTeachersForClass.length > 0;

                return (
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
                      <div className="flex items-center space-x-2">
                        {isCoHomeroomWarning && (
                          <span className="bg-amber-500 text-white text-xs font-extrabold px-2.5 py-1 rounded-full shadow-xs flex items-center space-x-1">
                            <span>⚠️</span>
                            <span>공동담임 겹침</span>
                          </span>
                        )}
                        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full border border-amber-200 animate-pulse">
                          승인 대기
                        </span>
                      </div>
                    </div>

                    {/* 신청 내용 */}
                    <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">소속 부서</p>
                        {profile.noDept ? (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md text-xs font-semibold border border-gray-200">소속 없음</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {profile.departments?.map((d) => {
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
                        <div className="space-y-1.5">
                          <p className="text-gray-900 font-medium">
                            {isHomeroomApply
                              ? `🏫 ${hGrade}학년 ${hClass}반`
                              : "담임 아님"}
                          </p>

                          {/* 공동담임 경고 배지 */}
                          {isCoHomeroomWarning && (
                            <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1 shadow-2xs">
                              <div className="font-bold text-amber-800 flex items-center space-x-1">
                                <span>⚠️</span>
                                <span>공동담임이 됩니다</span>
                              </div>
                              <p className="text-[11px] text-amber-700 leading-tight">
                                기존 승인 담임:{" "}
                                <strong>
                                  {approvedTeachersForClass.map((t) => t.name || t.email).join(", ")}
                                </strong>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 반려 사유 입력 (반려 모드) */}
                    {rejectTarget === profile.email && (
                      <div className="px-6 pb-4 space-y-2">
                        <label className="text-xs font-semibold text-gray-700">반려 사유 (선택)</label>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sub-tab 2: Super Admin Org Chart Builder — 세부 편집 모달의 단일 소유자 (이중 모달 방지) */}
      {activeSubTab === "manual" && isSuperAdmin && (
        <OrgChartBuilder
          externalEditEmail={selectedTeacherForEdit || undefined}
          onExternalEditHandled={() => setSelectedTeacherForEdit("")}
        />
      )}

      {/* Sub-tab 3: Org Chart Tree View — ✏️는 빌더 탭으로 전환 후 빌더 모달로 열림 */}
      {activeSubTab === "tree" && (
        <OrgChartTree onEditTeacher={handleTriggerEditFromTree} />
      )}
    </div>
  );
}
