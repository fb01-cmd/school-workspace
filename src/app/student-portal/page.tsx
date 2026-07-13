"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { doc, getDoc } from "firebase/firestore";

export default function StudentPortal() {
  const { userData } = useAuth();
  const router = useRouter();

  // Graduation states
  const [gradTask, setGradTask] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form states
  const [checkingDeletion, setCheckingDeletion] = useState(false);
  const [checkingDownload, setCheckingDownload] = useState(false);
  const [submittingConsent, setSubmittingConsent] = useState(false);

  const handleLogout = async () => {
    await logOut();
    router.push("/login");
  };

  const loadGradTask = async () => {
    if (!userData?.email || !userData?.domain) return;
    try {
      // 1. Fetch student's graduation task status
      const docRef = doc(db, "graduation_tasks", userData.domain, "students", userData.email);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const taskData = snap.data();
        setGradTask(taskData);
        // Show modal if consent is not yet submitted
        if (!taskData.consentSubmitted && taskData.status === "PENDING") {
          setShowModal(true);
        }
      }

      // 2. Fetch settings to show dates
      const settingsRef = doc(db, "settings", userData.domain);
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        setSettings(settingsSnap.data());
      }
    } catch (err) {
      console.error("Failed to load student graduation status:", err);
    } finally {
      setLoadingTask(false);
    }
  };

  useEffect(() => {
    if (userData) {
      loadGradTask();
    }
  }, [userData]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);

  // Mouse & Touch coordinate helper
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    if ("touches" in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      // Prevent default scrolling on mobile touch
      if (e.cancelable) e.preventDefault();
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#1e293b"; // slate-800
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSigned(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const handleSubmitConsent = async () => {
    if (!checkingDeletion || !checkingDownload || !userData?.email || !userData?.domain) return;
    
    const canvas = canvasRef.current;
    if (!canvas || !hasSigned) {
      alert("안내 확인 서명을 진행해 주세요.");
      return;
    }

    setSubmittingConsent(true);
    try {
      const signatureDataUrl = canvas.toDataURL("image/png");

      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_student_consent",
          email: userData.email,
          domain: userData.domain,
          signature: signatureDataUrl,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        setHasSigned(false);
        // Reload status
        await loadGradTask();
        alert("동의서 제출이 완료되었습니다. 협조해 주셔서 감사합니다.");
      } else {
        const data = await res.json();
        alert(`제출 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (err: any) {
      alert(`오류가 발생했습니다: ${err.message}`);
    } finally {
      setSubmittingConsent(false);
    }
  };

  const getTargetYearFromEmail = (email: string) => {
    if (!email) return new Date().getFullYear();
    const id = email.split("@")[0];
    const match = id.match(/^(\d{2})/);
    if (match) {
      const admissionYear = 2000 + parseInt(match[1]);
      return admissionYear + 3; // 입학 후 3년이 되는 졸업 년도
    }
    return new Date().getFullYear();
  };

  const targetYear = getTargetYearFromEmail(userData?.email || "");

  const getFormattedDateStr = (dateStr: string, fallbackMD: string) => {
    if (!dateStr) return `${targetYear}년 ${fallbackMD}`;
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return new Date(dateStr).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    }
    if (parts.length === 2) {
      const m = parseInt(parts[0]);
      const d = parseInt(parts[1]);
      return `${targetYear}년 ${m}월 ${d}일`;
    }
    return `${targetYear}년 ${fallbackMD}`;
  };

  const suspendDateStr = getFormattedDateStr(settings?.graduationSettings?.suspendDate, "6월 1일");
  const deleteDateStr = getFormattedDateStr(settings?.graduationSettings?.deleteDate, "6월 30일");

  return (
    <RouteGuard allowedRoles={["student"]}>
      <div className="min-h-screen bg-slate-50 p-6 sm:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          
          {/* Header Dashboard Banner */}
          <div className="bg-gradient-to-r from-indigo-700 via-indigo-800 to-violet-800 rounded-2xl text-white p-6 sm:p-8 shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <span className="bg-indigo-500/30 text-indigo-200 px-3 py-1 rounded-full text-xs font-semibold">학생 포털</span>
              <h1 className="text-2xl sm:text-3xl font-black mt-2 tracking-tight">효명고등학교 계정관리시스템</h1>
              <p className="text-indigo-200 text-sm mt-1">환영합니다! {userData?.email} 학생의 개인 대시보드입니다.</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-semibold transition-all border border-white/10 hover:border-white/20"
            >
              로그아웃
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Services (Left side) */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <h2 className="text-lg font-bold text-slate-800 mb-4">🎓 학생 서비스</h2>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 text-center text-slate-500">
                  <div className="text-3xl mb-2">📁</div>
                  <p className="font-semibold text-sm">서비스 준비 중</p>
                  <p className="text-xs text-slate-400 mt-1">
                    현재 활성화된 서비스가 없습니다. 학교의 안내가 있을 경우 추가 메뉴가 오픈됩니다.
                  </p>
                </div>
              </div>
            </div>

            {/* Side Graduation Notice Widget (Right side) */}
            <div className="space-y-6">
              {gradTask && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3.5">
                      <h3 className="text-base font-bold text-slate-800">🏫 졸업예정 계정 백업 안내</h3>
                      {gradTask.consentSubmitted ? (
                        <span className="bg-emerald-50 text-emerald-700 text-xs px-2.5 py-1 rounded-lg font-bold border border-emerald-100">동의완료</span>
                      ) : (
                        <span className="bg-amber-50 text-amber-700 text-xs px-2.5 py-1 rounded-lg font-bold border border-amber-100 animate-pulse">동의대기</span>
                      )}
                    </div>

                    {gradTask.consentSubmitted ? (
                      <div className="space-y-4">
                        <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl text-xs text-emerald-800 leading-relaxed">
                          ✅ <strong>동의서 제출 완료</strong><br />
                          {gradTask.consentedAt?.toDate ? gradTask.consentedAt.toDate().toLocaleString("ko-KR") : new Date(gradTask.consentedAt || Date.now()).toLocaleString("ko-KR")} 에 계정 삭제 인지 및 백업 서명을 완료해 주셨습니다. 협조해 주셔서 감사합니다.
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          학교 계정이 정지/삭제되기 전에 구글 테이크아웃이나 데이터 이전 도구를 사용하여 중요한 과제 및 자료를 미리 백업하세요.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl text-xs text-amber-800 leading-relaxed">
                          ⚠️ <strong>백업 확인 서명 필요</strong><br />
                          학교 계정은 <strong>{suspendDateStr}</strong>에 정지되고, <strong>{deleteDateStr}</strong>에 영구 삭제됩니다. 안전한 자료 보관을 위해 데이터 백업 서명을 진행해 주세요.
                        </div>
                        <button
                          onClick={() => setShowModal(true)}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm"
                        >
                          ✍️ 데이터 이전 및 삭제 동의서 작성하기
                        </button>
                      </div>
                    )}

                    {/* 백업 가이드 다운로드 링크 모음 */}
                    <div className="border-t border-slate-100 mt-4 pt-4 space-y-2">
                      <p className="text-xs font-bold text-slate-700">💾 데이터 이전/백업 방법</p>
                      <a
                        href="https://www.iorad.com/player/1813583/GW---------------------#trysteps-1"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 text-xs hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                      >
                        <span>다른 구글 계정으로 데이터 이전 가이드</span>
                        <span>↗️</span>
                      </a>
                      <a
                        href="https://www.iorad.com/player/1765417/--------------#trysteps-1"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 text-xs hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                      >
                        <span>개인 PC로 데이터 다운로드 가이드</span>
                        <span>↗️</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Graduation Consent Modal (Pop-up) */}
      {showModal && gradTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-xl w-full max-h-[90vh] overflow-y-auto flex flex-col animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-5 text-white flex items-center gap-3">
              <span className="text-3xl">🎓</span>
              <div>
                <h3 className="text-lg font-black tracking-tight">구글 계정 데이터 이전 및 삭제 확인 동의</h3>
                <p className="text-xs text-amber-100 mt-0.5">졸업생 계정 정지 및 영구 삭제 예정 안내</p>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-5 text-slate-600 text-sm leading-relaxed">
              <div className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-4 text-xs text-amber-800 space-y-1.5">
                <p className="font-bold">⚠️ 대단히 중요합니다!</p>
                <p>
                  여러분들의 학교 구글 워크스페이스 계정은 <strong>{suspendDateStr}에 일시 정지</strong>되고, <strong>{deleteDateStr}에 최종 영구 삭제</strong>될 예정입니다.
                </p>
                <p>
                  계정이 정지되면 드라이브 파일, 클래스룸 자료 등 구글 서비스 내 모든 데이터에 접근이 불가능하게 되므로 아래 링크를 참고하여 데이터를 개인 기기 등으로 다운로드하거나 타 구글 계정으로 전송하여 백업하시기 바랍니다.
                </p>
              </div>

              {/* Student Metadata Table */}
              <div className="grid grid-cols-3 gap-2 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="block text-slate-400 font-medium">이름</span>
                  <span className="font-bold text-slate-700 mt-0.5 block">{gradTask.name}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-medium">학번</span>
                  <span className="font-bold text-slate-700 mt-0.5 block">{gradTask.studentId}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-medium">이메일</span>
                  <span className="font-bold text-slate-700 mt-0.5 block font-mono truncate">{gradTask.email}</span>
                </div>
              </div>

              {/* Backups Guide Links */}
              <div className="space-y-2">
                <p className="font-bold text-xs text-slate-800">📋 데이터 이전/백업 방법</p>
                <ul className="text-xs text-slate-500 list-disc list-inside space-y-1.5 pl-1">
                  <li>
                    다른 구글 계정으로 데이터를 옮기려면 <strong><a href="https://www.iorad.com/player/1813583/GW---------------------#trysteps-1" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-semibold">데이터 이전 가이드</a></strong>를 참고해 주세요.
                  </li>
                  <li>
                    개인 PC 등으로 다운로드하여 보관하려면 <strong><a href="https://www.iorad.com/player/1765417/--------------#trysteps-1" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-semibold">데이터 다운로드 가이드</a></strong>를 참고해 주세요.
                  </li>
                </ul>
              </div>

              {/* Essential Checkboxes */}
              <div className="space-y-3.5 border-t border-slate-100 pt-4">
                <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={checkingDeletion}
                    onChange={(e) => setCheckingDeletion(e.target.checked)}
                    className="w-5 h-5 border-slate-300 rounded text-indigo-600 mt-0.5 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      [필수] {suspendDateStr} 계정 정지 및 {deleteDateStr} 영구 삭제 사실 확인
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                      지정된 날짜에 구글 워크스페이스 계정이 삭제되며 자료가 영구 소실됨을 정확히 인지했습니다.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={checkingDownload}
                    onChange={(e) => setCheckingDownload(e.target.checked)}
                    className="w-5 h-5 border-slate-300 rounded text-indigo-600 mt-0.5 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      [필수] 데이터 이전 및 다운로드 방법 안내 확인
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                      안내받은 이전/다운로드 가이드를 확인하고 데이터 백업 필요성을 충분히 인지했습니다.
                    </span>
                  </div>
                </label>
              </div>

              {/* Signature drawing canvas */}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-xs text-slate-800 flex items-center gap-1">
                    <span>✍️</span> 안내 확인 서명 패드 (손가락/마우스 드로잉)
                  </p>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
                  >
                    지우기
                  </button>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 relative h-36">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={144}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-full touch-none cursor-crosshair"
                  />
                  {!hasSigned && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-[11px] font-semibold">
                      여기에 손가락이나 마우스로 서명해 주세요.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-end gap-3.5">
              <button
                onClick={() => {
                  setShowModal(false);
                  setHasSigned(false);
                }}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl transition-colors"
              >
                나중에 하기
              </button>
              <button
                onClick={handleSubmitConsent}
                disabled={!checkingDeletion || !checkingDownload || !hasSigned || submittingConsent}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-colors shadow-sm"
              >
                {submittingConsent ? "제출 중..." : "✍️ 동의 및 백업 확인 제출"}
              </button>
            </div>

          </div>
        </div>
      )}
    </RouteGuard>
  );
}
