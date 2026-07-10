"use client";

import { useState } from "react";
import {
  parsePromotionCSV,
  getPromotionCSVTemplate,
  buildStudentId,
  parseStudentId,
} from "@/lib/csvParser";
import type { PromotionRow } from "@/lib/csvParser";
import { callAPI, Btn, ErrBox, CSVUploader } from "./shared";

export default function PromoteTab({ s, ud, ouList, onDone }: any) {
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<PromotionRow[]>([]);
  const [pErr, setPErr] = useState<{ line: number; message: string }[]>([]);
  const [matched, setMatched] = useState<any[]>([]);
  const [typeA, setTypeA] = useState<any[]>([]);
  const [typeB, setTypeB] = useState<any[]>([]);
  const [validating, setValidating] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const onFile = (text: string) => {
    setCsvText(text);
    const { rows, errors } = parsePromotionCSV(text);
    setParsed(rows);
    setPErr(errors);
    setMatched([]);
    setTypeA([]);
    setTypeB([]);
    setResult(null);
    setErr("");
  };

  const validate = async () => {
    setValidating(true);
    setErr("");
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ouList }),
      });
      const data = await res.json();
      const students: any[] = data.users || [];

      const gMap = new Map<string, any>();
      for (const st of students) {
        const fn = st.name?.familyName?.trim();
        if (fn && /^\d{5}$/.test(fn)) {
          const p = parseStudentId(fn);
          if (p) gMap.set(`${p.grade}-${p.classNum}-${p.num}`, st);
        }
      }

      const csvSet = new Set(parsed.map((r) => `${r.prevGrade}-${r.prevClass}-${r.prevNum}`));

      // 유형A: 구글에 있는데 CSV에 없는 학생 (전출/학업중단 미반영)
      const tA: any[] = [];
      for (const [key, acc] of gMap.entries()) {
        if (!csvSet.has(key)) {
          const p = parseStudentId(acc.name?.familyName);
          if (p && p.grade < 3)
            tA.push({ key, email: acc.primaryEmail, name: acc.name?.fullName, fn: acc.name?.familyName });
        }
      }

      // 매칭 및 유형B
      const mat: any[] = [];
      const tB: any[] = [];
      for (const row of parsed) {
        const key = `${row.prevGrade}-${row.prevClass}-${row.prevNum}`;
        const acc = gMap.get(key);
        if (acc) {
          mat.push({
            ...row,
            email: acc.primaryEmail,
            name: acc.name?.fullName,
            prevStudentId: buildStudentId(row.prevGrade, row.prevClass, row.prevNum),
            newStudentId: buildStudentId(row.newGrade, row.newClass, row.newNum),
          });
        } else {
          tB.push({ ...row, key });
        }
      }
      setMatched(mat);
      setTypeA(tA);
      setTypeB(tB);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setValidating(false);
    }
  };

  const promote = async () => {
    if (!confirm(`${matched.length}명의 학번을 업데이트합니다.`)) return;
    setRunning(true);
    setErr("");
    try {
      setResult(
        await callAPI(
          "promote_students",
          {
            promotions: matched.map((m) => ({
              email: m.email,
              prevStudentId: m.prevStudentId,
              newStudentId: m.newStudentId,
            })),
          },
          ud
        )
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  const downloadTemplate = () => {
    const b = new Blob([getPromotionCSVTemplate()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "진급처리_양식.csv";
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold mb-1">📈 진급 처리</h3>
          <p className="text-sm text-gray-500">CSV 업로드 → 구글 계정 대조 검증 → 학번 일괄 업데이트</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100"
        >
          📥 CSV 양식
        </button>
      </div>

      {!csvText ? (
        <CSVUploader onFile={onFile} label="진급 CSV 업로드 (이전학년,이전반,이전번호,새학년,새반,새번호)" />
      ) : (
        <>
          <div className="bg-gray-50 rounded-xl border p-4 text-sm">
            <p className="font-semibold">
              파싱: <span className="text-green-700">{parsed.length}행</span>
            </p>
            {pErr.length > 0 && (
              <details className="mt-1">
                <summary className="text-red-500 cursor-pointer text-xs">오류 {pErr.length}건 ▼</summary>
                <ul className="mt-1 text-xs text-red-400">
                  {pErr.map((e, i) => (
                    <li key={i}>
                      행{e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {!matched.length && !result ? (
            <Btn onClick={validate} disabled={validating || !parsed.length} color="amber">
              {validating ? "⏳ 검증 중..." : "🔍 구글 계정 대조 검증"}
            </Btn>
          ) : !result ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-2xl font-bold text-green-700">{matched.length}명</p>
                  <p className="text-xs text-green-600 mt-0.5">✅ 정상 매칭</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-2xl font-bold text-amber-700">{typeA.length}명</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    ⚠️ 유형A: 구글에만 있음
                    <br />
                    (전출/학업중단 미반영)
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-2xl font-bold text-red-700">{typeB.length}명</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    ❌ 유형B: CSV에만 있음
                    <br />
                    (전입 미반영)
                  </p>
                </div>
              </div>

              {typeA.length > 0 && (
                <details className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <summary className="font-semibold text-amber-800 cursor-pointer text-sm">
                    ⚠️ 유형A 상세 ▼
                  </summary>
                  <div className="mt-2 overflow-auto max-h-40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-amber-100 text-amber-800">
                          <th className="px-2 py-1 text-left">이름</th>
                          <th className="px-2 py-1 text-left">이메일</th>
                          <th className="px-2 py-1 text-left">학번</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typeA.map((a, i) => (
                          <tr key={i} className="border-t border-amber-100">
                            <td className="px-2 py-1">{a.name}</td>
                            <td className="px-2 py-1">{a.email}</td>
                            <td className="px-2 py-1 font-mono">{a.fn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {typeB.length > 0 && (
                <details className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <summary className="font-semibold text-red-800 cursor-pointer text-sm">
                    ❌ 유형B 상세 ▼
                  </summary>
                  <div className="mt-2 overflow-auto max-h-40">
                    <table className="w-full text-xs text-center">
                      <thead>
                        <tr className="bg-red-100 text-red-800">
                          <th className="px-2 py-1">이전학년</th>
                          <th>이전반</th>
                          <th>이전번호</th>
                          <th>→새학년</th>
                          <th>새반</th>
                          <th>새번호</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typeB.map((r, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="px-2 py-1">{r.prevGrade}</td>
                            <td>{r.prevClass}</td>
                            <td>{r.prevNum}</td>
                            <td>{r.newGrade}</td>
                            <td>{r.newClass}</td>
                            <td>{r.newNum}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {matched.length > 0 && (
                <details className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <summary className="font-semibold text-green-800 cursor-pointer text-sm">
                    ✅ 진급 예정 {matched.length}명 ▼
                  </summary>
                  <div className="mt-2 overflow-auto max-h-48">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-green-100 text-green-700">
                          <th className="px-2 py-1 text-left">이름</th>
                          <th className="px-2 py-1 text-left">이메일</th>
                          <th className="px-2 py-1">이전 학번</th>
                          <th className="px-2 py-1">새 학번</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matched.map((m, i) => (
                          <tr key={i} className="border-t border-green-100">
                            <td className="px-2 py-1">{m.name}</td>
                            <td className="px-2 py-1 text-xs">{m.email}</td>
                            <td className="px-2 py-1 font-mono text-center">{m.prevStudentId}</td>
                            <td className="px-2 py-1 font-mono text-center font-bold text-green-700">
                              {m.newStudentId}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <ErrBox msg={err} />
              <div className="flex gap-3">
                <Btn onClick={promote} disabled={running || !matched.length}>
                  {running ? "⏳ 처리 중..." : `✅ ${matched.length}명 진급 처리`}
                </Btn>
                <Btn
                  onClick={() => {
                    setCsvText("");
                    setParsed([]);
                    setMatched([]);
                  }}
                  color="gray"
                >
                  다시 업로드
                </Btn>
              </div>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <p className="font-bold text-green-800 text-lg">✅ 진급 처리 완료!</p>
              <p className="text-green-700 text-sm mt-1">
                성공: <strong>{result.succeeded?.length}명</strong> / 실패:{" "}
                <strong>{result.failed?.length || 0}명</strong>
              </p>
              <p className="text-green-600 text-xs mt-1">진급 이력이 Firestore에 저장되었습니다.</p>
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
