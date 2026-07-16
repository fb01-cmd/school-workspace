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

  if (!isTeacher) return null;

  const hasProfile = !!teacherProfile;
  const depts = teacherProfile?.departments?.join(", ") || "";
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
            {teacherProfile?.subjects && teacherProfile.subjects.length > 0 && (
              <p className="text-xs text-indigo-200">
                <span className="text-indigo-400 font-semibold">과목 </span>
                {teacherProfile.subjects.join(", ")}
              </p>
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
