"use client";

import { useState, useEffect } from "react";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import { useAuth } from "@/context/AuthContext";

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

interface SheetRow {
  id: string;
  isNew: boolean;
  isModified: boolean;
  originalEmail?: string;
  familyName: string;
  givenName: string;
  emailPrefix: string;
  orgUnitPath: string;
  password?: string;
  changePasswordAtNextLogin: boolean;
  suspended: boolean;
  error?: string;
}

interface UserSheetEditorProps {
  users: GoogleUser[];
  orgUnits: { orgUnitId: string; orgUnitPath: string; name: string }[];
  domain: string;
  onSave: () => void;
  onCancel: () => void;
}

export default function UserSheetEditor({
  users,
  orgUnits,
  domain,
  onSave,
  onCancel,
}: UserSheetEditorProps) {
  const { user, userData } = useAuth();
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize sheet rows from props
  useEffect(() => {
    const initialRows: SheetRow[] = users.map((u) => ({
      id: u.id,
      isNew: false,
      isModified: false,
      originalEmail: u.primaryEmail,
      familyName: u.name.familyName || "",
      givenName: u.name.givenName || "",
      emailPrefix: u.primaryEmail.split("@")[0] || "",
      orgUnitPath: u.orgUnitPath || "/",
      password: "", // Optional for existing users
      changePasswordAtNextLogin: false,
      suspended: !!u.suspended,
    }));
    setRows(initialRows);
  }, [users]);

  // Add new empty rows for bulk creation
  const handleAddRow = () => {
    const input = prompt("추가할 계정 행(Row)의 개수를 입력해 주세요. (예: 10 또는 100)", "1");
    if (input === null) return; // cancel click
    
    let count = parseInt(input.trim(), 10);
    if (isNaN(count) || count <= 0) {
      alert("유효한 숫자를 입력해 주세요.");
      return;
    }
    
    if (count > 300) {
      if (!confirm("한 번에 300개 이상의 행을 추가하면 브라우저가 느려질 수 있습니다. 그래도 진행하시겠습니까?")) {
        return;
      }
    }

    const defaultOU = orgUnits.length > 0 ? orgUnits[0].orgUnitPath : "/";
    const newRows: SheetRow[] = Array.from({ length: count }).map(() => ({
      id: `new_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}`,
      isNew: true,
      isModified: false,
      familyName: "",
      givenName: "",
      emailPrefix: "",
      orgUnitPath: defaultOU,
      password: "",
      changePasswordAtNextLogin: true,
      suspended: false,
    }));
    setRows((prev) => [...prev, ...newRows]);
  };

  // Remove a row (temporary added rows can be deleted instantly, existing users are locked)
  const handleRemoveRow = (id: string, index: number) => {
    const row = rows[index];
    if (row.isNew) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
  };

  // Update a specific cell
  const handleCellChange = (index: number, field: keyof SheetRow, value: any) => {
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      (row as any)[field] = value;
      row.isModified = !row.isNew; // mark modified if it's an existing record
      
      // Perform inline validation
      validateRow(row);
      
      next[index] = row;
      return next;
    });
  };

  // Row validation helper
  const validateRow = (row: SheetRow) => {
    row.error = undefined;
    if (!row.familyName.trim() || !row.givenName.trim()) {
      row.error = "성 및 이름은 필수입니다.";
      return;
    }
    if (!row.emailPrefix.trim()) {
      row.error = "이메일 아이디는 필수입니다.";
      return;
    }
    if (row.isNew && (!row.password || row.password.length < 8)) {
      row.error = "새 계정은 8자 이상의 비밀번호가 필수입니다.";
      return;
    }
    if (row.password && row.password.length > 0 && row.password.length < 8) {
      row.error = "비밀번호는 최소 8자 이상이어야 합니다.";
      return;
    }
  };

  // Fill Down: Copies the target cell value down to all rows below it
  const handleFillDownFrom = (startIndex: number, field: keyof SheetRow) => {
    if (rows.length <= startIndex + 1) return;
    const baseValue = rows[startIndex][field];

    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx <= startIndex) return row;
        const updatedRow = {
          ...row,
          [field]: baseValue,
          isModified: !row.isNew,
        };
        validateRow(updatedRow);
        return updatedRow;
      })
    );
  };

  // Auto-increment: Increments numeric suffixes in a text column starting from the target row down
  const handleAutoIncrementFrom = (startIndex: number, field: keyof SheetRow) => {
    if (rows.length <= startIndex + 1) return;
    const baseValue = String(rows[startIndex][field] || "");
    
    // Find the trailing number group
    const match = baseValue.match(/(\d+)$/);
    if (!match) {
      alert("기준 셀의 값에 숫자가 포함되어 있어야 순차 채우기가 가능합니다. (예: 25001)");
      return;
    }

    const baseNumberStr = match[1];
    const baseNumber = parseInt(baseNumberStr, 10);
    const prefix = baseValue.substring(0, baseValue.length - baseNumberStr.length);
    const padLength = baseNumberStr.length;

    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx <= startIndex) return row;
        
        // Calculate incremental value based on offset from startIndex
        const offset = idx - startIndex;
        const currentNum = baseNumber + offset;
        const paddedNum = String(currentNum).padStart(padLength, "0");
        const incrementalValue = `${prefix}${paddedNum}`;

        const updatedRow = {
          ...row,
          [field]: field === "suspended" || field === "changePasswordAtNextLogin" || field === "isNew" || field === "isModified" ? row[field] : incrementalValue,
          isModified: !row.isNew,
        };
        validateRow(updatedRow);
        return updatedRow;
      })
    );
  };

  // Save changes by separating modifications & additions and sending to batch API
  const handleSaveChanges = async () => {
    // Filter out completely empty new rows silently to avoid validation errors
    const activeRows = rows.filter((r) => {
      if (r.isNew) {
        const isCompletelyEmpty =
          !r.familyName.trim() &&
          !r.givenName.trim() &&
          !r.emailPrefix.trim() &&
          !r.password?.trim();
        return !isCompletelyEmpty;
      }
      return true; // Keep all existing users
    });

    // Recheck validations only for non-empty active rows
    const validatedRows = activeRows.map((r) => {
      const copy = { ...r };
      validateRow(copy);
      return copy;
    });

    const hasErrors = validatedRows.some((r) => r.error);
    if (hasErrors) {
      // Sync errors back to screen rows
      setRows((prev) =>
        prev.map((originalRow) => {
          const matchingValidated = validatedRows.find((v) => v.id === originalRow.id);
          if (matchingValidated) {
            return matchingValidated;
          }
          return originalRow;
        })
      );
      alert("시트에 입력 에러가 표시되어 있습니다. 빨간색 테두리와 에러 안내를 확인하고 수정해 주세요.");
      return;
    }

    const creates = validatedRows
      .filter((r) => r.isNew)
      .map((r) => ({
        email: `${r.emailPrefix.trim()}@${domain}`,
        firstName: r.givenName.trim(),
        lastName: r.familyName.trim(),
        orgUnitPath: r.orgUnitPath,
        password: r.password,
        changePasswordAtNextLogin: r.changePasswordAtNextLogin,
      }));

    const updates = validatedRows
      .filter((r) => !r.isNew && (r.isModified || `${r.emailPrefix.trim()}@${domain}` !== r.originalEmail || r.password));

    // Map updates structure
    const mappedUpdates = updates.map((r) => {
      const updatePayload: any = {
        firstName: r.givenName.trim(),
        lastName: r.familyName.trim(),
        orgUnitPath: r.orgUnitPath,
        suspended: r.suspended,
      };
      if (r.password && r.password.trim().length >= 8) {
        updatePayload.password = r.password.trim();
        updatePayload.changePasswordAtNextLogin = r.changePasswordAtNextLogin;
      }
      const newEmail = `${r.emailPrefix.trim()}@${domain}`;
      if (newEmail !== r.originalEmail) {
        updatePayload.primaryEmail = newEmail;
      }
      return {
        email: r.originalEmail!,
        updates: updatePayload,
      };
    });

    if (creates.length === 0 && mappedUpdates.length === 0) {
      alert("수정되거나 새로 추가된 계정이 없습니다.");
      return;
    }

    if (
      !confirm(
        `변경사항을 구글 워크스페이스에 저장하시겠습니까?\n- 신규 생성: ${creates.length}건\n- 기존 수정: ${mappedUpdates.length}건`
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_save",
          creates,
          updates: mappedUpdates,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });

      const data = await res.json();
      if (res.ok) {
        if (data.createFailures?.length > 0 || data.updateFailures?.length > 0) {
          const createErrMsgs = (data.createFailures || []).map((f: any) => `[생성실패] ${f.email}: ${f.reason}`).join("\n");
          const updateErrMsgs = (data.updateFailures || []).map((f: any) => `[수정실패] ${f.email}: ${f.reason}`).join("\n");
          alert(`일부 저장 처리 실패:\n${createErrMsgs}\n${updateErrMsgs}`);
        } else {
          alert("모든 변경사항이 구글 워크스페이스에 실시간으로 성공 반영되었습니다!");
        }
        onSave();
      } else {
        throw new Error(data.error || "일괄 저장에 실패했습니다.");
      }
    } catch (err: any) {
      console.error(err);
      alert(`에러 발생: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Warning when leaving with unsaved changes
  const handleCancelWithWarning = () => {
    const hasUnsavedChanges = rows.some(
      (r) => r.isNew || r.isModified || (r.password && r.password.trim().length > 0)
    );
    if (hasUnsavedChanges) {
      if (
        !confirm(
          "저장하지 않은 변경사항이 있습니다. 정말로 일반 뷰로 전환하시겠습니까?\n(작성 중이거나 수정한 내용은 저장되지 않고 소실됩니다.)"
        )
      ) {
        return;
      }
    }
    onCancel();
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Spreadsheet Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            📊 웹 시트 일괄 편집기
          </h3>
          <p className="text-xs text-slate-500">
            성과 이름, 아이디, 비밀번호 등을 표 형식으로 한 번에 수정한 뒤 일괄 저장할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAddRow}
            disabled={isSubmitting}
            className="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            ➕ 행 추가 (새 계정 작성)
          </button>
          
          <button
            type="button"
            onClick={handleCancelWithWarning}
            disabled={isSubmitting}
            className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            일반 뷰로 전환
          </button>

          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={isSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-md transition-colors shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? "일괄 저장 중..." : "💾 변경사항 저장"}
          </button>
        </div>
      </div>

      {/* Spreadsheet Sheet Grid Container */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[500px]">
        <table className="min-w-full divide-y divide-slate-200 text-xs border-collapse">
          {/* Sheet Column Headers */}
          <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-center text-slate-500 w-12 select-none font-bold border-r border-slate-200">No</th>
              
              {/* Family Name */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-24 border-r border-slate-200">
                <span>성 (Family)*</span>
              </th>

              {/* Given Name */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-32 border-r border-slate-200">
                <span>이름 (Given)*</span>
              </th>

              {/* Google ID Prefix */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-64 border-r border-slate-200">
                <span>구글 아이디 (ID)*</span>
              </th>

              {/* Org Unit Path */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-52 border-r border-slate-200">
                <span>조직단위 (OU)*</span>
              </th>

              {/* Password */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-44 border-r border-slate-200">
                <span>비밀번호 (8자 이상)</span>
              </th>

              {/* Change Password checkbox */}
              <th
                className="px-3 py-2 text-center font-semibold text-slate-700 w-28 border-r border-slate-200 cursor-help"
                title="최초 로그인 시 비밀번호를 변경하도록 안내합니다"
              >
                <div className="flex flex-col gap-1 items-center">
                  <span>비번 변경 안내 ℹ️</span>
                  <button
                    type="button"
                    onClick={() => handleFillDownFrom(0, "changePasswordAtNextLogin")}
                    className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium px-1.5 py-0.5 rounded text-center transition-colors"
                    title="첫 번째 행 체크 상태를 아래로 복사"
                  >
                    아래로 복사
                  </button>
                </div>
              </th>

              {/* Suspend status */}
              <th className="px-3 py-2 text-center font-semibold text-slate-700 w-24 border-r border-slate-200">
                <div className="flex flex-col gap-1 items-center">
                  <span>계정 정지</span>
                  <button
                    type="button"
                    onClick={() => handleFillDownFrom(0, "suspended")}
                    className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium px-1.5 py-0.5 rounded text-center transition-colors"
                    title="첫 번째 행의 정지 여부를 아래로 복사"
                  >
                    아래로 복사
                  </button>
                </div>
              </th>

              <th className="px-3 py-3 text-center text-slate-500 w-16">삭제</th>
            </tr>
          </thead>

          {/* Sheet Cells Body */}
          <tbody className="bg-white divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                  표시할 데이터가 없습니다. 상단의 <strong>[행 추가]</strong>를 눌러 신규 계정을 등록해 보세요.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const hasError = !!row.error;
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-50/50 ${
                      row.isNew ? "bg-emerald-50/30" : row.isModified ? "bg-sky-50/30" : ""
                    } ${hasError ? "bg-red-50/20" : ""}`}
                  >
                    {/* No / Status Column */}
                    <td className="px-2 py-1 text-center font-mono text-slate-400 select-none border-r border-slate-100">
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{index + 1}</span>
                        {row.isNew ? (
                          <span className="px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded-[3px] text-[8px] font-bold">New</span>
                        ) : row.isModified ? (
                          <span className="px-1 py-0.2 bg-sky-100 text-sky-800 rounded-[3px] text-[8px] font-bold">Edit</span>
                        ) : null}
                      </div>
                    </td>

                    {/* Family Name */}
                    <td className="p-1 border-r border-slate-100 relative group">
                      <input
                        type="text"
                        value={row.familyName}
                        onChange={(e) => handleCellChange(index, "familyName", e.target.value)}
                        placeholder="성"
                        className={`w-full px-2 py-1 pr-14 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
                          hasError && !row.familyName.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
                        }`}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white/95 border border-slate-200 shadow-md rounded-md px-1.5 py-0.5 z-20">
                        <button
                          type="button"
                          onClick={() => handleFillDownFrom(index, "familyName")}
                          className="text-[9px] text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 font-bold px-1 py-0.5 rounded transition-all"
                          title="이 행의 성 값을 아래 행들에 모두 복사"
                        >
                          ▼ 복사
                        </button>
                      </div>
                    </td>

                    {/* Given Name */}
                    <td className="p-1 border-r border-slate-100 relative group">
                      <input
                        type="text"
                        value={row.givenName}
                        onChange={(e) => handleCellChange(index, "givenName", e.target.value)}
                        placeholder="이름"
                        className={`w-full px-2 py-1 pr-14 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
                          hasError && !row.givenName.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
                        }`}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white/95 border border-slate-200 shadow-md rounded-md px-1.5 py-0.5 z-20">
                        <button
                          type="button"
                          onClick={() => handleFillDownFrom(index, "givenName")}
                          className="text-[9px] text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 font-bold px-1 py-0.5 rounded transition-all"
                          title="이 행의 이름 값을 아래 행들에 모두 복사"
                        >
                          ▼ 복사
                        </button>
                      </div>
                    </td>

                    {/* Google ID Prefix */}
                    <td className="p-1 border-r border-slate-100 relative group">
                      <div className="flex items-center">
                        <input
                          type="text"
                          value={row.emailPrefix}
                          onChange={(e) => handleCellChange(index, "emailPrefix", e.target.value.replace(/\s/g, "").toLowerCase())}
                          placeholder="아이디"
                          className={`flex-1 min-w-0 px-2 py-1 text-xs border rounded-l focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 font-mono ${
                            hasError && !row.emailPrefix.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
                          }`}
                        />
                        <span className="px-2 py-1 text-[10px] text-slate-500 border border-l-0 border-slate-200 bg-slate-50 rounded-r font-mono select-none">
                          @{domain}
                        </span>
                      </div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white/95 border border-slate-200 shadow-md rounded-md px-1.5 py-0.5 z-20">
                        <button
                          type="button"
                          onClick={() => handleFillDownFrom(index, "emailPrefix")}
                          className="text-[9px] text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 font-bold px-1.5 py-0.5 rounded transition-all"
                          title="이 행의 아이디 값을 아래 행들에 모두 복사"
                        >
                          ▼ 복사
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAutoIncrementFrom(index, "emailPrefix")}
                          className="text-[9px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-bold px-1.5 py-0.5 rounded transition-all border border-indigo-100"
                          title="이 행의 아이디 숫자 패턴 기준 순차 채우기 (예: 25001 -> 25002)"
                        >
                          ⚡ 채우기
                        </button>
                      </div>
                    </td>

                    {/* Org Unit Path */}
                    <td className="p-1 border-r border-slate-100 w-52 relative group">
                      <select
                        value={row.orgUnitPath}
                        onChange={(e) => handleCellChange(index, "orgUnitPath", e.target.value)}
                        className="w-full px-1.5 py-1 pr-8 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 bg-white"
                      >
                        <option value="/">/</option>
                        {orgUnits.map((ou) => (
                          <option key={ou.orgUnitId} value={ou.orgUnitPath}>
                            {ou.orgUnitPath}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white/95 border border-slate-200 shadow-md rounded-md px-1.5 py-0.5 z-20">
                        <button
                          type="button"
                          onClick={() => handleFillDownFrom(index, "orgUnitPath")}
                          className="text-[9px] text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 font-bold px-1.5 py-0.5 rounded transition-all"
                          title="이 행의 조직단위를 아래 행들에 모두 복사"
                        >
                          ▼ 복사
                        </button>
                      </div>
                    </td>

                    {/* Password */}
                    <td className="p-1 border-r border-slate-100 relative group">
                      <input
                        type="text"
                        value={row.password || ""}
                        onChange={(e) => handleCellChange(index, "password", e.target.value)}
                        placeholder={row.isNew ? "임시비밀번호" : "(변경 시 입력)"}
                        className={`w-full px-2 py-1 pr-10 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 font-mono ${
                          hasError && row.isNew && (!row.password || row.password.length < 8) ? "border-red-400 bg-red-50/50" : "border-slate-200"
                        }`}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white/95 border border-slate-200 shadow-md rounded-md px-1.5 py-0.5 z-20">
                        <button
                          type="button"
                          onClick={() => handleFillDownFrom(index, "password")}
                          className="text-[9px] text-indigo-600 hover:text-indigo-800 hover:bg-slate-100 font-bold px-1.5 py-0.5 rounded transition-all"
                          title="이 행의 비밀번호를 아래 행들에 모두 복사"
                        >
                          ▼ 복사
                        </button>
                      </div>
                    </td>

                    {/* Change Password next sign in */}
                    <td className="p-1 text-center border-r border-slate-100">
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={row.changePasswordAtNextLogin}
                          onChange={(e) => handleCellChange(index, "changePasswordAtNextLogin", e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                        />
                      </div>
                    </td>

                    {/* Suspend status */}
                    <td className="p-1 text-center border-r border-slate-100">
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={row.suspended}
                          onChange={(e) => handleCellChange(index, "suspended", e.target.checked)}
                          className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5 cursor-pointer"
                        />
                      </div>
                    </td>

                    {/* Delete row */}
                    <td className="p-1 text-center">
                      {row.isNew ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id, index)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded text-[10px] font-semibold"
                        >
                          삭제
                        </button>
                      ) : (
                        <span className="text-slate-300 select-none">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row Error / Status info */}
      {rows.some((r) => r.error) && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-800 text-xs">
          ⚠️ <strong>일부 셀에 입력 에러가 발견되었습니다:</strong>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {rows
              .filter((r) => r.error)
              .map((r, i) => (
                <li key={i}>
                  {i + 1}행 ({r.familyName}{r.givenName || "이름없음"}): {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
