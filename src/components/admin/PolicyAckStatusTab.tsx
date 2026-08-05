"use client";

import { useState, useEffect } from "react";
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

interface PolicyAckHistoryItem {
  id: string;
  uid: string;
  email: string;
  role: string;
  version: string;
  ackedAt: string;
}

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
    history: PolicyAckHistoryItem[];
  } | null>(null);

  const [activeSubTab, setActiveSubTab] = useState<"pending" | "acked" | "history">("pending");
  const [roleFilter, setRoleFilter] = useState<"all" | "teacher" | "student">("all");
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

  // 필터링 적용 (미확인자 / 확인 완료자)
  const filterUsers = (users: PolicyAckUser[]) => {
    return users.filter((u) => {
      // 역할 필터
      if (roleFilter === "teacher" && u.role !== "teacher" && u.role !== "super_admin") return false;
      if (roleFilter === "student" && u.role !== "student") return false;

      // 검색어 필터
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.grade && `${u.grade}학년`.includes(q))
        );
      }

      return true;
    });
  };

  const filteredPending = filterUsers(data.pendingUsers);
  const filteredAcked = filterUsers(data.ackedUsers);

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 및 요약 정보 */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full">
              수퍼어드민 전용
            </span>
            <span className="text-xs text-slate-400 font-mono">현재 버전: v{data.currentVersion}</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">🔒 개인정보 처리 안내 고지 현황</h2>
          <p className="text-xs text-slate-500 mt-1">
            현재 버전(v{POLICY_VERSION}) 기준 개인정보 처리 안내 고지 확인 여부 및 미확인자 목록입니다.
          </p>
        </div>

        <button
          onClick={fetchData}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors self-start md:self-auto"
        >
          🔄 현황 새로고침
        </button>
      </div>

      {/* 요약 카운터 카드리스트 */}
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

      {/* 서브 탭 & 필터 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex border-b sm:border-b-0 space-x-2">
            <button
              onClick={() => setActiveSubTab("pending")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition-all ${
                activeSubTab === "pending"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              ⏳ 미확인자 ({data.pendingCount}명)
            </button>

            <button
              onClick={() => setActiveSubTab("acked")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition-all ${
                activeSubTab === "acked"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              ✅ 확인 완료자 ({data.ackedCount}명)
            </button>

            <button
              onClick={() => setActiveSubTab("history")}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition-all ${
                activeSubTab === "history"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              📜 이력 전체 ({data.history.length}건)
            </button>
          </div>

          {activeSubTab !== "history" && (
            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="p-2 border border-slate-300 rounded-lg text-xs bg-white text-slate-800"
              >
                <option value="all">전체 구분</option>
                <option value="teacher">교직원</option>
                <option value="student">학생</option>
              </select>

              <input
                type="text"
                placeholder="이름 또는 이메일 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="p-2 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 w-44"
              />
            </div>
          )}
        </div>

        {/* 탭 1: 미확인자 목록 */}
        {activeSubTab === "pending" && (
          <div className="divide-y divide-slate-100">
            {filteredPending.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                현재 모든 사용자가 고지를 확인하였거나 조건에 맞는 미확인자가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">구분</th>
                      <th className="p-3">이름</th>
                      <th className="p-3">이메일</th>
                      <th className="p-3">학급 정보</th>
                      <th className="p-3">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPending.map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.role === "super_admin"
                              ? "bg-purple-100 text-purple-800"
                              : u.role === "teacher"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                          }`}>
                            {u.role === "super_admin" ? "수퍼어드민" : u.role === "teacher" ? "교사" : "학생"}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{u.name}</td>
                        <td className="p-3 font-mono text-slate-600">{u.email}</td>
                        <td className="p-3 text-slate-500">
                          {u.grade && u.classNum ? `${u.grade}학년 ${u.classNum}반` : "-"}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                            미확인 (다음 로그인 시 고지 노출)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 탭 2: 확인 완료자 목록 */}
        {activeSubTab === "acked" && (
          <div className="divide-y divide-slate-100">
            {filteredAcked.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                확인 완료자 목록이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">구분</th>
                      <th className="p-3">이름</th>
                      <th className="p-3">이메일</th>
                      <th className="p-3">확인 버전</th>
                      <th className="p-3">확인 시각</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAcked.map((u) => (
                      <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.role === "super_admin"
                              ? "bg-purple-100 text-purple-800"
                              : u.role === "teacher"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                          }`}>
                            {u.role === "super_admin" ? "수퍼어드민" : u.role === "teacher" ? "교사" : "학생"}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{u.name}</td>
                        <td className="p-3 font-mono text-slate-600">{u.email}</td>
                        <td className="p-3 font-mono font-bold text-emerald-600">v{u.policyAck?.version}</td>
                        <td className="p-3 text-slate-500">
                          {u.policyAck?.ackedAt?.toDate
                            ? u.policyAck.ackedAt.toDate().toLocaleString("ko-KR")
                            : u.policyAck?.ackedAt || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 탭 3: 개정 고지 이력 전체 */}
        {activeSubTab === "history" && (
          <div className="p-6 space-y-4">
            <p className="text-xs text-slate-500">
              `policy_acks` 컬렉션에 서버가 기록한 개정 이력 원본 증빙 문서들입니다. (위조 방지 적용)
            </p>

            {data.history.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed rounded-xl">
                기록된 고지 확인 이력이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">문서 ID</th>
                      <th className="p-3">사용자 계정</th>
                      <th className="p-3">역할</th>
                      <th className="p-3">고지 버전</th>
                      <th className="p-3">확인 일시</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.history.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50/80 transition-colors font-mono text-[11px]">
                        <td className="p-3 text-slate-400 truncate max-w-[150px]">{h.id}</td>
                        <td className="p-3 font-semibold text-slate-800">{h.email}</td>
                        <td className="p-3 text-slate-600">{h.role}</td>
                        <td className="p-3 font-bold text-indigo-600">v{h.version}</td>
                        <td className="p-3 text-slate-500">
                          {h.ackedAt ? new Date(h.ackedAt).toLocaleString("ko-KR") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
