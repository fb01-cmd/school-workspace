"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import {
  NeisMapRegistry,
  NeisPrecheckReport,
  NeisPrecheckTarget,
  NeisPrecheckSubjectIssue,
  NeisPrecheckTeacherIssue,
  NeisPrecheckPairIssue,
  NeisCsvBundle,
  NeisCsvFile,
} from "@/lib/timetable/types";

interface DraftSummary {
  id: string;
  label: string;
}

interface SubjectSeed {
  name: string;
  shortName: string;
}

interface NeisBatchExportTabProps {
  activeTermId: string | null;
}

// ─── helper ───────────────────────────────────────────────────
function api(body: object) {
  return fetch("/api/timetable/manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

// ─── 진행률 바 ─────────────────────────────────────────────────
function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total === 0 ? 100 : Math.round((value / total) * 100);
  const done = value === total;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-right text-slate-600 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${done ? "bg-emerald-500" : "bg-amber-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-16 font-bold ${done ? "text-emerald-600" : "text-amber-600"}`}>
        {value}/{total}
      </span>
    </div>
  );
}

export default function NeisBatchExportTab({ activeTermId }: NeisBatchExportTabProps) {
  // ── 대상 선택 상태 ──
  const [targetKind, setTargetKind] = useState<"term" | "draft">("term");
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>("");

  // ── 나이스 등재명 표 상태 ──
  const [registry, setRegistry] = useState<NeisMapRegistry | null>(null);
  const [subjectsSeed, setSubjectsSeed] = useState<SubjectSeed[]>([]);
  const [neisNames, setNeisNames] = useState<Record<string, string>>({}); // platformName → neisName
  const [mapLoading, setMapLoading] = useState(false);
  const [mapSaving, setMapSaving] = useState(false);
  const [mapSaved, setMapSaved] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // ── 검증 리포트 상태 ──
  const [report, setReport] = useState<NeisPrecheckReport | null>(null);
  const [precheckTarget, setPrecheckTarget] = useState<NeisPrecheckTarget | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);

  // ── 나이스 파일 일괄 생성 상태 ──
  const [bundle, setBundle] = useState<NeisCsvBundle | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showClassList, setShowClassList] = useState(false);

  // ── 체크 상태 (W2·W3 자가 확인) ──
  // 현재 registry 기반으로 초기화, 저장 전 로컬 토글
  const [checkedTeachers, setCheckedTeachers] = useState<Set<string>>(new Set());
  const [checkedPairs, setCheckedPairs] = useState<Set<string>>(new Set());

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 초기 로드: 등록부 + seed + 초안 목록 ──
  const loadMap = useCallback(async () => {
    setMapLoading(true);
    setMapError(null);
    const [mapRes, draftRes] = await Promise.all([
      api({ action: "neis_map_get", termId: activeTermId || undefined }).catch(() => ({})),
      api({ action: "draft_list" }).catch(() => ({})),
    ]);
    if (!mapRes.success) {
      setMapError(mapRes.error || "등재명 정보를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
    }
    if (mapRes.success) {
      const reg: NeisMapRegistry = mapRes.registry;
      const seed: SubjectSeed[] = mapRes.subjectsSeed || [];
      setRegistry(reg);
      setSubjectsSeed(seed);

      // seed 기반 초기 neisNames — 등록부에 있으면 그 값, 없으면 ""
      const regMap: Record<string, string> = {};
      for (const r of reg.subjects) regMap[r.platformName] = r.neisName;
      const initial: Record<string, string> = {};
      for (const s of seed) {
        initial[s.name] = regMap[s.name] ?? "";
      }
      setNeisNames(initial);
      setCheckedTeachers(new Set(reg.confirmedTeachers));
      setCheckedPairs(new Set(reg.confirmedPairs));
    }
    if (draftRes.success) {
      const list = (draftRes.drafts || []) as any[];
      setDrafts(list.map((d: any) => ({ id: d.id, label: d.label })));
      if (list.length > 0) setSelectedDraftId((cur) => cur || list[0].id);
    }
    setMapLoading(false);
  }, [activeTermId]);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  // ── 일괄 "시간표 과목명 그대로" 채우기 ──
  const fillAllWithPlatformName = () => {
    setNeisNames((prev) => {
      const next = { ...prev };
      for (const s of subjectsSeed) {
        next[s.name] = s.name;
      }
      return next;
    });
    setMapSaved(false);
  };

  // ── 등록부 저장 ──
  const saveMap = async () => {
    setMapSaving(true);
    setMapError(null);
    const seedRows = subjectsSeed.map((s) => ({
      platformName: s.name,
      neisName: neisNames[s.name] ?? "",
    }));
    const seedNames = new Set(subjectsSeed.map((s) => s.name));
    const carried = (registry?.subjects || []).filter((r) => !seedNames.has(r.platformName));
    const res = await api({
      action: "neis_map_save",
      neisMap: {
        subjects: [...seedRows, ...carried],
        confirmedTeachers: Array.from(checkedTeachers),
        confirmedPairs: Array.from(checkedPairs),
      },
    }).catch(() => ({}));

    if (res.success) {
      setRegistry(res.registry);
      setMapSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setMapSaved(false), 3000);
    } else {
      setMapError(res.error || "등재명 등록부 저장에 실패했습니다.");
    }
    setMapSaving(false);
  };

  // ── 사전 검증 실행 ──
  const runPrecheck = async () => {
    setPrecheckLoading(true);
    setPrecheckError(null);
    setReport(null);
    const target: NeisPrecheckTarget =
      targetKind === "term"
        ? { kind: "term", id: activeTermId || "", label: "현재 활성 학기" }
        : { kind: "draft", id: selectedDraftId, label: "자동 작성 초안" };
    setPrecheckTarget(target);

    const res = await api({
      action: "neis_precheck",
      target,
    }).catch(() => ({}));

    if (res.success) {
      setReport(res.report);
    } else {
      setPrecheckError(res.error || "사전 검증 실행에 실패했습니다.");
    }
    setPrecheckLoading(false);
  };

  const toggleTeacherCheck = (email: string) => {
    setCheckedTeachers((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
    setMapSaved(false);
  };

  const togglePairCheck = (key: string) => {
    setCheckedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMapSaved(false);
  };

  // ── ZIP 파일 다운로드 ──
  const downloadZipBundle = useCallback(async (b: NeisCsvBundle, label: string) => {
    const zip = new JSZip();
    for (const file of b.files) {
      zip.file(`기초시간표(${file.label}).csv`, file.csv);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const safeLabel = (label || "시간표").replace(/[/\\?%*:|"<>]/g, "_");
    const zipFilename = `기초시간표_나이스_${safeLabel}.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // ── 개별 학급 CSV 다운로드 ──
  const downloadSingleCsv = useCallback((file: NeisCsvFile) => {
    const filename = `기초시간표(${file.label}).csv`;
    const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // ── 나이스 파일 일괄 생성 및 다운로드 실행 ──
  const executeExport = async () => {
    setExportLoading(true);
    setExportError(null);

    const body =
      targetKind === "term"
        ? { action: "neis_csv", termId: activeTermId || undefined }
        : { action: "neis_csv", draftId: selectedDraftId };

    try {
      const res = await api(body);
      if (!res.success) {
        setExportError(res.error || "나이스 파일 생성에 실패했습니다.");
        if (res.report) {
          setReport(res.report);
        }
        if (res.target) {
          setPrecheckTarget(res.target);
        }
        setExportLoading(false);
        return;
      }

      const bundleData: NeisCsvBundle = res.bundle;
      const targetData: NeisPrecheckTarget = res.target;
      setBundle(bundleData);
      if (res.report) {
        setReport(res.report);
      }
      if (targetData) {
        setPrecheckTarget(targetData);
      }

      // 자동으로 ZIP 다운로드 실행
      await downloadZipBundle(
        bundleData,
        targetData?.label || (targetKind === "term" ? "현재학기" : "초안")
      );
    } catch (err: any) {
      setExportError(err?.message || "파일 생성 중 오류가 발생했습니다.");
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* 상단 제목 및 설명 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>📤 나이스 일괄 내보내기 사전 검증</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200">
              사전 검증 필수
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            기초시간표(또는 초안)를 나이스에 일괄 등록하기 전, 과목 등재명 매핑과 교사/담당 등록 상태를 사전 점검합니다.
          </p>
        </div>
      </div>

      {/* ── 1. 대상 선택 및 사전 검증 버튼 ── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-bold text-slate-700">검증 대상:</span>
          <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
            <input
              type="radio"
              name="targetKind"
              checked={targetKind === "term"}
              onChange={() => setTargetKind("term")}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>현재 활성 학기 기초시간표</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
            <input
              type="radio"
              name="targetKind"
              checked={targetKind === "draft"}
              onChange={() => setTargetKind("draft")}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span>자동 작성 초안</span>
          </label>

          {targetKind === "draft" && (
            <select
              value={selectedDraftId}
              onChange={(e) => setSelectedDraftId(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1 font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={runPrecheck}
            disabled={precheckLoading || (targetKind === "draft" && !selectedDraftId)}
            className="ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg transition-colors shadow-xs"
          >
            {precheckLoading ? "검증 실행 중..." : "🔍 사전 검증 실행"}
          </button>
        </div>

        {precheckError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
            {precheckError}
          </div>
        )}
      </div>

      {/* ── 2. 사전 검증 리포트 ── */}
      {report && (
        <div className="space-y-4">
          {/* 차단 원인 B1 */}
          {report.blockers.unmappedSubjects.length > 0 ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
                <span className="px-2 py-0.5 bg-rose-600 text-white rounded font-black">B1 차단</span>
                <span>나이스 과목 등재명이 등록되지 않은 과목이 있습니다 ({report.blockers.unmappedSubjects.length}건)</span>
              </div>
              <p className="text-[11px] text-rose-700">
                아래 과목 등재명 입력표에서 나이스 등재명을 입력하고 저장해야 일괄 내보내기가 가능합니다.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {report.blockers.unmappedSubjects.map((b: NeisPrecheckSubjectIssue) => (
                  <span
                    key={b.platformName}
                    className="px-2.5 py-1 bg-white border border-rose-300 text-rose-800 rounded-md text-xs font-bold shadow-2xs"
                  >
                    {b.platformName}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs font-bold text-emerald-900 flex items-center gap-2">
              <span>✅ B1 차단 항목 없음 — 모든 과목의 나이스 등재명이 등록되어 있습니다.</span>
            </div>
          )}

          {/* 진행률 바 3종 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
            <h4 className="text-xs font-bold text-slate-800 mb-2">📊 등록 및 점검 진행률</h4>
            <ProgressBar
              value={report.summary.mappedSubjects}
              total={report.summary.subjects}
              label="과목 등재명 등록"
            />
            <ProgressBar
              value={report.summary.confirmedTeachers}
              total={report.summary.teachers}
              label="교사 나이스 등록"
            />
            <ProgressBar
              value={report.summary.confirmedPairs}
              total={report.summary.pairs}
              label="담당 수업 등록"
            />
          </div>

          {/* W1 가상 교사 안내 */}
          {report.warnings.virtualLessons.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5 text-xs text-amber-900">
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠️ 가상 교사 (창체·SLAT 등 자리표시 계정): {report.warnings.virtualLessons.length}명</span>
              </div>
              <p className="text-[11px] text-amber-800">
                가상 교사의 시수는 나이스 내보내기 시 제외되거나 별도 양식 처리됩니다.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {report.warnings.virtualLessons.map((v: NeisPrecheckTeacherIssue) => (
                  <span
                    key={v.teacherKey}
                    className="px-2 py-0.5 bg-white border border-amber-300 text-amber-900 rounded text-[11px] font-semibold"
                  >
                    {v.teacherName} (주 {v.lessonCount}시간)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* W2·W3 자가 확인 체크리스트 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* W2 교사 나이스 등록 점검 */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-800">
                  교사 나이스 등록 점검 ({report.warnings.unconfirmedTeachers.length}명 미확인)
                </h4>
              </div>
              <p className="text-[11px] text-slate-500">
                나이스에 교사 계정이 정상 등록되어 있는지 확인 후 체크하세요.
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {report.warnings.unconfirmedTeachers.map((t: NeisPrecheckTeacherIssue) => {
                  const isChecked = checkedTeachers.has(t.teacherKey);
                  return (
                    <label
                      key={t.teacherKey}
                      className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer text-xs select-none"
                    >
                      <span className="font-medium text-slate-800">{t.teacherName} ({t.teacherKey})</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTeacherCheck(t.teacherKey)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      />
                    </label>
                  );
                })}
                {report.warnings.unconfirmedTeachers.length === 0 && (
                  <div className="p-4 text-center text-xs text-slate-400">모든 실교사가 확인되었습니다.</div>
                )}
              </div>
            </div>

            {/* W3 담당 수업 등록 점검 */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-800">
                  담당 수업 나이스 등록 점검 ({report.warnings.unconfirmedPairs.length}건 미확인)
                </h4>
              </div>
              <p className="text-[11px] text-slate-500">
                교사-과목 담당 지정이 나이스에 등록되어 있는지 확인 후 체크하세요.
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {report.warnings.unconfirmedPairs.map((p: NeisPrecheckPairIssue) => {
                  const isChecked = checkedPairs.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer text-xs select-none"
                    >
                      <span className="font-medium text-slate-800">
                        {p.teacherName} — {p.platformName}
                      </span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePairCheck(p.key)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      />
                    </label>
                  );
                })}
                {report.warnings.unconfirmedPairs.length === 0 && (
                  <div className="p-4 text-center text-xs text-slate-400">모든 담당 수업이 확인되었습니다.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. 과목 등재명 입력표 ── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs space-y-0">
        <div className="bg-slate-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-gray-900">과목 나이스 등재명 매핑표</h4>
            <p className="text-[11px] text-gray-500">
              시간표 내 약칭과 나이스 공식 등재명을 1:1 매핑합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fillAllWithPlatformName}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition-colors"
            >
              시간표 과목명으로 일괄 채우기
            </button>
            <button
              onClick={saveMap}
              disabled={mapSaving}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
            >
              {mapSaving ? "저장 중..." : mapSaved ? "✅ 저장 완료!" : "💾 등록부 저장"}
            </button>
          </div>
        </div>

        {mapError && (
          <div className="bg-red-50 border-b border-red-200 p-3 text-xs text-red-800 text-center">
            {mapError}
          </div>
        )}

        {mapLoading ? (
          <div className="p-8 text-center text-xs text-gray-500">등재명 매핑 정보를 불러오는 중입니다...</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-4 w-48">시간표 과목명 (약칭)</th>
                  <th className="py-2.5 px-4">나이스 공식 등재명</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {subjectsSeed.map((s, idx) => {
                  const val = neisNames[s.name] ?? "";
                  const isMissing = !val.trim();
                  return (
                    <tr key={s.name} className={isMissing ? "bg-rose-50/30" : "hover:bg-slate-50"}>
                      <td className="py-2 px-4 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                      <td className="py-2 px-4 font-bold text-slate-800">{s.name}</td>
                      <td className="py-2 px-4">
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNeisNames((prev) => ({ ...prev, [s.name]: v }));
                            setMapSaved(false);
                          }}
                          placeholder="나이스 등재명 입력 (필수)"
                          className={`w-full max-w-md px-3 py-1 border rounded-lg text-xs font-medium focus:outline-none focus:ring-2 ${
                            isMissing
                              ? "border-rose-300 bg-rose-50/50 text-rose-900 focus:ring-rose-400"
                              : "border-slate-300 bg-white focus:ring-indigo-500"
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 4. 나이스 파일 일괄 생성 ── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>📄 나이스 일괄 입력 파일 생성</span>
              {bundle && (
                <span className="text-xs px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  생성 완료 ({bundle.files.length}개 학급)
                </span>
              )}
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              사전 검증이 완료된 기초시간표 데이터를 나이스 일괄 등록 양식 파일로 생성하고 압축 파일(ZIP)로 내려받습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {bundle && (
              <button
                type="button"
                onClick={() =>
                  downloadZipBundle(
                    bundle,
                    precheckTarget?.label || (targetKind === "term" ? "현재학기" : "초안")
                  )
                }
                className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>📦 압축 파일 다시 받기</span>
              </button>
            )}
            <button
              type="button"
              onClick={executeExport}
              disabled={exportLoading || (targetKind === "draft" && !selectedDraftId)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
            >
              <span>{exportLoading ? "파일 생성 중..." : "📥 나이스 파일 생성 및 받기"}</span>
            </button>
          </div>
        </div>

        {/* 400 에러 또는 예외 에러 표시 (서버 문구 그대로 노출) */}
        {exportError && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3.5 text-xs text-rose-900 font-medium whitespace-pre-line leading-relaxed">
            {exportError}
          </div>
        )}

        {/* 복수 교사 수업 안내 */}
        {bundle && bundle.multiTeacherAll.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs text-amber-950">
            <div className="font-bold flex items-center gap-1.5 text-amber-900">
              <span>ℹ️ 복수 교사 수업 안내 ({bundle.multiTeacherAll.length}건)</span>
            </div>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              교사가 2명 이상 배정된 수업은 나이스 등록 양식 규약에 따라 <strong>첫 번째 교사만 파일에 반영</strong>되었습니다.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-32 overflow-y-auto">
              {bundle.multiTeacherAll.map((item, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 bg-white border border-amber-300 text-amber-900 rounded text-[11px] font-semibold shadow-2xs"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 생성된 학급별 파일 목록 (개별 내려받기 지원) */}
        {bundle && bundle.files.length > 0 && (
          <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-3">
            <div className="flex justify-between items-center">
              <h5 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <span>학급별 개별 파일 목록 ({bundle.files.length}개)</span>
                <span className="text-[11px] font-normal text-slate-500">
                  필요한 경우 특정 학급 파일만 개별로 받을 수 있습니다.
                </span>
              </h5>
              <button
                type="button"
                onClick={() => setShowClassList((prev) => !prev)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {showClassList ? "목록 접기 ▲" : "목록 펼치기 ▼"}
              </button>
            </div>

            {showClassList && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2 pt-1 max-h-60 overflow-y-auto">
                {bundle.files.map((file) => (
                  <button
                    key={file.label}
                    type="button"
                    onClick={() => downloadSingleCsv(file)}
                    className="flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-xs text-left group"
                    title={`${file.label} 파일 개별 내려받기`}
                  >
                    <span className="font-bold text-slate-800 group-hover:text-indigo-700">
                      {file.label}
                    </span>
                    <span className="text-slate-400 group-hover:text-indigo-600 text-xs">
                      ⬇️
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
