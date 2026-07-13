"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, getDoc, query, where, orderBy } from "firebase/firestore";
import { ErrBox } from "./shared";

interface ConsentRecord {
  email: string;
  domain: string;
  name: string;
  studentId: string;
  consentedAt: any;
  signature: string;
  expiresAt: any;
}

export default function GraduationConsentsTab({ ud }: { s: any; ud: any }) {
  const domain = ud?.domain || "";
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Signature modal state
  const [selectedConsent, setSelectedConsent] = useState<ConsentRecord | null>(null);

  const loadConsents = async () => {
    if (!domain) return;
    setLoading(true);
    setErr("");
    try {
      const consentsCol = collection(db, "graduation_consents");
      // 복합 인덱스 생성 오류를 차단하기 위해 쿼리는 단일 필드로만 필터하고, 정렬은 메모리에서 처리합니다.
      const q = query(consentsCol, where("domain", "==", domain));
      const snap = await getDocs(q);
      const list = snap.docs.map((doc) => doc.data() as ConsentRecord);
      
      // JavaScript 메모리 상에서 정렬 (consentedAt 기준 역순)
      list.sort((a, b) => {
        const dateA = a.consentedAt?.toDate ? a.consentedAt.toDate() : new Date(a.consentedAt || 0);
        const dateB = b.consentedAt?.toDate ? b.consentedAt.toDate() : new Date(b.consentedAt || 0);
        return dateB.getTime() - dateA.getTime();
      });

      setConsents(list);
    } catch (e: any) {
      console.error("Failed to load consents archive:", e);
      setErr(`보관함 데이터를 불러오는 데 실패했습니다: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConsents();
  }, [domain]);

  const formatDate = (ts: any) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getFormatExpiry = (ts: any) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  // Filter lists based on search
  const filteredConsents = consents.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.studentId.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <ErrBox msg={err} />

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
            <span>🗄️</span> 졸업생 동의서 보관함 (2~3년 보존)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            구글 워크스페이스 계정이 삭제되어도 보존 연한(3년) 동안 법적 증빙을 위해 서명과 동의 데이터를 영구 보관합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadConsents}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border rounded-lg text-xs text-slate-700 font-bold transition-all"
          >
            🔄 새로고침
          </button>
          <button
            onClick={handlePrint}
            disabled={filteredConsents.length === 0}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50"
          >
            🖨️ 현재 명단 인쇄
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 p-4 border rounded-2xl">
        <div className="text-xs font-bold text-slate-700">
          총 보관 건수: <span className="text-indigo-600 font-mono">{filteredConsents.length}</span> / {consents.length}건
        </div>
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="이름, 학번, 이메일로 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-slate-700"
          />
        </div>
      </div>

      {/* Table Listing */}
      <div className="bg-white border rounded-2xl overflow-hidden shadow-2xs print:border-none print:shadow-none">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs">보관함을 조회하는 중...</div>
          ) : filteredConsents.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">보관된 동의서 내역이 없습니다.</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-slate-500 uppercase font-semibold">
                  <th className="px-6 py-3.5 w-24">학번</th>
                  <th className="px-6 py-3.5 w-32">이름</th>
                  <th className="px-6 py-3.5">이메일</th>
                  <th className="px-6 py-3.5 w-48">서명 제출 일시</th>
                  <th className="px-6 py-3.5 w-36">보존 만료 예정일</th>
                  <th className="px-6 py-3.5 w-32 text-center print:hidden">증빙 조회</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredConsents.map((c) => (
                  <tr key={c.email} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3.5 font-bold font-mono">{c.studentId || "-"}</td>
                    <td className="px-6 py-3.5 font-bold">{c.name}</td>
                    <td className="px-6 py-3.5 font-mono text-slate-500">{c.email}</td>
                    <td className="px-6 py-3.5 font-mono text-slate-600">{formatDate(c.consentedAt)}</td>
                    <td className="px-6 py-3.5 font-mono text-slate-400">{getFormatExpiry(c.expiresAt)}</td>
                    <td className="px-6 py-3.5 text-center print:hidden">
                      <button
                        onClick={() => setSelectedConsent(c)}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-100 rounded-lg text-[10px] transition-colors"
                      >
                        📄 증빙 보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Signature Proof Viewer Modal */}
      {selectedConsent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden animate-scale-up flex flex-col">
            <div className="bg-indigo-700 text-white p-4 font-bold text-xs flex justify-between items-center">
              <span>✍️ 영구 보관 동의 증빙</span>
              <button
                type="button"
                onClick={() => setSelectedConsent(null)}
                className="text-white hover:text-slate-200 font-bold text-sm"
              >
                ✕
              </button>
            </div>
            
            <div className="p-5 space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border rounded-xl">
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">졸업생 이름</span>
                  <span className="text-slate-800 font-bold mt-0.5 block">{selectedConsent.name}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">학번</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">{selectedConsent.studentId}</span>
                </div>
                <div className="col-span-2 border-t border-slate-100 pt-2 mt-1">
                  <span className="text-[10px] text-slate-400 block font-medium">구글 계정 이메일</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">{selectedConsent.email}</span>
                </div>
                <div className="col-span-2 border-t border-slate-100 pt-2">
                  <span className="text-[10px] text-slate-400 block font-medium">동의 및 서명 일시</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">
                    {formatDate(selectedConsent.consentedAt)}
                  </span>
                </div>
                <div className="col-span-2 border-t border-slate-100 pt-2">
                  <span className="text-[10px] text-slate-400 block font-medium">법적 보존 연한 (3년)</span>
                  <span className="text-slate-500 font-bold mt-0.5 block font-mono">
                    {getFormatExpiry(selectedConsent.expiresAt)} 까지 보관
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400 block font-medium">수집된 친필 서명 데이터</span>
                <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 h-32 flex items-center justify-center">
                  {selectedConsent.signature?.startsWith("data:image/") ? (
                    <img 
                      src={selectedConsent.signature} 
                      alt="Student signature" 
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-slate-400 font-bold text-[11px]">{selectedConsent.signature}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedConsent(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-850 text-white font-bold text-xs rounded-xl transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
