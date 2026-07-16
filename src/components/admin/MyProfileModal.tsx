"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

const DEFAULT_DEPARTMENTS = [
  "교장", "교감", "교목", "교무기획부", "교육연구부", "학생생활자치부",
  "교육과정부", "과학정보융합부", "건학인성부", "창의적체험활동부", "학력향상부",
  "진학지원부", "학생건강부", "1학년", "2학년", "3학년",
  "국어", "수학", "사회", "과학", "외국어", "생활교양", "예술", "체육",
  "진로상담", "행정실", "급식실", "휴직 및 퇴직 교사",
];

// 계원 제거
const DEFAULT_POSITIONS = ["교장", "교감", "교목", "부장", "교사", "영양사", "행정실장", "주무관", "조리사"];

const NO_DEPT = "__none__";

interface Props {
  onClose: () => void;
}

export default function MyProfileModal({ onClose }: Props) {
  const { userData, teacherProfile, schoolSettings } = useAuth();

  const departments = schoolSettings?.departments || DEFAULT_DEPARTMENTS;
  // 직책 목록에서 계원 제거 (저장된 설정에도 혹시 있으면 필터)
  const positions = (schoolSettings?.positions || DEFAULT_POSITIONS).filter(p => p !== "계원");
  const gradesCount = schoolSettings?.gradesCount || 3;

  // 소속 없음 초기값: 기존 프로필이 있고 명시적으로 noDept=true인 경우에만 true
  // 신규 등록(프로필 없음) 시에는 false — 모든 부서 버튼 활성화
  const initNoDept = teacherProfile
    ? (teacherProfile as any).noDept === true
    : false;

  // Form state — pre-fill from existing profile if any
  const [noDept, setNoDept] = useState(initNoDept);
  const [selectedDepts, setSelectedDepts] = useState<string[]>(
    teacherProfile?.departments || []
  );
  const [position, setPosition] = useState(teacherProfile?.position || "");
  const [deptHeadMap, setDeptHeadMap] = useState<Record<string, boolean>>(
    (teacherProfile as any)?.deptHeadMap || {}
  );
  const [isHomeroom, setIsHomeroom] = useState(teacherProfile?.isHomeroom || false);
  const [homeroomGrade, setHomeroomGrade] = useState(teacherProfile?.homeroom?.grade || 1);
  const [homeroomClass, setHomeroomClass] = useState(teacherProfile?.homeroom?.class || 1);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // 학년별 반 수: 캐시된 schoolSettings.classCounts에서 해당 학년 반 수를 가져옴
  const classCountForGrade = Number(schoolSettings?.classCounts?.[homeroomGrade] ?? 10);

  const toggleDept = (dept: string) => {
    if (noDept) setNoDept(false);
    setSelectedDepts(prev => {
      const isSelected = prev.includes(dept);
      if (isSelected) {
        setDeptHeadMap(curr => {
          const updated = { ...curr };
          delete updated[dept];
          return updated;
        });
        return prev.filter(d => d !== dept);
      } else {
        return [...prev, dept];
      }
    });
  };

  const handleNoDeptToggle = () => {
    setNoDept(true);
    setSelectedDepts([]);
    setDeptHeadMap({});
  };

  const handleSubmit = async () => {
    if (!userData?.email) return;
    if (!noDept && selectedDepts.length === 0) {
      alert("소속 부서를 1개 이상 선택하거나 '소속 없음'을 선택해 주세요.");
      return;
    }
    if (!position) {
      alert("직책을 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const name = userData.email.split("@")[0];
      const isAnyDeptHead = Object.values(deptHeadMap).some(Boolean);
      const pendingRef = doc(db, "teacher_profiles_pending", userData.email);
      await setDoc(pendingRef, {
        email: userData.email,
        name,
        departments: noDept ? [] : selectedDepts,
        noDept,
        position,
        isDeptHead: noDept ? false : isAnyDeptHead,
        deptHeadMap: noDept ? {} : deptHeadMap,
        isHomeroom,
        homeroom: isHomeroom ? { grade: homeroomGrade, class: homeroomClass } : null,
        status: "PENDING",
        requestedAt: serverTimestamp(),
        rejectedReason: "",
      });
      setDone(true);
    } catch (err) {
      console.error("프로필 신청 저장 실패", err);
      alert("신청 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">
            {teacherProfile ? "✏️ 조직 정보 수정 신청" : "📝 조직 정보 등록 신청"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">✕</button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-4">
            <div className="text-5xl">✅</div>
            <p className="text-lg font-bold text-gray-900">신청이 제출되었습니다!</p>
            <p className="text-sm text-gray-500">관리자 승인 후 조직도에 반영됩니다.<br />승인 전까지는 기존 정보가 유지됩니다.</p>
            <button
              onClick={onClose}
              className="mt-4 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-colors"
            >
              닫기
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-6">

            {/* ── 소속 부서 ── */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                소속 부서 <span className="text-red-500">*</span>
                <span className="text-xs font-normal text-gray-400 ml-1">(복수 선택 가능)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {/* 소속 없음 특수 버튼 */}
                <button
                  type="button"
                  onClick={handleNoDeptToggle}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    noDept
                      ? "bg-gray-700 border-gray-700 text-white shadow-sm"
                      : "bg-gray-50 border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700"
                  }`}
                >
                  소속 없음
                </button>

                {departments.map(dept => (
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

              {/* 선택 요약 & 부서별 부서장 지정 */}
              {!noDept && selectedDepts.length > 0 && (
                <div className="mt-3 space-y-2 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                  <p className="text-xs font-semibold text-indigo-800 mb-1.5">부서별 역할 지정</p>
                  <div className="space-y-1.5">
                    {selectedDepts.map(dept => {
                      const isHead = !!deptHeadMap[dept];
                      return (
                        <div key={dept} className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-indigo-100 text-xs">
                          <span className="font-bold text-gray-800">{dept}</span>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-600">
                            <input
                              type="checkbox"
                              checked={isHead}
                              onChange={e => {
                                setDeptHeadMap(prev => ({
                                  ...prev,
                                  [dept]: e.target.checked
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

            {/* ── 직책 ── */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                직책 <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {positions.map(pos => (
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

            {/* ── 담임 여부 ── */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isHomeroom}
                  onChange={e => setIsHomeroom(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-semibold text-gray-800">🏫 담임 교사</span>
              </label>

              {isHomeroom && (
                <div className="mt-3 ml-7 flex items-center gap-3">
                  {/* 학년 선택 */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">학년</label>
                    <select
                      value={homeroomGrade}
                      onChange={e => {
                        setHomeroomGrade(Number(e.target.value));
                        setHomeroomClass(1);
                      }}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {Array.from({ length: gradesCount }, (_, i) => i + 1).map(g => (
                        <option key={g} value={g}>{g}학년</option>
                      ))}
                    </select>
                  </div>

                  {/* 반 선택 — 해당 학년 classCounts 캐시 기준 */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      반 <span className="text-indigo-400">({classCountForGrade}반까지)</span>
                    </label>
                    <select
                      value={homeroomClass}
                      onChange={e => setHomeroomClass(Number(e.target.value))}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {Array.from({ length: classCountForGrade }, (_, i) => i + 1).map(c => (
                        <option key={c} value={c}>{c}반</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* ── 제출 버튼 ── */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  신청 중...
                </>
              ) : (
                "✅ 승인 요청 제출"
              )}
            </button>
            <p className="text-center text-xs text-gray-400">
              관리자 승인 후 조직도에 반영됩니다. 승인 전까지 기존 정보는 유지됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
