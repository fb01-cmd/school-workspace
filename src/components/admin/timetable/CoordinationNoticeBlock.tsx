"use client";

import React from "react";
import { CandidateCoordination } from "@/lib/timetable/types";
import { formatCoordinationText, getCoordinationAllParties } from "@/lib/timetable/utils";

interface CoordinationNoticeBlockProps {
  coordination?: CandidateCoordination;
  showParties?: boolean;
  isReverse?: boolean;
}

export default function CoordinationNoticeBlock({
  coordination,
  showParties = true,
  isReverse = false,
}: CoordinationNoticeBlockProps) {
  if (!coordination) return null;
  const isSimul = !!coordination.simul;
  const isVenue = !!coordination.conflicts && coordination.conflicts.length > 0;
  const allParties = getCoordinationAllParties(coordination);

  return (
    <div className="bg-red-50 border-2 border-red-500 rounded-xl p-3.5 space-y-2.5 text-xs text-red-950">
      <div className="font-extrabold flex items-center justify-between">
        <span className="flex items-center gap-1">
          <span>⚠️</span>
          <span>
            {isSimul && isVenue
              ? "당사자 양해 필요 (동시수업 묶음 이동 + 장소 조율)"
              : isSimul
              ? "당사자 양해 필요 (동시수업 묶음 이동)"
              : "당사자 양해 필요 (장소 조율)"}
          </span>
        </span>
        <span className="text-xs bg-red-200 text-red-950 border border-red-400 px-2 py-0.5 rounded font-black">
          ⚠️ 양해 필수
        </span>
      </div>

      {isSimul && coordination.simul && (
        <div className="space-y-1.5 pt-0.5">
          <div className="font-extrabold text-red-900 leading-snug">
            {isReverse
              ? "그 자리에는 여러 반이 함께 듣는 수업이 있습니다. 그 수업 전체가 선생님 자리로 오고, 선생님 수업이 그 교시로 갑니다."
              : "선생님 수업도 함께 옮겨집니다. 묶여 있는 모든 반의 수업이 같은 시간으로 함께 이동합니다."}
          </div>
          <div className="text-[11px] bg-white border border-red-200 rounded-lg p-2 space-y-1 font-sans">
            <div className="font-bold text-[11px] text-purple-950 flex items-center gap-1">
              <span>🧩</span>
              <span>
                [{coordination.simul.grade}학년 {coordination.simul.classNums.join("·")}반] {coordination.simul.label} (
                {coordination.simul.steps.length}개 반 함께 이동):
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {coordination.simul.steps.map((step, idx) => (
                <div
                  key={`${step.classNum}-${idx}`}
                  className="text-[11px] leading-tight text-gray-900 bg-gray-50 rounded p-1.5 border border-gray-200 flex items-center justify-between"
                >
                  <span>
                    <strong>{step.classNum}반</strong>: {step.groupLesson.subjectName} ({step.groupLesson.teacherName})
                  </span>
                  <span className="font-semibold text-purple-800 ml-1">
                    {step.kind === "swap" && step.counterpart
                      ? `↔ ${step.counterpart.teacherName} (${step.counterpart.subjectName})`
                      : "➔ 빈 교시 이동"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {coordination.simul.warnings && coordination.simul.warnings.length > 0 && (
            <div className="text-[11px] text-amber-900 bg-amber-50 rounded p-1.5 border border-amber-200 font-semibold">
              ⚠️ {coordination.simul.warnings.join(" / ")}
            </div>
          )}
        </div>
      )}

      {isVenue && (
        <div className={`text-red-900 leading-relaxed font-semibold ${isSimul ? "pt-1 border-t border-red-200" : ""}`}>
          {formatCoordinationText(coordination)}
        </div>
      )}

      {showParties && allParties.length > 0 && (
        <div className="pt-2 border-t border-red-200 text-gray-800">
          <span className="font-bold">👥 양해 필요 당사자: </span>
          <span className="font-extrabold text-red-900">{allParties.join(", ")}</span>
        </div>
      )}
    </div>
  );
}
