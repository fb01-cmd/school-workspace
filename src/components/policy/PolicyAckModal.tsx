"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { POLICY_VERSION, POLICY_EFFECTIVE_DATE } from "@/lib/policy/version";
import Link from "next/link";

export default function PolicyAckModal() {
  const { userData, refreshUserData } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!userData) return null;

  // 이미 현재 정책 버전을 확인한 경우 모달을 띄우지 않음
  const currentAckVersion = userData.policyAck?.version;
  if (currentAckVersion === POLICY_VERSION) {
    return null;
  }

  const isTeacherRole = userData.role === "teacher" || userData.role === "super_admin";

  const handleAck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/policy/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ack" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "확인 처리에 실패했습니다.");
      }

      // 유저 데이터 최신화 (모달이 닫힘)
      if (refreshUserData) {
        await refreshUserData();
      } else {
        // 폴백: 새로고침
        window.location.reload();
      }
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
      <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* 모달 헤더 */}
        <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <span className="text-xs font-bold bg-indigo-600 text-white px-2.5 py-0.5 rounded-full">
                v{POLICY_VERSION} 필수 고지
              </span>
              <span className="text-xs text-slate-400">시행일: {POLICY_EFFECTIVE_DATE}</span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">
              개인정보 처리 안내 확인
            </h2>
          </div>
        </div>

        {/* 모달 본문 (스크롤) */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-slate-700 dark:text-slate-200">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs">
              {error}
            </div>
          )}

          {isTeacherRole ? (
            /* 교직원용 고지 문안 */
            <div className="space-y-4">
              <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/60 text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed">
                <strong>효명고등학교 관리 시스템 개인정보 처리 안내 (교직원용)</strong>
                <p className="mt-1">
                  이 시스템은 효명고등학교가 학교 업무(학생 계정 관리, 생활지도, 시간표 운영 등)를 처리하기 위해 운영합니다.
                  학교의 법령상 사무 수행을 위한 것으로, 처리하는 정보와 방법을 아래와 같이 알려드립니다.
                </p>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="p-2.5 w-1/4">무엇을 저장하나</th>
                      <th className="p-2.5 w-1/4">왜</th>
                      <th className="p-2.5 w-1/4">누가 볼 수 있나</th>
                      <th className="p-2.5 w-1/4">언제까지</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">선생님의 이메일·이름·업무</td>
                      <td className="p-2.5">로그인·권한 구분, 조직도</td>
                      <td className="p-2.5">교직원</td>
                      <td className="p-2.5">전출·퇴직 시 삭제</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">학생 이메일·이름·학번</td>
                      <td className="p-2.5">계정 관리, 명렬표, 수업 정리</td>
                      <td className="p-2.5">교직원</td>
                      <td className="p-2.5">졸업·전출 시 삭제</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">학생 생활지도 기록</td>
                      <td className="p-2.5">학생 생활지도 (민감)</td>
                      <td className="p-2.5">담임/권한 교사만</td>
                      <td className="p-2.5">졸업·제적 시 파기</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">시간표·교환 신청 내역</td>
                      <td className="p-2.5">시간표 운영</td>
                      <td className="p-2.5">교직원</td>
                      <td className="p-2.5">학년도 경과 후 정리</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">시스템 작업 감사 로그</td>
                      <td className="p-2.5">안전한 운영 확인</td>
                      <td className="p-2.5">교직원 (수정 불가)</td>
                      <td className="p-2.5">5년 보존 후 자동 파기</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>• 주민등록번호, 전화번호, 주소, 학부모 정보는 <strong>저장하지 않습니다</strong>.</p>
                <p>• <strong>이 시스템은 계속 개발 중입니다.</strong> 새 기능으로 처리 정보가 늘어나면 로그인 시 다시 알려드립니다.</p>
              </div>
            </div>
          ) : (
            /* 학생용 고지 문안 */
            <div className="space-y-4">
              <div className="bg-blue-50/80 dark:bg-blue-950/40 p-4 rounded-xl border border-blue-100 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                <strong>효명고 관리 시스템이 여러분의 정보를 다루는 방법</strong>
                <p className="mt-1">
                  이 시스템은 학교가 여러분의 구글 계정과 학교 생활을 관리하기 위해 운영합니다.
                </p>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                  <strong className="text-indigo-600 dark:text-indigo-400">📌 저장하는 것:</strong> 학교 이메일, 이름, 학번. 생활지도가 있었던 경우 그 기록(담당 선생님만 볼 수 있습니다). 졸업할 때 계정 정리를 위한 안내 확인 기록.
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                  <strong className="text-emerald-600 dark:text-emerald-400">🚫 저장하지 않는 것:</strong> 주민등록번호, 전화번호, 집 주소, 부모님 정보.
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                  <strong className="text-purple-600 dark:text-purple-400">⏳ 언제까지:</strong> 졸업하거나 전학 가면 계정과 함께 정리됩니다.
                </div>
              </div>

              <div className="text-xs text-slate-500">
                • 이 시스템은 계속 새로운 기능이 더해지고 있습니다. 다루는 정보가 달라지면 로그인할 때 다시 알려줍니다.
              </div>
            </div>
          )}

          <div className="text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
            <span>자세한 내용은 전체 안내 페이지를 참조하세요.</span>
            <Link href="/privacy" target="_blank" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              전체 고지 페이지 보기 ↗
            </Link>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="p-5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            위 안내 내용을 확인하였음을 기록합니다.
          </span>

          <button
            type="button"
            onClick={handleAck}
            disabled={loading}
            className="py-3 px-8 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50 transition-all text-sm flex items-center space-x-2"
          >
            {loading ? (
              <span>처리 중...</span>
            ) : (
              <span>✓ 확인했습니다</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
