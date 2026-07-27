"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, onSnapshot, query, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { writeAuditLog } from "@/lib/firebase/audit";
import ManualProfileEditor from "@/components/admin/ManualProfileEditor";

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

  // 세부 편집 모달 (ManualProfileEditor) 타겟 이메일
  const [editingTeacherEmail, setEditingTeacherEmail] = useState<string | null>(null);

  // §7-1 로컬 스테이징 맵 (email.toLowerCase() -> Staged TeacherProfile)
  // sessionStorage 보존 — 서브 탭/메뉴 전환으로 컴포넌트가 unmount돼도 미반영 변경이 유실되지 않게 (beforeunload는 인앱 이동을 못 막음)
  const STAGING_KEY = "orgChartBuilder:staged";
  const [stagedProfiles, setStagedProfiles] = useState<Record<string, TeacherProfile>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.sessionStorage.getItem(STAGING_KEY) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STAGING_KEY, JSON.stringify(stagedProfiles));
    } catch {
      /* 저장 실패는 치명적이지 않음 — beforeunload 가드가 남아 있음 */
    }
  }, [stagedProfiles]);

  // 일괄 반영(커밋) 상태
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{ current: number; total: number } | null>(null);

  // 명단 검색 및 미배치 필터
  const [searchQuery, setSearchQuery] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  // DnD drag over state
  const [dragOverDept, setDragOverDept] = useState<string | null>(null);

  // 토스트 메시지
  const [toast, setToast] = useState<{ type: "success" | "warning" | "info"; text: string } | null>(null);

  const isSuperAdmin = userData?.role === "super_admin";
  const departmentOrder = schoolSettings?.departments || DEFAULT_DEPARTMENTS;

  // 자동 토스트 닫기 (3.5초)
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // §7-1 이탈 가드 (beforeunload)
  const stagedCount = Object.keys(stagedProfiles).length;
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (stagedCount > 0) {
        e.preventDefault();
        e.returnValue = "미반영된 조직도 변경사항이 있습니다. 이 페이지를 벗어나시겠습니까?";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [stagedCount]);

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

  // 파이어베이스 프로필 맵 (email -> TeacherProfile)
  const profileMap = useMemo(() => {
    const map = new Map<string, TeacherProfile>();
    profiles.forEach((p) => {
      if (p.email) map.set(p.email.toLowerCase(), p);
    });
    return map;
  }, [profiles]);

  // 실효 프로필 조회 (로컬 스테이징 오버레이)
  const getEffectiveProfile = (email: string): TeacherProfile => {
    const cleanEmail = email.toLowerCase();
    if (stagedProfiles[cleanEmail]) {
      return stagedProfiles[cleanEmail];
    }
    const base = profileMap.get(cleanEmail);
    if (base) return base;

    return {
      email: cleanEmail,
      name: cleanEmail.split("@")[0],
      departments: [],
      position: "",
      isDeptHead: false,
      deptHeadMap: {},
      isHomeroom: false,
      homeroom: undefined,
    };
  };

  // 스테이징 변경 존재 여부
  const isTeacherStaged = (email: string): boolean => {
    return Boolean(stagedProfiles[email.toLowerCase()]);
  };

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

  // 교직원 명단 — 교직원 OU 매핑이 있으면 그 하위만(기기·졸업생 계정 유입 차단), 없으면 학생 OU 제외 폴백
  const teacherUserList = useMemo(() => {
    const teacherOU = ((schoolSettings as any)?.ouMapping?.teachers || "").toLowerCase();
    return gwsTeachers.filter((u) => {
      const email = (u.primaryEmail || u.email || "").toLowerCase();
      if (/^\d{5}@/.test(email)) return false; // 학번 계정(학생·졸업생) 제외
      const orgPath = (u.orgUnitPath || "").toLowerCase();
      if (teacherOU) {
        return orgPath === teacherOU || orgPath.startsWith(teacherOU + "/");
      }
      if (orgPath.includes("student") || orgPath.includes("학생")) return false;
      return true;
    });
  }, [gwsTeachers, schoolSettings]);

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

  // 트리 구조 맵 (deptName -> TeacherProfile[]) — 파이어베이스 + 로컬 스테이징 오버레이 병합
  const deptMembersMap = useMemo(() => {
    const map = new Map<string, TeacherProfile[]>();
    departmentOrder.forEach((d) => map.set(d, []));
    const noDeptList: TeacherProfile[] = [];

    // 전교 교사 이메일 유니온 (Firestore profiles + stagedProfiles + GWS teachers)
    const allEmails = new Set<string>();
    profiles.forEach((p) => p.email && allEmails.add(p.email.toLowerCase()));
    Object.keys(stagedProfiles).forEach((e) => allEmails.add(e.toLowerCase()));

    allEmails.forEach((email) => {
      const p = getEffectiveProfile(email);
      const depts = p.departments || [];
      if (depts.length === 0 && p.noDept === true) {
        noDeptList.push(p);
      } else if (depts.length > 0) {
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
  }, [profiles, stagedProfiles, departmentOrder, gwsTeachers]);

  // ─── §7-1 로컬 스테이징 액션 (즉시 저장 폐지 → 로컬 갱신) ─────────────

  // 1. 교사 부서 추가 (클릭 또는 DnD)
  const handleAssignTeacherToDept = (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const currentProf = getEffectiveProfile(cleanEmail);
    const existingDepts = currentProf.departments || [];

    if (existingDepts.includes(deptName)) {
      setToast({
        type: "warning",
        text: `'${getDisplayName(cleanEmail, currentProf)}' 교사는 이미 [${deptName}]에 소속되어 있습니다.`,
      });
      return;
    }

    const newDepts = [...existingDepts, deptName];
    const nameVal = getDisplayName(cleanEmail, currentProf);

    // 직책 자동 추론 (기존 직책이 있으면 보존)
    let positionVal = currentProf.position || "";
    if (!positionVal) {
      if (["교장", "교감", "교목"].includes(deptName)) {
        positionVal = deptName;
      } else {
        positionVal = "교사";
      }
    }

    const newDraft: TeacherProfile = {
      ...currentProf,
      email: cleanEmail,
      name: nameVal,
      departments: newDepts,
      noDept: false, // §8-2 noDept 교사를 일반 부서에 추가(배치 모드)하면 noDept 자동 해제
      position: positionVal,
    };

    setStagedProfiles((prev) => ({ ...prev, [cleanEmail]: newDraft }));
    setToast({
      type: "info",
      text: `'${nameVal}' 교사를 [${deptName}]에 추가했습니다. (미반영●)`,
    });
  };

  // 2. 부서에서 교사 제거
  const handleRemoveTeacherFromDept = (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const currentProf = getEffectiveProfile(cleanEmail);

    const newDepts = (currentProf.departments || []).filter((d) => d !== deptName);
    const newHeadMap = { ...(currentProf.deptHeadMap || {}) };
    delete newHeadMap[deptName];

    const newDraft: TeacherProfile = {
      ...currentProf,
      departments: newDepts,
      deptHeadMap: newHeadMap,
      isDeptHead: Object.values(newHeadMap).some(Boolean),
    };

    setStagedProfiles((prev) => ({ ...prev, [cleanEmail]: newDraft }));
    setToast({
      type: "info",
      text: `'${getDisplayName(cleanEmail, currentProf)}' 교사를 [${deptName}]에서 제거했습니다. (미반영●)`,
    });
  };

  // 3. 부장 토글
  const handleToggleHead = (email: string, deptName: string) => {
    const cleanEmail = email.toLowerCase();
    const currentProf = getEffectiveProfile(cleanEmail);

    const currentHeadState = !!currentProf.deptHeadMap?.[deptName];
    const newHeadState = !currentHeadState;

    if (newHeadState) {
      // 다른 교사가 부장인지 경고 확인 (스테이징 포함)
      const otherHead = Array.from(deptMembersMap.sortedMap.get(deptName) || []).find(
        (p) => p.email.toLowerCase() !== cleanEmail && p.deptHeadMap?.[deptName]
      );
      if (otherHead) {
        setToast({
          type: "warning",
          text: `⚠️ [${deptName}]에 이미 부장(${getDisplayName(otherHead.email, otherHead)})이 등록되어 있습니다. (공동 부장으로 설정됨)`,
        });
      }
    }

    const newHeadMap = { ...(currentProf.deptHeadMap || {}), [deptName]: newHeadState };
    const newDraft: TeacherProfile = {
      ...currentProf,
      deptHeadMap: newHeadMap,
      isDeptHead: Object.values(newHeadMap).some(Boolean),
    };

    setStagedProfiles((prev) => ({ ...prev, [cleanEmail]: newDraft }));
  };

  // 4. 학년부 인라인 반 지정 / 해제
  const handleSetHomeroomClass = (
    email: string,
    grade: number,
    selectedClass: number | null
  ) => {
    const cleanEmail = email.toLowerCase();
    const currentProf = getEffectiveProfile(cleanEmail);

    if (selectedClass !== null) {
      // 다른 교사가 이미 담임인지 경고 확인
      const otherHomeroom = Array.from(deptMembersMap.sortedMap.get(`${grade}학년`) || []).find(
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

    const newDraft: TeacherProfile = {
      ...currentProf,
      isHomeroom: selectedClass !== null,
      homeroom: selectedClass !== null ? { grade, class: selectedClass } : undefined,
    };

    setStagedProfiles((prev) => ({ ...prev, [cleanEmail]: newDraft }));
  };

  // ─── §7-1 일괄 반영(커밋) & 취소 ───────────────────────────────

  // 모두 취소
  const handleRevertAll = () => {
    if (stagedCount === 0) return;
    if (confirm(`미반영된 ${stagedCount}명의 인사 배치 변경사항을 모두 취소하시겠습니까?`)) {
      setStagedProfiles({});
      setToast({ type: "info", text: "모든 미반영 변경사항이 취소되었습니다." });
    }
  };

  // N명 일괄 반영하기
  const handleCommitStaged = async () => {
    const entries = Object.entries(stagedProfiles);
    if (entries.length === 0) return;

    if (!confirm(`미반영된 ${entries.length}명의 인사 배치를 Firestore 및 조직도에 일괄 반영하시겠습니까?`)) {
      return;
    }

    setIsCommitting(true);
    setCommitProgress({ current: 0, total: entries.length });

    const failedEmails: string[] = [];
    let successCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const [cleanEmail, draft] = entries[i];
      setCommitProgress({ current: i + 1, total: entries.length });

      try {
        // 1) teacher_profiles setDoc (merge)
        // homeroom이 undefined면 setDoc이 예외를 던진다(ignoreUndefinedProperties 미설정) — 신규 교사·담임 해제가 전부 이 경로
        const ref = doc(db, "teacher_profiles", cleanEmail);
        await setDoc(
          ref,
          {
            ...draft,
            homeroom: draft.homeroom ?? null,
            updatedAt: serverTimestamp(),
            updatedBy: userData?.email || "super_admin",
          },
          { merge: true }
        );

        // 2) pending 신청 무효화 — 실재하는 PENDING만 (무조건 setDoc 시 빈 pending 문서 생성 오염)
        const pendingRef = doc(db, "teacher_profiles_pending", cleanEmail);
        const pendingSnap = await getDoc(pendingRef);
        if (pendingSnap.exists() && pendingSnap.data()?.status === "PENDING") {
          await setDoc(
            pendingRef,
            { status: "APPROVED", approvedAt: serverTimestamp(), supersededByManual: true },
            { merge: true }
          );
        }

        // 3) 감사 로그
        await writeAuditLog({
          action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
          status: "success",
          targetEmail: cleanEmail,
          details: `[인사 배치 일괄 반영] 부서: ${draft.departments?.join(", ") || "미배치"}, 직책: ${draft.position || "미지정"}`,
          operatorEmail: userData?.email || "",
        });

        successCount++;
      } catch (err) {
        console.error(`교사 [${cleanEmail}] 반영 실패:`, err);
        failedEmails.push(cleanEmail);
      }
    }

    // 성공한 항목만 stagedProfiles에서 제거
    setStagedProfiles((prev) => {
      const next = { ...prev };
      entries.forEach(([e]) => {
        if (!failedEmails.includes(e)) {
          delete next[e];
        }
      });
      return next;
    });

    setIsCommitting(false);
    setCommitProgress(null);

    if (failedEmails.length === 0) {
      setToast({
        type: "success",
        text: `🎉 ${successCount}명의 인사 배치가 성공적으로 반영되었습니다!`,
      });
    } else {
      setToast({
        type: "warning",
        text: `⚠️ ${successCount}명 반영 완료, ${failedEmails.length}명 반영 실패. 실패 항목은 미반영 상태로 유지됩니다.`,
      });
    }
  };

  // 명단 필터링
  const filteredTeacherUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return teacherUserList.filter((u) => {
      const email = (u.primaryEmail || u.email || "").toLowerCase();
      const profile = getEffectiveProfile(email);
      const name = getDisplayName(email, profile).toLowerCase();

      // 검색어 대조
      if (q && !name.includes(q) && !email.includes(q)) return false;

      // 미배치 필터 (noDept === true 해당없음 계정 제외)
      if (unassignedOnly) {
        const depts = profile?.departments || [];
        const isNoDept = profile?.noDept === true;
        if (depts.length > 0 || isNoDept) return false;
      }

      return true;
    }).sort((a, b) => {
      const emailA = (a.primaryEmail || a.email || "").toLowerCase();
      const emailB = (b.primaryEmail || b.email || "").toLowerCase();
      const nameA = getDisplayName(emailA, getEffectiveProfile(emailA));
      const nameB = getDisplayName(emailB, getEffectiveProfile(emailB));
      return nameA.localeCompare(nameB, "ko");
    });
  }, [teacherUserList, stagedProfiles, profiles, searchQuery, unassignedOnly]);

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

      {/* 안내 상단 배너 & §7-1 일괄 반영 스테이징 바 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-xl p-5 shadow-md border border-indigo-800/40 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>🏗️</span>
              <span>교직원 조직도 빌더 (수동 인사 배치 v2)</span>
            </h2>
            <p className="text-xs text-indigo-200/80 mt-1">
              <strong>주력 동선:</strong> 왼쪽 트리에서 [받는 부서]를 클릭 고정한 후, 오른쪽 명단에서 교사를 클릭하여 편하게 편집하세요. (로컬에서 편집 후 상단 반영 버튼으로 일괄 저장)
            </p>
          </div>

          {selectedDept && (
            <button
              type="button"
              onClick={() => setSelectedDept(null)}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-500 text-amber-950 rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-xs border border-amber-300 shrink-0 cursor-pointer transition-colors"
              title="클릭하여 받는 부서 고정 해제"
            >
              <span>🎯</span>
              <span>받는 부서: [{selectedDept}]</span>
              <span className="ml-1 text-amber-900 font-bold hover:text-black">✕</span>
            </button>
          )}
        </div>

        {/* §7-1 상단 스테이징 커밋 바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white/10 p-3 rounded-xl border border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <span className="text-amber-400 text-base">●</span>
              <span>미반영 변경:</span>
              <span className={`px-2 py-0.5 rounded-full font-extrabold text-xs ${
                stagedCount > 0 ? "bg-amber-400 text-amber-950" : "bg-white/20 text-indigo-200"
              }`}>
                {stagedCount}명
              </span>
            </div>
            {isCommitting && commitProgress && (
              <span className="text-xs text-emerald-300 font-semibold animate-pulse">
                ({commitProgress.current}/{commitProgress.total} 반영 중...)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRevertAll}
              disabled={stagedCount === 0 || isCommitting}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all border border-white/20"
            >
              ↺ 모두 취소
            </button>
            <button
              type="button"
              onClick={handleCommitStaged}
              disabled={stagedCount === 0 || isCommitting}
              className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-extrabold rounded-lg shadow-md transition-all flex items-center gap-1.5 border border-emerald-400/40"
            >
              <span>💾</span>
              <span>{isCommitting ? "반영 중..." : `${stagedCount}명 반영하기`}</span>
            </button>
          </div>
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
                    onClick={() => setSelectedDept((prev) => (prev === deptName ? null : deptName))}
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
                        🎯 받는 부서
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
                          const staged = isTeacherStaged(email);

                          return (
                            <div
                              key={`${deptName}-${email}`}
                              className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all border shadow-2xs ${
                                staged
                                  ? "bg-amber-50/80 border-amber-300 hover:border-amber-400"
                                  : "bg-slate-50 hover:bg-indigo-50/40 border-slate-200 hover:border-indigo-300"
                              }`}
                            >
                              {/* §7-1 미반영 주황 점(●) 표시 */}
                              {staged ? (
                                <span className="text-amber-500 font-extrabold text-[10px]" title="미반영 변경사항 존재">
                                  ●
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">👤</span>
                              )}

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

                              {/* 학년부 인라인 반 선택 드롭다운 (상시 노출 유지) */}
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
                                  className="text-[10px] font-bold bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-800 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer shrink-0"
                                >
                                  <option value={0}>반 미지정</option>
                                  {Array.from({ length: classCount }, (_, i) => i + 1).map((c) => (
                                    <option key={c} value={c}>
                                      {c}반 담임
                                    </option>
                                  ))}
                                </select>
                              )}

                              {/* §7-2 호버 액션 버튼 (공간 상시 점유 + opacity 전환으로 깜박임 완전 제거) */}
                              <div className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity flex items-center gap-1 ml-1 bg-white/90 backdrop-blur-xs px-1 py-0.5 rounded border border-gray-200 shadow-xs shrink-0">
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
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTeacherEmail(email);
                                    if (onOpenDetailEdit) onOpenDetailEdit(email);
                                  }}
                                  className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px] transition-colors"
                                  title="세부 편집 폼 열기"
                                >
                                  ✏️
                                </button>
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

            {/* §8-2 해당사항 없음 (noDept === true) 섹션 */}
            {deptMembersMap.noDeptList.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>🚫</span>
                    <span className="text-sm font-bold text-slate-700">해당사항 없음 (처리 완료)</span>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                      {deptMembersMap.noDeptList.length}명
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">직책 및 소속 없음 처리된 계정</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {deptMembersMap.noDeptList.map((teacher) => {
                    const email = teacher.email.toLowerCase();
                    const staged = isTeacherStaged(email);
                    return (
                      <div
                        key={email}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border shadow-2xs ${
                          staged
                            ? "bg-amber-50 border-amber-300 text-amber-950"
                            : "bg-white border-slate-200 text-slate-700"
                        }`}
                      >
                        {staged ? (
                          <span className="text-amber-500 font-extrabold text-[10px]" title="미반영 변경사항 존재">
                            ●
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">👤</span>
                        )}
                        <span className="font-bold">{getDisplayName(email, teacher)}</span>
                        <span className="text-[11px] text-slate-400 font-mono">{email}</span>
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-extrabold rounded">
                          🚫 해당없음
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTeacherEmail(email);
                            if (onOpenDetailEdit) onOpenDetailEdit(email);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px] transition-colors"
                          title="세부 편집 폼 열기"
                        >
                          ✏️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>👥</span>
                <span>교직원 전체 명단 ({filteredTeacherUsers.length}명)</span>
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {selectedDept ? (
                  <>클릭 시 <strong className="text-amber-600">[{selectedDept}]</strong>에 추가 (스테이징●)</>
                ) : (
                  <>클릭 시 <strong className="text-indigo-600">세부 편집 모달</strong> 열기 (직책·해당없음)</>
                )}
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
                const profile = getEffectiveProfile(email);
                const realName = getDisplayName(email, profile);
                const depts = profile?.departments || [];
                const isNoDept = profile?.noDept === true;
                const isUnassigned = depts.length === 0 && !isNoDept;
                const isInSelectedDept = selectedDept ? depts.includes(selectedDept) : false;
                const staged = isTeacherStaged(email);

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
                        setEditingTeacherEmail(email);
                      }
                    }}
                    className={`pt-2 pb-2 px-3 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                      isInSelectedDept
                        ? "bg-slate-50 hover:bg-slate-100 text-slate-400 opacity-80"
                        : isNoDept
                        ? "bg-slate-50/70 hover:bg-slate-100 text-slate-600 border border-slate-200"
                        : isUnassigned
                        ? "bg-amber-50/50 hover:bg-amber-100/70 text-amber-950 border border-amber-200/80"
                        : "hover:bg-indigo-50/50 text-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {staged ? (
                        <span className="text-amber-500 font-extrabold text-[10px] shrink-0" title="미반영 변경사항 존재">
                          ●
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 shrink-0">👤</span>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate flex items-center gap-1">
                          <span>{realName}</span>
                          {staged && (
                            <span className="text-[10px] text-amber-700 bg-amber-100 font-extrabold px-1 rounded">
                              미반영
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-400 font-mono truncate">{email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isNoDept ? (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-extrabold rounded-md shadow-2xs">
                          🚫 해당없음
                        </span>
                      ) : isUnassigned ? (
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

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTeacherEmail(email);
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded text-xs transition-colors"
                        title="세부 편집 모달 열기"
                      >
                        ✏️
                      </button>

                      {selectedDept && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAssignTeacherToDept(email, selectedDept);
                          }}
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

      {/* §8-3 세부 편집 모달 (ManualProfileEditor) */}
      {editingTeacherEmail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 relative">
            <button
              onClick={() => setEditingTeacherEmail(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-bold p-1 z-10"
              title="닫기"
            >
              ✕
            </button>
            <ManualProfileEditor
              initialEmail={editingTeacherEmail}
              initialProfile={getEffectiveProfile(editingTeacherEmail)}
              onSuccess={() => {
                const clean = editingTeacherEmail.toLowerCase();
                // §8-3 모달 저장 성공 시 해당 교사의 스테이징 엔트리 제거 (서버 확정본)
                setStagedProfiles((prev) => {
                  const next = { ...prev };
                  delete next[clean];
                  return next;
                });
                setEditingTeacherEmail(null);
                setToast({
                  type: "success",
                  text: `'${getDisplayName(clean, getEffectiveProfile(clean))}' 교사의 프로필이 저장되었습니다.`,
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
