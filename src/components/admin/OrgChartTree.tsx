"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, onSnapshot, query } from "firebase/firestore";

import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { DEFAULT_DEPARTMENTS } from "@/lib/org/departments";


interface Props {
  onEditTeacher?: (email: string) => void;
}

export default function OrgChartTree({ onEditTeacher }: Props) {
  const { userData, schoolSettings } = useAuth();
  const [profiles, setProfiles] = useState<TeacherProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});

  const isSuperAdmin = userData?.role === "super_admin";
  const departmentOrder = schoolSettings?.departments || DEFAULT_DEPARTMENTS;

  // GWS 유저 목록 — 캐시 우선, 없으면 직접 로드 (2026-08-07: 트리 뷰를 바로 열면 캐시가
  // 비어 재직자 필터·실명 표시가 통째로 생략되던 구멍 보강. 권한 없으면 조용히 폴백)
  const [gwsUsers, setGwsUsers] = useState<any[]>([]);
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (Array.isArray(cached) && cached.length > 0) {
      setGwsUsers(cached);
      return;
    }
    fetch("/api/workspace/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", orgUnitPaths: ["all"] }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.users)) {
          setClientCache("users:all", data.users);
          setGwsUsers(data.users);
        }
      })
      .catch(() => {});
  }, []);

  // GWS real name resolution map
  const gwsNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const cachedUsers = gwsUsers;
    if (Array.isArray(cachedUsers)) {
      cachedUsers.forEach((u: any) => {
        const email = (u.primaryEmail || u.email || "").toLowerCase();
        if (!email) return;
        const name =
          u.name?.fullName ||
          (u.name?.familyName ? `${u.name.familyName}${u.name.givenName || ""}` : null);
        if (name && typeof name === "string" && name.trim()) {
          map.set(email, name.trim());
        }
      });
    }
    return map;
  }, [gwsUsers]);

  const getDisplayName = (t: TeacherProfile) => {
    const email = (t.email || "").toLowerCase();
    const gwsName = gwsNameMap.get(email);
    if (gwsName) return gwsName;
    return t.name || email.split("@")[0];
  };

  // 재직자 이메일 집합 (2026-08-07 조직도 잔존 결함 수정) — OrgChartBuilder.teacherUserList와
  // 같은 기준으로 전출·명퇴 계정의 잔존 프로필을 트리에서 숨긴다. 캐시가 없으면 null(필터 생략).
  const activeEmails = useMemo(() => {
    const cachedUsers = gwsUsers;
    if (!Array.isArray(cachedUsers) || cachedUsers.length === 0) return null;
    const teacherOU = ((schoolSettings as any)?.ouMapping?.teachers || "").toLowerCase();
    const set = new Set<string>();
    cachedUsers.forEach((u: any) => {
      const email = (u.primaryEmail || u.email || "").toLowerCase();
      if (!email || /^\d{5}@/.test(email)) return;
      const orgPath = (u.orgUnitPath || "").toLowerCase();
      if (teacherOU) {
        if (orgPath !== teacherOU && !orgPath.startsWith(teacherOU + "/")) return;
      } else if (orgPath.includes("student") || orgPath.includes("학생")) {
        return;
      }
      set.add(email);
    });
    return set;
  }, [gwsUsers, schoolSettings]);

  // Real-time subscription to teacher_profiles collection
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
        console.error("조직도 프로필 조회 실패:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Initialize expanded state for departments
  useEffect(() => {
    if (departmentOrder.length > 0) {
      const initial: Record<string, boolean> = {};
      departmentOrder.forEach((d) => {
        initial[d] = true; // Default all expanded
      });
      initial["__NO_DEPT__"] = true;
      setExpandedDepts(initial);
    }
  }, [departmentOrder]);

  const toggleExpand = (dept: string) => {
    setExpandedDepts((prev) => ({
      ...prev,
      [dept]: !prev[dept],
    }));
  };

  const expandAll = () => {
    const updated: Record<string, boolean> = { __NO_DEPT__: true };
    departmentOrder.forEach((d) => (updated[d] = true));
    setExpandedDepts(updated);
  };

  const collapseAll = () => {
    const updated: Record<string, boolean> = { __NO_DEPT__: false };
    departmentOrder.forEach((d) => (updated[d] = false));
    setExpandedDepts(updated);
  };

  // Organize profiles into departments adhering to §1 sorting rules
  const structuredTree = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // Helper to sort department members according to §1 rules
    const sortMembersForDept = (deptName: string, members: TeacherProfile[]): TeacherProfile[] => {
      const gradeMatch = deptName.match(/^([1-3])학년$/);

      if (gradeMatch) {
        const gradeNum = Number(gradeMatch[1]);

        return [...members].sort((a, b) => {
          // Unified head fallback check
          const aIsHead = !!a.deptHeadMap?.[deptName] || (a.departments?.length === 1 && a.isDeptHead);
          const bIsHead = !!b.deptHeadMap?.[deptName] || (b.departments?.length === 1 && b.isDeptHead);

          // 1. Department Head first
          if (aIsHead && !bIsHead) return -1;
          if (!aIsHead && bIsHead) return 1;

          // 2. Homeroom teachers of this grade sorted by class number (1반, 2반, 3반...)
          const aIsHomeroomOfGrade = a.isHomeroom && Number(a.homeroom?.grade) === gradeNum;
          const bIsHomeroomOfGrade = b.isHomeroom && Number(b.homeroom?.grade) === gradeNum;

          if (aIsHomeroomOfGrade && !bIsHomeroomOfGrade) return -1;
          if (!aIsHomeroomOfGrade && bIsHomeroomOfGrade) return 1;

          if (aIsHomeroomOfGrade && bIsHomeroomOfGrade) {
            const aClass = Number(a.homeroom?.class || 0);
            const bClass = Number(b.homeroom?.class || 0);
            if (aClass !== bClass) return aClass - bClass;
          }

          // 3. Remaining non-homeroom members sorted alphabetically by real name
          const aName = getDisplayName(a);
          const bName = getDisplayName(b);
          return aName.localeCompare(bName, "ko");
        });
      } else {
        // Non-grade departments
        return [...members].sort((a, b) => {
          const aIsHead = !!a.deptHeadMap?.[deptName] || (a.departments?.length === 1 && a.isDeptHead);
          const bIsHead = !!b.deptHeadMap?.[deptName] || (b.departments?.length === 1 && b.isDeptHead);

          // 1. Department Head first
          if (aIsHead && !bIsHead) return -1;
          if (!aIsHead && bIsHead) return 1;

          // 2. Korean alphabetical order by real name
          const aName = getDisplayName(a);
          const bName = getDisplayName(b);
          return aName.localeCompare(bName, "ko");
        });
      }
    };

    // Filter profiles by search query if present
    const filteredProfiles = profiles.filter((p) => {
      // 재직자 필터 — 전출·명퇴 잔존 프로필 숨김 (2026-08-07)
      if (activeEmails && !activeEmails.has(p.email.toLowerCase())) return false;
      if (!q) return true;
      const name = getDisplayName(p).toLowerCase();
      const email = p.email.toLowerCase();
      const position = (p.position || "").toLowerCase();
      const depts = (p.departments || []).join(" ").toLowerCase();
      return name.includes(q) || email.includes(q) || position.includes(q) || depts.includes(q);
    });

    // Build department member map
    const deptMap: Record<string, TeacherProfile[]> = {};
    departmentOrder.forEach((d) => (deptMap[d] = []));
    const noDeptList: TeacherProfile[] = [];

    filteredProfiles.forEach((p) => {
      if (p.noDept || !p.departments || p.departments.length === 0) {
        noDeptList.push(p);
      } else {
        p.departments.forEach((d) => {
          if (!deptMap[d]) {
            deptMap[d] = [];
          }
          deptMap[d].push(p);
        });
      }
    });

    // Sort each department
    const sortedTree: { deptName: string; members: TeacherProfile[] }[] = [];
    departmentOrder.forEach((d) => {
      const sorted = sortMembersForDept(d, deptMap[d] || []);
      if (sorted.length > 0 || !q) {
        // Always show departments when no search query, or when search matches
        sortedTree.push({ deptName: d, members: sorted });
      }
    });

    // Sort No Dept members alphabetically
    const sortedNoDept = [...noDeptList].sort((a, b) =>
      (a.name || a.email).localeCompare(b.name || b.email, "ko")
    );

    return {
      departmentsTree: sortedTree,
      noDeptMembers: sortedNoDept,
      totalCount: profiles.length,
    };
  }, [profiles, departmentOrder, searchQuery, activeEmails]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 shadow-sm">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm font-semibold">조직도 트리 데이터를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🌳</span>
            <span>교직원 조직도 트리 뷰</span>
            <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2.5 py-0.5 rounded-full border border-indigo-100">
              총 {structuredTree.totalCount}명
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            §1 정렬 규칙: 부서장 최상단, 학년부는 담임 반 순서(1반~N반) 배치.
          </p>
        </div>

        {/* Search Bar & Expand/Collapse Toggle */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름, 이메일, 부서 검색..."
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-900 w-48 bg-white"
          />
          <button
            onClick={expandAll}
            className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
            title="전체 펼치기"
          >
            📂 모두 펼치기
          </button>
          <button
            onClick={collapseAll}
            className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
            title="전체 접기"
          >
            📁 모두 접기
          </button>
        </div>
      </div>

      {/* Tree View Container */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2 max-h-[75vh] overflow-y-auto">
        {structuredTree.departmentsTree.map(({ deptName, members }) => {
          const isExpanded = expandedDepts[deptName] !== false;
          return (
            <div key={deptName} className="border border-slate-100 rounded-lg overflow-hidden">
              {/* Department Header Node */}
              <div
                onClick={() => toggleExpand(deptName)}
                className="bg-slate-50 hover:bg-indigo-50/50 px-4 py-2.5 flex items-center justify-between cursor-pointer select-none transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-4 text-center">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                  <span className="text-base">{isExpanded ? "📂" : "📁"}</span>
                  <span className="text-sm font-bold text-slate-800">{deptName}</span>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full ml-1">
                    {members.length}명
                  </span>
                </div>
              </div>

              {/* Department Member Leaf Nodes */}
              {isExpanded && (
                <div className="divide-y divide-slate-50 bg-white">
                  {members.length === 0 ? (
                    <p className="text-xs text-slate-300 italic px-10 py-2">등록된 인원이 없습니다.</p>
                  ) : (
                    members.map((teacher) => {
                      const isHead = !!teacher.deptHeadMap?.[deptName] || (teacher.departments?.length === 1 && teacher.isDeptHead);
                      const isGradeDept = /^([1-3])학년$/.test(deptName);
                      const isHomeroomMatch = teacher.isHomeroom && teacher.homeroom;

                      return (
                        <div
                          key={`${deptName}-${teacher.email}`}
                          className="px-10 py-2.5 flex items-center justify-between hover:bg-indigo-50/20 transition-colors group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-slate-400 text-xs">👤</span>
                            <span className="text-sm font-bold text-slate-900">
                              {getDisplayName(teacher)}
                            </span>
                            <span className="text-xs text-slate-400 font-mono truncate max-w-[180px]">
                              {teacher.email}
                            </span>

                            {/* Badges */}
                            <div className="flex items-center gap-1.5 flex-wrap ml-1">
                              {/* Head badge */}
                              {isHead && (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-extrabold rounded-md shadow-2xs">
                                  👑 {isGradeDept ? "부장" : "부서장"}
                                </span>
                              )}

                              {/* Position badge */}
                              {teacher.position && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-semibold rounded-md border border-slate-200">
                                  {teacher.position}
                                </span>
                              )}

                              {/* Homeroom badge */}
                              {isHomeroomMatch && (
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-extrabold rounded-md">
                                  🏫 {teacher.homeroom?.grade}-{teacher.homeroom?.class} 담임
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Super Admin Edit Action */}
                          {isSuperAdmin && onEditTeacher && (
                            <button
                              type="button"
                              onClick={() => onEditTeacher(teacher.email)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 text-xs font-semibold flex items-center gap-1"
                              title="수동 배치 편집"
                            >
                              <span>✏️</span>
                              <span className="hidden sm:inline">수정</span>
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* "소속 없음" 섹션은 트리 뷰에 표시하지 않는다 (2026-08-07 사용자 지시) —
            미배치 인원 관리는 어드민의 조직도 편집(수동 배치) 화면 미배치 목록에서만. */}
      </div>
    </div>
  );
}
