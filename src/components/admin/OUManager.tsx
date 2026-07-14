"use client";

import { useEffect, useState } from "react";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import OUTreeManager from "@/components/admin/OUTreeManager";

interface OU {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

export default function OUManager() {
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OU[]>([]);
  
  // New OU Form State
  const [newOUName, setNewOUName] = useState("");
  const [newOUParent, setNewOUParent] = useState("/");
  const [creatingOU, setCreatingOU] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/ou");
      const data = await res.json();
      if (res.ok) {
        setOrgUnits(data.orgUnits);
        setIsMock(data.isMock);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error("Failed to load OUs", error);
      alert("조직도 데이터를 불러오는 데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateOU = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOUName) return;
    setCreatingOU(true);
    try {
      const res = await fetch("/api/workspace/ou", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newOUName,
          parentOrgUnitPath: newOUParent,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`조직단위 '${newOUName}'이(가) 성공적으로 생성되었습니다.`);
        setNewOUName("");
        loadData();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error("Failed to create OU", error);
      alert(`조직단위 생성 실패: ${error.message}`);
    } finally {
      setCreatingOU(false);
    }
  };

  const handleRenameOU = async (orgUnitPath: string, newName: string) => {
    try {
      const res = await fetch("/api/workspace/ou", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgUnitPath, newName }),
      });
      const data = await res.json();
      if (res.ok) {
        loadData();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      alert(`이름 변경 실패: ${error.message}`);
      throw error;
    }
  };

  const handleDeleteOU = async (orgUnitPath: string) => {
    try {
      const res = await fetch("/api/workspace/ou", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgUnitPath }),
      });
      const data = await res.json();
      if (res.ok) {
        loadData();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      alert(`삭제 실패: ${error.message}`);
    }
  };

  if (loading) {
    return <p className="text-gray-500 text-center py-4">조직도 정보를 불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      {isMock && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md p-4 mb-4 text-sm">
          💡 <strong>안내:</strong> 현재 구글 워크스페이스 연동 변수(GCP Credentials)가 설정되지 않아 <strong>가짜 데이터 모드(Mock Mode)</strong>로 작동 중입니다. 자유롭게 가상의 조직단위를 생성하고 편집해 보실 수 있습니다.
        </div>
      )}

      {/* OU Management Table */}
      <OUTreeManager
        orgUnits={orgUnits}
        onRename={handleRenameOU}
        onDelete={handleDeleteOU}
        onRefresh={loadData}
      />

      {/* OU Creation Form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">조직단위(OU) 신규 생성</h2>
        <p className="text-gray-600 text-sm mb-6">
          구글 워크스페이스에 매핑할 적절한 조직단위가 없다면 아래 폼을 통해 새로 만들 수 있습니다.
        </p>

        <form onSubmit={handleCreateOU} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">상위 조직단위 선택</label>
            <OUTreeSelector
              orgUnits={[{ orgUnitId: "root", orgUnitPath: "/", name: "/" }, ...orgUnits]}
              value={newOUParent}
              onChange={setNewOUParent}
              placeholder="/ (최상위)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 조직단위 이름</label>
            <input
              type="text"
              placeholder="예: 신입생"
              value={newOUName}
              onChange={(e) => setNewOUName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
              required
            />
          </div>

          <button
            type="submit"
            disabled={creatingOU}
            className="bg-gray-800 hover:bg-gray-900 text-white font-medium px-4 py-2 rounded-md focus:outline-none disabled:opacity-50 transition-colors text-sm"
          >
            {creatingOU ? "생성 중..." : "조직단위 생성"}
          </button>
        </form>
      </div>
    </div>
  );
}
