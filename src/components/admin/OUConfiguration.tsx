"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import OUCheckboxTree from "@/components/admin/OUCheckboxTree";
import AutocompleteInput from "@/components/admin/AutocompleteInput";

interface OU {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

export default function OUConfiguration() {
  const { userData, schoolSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OU[]>([]);
  
  // Settings State
  const [gradesCount, setGradesCount] = useState<number>(6);
  const [classCounts, setClassCounts] = useState<Record<number, number>>({});
  const [allowedBookmarkOUs, setAllowedBookmarkOUs] = useState<string[]>([]);
  const [teacherOU, setTeacherOU] = useState<string>("");
  const [studentOUMappings, setStudentOUMappings] = useState<Record<number, string>>({});
  const [graduatesOU, setGraduatesOU] = useState<string>("");
  const [transferOutOU, setTransferOutOU] = useState<string>("");
  const [teachersOB, setTeachersOB] = useState<string>("");
  const [autoJoinGroups, setAutoJoinGroups] = useState<string[]>([
    "ts@hmh.or.kr",
    "classroom_teachers@hmh.or.kr",
    "hmhteacher@hmh.or.kr",
    "hmh_teachers@hmh.or.kr",
  ]);
  const [newGroupInput, setNewGroupInput] = useState("");
  const [securityMap, setSecurityMap] = useState<Record<string, boolean>>({});

  const domain = userData?.domain || "";

  const checkSecurityForGroups = async (groupsList: string[]) => {
    if (groupsList.length === 0) return;
    try {
      const res = await fetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_security", groupEmails: groupsList }),
      });
      if (res.ok) {
        const data = await res.json();
        setSecurityMap((prev) => ({ ...prev, ...data.results }));
      }
    } catch (err) {
      console.error("Failed to check security status of groups", err);
    }
  };

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

