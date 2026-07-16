"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { getClientCache } from "@/lib/cache/clientCache";

interface SearchedStudent {
  primaryEmail: string;
  name: {
    familyName: string;
    givenName: string;
  };
  orgUnitPath: string;
}

export default function PasswordReset() {
  const { userData } = useAuth();
  const [searchValue, setSearchValue] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<SearchedStudent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successResult, setSuccessResult] = useState<{
    email: string;
    name: string;
    tempPassword?: string;
  } | null>(null);

  const domain = userData?.domain || "";

  const handleSelectStudent = (email: string, name?: string) => {
    // AutocompleteInput calls onSelect(email, name)
    // Find the student details from local cache if possible, or build basic object
    const cachedUsers: any[] = getClientCache("users:all") || [];
    const u = cachedUsers.find((user) => user.primaryEmail === email);

    if (u) {
      setSelectedStudent({
        primaryEmail: u.primaryEmail,
        name: u.name || { familyName: "", givenName: "" },
        orgUnitPath: u.orgUnitPath || "/",
      });
    } else {
      // Parse familyName and givenName from name if "Family Given" or split
      const nameParts = (name || "").split(" ");
      const lastName = nameParts[0] || "";
      const firstName = nameParts.slice(1).join(" ") || "";
      setSelectedStudent({
        primaryEmail: email,
        name: { familyName: lastName, givenName: firstName },
        orgUnitPath: "/",
      });
    }
    setSuccessResult(null);
    setError("");
  };

  const handleResetPassword = async () => {
    if (!selectedStudent) return;
    const studentName = `${selectedStudent.name.familyName}${selectedStudent.name.givenName}`;
    
    if (
      !confirm(
        `정말로 ${studentName} (${selectedStudent.primaryEmail}) 학생의 비밀번호를 초기화하시겠습니까?`
      )
    ) {
      return;
    }

    setLoading(true);
    setError("");
    setSuccessResult(null);

    try {
      const cachedUsers: any[] = getClientCache("users:all") || [];
      const opUser = cachedUsers.find((u: any) => u.primaryEmail === userData?.email);
      const opName = opUser 
        ? `${opUser.name?.familyName || ""}${opUser.name?.givenName || ""}` 
        : "교사";

      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_password",
          email: selectedStudent.primaryEmail,
          operatorEmail: userData?.email,
          operatorName: opName,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessResult({
          email: selectedStudent.primaryEmail,
          name: studentName,
          tempPassword: data.tempPassword || "1234abcd!!!!",
        });
        setSelectedStudent(null);
        setSearchValue("");
      } else {
        throw new Error(data.error || "비밀번호 초기화 처리에 실패했습니다.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("임시 비밀번호가 클립보드에 복사되었습니다.");
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-gray-900">학생 계정 비밀번호 초기화</h2>
        <p className="text-gray-500 text-xs mt-1">
          담임 또는 교과 교사가 학생의 비밀번호 분실 시 신속하게 임시 비밀번호로 재설정합니다.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {/* 1. Search Box */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">대상 학생 검색</label>
        <AutocompleteInput
          value={searchValue}
          onChange={setSearchValue}
          onSelect={handleSelectStudent}
          placeholder="학생 이름(성+이름) 또는 이메일 검색..."
          type="user"
          domain={domain}
        />
      </div>

      {/* 2. Selected Student Card */}
      {selectedStudent && (
        <div className="bg-indigo-50/40 rounded-xl border border-indigo-100 p-5 space-y-4 animate-fadeIn">
          <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">선택된 대상 학생 정보</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400 block text-xs">학번 / 이름</span>
              <strong className="text-gray-900 text-base">
                {selectedStudent.name.familyName} {selectedStudent.name.givenName}
              </strong>
            </div>
            <div>
              <span className="text-gray-400 block text-xs">구글 이메일</span>
              <span className="font-mono text-gray-700">{selectedStudent.primaryEmail}</span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-gray-400 block text-xs">조직단위(OU)</span>
              <span className="text-gray-600 font-medium">{selectedStudent.orgUnitPath}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetPassword}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>초기화 진행 중...</span>
              </>
            ) : (
              <span>⚡ 비밀번호를 1234abcd!!!! 로 즉시 초기화</span>
            )}
          </button>
        </div>
      )}

      {/* 3. Reset Success Result */}
      {successResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4 animate-fadeIn">
          <h3 className="text-sm font-bold text-green-800 border-b border-green-200 pb-2 flex items-center gap-1.5">
            <span>🎉 비밀번호 초기화 완료</span>
          </h3>

          <div className="space-y-3.5 text-sm text-gray-700">
            <div>
              <span className="text-gray-500 block text-xs">대상 학생</span>
              <strong className="text-gray-900">{successResult.name} ({successResult.email})</strong>
            </div>
            
            <div className="bg-white border border-green-100 rounded-lg p-3 flex justify-between items-center">
              <div>
                <span className="text-gray-400 block text-[10px]">설정된 임시 비밀번호</span>
                <strong className="text-lg font-mono text-indigo-600 tracking-wider">
                  {successResult.tempPassword}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => handleCopyToClipboard(successResult.tempPassword || "")}
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
              >
                📋 복사하기
              </button>
            </div>

            <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200/50 space-y-1">
              <p className="font-bold">⚠️ 학생 유의사항:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>학생이 최초 로그인할 때 비밀번호를 의무적으로 직접 재설정해야 합니다.</li>
                <li>위 비밀번호를 학생에게 구두 혹은 개인 메신저로 즉시 전달해 주세요.</li>
              </ul>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSuccessResult(null)}
            className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold text-xs py-2 rounded-md transition-colors"
          >
            확인 (다른 학생 초기화하기)
          </button>
        </div>
      )}
    </div>
  );
}
