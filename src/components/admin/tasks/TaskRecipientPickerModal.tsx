"use client";

// 업무 수신자 선택 모달 — 쪽지 수신자 선택 동선(DeptCheckboxTree + LocalNameSearch) 재사용
// phase8_tasks_spec §4, §7

import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { resolveDisplayName } from "@/lib/org/displayName";
import { sortMembersForDept } from "@/lib/org/sort";
import { loadTeacherProfileMap } from "@/lib/org/roster";
import { RecipientChip, previewRecipientLine } from "@/lib/org/recipients";
import type { TeacherProfile } from "@/context/AuthContext";

export type { RecipientChip };

interface DeptMember {
  email: string;
  name: string;
  extension?: string;
}

interface DeptSection {
  dept: string;
  members: DeptMember[];
}

interface LocalSearchCandidate {
  email: string;
  name: string;
  dept: string;
  extension?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSelectedEmails?: string[];
  onConfirm: (result: {
    users: string[];
    groups: string[];
    summary: string;
    chips: RecipientChip[];
  }) => void;
}

export default function TaskRecipientPickerModal({
  isOpen,
  onClose,
  initialSelectedEmails = [],
  onConfirm,
}: Props) {
  const { userData, teacherProfile, schoolSettings } = useAuth();
  const domain = userData?.domain || "hmh.or.kr";
  const myDepts = teacherProfile?.departments || [];

  const [loading, setLoading] = useState(true);
  const [profileMap, setProfileMap] = useState<Map<string, TeacherProfile>>(new Map());
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set(initialSelectedEmails));
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setSelectedEmails(new Set(initialSelectedEmails));
    loadTeacherProfileMap()
      .then((map) => {
        setProfileMap(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen, initialSelectedEmails]);

  // 부서별 목록 구성 (조직도 단일 원본 순서 + sortMembersForDept 정렬)
  const deptSections: DeptSection[] = useMemo(() => {
    const map = new Map<string, DeptMember[]>();
    for (const [email, p] of profileMap.entries()) {
      const name = resolveDisplayName(email, p).name;
      const depts = Array.isArray(p.departments) && p.departments.length > 0 ? p.departments : ["미지정"];
      for (const d of depts) {
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push({
          email,
          name,
          extension: p.extension,
        });
      }
    }

    const deptOrder = schoolSettings?.departments || [];
    const orderedDepts = [
      ...deptOrder.filter((d) => map.has(d)),
      ...Array.from(map.keys()).filter((d) => !deptOrder.includes(d) && d !== "미지정"),
      ...(map.has("미지정") ? ["미지정"] : []),
    ];

    const result: DeptSection[] = [];
    for (const dept of orderedDepts) {
      const members = map.get(dept) || [];
      const sortedMembers = sortMembersForDept(dept, members, profileMap);
      result.push({ dept, members: sortedMembers });
    }
    return result;
  }, [profileMap, schoolSettings?.departments]);

  // 검색 후보
  const searchCandidates: LocalSearchCandidate[] = useMemo(() => {
    const list: LocalSearchCandidate[] = [];
    for (const [email, p] of profileMap.entries()) {
      const name = resolveDisplayName(email, p).name;
      const dept = Array.isArray(p.departments) && p.departments.length > 0 ? p.departments[0] : "";
      list.push({
        email,
        name,
        dept,
        extension: p.extension,
      });
    }
    return list;
  }, [profileMap]);

  // 초기 부서 펼침 (내 소속 부서만 — 피드백 2번)
  useEffect(() => {
    if (deptSections.length > 0 && expandedDepts.size === 0) {
      const initial = new Set(
        deptSections
          .filter((s) => myDepts.includes(s.dept))
          .map((s) => s.dept)
      );
      setExpandedDepts(initial);
    }
  }, [deptSections, myDepts, expandedDepts.size]);

  if (!isOpen) return null;

  const toggleDeptExpand = (dept: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const handleDeptToggle = (section: DeptSection) => {
    const emails = section.members.map((m) => m.email);
    const allSelected = emails.every((e) => selectedEmails.has(e));
    const next = new Set(selectedEmails);
    if (allSelected) {
      emails.forEach((e) => next.delete(e));
    } else {
      emails.forEach((e) => next.add(e));
    }
    setSelectedEmails(next);
  };

  const handlePersonToggle = (email: string) => {
    const next = new Set(selectedEmails);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelectedEmails(next);
  };

  const handleSelectAll = () => {
    const all = new Set<string>();
    for (const s of deptSections) {
      for (const m of s.members) {
        all.add(m.email);
      }
    }
    setSelectedEmails(all);
  };

  const handleClearAll = () => {
    setSelectedEmails(new Set());
  };

  // 선택된 칩 목록 구성
  const selectedChips: RecipientChip[] = Array.from(selectedEmails).map((email) => {
    const p = profileMap.get(email.toLowerCase());
    const name = resolveDisplayName(email, p).name;
    const dept = Array.isArray(p?.departments) && p.departments.length > 0 ? p.departments[0] : undefined;
    return {
      email,
      label: name,
      source: "person",
      deptLabel: dept,
    };
  });

  const summaryText = previewRecipientLine(selectedChips);

  const handleApply = () => {
    onConfirm({
      users: Array.from(selectedEmails),
      groups: [],
      summary: summaryText,
      chips: selectedChips,
    });
    onClose();
  };

  // 검색 결과 (이름만 검색 — 피드백 3번)
  const filteredCandidates = searchQuery.trim()
    ? searchCandidates.filter(
        (c) =>
          (c.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
            c.email.toLowerCase().includes(searchQuery.trim().toLowerCase())) &&
          !selectedEmails.has(c.email)
      ).slice(0, 8)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>👥</span>
              <span>업무 수신자 선택</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              조직도 부서별 또는 이름 검색으로 업무를 전달할 선생님을 선택해 주세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 본문 그리드 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 이름 검색 입력 (피드백 3번 문구) */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="선생님 이름으로 검색…"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 bg-white"
            />
            {filteredCandidates.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                {filteredCandidates.map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => {
                      handlePersonToggle(c.email);
                      setSearchQuery("");
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span className="font-semibold text-slate-800">
                      {c.name}
                      {c.extension && <span className="text-slate-400 font-normal ml-1">({c.extension})</span>}
                    </span>
                    <span className="text-slate-400">{c.dept}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 선택 제어 버튼 */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700">
              선택됨: <span className="text-indigo-600 font-extrabold">{selectedEmails.size}명</span>
              {summaryText && <span className="text-slate-500 font-normal ml-1.5">({summaryText})</span>}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                전체 선택
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                전체 해제
              </button>
            </div>
          </div>

          {/* 부서별 조직도 체크박스 트리 */}
          <div className="border border-slate-200 rounded-xl max-h-72 overflow-y-auto p-3 bg-slate-50/50 space-y-1">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">조직도를 불러오는 중…</div>
            ) : deptSections.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">등록된 교직원이 없습니다.</div>
            ) : (
              deptSections.map((section) => {
                const emails = section.members.map((m) => m.email);
                const checkedCount = emails.filter((e) => selectedEmails.has(e)).length;
                const allChecked = checkedCount === emails.length && emails.length > 0;
                const someChecked = checkedCount > 0 && !allChecked;
                const isOpen = expandedDepts.has(section.dept);

                return (
                  <div key={section.dept} className="rounded-lg bg-white border border-slate-200/80 mb-1 overflow-hidden">
                    <div className="flex items-center gap-2 py-2 px-3 hover:bg-indigo-50/50 transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleDeptExpand(section.dept)}
                        className="w-4 text-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                      >
                        {isOpen ? "▼" : "▶"}
                      </button>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={() => handleDeptToggle(section)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => toggleDeptExpand(section.dept)}
                        className="flex-1 text-left text-xs font-bold text-slate-800 cursor-pointer"
                      >
                        {section.dept}
                      </button>
                      {checkedCount > 0 && (
                        <span className="text-[11px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.2 rounded-full">
                          {checkedCount}/{emails.length}
                        </span>
                      )}
                    </div>

                    {isOpen && (
                      <div className="px-8 pb-2 pt-1 border-t border-slate-100 bg-slate-50/30 grid grid-cols-2 gap-1.5">
                        {section.members.map((m) => (
                          <label
                            key={m.email}
                            className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-white cursor-pointer text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={selectedEmails.has(m.email)}
                              onChange={() => handlePersonToggle(m.email)}
                              className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                            />
                            <span className="text-slate-700">
                              {m.name}
                              {m.extension && (
                                <span className="text-slate-400 text-[11px] ml-1">({m.extension})</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 하단 푸터 */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={selectedEmails.size === 0}
            className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            선택 완료 ({selectedEmails.size}명)
          </button>
        </div>
      </div>
    </div>
  );
}
