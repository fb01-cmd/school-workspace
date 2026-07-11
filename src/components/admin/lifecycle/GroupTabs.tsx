"use client";

import { useState } from "react";
import { callAPI, Btn, ErrBox } from "./shared";

export function GroupDeleteTab({ ud, ouPaths, onDone, onNext }: any) {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");

  const allOUs = Object.values(ouPaths || {});
  const isTestMode = allOUs.some((path: any) => path?.includes("테스트") || path?.toLowerCase().includes("test"));
  const testPrefix = isTestMode ? "test-" : "";

  const run = async () => {
    const confirmMessage = isTestMode
      ? "⚠️ 테스트 모드 감지됨\n설정된 학생 OU가 테스트 경로입니다. 테스트용 반별 그룹(test-101@ ~ test-310@)만 선별하여 안전하게 삭제합니다. 진행하시겠습니까?"
      : "⚠️ 경고: 실제 운영 그룹 삭제\n현재 도메인의 모든 실제 반별 그룹(101@ ~ 310@)을 삭제합니다. 진행하시겠습니까?";

    if (!confirm(confirmMessage)) return;
    setRunning(true);
    setErr("");
    try {
      const response = await callAPI("delete_class_groups", { testPrefix }, ud);
      setRes(response);
      if (response && onDone) {
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
        <h3 className="text-lg font-bold mb-1">🗑️ 반별 그룹 전체 삭제</h3>
        <p className="text-sm text-gray-500">
          OU 전환 직후 실행. 진급 + 신입생 완료 후 그룹 재생성 탭에서 다시 만듭니다.
        </p>
      </div>

      {isTestMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
          ✨ <strong>테스트 모드 활성화됨:</strong> 학생 조직단위 경로에 '테스트'가 포함되어 있습니다. 
          실제 운영 중인 반별 그룹을 보호하기 위해, 이 작업은 <strong>test-</strong> 접두사가 붙은 그룹(예: <code>test-101@{ud?.domain}</code>)만 안전하게 삭제합니다.
        </div>
      )}

      <ErrBox msg={err} />
      {res ? (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="font-bold text-green-800 text-base">✅ 그룹 삭제 완료</p>
            <p className="text-green-700 text-sm mt-1">
              삭제 완료: <strong>{res.deleted}개</strong> / 전체 매칭: {res.total}개
              {res.failed > 0 && ` / 실패: ${res.failed}개`}
            </p>
            
            {/* Deleted Groups List */}
            {res.succeededList && res.succeededList.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-bold text-green-800">🗑️ 삭제된 그룹 목록 ({res.succeededList.length}개)</p>
                <div className="max-h-40 overflow-y-auto border border-green-100 rounded-xl p-3 bg-white font-mono text-xs text-green-700 divide-y divide-green-50">
                  {res.succeededList.map((email: string, idx: number) => (
                    <div key={idx} className="py-1">{email}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Failed Deletions List */}
            {res.failedList && res.failedList.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-bold text-red-700">❌ 삭제 실패 그룹 목록 ({res.failedList.length}개)</p>
                <div className="max-h-40 overflow-y-auto border border-red-100 rounded-xl p-3 bg-white font-mono text-xs text-red-600 divide-y divide-red-50">
                  {res.failedList.map((f: any, idx: number) => (
                    <div key={idx} className="py-1.5 flex justify-between">
                      <span>{f.email}</span>
                      <span className="text-red-500 font-sans">{f.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Btn onClick={() => { setRes(null); setErr(""); }} color="gray">
              다시 작업하기
            </Btn>
            {onNext && (
              <Btn onClick={onNext}>
                다음 단계로 →
              </Btn>
            )}
          </div>
        </div>
      ) : (
        <Btn onClick={run} disabled={running} color="red">
          {running ? "⏳ 삭제 중..." : "🗑️ 반별 그룹 전체 삭제"}
        </Btn>
      )}
    </div>
  );
}

export function GroupCreateTab({ ud, ouPaths, onDone, onComplete }: any) {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");

  const allOUs = Object.values(ouPaths || {});
  const isTestMode = allOUs.some((path: any) => path?.includes("테스트") || path?.toLowerCase().includes("test"));
  const testPrefix = isTestMode ? "test-" : "";

  const run = async () => {
    const confirmMessage = isTestMode
      ? "테스트 모드 감지됨\n테스트 조직단위 내 학생 학번을 기준으로 테스트용 반별 그룹(test-101@ ~ test-310@)을 안전하게 일괄 생성합니다. 진행하시겠습니까?"
      : "재학생 학번 기준으로 실제 운영 반별 그룹(101@ ~ 310@)을 일괄 생성합니다. 진행하시겠습니까?";

    if (!confirm(confirmMessage)) return;
    setRunning(true);
    setErr("");
    try {
      const response = await callAPI("create_class_groups", { studentOUPaths: ouPaths, testPrefix }, ud);
      setRes(response);
      if (response && onDone) {
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
        <h3 className="text-lg font-bold mb-1">👥 반별 그룹 일괄 생성</h3>
        <p className="text-sm text-gray-500">
          진급 + 신입생 완료 후 실행. 학번 기준으로 <strong>101@~310@</strong> 그룹 자동 생성.
        </p>
      </div>

      {isTestMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
          ✨ <strong>테스트 모드 활성화됨:</strong> 학생 조직단위 경로에 '테스트'가 포함되어 있습니다. 
          실제 운영 중인 반별 그룹을 보호하기 위해, 이 작업은 <strong>test-</strong> 접두사가 붙은 그룹(예: <code>test-101@{ud?.domain}</code>)으로 안전하게 생성하고 멤버를 구성합니다.
        </div>
      )}

      <ErrBox msg={err} />
      {res ? (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="font-bold text-green-800 text-base">✅ 그룹 생성 완료!</p>
            <p className="text-green-700 text-sm mt-1">
              생성 성공: <strong>{res.created}개 그룹</strong> / 멤버: <strong>{res.membersAdded}명</strong>
              {res.failed > 0 && ` / 실패: ${res.failed}개 그룹`}
            </p>

            {/* Created Groups List */}
            {res.succeededList && res.succeededList.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-bold text-green-800">👥 생성/동기화된 그룹 목록 ({res.succeededList.length}개)</p>
                <div className="max-h-48 overflow-y-auto border border-green-100 rounded-xl p-3 bg-white text-xs divide-y divide-green-50">
                  {res.succeededList.map((g: any, idx: number) => (
                    <div key={idx} className="py-1.5 flex justify-between items-center text-green-900">
                      <div>
                        <span className="font-bold">{g.name}</span>
                        <span className="text-gray-400 font-mono text-[10px] ml-1.5">{g.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                          g.status === "created" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {g.status === "created" ? "신규 생성" : "기존 동기화"}
                        </span>
                        <span className="font-semibold text-gray-700">{g.membersCount}명 배정</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failed Creations List */}
            {res.failedList && res.failedList.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-bold text-red-700">❌ 생성 실패 그룹 목록 ({res.failedList.length}개)</p>
                <div className="max-h-48 overflow-y-auto border border-red-100 rounded-xl p-3 bg-white font-mono text-xs text-red-600 divide-y divide-red-50">
                  {res.failedList.map((f: any, idx: number) => (
                    <div key={idx} className="py-1.5 flex justify-between">
                      <span>{f.email}</span>
                      <span className="text-red-500 font-sans">{f.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Btn onClick={() => { setRes(null); setErr(""); }} color="gray">
              결과 닫기
            </Btn>
            {onComplete && (
              <Btn onClick={onComplete} color="indigo">
                신학기 준비 전체 완료 🎉
              </Btn>
            )}
          </div>
        </div>
      ) : (
        <Btn onClick={run} disabled={running} color="green">
          {running ? "⏳ 생성 중..." : "👥 반별 그룹 일괄 생성"}
        </Btn>
      )}
    </div>
  );
}
