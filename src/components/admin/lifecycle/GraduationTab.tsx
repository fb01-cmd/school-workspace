"use client";

import { useState } from "react";
import { callAPI, Btn, ErrBox } from "./shared";

export default function GraduationTab({ s, ud }: any) {
  const gradOU =
    s?.ouMapping?.graduates ||
    (Object.values(s?.ouMapping?.students || {}) as string[]).find((p) => p.includes("졸업")) ||
    "";

  const [graduates, setGraduates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [warnNames, setWarnNames] = useState({ family: "6월30일", given: "삭제예정" });
  const [running, setRunning] = useState<"warn" | "delete" | null>(null);
  const [results, setResults] = useState<{ warn?: any; delete?: any }>({});
  const [err, setErr] = useState("");

  const loadGraduates = async () => {
    if (!gradOU) {
      setErr("졸업생 OU를 찾을 수 없습니다. (OU 경로에 '졸업' 포함 필요)");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: [gradOU] }),
      });
      const data = await res.json();
      setGraduates(data.users || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const warnGraduates = async () => {
    if (
      !confirm(
        `${graduates.length}명의 이름을 "${warnNames.family} ${warnNames.given}"으로 변경합니다.`
      )
    )
      return;
    setRunning("warn");
    try {
      const r = await callAPI(
        "graduation_warn",
        {
          graduateEmails: graduates.map((g) => g.primaryEmail),
          warnFamilyName: warnNames.family,
          warnGivenName: warnNames.given,
        },
        ud
      );
      setResults((p) => ({ ...p, warn: r }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(null);
    }
  };

  const deleteGraduates = async () => {
    if (
      !confirm(
        `⚠️ ${graduates.length}명 계정을 영구 삭제합니다. 되돌릴 수 없습니다. 계속하시겠습니까?`
      )
    )
      return;
    setRunning("delete");
    try {
      const r = await callAPI(
        "graduation_delete",
        { graduateEmails: graduates.map((g) => g.primaryEmail) },
        ud
      );
      setResults((p) => ({ ...p, delete: r }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold mb-1">🏫 졸업생 처리</h3>
        <p className="text-sm text-gray-500">
          OU 전환 후 "졸업생" OU 계정 조회 → 5월 이름 변경 경고 → 6월 30일 일괄 삭제
        </p>
      </div>

      <ErrBox msg={err} />

      {!graduates.length ? (
        <Btn onClick={loadGraduates} disabled={loading} color="gray">
          {loading ? "⏳ 조회 중..." : "🔍 졸업생 목록 조회"}
        </Btn>
      ) : (
        <>
          <div className="bg-gray-50 border rounded-xl p-4 text-sm">
            <p className="font-semibold text-gray-700">
              졸업생: <strong className="text-indigo-700">{graduates.length}명</strong>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">OU: {gradOU}</p>
          </div>

          {/* Step 1: 이름 변경 경고 */}
          {!results.warn ? (
            <div className="border border-amber-200 rounded-xl p-4 space-y-3">
              <p className="font-semibold text-amber-800">📛 1단계: 이름 변경 경고 (5월 권장)</p>
              <p className="text-xs text-amber-600">
                학생이 로그인했을 때 이름이 바뀐 것을 보고 삭제 예정임을 인지하게 됩니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    성(familyName)으로 변경
                  </label>
                  <input
                    value={warnNames.family}
                    onChange={(e) => setWarnNames((p) => ({ ...p, family: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    이름(givenName)으로 변경
                  </label>
                  <input
                    value={warnNames.given}
                    onChange={(e) => setWarnNames((p) => ({ ...p, given: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
              </div>
              <Btn onClick={warnGraduates} disabled={running === "warn"} color="amber">
                {running === "warn" ? "⏳ 처리 중..." : `📛 ${graduates.length}명 이름 변경`}
              </Btn>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              ✅ 이름 변경 완료: {results.warn.succeeded}명 / 실패: {results.warn.failed}명
            </div>
          )}

          {/* Step 2: 영구 삭제 */}
          {!results.delete ? (
            <div className="border border-red-200 rounded-xl p-4 space-y-3">
              <p className="font-semibold text-red-800">🗑️ 2단계: 계정 영구 삭제 (6월 30일 권장)</p>
              <p className="text-xs text-red-500">
                ⚠️ 되돌릴 수 없습니다. 이름 변경 경고 후 충분한 시간이 지난 뒤 실행하세요.
              </p>
              <Btn onClick={deleteGraduates} disabled={running === "delete"} color="red">
                {running === "delete"
                  ? "⏳ 삭제 중..."
                  : `🗑️ ${graduates.length}명 영구 삭제`}
              </Btn>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm font-semibold text-red-800">
              ✅ 삭제 완료: {results.delete.succeeded}명 / 실패: {results.delete.failed}명
            </div>
          )}
        </>
      )}
    </div>
  );
}
