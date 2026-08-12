"use client";
// 쪽지 화면 — docs/memo_spec.md §4-1 (데스크톱 관리자 포털)
// 서버부: /api/memo. 읽기는 Firestore 직독(onSnapshot), 쓰기는 API 경유.
// §11-1·§11-2 개편 적용 (2026-08-13): 조직도 우선 2단계 흐름, 확인창 제거.

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { DEFAULT_DEPARTMENTS } from "@/lib/org/departments";
import type { MemoDoc } from "@/lib/memo/logic";
import type { TeacherProfile } from "@/context/AuthContext";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoItem = MemoDoc & { id: string };

/** 칩의 출처: "person" = 개인 검색·개별 체크, "dept" = 부서 헤더 체크, "group" = 메일링 리스트 */
interface RecipientChip {
  type: "user" | "group";
  source: "person" | "dept" | "group";
  email: string;
  label: string;          // 이름만 (이메일 미포함)
  deptLabel?: string;     // source === "dept" 일 때 부서명 (summary용)
}

type Tab = "inbox" | "sent";
type ComposeStep = 1 | 2;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
}

function formatFull(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 이름 표기 단일 헬퍼 — 트리·검색·칩·읽음 현황표 전부 이 함수를 쓴다.
 * §11-5 동명이인 부제를 나중에 추가할 때 이 함수만 고치면 된다.
 */
function resolveDisplayName(
  email: string,
  profileMap: Map<string, TeacherProfile>
): string {
  const p = profileMap.get(email.toLowerCase());
  if (p?.name) return p.name;
  // 이름이 없으면 이메일 로컬부 폴백 (조직도 밖 계정 안전망)
  return email.split("@")[0] || email;
}

/** teacher_profiles 전수를 clientCache에서 가져오거나 Firestore에서 1회 읽어온다 */
async function loadProfileMap(): Promise<Map<string, TeacherProfile>> {
  const CACHE_KEY = "teacher_profiles:all";
  const cached = getClientCache(CACHE_KEY) as TeacherProfile[] | null;
  let profiles: TeacherProfile[];
  if (cached) {
    profiles = cached;
  } else {
    const snap = await getDocs(collection(db, "teacher_profiles"));
    profiles = snap.docs.map((d) => d.data() as TeacherProfile);
    setClientCache(CACHE_KEY, profiles, 5 * 60 * 1000); // TTL 5분
  }
  const map = new Map<string, TeacherProfile>();
  for (const p of profiles) {
    if (p.email) map.set(p.email.toLowerCase(), p);
  }
  return map;
}

// recipientSummary: 부서 기준 vs 이름 기준
function buildSummary(chips: RecipientChip[]): string {
  if (chips.length === 0) return "";
  // 부서 헤더 선택이 하나라도 있으면 부서명 기준
  const deptChips = chips.filter((c) => c.source === "dept" && c.deptLabel);
  if (deptChips.length > 0) {
    // 부서명 중복 제거
    const deptNames = [...new Set(deptChips.map((c) => c.deptLabel!))];
    const first = deptNames[0];
    const rest = chips.length - 1;
    return rest > 0 ? `${first} 외 ${rest}명` : first;
  }
  // 개인만이면 이름 기준
  const first = chips[0].label;
  const rest = chips.length - 1;
  return rest > 0 ? `${first} 외 ${rest}명` : first;
}

// ── 부서 기반 체크박스 트리 (§11-2) ─────────────────────────────────────────

interface DeptMember {
  email: string;
  name: string;
}

interface DeptSection {
  dept: string;
  members: DeptMember[];
}

interface DeptCheckboxTreeProps {
  sections: DeptSection[];
  /** 선택된 이메일 집합 */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** 내 소속 부서 (초기 펼침 결정) */
  myDepts: string[];
}

function DeptCheckboxTree({ sections, selected, onChange, myDepts }: DeptCheckboxTreeProps) {
  // 초기 펼침: 내 소속 부서 + 구성원이 있는 첫 번째 부서
  const initialExpanded = new Set(
    sections
      .filter((s) => myDepts.includes(s.dept))
      .map((s) => s.dept)
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const toggleExpand = (dept: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const handleDeptToggle = (section: DeptSection) => {
    const emails = section.members.map((m) => m.email);
    const allSelected = emails.every((e) => selected.has(e));
    const next = new Set(selected);
    if (allSelected) {
      emails.forEach((e) => next.delete(e));
    } else {
      emails.forEach((e) => next.add(e));
    }
    onChange(next);
  };

  const handlePersonToggle = (email: string) => {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    onChange(next);
  };

  return (
    <div className="space-y-0.5">
      {sections.map((section) => {
        const emails = section.members.map((m) => m.email);
        const checkedCount = emails.filter((e) => selected.has(e)).length;
        const allChecked = checkedCount === emails.length && emails.length > 0;
        const someChecked = checkedCount > 0 && !allChecked;
        const isOpen = expanded.has(section.dept);

        return (
          <div key={section.dept}>
            {/* 부서 헤더 */}
            <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-indigo-50/60 transition-colors">
              {/* 펼침 토글 */}
              <button
                type="button"
                onClick={() => toggleExpand(section.dept)}
                className="w-4 flex-shrink-0 text-center text-slate-400 hover:text-slate-600"
                aria-label={isOpen ? "접기" : "펼치기"}
              >
                <span className="text-[10px]">{isOpen ? "▼" : "▶"}</span>
              </button>

              {/* 부서 체크박스 */}
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = someChecked; }}
                onChange={() => handleDeptToggle(section)}
                className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 flex-shrink-0 cursor-pointer"
                aria-label={`${section.dept} 전원 선택`}
              />

              {/* 부서명 */}
              <button
                type="button"
                onClick={() => toggleExpand(section.dept)}
                className="flex-1 text-left text-sm font-semibold text-slate-800"
              >
                {section.dept}
              </button>

              {/* 선택 뱃지 */}
              {checkedCount > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                  {checkedCount}/{emails.length}
                </span>
              )}
            </div>

            {/* 구성원 목록 */}
            {isOpen && (
              <div className="ml-8 space-y-0.5">
                {section.members.map((m) => (
                  <label
                    key={m.email}
                    className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.email)}
                      onChange={() => handlePersonToggle(m.email)}
                      className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700">{m.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 하위 컴포넌트: 쪽지 목록 행 ───────────────────────────────────────────────

function InboxRow({
  memo,
  myEmail,
  selected,
  onClick,
}: {
  memo: MemoItem;
  myEmail: string;
  selected: boolean;
  onClick: () => void;
}) {
  const isUnread = !memo.reads?.[myEmail];
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-indigo-50/60 transition-colors flex items-center gap-3 ${
        selected ? "bg-indigo-50" : ""
      }`}
    >
      {/* 안읽음 인디케이터 */}
      <span
        className={`flex-shrink-0 w-2 h-2 rounded-full ${
          isUnread ? "bg-indigo-500" : "bg-transparent"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-sm truncate ${
              isUnread ? "font-bold text-slate-900" : "text-slate-600"
            }`}
          >
            {memo.senderName || memo.senderEmail}
          </span>
          <span className="flex-shrink-0 text-xs text-slate-400">
            {formatDate(memo.createdAt)}
          </span>
        </div>
        <p
          className={`text-sm truncate mt-0.5 ${
            isUnread ? "font-semibold text-slate-800" : "text-slate-500"
          }`}
        >
          {memo.title}
        </p>
      </div>
    </button>
  );
}

function SentRow({
  memo,
  selected,
  onClick,
}: {
  memo: MemoItem;
  selected: boolean;
  onClick: () => void;
}) {
  const readCount = Object.keys(memo.reads || {}).length;
  const total = memo.recipientCount || memo.recipientEmails?.length || 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-indigo-50/60 transition-colors flex items-center gap-3 ${
        selected ? "bg-indigo-50" : ""
      }`}
    >
      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-transparent" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate text-slate-700 font-medium">
            {memo.title}
          </span>
          <span className="flex-shrink-0 text-xs text-slate-400">
            {formatDate(memo.createdAt)}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {memo.recipientSummary || `${total}명`} ·{" "}
          <span
            className={`font-semibold ${
              readCount === total && total > 0
                ? "text-emerald-600"
                : "text-amber-500"
            }`}
          >
            읽음 {readCount}/{total}
          </span>
        </p>
      </div>
    </button>
  );
}

// ── 하위 컴포넌트: 상세 패널 ──────────────────────────────────────────────────

function MemoDetailPanel({
  memo,
  tab,
  profileMap,
  onClose,
}: {
  memo: MemoItem;
  tab: Tab;
  profileMap: Map<string, TeacherProfile>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <h3 className="text-base font-bold text-slate-900 flex-1 mr-3 leading-snug">
          {memo.title}
        </h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 transition-colors p-1 rounded"
          aria-label="닫기"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 메타 */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs text-slate-500 space-y-1">
        {tab === "inbox" ? (
          <div>
            <span className="font-medium text-slate-700">{memo.senderName || memo.senderEmail}</span>
            {" "}님이 보낸 쪽지
          </div>
        ) : (
          <div>
            받는 분: <span className="font-medium text-slate-700">{memo.recipientSummary || `${memo.recipientCount}명`}</span>
          </div>
        )}
        <div>{formatFull(memo.createdAt)}</div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">
          {memo.body}
        </pre>

        {/* 링크 */}
        {memo.links && memo.links.length > 0 && (
          <div className="space-y-1">
            {memo.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {link.label || link.url}
              </a>
            ))}
          </div>
        )}

        {/* 보낸쪽지함: 받는 분별 읽음 표 (실시간 — 데모 핵심) */}
        {tab === "sent" && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                읽음 현황
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {(memo.recipientEmails || []).map((email) => {
                const readAt = memo.reads?.[email];
                const displayName = resolveDisplayName(email, profileMap);
                return (
                  <div key={email} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700 truncate mr-2">{displayName}</span>
                    {readAt ? (
                      <span className="flex-shrink-0 flex items-center gap-1 text-emerald-600 text-xs font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {formatFull(readAt)}
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-xs text-slate-400">안 읽음</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 하위 컴포넌트: 쪽지 쓰기 모달 (2단계 흐름 — §11-1·§11-2) ──────────────

interface ComposeModalProps {
  myEmail: string;
  domain: string;
  myDepts: string[];
  profileMap: Map<string, TeacherProfile>;
  deptOrder: string[];
  onClose: () => void;
  onSent: () => void;
}

function ComposeModal({
  myEmail,
  domain,
  myDepts,
  profileMap,
  deptOrder,
  onClose,
  onSent,
}: ComposeModalProps) {
  const [step, setStep] = useState<ComposeStep>(1);

  // 수신자 선택 (step 1)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chips, setChips] = useState<RecipientChip[]>([]);
  const [searchVal, setSearchVal] = useState("");

  // 그룹 (부차 섹션)
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [allGroups, setAllGroups] = useState<any[]>([]);

  // 작성 (step 2)
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [links, setLinks] = useState<{ url: string; label?: string }[]>([]);
  const [addSearchVal, setAddSearchVal] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // 그룹 목록 (캐시 우선)
  useEffect(() => {
    const cached = getClientCache("groups:all");
    if (cached) { setAllGroups(cached as any[]); return; }
    fetch("/api/workspace/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", domain }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.groups) setAllGroups(d.groups); })
      .catch(() => {});
  }, [domain]);

  // 부서별 구성원 목록 — deptOrder 순서대로, 소속 없는 계정 제외
  const sections: DeptSection[] = deptOrder
    .map((dept) => {
      const members: DeptMember[] = [];
      profileMap.forEach((p, email) => {
        if (p.departments?.includes(dept)) {
          members.push({ email, name: p.name || email.split("@")[0] });
        }
      });
      members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return { dept, members };
    })
    .filter((s) => s.members.length > 0);

  // 트리 선택 → 칩 동기화
  const handleTreeChange = useCallback((next: Set<string>) => {
    setSelected(next);
    // 칩 재구성: 부서 단위 체크와 개별 체크 구분
    const newChips: RecipientChip[] = [];

    // 부서 전체 선택된 것 먼저
    sections.forEach((sec) => {
      const deptEmails = sec.members.map((m) => m.email);
      const allIn = deptEmails.length > 0 && deptEmails.every((e) => next.has(e));
      if (allIn) {
        // 이 부서를 "dept" source 칩 하나로 + 개인 칩들
        sec.members.forEach((m) => {
          newChips.push({
            type: "user",
            source: "dept",
            email: m.email,
            label: m.name,
            deptLabel: sec.dept,
          });
        });
      }
    });

    // 부서 전체가 아닌 개인 선택
    next.forEach((email) => {
      if (newChips.some((c) => c.email === email)) return;
      const profile = profileMap.get(email);
      newChips.push({
        type: "user",
        source: "person",
        email,
        label: profile?.name || email.split("@")[0],
      });
    });

    // 기존 group 칩은 유지
    const existingGroups = chips.filter((c) => c.type === "group");
    setChips([...newChips, ...existingGroups]);
  }, [sections, profileMap, chips]);

  // 개인 검색 선택 → 칩 추가 (중복 방지)
  const handleUserSelect = useCallback((email: string, name?: string) => {
    const lowerEmail = email.toLowerCase();
    const displayName = resolveDisplayName(lowerEmail, profileMap);
    setChips((prev) => {
      if (prev.some((c) => c.email === lowerEmail)) return prev;
      return [...prev, { type: "user", source: "person", email: lowerEmail, label: displayName }];
    });
    setSelected((prev) => new Set([...prev, lowerEmail]));
    setSearchVal("");
  }, [profileMap]);

  // step2 검색 추가
  const handleAddUserSelect = useCallback((email: string) => {
    const lowerEmail = email.toLowerCase();
    const displayName = resolveDisplayName(lowerEmail, profileMap);
    setChips((prev) => {
      if (prev.some((c) => c.email === lowerEmail)) return prev;
      return [...prev, { type: "user", source: "person", email: lowerEmail, label: displayName }];
    });
    setSelected((prev) => new Set([...prev, lowerEmail]));
    setAddSearchVal("");
  }, [profileMap]);

  const removeChip = (email: string) => {
    setChips((prev) => prev.filter((c) => c.email !== email));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(email);
      return next;
    });
  };

  // 그룹 추가
  const addGroupChip = (group: any) => {
    const email = (group.email || "").toLowerCase();
    const label = group.name || email;
    setChips((prev) => {
      if (prev.some((c) => c.email === email)) return prev;
      return [...prev, { type: "group", source: "group", email, label }];
    });
  };

  const filteredGroups = allGroups.filter((g) => {
    const q = groupSearch.toLowerCase();
    return !q || (g.email || "").toLowerCase().includes(q) || (g.name || "").toLowerCase().includes(q);
  });

  // 링크 추가
  const handleAddLink = () => {
    if (!linkUrl.trim().startsWith("https://")) {
      setError("링크는 https://로 시작해야 합니다.");
      return;
    }
    if (links.length >= 5) { setError("링크는 최대 5개입니다."); return; }
    setLinks((prev) => [...prev, { url: linkUrl.trim(), label: linkLabel.trim() || undefined }]);
    setLinkUrl(""); setLinkLabel(""); setError("");
  };

  // 발송 (확인창 없음 — §11-1)
  const handleSend = async () => {
    setError(""); setSending(true);
    try {
      const userEmails = chips.filter((c) => c.type === "user").map((c) => c.email);
      const groupEmails = chips.filter((c) => c.type === "group").map((c) => c.email);
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          title,
          body,
          links,
          recipientSummary: buildSummary(chips),
          recipients: { users: userEmails, groups: groupEmails },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "발송 실패");
      onSent();
      onClose();
    } catch (e: any) {
      setError(e.message || "발송 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  const recipientCount = chips.length;
  const canSend = recipientCount > 0 && title.trim() && body.trim() && !sending;

  // ── 칩 렌더 공통 ──
  const ChipList = ({ editable = true }: { editable?: boolean }) => (
    chips.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 mt-3">
        {chips.map((chip) => (
          <span
            key={chip.email}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full"
          >
            {chip.type === "group" && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            )}
            <span className="max-w-[120px] truncate">{chip.label}</span>
            {editable && (
              <button
                type="button"
                onClick={() => removeChip(chip.email)}
                className="hover:text-indigo-500 ml-0.5"
                aria-label={`${chip.label} 제거`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {editable && chips.length > 1 && (
          <button
            type="button"
            onClick={() => { setChips([]); setSelected(new Set()); }}
            className="text-xs text-slate-400 hover:text-slate-600 px-1"
          >
            전체 지우기
          </button>
        )}
      </div>
    ) : null
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900">쪽지 쓰기</h2>
            {/* 단계 표시 */}
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <span className={step === 1 ? "font-bold text-indigo-600" : ""}>① 받는 사람</span>
              <span>›</span>
              <span className={step === 2 ? "font-bold text-indigo-600" : ""}>② 작성</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Step 1: 받는 사람 고르기 ── */}
        {step === 1 && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 이름 검색 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">이름으로 검색</label>
                <AutocompleteInput
                  value={searchVal}
                  onChange={setSearchVal}
                  type="user"
                  domain={domain}
                  onSelect={handleUserSelect}
                  placeholder="이름으로 검색…"
                />
              </div>

              {/* 조직도 트리 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">조직도에서 선택</label>
                <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto p-2">
                  {sections.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">조직도 정보를 불러오는 중…</p>
                  ) : (
                    <DeptCheckboxTree
                      sections={sections}
                      selected={selected}
                      onChange={handleTreeChange}
                      myDepts={myDepts}
                    />
                  )}
                </div>
              </div>

              {/* 메일링 리스트 (접힌 부차 섹션) */}
              <div>
                <button
                  type="button"
                  onClick={() => setGroupOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
                >
                  <span className="text-[10px]">{groupOpen ? "▼" : "▶"}</span>
                  메일링 리스트로 보내기
                </button>
                {groupOpen && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="그룹 이름 검색…"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="border border-slate-200 rounded-lg max-h-36 overflow-y-auto divide-y divide-slate-100">
                      {filteredGroups.slice(0, 20).map((g) => (
                        <button
                          key={g.email}
                          type="button"
                          onClick={() => addGroupChip(g)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between"
                        >
                          <span className="font-medium text-slate-700">{g.name || g.email}</span>
                        </button>
                      ))}
                      {filteredGroups.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-4">일치하는 그룹 없음</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 선택된 수신자 칩 */}
              <ChipList />
            </div>

            {/* 단계 이동 푸터 */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={chips.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                작성하기
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: 작성 ── */}
        {step === 2 && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* 받는 분 요약 + 수정 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold text-slate-700">받는 분 ({chips.length}명)</label>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    ← 받는 사람 변경
                  </button>
                </div>
                <ChipList />
                {/* 추가 검색 */}
                <div className="mt-2">
                  <AutocompleteInput
                    value={addSearchVal}
                    onChange={setAddSearchVal}
                    type="user"
                    domain={domain}
                    onSelect={handleAddUserSelect}
                    placeholder="이름으로 추가…"
                  />
                </div>
              </div>

              {/* 제목 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">제목</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="제목을 입력하세요"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* 내용 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">내용</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={10000}
                  rows={5}
                  placeholder="내용을 입력하세요"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* 링크 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  링크 첨부 <span className="text-xs font-normal text-slate-400">(최대 5개, https://)</span>
                </label>
                {links.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {links.map((l, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="flex-1 truncate">{l.label || l.url}</span>
                        <button
                          type="button"
                          onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-slate-400 hover:text-red-500"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {links.length < 5 && (
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <input
                      type="text"
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      placeholder="링크 이름 (선택)"
                      className="w-32 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddLink}
                      className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                    >
                      추가
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            {/* 발송 푸터 (확인창 없음 — §11-1) */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {sending ? "보내는 중…" : `${recipientCount}명에게 보내기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function MemoSection() {
  const { user, userData, teacherProfile, schoolSettings } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";
  /**
   * 쪽지 자격 = 교직원 조직도 등록 여부(teacher_profiles/{email}.departments 비지 않음).
   * isApproved는 쓰지 않는다(2026-08-13 실측: 일반 교사 전원 false — §2 정정 참조).
   */
  const notEligible = !!userData && !(teacherProfile?.departments?.length);

  const [tab, setTab] = useState<Tab>("inbox");
  const [inboxMemos, setInboxMemos] = useState<MemoItem[]>([]);
  const [sentMemos, setSentMemos] = useState<MemoItem[]>([]);
  /**
   * 선택한 쪽지는 id만 들고 있는다. 문서 사본을 state에 담으면 클릭 시점에 얼어붙어,
   * 수신자가 읽어도 열려 있는 "읽음 현황" 표가 갱신되지 않는다(스펙 §8 완료 기준).
   */
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // teacher_profiles 맵 (이름 표시용)
  const [profileMap, setProfileMap] = useState<Map<string, TeacherProfile>>(new Map());
  useEffect(() => {
    loadProfileMap().then(setProfileMap).catch(() => {});
  }, []);

  // 부서 순서: schoolSettings.departments → DEFAULT_DEPARTMENTS
  const deptOrder: string[] = schoolSettings?.departments ?? DEFAULT_DEPARTMENTS;

  const selectedMemo =
    (tab === "inbox" ? inboxMemos : sentMemos).find((m) => m.id === selectedMemoId) || null;
  const loading = tab === "inbox" ? inboxLoading : sentLoading;

  // ── 받은쪽지함 구독
  useEffect(() => {
    if (!myEmail || !domain || notEligible) { setInboxLoading(false); return; }
    setInboxLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setInboxMemos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as MemoDoc) })));
      setInboxLoading(false);
      setLoadError(null);
    }, (err) => {
      console.error("[memo] 받은쪽지함 구독 실패", err);
      setInboxLoading(false);
      setLoadError("쪽지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  // ── 보낸쪽지함 구독
  useEffect(() => {
    if (!myEmail || !domain || notEligible) { setSentLoading(false); return; }
    setSentLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("senderEmail", "==", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setSentMemos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as MemoDoc) })));
      setSentLoading(false);
      setLoadError(null);
    }, (err) => {
      console.error("[memo] 보낸쪽지함 구독 실패", err);
      setSentLoading(false);
      setLoadError("쪽지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  // ── 쪽지 클릭 → read API 호출
  const handleSelectMemo = useCallback(
    async (memo: MemoItem) => {
      setSelectedMemoId(memo.id);
      if (tab === "inbox" && !memo.reads?.[myEmail]) {
        try {
          await fetch("/api/memo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "read", memoId: memo.id }),
          });
        } catch {
          // 읽음 기록 실패는 UI를 막지 않는다
        }
      }
    },
    [tab, myEmail]
  );

  const currentList = tab === "inbox" ? inboxMemos : sentMemos;
  const unreadCount = inboxMemos.filter((m) => !m.reads?.[myEmail]).length;

  // 조직도 미등록 계정 안내
  if (notEligible) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <span className="text-4xl">🔒</span>
          <h3 className="text-lg font-bold text-slate-800">아직 쪽지를 사용할 수 없습니다</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            쪽지는 <strong>교직원 조직도에 등록된 분</strong>끼리 주고받습니다. 선생님 계정은 아직
            조직도에 소속 정보가 없습니다.
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            왼쪽 아래 <strong>「정보 수정 신청」</strong>으로 소속을 등록하고 담당 선생님의 확인을
            받으면 바로 이용할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
        <div className="flex gap-1">
          <button
            onClick={() => { setTab("inbox"); setSelectedMemoId(null); }}
            className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "inbox" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            받은쪽지함
            {unreadCount > 0 && (
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                tab === "inbox" ? "bg-white text-indigo-700" : "bg-indigo-500 text-white"
              }`}>
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setTab("sent"); setSelectedMemoId(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "sent" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            보낸쪽지함
          </button>
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-semibold rounded-lg transition-colors border border-indigo-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          쪽지 쓰기
        </button>
      </div>

      {/* 본문: 목록 + 상세 2열 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 목록 패널 */}
        <div className={`flex flex-col border-r border-slate-200 overflow-hidden ${selectedMemo ? "w-80 flex-shrink-0" : "flex-1"}`}>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              <div className="animate-pulse flex items-center gap-2">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                <span>불러오는 중…</span>
              </div>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2 px-6 text-center">
              <span className="text-2xl">⚠️</span>
              <span className="text-sm">{loadError}</span>
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
              <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="text-sm">
                {tab === "inbox" ? "받은 쪽지가 없습니다." : "보낸 쪽지가 없습니다."}
              </span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {tab === "inbox"
                ? inboxMemos.map((m) => (
                    <InboxRow
                      key={m.id}
                      memo={m}
                      myEmail={myEmail}
                      selected={selectedMemo?.id === m.id}
                      onClick={() => handleSelectMemo(m)}
                    />
                  ))
                : sentMemos.map((m) => (
                    <SentRow
                      key={m.id}
                      memo={m}
                      selected={selectedMemo?.id === m.id}
                      onClick={() => handleSelectMemo(m)}
                    />
                  ))}
            </div>
          )}
        </div>

        {/* 상세 패널 */}
        {selectedMemo && (
          <div className="flex-1 overflow-hidden">
            <MemoDetailPanel
              memo={selectedMemo}
              tab={tab}
              profileMap={profileMap}
              onClose={() => setSelectedMemoId(null)}
            />
          </div>
        )}
      </div>

      {/* 쪽지 쓰기 모달 */}
      {showCompose && (
        <ComposeModal
          myEmail={myEmail}
          domain={domain}
          myDepts={teacherProfile?.departments ?? []}
          profileMap={profileMap}
          deptOrder={deptOrder}
          onClose={() => setShowCompose(false)}
          onSent={() => { setTab("sent"); setSelectedMemoId(null); }}
        />
      )}
    </div>
  );
}
