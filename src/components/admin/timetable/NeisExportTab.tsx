"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  NeisRow,
  NeisMapRegistry,
  NeisPrecheckReport,
  NeisPrecheckTarget,
} from "@/lib/timetable/types";

interface DraftSummary {
  id: string;
  label: string;
}

interface NeisExportTabProps {
  activeTermId: string | null;
}

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

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

// ═══════════════════════════════════════════════════════════════
// 섹션 2 — 기초시간표 일괄 내보내기 (사전 검증)
// ═══════════════════════════════════════════════════════════════
interface SubjectSeed {
  name: string;
  shortName: string;
}

interface NeisSectionProps {
  activeTermId: string | null;
}

function NeisPreCheckSection({ activeTermId }: NeisSectionProps) {
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

  // ── 검증 리포트 상태 ──
  const [report, setReport] = useState<NeisPrecheckReport | null>(null);
  const [precheckTarget, setPrecheckTarget] = useState<NeisPrecheckTarget | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);

  // ── 체크 상태 (W2·W3 자가 확인) ──
  // 현재 registry 기반으로 초기화, 저장 전 로컬 토글
  const [checkedTeachers, setCheckedTeachers] = useState<Set<string>>(new Set());
  const [checkedPairs, setCheckedPairs] = useState<Set<string>>(new Set());

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 초기 로드: 등록부 + seed + 초안 목록 ──
  const loadMap = useCallback(async () => {
    setMapLoading(true);
    const [mapRes, draftRes] = await Promise.all([
      api({ action: "neis_map_get", termId: activeTermId || undefined }),
      api({ action: "draft_list" }),
    ]);
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
      if (list.length > 0 && !selectedDraftId) setSelectedDraftId(list[0].id);
    }
    setMapLoading(false);
  }, [activeTermId]);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  // ── 일괄 "플랫폼명 그대로" 채우기 ──
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
    const subjects = subjectsSeed.map((s) => ({
      platformName: s.name,
      neisName: neisNames[s.name] ?? "",
    }));
    const res = await api({
      action: "neis_map_save",
      neisMap: {
        subjects,
        confirmedTeachers: Array.from(checkedTeachers),
        confirmedPairs: Array.from(checkedPairs),
      },
    });
    setMapSaving(false);
    if (res.success) {
      setMapSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setMapSaved(false), 3000);
      // registry 갱신
      await loadMap();
    }
  };

  // ── 사전 검증 실행 ──
  const runPrecheck = async () => {
    setPrecheckLoading(true);
    setPrecheckError(null);
    setReport(null);
    const body: Record<string, unknown> = { action: "neis_precheck" };
    if (targetKind === "draft" && selectedDraftId) {
      body.draftId = selectedDraftId;
    } else {
      body.termId = activeTermId || undefined;
    }
    const res = await api(body);
    setPrecheckLoading(false);
    if (res.success) {
      setReport(res.report);
      setPrecheckTarget(res.target);
    } else {
      setPrecheckError(res.error || "검증 실행 중 오류가 발생했습니다.");
    }
  };

  // ── W2 교원 확인 토글 ──
  const toggleTeacher = (key: string) => {
    setCheckedTeachers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMapSaved(false);
  };

  // ── W3 담당 확인 토글 ──
  const togglePair = (key: string) => {
    setCheckedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMapSaved(false);
  };

  const summary = report?.summary;

  return (
    <div className="border-t-2 border-dashed border-indigo-200 pt-6 space-y-6">
      {/* 섹션 헤더 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>📋 기초시간표 일괄 내보내기</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-violet-100 text-violet-800">
              사전 검증
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            나이스 업로드 전 빈칸 오류를 예방하기 위해 등재명을 등록하고 항목을 확인합니다.
          </p>
        </div>

        {/* CSV 내보내기 — F-2 스텁 */}
        <button
          disabled
          title="9월 나이스 샘플 확보 후 활성화될 예정입니다."
          className="px-4 py-2 bg-gray-200 text-gray-400 font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-not-allowed shrink-0"
        >
          <span>📂 CSV 내보내기</span>
          <span className="text-[10px] font-normal">(샘플 확보 후 활성화)</span>
        </button>
      </div>

      {/* ── 대상 선택 ─────────────────────────────────────────── */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-bold text-slate-700 mb-3">검증 대상</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="neisTarget"
              checked={targetKind === "term"}
              onChange={() => setTargetKind("term")}
              className="text-indigo-600"
            />
            현행 학기 기초시간표
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="neisTarget"
              checked={targetKind === "draft"}
              onChange={() => setTargetKind("draft")}
              className="text-indigo-600"
            />
            자동 작성 초안
          </label>
          {targetKind === "draft" && (
            <select
              value={selectedDraftId}
              onChange={(e) => setSelectedDraftId(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {drafts.length === 0 && <option value="">초안 없음</option>}
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
            className="ml-auto px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
          >
            {precheckLoading ? "검증 중…" : "사전 검증 실행"}
          </button>
        </div>
      </div>

      {/* ── 검증 결과 ──────────────────────────────────────────── */}
      {precheckError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800">
          {precheckError}
        </div>
      )}

      {report && summary && (
        <div className="space-y-4">
          {/* 진행률 요약 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-gray-700">
                {precheckTarget
                  ? `검증 대상: ${precheckTarget.kind === "draft" ? "초안 " : ""}${precheckTarget.label}`
                  : "사전 검증 결과"}
              </p>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                  report.readyForExport
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {report.readyForExport ? "✅ 내보내기 가능" : "🚫 차단 항목 있음"}
              </span>
            </div>
            <ProgressBar
              label="과목 등재명"
              value={summary.mappedSubjects}
              total={summary.subjects}
            />
            <ProgressBar
              label="교원 등재 확인"
              value={summary.confirmedTeachers}
              total={summary.teachers}
            />
            <ProgressBar
              label="교사·과목 담당 확인"
              value={summary.confirmedPairs}
              total={summary.pairs}
            />
          </div>

          {/* B1 차단 항목 */}
          {report.blockers.unmappedSubjects.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                🚫 나이스 등재명 미입력 — CSV 내보내기 차단
              </p>
              <ul className="space-y-1">
                {report.blockers.unmappedSubjects.map((b) => (
                  <li key={b.platformName} className="text-xs text-red-800 pl-4 list-disc list-inside">
                    {b.text}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-600 mt-1">
                ↳ 아래 [나이스 등재명 입력표]에서 해당 과목의 등재명을 입력하고 저장하세요.
              </p>
            </div>
          )}

          {/* W1 — 가상 교사 */}
          {report.warnings.virtualLessons.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-orange-700 flex items-center gap-1.5">
                ⚠️ 계정 없는 교사 수업 — 나이스 처리 방식 미정 (9월 샘플 확보 후 확정)
              </p>
              <ul className="space-y-1">
                {report.warnings.virtualLessons.map((w) => (
                  <li key={w.teacherKey} className="text-xs text-orange-800 pl-4 list-disc list-inside">
                    {w.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* W2 — 교원 등재 미확인 */}
          {report.warnings.unconfirmedTeachers.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-amber-700 mb-2">
                □ 나이스 교원 등재 확인 체크리스트
                <span className="font-normal ml-1 text-amber-600">
                  (나이스에서 등재 여부를 확인한 교원에 체크하세요)
                </span>
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {report.warnings.unconfirmedTeachers.map((w) => {
                  const isChecked = checkedTeachers.has(w.teacherKey);
                  return (
                    <label
                      key={w.teacherKey}
                      className={`flex items-start gap-2.5 text-xs cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                        isChecked ? "bg-emerald-50 text-emerald-800" : "bg-white text-amber-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTeacher(w.teacherKey)}
                        className="mt-0.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                      />
                      <span>
                        <span className="font-semibold">{w.teacherName}</span>
                        <span className="ml-1 text-[11px] opacity-75">— 주 {w.lessonCount}시간</span>
                        {isChecked && (
                          <span className="ml-2 text-[10px] font-bold text-emerald-600">나이스에서 확인함</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* W3 — 담당 등록 미확인 */}
          {report.warnings.unconfirmedPairs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-amber-700 mb-2">
                □ 나이스 교사·과목 담당 등록 확인 체크리스트
                <span className="font-normal ml-1 text-amber-600">
                  (나이스에서 담당 등록을 확인한 항목에 체크하세요)
                </span>
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {report.warnings.unconfirmedPairs.map((p) => {
                  const isChecked = checkedPairs.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex items-start gap-2.5 text-xs cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                        isChecked ? "bg-emerald-50 text-emerald-800" : "bg-white text-amber-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePair(p.key)}
                        className="mt-0.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                      />
                      <span>
                        <span className="font-semibold">{p.teacherName}</span>
                        <span className="mx-1 text-[11px] opacity-50">·</span>
                        <span className="font-medium">{p.platformName}</span>
                        {p.neisName && p.neisName !== p.platformName && (
                          <span className="ml-1 text-[11px] text-indigo-600">
                            (나이스명: {p.neisName})
                          </span>
                        )}
                        <span className="ml-1 text-[11px] opacity-75">— {p.classCount}개 반</span>
                        {isChecked && (
                          <span className="ml-2 text-[10px] font-bold text-emerald-600">나이스에서 확인함</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 모든 항목 확인 완료 메시지 */}
          {report.readyForExport &&
            report.warnings.unconfirmedTeachers.length === 0 &&
            report.warnings.unconfirmedPairs.length === 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-800 font-semibold text-center">
                ✅ 차단 및 체크리스트 항목이 모두 해소되었습니다. CSV 내보내기 준비 완료(F-2 활성화 후).
              </div>
            )}

          {/* 확인 사항 변경 시 저장 안내 */}
          {(checkedTeachers.size > 0 || checkedPairs.size > 0) && (
            <div className="flex justify-end">
              <button
                onClick={saveMap}
                disabled={mapSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
              >
                {mapSaving ? "저장 중…" : mapSaved ? "✓ 저장됨" : "확인 내용 저장"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 나이스 등재명 입력표 ────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-indigo-950">
          <p className="text-xs font-bold text-white">📝 과목별 나이스 등재명 입력</p>
          <div className="flex items-center gap-2">
            <button
              onClick={fillAllWithPlatformName}
              className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 text-white text-[11px] font-bold rounded-lg transition-colors"
              title="우리 플랫폼 과목명이 나이스 등재명과 동일한 경우 일괄 채웁니다."
            >
              플랫폼명 그대로 일괄 채우기
            </button>
            <button
              onClick={saveMap}
              disabled={mapSaving}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-colors shadow-xs ${
                mapSaved
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-500 hover:bg-amber-400 text-white"
              }`}
            >
              {mapSaving ? "저장 중…" : mapSaved ? "✓ 저장됨" : "저장"}
            </button>
          </div>
        </div>

        {mapLoading ? (
          <div className="py-10 text-center text-xs text-slate-400">불러오는 중…</div>
        ) : subjectsSeed.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            학기 과목 정보가 없습니다. 먼저 시간표를 가져와 학기를 등록하세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="py-2.5 px-4 border-b border-r border-gray-100 font-bold text-slate-700 w-8 text-center">#</th>
                  <th className="py-2.5 px-4 border-b border-r border-gray-100 font-bold text-slate-700">플랫폼 과목명</th>
                  <th className="py-2.5 px-4 border-b border-r border-gray-100 font-bold text-slate-700 w-24">약칭</th>
                  <th className="py-2.5 px-4 border-b border-gray-100 font-bold text-slate-700">
                    나이스 등재명
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                      (비워두면 내보내기 차단)
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subjectsSeed.map((s, idx) => {
                  const val = neisNames[s.name] ?? "";
                  const empty = val.trim() === "";
                  return (
                    <tr key={s.name} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                      <td className="py-2 px-4 border-r border-gray-100 text-center text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-4 border-r border-gray-100 font-medium text-slate-800">
                        {s.name}
                      </td>
                      <td className="py-2 px-4 border-r border-gray-100 text-slate-500">
                        {s.shortName}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => {
                            setNeisNames((prev) => ({ ...prev, [s.name]: e.target.value }));
                            setMapSaved(false);
                          }}
                          placeholder="나이스에 등록된 과목명 입력"
                          className={`w-full border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors ${
                            empty
                              ? "border-red-300 bg-red-50 placeholder-red-300 text-red-800"
                              : "border-slate-200 bg-white text-slate-900"
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════════
export default function NeisExportTab({ activeTermId }: NeisExportTabProps) {
  // 오늘 기준 주 시작일(월)과 종료일(일) 계산
  const getTodayRange = () => {
    const now = new Date();
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      start: mon.toISOString().split("T")[0],
      end: sun.toISOString().split("T")[0],
    };
  };

  const defaultRange = getTodayRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [onlySubstitute, setOnlySubstitute] = useState(false);

  const [rows, setRows] = useState<NeisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNeisList = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "neis_list",
          termId: activeTermId || undefined,
          startDate,
          endDate,
          type: onlySubstitute ? "substitute" : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRows(data.rows || []);
      } else {
        setError(data.error || "NEIS 수업교환 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeTermId, startDate, endDate, onlySubstitute]);

  useEffect(() => {
    fetchNeisList();
  }, [fetchNeisList]);

  // 엑셀 다운로드 (SheetJS)
  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    const excelData = rows.map((r) => ({
      "변경있는 교시(일자·교시)": `${r.date} (${DAY_LABEL[r.day] || ""} ${r.period}교시)`,
      "학년-반": `${r.grade}-${r.classNum}반`,
      교사: r.teacherName,
      과목: r.subjectName,
      "변경전 교시": `${r.prevDate} (${DAY_LABEL[r.prevDay] || ""} ${r.prevPeriod}교시)`,
      "비고(특별보강 대체교사)": r.note || "",
      구분: r.type === "cross_swap" ? "교차주맞교환" : r.type === "swap" ? "맞교환" : "특별보강",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    ws["!cols"] = [
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 22 },
      { wch: 20 },
      { wch: 10 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "NEIS_수업교환목록");
    const filename = `NEIS_수업교환목록_${startDate}_${endDate}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* ════════════════════════════════════════════
          섹션 1 — 수업교환 NEIS 목록 (기존 유지)
          ════════════════════════════════════════════ */}
      <div>
        {/* 상단 제목 및 설명 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📑 NEIS 입력용 수업교환 목록</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800">
                컴시간 양식 계승
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              실무사의 현행 수기 입력 흐름을 지원하기 위해 승인된 시간표 변경 사항을 NEIS 양식대로 조회 및
              엑셀 다운로드합니다.
            </p>
          </div>

          <button
            onClick={handleExportExcel}
            disabled={loading || rows.length === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-xs shrink-0"
          >
            <span>📊 엑셀 다운로드 (.xlsx)</span>
          </button>
        </div>

        {/* 필터 컨트롤러 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700">조회 기간:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-400">~</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none ml-2">
              <input
                type="checkbox"
                checked={onlySubstitute}
                onChange={(e) => setOnlySubstitute(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <span>특별보강만 보기</span>
            </label>
          </div>

          <button
            onClick={fetchNeisList}
            disabled={loading}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>

        {/* 정보 배너 */}
        <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center mt-4">
          <div>
            조회 기간: <span className="font-bold">{startDate} ~ {endDate}</span>
            {onlySubstitute && <span className="ml-1 text-orange-700 font-bold">(특별보강 전용)</span>}
            {" · "}총 <span className="font-black text-indigo-700">{rows.length}건</span>의 수업 변경 내역
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center mt-4">
            {error}
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl mt-4">
            <p className="text-sm font-semibold text-gray-500">해당 기간 내에 승인된 수업 변경 내역이 없습니다.</p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm mt-4">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-indigo-950 text-white font-bold text-center">
                  <th className="py-3 px-3 border-b border-r border-indigo-800 w-36">변경있는 교시</th>
                  <th className="py-3 px-2 border-b border-r border-indigo-800 w-20">학급</th>
                  <th className="py-3 px-3 border-b border-r border-indigo-800 w-28">교사</th>
                  <th className="py-3 px-3 border-b border-r border-indigo-800 w-32">과목</th>
                  <th className="py-3 px-3 border-b border-r border-indigo-800 w-36">변경전 교시</th>
                  <th className="py-3 px-3 border-b border-r border-indigo-800">비고 (대체 교사)</th>
                  <th className="py-3 px-2 border-b border-indigo-800 w-20">구분</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((r, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                    <td className="py-3 px-3 border-r border-gray-100 text-center font-bold text-gray-800">
                      <div>{r.date}</div>
                      <div className="text-[11px] text-indigo-700 font-semibold">
                        {DAY_LABEL[r.day] || ""}요일 {r.period}교시
                      </div>
                    </td>
                    <td className="py-3 px-2 border-r border-gray-100 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-100">
                        {r.grade}-{r.classNum}반
                      </span>
                    </td>
                    <td className="py-3 px-3 border-r border-gray-100 text-center font-bold text-gray-900">
                      {r.teacherName}
                    </td>
                    <td className="py-3 px-3 border-r border-gray-100 text-center font-semibold text-gray-800">
                      {r.subjectName}
                    </td>
                    <td className="py-3 px-3 border-r border-gray-100 text-center text-gray-600">
                      <div>{r.prevDate}</div>
                      <div className="text-[11px] text-gray-500">
                        {DAY_LABEL[r.prevDay] || ""}요일 {r.prevPeriod}교시
                      </div>
                    </td>
                    <td className="py-3 px-3 border-r border-gray-100 text-left font-medium text-gray-800">
                      {r.note ? (
                        <span className="text-indigo-900 font-semibold">{r.note}</span>
                      ) : (
                        <span className="text-gray-400 font-light">-</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-center font-bold">
                      {r.type === "cross_swap" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700 border border-purple-200">
                          교차주맞교환
                        </span>
                      ) : r.type === "swap" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200">
                          맞교환
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-orange-50 text-orange-700 border border-orange-200">
                          특별보강
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════
          섹션 2 — 기초시간표 일괄 내보내기 (신설)
          ════════════════════════════════════════════ */}
      <NeisPreCheckSection activeTermId={activeTermId} />
    </div>
  );
}
