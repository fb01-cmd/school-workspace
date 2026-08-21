"use client";

import { useState, useEffect, useMemo } from "react";
import { POLICY_VERSION } from "@/lib/policy/version";

interface PolicyAckUser {
  uid: string;
  email: string;
  name: string;
  role: string;
  grade?: number;
  classNum?: number;
  policyAck?: {
    version: string;
    ackedAt: any;
  };
}

/**
 * ackedAt은 경로에 따라 세 형태로 도착한다 — ① 클라이언트 SDK Timestamp(.toDate 보유)
 * ② 서버(admin SDK) JSON 직렬화 {_seconds,_nanoseconds}(또는 {seconds,nanoseconds})
 * ③ ISO 문자열/숫자. 어떤 형태든 문자열로만 반환하는 단일 통로.
 */
const formatAckTime = (v: any): string => {
  if (!v) return "-";
  if (typeof v.toDate === "function") return v.toDate().toLocaleString("ko-KR");
  const secs = v?._seconds ?? v?.seconds;
  if (typeof secs === "number") return new Date(secs * 1000).toLocaleString("ko-KR");
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleString("ko-KR");
  }
  return "-";
};

export default function PolicyAckStatusTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    currentVersion: string;
    totalCount: number;
    ackedCount: number;
    pendingCount: number;
    pendingUsers: PolicyAckUser[];
    ackedUsers: PolicyAckUser[];
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/policy/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "개인정보 고지 현황을 불러오지 못했습니다.");
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 전체 유저 목록 합성 (확인자 + 미확인자)
  const allUsers = useMemo(() => {
    if (!data) return [];
    return [...data.ackedUsers, ...data.pendingUsers];
  }, [data]);

  // 검색 결과
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allUsers.filter((u) => {
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [allUsers, searchQuery]);

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-500">
        <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        개인정보 고지 확인 현황을 불러오는 중...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 text-red-700 rounded-xl border border-red-200 text-center">
        {error || "데이터를 불러올 수 없습니다."}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full">
              관리자 전용
            </span>
            <span className="text-xs text-slate-400 font-mono">현재 버전: v{data.currentVersion}</span>
          </div>
        </div>

        <button
          onClick={fetchData}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors self-start md:self-auto"
        >
          🔄 현황 새로고침
        </button>
      </div>

      {/* 요약 카운터 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-500">총 사용자 수</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{data.totalCount}명</div>
          </div>
          <span className="p-3 bg-slate-100 text-slate-600 rounded-xl text-xl">👥</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-emerald-600">고지 확인 완료</div>
            <div className="text-2xl font-extrabold text-emerald-700 mt-1">{data.ackedCount}명</div>
          </div>
          <span className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-xl">✅</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-amber-600">미확인자 (확인 필요)</div>
            <div className="text-2xl font-extrabold text-amber-700 mt-1">{data.pendingCount}명</div>
          </div>
          <span className="p-3 bg-amber-50 text-amber-600 rounded-xl text-xl">⏳</span>
        </div>
      </div>

      {/* 검색 조회 섹션 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">🔍 개별 사용자 확인 여부 조회</h3>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="이름 또는 이메일 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-72 p-2.5 pl-9 border border-slate-300 rounded-xl text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
            <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
          </div>
        </div>

        {/* 검색 결과 표시 */}
        {searchQuery.trim() === "" ? (
          <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            조회할 교직원 또는 학생의 이름이나 이메일을 검색창에 입력해 주세요.
          </div>
        ) : searchResults.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            검색 결과가 없습니다. (입력한 &quot;{searchQuery}&quot;와(과) 일치하는 사용자가 없습니다.)
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">구분</th>
                  <th className="p-3">이름</th>
                  <th className="p-3">이메일</th>
                  <th className="p-3">확인 여부</th>
                  <th className="p-3">확인 시각</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {searchResults.map((u) => {
                  const isAcked = u.policyAck && u.policyAck.version === POLICY_VERSION;
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            u.role === "super_admin"
                              ? "bg-purple-100 text-purple-800"
                              : u.role === "teacher"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {u.role === "super_admin" ? "관리자" : u.role === "teacher" ? "교사" : "학생"}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-900">{u.name}</td>
                      <td className="p-3 font-mono text-slate-600">{u.email}</td>
                      <td className="p-3">
                        {isAcked ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded inline-flex items-center gap-1">
                            ✅ 확인 완료 (v{u.policyAck?.version})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded inline-flex items-center gap-1">
                            ⏳ 미확인
                          </span>
                        )}
                      </td>
                      {/* 현재 버전 미확인이어도 이전 버전 확인 이력은 보여준다 — 이 화면의 존재
                          이유가 증빙이므로, "확인한 적 있음"과 "한 번도 확인 안 함"이 똑같이
                          "-"로 보이면 분쟁·감사 때 답을 못 한다. */}
                      <td className="p-3 text-slate-600 font-mono">
                        {isAcked ? (
                          formatAckTime(u.policyAck?.ackedAt)
                        ) : u.policyAck?.version ? (
                          <span className="text-slate-400">
                            이전 v{u.policyAck.version} · {formatAckTime(u.policyAck.ackedAt)}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 증빙 원본 안내 문구 */}
        <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-100 flex items-center gap-1.5">
          <span>📜</span>
          <span>
            서버의 <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">policy_acks</code> 컬렉션에 사용자의 개정 고지 확인 이력 원본 증빙 문서가 이력별로 자동 보존됩니다.
          </span>
        </div>
      </div>
    </div>
  );
}
