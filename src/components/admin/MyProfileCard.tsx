"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import MyProfileModal from "./MyProfileModal";

export default function MyProfileCard() {
  const { userData, teacherProfile } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  // Listen for custom event from other parts of the page (banner, sidebar)
  useEffect(() => {
    const handler = () => setModalOpen(true);
    document.addEventListener("openMyProfileModal", handler);
    return () => document.removeEventListener("openMyProfileModal", handler);
  }, []);

  const isTeacher = userData?.role === "super_admin" || userData?.role === "teacher";
  const isStudent = userData?.role === "student";

  if (isStudent) {
    const ou = userData?.orgUnitPath || "";
    const ouParts = ou.split("/").filter(Boolean);
    const parsedClass = ouParts.slice(1).join(" ");

    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <span className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-lg font-bold border border-indigo-100">
            소속 정보
          </span>
        </div>
        <div className="space-y-2 text-sm text-slate-700">
          <p className="flex items-center gap-2">
            <span className="w-5 text-center text-slate-400">📧</span>
            <span className="font-medium truncate text-slate-600" title={userData?.email}>{userData?.email}</span>
          </p>
          {parsedClass && (
            <p className="flex items-center gap-2">
              <span className="w-5 text-center text-slate-400">🏫</span>
              <span className="font-bold text-indigo-600">{parsedClass}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!isTeacher) return null;

  const hasProfile = !!teacherProfile;
  const noDept = teacherProfile?.noDept;
  const deptHeadMap = teacherProfile?.deptHeadMap || {};
  
  const deptsList = teacherProfile?.departments || [];
  const depts = noDept 
    ? "소속 없음" 
    : deptsList.map(d => !!deptHeadMap[d] ? `${d}(부장)` : d).join(", ");

  const position = teacherProfile?.position || "";
  const homeroom =
    teacherProfile?.isHomeroom && teacherProfile?.homeroom
      ? `${teacherProfile.homeroom.grade}학년 ${teacherProfile.homeroom.class}반 담임`
      : null;

  return (
    <>
      <div className="bg-indigo-900/60 rounded-xl p-4 space-y-3">
        <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
          내 조직 정보
        </div>

        {hasProfile ? (
          <div className="space-y-1.5">
            {depts && (
              <p className="text-xs text-indigo-200 leading-relaxed">
                <span className="text-indigo-400 font-semibold">소속 </span>
                {depts}
              </p>
            )}
            {position && (
              <p className="text-xs text-indigo-200">
                <span className="text-indigo-400 font-semibold">직책 </span>
                {position}
              </p>
            )}
            {homeroom && (
              <p className="text-xs text-amber-300 font-semibold">🏫 {homeroom}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-amber-300 leading-relaxed">
            ⚠️ 조직 정보가 아직 등록되지 않았습니다.
          </p>
        )}

        <button
          onClick={() => setModalOpen(true)}
          className="w-full text-center py-1.5 text-xs font-semibold rounded-lg bg-indigo-700/60 hover:bg-indigo-600/80 text-indigo-200 hover:text-white transition-colors"
        >
          {hasProfile ? "✏️ 정보 수정 신청" : "📝 조직 정보 등록 신청"}
        </button>
      </div>

      {modalOpen && <MyProfileModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
