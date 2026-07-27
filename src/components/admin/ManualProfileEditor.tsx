"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth, TeacherProfile } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { writeAuditLog } from "@/lib/firebase/audit";

const DEFAULT_DEPARTMENTS = [
  "교장", "교감", "교목", "교무기획부", "교육연구부", "학생생활자치부",
  "교육과정부", "과학정보융합부", "건학인성부", "창의적체험활동부", "학력향상부",
  "진학지원부", "학생건강부", "1학년", "2학년", "3학년",
  "국어", "수학", "사회", "과학", "외국어", "생활교양", "예술", "체육",
  "진로상담", "행정실", "급식실", "휴직 및 퇴직 교사",
];

const DEFAULT_POSITIONS = ["교장", "교감", "교목", "부장", "교사", "영양사", "행정실장", "주무관", "조리사"];

interface Props {
  initialEmail?: string;
  initialProfile?: TeacherProfile;
  onSuccess?: () => void;
}

export default function ManualProfileEditor({ initialEmail = "", initialProfile, onSuccess }: Props) {
  const { userData, schoolSettings } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const departments = schoolSettings?.departments || DEFAULT_DEPARTMENTS;
  const positions = (schoolSettings?.positions || DEFAULT_POSITIONS).filter(p => p !== "계원");
  const gradesCount = schoolSettings?.gradesCount || 3;

  // Selected target teacher
  const [targetEmail, setTargetEmail] = useState(initialEmail);
  const [targetName, setTargetName] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Form states
  const [noDept, setNoDept] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [deptHeadMap, setDeptHeadMap] = useState<Record<string, boolean>>({});
  const [position, setPosition] = useState("");
  const [isHomeroom, setIsHomeroom] = useState(false);
  const [homeroomGrade, setHomeroomGrade] = useState(1);
  const [homeroomClass, setHomeroomClass] = useState(1);

  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isSuperAdmin = userData?.role === "super_admin";
  const domain = userData?.domain || "";

  const classCountForGrade = Number(schoolSettings?.classCounts?.[homeroomGrade] ?? 10);

  // Load existing profile when targetEmail changes
  // gwsName: AutocompleteInput이 넘겨준 GWS 실명 — 저장된 name(레거시 이메일 아이디)보다 우선
  const loadExistingProfile = async (email: string, gwsName?: string) => {
    if (!email) return;
    setLoadingProfile(true);
    try {
      const ref = doc(db, "teacher_profiles", email);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as TeacherProfile;
        setTargetName(gwsName || data.name || email.split("@")[0]);
        setNoDept(data.noDept === true);
        setSelectedDepts(data.departments || []);
        setDeptHeadMap(data.deptHeadMap || {});
        setPosition(data.position || "");
        setIsHomeroom(data.isHomeroom === true);
        if (data.homeroom) {
          setHomeroomGrade(data.homeroom.grade || 1);
          setHomeroomClass(data.homeroom.class || 1);
        }
      } else {
        // Fallback default for new profile
        setTargetName(gwsName || email.split("@")[0]);
        setNoDept(false);
        setSelectedDepts([]);
        setDeptHeadMap({});
        setPosition("교사");
        setIsHomeroom(false);
        setHomeroomGrade(1);
        setHomeroomClass(1);
      }
    } catch (err) {
      console.error("교사 프로필 조회 실패", err);
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (initialEmail) {
      setTargetEmail(initialEmail);
      if (initialProfile && initialProfile.email.toLowerCase() === initialEmail.toLowerCase()) {
        setTargetName(initialProfile.name || initialEmail.split("@")[0]);
        setNoDept(initialProfile.noDept === true);
        setSelectedDepts(initialProfile.departments || []);
        setDeptHeadMap(initialProfile.deptHeadMap || {});
        setPosition(initialProfile.position || "");
        setIsHomeroom(initialProfile.isHomeroom === true);
        if (initialProfile.homeroom) {
          setHomeroomGrade(initialProfile.homeroom.grade || 1);
          setHomeroomClass(initialProfile.homeroom.class || 1);
        } else {
          setHomeroomGrade(1);
          setHomeroomClass(1);
        }
      } else {
        loadExistingProfile(initialEmail);
      }
    }
  }, [initialEmail, initialProfile]);

  // AutocompleteInput.onSelect 시그니처는 (email, name?: string) — name은 "성이름" 문자열
  const handleSelectUser = (email: string, name?: string) => {
    setTargetEmail(email);
    setTargetName(name || email.split("@")[0]);
    loadExistingProfile(email, name);
  };

  const resetForm = () => {
    setTargetEmail("");
    setTargetName("");
    setNoDept(false);
    setSelectedDepts([]);
    setDeptHeadMap({});
    setPosition("");
    setIsHomeroom(false);
    setHomeroomGrade(1);
    setHomeroomClass(1);
    
    // Focus back to Autocomplete search box for continuous UX
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  };

  const toggleDept = (dept: string) => {
    setNoDept(false);
    setSelectedDepts((prev) => {
      const isSelected = prev.includes(dept);
      if (isSelected) {
        setDeptHeadMap((curr) => {
          const updated = { ...curr };
          delete updated[dept];
          return updated;
        });
        return prev.filter((d) => d !== dept);
      } else {
        return [...prev, dept];
      }
    });
  };

  const handleNoDeptToggle = () => {
    if (noDept) {
      setNoDept(false);
      return;
    }
    setNoDept(true);
    setSelectedDepts([]);
    setDeptHeadMap({});
    setPosition("");
    setIsHomeroom(false);
  };

  const handleSubmit = async () => {
    if (!isSuperAdmin) {
      alert("어드민 수동 배치 권한이 없습니다. (super_admin 전용)");
      return;
    }
    if (!targetEmail) {
      alert("배치 대상 교사 계정을 선택해 주세요.");
      return;
    }
    if (!noDept && selectedDepts.length === 0) {
      alert("소속 부서를 1개 이상 선택하거나 '해당사항 없음'을 선택해 주세요.");
      return;
    }
    if (!noDept && !position) {
      alert("직책을 선택해 주세요.");
      return;
    }

    setSaving(true);
    setToastMessage(null);

    try {
      const isAnyDeptHead = Object.values(deptHeadMap).some(Boolean);
      const name = targetName || targetEmail.split("@")[0];

      // 1. Save immediately approved profile to teacher_profiles
      const profileRef = doc(db, "teacher_profiles", targetEmail);
      await setDoc(profileRef, {
        email: targetEmail,
        name,
        departments: noDept ? [] : selectedDepts,
        noDept,
        position: noDept ? "" : position,
        isDeptHead: noDept ? false : isAnyDeptHead,
        deptHeadMap: noDept ? {} : deptHeadMap,
        isHomeroom: noDept ? false : isHomeroom,
        homeroom: (!noDept && isHomeroom) ? { grade: homeroomGrade, class: homeroomClass } : null,
        updatedAt: serverTimestamp(),
        updatedBy: userData?.email || "super_admin",
      });

      // 2. Invalidate/approve any existing pending application
      const pendingRef = doc(db, "teacher_profiles_pending", targetEmail);
      const pendingSnap = await getDoc(pendingRef);
      if (pendingSnap.exists()) {
        await updateDoc(pendingRef, {
          status: "APPROVED",
          approvedBy: userData?.email || "super_admin",
          approvedAt: serverTimestamp(),
          supersededByManual: true,
        });
      }

      // 3. Write audit log
      if (userData?.email) {
        await writeAuditLog({
          operatorEmail: userData.email,
          operatorName: (userData as any).name || (userData as any).displayName || "",
          action: "TEACHER_PROFILE_MANUAL_ASSIGNMENT",
          targetEmail,
          details: `어드민 수동 배치 완료: 부서(${noDept ? "없음" : selectedDepts.join(", ")}), 직책(${position || "-"})${isHomeroom ? `, 담임(${homeroomGrade}-${homeroomClass})` : ""}`,
          status: "success",
        });
      }

      // Success Toast & Reset Form for continuous input
      const msg = `✅ ${name}(${targetEmail}) 교사의 조직 정보가 수동 배치 저장되었습니다!`;
      setToastMessage(msg);
      if (onSuccess) onSuccess();

      resetForm();
    } catch (err) {
      console.error("수동 배치 저장 실패", err);
      alert("수동 배치 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-sm p-6 space-y-6">
      {/* Title */}
      <div className="border-b border-gray-100 pb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <span>✍️</span>
          <span>어드민 수동 배치</span>
          <span className="text-xs bg-indigo-100 text-indigo-800 font-extrabold px-2.5 py-0.5 rounded-full ml-1">
            super_admin 전용
          </span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          신청·승인 절차 없이 인사 배치표를 보고 즉시 승인 프로필로 저장합니다. 교사에게 알림이 발송되지 않으며 연속 입력 UX가 지원됩니다.
        </p>
      </div>

      {/* Success Toast Banner */}
      {toastMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold rounded-lg p-3 flex items-center justify-between animate-fade-in">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 font-bold text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Target Teacher Autocomplete Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-bold text-gray-800">
          1. 배치 대상 교사 선택 <span className="text-red-500">*</span>
        </label>
        <div className="max-w-md">
          <AutocompleteInput
            type="user"
            value={targetEmail}
            onChange={(val) => {
              setTargetEmail(val);
              if (!val) {
                setTargetName("");
              }
            }}
            domain={domain}
            onSelect={handleSelectUser}
            placeholder="이름 또는 이메일 검색 (예: 홍길동, teacher@hmh.or.kr)"
            inputRef={searchInputRef}
          />
        </div>
        {loadingProfile && (
          <p className="text-xs text-indigo-500 animate-pulse">기존 프로필 데이터 조회 중...</p>
        )}
        {targetEmail && !loadingProfile && (
          <p className="text-xs text-gray-500">
            선택된 대상: <strong className="text-indigo-600">{targetName || targetEmail.split("@")[0]}</strong> ({targetEmail})
          </p>
        )}
      </div>

      <hr className="border-gray-100" />

      {/* Form Fields */}
      <div className="space-y-6 max-w-2xl">
        {/* 소속 부서 */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">
            2. 소속 부서 <span className="text-red-500">*</span>
            <span className="text-xs font-normal text-gray-400 ml-1">(복수 선택 가능)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {/* 해당사항 없음 버튼 */}
            <button
              type="button"
              onClick={handleNoDeptToggle}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                noDept
                  ? "bg-gray-700 border-gray-700 text-white shadow-sm"
                  : "bg-gray-50 border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700"
              }`}
            >
              해당사항 없음
            </button>

            {departments.map((dept) => (
              <button
                key={dept}
                type="button"
                onClick={() => toggleDept(dept)}
                disabled={noDept}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-40 ${
                  !noDept && selectedDepts.includes(dept)
                    ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                    : "bg-gray-50 border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          {/* 부서별 부서장 지정 */}
          {!noDept && selectedDepts.length > 0 && (
            <div className="mt-3 space-y-2 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 max-w-md">
              <p className="text-xs font-semibold text-indigo-800 mb-1.5">부서별 역할 지정</p>
              <div className="space-y-1.5">
                {selectedDepts.map((dept) => {
                  const isHead = !!deptHeadMap[dept];
                  return (
                    <div key={dept} className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-indigo-100 text-xs">
                      <span className="font-bold text-gray-800">{dept}</span>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-600">
                        <input
                          type="checkbox"
                          checked={isHead}
                          onChange={(e) => {
                            setDeptHeadMap((prev) => ({
                              ...prev,
                              [dept]: e.target.checked,
                            }));
                          }}
                          className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-400"
                        />
                        <span>부서장(부장)</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 직책 */}
        {!noDept && (
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-2">
              3. 직책 <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {positions.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setPosition(pos)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    position === pos
                      ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                      : "bg-gray-50 border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-600"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 담임 여부 */}
        {!noDept && (
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isHomeroom}
                onChange={(e) => setIsHomeroom(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-bold text-gray-800">🏫 담임 교사 지정</span>
            </label>

            {isHomeroom && (
              <div className="mt-3 ml-7 flex items-center gap-3">
                {/* 학년 선택 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">학년</label>
                  <select
                    value={homeroomGrade}
                    onChange={(e) => {
                      setHomeroomGrade(Number(e.target.value));
                      setHomeroomClass(1);
                    }}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {Array.from({ length: gradesCount }, (_, i) => i + 1).map((g) => (
                      <option key={g} value={g}>{g}학년</option>
                    ))}
                  </select>
                </div>

                {/* 반 선택 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    반 <span className="text-indigo-400">({classCountForGrade}반까지)</span>
                  </label>
                  <select
                    value={homeroomClass}
                    onChange={(e) => setHomeroomClass(Number(e.target.value))}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {Array.from({ length: classCountForGrade }, (_, i) => i + 1).map((c) => (
                      <option key={c} value={c}>{c}반</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submit Action Buttons */}
        <div className="pt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !targetEmail || !isSuperAdmin}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                저장 중...
              </>
            ) : (
              "✅ 즉시 승인 및 배치 저장 (저장 후 포커스 복귀)"
            )}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition-colors"
          >
            초기화
          </button>
        </div>
      </div>
    </div>
  );
}
