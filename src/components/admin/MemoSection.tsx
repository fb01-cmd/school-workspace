"use client";
// 쪽지 화면 — docs/memo_spec.md §4-1 (데스크톱 관리자 포털)
// 서버부: /api/memo. 읽기는 Firestore 직독(onSnapshot), 쓰기는 API 경유.
// §11-1·§11-2 개편 적용 (2026-08-13): 조직도 우선 2단계 흐름, 확인창 제거.
// §1·§2 즐겨찾기·검색 적용 (2026-08-18): 별 토글, 즐겨찾기 탭, 전량 캐시 검색.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  FieldPath,
  startAfter,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { DEFAULT_DEPARTMENTS } from "@/lib/org/departments";
import { resolveDisplayName } from "@/lib/org/displayName";
import type { MemoDoc } from "@/lib/memo/logic";
import { MEMO_UNTITLED_FALLBACK } from "@/lib/memo/logic";
import type { TeacherProfile } from "@/context/AuthContext";
import type { MemoAttachment } from "@/lib/memo/attachment_logic";
import {
  resizeAndValidateImage,
  uploadAttachment,
  formatAttachmentSize,
  isImageFile,
  MEMO_ATTACHMENT_MAX_COUNT,
} from "@/lib/memo/client_attachments";
import {
  memoMatchesSearch,
  type MemoSearchTarget,
  MEMO_SEARCH_RANGE_DAYS,
  rangeFromDays,
  type MemoSearchRange,
  MEMO_SEARCH_RANGE_LABELS,
  computeSearchRangeBoundary,
  filterMemosByRangeBoundary,
} from "@/lib/memo/search_logic";
import MemoAttachmentGrid from "@/components/common/MemoAttachmentGrid";
import MemoRichBody from "@/components/common/MemoRichBody";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import {
  MEMO_CONTENT_FORMAT_MD1,
  bodyHasMd1Formatting,
  collectMd1AttachmentIds,
} from "@/lib/memo/richtext";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { MEMO_MAX_BODY } from "@/lib/memo/logic";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoItem = MemoDoc & { id: string };

interface StagedAttachment {
  id: string;
  name: string;
  size: number;
  previewUrl?: string;
  status: "resizing" | "uploading" | "done" | "error";
  progressText?: string;
  attachment?: MemoAttachment;
  error?: string;
}

/** 칩의 출처: "person" = 개인 검색·개별 체크, "dept" = 부서 헤더 체크 */
interface RecipientChip {
  type: "user";
  source: "person" | "dept";
  email: string;
  label: string;          // 이름만 (이메일 미포함)
  deptLabel?: string;     // source === "dept" 일 때 부서명 (summary용)
}

type Tab = "inbox" | "sent" | "starred";
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
 * GWS 사용자 배열 → 이메일별 표시 이름 맵.
 * 이름의 원본은 GWS 디렉터리 성·이름이다(memo_spec.md §11-7). 이 맵은 화면이 쥔 state에서
 * 만들어지므로, 캐시가 만료되어도 이름이 아이디로 되돌아가지 않는다.
 */
function buildGwsNameMap(users: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(users)) return map;
  users.forEach((u: any) => {
    const email = (u.primaryEmail || u.email || "").toLowerCase();
    if (!email) return;
    const name =
      u.name?.fullName ||
      (u.name?.familyName ? `${u.name.familyName}${u.name.givenName || ""}` : null);
    if (name && typeof name === "string" && name.trim()) {
      map.set(email, name.trim());
    }
  });
  return map;
}

/**
 * 이름 표기 단일 헬퍼 — 트리·검색·칩·읽음 현황표 전부 이 함수를 쓴다.
 * §11-5 동명이인 부제를 나중에 추가할 때 이 함수만 고치면 된다.
 */
