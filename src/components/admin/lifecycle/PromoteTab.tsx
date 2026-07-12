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
import PromoteSheetEditor from "./PromoteSheetEditor";

export default function PromoteTab({ s, ud, ouList, onDone, onNext }: any) {
  const [csvText, setCsvText] = useState("");
  const [inputMode, setInputMode] = useState<"csv" | "sheet">("csv");
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
      const response = await callAPI(
        "promote_students",
        {
          promotions: matched.map((m) => ({
            email: m.email,
            name: m.name,
            prevStudentId: m.prevStudentId,
            newStudentId: m.newStudentId,
          })),
        },
        ud
      );
      setResult(response);
      if (response && onDone) {
        onDone();
      }
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
        {inputMode === "csv" && parsed.length === 0 && (
          <button
            onClick={downloadTemplate}
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100"
          >
            📥 CSV 양식
          </button>
        )}
      </div>

      {parsed.length === 0 ? (
        <div className="space-y-4">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setInputMode("csv")}
              className={`flex-1 py-2 text-center text-xs font-semibold border-b-2 transition-all ${
                inputMode === "csv"
                  ? "border-indigo-600 text-indigo-600 border-b-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              📥 CSV 파일 업로드
            </button>
            <button
              onClick={() => setInputMode("sheet")}
              className={`flex-1 py-2 text-center text-xs font-semibold border-b-2 transition-all ${
                inputMode === "sheet"
                  ? "border-indigo-600 text-indigo-600 border-b-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              📝 웹 시트 직접 편집
            </button>
          </div>

          {inputMode === "csv" ? (
            <CSVUploader onFile={onFile} label="진급 CSV 업로드 (이전학년,이전반,이전번호,새학년,새반,새번호)" />
          ) : (
            <PromoteSheetEditor
              onApply={(rows) => {
                setParsed(rows);
                setPErr([]);
                setMatched([]);
                setTypeA([]);
                setTypeB([]);
                setResult(null);
                setErr("");
              }}
              onCancel={() => setInputMode("csv")}
            />
          )}
        </div>
      ) : (
        <>
          <div className="bg-gray-50 rounded-xl border p-4 text-sm space-y-2">
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

            {(() => {
              const isTemplateData = parsed.length === 3 && 
                parsed.every((row, idx) => {
                  const t = [
                    { pg: 1, pc: 1, pn: 1, ng: 2, nc: 3, nn: 5 },
                    { pg: 1, pc: 1, pn: 2, ng: 2, nc: 1, nn: 1 },
                    { pg: 2, pc: 5, pn: 10, ng: 3, nc: 2, nn: 8 }
                  ][idx];
                  return t && row.prevGrade === t.pg && row.prevClass === t.pc && row.prevNum === t.pn &&
                         row.newGrade === t.ng && row.newClass === t.nc && row.newNum === t.nn;
                });
              if (isTemplateData) {
                return (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 font-medium">
                    ⚠️ <strong>주의:</strong> 업로드된 파일이 수정하지 않은 <strong>기본 예시 템플릿 데이터</strong>입니다. 
                    엑셀에서 편집하신 <code>진급처리_양식.xlsx</code> 파일을 <strong>[파일] → [다른 이름으로 저장] → [CSV (쉼표로 분리) (*.csv)]</strong> 형식으로 저장한 후, 해당 실제 데이터 파일을 다시 업로드해 주세요!
                  </div>
                );
              }
              return null;
            })()}
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
                  다시 작성 / 업로드
                </Btn>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* Conditional Result Banner */}
              {result.succeeded?.length === 0 ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-800">
                  <p className="font-bold text-lg">❌ 진급 처리 실패</p>
                  <p className="text-sm mt-1">
                    요청한 모든 학생의 진급 처리에 실패했습니다. 구글 계정 권한 또는 데이터 일치 여부를 확인해 주세요.
                  </p>
                  <p className="text-xs font-semibold mt-2">
                    성공: 0명 / 실패: <strong>{result.failed?.length || 0}명</strong>
                  </p>
                </div>
              ) : (result.failed?.length || 0) > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800">
                  <p className="font-bold text-lg">⚠️ 진급 처리 완료 (일부 실패)</p>
                  <p className="text-sm mt-1">
                    일부 학생의 진급 처리가 성공했으나, 일부 학생의 학번 업데이트에 실패했습니다. 아래 실패 상세 목록을 확인해 주세요.
                  </p>
                  <p className="text-xs font-semibold mt-2">
                    성공: <strong>{result.succeeded?.length}명</strong> / 실패: <strong>{result.failed?.length}명</strong>
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-green-800">
                  <p className="font-bold text-lg">✅ 진급 처리 완료!</p>
                  <p className="text-sm mt-1">
                    모든 학생의 학번 업데이트(진급)가 성공적으로 완료되었습니다.
                  </p>
                  <p className="text-xs font-semibold mt-2">
                    성공: <strong>{result.succeeded?.length}명</strong> / 실패: 0명
                  </p>
                </div>
              )}

              {/* Failures Detail List */}
              {(result.failed?.length || 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-red-700">⚠️ 진급 실패 상세 내역 ({result.failed.length}건)</p>
                  <div className="overflow-auto max-h-52 rounded-xl border border-red-100">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-red-50 text-red-700 font-semibold">
                        <tr>
                          <th className="px-3 py-2 text-left">이름</th>
                          <th className="px-3 py-2 text-left">이메일</th>
                          <th className="px-3 py-2 text-left">대상 학번</th>
                          <th className="px-3 py-2 text-left">실패 사유</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-50 bg-red-50/10">
                        {result.failed.map((f: any, idx: number) => (
                          <tr key={idx} className="hover:bg-red-50/20 text-red-900">
                            <td className="px-3 py-2 font-medium">{f.name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{f.email}</td>
                            <td className="px-3 py-2 font-mono">{f.studentId}</td>
                            <td className="px-3 py-2 font-medium text-red-600">
                              {f.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-gray-500 text-xs mt-1">진급 이력이 Firestore 로그에 저장되었습니다.</p>

              <div className="flex gap-3">
                <Btn
                  onClick={() => {
                    setCsvText("");
                    setParsed([]);
                    setMatched([]);
                    setResult(null);
                    setErr("");
                  }}
                  color="gray"
                >
                  새로운 CSV 업로드
                </Btn>
                {onNext && (result.succeeded?.length || 0) > 0 && (
                  <Btn onClick={onNext}>
                    다음 단계로 →
                  </Btn>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
