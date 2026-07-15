"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { getClientCache, setClientCache, invalidateClientCache } from "@/lib/cache/clientCache";

interface GoogleGroup {
  id: string;
  email: string;
  name: string;
  description: string;
  directMembersCount?: string;
}

interface GroupMember {
  id: string;
  email: string;
  role: string;
  type: string;
  name?: {
    familyName: string;
    givenName: string;
  } | null;
}

export default function GroupList() {
  const { user, userData } = useAuth();
  const domain = userData?.domain || "";

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GoogleGroup[]>([]);
  const [isMock, setIsMock] = useState(false);

  // Search & Selected Group (which opens the edit modal)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<GoogleGroup | null>(null);

  // Members & Settings of Selected Group
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [groupSettings, setGroupSettings] = useState<any>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);

  // Permission settings collapse state
  const [showSettingsAccordion, setShowSettingsAccordion] = useState(false);

  // Form States (New Group)
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGroupEmailPrefix, setNewGroupEmailPrefix] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Form States (Add Member)
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  // General Status Messages
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const opEmail = user?.email || "unknown@domain.com";
  const opName = user?.displayName || user?.email?.split("@")[0] || "관리자";

  // Load Groups list
  const loadGroups = async (forceRefresh = false) => {
    if (!domain) return;

    if (!forceRefresh) {
      const cached = getClientCache("groups:all");
      if (cached) {
        setGroups(cached);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load groups");

      setGroups(data.groups || []);
      setIsMock(data.isMock || false);
      setClientCache("groups:all", data.groups || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load members and settings when a group is selected for editing
  const openEditModal = async (group: GoogleGroup) => {
    setSelectedGroup(group);
    setGroupSettings(null);
    setShowSettingsAccordion(false);
    setError("");
    setSuccess("");

    // 선 캐시 확인
    const cacheKey = `group_members:${group.email}`;
    const cached = getClientCache(cacheKey);
    if (cached) {
      setMembers(cached);
      setLoadingMembers(false);
    } else {
      setMembers([]);
      // Fetch members
      setLoadingMembers(true);
      try {
        const res = await fetch("/api/workspace/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_members", groupEmail: group.email }),
        });
        const data = await res.json();
        if (res.ok) {
          setMembers(data.members || []);
          setClientCache(cacheKey, data.members || [], 3 * 60 * 1000); // 3분 TTL
        } else {
          console.warn("Failed to load group members:", data.error);
          setError(`그룹 멤버 목록을 불러오지 못했습니다: ${data.error}`);
        }
      } catch (err: any) {
        console.warn("Error fetching members:", err);
        setError(`멤버 목록 요청 실패: ${err.message}`);
      } finally {
        setLoadingMembers(false);
      }
    }

    // Fetch settings
    setLoadingSettings(true);
    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings", groupEmail: group.email }),
      });
      const data = await res.json();
      if (res.ok) {
        setGroupSettings(data.settings);
      } else {
        console.warn("Failed to load group settings:", data.error);
        if (data.error?.includes("unauthorized_client")) {
          setError("⚠️ 그룹 권한 설정을 불러오지 못했습니다. Google Admin의 '도메인 범위 위임'에서 'https://www.googleapis.com/auth/apps.groups.settings' 스코프 권한 대행이 승인되어 있는지 확인해주세요.");
        } else {
          setError(`그룹 권한 설정을 불러오지 못했습니다: ${data.error}`);
        }
      }
    } catch (err: any) {
      console.warn("Error fetching settings:", err);
      setError(`그룹 권한 설정 요청 실패: ${err.message}`);
    } finally {
      setLoadingSettings(false);
    }
  };

  // Create Group (Defaults to Public Group)
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupEmailPrefix || !newGroupName) {
      alert("그룹 이메일과 이름을 입력해 주세요.");
      return;
    }

    setCreatingGroup(true);
    setError("");
    const groupEmail = `${newGroupEmailPrefix.trim().toLowerCase()}@${domain}`;

    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          groupEmail,
          groupName: newGroupName.trim(),
          description: newGroupDesc.trim(),
          operatorEmail: opEmail,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create group");

      setSuccess(`그룹 '${groupEmail}'이 성공적으로 생성되었습니다.`);
      setShowAddModal(false);
      setNewGroupEmailPrefix("");
      setNewGroupName("");
      setNewGroupDesc("");

      // Refresh list to update member counts and add new group
      invalidateClientCache("groups:");
      loadGroups(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingGroup(false);
    }
  };

  // Delete Group (Inside detail modal)
  const handleDeleteGroup = async (groupEmail: string) => {
    if (!confirm(`⚠️ 그룹 '${groupEmail}'을 정말 삭제하시겠습니까?\n그룹 내 모든 소통 기록 및 연동 정보가 사라집니다.`)) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          groupEmail,
          operatorEmail: opEmail,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete group");

      setSuccess(`그룹 '${groupEmail}'이 삭제되었습니다.`);
      invalidateClientCache("groups:");
      setGroups((prev) => prev.filter((g) => g.email !== groupEmail));
      setSelectedGroup(null);
      setMembers([]);
      setGroupSettings(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !newMemberEmail) return;

    setAddingMember(true);
    setError("");
    const targetEmail = newMemberEmail.trim();

    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_member",
          groupEmail: selectedGroup.email,
          memberEmail: targetEmail,
          operatorEmail: opEmail,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add member");

      setSuccess(`'${targetEmail}' 멤버를 추가했습니다.`);
      setNewMemberEmail("");

      // 멤버 캐시 무효화 후 다시 로드
      invalidateClientCache(`group_members:${selectedGroup.email}`);
      openEditModal(selectedGroup);

      // Update parent list count optimistically
      setGroups((prev) =>
        prev.map((g) =>
          g.email === selectedGroup.email
            ? { ...g, directMembersCount: String(Number(g.directMembersCount || 0) + 1) }
            : g
        )
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  // Remove Member
  const handleRemoveMember = async (memberEmail: string) => {
    if (!selectedGroup) return;
    if (!confirm(`그룹 '${selectedGroup.email}'에서 '${memberEmail}' 멤버를 제외하시겠습니까?`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          groupEmail: selectedGroup.email,
          memberEmail,
          operatorEmail: opEmail,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove member");

      setSuccess(`'${memberEmail}' 멤버를 제외했습니다.`);
      // 쾐시 무효화 (Optimistic UI로 화면은 이미 업데이트됨)
      invalidateClientCache(`group_members:${selectedGroup.email}`);
      setMembers((prev) => prev.filter((m) => m.email !== memberEmail));

      // Update parent list count optimistically
      setGroups((prev) =>
        prev.map((g) =>
          g.email === selectedGroup.email
            ? { ...g, directMembersCount: String(Math.max(0, Number(g.directMembersCount || 0) - 1)) }
            : g
        )
      );
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Update Settings Preset
  const handlePresetChange = async (preset: "announcement" | "collaborative" | "public") => {
    if (!selectedGroup) return;

    let settings = {};
    if (preset === "announcement") {
      // 📢 공지사항 전용: 교사만 쓰기 가능, 학생 수신 전용
      settings = {
        whoCanPostMessage: "ALL_MANAGERS_CAN_POST",
        whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanJoin: "INVITED_CAN_JOIN",
      };
    } else if (preset === "collaborative") {
      // 🤝 내부 협업용: 학교 계정만 게시 및 소통
      settings = {
        whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
        whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanJoin: "CAN_REQUEST_TO_JOIN",
      };
    } else if (preset === "public") {
      // 🌐 외부 수신 허용: 외부인도 메일 발송 가능
      settings = {
        whoCanPostMessage: "ANYONE_CAN_POST",
        whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
        whoCanJoin: "CAN_REQUEST_TO_JOIN",
      };
    }

    setLoadingSettings(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          groupEmail: selectedGroup.email,
          settings,
          operatorEmail: opEmail,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update settings");

      setGroupSettings(data.settings);
      setSuccess("그룹 권한 설정이 성공적으로 변경되었습니다.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingSettings(false);
    }
  };

  // Determine active preset based on current settings
  const currentPreset = useMemo(() => {
    if (!groupSettings) return null;
    const { whoCanPostMessage } = groupSettings;

    if (whoCanPostMessage === "ALL_MANAGERS_CAN_POST" || whoCanPostMessage === "NONE_CAN_POST") {
      return "announcement";
    }
    if (whoCanPostMessage === "ANYONE_CAN_POST") {
      return "public";
    }
    return "collaborative";
  }, [groupSettings]);

  // Load list on init
  useEffect(() => {
    loadGroups();
  }, [domain]);

  // Filter groups
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      const query = searchQuery.toLowerCase();
      return g.name.toLowerCase().includes(query) || g.email.toLowerCase().includes(query);
    });
  }, [groups, searchQuery]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-6">
      {/* Upper header action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            👥 구글 메일링 그룹 관리
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            도메인 내 반별 메일링 그룹 및 업무용 구글 그룹스를 일괄 관리하고 게시 권한을 설정합니다.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors shadow-sm flex items-center gap-1.5 self-start sm:self-center"
        >
          <span>➕</span> 그룹 생성
        </button>
      </div>

      {/* Global Alerts */}
      {error && !selectedGroup && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-semibold">
          ❌ {error}
        </div>
      )}
      {success && !selectedGroup && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm font-semibold">
          ✅ {success}
        </div>
      )}

      {isMock && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-xl text-xs">
          ✨ <strong>테스트 모드 활성화됨:</strong> 로컬 테스트 데이터베이스를 사용하고 있습니다. 구글 API 서버에 영향을 주지 않고 안전하게 CRUD 테스트가 가능합니다.
        </div>
      )}

      {/* Search toolbar */}
      <div className="relative">
        <input
          type="text"
          placeholder="그룹 이름 또는 이메일 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <span className="absolute left-3.5 top-2.5 text-gray-400">🔍</span>
      </div>

      {/* Full width groups list table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-gray-500 font-semibold text-left">
              <th className="px-4 py-3">그룹 정보</th>
              <th className="px-4 py-3">설명 및 회원수</th>
              <th className="px-4 py-3 text-right w-44">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-gray-400">
                  ⏳ 그룹 목록을 불러오는 중...
                </td>
              </tr>
            ) : filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-gray-400">
                  검색 조건에 맞는 그룹이 없습니다.
                </td>
              </tr>
            ) : (
              filteredGroups.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => openEditModal(g)}
                  className="cursor-pointer hover:bg-indigo-50/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-bold text-gray-900">{g.name}</div>
                    <div className="text-xs text-indigo-600 font-mono mt-0.5">{g.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    <div className="font-medium text-gray-700 line-clamp-1">{g.description || "설명 없음"}</div>
                    <div className="text-indigo-600 font-semibold mt-1 bg-indigo-50/50 inline-block px-2 py-0.5 rounded text-[10px]">
                      회원수: {g.directMembersCount || "0"}명
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditModal(g)}
                        className="px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 border border-indigo-200 rounded-md transition-colors shadow-sm"
                      >
                        상세 및 수정
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(g.email)}
                        className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 border border-red-200 rounded-md transition-colors shadow-sm"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Group Details & Edit Modal (Slide-over overlay style) ── */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col justify-between border-l">
            {/* Header info */}
            <div>
              <div className="bg-indigo-950 text-white p-6 relative">
                <button
                  onClick={() => setSelectedGroup(null)}
                  className="absolute right-4 top-4 text-gray-400 hover:text-white text-2xl font-bold p-1"
                >
                  ×
                </button>
                <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-indigo-600 rounded text-white inline-block mb-2">
                  구글 그룹 관리
                </span>
                <h3 className="text-lg font-bold truncate pr-8">{selectedGroup.name}</h3>
                <p className="text-xs text-indigo-300 font-mono mt-0.5 truncate">{selectedGroup.email}</p>
                {selectedGroup.description && (
                  <p className="text-xs text-indigo-100/90 mt-2 border-t border-indigo-900/50 pt-2 leading-relaxed">
                    {selectedGroup.description}
                  </p>
                )}
              </div>

              {/* Action alert internally */}
              {(error || success) && (
                <div className="p-4 border-b">
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs font-semibold">
                      ❌ {error}
                    </div>
                  )}
                  {success && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-xs font-semibold">
                      ✅ {success}
                    </div>
                  )}
                </div>
              )}

              {/* Detail settings scroll area */}
              <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-210px)]">
                {/* ── Collapsible Permissions Settings Accordion ── */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowSettingsAccordion(!showSettingsAccordion)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="flex items-center gap-1.5">
                        ⚙️ 그룹 게시 및 가입 권한 조정
                      </span>
                      {/* Current status summary shown even when collapsed */}
                      {!loadingSettings && groupSettings && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          currentPreset === "announcement"
                            ? "bg-amber-100 text-amber-700"
                            : currentPreset === "public"
                            ? "bg-green-100 text-green-700"
                            : "bg-indigo-100 text-indigo-700"
                        }`}>
                          현재: {currentPreset === "announcement" ? "📢 공지사항 전용" : currentPreset === "public" ? "🌐 외부 수신 허용" : "🤝 내부 협업용"}
                        </span>
                      )}
                      {!loadingSettings && !groupSettings && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">
                          권한 정보 없음
                        </span>
                      )}
                    </div>
                    <span className={`transform transition-transform text-xs ${showSettingsAccordion ? "rotate-180" : ""}`}>
                      ▼
                    </span>
                  </button>

                  {showSettingsAccordion && (
                    <div className="p-4 bg-white border-t border-gray-200 space-y-4">
                      {loadingSettings ? (
                        <p className="text-xs text-gray-400 text-center py-2">⏳ 권한 설정을 읽어오는 중...</p>
                      ) : !groupSettings ? (
                        <p className="text-xs text-gray-400 text-center py-2">권한 설정을 불러오지 못했습니다. 도메인 위임 설정을 확인해 주세요.</p>
                      ) : (
                        <>
                          {/* ── Current Settings Detail ── */}
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                            <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">현재 권한 상태</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                              <span className="text-gray-500">게시 권한</span>
                              <span className="font-semibold text-gray-800">
                                {groupSettings.whoCanPostMessage === "ANYONE_CAN_POST" ? "누구나 (외부 포함)"
                                  : groupSettings.whoCanPostMessage === "ALL_IN_DOMAIN_CAN_POST" ? "도메인 내부 전체"
                                  : groupSettings.whoCanPostMessage === "ALL_MEMBERS_CAN_POST" ? "멤버만"
                                  : groupSettings.whoCanPostMessage === "ALL_MANAGERS_CAN_POST" ? "관리자만"
                                  : groupSettings.whoCanPostMessage === "NONE_CAN_POST" ? "게시 불가"
                                  : groupSettings.whoCanPostMessage || "알 수 없음"}
                              </span>
                              <span className="text-gray-500">가입 방식</span>
                              <span className="font-semibold text-gray-800">
                                {groupSettings.whoCanJoin === "ANYONE_CAN_JOIN" ? "누구나 자유 가입"
                                  : groupSettings.whoCanJoin === "ALL_IN_DOMAIN_CAN_JOIN" ? "도메인 내 자유 가입"
                                  : groupSettings.whoCanJoin === "CAN_REQUEST_TO_JOIN" ? "요청 후 가입"
                                  : groupSettings.whoCanJoin === "INVITED_CAN_JOIN" ? "초대만 가능"
                                  : groupSettings.whoCanJoin || "알 수 없음"}
                              </span>
                              <span className="text-gray-500">그룹 조회</span>
                              <span className="font-semibold text-gray-800">
                                {groupSettings.whoCanViewGroup === "ANYONE_CAN_VIEW" ? "누구나 (외부 포함)"
                                  : groupSettings.whoCanViewGroup === "ALL_IN_DOMAIN_CAN_VIEW" ? "도메인 내부 전체"
                                  : groupSettings.whoCanViewGroup === "ALL_MEMBERS_CAN_VIEW" ? "멤버만"
                                  : groupSettings.whoCanViewGroup || "알 수 없음"}
                              </span>
                              <span className="text-gray-500">멤버 목록 조회</span>
                              <span className="font-semibold text-gray-800">
                                {groupSettings.whoCanViewMembership === "ALL_IN_DOMAIN_CAN_VIEW" ? "도메인 내부 전체"
                                  : groupSettings.whoCanViewMembership === "ALL_MEMBERS_CAN_VIEW" ? "멤버만"
                                  : groupSettings.whoCanViewMembership === "ALL_MANAGERS_CAN_VIEW" ? "관리자만"
                                  : groupSettings.whoCanViewMembership || "알 수 없음"}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-gray-500 leading-relaxed font-normal">
                            아래 프리셋을 선택하면 위 권한 설정이 즉시 일괄 변경됩니다.
                          </p>

                          <div className="space-y-2">
                            {/* Preset Options */}
                            <button
                              onClick={() => handlePresetChange("collaborative")}
                              className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                                currentPreset === "collaborative"
                                  ? "border-indigo-600 bg-indigo-50/30 text-indigo-900"
                                  : "border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <div>
                                <p className="font-bold">🤝 내부 협업용 (기본값 / 공개 그룹)</p>
                                <p className="text-gray-500 mt-0.5 text-[11px]">학교 구성원 전체 소통 및 자유 게시 가능</p>
                              </div>
                              {currentPreset === "collaborative" && <span className="text-indigo-600 font-bold">✓ 현재</span>}
                            </button>

                            <button
                              onClick={() => handlePresetChange("announcement")}
                              className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                                currentPreset === "announcement"
                                  ? "border-indigo-600 bg-indigo-50/30 text-indigo-900"
                                  : "border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <div>
                                <p className="font-bold">📢 공지사항 전용 (Restricted)</p>
                                <p className="text-gray-500 mt-0.5 text-[11px]">관리자/교사만 게시 가능, 학생은 메일 수신만 가능</p>
                              </div>
                              {currentPreset === "announcement" && <span className="text-indigo-600 font-bold">✓ 현재</span>}
                            </button>

                            <button
                              onClick={() => handlePresetChange("public")}
                              className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                                currentPreset === "public"
                                  ? "border-indigo-600 bg-indigo-50/30 text-indigo-900"
                                  : "border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <div>
                                <p className="font-bold">🌐 외부 수신 허용 (External / Open)</p>
                                <p className="text-gray-500 mt-0.5 text-[11px]">학교 밖 외부 이메일도 수신 허용 (공식 문의처)</p>
                              </div>
                              {currentPreset === "public" && <span className="text-indigo-600 font-bold">✓ 현재</span>}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Members Management Section ── */}
                <div className="space-y-4">
                  <h4 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                    👥 소속 멤버 관리 ({members.length}명)
                  </h4>

                  {/* Add Member form */}
                  <form onSubmit={handleAddMember} className="flex gap-2 items-center flex-1 w-full">
                    <div className="flex-1">
                      <AutocompleteInput
                        type="user"
                        value={newMemberEmail}
                        onChange={setNewMemberEmail}
                        domain={domain}
                        onSelect={(email) => setNewMemberEmail(email)}
                        placeholder="추가할 사용자 이메일 입력..."
                        className="flex-1"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={addingMember || !newMemberEmail}
                      className="px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-xl shadow hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {addingMember ? "⏳" : "추가"}
                    </button>
                  </form>

                  {/* Members list */}
                  <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100">
                    {loadingMembers ? (
                      <p className="text-xs text-gray-400 text-center py-8">⏳ 멤버 목록을 불러오는 중...</p>
                    ) : members.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">그룹에 등록된 멤버가 없습니다.</p>
                    ) : (
                      members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50/20 hover:bg-gray-50 transition-colors">
                          <div className="flex flex-col min-w-0 flex-1 mr-3">
                            <span className="text-xs font-bold text-gray-800 truncate">
                              {m.name ? (
                                /^\d+$/.test(m.name.familyName)
                                  ? `${m.name.givenName} (${m.name.familyName})`
                                  : `${m.name.familyName || ""}${m.name.givenName || ""}`
                              ) : (
                                "외부 사용자"
                              )}
                            </span>
                            <span className="text-[10px] font-mono text-gray-400 truncate mt-0.5">
                              {m.email}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(m.email)}
                            className="px-2.5 py-1 text-[10px] text-red-500 hover:bg-red-50 rounded font-semibold transition-colors flex-shrink-0"
                          >
                            제외
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer containing delete action */}
            <div className="p-6 border-t bg-gray-50 flex items-center justify-between">
              <button
                onClick={() => handleDeleteGroup(selectedGroup.email)}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow transition-colors"
              >
                🗑️ 그룹 삭제
              </button>
              <button
                onClick={() => setSelectedGroup(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-white border hover:bg-gray-50 rounded-xl shadow-sm transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Group Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden border border-gray-200">
            <div className="px-6 py-4 bg-indigo-950 text-white font-bold flex justify-between items-center">
              <h3>👥 새 구글 그룹 생성</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white text-lg font-bold"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  그룹 이메일 주소 <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="예: 101, math-teachers"
                    value={newGroupEmailPrefix}
                    onChange={(e) => setNewGroupEmailPrefix(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-semibold text-gray-500 font-mono font-bold">@{domain}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  그룹 이름 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: 1학년 1반, 수학 교과 교사모임"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">설명</label>
                <textarea
                  placeholder="그룹에 대한 간단한 설명을 남겨주세요."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 text-xs text-indigo-800 leading-relaxed font-medium">
                💡 <strong>알림:</strong> 그룹 생성 시 기본값으로 <strong>"내부 협업용 (공개 그룹)"</strong> 권한이 지정됩니다. 
                누구나 자유롭게 소통 및 발송 가능하며, 생성 완료 후 상세 권한을 변경하실 수 있습니다.
              </div>

              <div className="pt-2 flex justify-end gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border rounded-xl text-gray-600 hover:bg-gray-50 font-semibold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={creatingGroup || !newGroupEmailPrefix || !newGroupName}
                  className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl shadow hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {creatingGroup ? "⏳ 생성 중..." : "그룹 생성"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
