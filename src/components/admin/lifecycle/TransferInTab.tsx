"use client";

import { useState, useEffect } from "react";
import { callAPI, Btn, ErrBox } from "./shared";

export default function TransferInTab({ s, ud, ouPaths }: any) {
  const domain = s?.domain || ud?.domain || "";
  const currentYear = new Date().getFullYear(); // e.g., 2026

  const [form, setForm] = useState({
    fullName: "",
    grade: "1",
    classNum: "",
    studentNum: "",
  });
  const [nextSerial, setNextSerial] = useState<number | null>(null);
  const [loadingSerial, setLoadingSerial] = useState(false);
  const [serialBasis, setSerialBasis] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  // 학급 클래스룸 자동 배정 스캔 모달 상태
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgressText, setScanProgressText] = useState("");
  const [scanWarning, setScanWarning] = useState("");
  const [scanStudentEmail, setScanStudentEmail] = useState("");
  const [scanGrade, setScanGrade] = useState("");
  const [scanClassNum, setScanClassNum] = useState("");
  const [scanStudentName, setScanStudentName] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [scanCandidates, setScanCandidates] = useState<any[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);
  const [enrollResults, setEnrollResults] = useState<Record<string, { success: boolean; alreadyEnrolled?: boolean; error?: string }> | null>(null);

  /**
   * 비JSON 응답 및 HTTP status 방어를 포함한 safe fetch 헬퍼
   */
  const safeFetchJson = async (url: string, options: RequestInit) => {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `서버 응답 오류 (HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}). Vercel 타임아웃 등 비JSON 응답이 수신되었습니다.`
      );
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `요청 처리 실패 (HTTP ${res.status})`);
    }
    return data;
  };

  const openScanModal = (email: string, grade: string, classNum: string, name: string) => {
    setScanStudentEmail(email);
    setScanGrade(grade);
    setScanClassNum(classNum);
    setScanStudentName(name);
    setScanErr("");
    setScanWarning("");
    setScanProgressText("");
    setScanCandidates([]);
    setSelectedCourseIds(new Set());
    setEnrollResults(null);
    setShowScanModal(true);

    runScan(email, grade, classNum);
  };

  const runScan = async (email: string, grade: string, classNum: string) => {
    setScanLoading(true);
    setScanErr("");
    setScanWarning("");
    setScanProgressText("학급 재적 명단을 조회하는 중...");
    setEnrollResults(null);
    setScanCandidates([]);
    setSelectedCourseIds(new Set());

    try {
      // Step 1: scan_init
      const initData = await safeFetchJson("/api/workspace/classroom/transfer-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_init", grade, classNum, studentEmail: email }),
      });

      const classEmails: string[] = initData.classEmails || [];
      if (classEmails.length === 0) {
        setScanCandidates([]);
        return;
      }

      // Step 2: scan_members (단일 호출 + 실패 시 1회 재시도)
      setScanProgressText(`학급 멤버십 역방향 집계 중 (${classEmails.length}명)...`);

      let membersRes: any = null;
      try {
        membersRes = await safeFetchJson("/api/workspace/classroom/transfer-enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scan_members",
            studentEmail: email,
            classEmails,
          }),
        });
      } catch (firstErr) {
        console.warn("[runScan] 1st scan_members attempt failed, retrying in 1s...", firstErr);
        setScanProgressText("네트워크/쿼터 오류로 1초 후 1회 재시도 중...");
        await new Promise(r => setTimeout(r, 1000));

        // 1회 일괄 재시도
        membersRes = await safeFetchJson("/api/workspace/classroom/transfer-enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scan_members",
            studentEmail: email,
            classEmails,
          }),
        });
      }

      const candidates: any[] = membersRes.candidates || [];
      const failedMemberEmails: string[] = membersRes.failedMemberEmails || [];

      if (failedMemberEmails.length > 0) {
        setScanWarning(`⚠️ ${failedMemberEmails.length}명 명단 대조 실패 — 결과가 불완전할 수 있습니다.`);
      }

      setScanCandidates(candidates);

      // 자동 선택: 이미 가입된 코스 제외
      const autoSelected = new Set(candidates.filter((c: any) => !c.alreadyEnrolled).map((c: any) => c.courseId));
      setSelectedCourseIds(autoSelected);
    } catch (e: any) {
      setScanErr(e.message || "스캔 중 오류가 발생했습니다.");
    } finally {
      setScanLoading(false);
      setScanProgressText("");
    }
  };

  const handleEnrollSelected = async () => {
    const selectedIds = Array.from(selectedCourseIds);
    if (selectedIds.length === 0) {
      alert("배정할 클래스룸을 1개 이상 선택해 주세요.");
      return;
    }

    const targets = scanCandidates.filter(c => selectedCourseIds.has(c.courseId));
    setEnrolling(true);
    setScanErr("");
    try {
      const data = await safeFetchJson("/api/workspace/classroom/transfer-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enroll",
          studentEmail: scanStudentEmail,
          courseIds: selectedIds,
          courseNames: targets.map(t => t.name),
        }),
      });

      const resultMap: Record<string, { success: boolean; alreadyEnrolled?: boolean; error?: string }> = {};
      (data.results || []).forEach((r: any) => {
        resultMap[r.courseId] = r;
      });
      setEnrollResults(resultMap);

      // 성공한 코스는 candidates 목록에서 alreadyEnrolled = true로 업데이트
      setScanCandidates(prev =>
        prev.map(c => {
          if (resultMap[c.courseId]?.success) {
            return { ...c, alreadyEnrolled: true };
          }
          return c;
        })
      );
      setSelectedCourseIds(new Set());
    } catch (e: any) {
      setScanErr(e.message || "배정 중 오류가 발생했습니다.");
    } finally {
      setEnrolling(false);
    }
  };

  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // 코호트 연도: 1학년=올해, 2학년=올해-1, 3학년=올해-2
  const cohortYear = currentYear - (parseInt(form.grade) - 1);
  const cohortYearStr = String(cohortYear).slice(-2); // "26", "25", "24"

  // 해당 학년 OU + 전출·자퇴 OU에서 cohortYear 시리즈 최대 일련번호 계산
  const calcNextSerial = async () => {
    const gradeOU = ouPaths[form.grade] as string | undefined;
    if (!gradeOU) {
      setSerialBasis(`${form.grade}학년 OU 미설정 — 조직단위 설정에서 먼저 매핑해 주세요`);
      setNextSerial(null);
      return;
    }
    setLoadingSerial(true);
    setNextSerial(null);
    setSerialBasis("");
    try {
      // 전출·자퇴 OU: 설정맵핑에서 가져오거나 학년 OU의 부모에서 자동 유도
      const parentPath = gradeOU.substring(0, gradeOU.lastIndexOf("/")) || "/";
      const transferOutOU = s?.ouMapping?.transferOut || `${parentPath}/전출및자퇴`;
      const searchOUs = [gradeOU, transferOutOU];

      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: searchOUs }),
      });
      const data = await res.json();
      const users: any[] = data.users || [];

      // cohortYear 시리즈에서 최대값 탐색
      const re = new RegExp(`^${cohortYearStr}(\\d{3})@`);
      let max = 0;
      let maxEmail = "";
      for (const u of users) {
        const m = (u.primaryEmail || "").match(re);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) { max = n; maxEmail = u.primaryEmail; }
        }
      }
      setNextSerial(max + 1);
      setSerialBasis(
        max > 0
          ? `현재 최대: ${maxEmail} (${users.length}명 조회)`
          : `${cohortYearStr}년 시리즈 없음 — 001부터 시작`
      );
    } catch (e: any) {
      setNextSerial(null);
      setSerialBasis("조회 실패");
    } finally {
      setLoadingSerial(false);
    }
  };

  // 학년 변경 시 재계산
  useEffect(() => { calcNextSerial(); }, [form.grade, JSON.stringify(ouPaths)]);

  const gradeOU = ouPaths[form.grade] || "";

  const studentId =
    form.grade && form.classNum && form.studentNum
      ? `${form.grade}${String(form.classNum).padStart(2, "0")}${String(form.studentNum).padStart(2, "0")}`
      : "—";

  const emailPreview =
    loadingSerial
      ? "계산 중..."
      : nextSerial !== null
      ? `${cohortYearStr}${String(nextSerial).padStart(3, "0")}@${domain}`
      : "—";

  const submit = async () => {
    const classNumInt = parseInt(form.classNum);
    const studentNumInt = parseInt(form.studentNum);
    if (!form.fullName.trim()) { setErr("이름을 입력해 주세요."); return; }
    if (!form.classNum || isNaN(classNumInt) || classNumInt < 1 || classNumInt > 10) {
      setErr("반 번호는 1~10 사이여야 합니다."); return;
    }
    if (!form.studentNum || isNaN(studentNumInt) || studentNumInt < 1) {
      setErr("번호를 올바르게 입력해 주세요."); return;
    }
    if (!gradeOU) {
      setErr(`${form.grade}학년 OU가 설정되지 않았습니다.`);
      return;
    }
    if (nextSerial === null) {
      setErr("일련번호 계산 중입니다. 잠시 후 시도해 주세요.");
      return;
    }
    setRunning(true);
    setErr("");
    try {
      setResult(
        await callAPI("enroll_students", {
          students: [{
            familyName: "",
            givenName: form.fullName.trim(),
            classNum: classNumInt,
            studentNum: studentNumInt,
            serialNum: nextSerial,
            grade: parseInt(form.grade),
          }],
          admissionYear: cohortYearStr,  // 코호트 연도로 이메일 생성
          grade1OUPath: gradeOU,         // 해당 학년 OU
        }, ud)
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setResult(null);
    setForm({ fullName: "", grade: "1", classNum: "", studentNum: "" });
    calcNextSerial();
  };

  // OU 미설정 안내
  if (!Object.keys(ouPaths).length) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-bold mb-1">➕ 전입생 계정 생성</h3>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          <p className="font-semibold mb-1">⚠️ 조직단위(OU) 설정이 필요합니다</p>
          <p>사이드바의 <strong>조직단위 설정</strong> 메뉴에서 학년별 OU를 먼저 매핑해 주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold mb-1">➕ 전입생 계정 생성</h3>
        <p className="text-sm text-gray-500">
          배정 학년의 코호트 연도 시리즈에서 최대 일련번호 + 1을 자동 부여합니다.
        </p>
      </div>

      {result ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="font-bold text-green-800">✅ 전입생 계정 생성 완료!</p>
          {result.succeeded?.map((st: any, i: number) => (
            <div key={i} className="mt-3 text-sm space-y-1">
              <p className="text-green-700">이메일(아이디): <strong>{st.email}</strong></p>
              <p className="text-green-700">학번: <strong>{st.studentId}</strong></p>
              <p className="text-green-700">
                초기 비밀번호: <strong className="font-mono bg-green-100 px-1.5 py-0.5 rounded text-green-900">1234abcd!!!!</strong>
                <span className="ml-2 text-xs text-green-600">(첫 로그인 후 반드시 변경)</span>
              </p>
              {st.groupAdded ? (
                <p className="text-green-700">그룹 추가: <strong>{st.groupEmail}</strong> ✅</p>
              ) : (
                <p className="text-amber-600">
                  ⚠️ 그룹 <strong>{st.groupEmail}</strong> 없음 — 그룹 재생성 후 수동 추가 필요
                </p>
              )}

              {/* 클립보드 복사 */}
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-xs text-green-700 font-semibold mb-1.5">📋 학생 안내 문구 복사</p>
                <div className="bg-white border border-green-200 rounded-lg p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">
{`효명고등학교에 오신 것을 환영합니다! 🎉

효명고에서는 재학 중 학교 전용 구글 계정을 사용합니다.
아래 계정 정보로 구글(google.com)에 로그인하세요.

▪ 아이디(이메일): ${st.email}
▪ 초기 비밀번호: 1234abcd!!!!

첫 로그인 후 반드시 비밀번호를 변경해 주세요.
문의사항은 담당 선생님께 말씀해 주세요.`}
                </div>
                <button
                  onClick={() => {
                    const msg = `효명고등학교에 오신 것을 환영합니다! 🎉\n\n효명고에서는 재학 중 학교 전용 구글 계정을 사용합니다.\n아래 계정 정보로 구글(google.com)에 로그인하세요.\n\n▪ 아이디(이메일): ${st.email}\n▪ 초기 비밀번호: 1234abcd!!!!\n\n첫 로그인 후 반드시 비밀번호를 변경해 주세요.\n문의사항은 담당 선생님께 말씀해 주세요.`;
                    navigator.clipboard.writeText(msg);
                  }}
                  className="mt-2 w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                  📋 안내 문구 클립보드 복사
                </button>
              </div>

              {/* 학급 클래스룸 자동 배정 스캔 버튼 */}
              <div className="mt-3 pt-3 border-t border-green-200">
                <button
                  type="button"
                  onClick={() => openScanModal(st.email, String(st.grade), String(st.classNum), st.givenName || st.name || form.fullName)}
                  className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <span>🏫</span>
                  <span>전입생 학급 클래스룸 자동 배정 스캔</span>
                </button>
              </div>
            </div>
          ))}
          <button onClick={reset} className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">
            추가 전입생 처리
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">이름 (성+이름 전체)</label>
              <input
                value={form.fullName}
                onChange={(e) => setF("fullName", e.target.value)}
                placeholder="예: 홍길동"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">배정 학년</label>
              <select
                value={form.grade}
                onChange={(e) => setF("grade", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="1">1학년 ({currentYear}년 입학 코호트)</option>
                <option value="2">2학년 ({currentYear - 1}년 입학 코호트)</option>
                <option value="3">3학년 ({currentYear - 2}년 입학 코호트)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">배정 OU</label>
              <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500 truncate">
                {gradeOU || <span className="text-red-400">미설정</span>}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">배정 반</label>
              <input
                type="number"
                value={form.classNum}
                onChange={(e) => setF("classNum", e.target.value)}
                min={1} max={10} placeholder="예: 3"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">배정 번호</label>
              <input
                type="number"
                value={form.studentNum}
                onChange={(e) => setF("studentNum", e.target.value)}
                min={1} placeholder="예: 35"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* 자동 계산 결과 */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-indigo-800">자동 계산 결과</p>
              <button
                onClick={calcNextSerial}
                disabled={loadingSerial}
                className="text-xs text-indigo-500 hover:underline disabled:opacity-50"
              >
                {loadingSerial ? "조회 중..." : "🔄 재조회"}
              </button>
            </div>
            <div>
              <p className="text-indigo-700">
                이메일: <strong className="font-mono">{emailPreview}</strong>
                <span className="text-xs text-indigo-400 ml-2">({cohortYearStr}년 코호트 시리즈)</span>
              </p>
              {serialBasis && <p className="text-xs text-indigo-400 mt-0.5">{serialBasis}</p>}
            </div>
            <p className="text-indigo-700">
              학번: <strong className="font-mono">{studentId}</strong>
              <span className="text-xs text-indigo-400 ml-2">(구글 계정의 "성" 자리에 저장)</span>
            </p>
          </div>

          <ErrBox msg={err} />
          <Btn onClick={submit} disabled={running || loadingSerial}>
            {running ? "⏳ 생성 중..." : "➕ 전입생 계정 생성"}
          </Btn>
        </>
      )}

      {/* 전입생 학급 클래스룸 자동 배정 스캔 모달 */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-indigo-900 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <span>🏫</span>
                  <span>전입생 학급 클래스룸 자동 배정</span>
                </h3>
                <p className="text-xs text-indigo-200 mt-0.5 font-medium">
                  {scanStudentName} ({scanStudentEmail}) · {scanGrade}학년 {scanClassNum}반
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScanModal(false)}
                className="text-indigo-200 hover:text-white text-lg font-bold px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-900 leading-relaxed">
                💡 <strong>우리 반 학생 80% 이상이 가입된 학급 단위 클래스룸</strong>을 도메인 전체에서 역추적하여 전입생의 자동 배정을 제안합니다. (실무사 검토 후 선택 항목만 일괄 추가됩니다)
              </div>

              {scanWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium flex items-center justify-between">
                  <span>{scanWarning}</span>
                  <button
                    type="button"
                    onClick={() => runScan(scanStudentEmail, scanGrade, scanClassNum)}
                    className="ml-2 text-indigo-600 hover:underline font-bold text-[11px]"
                  >
                    🔄 재스캔
                  </button>
                </div>
              )}

              {scanLoading ? (
                <div className="py-16 text-center space-y-3">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
                  <p className="text-sm font-bold text-gray-700">{scanProgressText || "도메인 전체 클래스룸 코스 및 로스터를 스캔하고 있습니다..."}</p>
                  <p className="text-xs text-gray-400">배정 반 학생들이 가입한 코스를 역으로 집계하여 도메인 전체 코스를 검색합니다.</p>
                </div>
              ) : scanErr ? (
                <div className="p-5 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
                  <p className="text-sm font-bold text-red-700">⚠️ 스캔 중 오류가 발생했습니다</p>
                  <p className="text-xs text-red-600 font-medium">{scanErr}</p>
                  <button
                    type="button"
                    onClick={() => runScan(scanStudentEmail, scanGrade, scanClassNum)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                  >
                    🔄 스캔 재시도
                  </button>
                </div>
              ) : scanCandidates.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 border border-gray-200 rounded-xl text-gray-500 space-y-2">
                  <div className="text-3xl">📭</div>
                  <p className="text-sm font-semibold text-gray-700">해당 학급 단위의 클래스룸 코스를 찾지 못했습니다.</p>
                  <p className="text-xs text-gray-400">
                    {scanGrade}학년 {scanClassNum}반 재적생 80% 이상이 가입된 ACTIVE 코스가 없습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-semibold text-gray-600">
                    <span>매칭된 학급 클래스룸: <strong className="text-indigo-600 font-bold">{scanCandidates.length}개</strong></span>
                    <span>선택됨: <strong className="text-indigo-600 font-bold">{selectedCourseIds.size}개</strong></span>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left text-xs text-gray-700">
                      <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                        <tr>
                          <th className="p-3 text-center w-10">
                            <input
                              type="checkbox"
                              checked={
                                scanCandidates.filter(c => !c.alreadyEnrolled).length > 0 &&
                                scanCandidates.filter(c => !c.alreadyEnrolled).every(c => selectedCourseIds.has(c.courseId))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const allUnenrolled = new Set(scanCandidates.filter(c => !c.alreadyEnrolled).map(c => c.courseId));
                                  setSelectedCourseIds(allUnenrolled);
                                } else {
                                  setSelectedCourseIds(new Set());
                                }
                              }}
                              className="w-4 h-4 text-indigo-600 rounded border-gray-300 cursor-pointer"
                            />
                          </th>
                          <th className="p-3">클래스룸 이름 (섹션)</th>
                          <th className="p-3">담당 교사</th>
                          <th className="p-3 text-center">우리 반 가입률</th>
                          <th className="p-3 text-center w-28">가입 상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {scanCandidates.map((c: any) => {
                          const resInfo = enrollResults?.[c.courseId];
                          return (
                            <tr key={c.courseId} className="hover:bg-gray-50/80 transition-colors">
                              <td className="p-3 text-center">
                                <input
                                  type="checkbox"
                                  disabled={c.alreadyEnrolled}
                                  checked={selectedCourseIds.has(c.courseId)}
                                  onChange={(e) => {
                                    const next = new Set(selectedCourseIds);
                                    if (e.target.checked) next.add(c.courseId);
                                    else next.delete(c.courseId);
                                    setSelectedCourseIds(next);
                                  }}
                                  className="w-4 h-4 text-indigo-600 rounded border-gray-300 disabled:opacity-40 cursor-pointer"
                                />
                              </td>
                              <td className="p-3 font-semibold text-gray-900">
                                <div>{c.name} {c.section ? <span className="text-gray-500 font-normal">({c.section})</span> : ""}</div>
                              </td>
                              <td className="p-3 font-medium text-gray-600">
                                <div>{c.ownerName}</div>
                                {c.ownerEmail && c.ownerEmail !== c.ownerName && (
                                  <div className="text-[10px] text-gray-400 font-mono">{c.ownerEmail}</div>
                                )}
                              </td>
                              <td className="p-3 text-center font-mono">
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded font-bold">
                                  {c.classMemberCount}/{c.totalClassCount}명 ({Math.round(c.coverage * 100)}%)
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                {resInfo ? (
                                  resInfo.success ? (
                                    resInfo.alreadyEnrolled ? (
                                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-semibold">
                                        이미 가입됨
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[11px] font-bold">
                                        🎉 추가 완료
                                      </span>
                                    )
                                  ) : (
                                    <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-[11px] font-bold" title={resInfo.error}>
                                      ❌ 실패
                                    </span>
                                  )
                                ) : c.alreadyEnrolled ? (
                                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-semibold">
                                    이미 가입됨
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[11px] font-semibold">
                                    미가입 (배정 가능)
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
              <button
                type="button"
                onClick={() => setShowScanModal(false)}
                className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                닫기
              </button>
              {scanCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={handleEnrollSelected}
                  disabled={enrolling || selectedCourseIds.size === 0}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {enrolling ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>배정 처리 중...</span>
                    </>
                  ) : (
                    <>
                      <span>➕</span>
                      <span>선택 {selectedCourseIds.size}개 클래스룸에 학생 추가</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
