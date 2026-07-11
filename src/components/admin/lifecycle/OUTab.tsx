"use client";

import { useState, useEffect } from "react";
import { callAPI, Btn, ErrBox, StepTracker } from "./shared";

export default function OUTab({ s, ud, onDone, onNext }: any) {
  const ou = s?.ouMapping?.students || {};
  const g1 = ou["1"] || "";
  const g2 = ou["2"] || "";
  const g3 = ou["3"] || "";
  const parent = g1 ? g1.substring(0, g1.lastIndexOf("/")) || "/" : "/학생";

  const graduatesPath = s?.ouMapping?.graduates || "";
  const gradName = graduatesPath ? graduatesPath.substring(graduatesPath.lastIndexOf("/") + 1) : "졸업생";

  const archiveName = `이전 학년도 ${gradName}`;

  type SS = "pending" | "running" | "success" | "error";
  const [steps, setSteps] = useState<{ label: string; status: SS }[]>([]);

  useEffect(() => {
    setSteps([
      { label: graduatesPath
        ? `기존 "${gradName}" OU (${graduatesPath}) → "${archiveName}" (아카이브)`
        : `졸업생 OU 미설정 (건너뜀)`,
        status: "pending" },
      { label: `"3학년" OU (${g3 || "미설정"}) → "${gradName}"`, status: "pending" },
      { label: `"2학년" OU (${g2 || "미설정"}) → "3학년"`, status: "pending" },
      { label: `"1학년" OU (${g1 || "미설정"}) → "2학년"`, status: "pending" },
      { label: `새 "1학년" OU 생성 (${parent}/1학년)`, status: "pending" },
    ]);
  }, [g1, g2, g3, gradName, archiveName, graduatesPath, parent]);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!g1 || !g2 || !g3) {
      setErr("조직단위 설정(⚙️)에서 1~3학년 OU 경로를 먼저 설정해 주세요.");
      return;
    }
    if (!confirm("⚠️ OU 이름 변경은 되돌리기 어렵습니다. 진행하시겠습니까?")) return;
    setRunning(true);
    setErr("");
    try {
      const res = await callAPI(
        "year_end_ou_transition",
        { grade1: g1, grade2: g2, grade3: g3, parentPath: parent, gradName, graduatesOUPath: graduatesPath },
        ud
      );
      setSteps((prev) =>
        prev.map((st, i) => {
          const found = res.steps?.find((r: any) => r.step === i);
          return found ? { ...st, status: found.status === "success" ? "success" : "error" } : st;
        })
      );
      setDone(res.success);
      if (res.success && onDone) {
        onDone();
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold mb-1">🔄 연도말 OU 전환</h3>
        <p className="text-sm text-gray-500">
          모든 작업의 첫 번째 단계. 학생 이동 없이 <strong>OU 이름 자체</strong>를 순서대로
          변경합니다.
        </p>
      </div>
      {!g1 || !g2 || !g3 ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          ⚠️ 조직단위 설정(⚙️ 메뉴)에서 1~3학년 OU 경로를 먼저 설정해 주세요.
        </div>
      ) : (
        <>
          <StepTracker steps={steps} startIndex={0} />
          <ErrBox msg={err} />
          {done ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 font-semibold">
              ✅ OU 전환 완료! 다음: 그룹 초기화 탭으로 이동하세요.
              {onNext && (
                <button onClick={onNext} className="ml-3 px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
                  다음 단계로 →
                </button>
              )}
            </div>
          ) : (
            <Btn onClick={run} disabled={running} color="violet">
              {running ? "⏳ 처리 중..." : "🚀 OU 전환 실행"}
            </Btn>
          )}
        </>
      )}
    </div>
  );
}
