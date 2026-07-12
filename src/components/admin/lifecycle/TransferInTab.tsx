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
    </div>
  );
}
