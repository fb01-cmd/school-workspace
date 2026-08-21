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
import { loadTeacherProfiles, invalidateTeacherProfilesCache } from "@/lib/org/roster";
import { isMobileNumberPattern } from "@/components/admin/ManualProfileEditor";

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

  // 승인 완료 프로필 전체 (email -> 현재 반영값) — 승인 diff 표시용 (2026-08-07)
  const [approvedProfiles, setApprovedProfiles] = useState<Map<string, TeacherProfile>>(new Map());

  // 2. 승인 프로필 캐시 로드 (다이어트 4번: 5분 인메모리 캐시 적용)
  useEffect(() => {
    if (!userData?.domain || userData.role !== "super_admin") return;
    let cancelled = false;

    async function loadApproved() {
      const profiles = await loadTeacherProfiles();
      if (cancelled) return;

      const map = new Map<string, ApprovedTeacherInfo[]>();
      const profMap = new Map<string, TeacherProfile>();
      profiles.forEach((data) => {
        const email = (data.email || "").toLowerCase();
        if (email) profMap.set(email, data);
        if (data.isHomeroom && data.homeroom) {
          const g = Number(data.homeroom.grade);
          const c = Number(data.homeroom.class ?? (data.homeroom as any).classNum);
          if (g && c) {
            const key = `${g}-${c}`;
            const list = map.get(key) || [];
            list.push({
              email,
              name: data.name || email,
            });
            map.set(key, list);
          }
        }
      });
      setApprovedHomerooms(map);
      setApprovedProfiles(profMap);
    }

    loadApproved().catch((err) => console.error("[ProfileApprovals] 프로필 로드 실패:", err));
    return () => {
      cancelled = true;
    };
  }, [userData?.domain, userData?.role]);

  /** 승인 시 현재 반영값에서 바뀌는 항목 요약 — "나중에 한 행동이 이긴다" 규칙(2026-08-07 사용자 확정)
   *  아래에서 승인은 항상 신청값을 전체 반영하되, 무엇이 덮이는지 관리자에게 보여준다. */
  const diffAgainstApproved = (profile: PendingProfile): string[] => {
    const cur = approvedProfiles.get((profile.email || "").toLowerCase());
    if (!cur) return [];
    const fmtDepts = (p: any) =>
      p.noDept ? "소속 없음" : (p.departments || []).map((d: string) => `${d}${p.deptHeadMap?.[d] ? "(부장)" : ""}`).join("·") || "—";
    const fmtHomeroom = (p: any) =>
      p.isHomeroom && p.homeroom ? `${p.homeroom.grade}학년 ${p.homeroom.class ?? p.homeroom.classNum}반 담임` : "담임 아님";
    const diffs: string[] = [];
    if (fmtDepts(cur) !== fmtDepts(profile)) diffs.push(`부서 ${fmtDepts(cur)} → ${fmtDepts(profile)}`);
    if ((cur.position || "—") !== (profile.position || "—")) diffs.push(`직책 ${cur.position || "—"} → ${profile.position || "—"}`);
    if (fmtHomeroom(cur) !== fmtHomeroom(profile)) diffs.push(`${fmtHomeroom(cur)} → ${fmtHomeroom(profile)}`);
    return diffs;
  };

  const handleApprove = async (profile: PendingProfile) => {
    if (!profile.email) return;
    setProcessing(profile.email);
    try {
      // 1. Copy to teacher_profiles (approved)
      // §11-7 되감기 방지: pending에는 내선이 없으므로, 기존 승인 프로필의 내선을 명시 보존 (merge: true 사용 금지)
      const existingExt = approvedProfiles.get(profile.email.toLowerCase())?.extension || "";
      const profileRef = doc(db, "teacher_profiles", profile.email);
      await setDoc(profileRef, {
        email: profile.email,
        name: profile.name,
        departments: profile.departments,
        noDept: profile.noDept || false,
        position: profile.position,
        extension: existingExt,
        isDeptHead: profile.isDeptHead || false,
        deptHeadMap: (profile as any).deptHeadMap || {},
        isHomeroom: profile.isHomeroom,
        homeroom: profile.homeroom || null,
        updatedAt: serverTimestamp(),
        updatedBy: userData?.email || "profile_approval",
      });

      // 2. Invalidate cache
      invalidateTeacherProfilesCache();

      // 3. Update pending status
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

  if (!isSuperAdmin) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        관리자 전용 메뉴입니다.
      </div>
    );
  }

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
            <span>조직도 편집 (수동 배치)</span>
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
          {/* 제목 없음 — 바로 위 서브탭 버튼이 「조직 정보 승인 대기」로 이미 켜져 있다 */}
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
                const approveDiffs = diffAgainstApproved(profile);

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

                    {/* 승인 시 변경 diff — 현재 반영값(수동 배치 포함)이 신청값으로 덮이는 항목 안내 (2026-08-07) */}
                    {approveDiffs.length > 0 && (
                      <div className="mx-6 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 space-y-1">
                        <div className="font-bold flex items-center space-x-1">
                          <span>ℹ️</span>
                          <span>승인하면 현재 반영값이 이렇게 바뀝니다</span>
                        </div>
                        {approveDiffs.map((d, i) => (
                          <p key={i} className="text-[11px] leading-tight">• {d}</p>
                        ))}
                      </div>
                    )}

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
