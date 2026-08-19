"use client";

// 쪽지·업무 통합 허브 컴포넌트 — docs/messaging_hub_ia_spec.md (2026-08-19 개정판)
// IA: 좌 320px 상주 조직도 + 우 (업무/쪽지 모드 & 탭)
// 모드: 담긴 사람 0명 = 읽는 자리 (목록/상세), 담긴 사람 1명 이상 = 보내는 자리 (인라인 폼)

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { getClientCache } from "@/lib/cache/clientCache";
import { buildGwsNameMap } from "@/lib/org/roster";
import { resolveDisplayName } from "@/lib/org/displayName";
import HubOrgTree from "./hub/HubOrgTree";
import HubTaskComposer from "./hub/HubTaskComposer";
import HubMemoComposer from "./hub/HubMemoComposer";
import TasksSection from "./tasks/TasksSection";
import MemoSection from "./MemoSection";

interface MessagingHubProps {
  initialCategory?: "tasks" | "memo";
  initialTaskId?: string | null;
  initialMemoId?: string | null;
}

export default function MessagingHub({
  initialCategory = "tasks",
  initialTaskId = null,
  initialMemoId = null,
}: MessagingHubProps) {
  const { userData, teacherProfile } = useAuth();

  // 발신 자격 = 교직원 조직도에 부서 등록 여부 (§4)
  const canSend = !!userData && !!(teacherProfile?.departments && teacherProfile.departments.length > 0);

  // 카테고리: "tasks" (업무) | "memo" (쪽지) — 기본값은 [업무] (§2-3, §2-5)
  const [activeCategory, setActiveCategory] = useState<"tasks" | "memo">(initialCategory);

  // 하위 탭 라우팅용
  const [tasksTab, setTasksTab] = useState<"inbox" | "sent">("inbox");
  const [memoTab, setMemoTab] = useState<"inbox" | "sent" | "starred">("inbox");

  // 선택된 수신자 (소문자 이메일 Set)
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());

  // 보내는 자리에서의 활성 작성기: "task" (업무 등록) | "memo" (쪽지 쓰기) — 기본값은 업무 등록
  const [activeComposer, setActiveComposer] = useState<"task" | "memo">("task");

  // 작성기 전환 시 텍스트 보존 버퍼 (§2-5)
  const [sharedTitle, setSharedTitle] = useState("");
  const [sharedBody, setSharedBody] = useState("");

  // 좌측 조직도 접힘 상태 (localStorage 영속화)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("messaging_hub:sidebar_collapsed");
      if (saved === "true") {
        setIsSidebarCollapsed(true);
      }
    } catch (e) {}
  }, []);

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("messaging_hub:sidebar_collapsed", String(next));
      } catch (e) {}
      return next;
    });
  };

  // 교직원 명단 사본 (칩 이름 표시 및 검증용)
  const [profiles, setProfiles] = useState<TeacherProfile[]>([]);

  // GWS 이름 맵
  const [gwsUsers, setGwsUsers] = useState<any[]>([]);
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (Array.isArray(cached) && cached.length > 0) {
      setGwsUsers(cached);
    }
  }, []);
  const gwsNameMap = useMemo(() => buildGwsNameMap(gwsUsers), [gwsUsers]);

  const profileMap = useMemo(() => {
    const map = new Map<string, TeacherProfile>();
    profiles.forEach((p) => {
      if (p.email) map.set(p.email.toLowerCase(), p);
    });
    return map;
  }, [profiles]);



  // initialTaskId / initialMemoId 전달 시 해당 탭 자동 활성화
  useEffect(() => {
    if (initialTaskId) {
      setActiveCategory("tasks");
      setSelectedEmails(new Set());
    } else if (initialMemoId) {
      setActiveCategory("memo");
      setSelectedEmails(new Set());
    } else if (initialCategory) {
      setActiveCategory(initialCategory);
    }
  }, [initialTaskId, initialMemoId, initialCategory]);

  // 수신자 토글 핸들러
  const handleToggleEmail = useCallback((email: string) => {
    const clean = email.toLowerCase();
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(clean)) {
        next.delete(clean);
      } else {
        next.add(clean);
      }
      return next;
    });
  }, []);

  // 부서 전체 선택/해제 핸들러
  const handleToggleDept = useCallback((deptName: string, memberEmails: string[]) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      const allSelected = memberEmails.length > 0 && memberEmails.every((e) => next.has(e));
      if (allSelected) {
        memberEmails.forEach((e) => next.delete(e));
      } else {
        memberEmails.forEach((e) => next.add(e));
      }
      return next;
    });
  }, []);

  // 선택 초기화 — 선택만 비우고 초안은 유지 (결함 2 수정: 초안 삭제 분리)
  const handleClearSelection = useCallback(() => {
    setSelectedEmails(new Set());
  }, []);

  // 전체 선택 (효명고 전체 선택)
  const handleSelectAll = useCallback((emails: string[]) => {
    setSelectedEmails(new Set(emails.map((e) => e.toLowerCase())));
  }, []);

  // 개별 칩 제거
  const handleRemoveEmail = useCallback((email: string) => {
    const clean = email.toLowerCase();
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      next.delete(clean);
      return next;
    });
  }, []);

  // 업무 작성 -> 쪽지 작성 전환
  const handleSwitchToMemo = (title: string, body: string) => {
    setSharedTitle(title);
    setSharedBody(body);
    setActiveComposer("memo");
  };

  // 쪽지 작성 -> 업무 작성 전환
  const handleSwitchToTask = (title: string, body: string) => {
    setSharedTitle(title);
    setSharedBody(body);
    setActiveComposer("task");
  };

  // 발송 성공 후 복귀 — 발송 뒤에는 선택 + 초안 모두 비운다
  const handleTaskSent = () => {
    setSelectedEmails(new Set());
    setSharedTitle("");
    setSharedBody("");
    setActiveCategory("tasks");
    setTasksTab("sent");
  };

  const handleMemoSent = () => {
    setSelectedEmails(new Set());
    setSharedTitle("");
    setSharedBody("");
    setActiveCategory("memo");
    setMemoTab("sent");
  };

  const isSendingMode = selectedEmails.size > 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-slate-100">
      {/* ── 1. PC 전용 안내 (화면 폭 1024px 미만 가드 — 스펙 §2, 로드맵 원칙 ③) ── */}
      <div className="lg:hidden p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-sm max-w-md mx-auto my-12">
        <span className="text-4xl block mb-3">💻</span>
        <h3 className="text-base font-bold text-slate-800 mb-1">컴퓨터 전용 화면</h3>
        <p className="text-xs text-slate-500">
          쪽지·업무 통합 화면은 넓은 화면의 컴퓨터 환경에 최적화되어 있습니다.
        </p>
      </div>

      {/* ── 2. 메인 2단 화면 (1024px 이상) ── */}
      <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
        {/* 좌측 패널: 교직원 조직도 상주 */}
        <HubOrgTree
          selectedEmails={selectedEmails}
          onToggleEmail={handleToggleEmail}
          onToggleDept={handleToggleDept}
          onClearSelection={handleClearSelection}
          onSelectAll={handleSelectAll}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
          onProfilesLoaded={setProfiles}
        />

        {/* 우측 패널: 읽는 자리 / 보내는 자리 */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white">
          {/* ── 모드 B: 보내는 자리 (담긴 사람 1명 이상 — 상단 대상 띠 + 행동 버튼) ── */}
          {isSendingMode ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* 상단 대상 띠 */}
              <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4 flex-shrink-0">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs font-bold text-slate-700">받는 사람</span>
                    <span className="text-xs font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                      총 {selectedEmails.size}명
                    </span>
                  </div>

                  {/* 수신자 칩 목록 (이메일 비노출, 실명 표출) */}
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 min-w-0 scrollbar-none">
                    {Array.from(selectedEmails).map((email) => {
                      const p = profileMap.get(email);
                      const name = resolveDisplayName(email, p, gwsNameMap.get(email)).name;
                      return (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-slate-800 border border-slate-200 shadow-2xs flex-shrink-0"
                        >
                          <span>{name}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEmail(email)}
                            className="text-slate-400 hover:text-rose-600 p-0.5 font-bold cursor-pointer transition-colors"
                            title="제거"
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-xs text-slate-500 hover:text-rose-600 font-semibold cursor-pointer flex-shrink-0 ml-1"
                  >
                    비우기
                  </button>
                </div>

                {/* 작성 모드 전환 버튼 2종 (업무 등록 강조, 쪽지 보내기 보조 — §2-4, §2-5) */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveComposer("task")}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeComposer === "task"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>📌</span>
                    <span>업무 등록</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveComposer("memo")}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeComposer === "memo"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span>✉️</span>
                    <span>쪽지 쓰기</span>
                  </button>
                </div>
              </div>

              {/* 작성 폼 렌더링 */}
              {activeComposer === "task" ? (
                <HubTaskComposer
                  selectedEmails={selectedEmails}
                  onClearSelection={handleClearSelection}
                  onRemoveEmail={handleRemoveEmail}
                  onSwitchToMemo={handleSwitchToMemo}
                  onSent={handleTaskSent}
                  profiles={profiles}
                  gwsNameMap={gwsNameMap}
                  initialTitle={sharedTitle}
                  initialBody={sharedBody}
                  canSend={canSend}
                />
              ) : (
                <HubMemoComposer
                  selectedEmails={selectedEmails}
                  onClearSelection={handleClearSelection}
                  onRemoveEmail={handleRemoveEmail}
                  onSwitchToTask={handleSwitchToTask}
                  onSent={handleMemoSent}
                  profiles={profiles}
                  gwsNameMap={gwsNameMap}
                  initialTitle={sharedTitle}
                  initialBody={sharedBody}
                  canSend={canSend}
                />
              )}
            </div>
          ) : (
            /* ── 모드 A: 읽는 자리 (담긴 사람 0명 — 큰 구분 [업무] / [쪽지]) ── */
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* 상단 카테고리 헤더 — [ 📌 업무 ] [ ✉️ 쪽지 ] */}
              <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveCategory("tasks")}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeCategory === "tasks"
                        ? "bg-white text-indigo-700 shadow-xs font-extrabold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>📌</span>
                    <span>업무</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategory("memo")}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeCategory === "memo"
                        ? "bg-white text-indigo-700 shadow-xs font-extrabold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>✉️</span>
                    <span>쪽지</span>
                  </button>
                </div>

                <div className="text-xs text-slate-400">
                  {activeCategory === "tasks"
                    ? "내 할 일을 확인하거나 보낸 업무 현황을 조회합니다."
                    : "주고받은 쪽지를 확인하고 관리합니다."}
                </div>
              </div>

              {/* 본문 콘텐츠 (활성 탭만 구독 — 스펙 §5-6) */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
                {activeCategory === "tasks" ? (
                  <TasksSection
                    initialTaskId={initialTaskId}
                    initialTab={tasksTab}
                  />
                ) : (
                  <MemoSection
                    initialMemoId={initialMemoId}
                    initialTab={memoTab}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
