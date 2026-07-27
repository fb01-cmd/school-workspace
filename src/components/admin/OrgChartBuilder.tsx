"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, onSnapshot, query, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { writeAuditLog } from "@/lib/firebase/audit";

const DEFAULT_DEPARTMENTS = [
  "교장", "교감", "교목", "교무기획부", "교육연구부", "학생생활자치부",
  "교육과정부", "과학정보융합부", "건학인성부", "창의적체험활동부", "학력향상부",
  "진학지원부", "학생건강부", "1학년", "2학년", "3학년",
  "국어", "수학", "사회", "과학", "외국어", "생활교양", "예술", "체육",
  "진로상담", "행정실", "급식실", "휴직 및 퇴직 교사",
];

interface Props {
  onOpenDetailEdit?: (email: string) => void;
}

export default function OrgChartBuilder({ onOpenDetailEdit }: Props) {
  const { userData, schoolSettings } = useAuth();
  const [profiles, setProfiles] = useState<TeacherProfile[]>([]);
  const [gwsTeachers, setGwsTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 선택된 받는 부서 (locked target department)
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  // 명단 검색 및 미배치 필터
  const [searchQuery, setSearchQuery] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  // DnD drag over state
  const [dragOverDept, setDragOverDept] = useState<string | null>(null);

  // 토스트 메시지
  const [toast, setToast] = useState<{ type: "success" | "warning" | "info"; text: string } | null>(null);

  const isSuperAdmin = userData?.role === "super_admin";
  const departmentOrder = schoolSettings?.departments || DEFAULT_DEPARTMENTS;

  // 자동 토스트 닫기 (3초)
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 1. GWS 유저 목록 로드 (교사 명단용)
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (cached) {
      setGwsTeachers(cached);
    } else {
      fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ["all"] }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.users) {
            setClientCache("users:all", data.users);
            setGwsTeachers(data.users);
          }
        })
        .catch((err) => console.error("GWS 유저 로드 실패:", err));
    }
  }, []);

  // 2. 파이어베이스 승인 프로필 실시간 구독
  useEffect(() => {
    const q = query(collection(db, "teacher_profiles"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((docSnap) => {
          const data = docSnap.data() as TeacherProfile;
          return {
            ...data,
            email: (data.email || docSnap.id).toLowerCase(),
            name: data.name || (data.email || docSnap.id).split("@")[0],
          };
        });
        setProfiles(items);
        setLoading(false);
      },
      (err) => {
        console.error("조직도 프로필 구독 실패:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // 프로필 맵 (email -> TeacherProfile)
  const profileMap = useMemo(() => {
    const map = new Map<string, TeacherProfile>();
    profiles.forEach((p) => {
      if (p.email) map.set(p.email.toLowerCase(), p);
    });
    return map;
  }, [profiles]);

  // GWS 실명 해석
  const getDisplayName = (email: string, profile?: TeacherProfile) => {
    const cleanEmail = email.toLowerCase();
    const cachedUser = gwsTeachers.find(
      (u) => (u.primaryEmail || u.email || "").toLowerCase() === cleanEmail
    );
    if (cachedUser?.name) {
      const fullName =
        cachedUser.name.fullName ||
        (cachedUser.name.familyName ? `${cachedUser.name.familyName}${cachedUser.name.givenName || ""}` : null);
      if (fullName) return fullName.trim();
    }
    if (profile?.name) return profile.name;
    return cleanEmail.split("@")[0];
  };

  // 교직원 명단 (학생 OU 제외)
  const teacherUserList = useMemo(() => {
    return gwsTeachers.filter((u) => {
      const orgPath = (u.orgUnitPath || "").toLowerCase();
      // 학생 OU 제외 (student / 학생 포함 시 스킵)
      if (orgPath.includes("student") || orgPath.includes("학생")) return false;
      return true;
    });
  }, [gwsTeachers]);

  // 기본 부서 선택 (첫번째 부서)
  useEffect(() => {
    if (!selectedDept && departmentOrder.length > 0) {
      setSelectedDept(departmentOrder[0]);
    }
  }, [departmentOrder, selectedDept]);

  // ─── §1 정렬 규칙 헬퍼 ──────────────────────────────────────────
  const sortMembersForDept = (deptName: string, members: TeacherProfile[]) => {
    const isGradeDept = /^([1-3])학년$/.test(deptName);
    const targetGrade = isGradeDept ? parseInt(deptName[0], 10) : 0;

    if (isGradeDept) {
      return [...members].sort((a, b) => {
        const aIsHead = !!a.deptHeadMap?.[deptName] || (a.departments?.length === 1 && a.isDeptHead);
        const bIsHead = !!b.deptHeadMap?.[deptName] || (b.departments?.length === 1 && b.isDeptHead);

        if (aIsHead && !bIsHead) return -1;
        if (!aIsHead && bIsHead) return 1;

        const aIsHomeroom = a.isHomeroom && a.homeroom?.grade === targetGrade;
        const bIsHomeroom = b.isHomeroom && b.homeroom?.grade === targetGrade;

        if (aIsHomeroom && !bIsHomeroom) return -1;
        if (!aIsHomeroom && bIsHomeroom) return 1;

        if (aIsHomeroom && bIsHomeroom) {
          const aClass = Number(a.homeroom?.class || 0);
          const bClass = Number(b.homeroom?.class || 0);
          if (aClass !== bClass) return aClass - bClass;
        }

        const aName = getDisplayName(a.email, a);
        const bName = getDisplayName(b.email, b);
        return aName.localeCompare(bName, "ko");
      });
    } else {
      return [...members].sort((a, b) => {
        const aIsHead = !!a.deptHeadMap?.[deptName] || (a.departments?.length === 1 && a.isDeptHead);
        const bIsHead = !!b.deptHeadMap?.[deptName] || (b.departments?.length === 1 && b.isDeptHead);

        if (aIsHead && !bIsHead) return -1;
        if (!aIsHead && bIsHead) return 1;

        const aName = getDisplayName(a.email, a);
        const bName = getDisplayName(b.email, b);
        return aName.localeCompare(bName, "ko");
      });
    }
  };

  // 트리 구조 맵 (deptName -> TeacherProfile[])
  const deptMembersMap = useMemo(() => {
    const map = new Map<string, TeacherProfile[]>();
    departmentOrder.forEach((d) => map.set(d, []));
    const noDeptList: TeacherProfile[] = [];

    profiles.forEach((p) => {
      const depts = p.departments || [];
      if (depts.length === 0) {
        noDeptList.push(p);
      } else {
        depts.forEach((d) => {
          if (!map.has(d)) map.set(d, []);
          map.get(d)!.push(p);
        });
      }
    });

    // 정렬 적용
    const sortedMap = new Map<string, TeacherProfile[]>();
    departmentOrder.forEach((d) => {
      const list = map.get(d) || [];
      sortedMap.set(d, sortMembersForDept(d, list));
    });

    return { sortedMap, noDeptList };
  }, [profiles, departmentOrder, gwsTeachers]);

  // ─── Firestore 액션 ─────────────────────────────────────────────

  // 1. 교사 부서 추가 (클릭 또는 DnD)
  const handleAssignTeacherToDept = async (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const existing = profileMap.get(cleanEmail);
    const existingDepts = existing?.departments || [];

    if (existingDepts.includes(deptName)) {
      setToast({
        type: "warning",
        text: `'${getDisplayName(cleanEmail, existing)}' 교사는 이미 [${deptName}]에 소속되어 있습니다.`,
      });
      return;
    }

    const newDepts = [...existingDepts, deptName];
    const nameVal = getDisplayName(cleanEmail, existing);

    // 직책 자동 추론
    let positionVal = existing?.position || "";
    if (!positionVal) {
      if (["교장", "교감", "교목"].includes(deptName)) {
        positionVal = deptName;
      } else {
        positionVal = "교사";
      }
    }

    try {
      // 1) teacher_profiles 업데이트 (merge)
      const ref = doc(db, "teacher_profiles", cleanEmail);
      await setDoc(
        ref,
        {
          email: cleanEmail,
          name: nameVal,
          departments: newDepts,
          position: positionVal,
          updatedAt: serverTimestamp(),
          updatedBy: userData?.email || "super_admin",
        },
        { merge: true }
      );

      // 2) pending 신청 자동 무효화
      const pendingRef = doc(db, "teacher_profiles_pending", cleanEmail);
      await setDoc(
        pendingRef,
        { status: "APPROVED", approvedAt: serverTimestamp() },
        { merge: true }
      );

      // 3) 감사 로그
      await writeAuditLog({
        action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
        status: "success",
        targetEmail: cleanEmail,
        details: `[${deptName}] 부서에 교사 추가 (${nameVal})`,
        operatorEmail: userData?.email || "",
      });

      setToast({
        type: "success",
        text: `'${nameVal}' 교사를 [${deptName}]에 배치했습니다.`,
      });
    } catch (err: any) {
      console.error("부서 배치 실패:", err);
      setToast({ type: "warning", text: `배치 실패: ${err.message}` });
    }
  };

  // 2. 부서에서 교사 제거
  const handleRemoveTeacherFromDept = async (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const existing = profileMap.get(cleanEmail);
    if (!existing) return;

    const newDepts = (existing.departments || []).filter((d) => d !== deptName);
    const newHeadMap = { ...(existing.deptHeadMap || {}) };
    delete newHeadMap[deptName];

    try {
      const ref = doc(db, "teacher_profiles", cleanEmail);
      await setDoc(
        ref,
        {
          departments: newDepts,
          deptHeadMap: newHeadMap,
          isDeptHead: Object.values(newHeadMap).some(Boolean),
          updatedAt: serverTimestamp(),
          updatedBy: userData?.email || "super_admin",
        },
        { merge: true }
      );

      await writeAuditLog({
        action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
        status: "success",
        targetEmail: cleanEmail,
        details: `[${deptName}] 부서에서 교사 제거 (${getDisplayName(cleanEmail, existing)})`,
        operatorEmail: userData?.email || "",
      });

      setToast({
        type: "info",
        text: `'${getDisplayName(cleanEmail, existing)}' 교사를 [${deptName}]에서 제거했습니다.`,
      });
    } catch (err: any) {
      console.error("부서 제거 실패:", err);
      setToast({ type: "warning", text: `제거 실패: ${err.message}` });
    }
  };

  // 3. 부장 토글
  const handleToggleHead = async (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const existing = profileMap.get(cleanEmail);
    if (!existing) return;

    const currentHeadState = !!existing.deptHeadMap?.[deptName];
    const newHeadState = !currentHeadState;

    // 다른 교사가 부장인지 경고 확인
    if (newHeadState) {
      const otherHead = profiles.find(
        (p) => p.email.toLowerCase() !== cleanEmail && p.deptHeadMap?.[deptName]
      );
      if (otherHead) {
        setToast({
          type: "warning",
          text: `⚠️ [${deptName}]에 이미 부장(${getDisplayName(otherHead.email, otherHead)})이 등록되어 있습니다. (공동 부장으로 설정됨)`,
        });
      }
    }

    const newHeadMap = { ...(existing.deptHeadMap || {}), [deptName]: newHeadState };

    try {
      const ref = doc(db, "teacher_profiles", cleanEmail);
      await setDoc(
        ref,
        {
          deptHeadMap: newHeadMap,
          isDeptHead: Object.values(newHeadMap).some(Boolean),
          updatedAt: serverTimestamp(),
          updatedBy: userData?.email || "super_admin",
        },
        { merge: true }
      );

      await writeAuditLog({
        action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
        status: "success",
        targetEmail: cleanEmail,
        details: `[${deptName}] ${newHeadState ? "부장 지정" : "부장 해제"} (${getDisplayName(cleanEmail, existing)})`,
        operatorEmail: userData?.email || "",
      });
    } catch (err: any) {
      console.error("부장 토글 실패:", err);
      setToast({ type: "warning", text: `부장 변경 실패: ${err.message}` });
    }
  };

  // 4. 학년부 인라인 반 지정 / 해제
  const handleSetHomeroomClass = async (
    email: string,
    grade: number,
    selectedClass: number | null
  ) => {
    const cleanEmail = email.toLowerCase();
    const existing = profileMap.get(cleanEmail);
    if (!existing) return;

    if (selectedClass !== null) {
      // 이미 같은 반에 다른 담임이 있는지 경고 점검
      const otherHomeroom = profiles.find(
        (p) =>
          p.email.toLowerCase() !== cleanEmail &&
          p.isHomeroom &&
          p.homeroom?.grade === grade &&
          p.homeroom?.class === selectedClass
      );

      if (otherHomeroom) {
        setToast({
          type: "warning",
          text: `⚠️ ${grade}-${selectedClass}반에 이미 담임(${getDisplayName(otherHomeroom.email, otherHomeroom)})이 지정되어 있습니다. (공동 담임으로 유지됨)`,
        });
      }
    }

    try {
      const ref = doc(db, "teacher_profiles", cleanEmail);
      await setDoc(
        ref,
        {
          isHomeroom: selectedClass !== null,
          homeroom: selectedClass !== null ? { grade, class: selectedClass } : null,
          updatedAt: serverTimestamp(),
          updatedBy: userData?.email || "super_admin",
        },
        { merge: true }
      );

      await writeAuditLog({
        action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
        status: "success",
        targetEmail: cleanEmail,
        details: `${grade}학년 ${selectedClass !== null ? `${selectedClass}반 담임 지정` : "담임 해제"} (${getDisplayName(cleanEmail, existing)})`,
        operatorEmail: userData?.email || "",
      });
    } catch (err: any) {
      console.error("담임 지정 실패:", err);
      setToast({ type: "warning", text: `담임 변경 실패: ${err.message}` });
    }
  };

  // 명단 필터링
  const filteredTeacherUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return teacherUserList.filter((u) => {
      const email = (u.primaryEmail || u.email || "").toLowerCase();
      const profile = profileMap.get(email);
      const name = getDisplayName(email, profile).toLowerCase();

      // 검색어 대조
      if (q && !name.includes(q) && !email.includes(q)) return false;

      // 미배치 필터
      if (unassignedOnly) {
        const depts = profile?.departments || [];
        if (depts.length > 0) return false;
      }

      return true;
    }).sort((a, b) => {
      const emailA = (a.primaryEmail || a.email || "").toLowerCase();
      const emailB = (b.primaryEmail || b.email || "").toLowerCase();
      const nameA = getDisplayName(emailA, profileMap.get(emailA));
      const nameB = getDisplayName(emailB, profileMap.get(emailB));
      return nameA.localeCompare(nameB, "ko");
    });
  }, [teacherUserList, profileMap, searchQuery, unassignedOnly]);

  return (
    <div className="space-y-4">
      {/* 토스트 메세지 */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs font-bold transition-all flex items-center gap-2 ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-300"
              : toast.type === "warning"
              ? "bg-amber-50 text-amber-900 border-amber-300"
              : "bg-blue-50 text-blue-900 border-blue-300"
          }`}
        >
          <span>{toast.type === "success" ? "✅" : toast.type === "warning" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.text}</span>
        </div>
      )}

      {/* 안내 상단 배너 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-xl p-5 shadow-sm border border-indigo-800/40">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>🏗️</span>
              <span>교직원 조직도 빌더 (수동 인사 배치)</span>
            </h2>
            <p className="text-xs text-indigo-200/80 mt-1">
              <strong>주력 동선:</strong> 왼쪽 트리에서 [받는 부서]를 클릭 고정한 후, 오른쪽 명단에서 교사를 클릭하면 연속 배치됩니다. (드래그 앤 드롭 지원)
            </p>
          </div>
          {selectedDept && (
            <div className="px-3 py-1.5 bg-amber-400 text-amber-950 rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-sm border border-amber-300 shrink-0 animate-pulse">
              <span>🎯</span>
              <span>받는 부서: [{selectedDept}] 추가 중</span>
            </div>
          )}
        </div>
      </div>

      {/* 메인 2열 패널 Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ── [왼쪽 7열] 조직도 트리 ─────────────────────────── */}
        <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>🌳</span>
              <span>학교 조직도 부서 트리 ({departmentOrder.length}개 부서)</span>
            </h3>
            <span className="text-[11px] text-gray-400">부서 헤더 클릭 = 받는 부서 고정</span>
          </div>

          <div className="space-y-3 max-h-[750px] overflow-y-auto pr-1">
            {departmentOrder.map((deptName) => {
              const isSelected = selectedDept === deptName;
              const isDragOver = dragOverDept === deptName;
              const members = deptMembersMap.sortedMap.get(deptName) || [];
              const isGradeDept = /^([1-3])학년$/.test(deptName);
              const gradeNum = isGradeDept ? parseInt(deptName[0], 10) : 0;
              const classCount = isGradeDept
                ? Number(schoolSettings?.classCounts?.[gradeNum] ?? 10)
                : 0;

              return (
                <div
                  key={deptName}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverDept(deptName);
                  }}
                  onDragLeave={() => setDragOverDept(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverDept(null);
                    const email = e.dataTransfer.getData("text/plain");
                    if (email) handleAssignTeacherToDept(email, deptName);
                  }}
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isSelected
                      ? "border-amber-400 bg-amber-50/20 ring-2 ring-amber-300"
                      : isDragOver
                      ? "border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-300"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  {/* 부서 헤더 (받는 부서 선택 타겟) */}
                  <div
                    onClick={() => setSelectedDept(deptName)}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer select-none transition-colors ${
                      isSelected
                        ? "bg-amber-100/70 text-amber-950 font-bold"
                        : "bg-gray-50 hover:bg-gray-100 text-gray-800"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">
                        {isGradeDept ? "🏫" : deptName.includes("부") ? "🏢" : "📁"}
                      </span>
                      <span className="text-sm font-bold truncate">{deptName}</span>
                      <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                        {members.length}명
                      </span>
                    </div>

                    {isSelected ? (
                      <span className="text-[11px] font-extrabold bg-amber-500 text-white px-2 py-0.5 rounded-md shadow-xs">
                        🎯 받는 부서 고정됨
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-gray-400 hover:text-indigo-600">
                        클릭하여 선택 →
                      </span>
                    )}
                  </div>

                  {/* 부서 소속 교사 칩 목록 */}
                  <div className="p-3 bg-white space-y-2">
                    {members.length === 0 ? (
                      <p className="text-xs text-gray-300 italic py-1 px-2">
                        배치된 인원이 없습니다. (오른쪽 명단에서 클릭하여 추가)
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {members.map((teacher) => {
                          const email = teacher.email.toLowerCase();
                          const isHead =
                            !!teacher.deptHeadMap?.[deptName] ||
                            (teacher.departments?.length === 1 && teacher.isDeptHead);
                          const isHomeroomMatch = teacher.isHomeroom && teacher.homeroom;

                          return (
                            <div
                              key={`${deptName}-${email}`}
                              className="group relative inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 hover:border-indigo-300 rounded-lg text-xs transition-all shadow-2xs"
                            >
                              <span className="text-slate-400 text-xs">👤</span>
                              <span className="font-bold text-slate-900">
                                {getDisplayName(email, teacher)}
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {email}
                              </span>

                              {/* 뱃지들 */}
                              {isHead && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-extrabold rounded">
                                  👑 {isGradeDept ? "부장" : "부서장"}
                                </span>
                              )}

                              {teacher.position && (
                                <span className="px-1.5 py-0.5 bg-slate-200/60 text-slate-700 text-[10px] font-semibold rounded">
                                  {teacher.position}
                                </span>
                              )}

                              {isGradeDept && isHomeroomMatch && (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-300 text-[10px] font-extrabold rounded">
                                  🏫 {teacher.homeroom?.grade}-{teacher.homeroom?.class} 담임
                                </span>
                              )}

                              {/* 학년부 인라인 반 선택 드롭다운 */}
                              {isGradeDept && (
                                <select
                                  value={
                                    teacher.isHomeroom && teacher.homeroom?.grade === gradeNum
                                      ? teacher.homeroom.class
                                      : 0
                                  }
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    handleSetHomeroomClass(email, gradeNum, val === 0 ? null : val);
                                  }}
                                  className="text-[10px] font-bold bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-800 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
                                >
                                  <option value={0}>반 미지정</option>
                                  {Array.from({ length: classCount }, (_, i) => i + 1).map((c) => (
                                    <option key={c} value={c}>
                                      {c}반 담임
                                    </option>
                                  ))}
                                </select>
                              )}

                              {/* 칩 호버 전용 액션 버튼들 */}
                              <div className="hidden group-hover:flex items-center gap-1 ml-1 bg-white/90 backdrop-blur-xs px-1 py-0.5 rounded border border-gray-200 shadow-xs">
                                <button
                                  type="button"
                                  onClick={() => handleToggleHead(email, deptName)}
                                  className={`p-1 rounded text-[10px] font-bold transition-colors ${
                                    isHead
                                      ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                                      : "text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                                  }`}
                                  title="부장 직책 토글"
                                >
                                  👑
                                </button>
                                {onOpenDetailEdit && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenDetailEdit(email)}
                                    className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px] transition-colors"
                                    title="세부 편집 폼 열기"
                                  >
                                    ✏️
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTeacherFromDept(email, deptName)}
                                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 text-[10px] transition-colors"
                                  title="이 부서에서 제거"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 소속 없음 섹션 */}
            {deptMembersMap.noDeptList.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span>🚫</span>
                  <span className="text-sm font-bold text-gray-700">소속 없음 (미등록)</span>
                  <span className="text-xs font-semibold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                    {deptMembersMap.noDeptList.length}명
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {deptMembersMap.noDeptList.map((teacher) => (
                    <div
                      key={teacher.email}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700"
                    >
                      {getDisplayName(teacher.email, teacher)} ({teacher.email})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── [오른쪽 5열] 교사 명단 ──────────────────────────── */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>👥</span>
                <span>교직원 전체 명단 ({filteredTeacherUsers.length}명)</span>
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                교사 클릭 시 <strong>[{selectedDept || "부서선택"}]</strong>에 즉시 추가
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-amber-900 font-bold bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => setUnassignedOnly(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500"
              />
              <span>🍊 미배치만 보기</span>
            </label>
          </div>

          {/* 검색창 */}
          <div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="교사 이름 또는 이메일 검색..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* 교사 명단 리스트 */}
          <div className="space-y-1.5 max-h-[660px] overflow-y-auto pr-1 divide-y divide-gray-100">
            {filteredTeacherUsers.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-10">검색 조건에 해당 교사가 없습니다.</p>
            ) : (
              filteredTeacherUsers.map((u) => {
                const email = (u.primaryEmail || u.email || "").toLowerCase();
                const profile = profileMap.get(email);
                const realName = getDisplayName(email, profile);
                const depts = profile?.departments || [];
                const isUnassigned = depts.length === 0;
                const isInSelectedDept = selectedDept ? depts.includes(selectedDept) : false;

                return (
                  <div
                    key={email}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", email);
                    }}
                    onClick={() => {
                      if (selectedDept) {
                        handleAssignTeacherToDept(email, selectedDept);
                      } else {
                        setToast({
                          type: "warning",
                          text: "왼쪽 조직도 트리에서 먼저 배치할 [받는 부서]를 클릭해 주세요.",
                        });
                      }
                    }}
                    className={`pt-2 pb-2 px-3 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                      isInSelectedDept
                        ? "bg-slate-50 hover:bg-slate-100 text-slate-400 opacity-80"
                        : isUnassigned
                        ? "bg-amber-50/50 hover:bg-amber-100/70 text-amber-950 border border-amber-200/80"
                        : "hover:bg-indigo-50/50 text-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 shrink-0">👤</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate">{realName}</p>
                        <p className="text-[10px] text-gray-400 font-mono truncate">{email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isUnassigned ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-extrabold rounded-md shadow-2xs">
                          🍊 미배치
                        </span>
                      ) : (
                        <span
                          className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-extrabold rounded-md truncate max-w-[120px]"
                          title={depts.join(", ")}
                        >
                          🏷️ {depts.length}개 부서 ({depts.join(", ")})
                        </span>
                      )}

                      {selectedDept && (
                        <button
                          type="button"
                          className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded shadow-2xs"
                        >
                          + 추가
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
