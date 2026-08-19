"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { DEFAULT_DEPARTMENTS } from "@/lib/org/departments";
import { resolveDisplayName } from "@/lib/org/displayName";
import { sortMembersForDept } from "@/lib/org/sort";
import { loadTeacherProfiles, buildGwsNameMap, getActiveTeacherEmails } from "@/lib/org/roster";

interface IndeterminateCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
  id?: string;
  title?: string;
}

function IndeterminateCheckbox({
  checked,
  indeterminate = false,
  onChange,
  className = "",
  id,
  title,
}: IndeterminateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label
      title={title}
      className={`relative inline-flex items-center justify-center cursor-pointer select-none ${className}`}
    >
      <input
        type="checkbox"
        ref={ref}
        id={id}
        checked={checked}
        onChange={onChange}
        className="sr-only peer"
      />
      <span
        className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-1 ${
          checked
            ? "bg-indigo-600 border-indigo-600 text-white shadow-2xs"
            : indeterminate
            ? "bg-white border-indigo-400 shadow-2xs"
            : "bg-white border-slate-300 hover:border-slate-400"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 fill-none stroke-white stroke-2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {!checked && indeterminate && (
          <span className="w-2 h-0.5 bg-indigo-500 rounded-full" />
        )}
      </span>
    </label>
  );
}

interface HubOrgTreeProps {
  selectedEmails: Set<string>;
  onToggleEmail: (email: string) => void;
  onToggleDept: (deptName: string, memberEmails: string[]) => void;
  onClearSelection: () => void;
  onSelectAll?: (emails: string[]) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onProfilesLoaded?: (profiles: TeacherProfile[]) => void;
}

