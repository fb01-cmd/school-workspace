"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import UserSheetEditor from "@/components/admin/UserSheetEditor";

interface GoogleUser {
  id: string;
  primaryEmail: string;
  name: {
    familyName: string;
    givenName: string;
  };
  orgUnitPath: string;
  role?: string;
  suspended?: boolean;
  aliases?: string[];
}

type SortColumn = "familyName" | "givenName" | "primaryEmail" | "orgUnitPath";
type SortDirection = "asc" | "desc";

export default function UserList() {
  const { user, userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<GoogleUser[]>([]);
  const [isMock, setIsMock] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);
  const [orgUnits, setOrgUnits] = useState<{ orgUnitId: string; orgUnitPath: string; name: string; }[]>([]);

  // Firestore mapping info
  const [gradesCount, setGradesCount] = useState<number>(0);
  const [teacherOU, setTeacherOU] = useState<string>("");
  const [studentOUMappings, setStudentOUMappings] = useState<Record<number, string>>({});

  // Filters & Search
  const [selectedOUFilter, setSelectedOUFilter] = useState<string>("/");
  const [searchQuery, setSearchQuery] = useState("");

  // Sorting State
  const [sortColumn, setSortColumn] = useState<SortColumn>("familyName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Add User Form States
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newOUPath, setNewOUPath] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newChangePasswordAtNextLogin, setNewChangePasswordAtNextLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Selection state
  const [selectedUserEmails, setSelectedUserEmails] = useState<Set<string>>(new Set());

  // Edit User Form States
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<GoogleUser | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editOUPath, setEditOUPath] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editChangePasswordAtNextLogin, setEditChangePasswordAtNextLogin] = useState(false);
  const [editSuspended, setEditSuspended] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  const [newAliasPrefix, setNewAliasPrefix] = useState("");
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const domain = userData?.domain || "";
  const isSuperAdmin = userData?.role === "super_admin";
  const [isSheetMode, setIsSheetMode] = useState(false);


  const hasInitializedRef = useRef(false);

  const loadInitialConfigAndOUs = async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const settingsRef = doc(db, "settings", domain);
      
      // Fetch settings and OUs concurrently
      const [settingsSnap, ouRes] = await Promise.all([
        getDoc(settingsRef),
        fetch("/api/workspace/ou")
      ]);

      if (settingsSnap.exists()) {
        setHasSettings(true);
        const settings = settingsSnap.data();
        setGradesCount(settings.gradesCount || 0);
        
        const teachOU = settings.ouMapping?.teachers || "";
        const studOUs = settings.ouMapping?.students || {};
        
        setTeacherOU(teachOU);
        setStudentOUMappings(studOUs);
      } else {
        setHasSettings(false);
      }

      if (ouRes.ok) {
        const ouData = await ouRes.json();
        setOrgUnits(ouData.orgUnits || []);
      }
      
      // Load initial users (keeps loading=true throughout entire init sequence)
      await loadUsers(selectedOUFilter, true);
      hasInitializedRef.current = true;
    } catch (error) {
      console.error("Failed to load initial configs", error);
      alert("설정 및 조직 데이터를 불러오는 데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async (ouFilter: string, isSilent = false) => {
    if (!domain) return [];
    if (!isSilent) setLoading(true);
    try {
      const pathToSend = ouFilter === "" ? "all" : ouFilter;
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          orgUnitPaths: [pathToSend],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users || []);
        setIsMock(data.isMock);
        return data.users || [];
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to load users", error);
      alert("사용자 데이터를 불러오는 데 실패했습니다.");
    } finally {
      if (!isSilent) setLoading(false);
    }
    return [];
  };

  // Load configuration and initial data only once when domain switches
  useEffect(() => {
    hasInitializedRef.current = false;
    loadInitialConfigAndOUs();
  }, [domain]);

  // Dynamically load users when OU filter changes (skip first mount — handled by loadInitialConfigAndOUs)
  useEffect(() => {
    if (domain && hasInitializedRef.current) {
      loadUsers(selectedOUFilter, false);
    }
  }, [selectedOUFilter]);

  const handleRoleFilterChange = (role: string) => {
    setSelectedOUFilter(""); // clear OU filter when switching preset
  };

  const handleOUFilterChange = (ou: string) => {
    setSelectedOUFilter(ou);
  };

  const toggleUserSelection = (email: string) => {
    setSelectedUserEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const currentPageEmails = paginatedUsers.map((u) => u.primaryEmail);
    const allSelectedOnPage = currentPageEmails.every((email) => selectedUserEmails.has(email));

    setSelectedUserEmails((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        currentPageEmails.forEach((email) => next.delete(email));
      } else {
        currentPageEmails.forEach((email) => next.add(email));
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const count = selectedUserEmails.size;
    if (count === 0) return;
    if (!confirm(`선택한 ${count}개의 계정을 정말로 구글 워크스페이스에서 영구 삭제하시겠습니까?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_delete",
          emails: Array.from(selectedUserEmails),
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.failures && data.failures.length > 0) {
          alert(`일부 계정 삭제 실패:\n${data.failures.map((f: any) => `${f.email}: ${f.reason}`).join("\n")}`);
        } else {
          alert("선택한 계정이 모두 성공적으로 삭제되었습니다.");
        }
        setSelectedUserEmails(new Set());
        loadUsers(selectedOUFilter);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Bulk delete error", error);
      alert(`일괄 삭제 실패: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkSuspend = async (suspend: boolean) => {
    const count = selectedUserEmails.size;
    if (count === 0) return;
    const actionText = suspend ? "일시정지" : "활성화(일시정지 해제)";
    if (!confirm(`선택한 ${count}개의 계정을 정말로 ${actionText} 하시겠습니까?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_suspend",
          emails: Array.from(selectedUserEmails),
          suspended: suspend,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.failures && data.failures.length > 0) {
          alert(`일부 계정 ${actionText} 실패:\n${data.failures.map((f: any) => `${f.email}: ${f.reason}`).join("\n")}`);
        } else {
          alert(`선택한 계정이 모두 성공적으로 ${actionText} 되었습니다.`);
        }
        setSelectedUserEmails(new Set());
        loadUsers(selectedOUFilter);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Bulk suspend error", error);
      alert(`일괄 처리 실패: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditModal = (user: GoogleUser) => {
    setEditingUser(user);
    setEditFirstName(user.name.givenName);
    setEditLastName(user.name.familyName);
    const emailPrefix = user.primaryEmail.split("@")[0];
    setEditEmail(emailPrefix);
    setEditOUPath(user.orgUnitPath);
    setEditPassword("");
    setEditChangePasswordAtNextLogin(false);
    setEditSuspended(!!user.suspended);
    setShowEditPassword(false);
    setShowEditModal(true);
  };

  const handleToggleSuspendSingle = async (userItem: GoogleUser) => {
    const actionText = userItem.suspended ? "활성화" : "일시정지";
    if (!confirm(`${userItem.name.familyName}${userItem.name.givenName} 계정을 정말로 ${actionText} 하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          email: userItem.primaryEmail,
          updates: {
            suspended: !userItem.suspended,
          },
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`계정이 성공적으로 ${actionText} 되었습니다.`);
        loadUsers(selectedOUFilter);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Single suspend error", error);
      alert(`계정 처리 실패: ${error.message}`);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (!editFirstName || !editLastName || !editOUPath) {
      alert("모든 필수 항목을 입력해 주세요.");
      return;
    }

    const updates: any = {
      firstName: editFirstName,
      lastName: editLastName,
      orgUnitPath: editOUPath,
      suspended: editSuspended,
    };

    if (editPassword) {
      if (editPassword.length < 8) {
        alert("비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      updates.password = editPassword;
      updates.changePasswordAtNextLogin = editChangePasswordAtNextLogin;
    }

    const newFullEmail = `${editEmail}@${domain}`;
    if (newFullEmail !== editingUser.primaryEmail) {
      if (!confirm(`이메일 주소를 ${editingUser.primaryEmail}에서 ${newFullEmail}(으)로 변경하시겠습니까? 로그인 계정이 바뀌게 됩니다.`)) {
        return;
      }
      updates.primaryEmail = newFullEmail;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          email: editingUser.primaryEmail,
          updates,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("계정 정보가 성공적으로 업데이트되었습니다.");
        setShowEditModal(false);
        setEditingUser(null);
        setEditPassword("");
        setSelectedUserEmails(new Set());
        loadUsers(editOUPath);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Edit user error", error);
      alert(`계정 수정 실패: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !newAliasPrefix.trim()) return;

    const aliasEmail = `${newAliasPrefix.trim().toLowerCase()}@${domain}`;
    if (aliasEmail === editingUser.primaryEmail) {
      alert("주 이메일 주소와 동일한 별칭은 추가할 수 없습니다.");
      return;
    }
    if (editingUser.aliases?.includes(aliasEmail)) {
      alert("이미 존재하는 별칭입니다.");
      return;
    }

    setAliasSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_alias",
          email: editingUser.primaryEmail,
          alias: aliasEmail,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewAliasPrefix("");
        const freshUsers = await loadUsers(editingUser.orgUnitPath, true);
        const freshUser = freshUsers?.find((u: any) => u.id === editingUser.id);
        if (freshUser) {
          setEditingUser(freshUser);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Add alias error", error);
      alert(`별칭 추가 실패: ${error.message}`);
    } finally {
      setAliasSubmitting(false);
    }
  };

  const handleDeleteAlias = async (aliasEmail: string) => {
    if (!editingUser) return;
    if (!confirm(`별칭 ${aliasEmail}을(를) 삭제하시겠습니까?`)) {
      return;
    }

    setAliasSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_alias",
          email: editingUser.primaryEmail,
          alias: aliasEmail,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const freshUsers = await loadUsers(editingUser.orgUnitPath, true);
        const freshUser = freshUsers?.find((u: any) => u.id === editingUser.id);
        if (freshUser) {
          setEditingUser(freshUser);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Delete alias error", error);
      alert(`별칭 삭제 실패: ${error.message}`);
    } finally {
      setAliasSubmitting(false);
    }
  };

  // Handle sorting toggles
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setCurrentPage(1); // Reset to page 1 on sort change
  };

  // Process Users (Filter, Search, Sort)
  const processedUsers = useMemo(() => {
    let result = [...users];

    // 1. OU Filter (exact match only — each OU level has its own accounts)
    if (selectedOUFilter) {
      result = result.filter((u) => u.orgUnitPath === selectedOUFilter);
    }

    // 2. Search Query (matches Email, Last Name, First Name)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((u) => {
        const emailMatch = u.primaryEmail.toLowerCase().includes(query);
        const lastNameMatch = u.name.familyName.toLowerCase().includes(query);
        const firstNameMatch = u.name.givenName.toLowerCase().includes(query);
        const fullNameMatch = `${u.name.familyName}${u.name.givenName}`.toLowerCase().includes(query);
        return emailMatch || lastNameMatch || firstNameMatch || fullNameMatch;
      });
    }

    // 3. Sorting Logic
    result.sort((a, b) => {
      let valA = "";
      let valB = "";

      if (sortColumn === "familyName") {
        valA = a.name.familyName;
        valB = b.name.familyName;
      } else if (sortColumn === "givenName") {
        valA = a.name.givenName;
        valB = b.name.givenName;
      } else if (sortColumn === "primaryEmail") {
        valA = a.primaryEmail;
        valB = b.primaryEmail;
      } else if (sortColumn === "orgUnitPath") {
        valA = a.orgUnitPath;
        valB = b.orgUnitPath;
      } else if (sortColumn === "role") {
        valA = a.orgUnitPath === teacherOU ? "teacher" : "student";
        valB = b.orgUnitPath === teacherOU ? "teacher" : "student";
      }

      // LocaleCompare handles Korean and alphanumeric sorting naturally
      return sortDirection === "asc"
        ? valA.localeCompare(valB, "ko", { numeric: true })
        : valB.localeCompare(valA, "ko", { numeric: true });
    });

    return result;
  }, [users, selectedOUFilter, searchQuery, sortColumn, sortDirection, teacherOU, studentOUMappings]);

  // Compute users list to display in sheet mode based on selection or filters
  const sheetUsers = useMemo(() => {
    if (selectedUserEmails.size > 0) {
      return users.filter((u) => selectedUserEmails.has(u.primaryEmail));
    }
    return processedUsers;
  }, [selectedUserEmails, users, processedUsers]);

  // Paginated Users list
  const paginatedUsers = useMemo(() => {
    if (itemsPerPage === -1) return processedUsers;
    const startIndex = (currentPage - 1) * itemsPerPage;
    return processedUsers.slice(startIndex, startIndex + itemsPerPage);
  }, [processedUsers, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    if (itemsPerPage === -1) return 1;
    return Math.max(1, Math.ceil(processedUsers.length / itemsPerPage));
  }, [processedUsers, itemsPerPage]);

  // Dynamic pagination range with ellipses
  const pageNumbers = useMemo(() => {
    const delta = 2; // Pages to show around current page
    const range: number[] = [];
    const rangeWithDots: (number | string)[] = [];
    let l: number | undefined;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }

    for (const i of range) {
      if (l !== undefined) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l > 2) {
          rangeWithDots.push("...");
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  }, [currentPage, totalPages]);

  // Reset to first page when filters or page size changes
  useEffect(() => {
    setCurrentPage(1);
    setSelectedUserEmails(new Set());
  }, [selectedOUFilter, searchQuery, itemsPerPage]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newFirstName || !newLastName || !newOUPath || !newPassword) {
      alert("모든 필수 항목을 입력해 주세요.");
      return;
    }
    if (newPassword.length < 8) {
      alert("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    setIsSubmitting(true);
    const targetEmailAddress = `${newEmail}@${domain}`;
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          email: targetEmailAddress,
          firstName: newFirstName,
          lastName: newLastName,
          orgUnitPath: newOUPath,
          password: newPassword,
          changePasswordAtNextLogin: newChangePasswordAtNextLogin,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("계정이 성공적으로 생성되었습니다.");
        setShowAddModal(false);
        setNewEmail("");
        setNewFirstName("");
        setNewLastName("");
        setNewOUPath("");
        setNewPassword("");
        setNewChangePasswordAtNextLogin(true);
        loadUsers(selectedOUFilter);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Create user error", error);
      alert(`계정 생성 실패: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete User
  const handleDeleteUser = async (email: string, name: string) => {
    if (!confirm(`정말로 ${name}(${email}) 계정을 구글 워크스페이스에서 영구 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          email,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("계정이 성공적으로 삭제되었습니다.");
        loadUsers(selectedOUFilter);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Delete user error", error);
      alert(`계정 삭제 실패: ${error.message}`);
    }
  };

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return " ↕";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  // If it's the very first load and we don't have basic configurations, show full page loading spinner
  if (loading && orgUnits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        {/* Modern tailwind spinner */}
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-gray-500 text-sm font-medium animate-pulse">구글 워크스페이스 명단 및 조직 구성을 불러오는 중...</p>
        <p className="text-xs text-gray-400">최초 진입 시 Google API 연동으로 인해 수 초가 소요될 수 있습니다.</p>
      </div>
    );
  }

  if (!hasSettings) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-2">아직 조직단위(OU) 설정이 없습니다</h3>
        <p className="text-gray-600 mb-4">
          명단을 불러오기 전에 **[조직단위 설정]** 메뉴에서 학교 매핑을 먼저 완료해 주세요.
        </p>
      </div>
    );
  }

  if (isSheetMode) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <UserSheetEditor
          users={sheetUsers}
          orgUnits={orgUnits}
          domain={domain}
          onSave={() => {
            setIsSheetMode(false);
            setSelectedUserEmails(new Set());
            loadUsers(selectedOUFilter);
          }}
          onCancel={() => setIsSheetMode(false)}
        />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-6">
      {isMock && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md p-4 text-sm">
          💡 <strong>안내:</strong> 현재 가짜 데이터 모드(Mock Mode)로 작동 중입니다.
        </div>
      )}

      {/* Title & Add User */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">학교 계정 명단 목록</h2>
          <p className="text-gray-500 text-xs mt-1">구글 워크스페이스에 등록되어 실시간 매핑된 전체 계정입니다.</p>
        </div>
        {isSuperAdmin && (
          <div className="flex gap-2 self-start sm:self-center">
            <button
              onClick={() => setIsSheetMode(true)}
              className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-md transition-colors shadow-sm flex items-center gap-1.5"
            >
              📊 웹 시트 형태로 보기
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors shadow-sm"
            >
              계정 추가
            </button>
          </div>
        )}
      </div>

      {/* Filtering & Search Toolbar */}
      <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
        {/* Row 1: Search */}
        <div>
          <input
            type="text"
            placeholder="이름, 학번 또는 이메일 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Row 2: Quick Preset Chips + OU Tree + Page Size */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Quick preset chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-400">빠른 선택:</span>
            <button
              onClick={() => setSelectedOUFilter("")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedOUFilter === ""
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
              }`}
            >
              전체
            </button>
            {teacherOU && (
              <button
                onClick={() => setSelectedOUFilter(teacherOU)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedOUFilter === teacherOU
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
                }`}
              >
                교직원
              </button>
            )}
            {Array.from({ length: gradesCount }).map((_, i) => {
              const grade = i + 1;
              const gradeOU = studentOUMappings[grade];
              if (!gradeOU) return null;
              return (
                <button
                  key={grade}
                  onClick={() => setSelectedOUFilter(gradeOU)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selectedOUFilter === gradeOU
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white text-green-700 border-green-300 hover:bg-green-50"
                  }`}
                >
                  {grade}학년
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* OU Tree Filter */}
            <div className="flex items-center gap-2 w-52">
              <span className="text-xs font-semibold text-gray-500 flex-shrink-0">조직단위 선택</span>
              <OUTreeSelector
                orgUnits={orgUnits}
                value={selectedOUFilter}
                onChange={handleOUFilterChange}
                placeholder="전체"
              />
            </div>

            {/* Items Per Page */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 flex-shrink-0">페이지당</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-md text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value={10}>10명</option>
                <option value={20}>20명</option>
                <option value={50}>50명</option>
                <option value={100}>100명</option>
                <option value={-1}>전체</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedUserEmails.size > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-900 my-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{selectedUserEmails.size}</span>개의 계정이 선택됨
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSheetMode(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors flex items-center gap-1"
            >
              📊 웹 시트 형태로 보기
            </button>
            <button
              onClick={() => handleBulkSuspend(true)}
              disabled={isSubmitting}
              className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
            >
              일시정지
            </button>
            <button
              onClick={() => handleBulkSuspend(false)}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
            >
              활성화
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
            >
              삭제
            </button>
            <button
              onClick={() => setSelectedUserEmails(new Set())}
              className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
            >
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* User Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {isSuperAdmin && (
                <th className="px-4 py-3 text-center w-10">
                  <input
                    type="checkbox"
                    checked={
                      paginatedUsers.length > 0 &&
                      paginatedUsers.every((u) => selectedUserEmails.has(u.primaryEmail))
                    }
                    onChange={toggleSelectAll}
                    className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
              )}
              <th
                onClick={() => handleSort("familyName")}
                className="px-6 py-3 text-left font-semibold text-gray-500 cursor-pointer select-none hover:bg-gray-100"
              >
                성(학번){getSortIndicator("familyName")}
              </th>
              <th
                onClick={() => handleSort("givenName")}
                className="px-6 py-3 text-left font-semibold text-gray-500 cursor-pointer select-none hover:bg-gray-100"
              >
                이름(성명){getSortIndicator("givenName")}
              </th>
              <th
                onClick={() => handleSort("primaryEmail")}
                className="px-6 py-3 text-left font-semibold text-gray-500 cursor-pointer select-none hover:bg-gray-100"
              >
                이메일{getSortIndicator("primaryEmail")}
              </th>
              <th
                onClick={() => handleSort("orgUnitPath")}
                className="px-6 py-3 text-left font-semibold text-gray-500 cursor-pointer select-none hover:bg-gray-100"
              >
                조직단위 (OU){getSortIndicator("orgUnitPath")}
              </th>
              {isSuperAdmin && <th className="px-6 py-3 text-right font-semibold text-gray-500 w-24">관리</th>}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 relative">
            {loading ? (
              // Skeleton loading rows
              Array.from({ length: itemsPerPage === -1 ? 10 : itemsPerPage }).map((_, idx) => (
                <tr key={`skeleton-${idx}`} className="animate-pulse">
                  {isSuperAdmin && (
                    <td className="px-4 py-4 text-center">
                      <div className="w-4 h-4 bg-gray-200 rounded mx-auto"></div>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="h-4 bg-gray-200 rounded w-8"></div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="h-4 bg-gray-200 rounded w-48"></div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                  </td>
                  {isSuperAdmin && (
                    <td className="px-6 py-4 text-right space-x-1.5">
                      <div className="inline-block h-6 bg-gray-200 rounded w-10"></div>
                      <div className="inline-block h-6 bg-gray-200 rounded w-10"></div>
                      <div className="inline-block h-6 bg-gray-200 rounded w-10"></div>
                    </td>
                  )}
                </tr>
              ))
            ) : paginatedUsers.length === 0 ? (
              <tr>
                <td colSpan={isSuperAdmin ? 6 : 4} className="px-6 py-12 text-center text-gray-400">
                  조건에 일치하는 사용자가 없습니다.
                </td>
              </tr>
            ) : (
              paginatedUsers.map((user) => (
                  <tr key={user.id} className={`hover:bg-gray-50/50 ${user.suspended ? "bg-red-50/20 opacity-80" : ""}`}>
                    {isSuperAdmin && (
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedUserEmails.has(user.primaryEmail)}
                          onChange={() => toggleUserSelection(user.primaryEmail)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 font-mono font-medium text-gray-800 whitespace-nowrap">
                      {user.name.familyName}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-800 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{user.name.givenName}</span>
                        {user.suspended && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                            일시정지됨
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 whitespace-nowrap font-mono">{user.primaryEmail}</td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap font-mono text-xs">{user.orgUnitPath}</td>
                    {isSuperAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-medium space-x-1.5">
                        <button
                          onClick={() => handleOpenEditModal(user)}
                          className="text-indigo-600 hover:text-indigo-900 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100/50 px-2.5 py-1 rounded transition-colors"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleToggleSuspendSingle(user)}
                          className={`${
                            user.suspended
                              ? "text-green-600 hover:text-green-900 border border-green-200 hover:border-green-300 bg-green-50 hover:bg-green-100/50"
                              : "text-amber-600 hover:text-amber-900 border border-amber-200 hover:border-amber-300 bg-amber-50 hover:bg-amber-100/50"
                          } px-2.5 py-1 rounded transition-colors`}
                        >
                          {user.suspended ? "해제" : "정지"}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.primaryEmail, `${user.name.familyName}${user.name.givenName}`)}
                          className="text-red-600 hover:text-red-900 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100/50 px-2.5 py-1 rounded transition-colors"
                        >
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Floating dynamic loading overlay for user updates */}
      {loading && orgUnits.length > 0 && (
        <div className="flex items-center justify-center gap-3 bg-indigo-50/70 border border-indigo-100 rounded-lg p-3 text-sm text-indigo-900 mt-2 animate-pulse">
          <div className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-700 rounded-full animate-spin"></div>
          <span>Google Workspace 실시간 데이터 갱신 중...</span>
        </div>
      )}

      {/* Pagination Controls */}
      {processedUsers.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-500 text-center sm:text-left">
            {itemsPerPage === -1 ? (
              <>
                총 <span className="font-semibold text-gray-900">{processedUsers.length}</span>명 표시 (전체)
              </>
            ) : (
              <>
                총 <span className="font-semibold text-gray-900">{processedUsers.length}</span>명 중{" "}
                <span className="font-semibold text-gray-900">
                  {Math.min(processedUsers.length, (currentPage - 1) * itemsPerPage + 1)}-
                  {Math.min(processedUsers.length, currentPage * itemsPerPage)}
                </span>
                명 표시
              </>
            )}
          </div>

          {itemsPerPage !== -1 && (
            <div className="flex justify-center gap-1.5 text-sm">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-800 font-bold hover:text-black shadow-sm disabled:opacity-30 disabled:text-gray-400 disabled:bg-gray-100/50 disabled:cursor-not-allowed transition-colors"
              >
                이전
              </button>
              
              {pageNumbers.map((pageNum, i) => {
                if (pageNum === "...") {
                  return (
                    <span key={`dots-${i}`} className="px-3 py-1.5 text-gray-400 font-medium select-none flex items-center">
                      ...
                    </span>
                  );
                }
                const isCurrent = currentPage === pageNum;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum as number)}
                    className={`px-3 py-1.5 border rounded-md transition-colors font-medium shadow-sm ${
                      isCurrent
                        ? "bg-indigo-600 text-white border-indigo-600 font-bold cursor-default"
                        : "border-gray-300 bg-white hover:bg-gray-50 text-gray-700 hover:text-black"
                    }`}
                    disabled={isCurrent}
                  >
                    {pageNum}
                  </button>
                );
              })}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-800 font-bold hover:text-black shadow-sm disabled:opacity-30 disabled:text-gray-400 disabled:bg-gray-100/50 disabled:cursor-not-allowed transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">새 구글 워크스페이스 계정 추가</h3>
              <p className="text-xs text-gray-500 mt-0.5">학생 뱸크 업로드를 제외한 일반 단일 계정 생성입니다.</p>
            </div>

            <form onSubmit={handleAddUser} className="p-6 space-y-4">
              {/* Name Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    성 <span className="text-xs font-normal text-gray-400">(Family Name)</span>
                  </label>
                  <input
                    type="text"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    placeholder="예: 홍"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    이름 <span className="text-xs font-normal text-gray-400">(Given Name)</span>
                  </label>
                  <input
                    type="text"
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    placeholder="예: 길동"
                    required
                  />
                </div>
              </div>

              {/* Google ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  구글 아이디 <span className="text-red-500">*</span>
                </label>
                <div className="flex rounded-md shadow-sm">
                  <input
                    type="text"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value.replace(/\s/g, "").toLowerCase())}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 font-mono"
                    placeholder="예: gdhong"
                    required
                  />
                  <span className="inline-flex items-center px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 text-sm font-mono">
                    @{domain}
                  </span>
                </div>
              </div>

              {/* OU Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  조직단위 (OU) <span className="text-red-500">*</span>
                </label>
                <OUTreeSelector
                  orgUnits={orgUnits}
                  value={newOUPath}
                  onChange={setNewOUPath}
                  placeholder="-- 조직단위를 선택하세요 --"
                />
                {newOUPath && (
                  <p className="mt-1 text-xs text-indigo-600 font-mono">{newOUPath}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  비밀번호 <span className="text-red-500">*</span>
                  <span className="ml-1 text-xs font-normal text-gray-400">(8자 이상)</span>
                </label>
                <div className="flex rounded-md shadow-sm">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 font-mono"
                    placeholder="최소 8자"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 hover:bg-gray-100 text-gray-500 text-xs transition-colors"
                  >
                    {showPassword ? "감추기" : "보기"}
                  </button>
                </div>
              </div>

              {/* Change Password at Next Sign-In */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newChangePasswordAtNextLogin}
                    onChange={(e) => setNewChangePasswordAtNextLogin(e.target.checked)}
                    className="mt-0.5 rounded text-amber-500 focus:ring-amber-400 flex-shrink-0"
                  />
                  <div>
                    <span className="text-sm font-medium text-amber-900">Change Password at Next Sign-In</span>
                    <p className="text-xs text-amber-700 mt-0.5">
                      체크하면 사용자가 다음 로그인 시 비밀번호를 반드시 변경해야 합니다.
                      체크 해제 시 관리자가 설정한 비밀번호가 계속 유지됩니다.
                    </p>
                  </div>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewEmail(""); setNewFirstName(""); setNewLastName("");
                    setNewOUPath(""); setNewPassword(""); setNewChangePasswordAtNextLogin(true);
                  }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newOUPath}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors"
                >
                  {isSubmitting ? "생성 중..." : "계정 생성"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-gray-900">구글 워크스페이스 계정 수정 및 관리</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editingUser.primaryEmail}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                editSuspended
                  ? "bg-red-100 text-red-800 border border-red-200"
                  : "bg-green-100 text-green-800 border border-green-200"
              }`}>
                {editSuspended ? "일시정지됨" : "사용 중(활성)"}
              </span>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              {/* Name Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    성 <span className="text-xs font-normal text-gray-400">(Family Name)</span>
                  </label>
                  <input
                    type="text"
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    이름 <span className="text-xs font-normal text-gray-400">(Given Name)</span>
                  </label>
                  <input
                    type="text"
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    required
                  />
                </div>
              </div>

              {/* Google ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  구글 아이디 <span className="text-red-500">*</span>
                </label>
                <div className="flex rounded-md shadow-sm">
                  <input
                    type="text"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value.replace(/\s/g, "").toLowerCase())}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 font-mono"
                    required
                  />
                  <span className="inline-flex items-center px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 text-sm font-mono">
                    @{domain}
                  </span>
                </div>
              </div>

              {/* OU Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  조직단위 (OU) <span className="text-red-500">*</span>
                </label>
                <OUTreeSelector
                  orgUnits={orgUnits}
                  value={editOUPath}
                  onChange={setEditOUPath}
                  placeholder="-- 조직단위를 선택하세요 --"
                />
                {editOUPath && (
                  <p className="mt-1 text-xs text-indigo-600 font-mono">{editOUPath}</p>
                )}
              </div>

              {/* Account Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">계정 상태</label>
                <div className="flex items-center space-x-4 bg-gray-50 p-2.5 rounded border border-gray-200">
                  <label className="flex items-center text-sm text-gray-800 cursor-pointer font-medium">
                    <input
                      type="radio"
                      checked={!editSuspended}
                      onChange={() => setEditSuspended(false)}
                      className="mr-2 text-indigo-600 focus:ring-indigo-500"
                    />
                    사용 가능 (활성)
                  </label>
                  <label className="flex items-center text-sm text-gray-800 cursor-pointer font-medium">
                    <input
                      type="radio"
                      checked={editSuspended}
                      onChange={() => setEditSuspended(true)}
                      className="mr-2 text-red-600 focus:ring-red-500"
                    />
                    일시 정지
                  </label>
                </div>
              </div>

              {/* Email Aliases Management */}
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    이메일 별칭 (Email Aliases)
                  </label>
                  <span className="text-[10px] text-amber-600 font-semibold">
                    * 별칭 추가/삭제는 즉시 Google에 반영됩니다.
                  </span>
                </div>
                
                {/* List of existing aliases */}
                <div className="space-y-1.5 mb-2 max-h-24 overflow-y-auto">
                  {!editingUser.aliases || editingUser.aliases.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">등록된 이메일 별칭이 없습니다.</p>
                  ) : (
                    editingUser.aliases.map((aliasEmail) => (
                      <div
                        key={aliasEmail}
                        className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-2.5 py-1 text-xs text-gray-700 font-mono"
                      >
                        <span>{aliasEmail}</span>
                        <button
                          type="button"
                          disabled={aliasSubmitting}
                          onClick={() => handleDeleteAlias(aliasEmail)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded font-sans transition-colors"
                          title="별칭 삭제"
                        >
                          삭제
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add new alias input */}
                <div className="flex gap-2">
                  <div className="flex-1 flex rounded-md shadow-sm">
                    <input
                      type="text"
                      value={newAliasPrefix}
                      onChange={(e) => setNewAliasPrefix(e.target.value.replace(/\s/g, "").toLowerCase())}
                      className="flex-1 min-w-0 px-3 py-1.5 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-gray-900 font-mono"
                      placeholder="새 별칭 아이디 입력"
                      disabled={aliasSubmitting}
                    />
                    <span className="inline-flex items-center px-2.5 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 text-[10px] font-mono select-none">
                      @{domain}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddAlias}
                    disabled={aliasSubmitting || !newAliasPrefix.trim()}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    추가
                  </button>
                </div>
              </div>

              {/* Password change (optional) */}
              <div className="border-t border-gray-100 pt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  비밀번호 변경 <span className="text-xs font-normal text-gray-400">(변경하려는 경우에만 입력)</span>
                </label>
                <div className="flex rounded-md shadow-sm">
                  <input
                    type={showEditPassword ? "text" : "password"}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 font-mono"
                    placeholder="변경하려면 최소 8자 입력"
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword((v) => !v)}
                    className="px-3 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 hover:bg-gray-100 text-gray-500 text-xs transition-colors"
                  >
                    {showEditPassword ? "감추기" : "보기"}
                  </button>
                </div>
              </div>

              {/* Change Password at Next Sign-In (only if password is typed) */}
              {editPassword && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editChangePasswordAtNextLogin}
                      onChange={(e) => setEditChangePasswordAtNextLogin(e.target.checked)}
                      className="mt-0.5 rounded text-amber-500 focus:ring-amber-400 flex-shrink-0"
                    />
                    <div>
                      <span className="text-sm font-medium text-amber-900">Change Password at Next Sign-In</span>
                      <p className="text-xs text-amber-700 mt-0.5">
                        체크하면 사용자가 다음 로그인 시 비밀번호를 반드시 변경해야 합니다.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingUser(null);
                    setEditPassword("");
                  }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors"
                >
                  {isSubmitting ? "저장 중..." : "변경사항 저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
