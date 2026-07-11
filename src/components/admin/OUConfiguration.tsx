"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import OUTreeManager from "@/components/admin/OUTreeManager";

interface OU {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

export default function OUConfiguration() {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OU[]>([]);
  
  // Settings State
  const [gradesCount, setGradesCount] = useState<number>(6);
  const [teacherOU, setTeacherOU] = useState<string>("");
  const [studentOUMappings, setStudentOUMappings] = useState<Record<number, string>>({});
  const [graduatesOU, setGraduatesOU] = useState<string>("");
  const [transferOutOU, setTransferOutOU] = useState<string>("");
  
  // New OU Form State
  const [newOUName, setNewOUName] = useState("");
  const [newOUParent, setNewOUParent] = useState("/");
  const [creatingOU, setCreatingOU] = useState(false);

  const domain = userData?.domain || "";

  // Fetch OUs and Load Settings
  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch OUs from API
      const res = await fetch("/api/workspace/ou");
      const data = await res.json();
      if (res.ok) {
        setOrgUnits(data.orgUnits);
        setIsMock(data.isMock);
      } else {
        throw new Error(data.error);
      }

      // 2. Fetch existing settings from Firestore
      if (domain) {
        const settingsRef = doc(db, "settings", domain);
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const settings = settingsSnap.data();
          setGradesCount(settings.gradesCount || 6);
          setTeacherOU(settings.ouMapping?.teachers || "");
          setStudentOUMappings(settings.ouMapping?.students || {});
          setGraduatesOU(settings.ouMapping?.graduates || "");
          setTransferOutOU(settings.ouMapping?.transferOut || "");
        }
      }
    } catch (error) {
      console.error("Failed to load settings data", error);
      alert("설정 데이터를 불러오는 데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (domain) {
      loadData();
    }
  }, [domain]);

  // Handle saving configurations to Firestore
  const handleSaveSettings = async () => {
    if (!domain) return;
    setSaving(true);
    try {
      const settingsRef = doc(db, "settings", domain);
      await setDoc(settingsRef, {
        gradesCount,
        ouMapping: {
          teachers: teacherOU,
          students: studentOUMappings,
          graduates: graduatesOU,
          transferOut: transferOutOU,
        },
        updatedAt: new Date(),
      });
      alert("설정이 성공적으로 저장되었습니다!");
    } catch (error) {
      console.error("Failed to save settings", error);
      alert("설정 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // Handle creating a new OU
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
        // Reload list of OUs
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

  // Handle rename OU
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

  // Handle delete OU
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

  // Helper to update mapping for a specific grade
  const handleStudentMappingChange = (grade: number, path: string) => {
    setStudentOUMappings((prev) => ({
      ...prev,
      [grade]: path,
    }));
  };

  if (loading) {
    return <p className="text-gray-500 text-center py-4">조직도 및 설정 불러오는 중...</p>;
  }

  return (
    <div className="space-y-8">
      {isMock && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md p-4 mb-4 text-sm">
          💡 <strong>안내:</strong> 현재 구글 워크스페이스 연동 변수(GCP Credentials)가 설정되지 않아 <strong>가짜 데이터 모드(Mock Mode)</strong>로 작동 중입니다. 자유롭게 가상의 조직단위를 생성하고 매핑을 테스트해 보실 수 있습니다.
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">학교 학년 및 조직단위 매핑 설정</h2>
        
        <div className="space-y-6">
          {/* Grade count setup */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              1. 학교 학년제 설정 (몇 학년까지 있나요?)
            </label>
            <input
              type="number"
              min="1"
              max="12"
              value={gradesCount}
              onChange={(e) => {
                const count = parseInt(e.target.value) || 1;
                setGradesCount(count);
                // Adjust mappings object keys if count shrinks
                setStudentOUMappings((prev) => {
                  const updated = { ...prev };
                  Object.keys(updated).forEach((key) => {
                    if (parseInt(key) > count) {
                      delete updated[parseInt(key)];
                    }
                  });
                  return updated;
                });
              }}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
            />
            <span className="ml-2 text-gray-600 text-sm">학년까지 있음 (예: 초등학교는 6, 중/고등학교는 3)</span>
          </div>

          <hr className="border-gray-200" />

          {/* Teacher OU mapping */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              2. 교사 조직단위(OU) 매핑
            </label>
            <div className="max-w-md">
              <OUTreeSelector
                orgUnits={orgUnits}
                value={teacherOU}
                onChange={setTeacherOU}
                placeholder="-- 교사용 조직단위를 선택하세요 --"
              />
            </div>
          </div>

          {/* Student OU mapping per grade */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              3. 학년별 학생 조직단위(OU) 매핑
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: gradesCount }).map((_, i) => {
                const grade = i + 1;
                return (
                  <div key={grade} className="flex items-center gap-3">
                    <span className="w-16 flex-shrink-0 text-sm font-medium text-gray-700">{grade}학년:</span>
                    <div className="flex-1">
                      <OUTreeSelector
                        orgUnits={orgUnits}
                        value={studentOUMappings[grade] || ""}
                        onChange={(path) => handleStudentMappingChange(grade, path)}
                        placeholder="-- 미매핑 --"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* Graduate OU mapping */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              4. 졸업생 조직단위(OU) 매핑
            </label>
            <div className="max-w-md">
              <OUTreeSelector
                orgUnits={orgUnits}
                value={graduatesOU}
                onChange={setGraduatesOU}
                placeholder="-- 졸업생용 조직단위를 선택하세요 --"
              />
            </div>
            <span className="text-gray-500 text-xs mt-1 block">
              학년 말 OU 전환 시 최종 학년(예: 3학년) 학생이 이름 변경되거나 보관되는 대상 조직단위로 사용됩니다.
            </span>
          </div>

          <hr className="border-gray-200" />

          {/* Transfer out OU mapping */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              5. 전출 및 자퇴(학업중단) 조직단위(OU) 매핑
            </label>
            <div className="max-w-md">
              <OUTreeSelector
                orgUnits={orgUnits}
                value={transferOutOU}
                onChange={setTransferOutOU}
                placeholder="-- 전출/자퇴자용 조직단위를 선택하세요 --"
              />
            </div>
            <span className="text-gray-500 text-xs mt-1 block">
              학기 중 전출이나 학업중단(자퇴) 처리된 학생이 보관 및 정지 상태로 이동되는 조직단위입니다.
            </span>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-md focus:outline-none disabled:opacity-50 transition-colors shadow-sm"
            >
              {saving ? "설정 저장 중..." : "매핑 설정 저장"}
            </button>
          </div>
        </div>
      </div>

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
