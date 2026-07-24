"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import OUCheckboxTree from "@/components/admin/OUCheckboxTree";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { SchedulePeriod } from "@/context/AuthContext";

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

  // Schedule state (일과표)
  const DEFAULT_SCHEDULE: SchedulePeriod[] = [
    { period: "1", name: "1교시", startTime: "09:00", endTime: "09:50" },
    { period: "2", name: "2교시", startTime: "10:00", endTime: "10:50" },
    { period: "3", name: "3교시", startTime: "11:00", endTime: "11:50" },
    { period: "4", name: "4교시", startTime: "12:00", endTime: "12:50" },
    { period: "lunch", name: "점심시간", startTime: "12:50", endTime: "13:50" },
    { period: "5", name: "5교시", startTime: "13:50", endTime: "14:40" },
    { period: "6", name: "6교시", startTime: "14:50", endTime: "15:40" },
    { period: "7", name: "7교시", startTime: "16:00", endTime: "16:50" },
  ];
  const [schedule, setSchedule] = useState<SchedulePeriod[]>(DEFAULT_SCHEDULE);

  // Departments and positions master list
  const DEFAULT_DEPARTMENTS = [
    "교장", "교감", "교목", "교무기획부", "교육연구부", "학생생활자치부",
    "교육과정부", "과학정보융합부", "건학인성부", "창의적체험활동부", "학력향상부",
    "진학지원부", "학생건강부", "1학년", "2학년", "3학년",
    "국어", "수학", "사회", "과학", "외국어", "생활교양", "예술", "체육",
    "진로상담", "행정실", "급식실", "휴직 및 퇴직 교사",
  ];
  const DEFAULT_POSITIONS = ["교장", "교감", "교목", "부장", "교사", "계원", "영양사", "행정실장", "주무관", "조리사"];
  const [departments, setDepartments] = useState<string[]>(DEFAULT_DEPARTMENTS);
  const [positions, setPositions] = useState<string[]>(DEFAULT_POSITIONS);
  const [newDeptInput, setNewDeptInput] = useState("");
  const [newPosInput, setNewPosInput] = useState("");
  const [draggedDeptIdx, setDraggedDeptIdx] = useState<number | null>(null);
  const [draggedPosIdx, setDraggedPosIdx] = useState<number | null>(null);

  const moveDepartment = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= departments.length) return;
    const newDepts = [...departments];
    const [movedItem] = newDepts.splice(index, 1);
    newDepts.splice(targetIndex, 0, movedItem);
    setDepartments(newDepts);
  };

  const handleDeptDragStart = (index: number) => {
    setDraggedDeptIdx(index);
  };

  const handleDeptDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDeptDrop = (index: number) => {
    if (draggedDeptIdx === null || draggedDeptIdx === index) return;
    const newDepts = [...departments];
    const [draggedItem] = newDepts.splice(draggedDeptIdx, 1);
    newDepts.splice(index, 0, draggedItem);
    setDepartments(newDepts);
    setDraggedDeptIdx(null);
  };

  const movePosition = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= positions.length) return;
    const newPositions = [...positions];
    const [movedItem] = newPositions.splice(index, 1);
    newPositions.splice(targetIndex, 0, movedItem);
    setPositions(newPositions);
  };

  const handlePosDragStart = (index: number) => {
    setDraggedPosIdx(index);
  };

  const handlePosDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handlePosDrop = (index: number) => {
    if (draggedPosIdx === null || draggedPosIdx === index) return;
    const newPositions = [...positions];
    const [draggedItem] = newPositions.splice(draggedPosIdx, 1);
    newPositions.splice(index, 0, draggedItem);
    setPositions(newPositions);
    setDraggedPosIdx(null);
  };

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

        // Load schedule and department/position masters
        if (schoolSettings.schedule) setSchedule(schoolSettings.schedule);
        if (schoolSettings.departments) setDepartments(schoolSettings.departments);
        if (schoolSettings.positions) setPositions(schoolSettings.positions);
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
        schedule,
        departments,
        positions,
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

          {/* === 일과표 설정 === */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              9. 일과표 (교시별 시간) 설정
            </label>
            <p className="text-gray-500 text-xs mb-3">
              시간표 및 티칭러닝 라이센스 배정에 활용됩니다. 교시는 자유롭게 추가/삭제하세요.
            </p>
            <div className="space-y-2 max-w-2xl">
              {schedule.map((p, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-gray-50/50 border border-gray-100 rounded-lg px-4 py-2.5">
                  <input
                    type="text"
                    value={p.name}
                    onChange={e => setSchedule(prev => prev.map((s, i) => i === idx ? { ...s, name: e.target.value } : s))}
                    placeholder="교시명"
                    className="w-28 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 bg-white"
                  />
                  <span className="text-gray-400 text-xs">시작</span>
                  <input
                    type="time"
                    value={p.startTime}
                    onChange={e => setSchedule(prev => prev.map((s, i) => i === idx ? { ...s, startTime: e.target.value } : s))}
                    className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 bg-white"
                  />
                  <span className="text-gray-400 text-xs">종료</span>
                  <input
                    type="time"
                    value={p.endTime}
                    onChange={e => setSchedule(prev => prev.map((s, i) => i === idx ? { ...s, endTime: e.target.value } : s))}
                    className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setSchedule(prev => prev.filter((_, i) => i !== idx))}
                    className="ml-auto text-red-400 hover:text-red-600 text-xs font-bold px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSchedule(prev => [...prev, { period: String(prev.length + 1), name: `${prev.length + 1}교시`, startTime: "17:00", endTime: "17:50" }])}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-500 transition-colors font-medium"
              >
                + 교시 추가
              </button>
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* === 부서/직책 마스터 목록 관리 === */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* 부서 목록 */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">10. 부서 목록 관리</label>
              <p className="text-gray-500 text-xs mb-3">교직원이 조직 정보 신청 시 선택할 수 있는 부서 목록입니다. 행을 드래그하거나 위/아래 화살표(▲ ▼) 버튼으로 우선순위를 변경하세요.</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newDeptInput}
                  onChange={e => setNewDeptInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = newDeptInput.trim();
                      if (v && !departments.includes(v)) setDepartments(prev => [...prev, v]);
                      setNewDeptInput("");
                    }
                  }}
                  placeholder="부서명 입력 후 Enter"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = newDeptInput.trim();
                    if (v && !departments.includes(v)) setDepartments(prev => [...prev, v]);
                    setNewDeptInput("");
                  }}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors shrink-0"
                >
                  추가
                </button>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-gray-50/50">
                {departments.map((dept, index) => (
                  <div
                    key={dept}
                    draggable
                    onDragStart={() => handleDeptDragStart(index)}
                    onDragOver={(e) => handleDeptDragOver(e, index)}
                    onDrop={() => handleDeptDrop(index)}
                    onDragEnd={() => setDraggedDeptIdx(null)}
                    className={`flex items-center justify-between px-3 py-2 bg-white rounded-lg border text-sm font-medium transition-all shadow-xs select-none ${
                      draggedDeptIdx === index
                        ? "opacity-40 border-dashed border-indigo-400 bg-indigo-50/40"
                        : "border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-indigo-600 font-bold text-base leading-none">
                        ⠿
                      </span>
                      <span className="text-xs font-bold text-indigo-400 w-5 text-right shrink-0">
                        {index + 1}.
                      </span>
                      <span className="text-gray-800 font-semibold truncate">{dept}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveDepartment(index, "up")}
                        className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-20 transition-colors cursor-pointer rounded hover:bg-gray-100"
                        title="위로 이동"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={index === departments.length - 1}
                        onClick={() => moveDepartment(index, "down")}
                        className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-20 transition-colors cursor-pointer rounded hover:bg-gray-100"
                        title="아래로 이동"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => setDepartments(prev => prev.filter(d => d !== dept))}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors cursor-pointer rounded hover:bg-red-50 ml-1"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 직책 목록 */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">11. 직책 목록 관리</label>
              <p className="text-gray-500 text-xs mb-3">교직원이 선택할 수 있는 직책 목록입니다. 행을 드래그하거나 위/아래 화살표(▲ ▼) 버튼으로 우선순위를 변경하세요.</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newPosInput}
                  onChange={e => setNewPosInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = newPosInput.trim();
                      if (v && !positions.includes(v)) setPositions(prev => [...prev, v]);
                      setNewPosInput("");
                    }
                  }}
                  placeholder="직책명 입력 후 Enter"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = newPosInput.trim();
                    if (v && !positions.includes(v)) setPositions(prev => [...prev, v]);
                    setNewPosInput("");
                  }}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-medium transition-colors shrink-0"
                >
                  추가
                </button>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-gray-50/50">
                {positions.map((pos, index) => (
                  <div
                    key={pos}
                    draggable
                    onDragStart={() => handlePosDragStart(index)}
                    onDragOver={(e) => handlePosDragOver(e, index)}
                    onDrop={() => handlePosDrop(index)}
                    onDragEnd={() => setDraggedPosIdx(null)}
                    className={`flex items-center justify-between px-3 py-2 bg-white rounded-lg border text-sm font-medium transition-all shadow-xs select-none ${
                      draggedPosIdx === index
                        ? "opacity-40 border-dashed border-emerald-400 bg-emerald-50/40"
                        : "border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-emerald-600 font-bold text-base leading-none">
                        ⠿
                      </span>
                      <span className="text-xs font-bold text-emerald-500 w-5 text-right shrink-0">
                        {index + 1}.
                      </span>
                      <span className="text-gray-800 font-semibold truncate">{pos}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => movePosition(index, "up")}
                        className="p-1 text-gray-400 hover:text-emerald-600 disabled:opacity-20 transition-colors cursor-pointer rounded hover:bg-gray-100"
                        title="위로 이동"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={index === positions.length - 1}
                        onClick={() => movePosition(index, "down")}
                        className="p-1 text-gray-400 hover:text-emerald-600 disabled:opacity-20 transition-colors cursor-pointer rounded hover:bg-gray-100"
                        title="아래로 이동"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => setPositions(prev => prev.filter(p => p !== pos))}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors cursor-pointer rounded hover:bg-red-50 ml-1"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
