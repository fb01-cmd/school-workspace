"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { DEFAULT_DEPARTMENTS } from "@/lib/org/departments";
import { resolveDisplayName } from "@/lib/org/displayName";
import { sortMembersForDept } from "@/lib/org/sort";
import { loadTeacherProfiles, buildGwsNameMap, getActiveTeacherEmails } from "@/lib/org/roster";


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
    return buildGwsNameMap(gwsUsers);
  }, [gwsUsers]);

  const getDisplayName = (t: TeacherProfile) => {
    const email = (t.email || "").toLowerCase();
    const gwsName = gwsNameMap.get(email);
    return resolveDisplayName(email, t, gwsName).name;
  };

  // 재직자 이메일 집합 (2026-08-07 조직도 잔존 결함 수정) — OrgChartBuilder.teacherUserList와
  // 같은 기준으로 전출·명퇴 계정의 잔존 프로필을 트리에서 숨긴다. 캐시가 없으면 null(필터 생략).
  const activeEmails = useMemo(() => {
    return getActiveTeacherEmails(gwsUsers, (schoolSettings as any)?.ouMapping?.teachers);
  }, [gwsUsers, schoolSettings]);

  // 프로필 캐시 로드 (다이어트 4번: 인메모리 캐시 적용)
  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      const items = await loadTeacherProfiles();
      if (cancelled) return;
      setProfiles(items);
      setLoading(false);
    }

    loadProfiles().catch((err) => {
      console.error("조직도 프로필 조회 실패:", err);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
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
      const sorted = sortMembersForDept(d, deptMap[d] || [], {
        getName: (p) => getDisplayName(p),
      });
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
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-900 w-48 bg-white"
          />
          <button
            onClick={expandAll}
            className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            title="전체 펼치기"
          >
            📂 모두 펼치기
          </button>
          <button
            onClick={collapseAll}
            className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
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
                            {(() => {
                              const gwsName = gwsNameMap.get((teacher.email || "").toLowerCase());
                              const dn = resolveDisplayName(teacher.email, teacher, gwsName);
                              return (
                                <>
                                  {/* 이름은 1급 정보라 접히면 안 된다 — 좁은 폭에서 옆 요소
                                      (이메일·뱃지)에 밀려 "장원 / 재"처럼 글자 단위로 쪼개지던
                                      것을 막는다. 말줄임도 금지(스펙 §4-3). 2026-08-21 실기기 신고. */}
                                  <span className="font-bold text-slate-800 text-sm whitespace-nowrap">
                                    {dn.name}
                                  </span>
                                  {dn.extension && (
                                    <span className="text-xs text-slate-500 font-normal">
                                      {dn.extension}
                                    </span>
                                  )}
                                </>
                              );
                            })()}


                            <span className="text-xs text-slate-400 font-mono truncate max-w-[180px]">
                              {teacher.email}
                            </span>

                            {/* Badges */}
                            <div className="flex items-center gap-1.5 flex-wrap ml-1">
                              {/* Head badge */}
                              {isHead && (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-extrabold rounded-md shadow-2xs whitespace-nowrap">
                                  👑 {isGradeDept ? "부장" : "부서장"}
                                </span>
                              )}

                              {/* Position badge */}
                              {teacher.position && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-semibold rounded-md border border-slate-200 whitespace-nowrap">
                                  {teacher.position}
                                </span>
                              )}

                              {/* Homeroom badge */}
                              {isHomeroomMatch && (
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-extrabold rounded-md whitespace-nowrap">
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
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 text-sm font-semibold flex items-center gap-1 cursor-pointer"
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
