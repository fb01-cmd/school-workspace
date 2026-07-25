"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface RosterApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  createdBy: string;
}

export default function RosterApiKeyManager() {
  const { userData } = useAuth();
  const [keys, setKeys] = useState<RosterApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [issuedKey, setIssuedKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      } else {
        const data = await res.json();
        alert(`API 키 목록 조회 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`API 키 목록을 불러오는 중 오류 발생: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      alert("API 키 용도를 입력해 주세요. (예: 지필평가 현황판)");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: newKeyName.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIssuedKey({ key: data.key, name: data.name });
        setNewKeyName("");
        fetchKeys();
      } else {
        alert(`API 키 발급 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`API 키 발급 처리 중 오류 발생: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string, keyName: string) => {
    if (
      !confirm(
        `정말로 API 키 '${keyName}'을(를) 폐기하시겠습니까?\n\n이 키를 사용하는 외부 애플리케이션의 학생 명단 공급이 즉시 차단됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", keyId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert("API 키가 성공적으로 폐기되었습니다.");
        fetchKeys();
      } else {
        alert(`API 키 폐기 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`API 키 폐기 중 오류 발생: ${err.message}`);
    }
  };

  const handleCopyKey = () => {
    if (!issuedKey) return;
    navigator.clipboard.writeText(issuedKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const domain = userData?.domain || "hmh.or.kr";
  const apiBaseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & API Usage Guide */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span>🔑</span>
              <span>읽기 전용 명단 API 키 관리</span>
            </h2>
            <p className="text-slate-500 text-xs mt-1">
              외부 서비스(지필평가·모의고사 현황판, 교육과정 선택 플랫폼, 구글 시트 등)에 수동 업로드 없이 항상 최신 학생 명단을 자동 공급할 수 있습니다.
            </p>
          </div>
          <button
            onClick={fetchKeys}
            disabled={loading}
            className="self-start sm:self-auto bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            🔄 목록 새로고침
          </button>
        </div>

        {/* API Specification Info Box */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs space-y-3 text-slate-700">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <span>📡 명단 피드 API 규격</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <span className="font-semibold text-slate-500 block mb-1">엔드포인트 URL</span>
              <code className="bg-white border border-slate-200 px-2 py-1 rounded font-mono text-indigo-600 block truncate">
                {apiBaseUrl}/api/roster/feed
              </code>
            </div>
            <div>
              <span className="font-semibold text-slate-500 block mb-1">인증 방식 (HTTP Header)</span>
              <code className="bg-white border border-slate-200 px-2 py-1 rounded font-mono text-emerald-600 block truncate">
                Authorization: Bearer &lt;API키&gt;
              </code>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <span className="font-semibold text-slate-800 block mb-1">지원 쿼리 파라미터</span>
            <ul className="list-disc pl-5 space-y-1 text-slate-600 text-[11px]">
              <li>
                <code className="font-mono bg-white px-1 border rounded">?grade=1</code> — 특정 학년만 필터링 (예: 1학년 명단만)
              </li>
              <li>
                <code className="font-mono bg-white px-1 border rounded">?format=csv</code> — 앱스스크립트/구글 시트 IMPORTRANGE 직접 소비용 UTF-8 BOM CSV 출력
              </li>
              <li>
                <code className="font-mono bg-white px-1 border rounded">?includeSuspended=true</code> — 정지(학업중단/휴학) 계정 포함 (기본값: false 미포함)
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 2. New API Key Issuance Form */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
          <span>➕</span>
          <span>새 명단 API 키 발급</span>
        </h3>
        <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              사용 용도 (앱/서비스 라벨)
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: 지필평가 현황판 시트, 교육과정 선택 웹앱, 생활지도 연동"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            {creating ? "발급 처리 중..." : "🔑 API 키 발급하기"}
          </button>
        </form>
      </div>

      {/* 3. Single-time Plaintext Key Display Modal/Banner */}
      {issuedKey && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 shadow-lg space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
              <span className="text-xl">⚠️</span>
              <span>API 키가 발급되었습니다 ({issuedKey.name})</span>
            </div>
            <button
              onClick={() => setIssuedKey(null)}
              className="text-amber-700 hover:text-amber-950 text-xs font-bold px-2 py-1 rounded hover:bg-amber-100 transition-colors"
            >
              닫기 ✕
            </button>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            보안을 위해 <strong>평문 API 키는 지금 단 1회만 표시</strong>되며, 저장소에는 SHA-256 해시값만 보관됩니다. 이 창을 닫으면 키를 다시 확인할 수 없으니 <strong>지금 즉시 복사하여 외부 앱 설정에 안전하게 보관</strong>해 주세요.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <div className="flex-1 bg-white border border-amber-300 rounded-lg p-2.5 font-mono text-xs text-slate-900 font-bold select-all break-all shadow-inner">
              {issuedKey.key}
            </div>
            <button
              onClick={handleCopyKey}
              className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
                copied
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              }`}
            >
              {copied ? "✅ 복사 완료!" : "📋 키 복사하기"}
            </button>
          </div>
        </div>
      )}

      {/* 4. Issued API Keys Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">
            발급된 명단 API 키 목록 ({keys.length}개)
          </h3>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            API 키 목록을 불러오는 중입니다...
          </div>
        ) : keys.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            발급된 명단 API 키가 없습니다. 위 입력 폼에서 새 API 키를 발급해 주세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-700">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-800 font-bold">
                <tr>
                  <th className="px-4 py-3">용도 (라벨)</th>
                  <th className="px-4 py-3">키 식별자 (Prefix)</th>
                  <th className="px-4 py-3">발급 일시</th>
                  <th className="px-4 py-3">최근 사용 시각</th>
                  <th className="px-4 py-3 text-center">상태</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      k.revoked ? "bg-slate-50/70 text-slate-400" : "text-slate-800"
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {k.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {k.keyPrefix}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {k.createdAt ? new Date(k.createdAt).toLocaleString("ko-KR") : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("ko-KR") : "미사용"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {k.revoked ? (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                          폐기됨
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          활성
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!k.revoked ? (
                        <button
                          onClick={() => handleRevokeKey(k.id, k.name)}
                          className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold px-2.5 py-1 rounded transition-colors"
                        >
                          키 폐기
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 select-none">폐기완료</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
