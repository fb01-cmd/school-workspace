"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/context/AuthContext";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getClientCache, invalidateClientCache } from "@/lib/cache/clientCache";
import { DEFAULT_DEPARTMENTS, DEFAULT_POSITIONS } from "@/lib/org/departments";
import { isFrozenLocalPartName } from "@/lib/org/displayName";
import { isMobileNumberPattern } from "@/components/admin/ManualProfileEditor";
import DeptPositionPicker from "@/components/admin/DeptPositionPicker";

interface Props {
  onClose: () => void;
}

export default function MyProfileModal({ onClose }: Props) {
  const { userData, teacherProfile, schoolSettings } = useAuth();
  const [extension, setExtension] = useState(teacherProfile?.extension || "");
  const [extSaving, setExtSaving] = useState(false);

  const handleSaveExtension = async () => {
    if (!userData?.email || !teacherProfile) return;
    const cleanExt = extension.trim();
    if (cleanExt && isMobileNumberPattern(cleanExt)) {
      const confirmSave = confirm("개인 휴대전화 번호로 보입니다. 그래도 저장할까요?");
      if (!confirmSave) return;
    }
    setExtSaving(true);
    try {
      const profileRef = doc(db, "teacher_profiles", userData.email);
      await updateDoc(profileRef, {
        extension: cleanExt,
        updatedAt: serverTimestamp(),
        updatedBy: userData.email,
      });
      invalidateClientCache("teacher_profiles:all");
      alert("내선번호가 저장되었습니다.");
    } catch (err: any) {
      alert(`저장 실패: ${err.message || "오류가 발생했습니다."}`);
    } finally {
      setExtSaving(false);
    }
  };

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
    setNoDept(false);
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
    if (noDept) {
      setNoDept(false);
      return;
    }
    setNoDept(true);
    setSelectedDepts([]);
    setDeptHeadMap({});
    setPosition("");
    setExtension("");
    setIsHomeroom(false);
  };

  const handleSubmit = async () => {
    if (!userData?.email) return;
    if (!noDept && selectedDepts.length === 0) {
      alert("소속 부서를 1개 이상 선택하거나 '해당사항 없음'을 선택해 주세요.");
      return;
    }
    if (!noDept && !position) {
      alert("직책을 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      let name = (userData as any).name || (userData as any).displayName;
      // "@" 검사만으로는 이메일 로컬부가 그대로 굳은 이름(예: sabian07)을 못 거른다 —
      // 그 이름이 pending에 실리면 승인 경로를 타고 다시 Firestore에 저장된다(02d09c8 구멍의 우회로).
      if (!name || name.includes("@") || isFrozenLocalPartName(name, userData.email)) {
        name = ""; // 오염값을 버린다 — GWS 캐시 미스면 ""로 저장(표시 폴백은 그릴 때만, 02d09c8 규약)
        const cachedUsers = getClientCache("users:all");
        if (Array.isArray(cachedUsers)) {
          const userEmail = userData.email.toLowerCase();
          const found = cachedUsers.find((u: any) => (u.primaryEmail || u.email || "").toLowerCase() === userEmail);
          if (found?.name) {
            name = found.name.fullName || (found.name.familyName ? `${found.name.familyName}${found.name.givenName || ""}` : null);
          }
        }
      }
      name = (name || "").trim();

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

      invalidateClientCache("teacher_profiles:all");
      setDone(true);
    } catch (err) {
      console.error("프로필 신청 저장 실패", err);
      alert("신청 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  // body 포털: 이 모달의 호스트(MyProfileCard)는 사이드바 안에 있어서, 그대로 렌더하면
  // 사이드바의 스크롤·스택 컨텍스트에 갇혀 세로 줄·하단 잘림이 생긴다 (2026-08-20 실기기,
  // 「내 조직 정보 신청」 메뉴 입구). 포털이면 어느 입구로 열어도 화면 최상위에 뜬다.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">
            {teacherProfile ? "✏️ 내 정보 관리" : "📝 내 정보 관리"}
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

            <DeptPositionPicker
              departments={departments}
              positions={positions}
              noDept={noDept}
              onNoDeptToggle={handleNoDeptToggle}
              selectedDepts={selectedDepts}
              onToggleDept={toggleDept}
              deptHeadMap={deptHeadMap}
              onDeptHeadChange={(dept, checked) =>
                setDeptHeadMap(prev => ({ ...prev, [dept]: checked }))
              }
              position={position}
              onPositionChange={setPosition}
            />

            {/* ── 내선번호 (즉시 저장) ── */}
            {!noDept && (
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-2">
                <label className="block text-sm font-semibold text-gray-800">
                  내선번호 (선택)
                </label>

                {!teacherProfile ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg font-medium">
                    💡 조직 정보 승인 후 내선번호를 입력할 수 있습니다.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={20}
                        value={extension}
                        onChange={(e) => setExtension(e.target.value)}
                        placeholder="예: 1234, 교무실 1234"
                        className="flex-1 max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleSaveExtension}
                        disabled={extSaving}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 shrink-0"
                      >
                        {extSaving ? "저장 중…" : "내선 저장"}
                      </button>
                    </div>

                    {isMobileNumberPattern(extension) && (
                      <p className="text-xs text-amber-600 font-medium">
                        ⚠️ 휴대전화 번호로 보입니다. 학교 내선번호만 입력해 주세요.
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      내선번호는 승인 절차 없이 즉시 반영되며 전 교직원에게 보입니다. 개인 휴대전화 번호는 적지 마세요.
                    </p>
                  </>
                )}
              </div>
            )}



            {/* ── 담임 여부 (해당사항 없을 시 미노출) ── */}
            {!noDept && (
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

                    {/* 반 선택 */}
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
            )}

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
    </div>,
    document.body
  );
}