      // 2. Initialize settings from context
      if (domain && schoolSettings) {
        const defaultClassroomGroup = `classroom_teachers@${domain}`;
        setGradesCount(schoolSettings.gradesCount || 6);
        setClassCounts(schoolSettings.classCounts || {});
        setAllowedBookmarkOUs((schoolSettings as any).allowedBookmarkOUs || ["/교직원", "/학생"]);
        setTeacherOU(schoolSettings.ouMapping?.teachers || "");
        setStudentOUMappings(schoolSettings.ouMapping?.students || {});
        setGraduatesOU(schoolSettings.ouMapping?.graduates || "");
        setTransferOutOU(schoolSettings.ouMapping?.transferOut || "");
        setTeachersOB(schoolSettings.ouMapping?.teachersOB || "");
        
        let loadedGroups = schoolSettings.teacherSettings?.autoJoinGroups || [];
        if (!loadedGroups.includes(defaultClassroomGroup)) {
          loadedGroups = [defaultClassroomGroup, ...loadedGroups];
        }
        setAutoJoinGroups(loadedGroups);
        checkSecurityForGroups(loadedGroups);
      } else if (domain) {
        // Fallback default setup
        setAllowedBookmarkOUs(["/교직원", "/학생"]);
        const defaultClassroomGroup = `classroom_teachers@${domain}`;
        const defaultGroups = [
          `ts@${domain}`,
          defaultClassroomGroup,
          `hmhteacher@${domain}`,
          `hmh_teachers@${domain}`,
        ];
        setAutoJoinGroups(defaultGroups);
        checkSecurityForGroups(defaultGroups);
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
      const defaultClassroomGroup = `classroom_teachers@${domain}`;
      let finalGroups = [...autoJoinGroups];
      if (!finalGroups.includes(defaultClassroomGroup)) {
        finalGroups = [defaultClassroomGroup, ...finalGroups];
      }

      const settingsRef = doc(db, "settings", domain);
      await setDoc(settingsRef, {
        gradesCount,
        classCounts,
        allowedBookmarkOUs,
        ouMapping: {
          teachers: teacherOU,
          students: studentOUMappings,
          graduates: graduatesOU,
          transferOut: transferOutOU,
          teachersOB: teachersOB,
        },
        teacherSettings: {
          autoJoinGroups: finalGroups,
        },
        updatedAt: new Date(),
      });
      setAutoJoinGroups(finalGroups);
      alert("설정이 성공적으로 저장되었습니다!");
    } catch (error) {
      console.error("Failed to save settings", error);
      alert("설정 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
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
              3. 학년별 학생 조직단위(OU) 및 학급(반) 수 설정
            </label>
            <div className="space-y-4 max-w-4xl">
              {Array.from({ length: gradesCount }).map((_, i) => {
                const grade = i + 1;
                return (
                  <div key={grade} className="flex flex-col sm:flex-row sm:items-center gap-4 bg-gray-50/50 p-3 rounded-lg border border-gray-100">
                    <div className="w-20 flex-shrink-0 text-sm font-bold text-gray-800">
                      {grade}학년 설정
                    </div>
                    
                    {/* OU Selector */}
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">학생 OU 경로</label>
                      <OUTreeSelector
                        orgUnits={orgUnits}
                        value={studentOUMappings[grade] || ""}
                        onChange={(path) => handleStudentMappingChange(grade, path)}
                        placeholder="-- 미매핑 --"
                      />
                    </div>

                    {/* Class Count Input */}
                    <div className="w-36 flex-shrink-0">
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1">학급(반) 수</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={classCounts[grade] || 10}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 10;
                            setClassCounts(prev => ({
                              ...prev,
                              [grade]: val
                            }));
                          }}
                          className="w-20 px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm text-gray-900 bg-white"
                        />
                        <span className="text-xs text-gray-500 font-medium">개 반</span>
                      </div>
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

          <hr className="border-gray-200" />

          {/* Teachers OB OU mapping */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              6. 명예퇴임 교사 (OB 보존실) 조직단위(OU) 매핑
            </label>
            <div className="max-w-md">
              <OUTreeSelector
                orgUnits={orgUnits}
                value={teachersOB}
                onChange={setTeachersOB}
                placeholder="-- OB 보존용 조직단위를 선택하세요 --"
              />
            </div>
            <span className="text-gray-500 text-xs mt-1 block">
              사립학교 교직원 중 끝까지 학교 교사로 있다가 퇴임(명예퇴직 등)하시는 분들의 계정을 영구 보존하기 위해 이동시킬 조직단위입니다.
            </span>
          </div>

          <hr className="border-gray-200" />

          {/* Teacher Auto-Join Groups */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              7. 교직원 등록/전출 연동 그룹 사전 지정
            </label>
            <p className="text-gray-500 text-xs mb-3">
              교직원이 전입할 때 자동으로 가입되고, 전출/퇴임할 때 자동으로 탈퇴시킬 Google Workspace 그룹(메일링 리스트) 이메일 주소들을 관리합니다.
            </p>
            
            <div className="space-y-3 max-w-md">
              <div className="flex gap-2 items-center flex-1">
                <AutocompleteInput
                  type="group"
                  value={newGroupInput}
                  onChange={setNewGroupInput}
                  domain={domain}
                  onSelect={(email) => setNewGroupInput(email)}
                  placeholder="예: target-group@hmh.or.kr"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newGroupInput) return;
                    const val = newGroupInput.trim().toLowerCase();
                    if (!val.includes("@")) {
                      alert("올바른 이메일 형식을 입력해주세요.");
                      return;
                    }
                    if (autoJoinGroups.includes(val)) {
                      alert("이미 추가된 그룹입니다.");
                      return;
                    }
                    const updated = [...autoJoinGroups, val];
                    setAutoJoinGroups(updated);
                    setNewGroupInput("");
                    checkSecurityForGroups([val]);
                  }}
                  className="bg-gray-800 hover:bg-gray-900 text-white font-medium px-4 py-2 rounded-md text-sm transition-colors"
                >
                  추가
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {autoJoinGroups.length === 0 ? (
                  <span className="text-gray-400 text-xs">지정된 연동 그룹이 없습니다.</span>
                ) : (
                  autoJoinGroups.map((group) => {
                    const isDefaultGroup = group.startsWith("classroom_teachers@");
                    const isSecurity = securityMap[group];
                    return (
                      <span
                        key={group}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                      >
                        <span>{group}</span>
                        {isDefaultGroup && (
                          <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                            기본 필수
                          </span>
                        )}
                        {isSecurity && (
                          <span className="bg-red-50 text-red-600 border border-red-200 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                            보안 그룹
                          </span>
                        )}
                        {!isDefaultGroup && (
                          <button
                            type="button"
                            onClick={() => {
                              setAutoJoinGroups(autoJoinGroups.filter((g) => g !== group));
                            }}
                            className="text-indigo-400 hover:text-indigo-600 focus:outline-none text-[16px] leading-none ml-1"
                          >
                            &times;
                          </button>
                        )}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* Chrome Bookmarks allowed OUs configuration */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              8. 교사용 크롬 북마크 배포 권한 OU 설정
            </label>
            <p className="text-gray-500 text-xs mb-3">
              일반 교사들이 학생/교직원 크롬 브라우저에 북마크를 강제 배정할 때, 접근 및 조작을 허용할 조직단위(OU)를 체크해 주세요.
              (상위 조직단위 선택 시 하위 조직단위 권한도 자동으로 상속됩니다.)
            </p>
            <div className="max-w-xl max-h-72 overflow-y-auto">
              <OUCheckboxTree
                orgUnits={orgUnits}
                selected={allowedBookmarkOUs}
                onChange={setAllowedBookmarkOUs}
              />
            </div>
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




    </div>
  );
}
