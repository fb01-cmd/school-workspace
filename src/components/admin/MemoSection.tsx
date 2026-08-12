"use client";
// 쪽지 화면 — docs/memo_spec.md §4-1 (데스크톱 관리자 포털)
// 서버부: /api/memo (c5e9be8). 읽기는 Firestore 직독(onSnapshot), 쓰기는 API 경유.

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getClientCache } from "@/lib/cache/clientCache";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import OUCheckboxTree from "@/components/admin/OUCheckboxTree";
import type { MemoDoc } from "@/lib/memo/logic";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoItem = MemoDoc & { id: string };

interface RecipientChip {
  type: "user" | "group";
  email: string;    // 개인이면 이메일, 그룹이면 그룹 이메일
  label: string;    // 표시명
}

type Tab = "inbox" | "sent";

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
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
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

// OU 경로가 prefix에 해당하는지 확인 (하위 경로 포함)
function ouPathMatches(userPath: string, selectedPaths: string[]): boolean {
  const up = (userPath || "").toLowerCase();
  return selectedPaths.some((sp) => {
    const s = sp.toLowerCase();
    return up === s || up.startsWith(s + "/");
  });
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
  onClose,
}: {
  memo: MemoItem;
  tab: Tab;
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

        {/* 보낸쪽지함: 수신자별 읽음 표 (실시간 — 데모 핵심) */}
        {tab === "sent" && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                수신자 읽음 현황
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {(memo.recipientEmails || []).map((email) => {
                const readAt = memo.reads?.[email];
                return (
                  <div key={email} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700 truncate mr-2">{email}</span>
                    {readAt ? (
                      <span className="flex-shrink-0 flex items-center gap-1 text-emerald-600 text-xs font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {formatFull(readAt)}
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-xs text-slate-400">미확인</span>
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

// ── 하위 컴포넌트: 쪽지 쓰기 모달 ───────────────────────────────────────────

interface ComposeModalProps {
  myEmail: string;
  domain: string;
  onClose: () => void;
  onSent: () => void;
}

type RecipientTab = "search" | "orgunit" | "group";

function ComposeModal({ myEmail, domain, onClose, onSent }: ComposeModalProps) {
  const [recipientTab, setRecipientTab] = useState<RecipientTab>("search");
  const [chips, setChips] = useState<RecipientChip[]>([]);

  // 개인 검색
  const [searchVal, setSearchVal] = useState("");

  // 조직도 선택
  const [orgUnits, setOrgUnits] = useState<{ orgUnitId: string; orgUnitPath: string; name: string }[]>([]);
  const [selectedOUs, setSelectedOUs] = useState<string[]>([]);

  // 그룹 선택
  const [groupSearch, setGroupSearch] = useState("");
  const [allGroups, setAllGroups] = useState<any[]>([]);

  // 본문
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [links, setLinks] = useState<{ url: string; label?: string }[]>([]);

  // 상태
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // OU 목록 로드
  useEffect(() => {
    fetch("/api/workspace/ou")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.orgUnits) setOrgUnits(d.orgUnits); })
      .catch(() => {});
  }, []);

  // 그룹 목록 (캐시 우선)
  useEffect(() => {
    const cached = getClientCache("groups:all");
    if (cached) { setAllGroups(cached); return; }
    fetch("/api/workspace/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", domain }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.groups) setAllGroups(d.groups); })
      .catch(() => {});
  }, [domain]);

  // 칩 추가 헬퍼
  const addChip = useCallback((chip: RecipientChip) => {
    setChips((prev) => {
      if (prev.some((c) => c.email === chip.email)) return prev;
      return [...prev, chip];
    });
  }, []);

  // 개인 검색 → onSelect
  const handleUserSelect = useCallback((email: string, name?: string) => {
    addChip({ type: "user", email, label: name ? `${name} (${email})` : email });
    setSearchVal("");
  }, [addChip]);

  // OU 체크박스 → 확인 버튼으로 적용
  const applyOUSelection = useCallback(() => {
    if (selectedOUs.length === 0) return;
    const cachedUsers: any[] = getClientCache("users:all") || [];
    const matched = cachedUsers.filter((u) =>
      ouPathMatches(u.orgUnitPath || "", selectedOUs)
    );
    matched.forEach((u) => {
      const email = (u.primaryEmail || "").toLowerCase();
      const fn = u.name?.familyName || "";
      const gn = u.name?.givenName || "";
      const name = fn && gn ? `${fn}${gn}` : gn || email;
      if (email) addChip({ type: "user", email, label: `${name} (${email})` });
    });
    // 선택한 OU 이름을 칩으로 표시하는 방식 대신 개인 이메일로 펼쳐 넣는다 (spec §4-1)
  }, [selectedOUs, addChip]);

  // 그룹 추가
  const addGroupChip = useCallback((group: any) => {
    const email = (group.email || "").toLowerCase();
    const label = group.name ? `${group.name} (${email})` : email;
    addChip({ type: "group", email, label });
  }, [addChip]);

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

  // recipientSummary 생성
  const buildSummary = (): string => {
    if (chips.length === 0) return "";
    const first = chips[0].label.split(" (")[0];
    return chips.length === 1 ? first : `${first} 외 ${chips.length - 1}명`;
  };

  // 발송
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
          recipientSummary: buildSummary(),
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
      setSending(false); setConfirming(false);
    }
  };

  const filteredGroups = allGroups.filter((g) => {
    const q = groupSearch.toLowerCase();
    return !q || (g.email || "").toLowerCase().includes(q) || (g.name || "").toLowerCase().includes(q);
  });

  const recipientTabBtn = (key: RecipientTab, label: string) => (
    <button
      onClick={() => setRecipientTab(key)}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
        recipientTab === key
          ? "bg-indigo-600 text-white"
          : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">쪽지 쓰기</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 수신자 선택 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">받는 분</label>
            {/* 수신자 탭 */}
            <div className="flex gap-1 mb-3 bg-slate-100 p-1 rounded-lg w-fit">
              {recipientTabBtn("search", "이름 검색")}
              {recipientTabBtn("orgunit", "부서별 선택")}
              {recipientTabBtn("group", "그룹 선택")}
            </div>

            {/* 개인 검색 */}
            {recipientTab === "search" && (
              <AutocompleteInput
                value={searchVal}
                onChange={setSearchVal}
                type="user"
                domain={domain}
                onSelect={handleUserSelect}
                placeholder="이름 또는 이메일로 검색…"
              />
            )}

            {/* 조직도 */}
            {recipientTab === "orgunit" && (
              <div className="space-y-3">
                <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto p-2">
                  {orgUnits.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">조직 정보를 불러오는 중…</p>
                  ) : (
                    <OUCheckboxTree
                      orgUnits={orgUnits}
                      selected={selectedOUs}
                      onChange={setSelectedOUs}
                    />
                  )}
                </div>
                <button
                  onClick={applyOUSelection}
                  disabled={selectedOUs.length === 0}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  선택한 부서 구성원 추가
                </button>
              </div>
            )}

            {/* 그룹 */}
            {recipientTab === "group" && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="그룹 이름 검색…"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-slate-100">
                  {filteredGroups.slice(0, 20).map((g) => (
                    <button
                      key={g.email}
                      onClick={() => addGroupChip(g)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-700">{g.name || g.email}</span>
                      <span className="text-xs text-slate-400">{g.email}</span>
                    </button>
                  ))}
                  {filteredGroups.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">일치하는 그룹 없음</p>
                  )}
                </div>
              </div>
            )}

            {/* 선택된 수신자 칩 */}
            {chips.length > 0 && (
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
                    <span className="max-w-[200px] truncate">{chip.label}</span>
                    <button
                      onClick={() => setChips((prev) => prev.filter((c) => c.email !== chip.email))}
                      className="hover:text-indigo-500 ml-0.5"
                      aria-label="제거"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setChips([])}
                  className="text-xs text-slate-400 hover:text-slate-600 px-1"
                >
                  전체 지우기
                </button>
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

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
            취소
          </button>
          <button
            onClick={() => {
              setError("");
              if (chips.length === 0) { setError("받는 분을 선택하세요."); return; }
              if (!title.trim()) { setError("제목을 입력하세요."); return; }
              if (!body.trim()) { setError("내용을 입력하세요."); return; }
              setConfirming(true);
            }}
            className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            보내기
          </button>
        </div>

        {/* 확인 다이얼로그 */}
        {confirming && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center rounded-2xl">
            <div className="text-center space-y-4 px-8">
              <p className="text-slate-800 font-semibold">
                {chips.length}명에게 쪽지를 보냅니다.
              </p>
              <p className="text-xs text-slate-500">
                그룹을 고르면 실제로 받는 인원은 이보다 많습니다. 확정 인원은 보낸쪽지함에서 확인할 수 있습니다.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setConfirming(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  다시 확인
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {sending ? "보내는 중…" : "확인, 발송"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function MemoSection() {
  const { user, userData } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";

  const [tab, setTab] = useState<Tab>("inbox");
  const [inboxMemos, setInboxMemos] = useState<MemoItem[]>([]);
  const [sentMemos, setSentMemos] = useState<MemoItem[]>([]);
  /**
   * 선택한 쪽지는 **id만** 들고 있는다. 문서 사본을 state에 담으면 클릭 시점에 얼어붙어,
   * 수신자가 읽어도 열려 있는 "수신자 읽음 현황" 표가 갱신되지 않는다 — 스펙 §8의 완료
   * 기준("A의 보낸쪽지함에 B 읽음이 실시간 표시")이 바로 이 화면이므로 반드시 파생값이어야 한다.
   */
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  // 받은/보낸쪽지함은 각자 구독이므로 로딩도 분리한다 — 하나로 합치면 한쪽 구독의 결과가
  // 다른 쪽 목록을 "쪽지 없음"으로 먼저 그려버린다.
  const [inboxLoading, setInboxLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 선택 쪽지 — 항상 살아 있는 목록에서 id로 파생한다(사본 금지, 위 주석 참조) */
  const selectedMemo =
    (tab === "inbox" ? inboxMemos : sentMemos).find((m) => m.id === selectedMemoId) || null;
  const loading = tab === "inbox" ? inboxLoading : sentLoading;

  // ── 받은쪽지함 구독 (§3: recipientEmails array-contains)
  useEffect(() => {
    if (!myEmail || !domain) return;
    setInboxLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setInboxMemos(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as MemoDoc) }))
      );
      setInboxLoading(false);
      setLoadError(null);
    }, (err) => {
      // 조용히 삼키면 색인 미생성·권한 거부가 "쪽지 없음"과 구별되지 않는다.
      // 복합 색인 생성 링크도 이 에러에만 들어 있으므로 콘솔에 반드시 남긴다(스펙 §8 운영 액션).
      console.error("[memo] 받은쪽지함 구독 실패", err);
      setInboxLoading(false);
      setLoadError("쪽지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => unsub();
  }, [myEmail, domain]);

  // ── 보낸쪽지함 구독 (§3: senderEmail ==)
  useEffect(() => {
    if (!myEmail || !domain) return;
    setSentLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("senderEmail", "==", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setSentMemos(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as MemoDoc) }))
      );
      setSentLoading(false);
      setLoadError(null);
    }, (err) => {
      console.error("[memo] 보낸쪽지함 구독 실패", err);
      setSentLoading(false);
      setLoadError("쪽지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => unsub();
  }, [myEmail, domain]);

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
            /* 실패를 "쪽지 없음"으로 보여주면 원인을 볼 수 없다 — 빈 상태와 구분해 표시한다 */
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
          onClose={() => setShowCompose(false)}
          onSent={() => { setTab("sent"); setSelectedMemoId(null); }}
        />
      )}
    </div>
  );
}
