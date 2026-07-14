"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { auth, db } from "@/lib/firebase/config";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export default function TransferDeadlinePage() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const [taskData, setTaskData] = useState<any>(null);
  const [taskLoading, setTaskLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  const toDateInput = (d: Date) => d.toISOString().split("T")[0];

  useEffect(() => {
    if (loading) return;
    if (!user || !userData) { router.replace("/login"); return; }

    const domain = userData.domain;
    const email = userData.email;
    if (!domain || !email) return;

    getDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email))
      .then((snap) => {
        if (!snap.exists()) {
          // 전출 레코드 없음 → 정상 어드민으로 복귀
          router.replace("/admin");
          return;
        }
        const data = snap.data();
        if (data.status !== "PENDING_DEADLINE") {
          // 이미 기한 설정된 경우 → 완료 화면 보여주기
          if (data.status === "DEADLINE_SET") {
            setSubmitted(true);
            const dl = data.deadlineDate?.toDate ? data.deadlineDate.toDate() : new Date(data.deadlineDate);
            setSelectedDate(toDateInput(dl));
          } else {
            router.replace("/admin");
            return;
          }
        }
        setTaskData(data);
      })
      .catch(console.error)
      .finally(() => setTaskLoading(false));
  }, [user, userData, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_teacher_deadline",
          domain: userData?.domain,
          teacherEmail: userData?.email,
          deadlineDate: selectedDate,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "기한 설정 실패");
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || taskLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <p className="text-gray-500 animate-pulse">계정 정보를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 rounded-full px-4 py-1.5 text-amber-300 text-sm font-medium mb-4">
            <span>⚠️</span>
            <span>중요 안내</span>
          </div>
          <h1 className="text-2xl font-bold text-white">학교 구글 계정 정리 기한 설정</h1>
          <p className="text-slate-400 mt-2 text-sm">
            {userData?.email} 선생님
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {submitted ? (
            /* 제출 완료 화면 */
            <div className="p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <span className="text-3xl">✅</span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">기한 설정이 완료되었습니다</h2>
              <p className="text-gray-600 text-sm">
                선택하신 날짜(<strong>{selectedDate}</strong>)에 계정이 일시정지되며,<br />
                이후 30일이 경과하면 영구적으로 삭제됩니다.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left text-sm text-blue-800">
                <p className="font-semibold mb-2">📦 지금 바로 데이터를 백업하세요</p>
                <a
                  href="https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  → 구글 데이터 이전 및 다운로드 가이드 바로가기
                </a>
              </div>
              <button
                onClick={() => signOut(auth).then(() => router.replace("/login"))}
                className="w-full mt-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors"
              >
                로그아웃
              </button>
            </div>
          ) : (
            /* 기한 선택 폼 */
            <div className="p-8 space-y-6">
              {/* 안내 사항 */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 space-y-2">
                <p className="font-bold text-amber-800">📋 전출 처리 안내</p>
                <p>학교 행정상 선생님의 구글 워크스페이스 보안그룹 및 클래스룸 접근 권한이 <strong>이미 해제</strong>되었습니다.</p>
                <p>구글 계정 자체는 아직 유지되고 있으나, <strong>아래에서 데이터 백업 완료 예정일(기한)을 직접 선택</strong>해 주셔야 합니다.</p>
                <ul className="list-disc list-inside space-y-1 text-amber-700 mt-2">
                  <li>선택하신 날짜에 계정이 <strong>일시정지</strong>됩니다</li>
                  <li>일시정지 후 <strong>30일이 경과</strong>하면 계정이 영구 삭제됩니다</li>
                  <li>기한은 <strong>최대 1년 이내</strong>로 설정 가능합니다</li>
                </ul>
              </div>

              {/* 데이터 백업 가이드 */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-2">📦 데이터 이전 및 다운로드 방법</p>
                <a
                  href="https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  → 구글 워크스페이스 데이터 이전 공식 가이드 바로가기 ↗
                </a>
              </div>

              {/* 날짜 선택 폼 */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    📅 계정 정지 희망 날짜 (데이터 백업 완료 예정일)
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    min={toDateInput(minDate)}
                    max={toDateInput(maxDate)}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:border-indigo-500 text-sm transition-colors"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">내일부터 최대 1년 이내의 날짜를 선택하세요.</p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                    ❌ {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !selectedDate}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl disabled:opacity-50 transition-colors"
                >
                  {submitting ? "제출 중..." : "✅ 위 날짜로 기한 설정 완료"}
                </button>
              </form>

              <div className="text-center">
                <button
                  onClick={() => signOut(auth).then(() => router.replace("/login"))}
                  className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-4">
          궁금하신 점은 학교 정보부에 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