export default function HubOrgTree({
  selectedEmails,
  onToggleEmail,
  onToggleDept,
  onClearSelection,
  onSelectAll,
  isCollapsed,
  onToggleCollapse,
  onProfilesLoaded,
}: HubOrgTreeProps) {
  const { userData, teacherProfile, schoolSettings } = useAuth();
  const [profiles, setProfiles] = useState<TeacherProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});
  const [popoverTeacher, setPopoverTeacher] = useState<TeacherProfile | null>(null);

  const departmentOrder = schoolSettings?.departments || DEFAULT_DEPARTMENTS;

  // GWS users cache for real names and active teacher filter
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

  const gwsNameMap = useMemo(() => {
    return buildGwsNameMap(gwsUsers);
  }, [gwsUsers]);

  const activeEmails = useMemo(() => {
    return getActiveTeacherEmails(gwsUsers, (schoolSettings as any)?.ouMapping?.teachers);
  }, [gwsUsers, schoolSettings]);

  const getDisplayName = (t: TeacherProfile) => {
    const email = (t.email || "").toLowerCase();
    const gwsName = gwsNameMap.get(email);
    return resolveDisplayName(email, t, gwsName).name;
  };

  // Load teacher profiles using centralized loader (which uses roster_index cache / org_index)
  // 결함 6 수정: 취소 가드 복원 — 언마운트 후 setState 방지 및 [다시 시도] 연타 방어
  const fetchProfiles = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const items = await loadTeacherProfiles();
      if (signal?.cancelled) return;
      setProfiles(items);
      onProfilesLoaded?.(items);
    } catch (err) {
      if (signal?.cancelled) return;
      console.error("조직도 명단 조회 실패:", err);
      setError("명단을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [onProfilesLoaded]);

  useEffect(() => {
    const signal = { cancelled: false };
    fetchProfiles(signal);
    return () => { signal.cancelled = true; };
  }, [fetchProfiles]);

  // Tree data structure
  const structuredTree = useMemo(() => {
    // Filter: only active teachers with at least 1 department (no noDept / empty dept)
    const validProfiles = profiles.filter((p) => {
      const cleanEmail = (p.email || "").toLowerCase();
      if (!cleanEmail) return false;
      if (activeEmails && !activeEmails.has(cleanEmail)) return false;
      if (p.noDept || !p.departments || p.departments.length === 0) return false;
      return true;
    });

    const deptMap: Record<string, TeacherProfile[]> = {};
    departmentOrder.forEach((d) => (deptMap[d] = []));

    validProfiles.forEach((p) => {
      p.departments.forEach((d) => {
        if (!deptMap[d]) {
          deptMap[d] = [];
        }
        deptMap[d].push(p);
      });
    });

    // Registered departments first, followed by any unregistered departments that have members (Directive 8 / Feedback 11)
    const unregDepts = Object.keys(deptMap)
      .filter((d) => !departmentOrder.includes(d) && (deptMap[d] || []).length > 0)
      .sort((a, b) => a.localeCompare(b, "ko"));
    const allDepts = [...departmentOrder, ...unregDepts];

    // 결함 7 수정: members/allDeptMembers 분리 제거 — 검색 필터 잔재 정리
    const result: { deptName: string; members: TeacherProfile[] }[] = [];

    allDepts.forEach((d) => {
      const sorted = sortMembersForDept(d, deptMap[d] || [], {
        getName: (p) => getDisplayName(p),
      });

      if (sorted.length > 0) {
        result.push({ deptName: d, members: sorted });
      }
    });

    return result;
  }, [profiles, departmentOrder, activeEmails, gwsNameMap]);

  // Initial department expansion: expand my own department(s), collapse all if no department
  // 결함 5 수정: structuredTree 기준으로 돌려 미등록 부서도 포함
  useEffect(() => {
    if (structuredTree.length > 0) {
      const myDepts = new Set(teacherProfile?.departments || []);
      const initial: Record<string, boolean> = {};
      structuredTree.forEach(({ deptName }) => {
        initial[deptName] = myDepts.size > 0 ? myDepts.has(deptName) : false;
      });
      setExpandedDepts(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredTree.length, teacherProfile?.departments]);

  // Flat search results (Directive 6 / Feedback 4-1 / spec §2-1-1)
  const flatSearchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const seenEmails = new Set<string>();
    const matched: TeacherProfile[] = [];

    profiles.forEach((p) => {
      const email = (p.email || "").toLowerCase();
      if (!email || seenEmails.has(email)) return;
      if (activeEmails && !activeEmails.has(email)) return;
      if (p.noDept || !p.departments || p.departments.length === 0) return;

      seenEmails.add(email);

      const name = getDisplayName(p).toLowerCase();
      const ext = (p.extension || "").toLowerCase();
      if (name.includes(q) || (ext && ext.includes(q))) {
        matched.push(p);
      }
    });

    matched.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "ko"));
    return matched;
  }, [searchQuery, profiles, activeEmails, gwsNameMap]);

  // All valid deduped active teacher emails (Directive 5 / Feedback 7 / spec §2-1-2)
  const allValidTeacherEmails = useMemo(() => {
    const seen = new Set<string>();
    profiles.forEach((p) => {
      const email = (p.email || "").toLowerCase();
      if (!email) return;
      if (activeEmails && !activeEmails.has(email)) return;
      if (p.noDept || !p.departments || p.departments.length === 0) return;
      seen.add(email);
    });
    return Array.from(seen);
  }, [profiles, activeEmails]);

  const totalValidCount = allValidTeacherEmails.length;
  const isAllSchoolSelected =
    totalValidCount > 0 && allValidTeacherEmails.every((e) => selectedEmails.has(e));

  const handleToggleAllSchool = () => {
    if (isAllSchoolSelected) {
      onClearSelection();
    } else {
      if (onSelectAll) {
        onSelectAll(allValidTeacherEmails);
      } else {
        allValidTeacherEmails.forEach((e) => {
          if (!selectedEmails.has(e)) onToggleEmail(e);
        });
      }
    }
  };

  const toggleDeptExpand = (dept: string) => {
    setExpandedDepts((prev) => ({
      ...prev,
      [dept]: !prev[dept],
    }));
  };

  // If collapsed, show compact bar
  if (isCollapsed) {
    return (
      <div className="w-12 bg-white border-r border-slate-200 flex flex-col items-center py-4 justify-between select-none">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            title="조직도 펼치기"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <span className="text-sm">▶</span>
          </button>
          <span className="[writing-mode:vertical-rl] text-xs font-bold text-slate-600 tracking-wider">
            교직원 조직도
          </span>
        </div>
        {selectedEmails.size > 0 && (
          <div className="flex flex-col items-center gap-1">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shadow-xs">
              {selectedEmails.size}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="w-80 bg-white border-r border-slate-200 flex flex-col h-full flex-shrink-0 select-none relative">
      {/* Header */}
      <div className="p-3 border-b border-slate-200 bg-slate-50/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">👥</span>
            <h2 className="text-sm font-bold text-slate-800">교직원 조직도</h2>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="조직도 접기"
            className="p-1 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer text-xs"
          >
            ◀
          </button>
        </div>

        {/* Search input (Korean name only local filter) */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름으로 검색..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-slate-900 placeholder:text-slate-400"
          />
          <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 text-xs cursor-pointer p-0.5"
            >
              ✕
            </button>
          )}
        </div>

        {/* 효명고 전체 선택 버튼 (Directive 5 / Feedback 7 / spec §2-1-2) */}
        {!searchQuery.trim() && totalValidCount > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-200/80">
            <button
              type="button"
              onClick={handleToggleAllSchool}
              className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-between border ${
                isAllSchoolSelected
                  ? "bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100/80"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70"
              }`}
            >
              <span>{isAllSchoolSelected ? `전체 해제 (${totalValidCount}명)` : `효명고 전체 선택 (${totalValidCount}명)`}</span>
              <span className="text-[10px] text-slate-400">{isAllSchoolSelected ? "✕" : "✓"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Roster Tree or Flat Search Results list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-400 space-y-2">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p>교직원 명단을 불러오는 중입니다...</p>
          </div>
        ) : error ? (
          <div className="py-12 px-4 text-center text-xs space-y-3">
            <p className="text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => fetchProfiles()}
              className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-md hover:bg-indigo-100 font-semibold cursor-pointer transition-colors"
            >
              다시 시도
            </button>
          </div>
        ) : searchQuery.trim() ? (
          /* Flat search results (Directive 6 / Feedback 4-1 / spec §2-1-1) */
          flatSearchResults.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              이름과 일치하는 선생님이 없습니다.
            </div>
          ) : (
            <div className="space-y-1">
              {flatSearchResults.map((teacher) => {
                const email = (teacher.email || "").toLowerCase();
                const isSelected = selectedEmails.has(email);
                const displayName = getDisplayName(teacher);
                const deptsLabel = teacher.departments?.join(", ") || "";

                return (
                  <div
                    key={email}
                    className={`flex items-center justify-between px-2.5 py-2 rounded-lg border border-slate-100 bg-white hover:bg-indigo-50/50 transition-colors ${
                      isSelected ? "bg-indigo-50/70 border-indigo-200" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleEmail(email)}
                        className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => setPopoverTeacher(teacher)}
                        className="flex flex-col flex-1 min-w-0 text-left cursor-pointer group"
                        title="상세 정보 보기"
                      >
                        <span
                          className={`text-xs truncate ${
                            isSelected
                              ? "font-bold text-indigo-900"
                              : "text-slate-800 group-hover:text-indigo-600"
                          }`}
                        >
                          {displayName}
                        </span>
                        {deptsLabel && (
                          <span className="text-[10px] text-slate-400 truncate">
                            {deptsLabel}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : structuredTree.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            표시할 조직 정보가 없습니다.
          </div>
        ) : (
          structuredTree.map(({ deptName, members }) => {
            const isExpanded = !!expandedDepts[deptName];
            const allDeptEmails = members.map((m) => (m.email || "").toLowerCase());
            const selectedCountInDept = allDeptEmails.filter((e) => selectedEmails.has(e)).length;
            const isAllDeptSelected =
              allDeptEmails.length > 0 && selectedCountInDept === allDeptEmails.length;
            const isDeptIndeterminate =
              selectedCountInDept > 0 && selectedCountInDept < allDeptEmails.length;

            return (
              <div key={deptName} className="rounded-lg border border-slate-100 bg-white overflow-hidden">
                {/* Department Header */}
                <div className="flex items-center justify-between px-2.5 py-2 bg-slate-50 hover:bg-slate-100/80 transition-colors">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <IndeterminateCheckbox
                      checked={isAllDeptSelected}
                      indeterminate={isDeptIndeterminate}
                      onChange={() => onToggleDept(deptName, allDeptEmails)}
                      title={`${deptName} 전체 선택`}
                      className="w-3.5 h-3.5"
                    />
                    <button
                      type="button"
                      onClick={() => toggleDeptExpand(deptName)}
                      className="flex-1 flex items-center justify-between text-left cursor-pointer truncate py-0.5"
                    >
                      <span className="text-xs font-bold text-slate-800 truncate">{deptName}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            selectedCountInDept > 0
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {selectedCountInDept > 0
                            ? `${selectedCountInDept}/${members.length}`
                            : members.length}
                        </span>
                        <span className="text-[10px] text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Department Members */}
                {isExpanded && (
                  <div className="divide-y divide-slate-50 px-1 py-0.5">
                    {members.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-slate-400">
                        소속 교직원이 없습니다.
                      </div>
                    ) : (
                      members.map((teacher) => {
                        const email = (teacher.email || "").toLowerCase();
                        const isSelected = selectedEmails.has(email);
                        const displayName = getDisplayName(teacher);
                        const isDeptHead =
                          !!teacher.deptHeadMap?.[deptName] ||
                          (teacher.departments?.length === 1 && !!teacher.isDeptHead);
                        const homeroom =
                          teacher.homeroom?.grade && teacher.homeroom?.class
                            ? `${teacher.homeroom.grade}-${teacher.homeroom.class}`
                            : null;

                        return (
                          <div
                            key={`${deptName}-${email}`}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-indigo-50/50 transition-colors ${
                              isSelected ? "bg-indigo-50/70" : ""
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onToggleEmail(email)}
                                className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <button
                                type="button"
                                onClick={() => setPopoverTeacher(teacher)}
                                className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer group truncate"
                                title="상세 정보 보기"
                              >
                                <span
                                  className={`text-xs truncate ${
                                    isSelected
                                      ? "font-bold text-indigo-900"
                                      : "text-slate-800 group-hover:text-indigo-600"
                                  }`}
                                >
                                  {displayName}
                                </span>
                                {isDeptHead && (
                                  <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-amber-100 text-amber-800 flex-shrink-0">
                                    부서장
                                  </span>
                                )}
                                {homeroom && (
                                  <span className="text-[9px] font-medium px-1 py-0.2 rounded bg-slate-100 text-slate-600 flex-shrink-0">
                                    {homeroom}
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom status bar */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between text-xs">
        <div className="font-semibold text-slate-700">
          담긴 사람: <span className="font-bold text-indigo-600">{selectedEmails.size}명</span>
        </div>
        {selectedEmails.size > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs font-bold text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
          >
            비우기
          </button>
        )}
      </div>

      {/* Teacher Info Popover (§2-2) */}
      {popoverTeacher && (
        <div className="absolute inset-0 z-30 bg-black/20 backdrop-blur-2xs flex items-center justify-center p-3 animate-in fade-in duration-100">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-full max-w-[280px] space-y-3 animate-in zoom-in-95 duration-100">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  {getDisplayName(popoverTeacher)}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {popoverTeacher.position || "교직원"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPopoverTeacher(null)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              {/* 결함 4 수정: 부서 목록에서 해당 부서 옆에만 부서장 표시 */}
              <div>
                <span className="text-slate-400 block mb-0.5">소속 부서</span>
                <div className="space-y-0.5">
                  {(popoverTeacher.departments || []).map((d) => (
                    <div key={d} className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800 text-xs">{d}</span>
                      {!!popoverTeacher.deptHeadMap?.[d] && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800">
                          부서장
                        </span>
                      )}
                    </div>
                  ))}
                  {(!popoverTeacher.departments || popoverTeacher.departments.length === 0) && (
                    <span className="font-semibold text-slate-800 text-xs">-</span>
                  )}
                </div>
              </div>
              {popoverTeacher.homeroom?.grade && popoverTeacher.homeroom?.class && (
                <div className="flex justify-between">
                  <span className="text-slate-400">학급 담임</span>
                  <span className="font-semibold text-slate-800">
                    {popoverTeacher.homeroom.grade}학년 {popoverTeacher.homeroom.class}반
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">내선번호</span>
                <span className="font-semibold text-slate-800">
                  {popoverTeacher.extension ? `내선 ${popoverTeacher.extension}` : "내선 없음"}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {selectedEmails.has((popoverTeacher.email || "").toLowerCase()) ? (
                <button
                  type="button"
                  onClick={() => {
                    onToggleEmail((popoverTeacher.email || "").toLowerCase());
                    setPopoverTeacher(null);
                  }}
                  className="w-full py-1.5 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer border border-rose-200"
                >
                  빼기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onToggleEmail((popoverTeacher.email || "").toLowerCase());
                    setPopoverTeacher(null);
                  }}
                  className="w-full py-1.5 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer shadow-2xs"
                >
                  담기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
