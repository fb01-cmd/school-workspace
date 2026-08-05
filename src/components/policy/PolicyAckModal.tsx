"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { POLICY_VERSION, POLICY_EFFECTIVE_DATE } from "@/lib/policy/version";
import Link from "next/link";

export default function PolicyAckModal() {
  const { userData, refreshUserData } = useAuth();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 전체 고지 페이지에서는 모달을 띄우지 않는다 — 확인 전에 전문을 자세히 읽으러
  // 들어온 페이지를 모달이 가로막으면 고지 취지가 훼손된다. 앱 화면으로 돌아오면 다시 뜬다.
  if (pathname === "/privacy") return null;

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
                  본 시스템은 효명고등학교가 학생 계정 관리, 생활지도, 시간표 운영 등 학교의 법령상 사무를
                  수행하기 위하여 운영합니다. 처리하는 개인정보의 항목과 방법을 다음과 같이 고지합니다.
                </p>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="p-2.5 w-1/4">저장 항목</th>
                      <th className="p-2.5 w-1/4">처리 목적</th>
                      <th className="p-2.5 w-1/4">열람 범위</th>
                      <th className="p-2.5 w-1/4">보유 기간</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">교직원 이메일·성명·담당 업무</td>
                      <td className="p-2.5">로그인 인증·권한 구분, 조직도 관리</td>
                      <td className="p-2.5">교직원</td>
                      <td className="p-2.5">전출·퇴직 시 삭제</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">학생 이메일·성명·학번</td>
                      <td className="p-2.5">계정 관리, 명렬표, 수업 정리</td>
                      <td className="p-2.5">교직원</td>
                      <td className="p-2.5">졸업·전출 시 삭제</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-slate-900 dark:text-white">학생 생활지도 기록</td>
                      <td className="p-2.5">학생 생활지도(민감 정보)</td>
                      <td className="p-2.5">담임(담당 학급)·권한 부여 교사</td>
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
                      <td className="p-2.5">시스템 운영 감사</td>
                      <td className="p-2.5">교직원. 수정·삭제 불가</td>
                      <td className="p-2.5">5년 보존 후 파기</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-slate-500 space-y-1">
                <p>• 주민등록번호, 전화번호, 주소, 학부모 정보는 수집·저장하지 않습니다.</p>
                <p>• 처리하는 개인정보가 변경되는 경우 본 안내를 개정하고 로그인 시 재고지합니다.</p>
              </div>
            </div>
          ) : (
            /* 학생용 고지 문안 */
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                <strong>효명고등학교 관리 시스템 개인정보 처리 안내 (학생용)</strong>
                <p className="mt-1">
                  본 시스템은 학교가 학생 계정과 학사 운영을 관리하기 위하여 운영합니다.
                </p>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <strong className="text-slate-900 dark:text-white">저장 항목:</strong> 학교 이메일, 성명, 학번. 생활지도 기록(담임 및 권한을 부여받은 교사만 열람 가능). 졸업 계정 정리 안내 확인 기록.
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <strong className="text-slate-900 dark:text-white">수집하지 않는 항목:</strong> 주민등록번호, 전화번호, 주소, 학부모 정보.
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <strong className="text-slate-900 dark:text-white">보유 기간:</strong> 졸업·전학 시 계정과 함께 정리됩니다.
                </div>
              </div>

              <div className="text-xs text-slate-500">
                • 처리하는 개인정보가 변경되는 경우 본 안내를 개정하고 로그인 시 재고지합니다.
              </div>
            </div>
          )}

          {/* 공통 조항 요약 — 위탁·이용자 권리·보호 조치 (전문은 /privacy) */}
          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-lg border border-slate-100 dark:border-slate-700 leading-relaxed">
            <p>• 본 시스템은 Google(Firebase)과 Vercel(미국 서버)을 이용하여 운영되며, 그 외 제3자에게 개인정보를 제공하지 않습니다.</p>
            <p>• 자신의 개인정보에 대한 열람·정정·삭제는 담임 교사 또는 플랫폼 담당자(playviolin@hmh.or.kr)에게 요청할 수 있습니다.</p>
            <p>• 학교 계정으로만 로그인할 수 있으며, 권한에 따라 열람 범위가 제한되고, 중요한 작업은 감사 기록으로 남습니다.</p>
          </div>

          <div className="text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
            <span>전체 문안은 안내 페이지에서 확인할 수 있습니다.</span>
            <Link href="/privacy" target="_blank" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              전체 안내 페이지 보기
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
              <span>확인했습니다</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