function resolveMemoDisplayName(
  email: string,
  profileMap: Map<string, TeacherProfile>,
  gwsNameMap: Map<string, string>
): string {
  const cleanEmail = email.toLowerCase();
  const p = profileMap.get(cleanEmail);
  return resolveDisplayName(email, p, gwsNameMap.get(cleanEmail)).name;
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

// recipientSummary: 부서 기준 vs 이름 기준 (결함 4 수정)
function buildSummary(chips: RecipientChip[]): string {
  if (chips.length === 0) return "";
  // 부서 헤더 선택이 하나라도 있으면 부서명 기준
  const deptChips = chips.filter((c) => c.source === "dept" && c.deptLabel);
  if (deptChips.length > 0) {
    // 선택된 부서명 (중복 제거)
    const deptNames = [...new Set(deptChips.map((c) => c.deptLabel!))];
    const total = chips.length;
    if (deptNames.length === 1) {
      // 단일 부서 전체 선택: "2학년 10명" ("2학년 외 9명"으로 오독되는 문제 방지)
      return `${deptNames[0]} ${total}명`;
    }
    // 복수 부서: "2학년 외 2개 부서 21명"
    return `${deptNames[0]} 외 ${deptNames.length - 1}개 부서 ${total}명`;
  }
  // 개인만이면 이름 기준
  const first = chips[0].label;
  const rest = chips.length - 1;
  return rest > 0 ? `${first} 외 ${rest}명` : first;
}

// ── 로컬 이름 검색 (§11-2 개정: teacher_profiles 명단만, 이름 매칭, 부서 부제) ───

interface LocalSearchCandidate {
  email: string;
  name: string;
  dept: string;   // 첫 번째 소속 부서 (부제 표시용)
  extension?: string;
}

interface LocalNameSearchProps {
  value: string;
  onChange: (v: string) => void;
  candidates: LocalSearchCandidate[];
  alreadySelected: Set<string>;
  onSelect: (email: string) => void;
  placeholder?: string;
}

function LocalNameSearch({
  value,
  onChange,
  candidates,
  alreadySelected,
  onSelect,
  placeholder = "이름으로 검색…",
}: LocalNameSearchProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 이름 매칭 및 내선 매칭
  const q = value.trim();
  const results = q.length >= 1
    ? candidates.filter(
        (c) =>
          (c.name.includes(q) || (c.extension && c.extension.includes(q))) &&
          !alreadySelected.has(c.email)
      ).slice(0, 10)
    : [];

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (q) setOpen(true); }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-50">
          {results.map((c) => (
            <li key={c.email}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(c.email);
                  onChange("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between gap-2"
              >
                <span className="text-sm font-medium text-slate-800">
                  {c.name}
                  {c.extension && <span className="ml-1.5 text-xs text-slate-400 font-normal">({c.extension})</span>}
                </span>
                {c.dept && (
                  <span className="text-xs text-slate-400 flex-shrink-0">{c.dept}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 부서 기반 체크박스 트리 (§11-2) ─────────────────────────────────────────

interface DeptMember {
  email: string;
  name: string;
  extension?: string;
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
                    <span className="text-sm text-slate-700">
                      {m.name}
                      {m.extension && <span className="ml-1.5 text-xs text-slate-400 font-normal">({m.extension})</span>}
                    </span>

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

// ── 하위 컴포넌트: 별표 버튼 및 목록 행 ───────────────────────────────────────────────

function StarButton({
  isStarred,
  onClick,
}: {
  isStarred: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="p-1 -m-1 rounded-md text-slate-300 hover:text-amber-400 hover:bg-slate-100/80 transition-colors cursor-pointer flex-shrink-0"
      aria-label={isStarred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      title={isStarred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
    >
      <svg
        className={`w-4 h-4 transition-colors ${
          isStarred
            ? "fill-amber-400 text-amber-400"
            : "fill-none text-slate-300 hover:text-amber-400"
        }`}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
        />
      </svg>
    </button>
  );
}

function InboxRow({
  memo,
  myEmail,
  selected,
  onClick,
  onToggleStar,
}: {
  memo: MemoItem;
  myEmail: string;
  selected: boolean;
  onClick: () => void;
  onToggleStar: (memo: MemoItem) => void;
}) {
  const isUnread = !memo.reads?.[myEmail];
  const isStarred = !!memo.starredBy?.[myEmail];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-200/80 hover:bg-indigo-50/60 transition-colors flex items-start gap-2.5 cursor-pointer ${
        selected
          ? "bg-indigo-50/90 border-l-4 border-l-indigo-600 -ml-[1px]"
          : isUnread
          ? "bg-slate-50/50"
          : "bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        <StarButton isStarred={isStarred} onClick={() => onToggleStar(memo)} />
        {/* 안읽음 인디케이터 */}
        <span
          className={`w-2 h-2 rounded-full ${
            isUnread ? "bg-indigo-600 ring-2 ring-indigo-100" : "bg-transparent"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        {/* 발신자 + 시각 (보조 톤) */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-xs truncate ${
              isUnread ? "font-bold text-slate-700" : "text-slate-500 font-medium"
            }`}
          >
            {memo.senderName || memo.senderEmail}
          </span>
          <span className="flex-shrink-0 text-[11px] text-slate-400">
            {formatDate(memo.createdAt)}
          </span>
        </div>
        {/* 제목 (주 톤) */}
        <p
          className={`text-sm truncate mt-1 ${
            isUnread ? "font-bold text-slate-950" : "font-medium text-slate-700"
          }`}
        >
          {memo.title || MEMO_UNTITLED_FALLBACK}
        </p>
      </div>
    </button>
  );
}

function SentRow({
  memo,
  myEmail,
  selected,
  onClick,
  onToggleStar,
}: {
  memo: MemoItem;
  myEmail: string;
  selected: boolean;
  onClick: () => void;
  onToggleStar: (memo: MemoItem) => void;
}) {
  const readCount = Object.keys(memo.reads || {}).length;
  const total = memo.recipientCount || memo.recipientEmails?.length || 0;
  const recalled = memo.recalledCount ?? 0;
  const isStarred = !!memo.starredBy?.[myEmail];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-200/80 hover:bg-indigo-50/60 transition-colors flex items-start gap-2.5 cursor-pointer ${
        selected
          ? "bg-indigo-50/90 border-l-4 border-l-indigo-600 -ml-[1px]"
          : "bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        <StarButton isStarred={isStarred} onClick={() => onToggleStar(memo)} />
        <span className="w-2 h-2 rounded-full bg-transparent" />
      </div>
      <div className="flex-1 min-w-0">
        {/* 받는 분 요약 + 시각 (보조 톤) */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs truncate text-slate-500 font-medium">
            받는 분: {memo.recipientSummary || `${total}명`}
          </span>
          <span className="flex-shrink-0 text-[11px] text-slate-400">
            {formatDate(memo.createdAt)}
          </span>
        </div>
        {/* 쪽지 제목 (주 톤) */}
        <p className="text-sm font-semibold text-slate-800 truncate mt-1">
          {memo.title || MEMO_UNTITLED_FALLBACK}
        </p>
        {/* 읽음 및 회수 상태 뱃지 */}
        <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span
            className={`font-semibold ${
              readCount === total && total > 0
                ? "text-emerald-600"
                : "text-amber-500"
            }`}
          >
            읽음 {readCount}/{total}
          </span>
          {/* §12-2: 회수 이력 뱃지 */}
          {recalled > 0 && (
            <>
              <span>·</span>
              <span className="font-semibold text-rose-500">{recalled}명에게서 회수함</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function StarredRow({
  memo,
  myEmail,
  selected,
  onClick,
  onToggleStar,
}: {
  memo: MemoItem;
  myEmail: string;
  selected: boolean;
  onClick: () => void;
  onToggleStar: (memo: MemoItem) => void;
}) {
  const isSentByMe = (memo.senderEmail || "").toLowerCase() === myEmail.toLowerCase();
  const isUnread = !isSentByMe && !(memo.reads && memo.reads[myEmail]);
  const isStarred = !!memo.starredBy?.[myEmail];
  const readCount = Object.keys(memo.reads || {}).length;
  const total = memo.recipientCount || memo.recipientEmails?.length || 0;
  const recalled = memo.recalledCount ?? 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-200/80 hover:bg-indigo-50/60 transition-colors flex items-start gap-2.5 cursor-pointer ${
        selected
          ? "bg-indigo-50/90 border-l-4 border-l-indigo-600 -ml-[1px]"
          : isUnread
          ? "bg-slate-50/50"
          : "bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
        <StarButton isStarred={isStarred} onClick={() => onToggleStar(memo)} />
        <span
          className={`w-2 h-2 rounded-full ${
            isUnread ? "bg-indigo-600 ring-2 ring-indigo-100" : "bg-transparent"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                isSentByMe
                  ? "bg-slate-100 text-slate-600"
                  : "bg-indigo-50 text-indigo-600 border border-indigo-100"
              }`}
            >
              {isSentByMe ? "보낸 쪽지" : "받은 쪽지"}
            </span>
            <span
              className={`text-xs truncate ${
                isUnread ? "font-bold text-slate-700" : "text-slate-500 font-medium"
              }`}
            >
              {isSentByMe
                ? `받는 분: ${memo.recipientSummary || `${total}명`}`
                : memo.senderName || memo.senderEmail}
            </span>
          </div>
          <span className="flex-shrink-0 text-[11px] text-slate-400">
            {formatDate(memo.createdAt)}
          </span>
        </div>
        <p
          className={`text-sm truncate mt-1 ${
            isUnread ? "font-bold text-slate-950" : "font-medium text-slate-800"
          }`}
        >
          {memo.title || MEMO_UNTITLED_FALLBACK}
        </p>
        {isSentByMe && (
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
            <span
              className={`font-semibold ${
                readCount === total && total > 0
                  ? "text-emerald-600"
                  : "text-amber-500"
              }`}
            >
              읽음 {readCount}/{total}
            </span>
            {recalled > 0 && (
              <>
                <span>·</span>
                <span className="font-semibold text-rose-500">{recalled}명에게서 회수함</span>
              </>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ── 하위 컴포넌트: 상세 패널 ──────────────────────────────────────────────────

type RecallResult =
  | { type: "success"; recalledCount: number; remainingCount: number }
  | { type: "error"; message: string };

function MemoDetailPanel({
  memo,
  tab,
  myEmail,
  profileMap,
  gwsNameMap,
  allMemos,
  onSelectMemo,
  onReply,
  onClose,
  onToggleStar,
}: {
  memo: MemoItem;
  tab: Tab;
  myEmail: string;
  profileMap: Map<string, TeacherProfile>;
  gwsNameMap: Map<string, string>;
  allMemos: MemoItem[];
  onSelectMemo: (memo: MemoItem, targetTab: Tab) => void;
  onReply?: () => void;
  onClose: () => void;
  onToggleStar: (memo: MemoItem) => void;
}) {
  // §12-2 회수 상태
  const [recalling, setRecalling] = useState(false);
  const [showRecallConfirm, setShowRecallConfirm] = useState(false);
  const [recallResult, setRecallResult] = useState<RecallResult | null>(null);

  // §12-1 삭제(내 화면 감추기) 상태
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // memo가 바뀌면(다른 쪽지 선택) 결과 및 확인 상태 초기화
  useEffect(() => {
    setRecallResult(null);
    setShowRecallConfirm(false);
    setShowDeleteConfirm(false);
  }, [memo.id]);

  const handleRecall = async () => {
    setShowRecallConfirm(false);
    setRecalling(true);
    setRecallResult(null);
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recall", memoId: memo.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "회수 요청 실패");
      setRecallResult({
        type: "success",
        recalledCount: data.recalledCount ?? 0,
        remainingCount: data.remainingCount ?? 0,
      });
    } catch (e: any) {
      setRecallResult({ type: "error", message: e.message || "회수 중 오류가 발생했습니다." });
    } finally {
      setRecalling(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hide", memoId: memo.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "쪽지 삭제 실패");
      setShowDeleteConfirm(false);
      onClose();
    } catch (e: any) {
      alert(e.message || "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  // 내가 보낸 쪽지인지 여부 (즐겨찾기 탭 대응)
  const isMine = memo.senderEmail.toLowerCase() === myEmail.toLowerCase();
  const effectiveTab: "inbox" | "sent" = tab === "starred" ? (isMine ? "sent" : "inbox") : tab;
  const isStarred = !!memo.starredBy?.[myEmail];

  const unreadCount = isMine
    ? (memo.recipientEmails || []).filter((e) => !memo.reads?.[e]).length
    : 0;
  const canRecall = isMine && unreadCount > 0 && !recalling;

  // 삭제 자격: 받은쪽지함은 읽은 것만(서버 400 거부 방지), 보낸쪽지함은 내가 보낸 것 (§12-1)
  const canDelete =
    (effectiveTab === "inbox" && !!memo.reads?.[myEmail]) ||
    (effectiveTab === "sent" && isMine);

  // 주고받은 이력 계산 (threadId 로컬 그룹핑 — reply spec §2·§3)
  const currentThreadId = memo.threadId || memo.id;
  const threadMemos = useMemo(() => {
    const map = new Map<string, MemoItem>();
    for (const m of allMemos) {
      if (m.hiddenBy?.[myEmail]) continue;
      const mThreadId = m.threadId || m.id;
      if (mThreadId === currentThreadId) {
        map.set(m.id, m);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  }, [allMemos, currentThreadId, myEmail]);

  return (
    <div className="flex flex-col h-full bg-slate-50/40 relative">
      {/* 1. 제목 및 메타 영역 (상단 헤더 구획) */}
      <div className="bg-white px-6 py-4 border-b border-slate-200 shadow-2xs">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* 메타 정보: 작고 옅게 한 줄로 정리 */}
            <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap mb-1.5">
              {effectiveTab === "inbox" ? (
                <span>
                  보낸 사람: <strong className="text-slate-700 font-semibold">{memo.senderName || memo.senderEmail}</strong>
                </span>
              ) : (
                <span>
                  받는 사람: <strong className="text-slate-700 font-semibold">{memo.recipientSummary || `${memo.recipientCount}명`}</strong>
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-400">{formatFull(memo.createdAt)}</span>
            </div>
            {/* 제목: 선명한 주 톤 */}
            <h3 className="text-lg font-bold text-slate-900 leading-snug tracking-tight">
              {memo.title || MEMO_UNTITLED_FALLBACK}
            </h3>
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {/* 별 토글 버튼 */}
            <button
              type="button"
              onClick={() => onToggleStar(memo)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
              aria-label={isStarred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              title={isStarred ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            >
              <svg
                className={`w-3.5 h-3.5 transition-colors ${
                  isStarred
                    ? "fill-amber-400 text-amber-400"
                    : "fill-none text-slate-400 hover:text-amber-400"
                }`}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
              <span>{isStarred ? "즐겨찾기됨" : "즐겨찾기"}</span>
            </button>

            {/* 받은쪽지함: 답장 버튼 */}
            {effectiveTab === "inbox" && onReply && (
              <button
                type="button"
                onClick={onReply}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer"
                aria-label="답장"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span>답장</span>
              </button>
            )}

            {/* §12-2 회수 버튼 — 내가 보낸 쪽지, 안 읽은 수신자 있을 때만 표시 */}
            {isMine && unreadCount > 0 && (
              <button
                type="button"
                onClick={() => setShowRecallConfirm(true)}
                disabled={!canRecall}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
                aria-label="쪽지 회수"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                {recalling ? "회수 중…" : `회수 (${unreadCount}명)`}
              </button>
            )}

            {/* §12-1 삭제 버튼 (내 화면에서 감추기) */}
            {canDelete && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
                aria-label="쪽지 삭제"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            )}

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              aria-label="닫기"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* §12-1 삭제 확인 팝업/모달 */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-20 bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-5 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-100 text-slate-600 rounded-full flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">쪽지를 삭제하시겠습니까?</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  이 쪽지를 내 쪽지함에서 지울까요? 내 화면에서만 지워지며 상대방 화면과 기록은 남습니다.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 회수 확인 팝업/모달 (개정 ① 반영) */}
      {showRecallConfirm && (
        <div className="absolute inset-0 z-20 bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-5 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 text-rose-600 rounded-full flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">쪽지를 회수하시겠습니까?</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  안 읽은 <strong className="text-rose-600 font-semibold">{unreadCount}명</strong>에게서 회수합니다. 이미 읽은 분 것은 회수되지 않고 휴대전화 알림도 취소되지 않습니다.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowRecallConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleRecall}
                className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer"
              >
                회수
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 본문 및 보조 영역 스크롤 컨테이너 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* §12-2 회수 결과 안내 (개정 ② 반영: 결과 카드 내 주의 문구 동반) */}
        {recallResult && (
          <div
            className={`rounded-xl px-4 py-3 text-sm border ${
              recallResult.type === "success"
                ? "bg-rose-50 border-rose-200 text-rose-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {recallResult.type === "success" ? (
              recallResult.recalledCount === 0 ? (
                <div>
                  <p className="font-semibold">이미 모두 읽어 회수할 쪽지가 없습니다.</p>
                  <p className="mt-1 text-xs opacity-80">이미 읽은 분의 쪽지는 회수되지 않으며 휴대전화 알림은 취소할 수 없습니다.</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold">아직 읽지 않은 {recallResult.recalledCount}명의 쪽지를 회수했습니다.</p>
                  {recallResult.remainingCount > 0 && (
                    <p className="mt-1 text-xs opacity-80">이미 읽은 {recallResult.remainingCount}명의 쪽지는 회수되지 않았습니다.</p>
                  )}
                  <p className="mt-2 text-xs opacity-80 pt-1.5 border-t border-rose-200/60">
                    이미 읽은 분의 쪽지는 회수되지 않으며 휴대전화 알림은 취소할 수 없습니다.
                  </p>
                </div>
              )
            ) : (
              <p>{recallResult.message}</p>
            )}
          </div>
        )}

        {/* §12-2 회수 주의 안내 — 회수 버튼이 보이는 동안 항상 표시 */}
        {isMine && unreadCount > 0 && !recallResult && (
          <p className="text-xs text-slate-400 leading-relaxed px-1">
            이미 읽은 분의 쪽지는 회수되지 않습니다. 휴대전화 알림은 취소할 수 없습니다.
          </p>
        )}

        {/* 본문 카드 구획 */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-6 shadow-2xs space-y-4">
          {memo.contentFormat === "md1" ? (
            <MemoRichBody body={memo.body} memoId={memo.id} />
          ) : (
            // 평문 쪽지도 https 주소는 클릭 가능해야 한다 (피드백 6번 — 쪽지·업무 공용)
            <MemoRichBody
              body={memo.body}
              isPlain
              className="space-y-2 text-[15px] text-slate-800 font-sans leading-relaxed break-words"
            />
          )}

          {/* 링크 */}
          {memo.links && memo.links.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-1.5">
              <span className="text-xs font-semibold text-slate-400 block mb-1">첨부 링크</span>
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

          {/* 첨부 이미지 그리드 — 본문에 참조된 첨부는 중복 표시하지 않는다 (richtext spec §13) */}
          {(() => {
            const inlineIds =
              memo.contentFormat === "md1" ? collectMd1AttachmentIds(memo.body) : [];
            const gridAtts = (memo.attachments || []).filter(
              (a) => !inlineIds.includes(a.driveFileId)
            );
            return gridAtts.length > 0 ? (
              <div className="pt-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-400 block mb-2">첨부 이미지</span>
                <MemoAttachmentGrid attachments={gridAtts} />
              </div>
            ) : null;
          })()}
        </div>

        {/* 3. 주고받은 이력 (확실히 분리된 보조 영역) */}
        {threadMemos.length > 1 && (
          <div className="bg-slate-100/70 border border-slate-200/80 rounded-xl overflow-hidden shadow-2xs">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>주고받은 이력</span>
                <span className="text-[11px] font-normal text-slate-500">({threadMemos.length}건)</span>
              </span>
              <span className="text-[11px] text-slate-400">클릭하여 해당 쪽지 확인</span>
            </div>
            <div className="divide-y divide-slate-200/60 max-h-60 overflow-y-auto bg-white/70">
              {threadMemos.map((item) => {
                const isCurrent = item.id === memo.id;
                const isSentByMe = item.senderEmail.toLowerCase() === myEmail.toLowerCase();
                const senderLabel = isSentByMe
                  ? "나"
                  : (item.senderName || resolveMemoDisplayName(item.senderEmail, profileMap, gwsNameMap));
                const targetTab: Tab = isSentByMe ? "sent" : "inbox";

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (!isCurrent) {
                        onSelectMemo(item, targetTab);
                      }
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between gap-3 transition-colors ${
                      isCurrent
                        ? "bg-indigo-50/90 font-bold text-indigo-950 cursor-default"
                        : "hover:bg-slate-50 text-slate-600 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                          isSentByMe ? "bg-slate-200 text-slate-700" : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {senderLabel}
                      </span>
                      <span className={`truncate flex-1 ${isCurrent ? "font-bold text-indigo-950" : "text-slate-700"}`}>
                        {item.title || "(제목 없음)"}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] bg-indigo-600 text-white font-semibold px-1.5 py-0.5 rounded flex-shrink-0">
                          현재 쪽지
                        </span>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-slate-400 text-[11px]">
                      {formatDate(item.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. 보낸쪽지함: 받는 분별 읽음 표 (보조 영역) */}
        {tab === "sent" && (
          <div className="bg-slate-100/70 border border-slate-200/80 rounded-xl overflow-hidden shadow-2xs">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>읽음 현황</span>
                <span className="text-[11px] font-normal text-slate-500">
                  (총 {memo.recipientEmails?.length || memo.recipientCount || 0}명)
                </span>
              </span>
            </div>
            <div className="divide-y divide-slate-200/60 max-h-60 overflow-y-auto bg-white/70">
              {(memo.recipientEmails || []).map((email) => {
                const readAt = memo.reads?.[email];
                const cleanEmail = email.toLowerCase();
                const p = profileMap.get(cleanEmail);
                const displayName = resolveMemoDisplayName(email, profileMap, gwsNameMap);
                return (
                  <div key={email} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-slate-700 truncate mr-2 inline-flex items-center gap-1.5">
                      <span className="font-medium">{displayName}</span>
                      {p?.extension && (
                        <span className="text-xs text-slate-500 font-normal">
                          ({p.extension})
                        </span>
                      )}
                    </span>

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
  gwsNameMap: Map<string, string>;
  /** 버그2 수정: 조직도 로드 실패 메시지 — 에러/로딩/정상 3상태 구분 */
  profileError: string | null;
  deptOrder: string[];
  replyToMemo?: MemoItem | null;
  onClose: () => void;
  onSent: () => void;
}

function ComposeModal({
  myEmail,
  domain,
  myDepts,
  profileMap,
  gwsNameMap,
  profileError,
  deptOrder,
  replyToMemo,
  onClose,
  onSent,
}: ComposeModalProps) {
  const isReply = !!replyToMemo;
  const [step, setStep] = useState<ComposeStep>(isReply ? 2 : 1);

  // 수신자 선택 (step 1 / reply 모드 시 원 발신자 1인 고정)
  const initialRecipient = useMemo(() => {
    if (!replyToMemo) return { selected: new Set<string>(), chips: [] as RecipientChip[] };
    const email = replyToMemo.senderEmail.toLowerCase();
    const label =
      replyToMemo.senderName ||
      resolveMemoDisplayName(email, profileMap, gwsNameMap);
    return {
      selected: new Set([email]),
      chips: [{ type: "user" as const, source: "person" as const, email, label }],
    };
  }, [replyToMemo, profileMap, gwsNameMap]);

  const [selected, setSelected] = useState<Set<string>>(initialRecipient.selected);
  const [chips, setChips] = useState<RecipientChip[]>(initialRecipient.chips);
  const [searchVal, setSearchVal] = useState("");

  // 작성 (step 2)
  const initialTitle = useMemo(() => {
    if (!replyToMemo) return "";
    const clean = (replyToMemo.title || "").trim() || MEMO_UNTITLED_FALLBACK;
    return /^re:\s*/i.test(clean) ? clean : `RE: ${clean}`;
  }, [replyToMemo]);

  const [title, setTitle] = useState(initialTitle);
  const [bodyMd1, setBodyMd1] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [links, setLinks] = useState<{ url: string; label?: string }[]>([]);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [addSearchVal, setAddSearchVal] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // 편집기 커서/선택 영역 저장 — 외부 버튼 클릭·파일 다이얼로그 후에도 마지막 입력 위치 유지
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  const syncBodyMd1 = useCallback(() => {
    if (editorRef.current) {
      const md1 = serializeDomToMd1(editorRef.current);
      setBodyMd1(md1);
      return md1;
    }
    return "";
  }, []);

  // Range 유효성 검사 — 비동기 업로드 중 본문 편집으로 Range가 DOM에서 떨어졌는지 확인
  const isRangeValid = useCallback((r: Range | null): boolean => {
    if (!r || !editorRef.current) return false;
    try {
      const container = r.commonAncestorContainer;
      if (!container || !container.isConnected || !editorRef.current.contains(container)) {
        return false;
      }
      if (!r.startContainer.isConnected || !r.endContainer.isConnected) {
        return false;
      }
      const maxStart =
        r.startContainer.nodeType === Node.TEXT_NODE
          ? (r.startContainer.textContent?.length ?? 0)
          : r.startContainer.childNodes.length;
      const maxEnd =
        r.endContainer.nodeType === Node.TEXT_NODE
          ? (r.endContainer.textContent?.length ?? 0)
          : r.endContainer.childNodes.length;
      if (r.startOffset > maxStart || r.endOffset > maxEnd) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  // 편집기 커서 위치에 이미지 노드 삽입 (spec §13)
  // serializeDomToMd1이 img의 data-att-id만 본문 참조로 인정하므로 data-att-id를 반드시 세팅한다.
  const insertInlineImage = useCallback(
    (attId: string, previewUrl: string, fileName: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const img = document.createElement("img");
      img.setAttribute("data-att-id", attId);
      img.setAttribute("src", previewUrl);
      img.setAttribute("alt", fileName);
      img.className = "max-w-full h-auto rounded-lg my-2 block";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.display = "block";
      img.style.margin = "0.5rem 0";
      img.style.borderRadius = "0.5rem";

      // 본문 끝 img 뒤에 커서를 둘 수 없는 contenteditable 특성 대응 — 빈 줄(div>br)을 두고 캐럿 이동
      const lineBreakDiv = document.createElement("div");
      lineBreakDiv.appendChild(document.createElement("br"));

      editor.focus();

      const sel = window.getSelection();
      let targetRange: Range | null = null;

      // 1. 현재 selection이 유효한지 확인
      if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (isRangeValid(currentRange)) {
          targetRange = currentRange;
        }
      }

      // 2. 저장해 둔 savedRangeRef 유효성 확인
      if (!targetRange && isRangeValid(savedRangeRef.current)) {
        targetRange = savedRangeRef.current;
      }

      if (targetRange) {
        targetRange.deleteContents();
        // lineBreakDiv를 먼저 넣고 그 앞에 img를 넣어 img -> lineBreakDiv 순서로 배치
        targetRange.insertNode(lineBreakDiv);
        targetRange.insertNode(img);
      } else {
        // 비동기 사이 본문 편집으로 Range가 무효화되었거나 없는 경우 본문 맨 끝에 폴백 삽입
        editor.appendChild(img);
        editor.appendChild(lineBreakDiv);
      }

      // 캐럿을 img 바로 뒤의 빈 줄(lineBreakDiv) 안으로 이동
      const nextRange = document.createRange();
      nextRange.setStart(lineBreakDiv, 0);
      nextRange.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(nextRange);
      savedRangeRef.current = nextRange.cloneRange();

      syncBodyMd1();
    },
    [isRangeValid, syncBodyMd1]
  );

  // 본문에서 참조 중인 첨부 ID 집합 실시간 추적 (spec §13)
  const inlineAttachmentIds = useMemo(() => {
    return new Set(collectMd1AttachmentIds(bodyMd1));
  }, [bodyMd1]);

  // 부서별 구성원 목록 — deptOrder 순서대로, 조직도 정렬 단일 원본 규칙(부장 우선 -> 담임 반 순 -> 가나다)
  const sections: DeptSection[] = deptOrder
    .map((dept) => {
      const members: DeptMember[] = [];
      profileMap.forEach((p, email) => {
        if (p.departments?.includes(dept)) {
          members.push({ email, name: resolveMemoDisplayName(email, profileMap, gwsNameMap), extension: p.extension });
        }
      });
      const gradeMatch = dept.match(/^([1-3])학년/);
      members.sort((a, b) => {
        const profA = profileMap.get(a.email.toLowerCase());
        const profB = profileMap.get(b.email.toLowerCase());
        const aIsHead = !!profA?.deptHeadMap?.[dept] || (profA?.departments?.length === 1 && !!profA?.isDeptHead);
        const bIsHead = !!profB?.deptHeadMap?.[dept] || (profB?.departments?.length === 1 && !!profB?.isDeptHead);
        if (aIsHead && !bIsHead) return -1;
        if (!aIsHead && bIsHead) return 1;
        if (gradeMatch) {
          const gradeNum = Number(gradeMatch[1]);
          const aIsHomeroom = !!profA?.isHomeroom && Number(profA?.homeroom?.grade) === gradeNum;
          const bIsHomeroom = !!profB?.isHomeroom && Number(profB?.homeroom?.grade) === gradeNum;
          if (aIsHomeroom && !bIsHomeroom) return -1;
          if (!aIsHomeroom && bIsHomeroom) return 1;
          if (aIsHomeroom && bIsHomeroom) {
            const aClass = Number(profA?.homeroom?.class || 0);
            const bClass = Number(profB?.homeroom?.class || 0);
            if (aClass !== bClass) return aClass - bClass;
          }
        }
        return a.name.localeCompare(b.name, "ko");
      });
      return { dept, members };
    })
    .filter((s) => s.members.length > 0);

  // 트리 선택 → 칩 동기화
  // 결함 1+2 수정: 칩을 Map<email, RecipientChip>으로 조립해 중복을 원천 차단.
  // 부서 헤더 체크 시 동일 이메일이 여러 부서에서 들어와도 Map이 덮어쓰므로 150개→81개 문제 해소.
  // 전체 선택(결함 2)은 아래 handleSelectAll이 이 함수를 호출해 자동으로 인원수가 맞는다.
  const handleTreeChange = useCallback((next: Set<string>) => {
    setSelected(next);
    // Map<email, RecipientChip> — 이메일 키로 중복 제거
    const chipMap = new Map<string, RecipientChip>();

    // 부서 전체 선택된 것 먼저 — "dept" source로 삽입
    sections.forEach((sec) => {
      const deptEmails = sec.members.map((m) => m.email);
      const allIn = deptEmails.length > 0 && deptEmails.every((e) => next.has(e));
      if (allIn) {
        sec.members.forEach((m) => {
          chipMap.set(m.email, {
            type: "user",
            source: "dept",
            email: m.email,
            label: resolveMemoDisplayName(m.email, profileMap, gwsNameMap),
            deptLabel: sec.dept,
          });
        });
      }
    });

    // 부서 전체가 아닌 개인 선택 — 이미 Map에 있으면 덮어쓰지 않음
    next.forEach((email) => {
      if (chipMap.has(email)) return;
      chipMap.set(email, {
        type: "user",
        source: "person",
        email,
        label: resolveMemoDisplayName(email, profileMap, gwsNameMap),
      });
    });

    setChips([...chipMap.values()]);
  }, [sections, profileMap, gwsNameMap]);

  // 개인 검색 선택 → 칩 추가 (중복 방지)
  const handleUserSelect = useCallback((email: string, name?: string) => {
    const lowerEmail = email.toLowerCase();
    const displayName = resolveMemoDisplayName(lowerEmail, profileMap, gwsNameMap);
    setChips((prev) => {
      if (prev.some((c) => c.email === lowerEmail)) return prev;
      return [...prev, { type: "user", source: "person", email: lowerEmail, label: displayName }];
    });
    setSelected((prev) => new Set([...prev, lowerEmail]));
    setSearchVal("");
  }, [profileMap, gwsNameMap]);

  // step2 검색 추가
  const handleAddUserSelect = useCallback((email: string) => {
    const lowerEmail = email.toLowerCase();
    const displayName = resolveMemoDisplayName(lowerEmail, profileMap, gwsNameMap);
    setChips((prev) => {
      if (prev.some((c) => c.email === lowerEmail)) return prev;
      return [...prev, { type: "user", source: "person", email: lowerEmail, label: displayName }];
    });
    setSelected((prev) => new Set([...prev, lowerEmail]));
    setAddSearchVal("");
  }, [profileMap, gwsNameMap]);

  const removeChip = (email: string) => {
    setChips((prev) => prev.filter((c) => c.email !== email));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(email);
      return next;
    });
  };

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

  // 파일(이미지+일반 파일) 배열을 받아 전처리 & 업로드 큐에 추가하는 공통 함수 (피드백 10번)
  const enqueueFiles = (fileList: File[]) => {
    if (!fileList || fileList.length === 0) return;

    const currentCount = stagedAttachments.length;
    if (currentCount >= MEMO_ATTACHMENT_MAX_COUNT) {
      setError(`파일은 최대 ${MEMO_ATTACHMENT_MAX_COUNT}개까지 첨부할 수 있습니다.`);
      return;
    }

    const availableSlots = MEMO_ATTACHMENT_MAX_COUNT - currentCount;
    if (fileList.length > availableSlots) {
      setError(`파일은 최대 ${MEMO_ATTACHMENT_MAX_COUNT}개까지 첨부할 수 있습니다. (초과분 제외)`);
    }

    const selectedFiles = fileList.slice(0, availableSlots);

    const newItems: StagedAttachment[] = selectedFiles.map((file) => {
      const isImg = isImageFile(file.name, file.type);
      return {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        previewUrl: isImg && typeof window !== "undefined" ? URL.createObjectURL(file) : undefined,
        status: isImg && file.size <= 4 * 1024 * 1024 ? "resizing" : "uploading",
        progressText: isImg && file.size <= 4 * 1024 * 1024 ? "최적화 중…" : "업로드 중…",
      };
    });

    setStagedAttachments((prev) => [...prev, ...newItems]);
    setError("");

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const item = newItems[i];

      (async () => {
        try {
          // 업로드 헬퍼 호출 (4MB 이하 multipart 또는 4MB~10MB 세션 업로드 자동 처리)
          const uploaded = await uploadAttachment(file, (msg) => {
            setStagedAttachments((prev) =>
              prev.map((a) => (a.id === item.id ? { ...a, progressText: msg } : a))
            );
          });

          setStagedAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "done",
                    progressText: undefined,
                    attachment: uploaded,
                    previewUrl: uploaded.thumbnailLink || a.previewUrl,
                  }
                : a
            )
          );

          // 이미지인 경우에만 본문 커서 위치에 이미지 노드 삽입 (피드백 10번: 비이미지 파일은 제외)
          if (isImageFile(file.name, file.type)) {
            const preview = item.previewUrl || uploaded.thumbnailLink || "";
            insertInlineImage(uploaded.driveFileId, preview, file.name);
          }
        } catch (err: any) {
          setStagedAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "error",
                    progressText: undefined,
                    error: err?.message || "업로드 실패",
                  }
                : a
            )
          );
        }
      })();
    }
  };

  // 이미지 파일 선택 핸들러 (리사이즈 + 업로드 파이프라인)
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    e.target.value = ""; // 동일 파일 재선택 허용
    enqueueFiles(fileList);
  };

  // 클립보드 붙여넣기 (Ctrl+V) — 이미지 감지 시 첨부 큐로 연결, 텍스트는 브라우저 기본 동작 유지
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          let fileName = file.name;
          if (!fileName || fileName === "image.png" || fileName === "blob") {
            const ext = file.type.split("/")[1] || "png";
            fileName = `붙여넣은 이미지.${ext}`;
          }
          const namedFile = new File([file], fileName, { type: file.type });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      // 입력창과 Step 2 컨테이너 양쪽에 onPaste가 걸려 있다 — 전파를 끊지 않으면
      // 입력창 붙여넣기가 버블링으로 컨테이너 핸들러를 한 번 더 태워 같은 이미지가 2장 붙는다.
      e.stopPropagation();
      enqueueFiles(imageFiles);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setStagedAttachments((prev) => {
      const target = prev.find((a) => a.id === id);

      // 1. 편집기 DOM에서 해당 이미지를 먼저 제거 (깨진 이미지 깜빡임 방지)
      if (target?.attachment?.driveFileId && editorRef.current) {
        const imgs = editorRef.current.querySelectorAll(
          `img[data-att-id="${target.attachment.driveFileId}"]`
        );
        imgs.forEach((img) => img.remove());
        setTimeout(syncBodyMd1, 0);
      }

      // 2. 편집기 img 제거 후 blob URL 해제
      if (target?.previewUrl && target.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return prev.filter((a) => a.id !== id);
    });
  };

  const handleEditorPaste = (e: React.ClipboardEvent) => {
    // 1. 이미지 클립보드 항목 감지 시 기존 첨부 업로드 파이프라인으로 연결
    const items = e.clipboardData?.items;
    if (items) {
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const namedFile = new File(
              [file],
              file.name && file.name !== "image.png" ? file.name : "붙여넣은 이미지.png",
              { type: file.type }
            );
            imageFiles.push(namedFile);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        enqueueFiles(imageFiles);
        return;
      }
    }

    // 2. 텍스트 붙여넣기는 외부 서식(HTML)을 배제하고 평문만 삽입
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      syncBodyMd1();
      saveSelection();
    }
  };

  // 발송 (확인창 없음 — §11-1, 피드백 29번 실패 차단)
  const handleSend = async () => {
    const isUploading = stagedAttachments.some(
      (a) => a.status === "resizing" || a.status === "uploading"
    );
    if (isUploading) {
      setError("파일을 업로드하고 있습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const failedList = stagedAttachments.filter((a) => a.status === "error");
    if (failedList.length > 0) {
      setError(`올릴 수 없는 첨부 파일 ${failedList.length}개가 있습니다. 해당 파일을 제거한 후 보내주세요.`);
      return;
    }

    const md1 = syncBodyMd1();
    if (!md1.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    if (md1.length > MEMO_MAX_BODY) {
      setError(`내용은 ${MEMO_MAX_BODY.toLocaleString()}자 이내여야 합니다.`);
      return;
    }

    setError(""); setSending(true);
    try {
      const userEmails = chips.map((c) => c.email);
      const driveFileIds = stagedAttachments
        .filter((a) => a.status === "done" && a.attachment)
        .map((a) => a.attachment!.driveFileId);

      const isMd1 = bodyHasMd1Formatting(md1);
      const contentFormat = isMd1 ? MEMO_CONTENT_FORMAT_MD1 : undefined;

      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          replyToMemoId: isReply ? replyToMemo.id : undefined,
          title,
          body: md1,
          contentFormat,
          links: links.length > 0 ? links : undefined,
          attachments: driveFileIds.length > 0 ? driveFileIds : undefined,
          recipientSummary: isReply ? (chips[0]?.label || "") : buildSummary(chips),
          recipients: { users: userEmails, groups: [] },
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

  const isUploading = stagedAttachments.some(
    (a) => a.status === "resizing" || a.status === "uploading"
  );
  const failedAttachmentsCount = stagedAttachments.filter((a) => a.status === "error").length;
  const hasAttachmentError = failedAttachmentsCount > 0;
  const recipientCount = chips.length;
  const canSend =
    recipientCount > 0 &&
    bodyMd1.trim() &&
    !sending &&
    !isUploading &&
    !hasAttachmentError;

  // ── 검색 후보 목록 (teacher_profiles 기반 로컬 필터, 이름 매칭)
  // 결함 5 수정: resolveDisplayName 헬퍼 통일
  const searchCandidates: LocalSearchCandidate[] = [];
  profileMap.forEach((p, email) => {
    if (p.departments && p.departments.length > 0) {
      searchCandidates.push({
        email,
        name: resolveMemoDisplayName(email, profileMap, gwsNameMap),
        dept: p.departments[0] ?? "",
        extension: p.extension,
      });

    }
  });

  // ── 칩 렌더 공통 — 렌더 중 정의 금지(react-compiler error 회피, 결함 낮음 수정)
  // ChipList를 렌더 함수 밖 컴포넌트로 올리기엔 props가 많아, 여기서는 인라인 변수로만 선언
  const chipListNode = (editable = true) => (
    chips.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 mt-3">
        {chips.map((chip) => (
          <span
            key={chip.email}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full"
          >
            <span className="max-w-[120px] truncate">{chip.label}</span>
            {editable && (
              <button
                type="button"
                onClick={() => removeChip(chip.email)}
                className="hover:text-indigo-500 ml-0.5 cursor-pointer"
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
            className="text-xs text-slate-400 hover:text-slate-600 px-1 cursor-pointer"
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
            <h2 className="text-lg font-bold text-slate-900">{isReply ? "답장" : "쪽지 쓰기"}</h2>
            {/* 단계 표시 — 일반 쓰기일 때만 */}
            {!isReply && (
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span className={step === 1 ? "font-bold text-indigo-600" : ""}>① 받는 사람</span>
                <span>›</span>
                <span className={step === 2 ? "font-bold text-indigo-600" : ""}>② 작성</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors cursor-pointer"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Step 1: 받는 사람 고르기 (답장 모드에서는 건너뜀) ── */}
        {!isReply && step === 1 && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 이름 검색 (teacher_profiles 로컬 필터, 이름 매칭, 부서 부제) */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">이름으로 검색</label>
                <LocalNameSearch
                  value={searchVal}
                  onChange={setSearchVal}
                  candidates={searchCandidates}
                  alreadySelected={selected}
                  onSelect={handleUserSelect}
                />
              </div>

              {/* 조직도 트리 — 결함 2 수정: 전체 선택 컨트롤 추가 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold text-slate-700">조직도에서 선택</label>
                  {sections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const allEmails = new Set(sections.flatMap((s) => s.members.map((m) => m.email)));
                        const allSelected = allEmails.size > 0 && [...allEmails].every((e) => selected.has(e));
                        handleTreeChange(allSelected ? new Set() : allEmails);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                    >
                      {(() => {
                        // 버그1 수정: flatMap은 중복 포함 — Set으로 dedupe해 실인원만 카운트
                        const allEmailSet = new Set(sections.flatMap((s) => s.members.map((m) => m.email)));
                        const count = allEmailSet.size;
                        const allSelected = count > 0 && [...allEmailSet].every((e) => selected.has(e));
                        return allSelected
                          ? `전체 해제 (${count}명)`
                          : `교직원 전체 선택 (${count}명)`;
                      })()}
                    </button>
                  )}
                </div>
                <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto p-2">
                  {profileError ? (
                    // 버그2 수정: 로드 실패를 트리 자리에 표시 (기존 영원한 스피너 대신)
                    <p className="text-xs text-rose-500 text-center py-4">{profileError}</p>
                  ) : sections.length === 0 ? (
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

              {/* 선택된 수신자 칩 */}
              {chipListNode()}
            </div>

            {/* 단계 이동 푸터 */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={chips.length === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer"
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
        {(isReply || step === 2) && (
          <>
            <div onPaste={handlePaste} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* 받는 분 요약 + 수정 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold text-slate-700">받는 분 ({chips.length}명)</label>
                  {!isReply && (
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                    >
                      ← 받는 사람 변경
                    </button>
                  )}
                </div>
                {chipListNode(!isReply)}
                {/* 추가 검색 — 일반 쓰기일 때만 */}
                {!isReply && (
                  <div className="mt-2">
                    <LocalNameSearch
                      value={addSearchVal}
                      onChange={setAddSearchVal}
                      candidates={searchCandidates}
                      alreadySelected={selected}
                      onSelect={handleAddUserSelect}
                      placeholder="이름으로 추가…"
                    />
                  </div>
                )}
              </div>

              {/* 제목 */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">제목</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onPaste={handlePaste}
                  maxLength={200}
                  placeholder="제목 (선택)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* 내용 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-slate-700">내용</label>
                  <span className="text-xs text-slate-400">
                    {bodyMd1.length.toLocaleString()} / 10,000자
                  </span>
                </div>

                {/* overflow-hidden 금지 — 이모지 피커 팝오버가 칸 경계에서 잘린다 (2026-08-18 실기기 신고) */}
                <div className="rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                  <MemoEditorToolbar
                    editorRef={editorRef}
                    onContentChange={syncBodyMd1}
                  />

                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => {
                      syncBodyMd1();
                      saveSelection();
                    }}
                    onPaste={handleEditorPaste}
                    onSelect={saveSelection}
                    onMouseUp={saveSelection}
                    onBlur={saveSelection}
                    onKeyDown={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        if (["b", "B", "i", "I", "u", "U"].includes(e.key)) {
                          setTimeout(() => {
                            syncBodyMd1();
                            saveSelection();
                          }, 0);
                        }
                      }
                    }}
                    onKeyUp={() => {
                      syncBodyMd1();
                      saveSelection();
                    }}
                    role="textbox"
                    aria-multiline="true"
                    aria-label="쪽지 내용"
                    data-placeholder="내용을 입력하세요"
                    className="w-full px-3.5 py-2.5 text-[15px] leading-relaxed min-h-[160px] max-h-[300px] overflow-y-auto focus:outline-none bg-white text-slate-800 font-sans rounded-b-lg empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:rounded-r-md [&_blockquote]:my-1.5 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:block"
                  />
                </div>
              </div>

              {/* 파일 첨부 (최대 5개, 피드백 10번, 29번) */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.zip,.txt,.csv"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />

                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <span>파일 첨부</span>
                    <span className="text-xs font-normal text-slate-400">
                      ({stagedAttachments.length}/{MEMO_ATTACHMENT_MAX_COUNT}개, 개당 30MB 이하)
                    </span>
                  </label>
                  {stagedAttachments.length < MEMO_ATTACHMENT_MAX_COUNT && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>파일 추가</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-1.5">
                  이미지나 문서(한글·오피스·PDF·압축 등) 파일을 첨부할 수 있습니다.
                </p>

                {stagedAttachments.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-2">
                    {stagedAttachments.map((item) => {
                      const isImg = isImageFile(item.name);
                      const isInline =
                        item.status === "done" && item.attachment && isImg
                          ? inlineAttachmentIds.has(item.attachment.driveFileId)
                          : false;

                      return (
                        <div
                          key={item.id}
                          className={`relative flex flex-col bg-slate-50 border rounded-xl overflow-hidden text-xs transition-all ${
                            item.status === "error"
                              ? "border-rose-300 bg-rose-50/50"
                              : item.status === "done"
                              ? isInline
                                ? "border-indigo-300 bg-indigo-50/20"
                                : "border-slate-200"
                              : "border-indigo-200 bg-indigo-50/30"
                          }`}
                        >
                          {/* 미리보기 / 파일 아이콘 영역 */}
                          <div className="relative w-full h-24 bg-slate-100 flex items-center justify-center overflow-hidden">
                            {isImg && item.previewUrl ? (
                              <img
                                src={item.previewUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
                                <span className="text-2xl">📄</span>
                                <span className="text-[10px] text-slate-500 font-medium">일반 파일</span>
                              </div>
                            )}

                            {/* 본문에 들어감 뱃지 (썸네일 좌측 상단 — 이미지 전용) */}
                            {isInline && (
                              <div className="absolute top-1.5 left-1.5 bg-indigo-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs backdrop-blur-[1px]">
                                본문에 들어감
                              </div>
                            )}

                            {/* 상태 오버레이 (리사이즈 / 업로드 중) */}
                            {(item.status === "resizing" || item.status === "uploading") && (
                              <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex flex-col items-center justify-center text-white gap-1 p-1">
                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                                <span className="text-[10px] font-bold">{item.progressText || "처리 중…"}</span>
                              </div>
                            )}

                            {/* 삭제 버튼 */}
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(item.id)}
                              className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                              title="삭제"
                              aria-label="첨부 파일 삭제"
                            >
                              ×
                            </button>
                          </div>

                          {/* 파일 정보 및 상태 라벨 */}
                          <div className="p-2 space-y-1">
                            <p className="font-medium text-slate-800 truncate" title={item.name}>
                              {item.name}
                            </p>
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span>{formatAttachmentSize(item.size)}</span>
                              {item.status === "done" && item.attachment && isImg && (
                                isInline ? (
                                  <span className="text-indigo-600 font-semibold">
                                    ✓ 본문에 들어감
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      insertInlineImage(
                                        item.attachment!.driveFileId,
                                        item.previewUrl || item.attachment!.thumbnailLink || "",
                                        item.name
                                      )
                                    }
                                    className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded font-medium transition-colors cursor-pointer"
                                    title="본문 커서 위치에 넣기"
                                  >
                                    + 본문에 넣기
                                  </button>
                                )
                              )}
                            </div>
                            {/* 실패 사유는 잘라내지 않는다 — 사용자가 사유를 보고 조치해야 한다 (2026-08-18 실기기 지적) */}
                            {item.status === "error" && (
                              <p className="text-[10px] text-rose-600 font-semibold leading-snug">
                                ⚠️ {item.error || "업로드에 실패했습니다."}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            {/* 발송 푸터 (확인창 없음 — §11-1, 피드백 29번 사유/버튼 상태 단일화) */}
            <div className="px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  취소
                </button>
                {failedAttachmentsCount > 0 ? (
                  <p className="text-xs text-rose-600 font-semibold">
                    올릴 수 없는 첨부 {failedAttachmentsCount}개가 있습니다. 빼면 보낼 수 있어요.
                  </p>
                ) : isUploading ? (
                  <p className="text-xs text-indigo-600 font-semibold">
                    첨부 파일을 업로드하고 있습니다…
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title={
                  hasAttachmentError
                    ? "올릴 수 없는 첨부 파일을 먼저 제거해 주세요."
                    : isUploading
                    ? "파일 업로드가 완료될 때까지 기다려 주세요."
                    : undefined
                }
                className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {sending
                  ? (isReply ? "답장 보내는 중…" : "보내는 중…")
                  : (isReply ? "답장 보내기" : `${recipientCount}명에게 보내기`)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface MemoSectionProps {
  initialMemoId?: string | null;
}

export default function MemoSection({ initialMemoId }: MemoSectionProps = {}) {
  const { user, userData, teacherProfile, schoolSettings, savingMode } = useAuth();
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
  const [starredMemos, setStarredMemos] = useState<MemoItem[]>([]);
  const [starredLoading, setStarredLoading] = useState(false);
  const [starredError, setStarredError] = useState<string | null>(null);

  // 검색 상태 (§2-4a 범위 드롭다운)
  const [searchQuery, setSearchQuery] = useState("");
  // 기본 선택 범위는 절약 모드 손잡이에서 온다 (평시 3개월, 절약 시 1개월).
  // 사용자가 직접 고른 뒤에는 덮어쓰지 않는다 — 화면이 제멋대로 되돌아가면 안 된다.
  const [searchRange, setSearchRange] = useState<MemoSearchRange>(() =>
    rangeFromDays(savingMode.knobs.memoSearchDefaultDays)
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [allUserMemos, setAllUserMemos] = useState<MemoItem[] | null>(null);

  /**
   * 선택한 쪽지는 id만 들고 있는다. 문서 사본을 state에 담으면 클릭 시점에 얼어붙어,
   * 수신자가 읽어도 열려 있는 "읽음 현황" 표가 갱신되지 않는다(스펙 §8 완료 기준).
   */
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(initialMemoId || null);

  useEffect(() => {
    if (initialMemoId) {
      setTab("inbox");
      setSelectedMemoId(initialMemoId);
      // 대시보드 직행 시 읽음 처리 (서버 멱등)
      fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", memoId: initialMemoId }),
      }).catch(() => {});
    }
  }, [initialMemoId]);

  const [showCompose, setShowCompose] = useState(false);
  const [replyTargetMemo, setReplyTargetMemo] = useState<MemoItem | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 버그2 수정: 조직도 로드 실패를 loadError와 분리 — 구독의 setLoadError(null)에 덮이지 않도록
  const [profileError, setProfileError] = useState<string | null>(null);

  // teacher_profiles 맵 (이름 표시용)
  const [profileMap, setProfileMap] = useState<Map<string, TeacherProfile>>(new Map());
  useEffect(() => {
    loadProfileMap()
      .then((m) => { setProfileMap(m); setProfileError(null); })
      .catch((err) => {
        console.error("[memo] 조직도 로드 실패", err);
        setProfileError("조직도 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      });
  }, []);

  // GWS 이름 — 이름의 원본은 GWS 디렉터리 성·이름이다(memo_spec.md §11-7).
  const [gwsUsers, setGwsUsers] = useState<any[]>([]);
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (Array.isArray(cached)) {
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
      .catch((err) => console.error("[memo] GWS 이름 로드 실패", err));
  }, []);
  const gwsNameMap = useMemo(() => buildGwsNameMap(gwsUsers), [gwsUsers]);

  // 부서 순서: schoolSettings.departments → DEFAULT_DEPARTMENTS
  const deptOrder: string[] = schoolSettings?.departments ?? DEFAULT_DEPARTMENTS;

  // 전체 쪽지 목록 (주고받은 이력 계산용 — reply spec §2·§3, 삭제된 항목 배제)
  const allMemos = useMemo(() => {
    const map = new Map<string, MemoItem>();
    for (const m of [...inboxMemos, ...sentMemos, ...starredMemos, ...(allUserMemos || [])]) {
      if (!m.hiddenBy?.[myEmail]) {
        map.set(m.id, m);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [inboxMemos, sentMemos, starredMemos, allUserMemos, myEmail]);

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
      setInboxMemos(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as MemoDoc) }))
          .filter((m) => !m.hiddenBy?.[myEmail])
      );
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
      setSentMemos(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as MemoDoc) }))
          .filter((m) => !m.hiddenBy?.[myEmail])
      );
      setSentLoading(false);
      setLoadError(null);
    }, (err) => {
      console.error("[memo] 보낸쪽지함 구독 실패", err);
      setSentLoading(false);
      setLoadError("쪽지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  // ── 즐겨찾기함 1회 조회 (§1-3 — orderBy 절대 사용 금지)
  const loadStarredMemos = useCallback(async () => {
    if (!myEmail || !domain || notEligible) return;
    setStarredLoading(true);
    setStarredError(null);
    try {
      const col = collection(db, "memos", domain, "items");
      // 1. 받은 별표: where("recipientEmails", "array-contains", myEmail).where(FieldPath("starredBy", myEmail), "==", true)
      const q1 = query(
        col,
        where("recipientEmails", "array-contains", myEmail),
        where(new FieldPath("starredBy", myEmail), "==", true)
      );
      // 2. 보낸 별표: where("senderEmail", "==", myEmail).where(FieldPath("starredBy", myEmail), "==", true)
      const q2 = query(
        col,
        where("senderEmail", "==", myEmail),
        where(new FieldPath("starredBy", myEmail), "==", true)
      );

      const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
      const map = new Map<string, MemoItem>();

      for (const doc of [...snap1.docs, ...snap2.docs]) {
        const data = doc.data() as MemoDoc;
        if (!data.hiddenBy?.[myEmail]) {
          map.set(doc.id, { id: doc.id, ...data });
        }
      }

      const list = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
      setStarredMemos(list);
    } catch (e: any) {
      console.error("[memo] 즐겨찾기 조회 실패:", e);
      setStarredError("즐겨찾기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setStarredLoading(false);
    }
  }, [myEmail, domain, notEligible]);

  useEffect(() => {
    if (tab === "starred") {
      loadStarredMemos();
    }
  }, [tab, loadStarredMemos]);

  // ── 즐겨찾기 토글 (낙관적 갱신 + 실패 시 롤백)
  const handleToggleStar = useCallback(
    async (targetMemo: MemoItem) => {
      const isStarred = !!targetMemo.starredBy?.[myEmail];
      const nextOn = !isStarred;

      const updateList = (list: MemoItem[]) =>
        list.map((m) => {
          if (m.id !== targetMemo.id) return m;
          const nextStarred = { ...(m.starredBy || {}) };
          if (nextOn) nextStarred[myEmail] = true;
          else delete nextStarred[myEmail];
          return { ...m, starredBy: nextStarred };
        });

      setInboxMemos(updateList);
      setSentMemos(updateList);
      setStarredMemos(updateList);
      setAllUserMemos((prev) => (prev ? updateList(prev) : null));

      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "star", memoId: targetMemo.id, on: nextOn }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "즐겨찾기 변경 실패");

        // clientCache 최신화 (모든 범위 캐시 동기화)
        for (const r of ["3m", "6m", "1y"] as const) {
          const cacheKey = `memos:all_user:${myEmail}:${r}`;
          const cached = getClientCache(cacheKey);
          if (Array.isArray(cached)) {
            setClientCache(cacheKey, updateList(cached));
          }
        }
      } catch (err: any) {
        // 실패 롤백
        const revertList = (list: MemoItem[]) =>
          list.map((m) => (m.id === targetMemo.id ? { ...m, starredBy: targetMemo.starredBy } : m));
        setInboxMemos(revertList);
        setSentMemos(revertList);
        setStarredMemos(revertList);
        setAllUserMemos((prev) => (prev ? revertList(prev) : null));
        alert(err.message || "즐겨찾기 상태를 변경하지 못했습니다.");
      }
    },
    [myEmail, allUserMemos]
  );

  // ── 검색 실행: 전량 조회 및 clientCache (TTL 5분) 범위별 관리 (§2-4a)
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const loadMemosForSearch = async () => {
      const boundaryMs = computeSearchRangeBoundary(searchRange);
      const exactCacheKey = `memos:all_user:${myEmail}:${searchRange}`;

      // 1. 동일 범위 캐시 확인
      const exactCached = getClientCache(exactCacheKey);
      if (Array.isArray(exactCached)) {
        if (!cancelled) {
          setAllUserMemos(exactCached);
          setSearchLoading(false);
        }
        return;
      }

      // 2. 더 넓은 범위 캐시로부터 파생 필터 (넓은 것부터 좁은 순)
      // 일수 기준으로 계산한다 — 범위 종류가 늘어도(1m 추가 등) 손댈 필요가 없다.
      const widerRanges: MemoSearchRange[] = (
        Object.keys(MEMO_SEARCH_RANGE_DAYS) as MemoSearchRange[]
      )
        .filter((r) => MEMO_SEARCH_RANGE_DAYS[r] > MEMO_SEARCH_RANGE_DAYS[searchRange])
        .sort((a, b) => MEMO_SEARCH_RANGE_DAYS[a] - MEMO_SEARCH_RANGE_DAYS[b]);

      for (const wider of widerRanges) {
        const widerKey = `memos:all_user:${myEmail}:${wider}`;
        const widerCached = getClientCache(widerKey);
        if (Array.isArray(widerCached)) {
          const derived = filterMemosByRangeBoundary(widerCached, boundaryMs);
          setClientCache(exactCacheKey, derived);
          if (!cancelled) {
            setAllUserMemos(derived);
            setSearchLoading(false);
          }
          return;
        }
      }

      // 3. 캐시 부재 시 확장/신규 Firestore 쿼리 실행
      setSearchLoading(true);
      try {
        const col = collection(db, "memos", domain, "items");
        const PAGE_SIZE = 300;

        // 1. 받은 쪽지 (createdAt >= boundaryMs)
        const inboxList: MemoItem[] = [];
        let lastInboxDoc: any = null;
        while (true) {
          let q = query(
            col,
            where("recipientEmails", "array-contains", myEmail),
            where("createdAt", ">=", boundaryMs),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE)
          );
          if (lastInboxDoc) {
            q = query(
              col,
              where("recipientEmails", "array-contains", myEmail),
              where("createdAt", ">=", boundaryMs),
              orderBy("createdAt", "desc"),
              startAfter(lastInboxDoc),
              limit(PAGE_SIZE)
            );
          }
          const snap = await getDocs(q);
          if (snap.empty) break;
          for (const doc of snap.docs) {
            inboxList.push({ id: doc.id, ...(doc.data() as MemoDoc) });
          }
          if (snap.docs.length < PAGE_SIZE) break;
          lastInboxDoc = snap.docs[snap.docs.length - 1];
        }

        // 2. 보낸 쪽지 (createdAt >= boundaryMs)
        const sentList: MemoItem[] = [];
        let lastSentDoc: any = null;
        while (true) {
          let q = query(
            col,
            where("senderEmail", "==", myEmail),
            where("createdAt", ">=", boundaryMs),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE)
          );
          if (lastSentDoc) {
            q = query(
              col,
              where("senderEmail", "==", myEmail),
              where("createdAt", ">=", boundaryMs),
              orderBy("createdAt", "desc"),
              startAfter(lastSentDoc),
              limit(PAGE_SIZE)
            );
          }
          const snap = await getDocs(q);
          if (snap.empty) break;
          for (const doc of snap.docs) {
            sentList.push({ id: doc.id, ...(doc.data() as MemoDoc) });
          }
          if (snap.docs.length < PAGE_SIZE) break;
          lastSentDoc = snap.docs[snap.docs.length - 1];
        }

        const map = new Map<string, MemoItem>();
        for (const m of [...inboxList, ...sentList]) {
          map.set(m.id, m);
        }
        const all = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);

        setClientCache(exactCacheKey, all, 5 * 60 * 1000);
        if (!cancelled) {
          setAllUserMemos(all);
        }
      } catch (e) {
        console.error("[memo] 검색용 쪽지 조회 실패:", e);
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    };

    loadMemosForSearch();
    return () => {
      cancelled = true;
    };
  }, [searchQuery, searchRange, myEmail, domain]);

  // ── 현재 탭 및 검색 상태에 따른 목록 산출
  const isSearching = searchQuery.trim().length > 0;

  const currentList = useMemo(() => {
    if (isSearching) {
      const source = allUserMemos || [];
      return source
        .filter((m) => !m.hiddenBy?.[myEmail])
        .filter((m) => {
          if (tab === "inbox") {
            return Array.isArray(m.recipientEmails) && m.recipientEmails.includes(myEmail);
          }
          if (tab === "sent") {
            return m.senderEmail?.toLowerCase() === myEmail;
          }
          if (tab === "starred") {
            return !!m.starredBy?.[myEmail];
          }
          return true;
        })
        .filter((m) => {
          const target: MemoSearchTarget = {
            title: m.title || MEMO_UNTITLED_FALLBACK,
            body: m.body,
            senderName: m.senderName,
            senderDisplayName:
              gwsNameMap.get(m.senderEmail?.toLowerCase()) ||
              profileMap.get(m.senderEmail?.toLowerCase())?.name,
            recipientSummary: m.recipientSummary,
          };
          return memoMatchesSearch(target, searchQuery);
        });
    }

    if (tab === "inbox") return inboxMemos;
    if (tab === "sent") return sentMemos;
    return starredMemos;
  }, [
    isSearching,
    searchQuery,
    allUserMemos,
    tab,
    inboxMemos,
    sentMemos,
    starredMemos,
    myEmail,
    gwsNameMap,
    profileMap,
  ]);

  const selectedMemo =
    currentList.find((m) => m.id === selectedMemoId) ||
    allMemos.find((m) => m.id === selectedMemoId) ||
    null;

  const loading = isSearching
    ? searchLoading
    : tab === "inbox"
    ? inboxLoading
    : tab === "sent"
    ? sentLoading
    : starredLoading;

  const errorMsg = tab === "starred" ? starredError : loadError;

  // ── 쪽지 클릭 → read API 호출
  const handleSelectMemo = useCallback(
    async (memo: MemoItem) => {
      setSelectedMemoId(memo.id);
      if (
        Array.isArray(memo.recipientEmails) &&
        memo.recipientEmails.includes(myEmail) &&
        !memo.reads?.[myEmail]
      ) {
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
    [myEmail]
  );

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
            왼쪽 아래 <strong>「내 정보 관리」</strong>로 소속을 등록하고 담당 선생님의 확인을
            받으면 바로 이용할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setTab("inbox"); setSelectedMemoId(null); }}
            className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
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
            className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              tab === "sent" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            보낸쪽지함
          </button>
          <button
            onClick={() => { setTab("starred"); setSelectedMemoId(null); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              tab === "starred" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <svg
              className={`w-3.5 h-3.5 ${tab === "starred" ? "fill-amber-300 text-amber-300" : "fill-none text-slate-400"}`}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
              />
            </svg>
            즐겨찾기
          </button>
        </div>

        {/* 검색 및 범위 드롭다운 (탭 줄 옆, §2-4a) */}
        <div className="flex items-center gap-1.5 flex-1 max-w-sm min-w-[260px]">
          <select
            value={searchRange}
            onChange={(e) => setSearchRange(e.target.value as MemoSearchRange)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer transition-all flex-shrink-0"
            aria-label="검색 기간 범위"
          >
            {/* 선택지를 직접 나열하지 않는다 — 사전에 범위를 추가해도 화면에 안 나타나
                (절약 모드가 기본을 1개월로 바꿨는데 그 항목이 없어 화면은 3개월이라
                 표시하면서 실제로는 1개월만 찾던 사고, 2026-08-18) */}
            {(Object.keys(MEMO_SEARCH_RANGE_DAYS) as MemoSearchRange[])
              .sort((a, b) => MEMO_SEARCH_RANGE_DAYS[a] - MEMO_SEARCH_RANGE_DAYS[b])
              .map((r) => (
                <option key={r} value={r}>
                  {MEMO_SEARCH_RANGE_LABELS[r]}
                </option>
              ))}
          </select>
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="쪽지 검색 (제목, 내용, 이름)"
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
            />
            <svg
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                aria-label="검색어 지우기"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <button
          onClick={() => {
            setReplyTargetMemo(null);
            setShowCompose(true);
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-semibold rounded-lg transition-colors border border-indigo-200 cursor-pointer flex-shrink-0"
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
          {/* 검색 결과 상단 안내 바 (§2-4a) */}
          {isSearching && !loading && currentList.length > 0 && (
            <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between text-xs text-slate-500 font-medium flex-shrink-0">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                {MEMO_SEARCH_RANGE_LABELS[searchRange]}에서 찾았습니다
              </span>
              <span className="text-[11px] text-slate-400 font-normal">{currentList.length}건</span>
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              <div className="animate-pulse flex items-center gap-2">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                {isSearching ? (
                  <span>{MEMO_SEARCH_RANGE_LABELS[searchRange]} 쪽지에서 찾는 중…</span>
                ) : (
                  <span>불러오는 중…</span>
                )}
              </div>
            </div>
          ) : errorMsg ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2 px-6 text-center">
              <span className="text-2xl">⚠️</span>
              <span className="text-sm">{errorMsg}</span>
            </div>
          ) : currentList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2 px-6 text-center">
              <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {isSearching ? (
                <div className="space-y-1 max-w-xs">
                  <p className="text-sm font-semibold text-slate-600">
                    &apos;{searchQuery}&apos;에 해당하는 쪽지가 없습니다.
                  </p>
                  <p className="text-xs text-slate-500">
                    {searchRange !== "1y" ? "기간을 늘려 다시 찾아보세요" : "다른 검색어로 다시 찾아보세요"}
                  </p>
                  {searchRange !== "1y" && (
                    <div className="flex items-center justify-center gap-1.5 pt-2">
                      {(() => {
                        // 한 단계 넓은 범위 (사전 기준 — 범위가 늘어도 따라온다)
                        const wider = (Object.keys(MEMO_SEARCH_RANGE_DAYS) as MemoSearchRange[])
                          .filter((r) => MEMO_SEARCH_RANGE_DAYS[r] > MEMO_SEARCH_RANGE_DAYS[searchRange])
                          .sort((a, b) => MEMO_SEARCH_RANGE_DAYS[a] - MEMO_SEARCH_RANGE_DAYS[b])[0];
                        if (!wider || wider === "1y") return null;
                        return (
                          <button
                            type="button"
                            onClick={() => setSearchRange(wider)}
                            className="px-2.5 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium rounded-md transition-colors border border-indigo-200 cursor-pointer"
                          >
                            {MEMO_SEARCH_RANGE_LABELS[wider]}로 검색
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => setSearchRange("1y")}
                        className="px-2.5 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium rounded-md transition-colors border border-indigo-200 cursor-pointer"
                      >
                        최근 1년으로 검색
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-sm">
                  {tab === "starred"
                    ? "별표를 눌러 자주 찾는 쪽지를 모아두세요."
                    : tab === "inbox"
                    ? "받은 쪽지가 없습니다."
                    : "보낸 쪽지가 없습니다."}
                </span>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {currentList.map((m) => {
                const isSent = m.senderEmail?.toLowerCase() === myEmail;
                if (tab === "starred" || isSearching) {
                  return (
                    <StarredRow
                      key={m.id}
                      memo={m}
                      myEmail={myEmail}
                      selected={selectedMemo?.id === m.id}
                      onClick={() => handleSelectMemo(m)}
                      onToggleStar={handleToggleStar}
                    />
                  );
                }
                if (tab === "inbox") {
                  return (
                    <InboxRow
                      key={m.id}
                      memo={m}
                      myEmail={myEmail}
                      selected={selectedMemo?.id === m.id}
                      onClick={() => handleSelectMemo(m)}
                      onToggleStar={handleToggleStar}
                    />
                  );
                }
                return (
                  <SentRow
                    key={m.id}
                    memo={m}
                    myEmail={myEmail}
                    selected={selectedMemo?.id === m.id}
                    onClick={() => handleSelectMemo(m)}
                    onToggleStar={handleToggleStar}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* 상세 패널 */}
        {selectedMemo && (
          <div className="flex-1 overflow-hidden">
            <MemoDetailPanel
              memo={selectedMemo}
              tab={tab}
              myEmail={myEmail}
              profileMap={profileMap}
              gwsNameMap={gwsNameMap}
              allMemos={allMemos}
              onSelectMemo={(m, targetTab) => {
                setTab(targetTab);
                handleSelectMemo(m);
              }}
              onReply={
                (tab === "inbox" || (tab === "starred" && selectedMemo.senderEmail.toLowerCase() !== myEmail))
                  ? () => {
                      setReplyTargetMemo(selectedMemo);
                      setShowCompose(true);
                    }
                  : undefined
              }
              onClose={() => setSelectedMemoId(null)}
              onToggleStar={handleToggleStar}
            />
          </div>
        )}
      </div>

      {/* 쪽지 쓰기 / 답장 모달 */}
      {showCompose && (
        <ComposeModal
          myEmail={myEmail}
          domain={domain}
          myDepts={teacherProfile?.departments ?? []}
          profileMap={profileMap}
          gwsNameMap={gwsNameMap}
          profileError={profileError}
          deptOrder={deptOrder}
          replyToMemo={replyTargetMemo}
          onClose={() => {
            setShowCompose(false);
            setReplyTargetMemo(null);
          }}
          onSent={() => {
            setTab("sent");
            setSelectedMemoId(null);
            setReplyTargetMemo(null);
          }}
        />
      )}
    </div>
  );
}
