"use client";

import { useState } from "react";
import { parseEnrollmentCSV, getEnrollmentCSVTemplate } from "@/lib/csvParser";
import type { EnrollmentRow } from "@/lib/csvParser";
import { callAPI, Btn, ErrBox, CSVUploader } from "./shared";

export default function EnrollTab({ s, ud, onDone }: any) {
  const g1OU = s?.ouMapping?.students?.["1"] || "";
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<EnrollmentRow[]>([]);
  const [pErr, setPErr] = useState<{ line: number; message: string }[]>([]);
  const [startSerial, setStartSerial] = useState(1);
  const [admYear, setAdmYear] = useState(() => String(new Date().getFullYear()).slice(-2));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const onFile = (text: string) => {
    setCsvText(text);
    const { rows, errors } = parseEnrollmentCSV(text);
    setParsed(rows);
    setPErr(errors);
    setResult(null);
    setErr("");
  };

  const students = parsed.map((st, i) => ({ ...st, serialNum: startSerial + i }));

  const downloadTemplate = () => {
    const b = new Blob([getEnrollmentCSVTemplate()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "신입생명단_양식.csv";
    a.click();
  };

  const enroll = async () => {
    if (!g1OU) { setErr("1학년 OU 경로를 먼저 설정해 주세요."); return; }
    if (!confirm(`${students.length}명의 신입생 계정을 생성합니다.`)) return;
    setRunning(true);
    setErr("");
    try {
      setResult(
        await callAPI("enroll_students", { students, admissionYear: admYear, grade1OUPath: g1OU }, ud)
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold mb-1">🎓 신입생 입학 처리</h3>
          <p className="text-sm text-gray-500">
            초기 비밀번호: <code className="bg-gray-100 px-1 rounded">1234abcd!!!!</code>{" "}
            (최초 로그인 즉시 변경 강제)
          </p>
        </div>
        <button
          onClick={downloadTemplate}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100"
        >
          📥 CSV 양식
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            입학연도 (이메일 앞 2자리)
          </label>
          <input
            value={admYear}
            onChange={(e) => setAdmYear(e.target.value)}
            maxLength={2}
            placeholder="예: 26"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">시작 일련번호</label>
          <input
            type="number"
            value={startSerial}
            onChange={(e) => setStartSerial(Number(e.target.value))}
            min={1}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!g1OU && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          ⚠️ 조직단위 설정(⚙️)에서 1학년 OU를 먼저 설정해 주세요.
        </div>
      )}

      {!csvText ? (
        <CSVUploader onFile={onFile} label="신입생 CSV 업로드 (성,명,반,번호)" />

      ) : (
        <>
          <div className="bg-gray-50 rounded-xl border p-4 text-sm">
            <p className="font-semibold">
              파싱: <span className="text-green-700">{parsed.length}명</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              이메일 범위:{" "}
              <code>
                {admYear}
                {String(startSerial).padStart(3, "0")}@{s?.domain}
              </code>{" "}
              ~{" "}
              <code>
                {admYear}
                {String(startSerial + parsed.length - 1).padStart(3, "0")}@{s?.domain}
              </code>
            </p>
            {pErr.length > 0 && (
              <details className="mt-1">
                <summary className="text-red-500 cursor-pointer text-xs">오류 {pErr.length}건 ▼</summary>
                <ul className="text-xs text-red-400 mt-1">
                  {pErr.map((e, i) => (
                    <li key={i}>
                      행{e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {!result ? (
            <>
              <div className="overflow-auto max-h-52 rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-indigo-50">
                    <tr className="text-indigo-700">
                      <th className="px-3 py-2 text-left">이름</th>
                      <th className="px-3 py-2 text-left">이메일</th>
                      <th className="px-3 py-2 text-left">학번</th>
                      <th className="px-3 py-2 text-left">반/번</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((st, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1">
                          {st.familyName}
                          {st.givenName}
                        </td>
                        <td className="px-3 py-1 font-mono text-indigo-600">
                          {admYear}
                          {String(st.serialNum).padStart(3, "0")}@{s?.domain}
                        </td>
                        <td className="px-3 py-1 font-mono">
                          1{String(st.classNum).padStart(2, "0")}
                          {String(st.studentNum).padStart(2, "0")}
                        </td>
                        <td className="px-3 py-1">
                          {st.classNum}반 {st.studentNum}번
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ErrBox msg={err} />
              <div className="flex gap-3">
                <Btn onClick={enroll} disabled={running || !parsed.length}>
                  {running ? "⏳ 생성 중..." : `🎓 ${parsed.length}명 계정 생성`}
                </Btn>
                <Btn
                  onClick={() => { setCsvText(""); setParsed([]); }}
                  color="gray"
                >
                  다시 업로드
                </Btn>
              </div>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <p className="font-bold text-green-800 text-lg">✅ 신입생 계정 생성 완료!</p>
              <p className="text-green-700 text-sm mt-1">
                성공: <strong>{result.succeeded?.length}명</strong> / 실패:{" "}
                <strong>{result.failed?.length || 0}명</strong>
              </p>
              {onDone && (
                <button onClick={onDone} className="mt-3 px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
                  다음 단계로 →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
