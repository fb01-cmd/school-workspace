"use client";

import { useState } from "react";
import { callAPI, Btn, ErrBox } from "./shared";

export function GroupDeleteTab({ ud, onDone }: any) {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!confirm("현재 도메인의 모든 반별 그룹(101@~310@)을 삭제합니다.")) return;
    setRunning(true);
    setErr("");
    try {
      setRes(await callAPI("delete_class_groups", {}, ud));
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
      <ErrBox msg={err} />
      {res ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
          <p className="font-bold text-green-800">✅ 그룹 삭제 완료</p>
          <p className="text-green-700 mt-1">
            삭제: <strong>{res.deleted}개</strong> / 전체: {res.total}개
            {res.failed > 0 && ` / 실패: ${res.failed}개`}
          </p>
          {onDone && (
            <button onClick={onDone} className="mt-2 px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
              다음 단계로 →
            </button>
          )}
        </div>
      ) : (
        <Btn onClick={run} disabled={running} color="red">
          {running ? "⏳ 삭제 중..." : "🗑️ 반별 그룹 전체 삭제"}
        </Btn>
      )}
    </div>
  );
}

export function GroupCreateTab({ ud, ouPaths, onDone }: any) {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!confirm("재학생 학번 기준으로 반별 그룹을 일괄 생성합니다.")) return;
    setRunning(true);
    setErr("");
    try {
      setRes(await callAPI("create_class_groups", { studentOUPaths: ouPaths }, ud));
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
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">
        <p className="font-semibold mb-1">ℹ️ Groups API 스코프 필요</p>
        <p>구글 어드민 콘솔 → 보안 → API 제어 → 도메인 범위 위임 → 서비스 계정에 추가:</p>
        <code className="block mt-1 bg-blue-100 px-2 py-1 rounded">
          https://www.googleapis.com/auth/admin.directory.group
        </code>
      </div>
      <ErrBox msg={err} />
      {res ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="font-bold text-green-800">✅ 그룹 생성 완료!</p>
          <p className="text-green-700 text-sm mt-1">
            그룹: <strong>{res.created}개</strong> / 멤버: <strong>{res.membersAdded}명</strong>
            {res.failed > 0 && ` / 실패: ${res.failed}개`}
          </p>
          {onDone && (
            <button onClick={onDone} className="mt-2 px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
              신학기 준비 완료 ✓
            </button>
          )}
        </div>
      ) : (
        <Btn onClick={run} disabled={running} color="green">
          {running ? "⏳ 생성 중..." : "👥 반별 그룹 일괄 생성"}
        </Btn>
      )}
    </div>
  );
}
