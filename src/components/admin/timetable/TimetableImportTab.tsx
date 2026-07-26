"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache, invalidateClientCache, setClientCache } from "@/lib/cache/clientCache";
import HelpTip from "@/components/common/HelpTip";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import {
  IntermediateClassGrid,
  IntermediateImportPayload,
  TeacherTimeCount,
  TimetableSettings,
  TimetableTerm,
  TimetableValidationReport,
} from "@/lib/timetable/types";

interface TimetableImportTabProps {
  settings: TimetableSettings | null;
  terms: TimetableTerm[];
  onRefreshData: () => void;
}

export default function TimetableImportTab({
  settings,
  terms,
  onRefreshData,
}: TimetableImportTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";
  const isSuperAdmin = userData?.role === "super_admin";

  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);

  // 학기 기본 정보
  const [termId, setTermId] = useState("2026-2");
  const [termName, setTermName] = useState("2026학년도 2학기");
  const [sourceNote, setSourceNote] = useState("컴시간 엑셀 인쇄 붙여넣기");

  // 붙여넣기 원본 텍스트 및 탭 상태 (1: 전체시간표, 2: 시수표)
  const [pasteTab, setPasteTab] = useState<"grid" | "timeCount">("grid");
  const [gridRawText, setGridRawText] = useState("");
  const [timeCountRawText, setTimeCountRawText] = useState("");

  // 파싱된 중간 데이터
  const [parsedGrids, setParsedGrids] = useState<IntermediateClassGrid[]>([]);
  const [parsedTimeCounts, setParsedTimeCounts] = useState<TeacherTimeCount[]>([]);

  // 교사 매핑 (teacherName -> email)
  const [teacherEmailMap, setTeacherEmailMap] = useState<Record<string, string>>({});
  const [gwsTeachers, setGwsTeachers] = useState<any[]>([]);

  // 검증 리포트 및 커밋 상태
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<TimetableValidationReport | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 일과계 관리자 이메일 입력 (super_admin 전용)
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [savingManagers, setSavingManagers] = useState(false);

  // 1. GWS 유저 목록 로드 (교사 매핑용)
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (cached) {
      setGwsTeachers(cached);
    } else {
      fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ["all"] }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.users) {
            setClientCache("users:all", data.users);
            setGwsTeachers(data.users);
          }
        })
        .catch((err) => console.error("GWS 유저 로드 실패:", err));
    }
  }, []);

  // 요일 텍스트/숫자 파싱 헬퍼
  const parseDayNumber = (val: string): number => {
    const clean = val.trim().replace("요일", "");
    if (clean === "월" || clean === "1") return 1;
    if (clean === "화" || clean === "2") return 2;
    if (clean === "수" || clean === "3") return 3;
    if (clean === "목" || clean === "4") return 4;
    if (clean === "금" || clean === "5") return 5;
    return 1;
  };

  // 2. 전체시간표 붙여넣기 텍스트 파싱
  const parseGridText = (text: string) => {
    if (!text.trim()) {
      setParsedGrids([]);
      return;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const gridMap = new Map<string, IntermediateClassGrid>(); // "grade-classNum" -> grid

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("\t").map((p) => p.trim());

      // 헤더 행 자동 건너뛰기
      if (parts[0].includes("학년") || parts[0].toLowerCase().includes("grade")) continue;
      if (parts.length < 6) continue;

      const grade = parseInt(parts[0].replace(/\D/g, ""), 10);
      const classNum = parseInt(parts[1].replace(/\D/g, ""), 10);
      const day = parseDayNumber(parts[2]);
      const period = parseInt(parts[3].replace(/\D/g, ""), 10);
      const subjectName = parts[4];
      const teacherName = parts[5];
      const room = parts[6] || undefined;
      const coTeachingKey = parts[7] || undefined;

      if (isNaN(grade) || isNaN(classNum) || isNaN(period) || !subjectName || !teacherName) {
        continue;
      }

      const key = `${grade}-${classNum}`;
      const existing = gridMap.get(key) || { grade, classNum, cells: [] };
      existing.cells.push({
        day,
        period,
        subjectName,
        teacherName,
        room,
        coTeachingKey,
      });
      gridMap.set(key, existing);
    }

    const result = Array.from(gridMap.values()).sort(
      (a, b) => a.grade - b.grade || a.classNum - b.classNum
    );
    setParsedGrids(result);
  };

  // 3. 교사별 시수표 붙여넣기 텍스트 파싱
  const parseTimeCountText = (text: string) => {
    if (!text.trim()) {
      setParsedTimeCounts([]);
      return;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const counts: TeacherTimeCount[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("\t").map((p) => p.trim());
      if (parts[0].includes("교사") || parts[0].includes("성명")) continue;
      if (parts.length < 3) continue;

      const teacherName = parts[0];
      const subjectName = parts[1];
      const targetHours = parseInt(parts[2].replace(/\D/g, ""), 10);

      if (teacherName && subjectName && !isNaN(targetHours)) {
        counts.push({ teacherName, subjectName, targetHours });
      }
    }

    setParsedTimeCounts(counts);
  };

  // 붙여넣기 변경 이벤트
  const handleGridTextChange = (text: string) => {
    setGridRawText(text);
    parseGridText(text);
  };

  const handleTimeCountTextChange = (text: string) => {
    setTimeCountRawText(text);
    parseTimeCountText(text);
  };

  // 4. 교사 자동 매칭 실행
  const autoMatchTeachers = () => {
    const teacherNames = new Set<string>();
    for (const grid of parsedGrids) {
      for (const cell of grid.cells) {
        if (cell.teacherName) teacherNames.add(cell.teacherName.trim());
      }
    }
    for (const tc of parsedTimeCounts) {
      if (tc.teacherName) teacherNames.add(tc.teacherName.trim());
    }

    const newMap: Record<string, string> = { ...teacherEmailMap };

    for (const name of Array.from(teacherNames)) {
      if (newMap[name]) continue; // 이미 수동 지정된 경우 유지

      const cleanName = name.trim();
      // GWS 교사 목록에서 이름 매칭
      const matched = gwsTeachers.find((u) => {
        const givenName = u.name?.givenName || "";
        const familyName = u.name?.familyName || "";
        const fullName = `${familyName}${givenName}`.trim();
        return (
          givenName === cleanName ||
          familyName === cleanName ||
          fullName === cleanName ||
          fullName.includes(cleanName)
        );
      });

      if (matched && matched.primaryEmail) {
        newMap[name] = matched.primaryEmail.toLowerCase();
      } else {
        newMap[name] = "";
      }
    }

    setTeacherEmailMap(newMap);
    setActiveStep(2);
  };

  // 5. 검증 실행 (import_validate)
  const runValidation = async () => {
    setValidating(true);
    setCommitMessage(null);

    const payload: IntermediateImportPayload = {
      termId,
      termName,
      sourceNote,
      rawClassGrids: parsedGrids,
      teacherTimeCounts: parsedTimeCounts,
      teacherEmailMap,
    };

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_validate",
          importPayload: payload,
        }),
      });

      const data = await res.json();
      if (res.ok && data.validationReport) {
        setValidationReport(data.validationReport);
        setActiveStep(3);
      } else {
        alert(`검증 중 오류가 발생했습니다: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (err: any) {
      alert(`네트워크 오류: ${err.message}`);
    } finally {
      setValidating(false);
    }
  };

  // 6. 초안 학기 저장 (import_commit)
  const handleCommit = async () => {
    if (!validationReport?.canCommit) {
      alert("미매칭 교사가 존재하거나 저장 조건을 충족하지 못했습니다.");
      return;
    }

    if (!confirm(`'${termName} (${termId})' 기초시간표를 초안(draft) 상태로 저장하시겠습니까?`)) {
      return;
    }

    setCommitting(true);
    setCommitMessage(null);

    const payload: IntermediateImportPayload = {
      termId,
      termName,
      sourceNote,
      rawClassGrids: parsedGrids,
      teacherTimeCounts: parsedTimeCounts,
      teacherEmailMap,
    };

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_commit",
          importPayload: payload,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        invalidateClientCache("timetable:settings");
        setCommitMessage({
          type: "success",
          text: `'${data.term?.name || termId}' 초안 저장 완료! 아래 관리 목록에서 정식 활성화를 진행하세요.`,
        });
        onRefreshData();
        setActiveStep(4);
      } else {
        setCommitMessage({
          type: "error",
          text: data.error || "학기 저장에 실패했습니다.",
        });
      }
    } catch (err: any) {
      setCommitMessage({ type: "error", text: `저장 오류: ${err.message}` });
    } finally {
      setCommitting(false);
    }
  };

  // 7. 학기 활성화 / 삭제
  const handleActivateTerm = async (id: string, name: string) => {
    if (!confirm(`'${name} (${id})' 학기를 정식 시간표로 활성화하시겠습니까? 기존 활성 학기는 보관(archived) 처리됩니다.`)) {
      return;
    }

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate_term", termId: id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateClientCache("timetable:settings");
        alert("학기가 성공적으로 활성화되었습니다.");
        onRefreshData();
      } else {
        alert(`활성화 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  const handleDeleteTerm = async (id: string, name: string) => {
    if (!confirm(`'${name} (${id})' 초안 학기를 정말 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_term", termId: id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateClientCache("timetable:settings");
        alert("초안 학기가 삭제되었습니다.");
        onRefreshData();
      } else {
        alert(`삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    }
  };

  // 8. 일과계 관리자 이메일 저장
  const handleAddManager = async () => {
    if (!newManagerEmail.trim()) return;
    const currentList = settings?.managerEmails || [];
    const targetEmail = newManagerEmail.trim().toLowerCase();
    if (currentList.includes(targetEmail)) {
      alert("이미 관리자로 등록된 이메일입니다.");
      return;
    }

    const updated = [...currentList, targetEmail];
    setSavingManagers(true);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_managers", managerEmails: updated }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClientCache("timetable:settings", {
          settings: { ...(settings || {}), managerEmails: updated, activeTermId: settings?.activeTermId || null, days: settings?.days || 5, periodsPerDay: settings?.periodsPerDay || 7 },
          terms,
        });
        window.dispatchEvent(new CustomEvent("timetableSettingsUpdated", { detail: { managerEmails: updated } }));
        setNewManagerEmail("");
        onRefreshData();
      } else {
        alert(`관리자 추가 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSavingManagers(false);
    }
  };

  const handleRemoveManager = async (email: string) => {
    const updated = (settings?.managerEmails || []).filter((m) => m !== email);
    setSavingManagers(true);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_managers", managerEmails: updated }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClientCache("timetable:settings", {
          settings: { ...(settings || {}), managerEmails: updated, activeTermId: settings?.activeTermId || null, days: settings?.days || 5, periodsPerDay: settings?.periodsPerDay || 7 },
          terms,
        });
        window.dispatchEvent(new CustomEvent("timetableSettingsUpdated", { detail: { managerEmails: updated } }));
        onRefreshData();
      } else {
        alert(`관리자 삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSavingManagers(false);
    }
  };

  // 총 생성될 수업 수 계산
  const totalParsedLessons = parsedGrids.reduce((acc, g) => acc + g.cells.length, 0);

  return (
    <div className="space-y-6">
      {/* 헤더 배너 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white rounded-xl p-6 shadow-md border border-indigo-800/40">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                일과계 전용 관리자
              </span>
              <HelpTip title="시간표 가져오기 상세 안내" variant="dark">
                <p>컴시간알리미 등 엑셀 인쇄 데이터를 복사-붙여넣기하여 교사 매핑 및 검증 후 기초시간표 학기를 생성합니다.</p>
                <p>초안(Draft) 상태로 먼저 저장한 후 무결성 검증을 거쳐 정식 학기로 활성화할 수 있습니다.</p>
              </HelpTip>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              📦 2학기 기초시간표 가져오기 & 학기 관리
            </h2>
            <p className="text-sm text-indigo-200/80 mt-1 max-w-2xl">
              컴시간 엑셀 인쇄 데이터를 붙여넣어 기초시간표 학기를 등록합니다.
            </p>
          </div>
          <button
            onClick={() => setActiveStep(4)}
            className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow transition-all border border-indigo-400/30"
          >
            📋 등록된 학기 목록 ({terms.length}개)
          </button>
        </div>
      </div>

      {/* 워크플로우 4단계 스테퍼 (Stepper) */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
        <div className="grid grid-cols-4 gap-2 text-center text-xs font-semibold">
          <button
            onClick={() => setActiveStep(1)}
            className={`py-2.5 px-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeStep === 1
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-[10px]">
              1
            </span>
            <span>데이터 붙여넣기</span>
          </button>

          <button
            onClick={() => {
              if (parsedGrids.length > 0) autoMatchTeachers();
              else alert("먼저 1단계에서 시간표 데이터를 붙여넣어 주세요.");
            }}
            className={`py-2.5 px-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeStep === 2
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-[10px]">
              2
            </span>
            <span>교사명 매핑</span>
          </button>

          <button
            onClick={() => {
              if (Object.keys(teacherEmailMap).length > 0) runValidation();
              else alert("먼저 2단계 교사 매핑을 완료해 주세요.");
            }}
            className={`py-2.5 px-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeStep === 3
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-[10px]">
              3
            </span>
            <span>검증 & 저장</span>
          </button>

          <button
            onClick={() => setActiveStep(4)}
            className={`py-2.5 px-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeStep === 4
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-[10px]">
              4
            </span>
            <span>학기 & 권한 관리</span>
          </button>
        </div>
      </div>

      {/* ── 1단계: 엑셀 데이터 붙여넣기 ──────────────────────────── */}
      {activeStep === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>Step 1. 학기 설정 및 엑셀 데이터 복사-붙여넣기</span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              엑셀(Excel) 또는 구글 스프레드시트에서 열 전체를 선택하여 아래 텍스트 상자에 붙여넣으세요 (`Ctrl+V`).
            </p>
          </div>

          {/* 학기 설정 입력 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">학기 ID (식별자)</label>
              <input
                type="text"
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
                placeholder="예: 2026-2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs text-gray-900 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">학기 정식 명칭</label>
              <input
                type="text"
                value={termName}
                onChange={(e) => setTermName(e.target.value)}
                placeholder="예: 2026학년도 2학기"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs text-gray-900 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">가져오기 출처 노트</label>
              <input
                type="text"
                value={sourceNote}
                onChange={(e) => setSourceNote(e.target.value)}
                placeholder="예: 컴시간 엑셀 전체시간표"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs text-gray-900 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* 붙여넣기 하위 탭 (전체시간표 / 시수표) */}
          <div>
            <div className="flex border-b border-gray-200 mb-4 gap-4">
              <button
                onClick={() => setPasteTab("grid")}
                className={`pb-2 text-xs font-bold border-b-2 transition-all ${
                  pasteTab === "grid"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                1️⃣ 전체시간표 복사-붙여넣기 ({parsedGrids.length}개 학급, {totalParsedLessons}개 수업 파싱됨)
              </button>
              <button
                onClick={() => setPasteTab("timeCount")}
                className={`pb-2 text-xs font-bold border-b-2 transition-all ${
                  pasteTab === "timeCount"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                2️⃣ 교사별 시수표 복사-붙여넣기 ({parsedTimeCounts.length}건 파싱됨)
              </button>
            </div>

            {pasteTab === "grid" ? (
              <div className="space-y-4">
                <div className="bg-indigo-50/60 p-3 rounded-md text-xs text-indigo-900 border border-indigo-100 flex items-start gap-2">
                  <span className="text-base">📌</span>
                  <div>
                    <span className="font-bold">엑셀 열 순서 가이드 (Tab 구분):</span>
                    <p className="mt-0.5 text-indigo-700">
                      <code>[ 학년 | 반 | 요일(월~금/1~5) | 교시(1~8) | 과목명 | 교사성명 | 강의실(선택) | 동시수업키(선택) ]</code>
                    </p>
                  </div>
                </div>
                <textarea
                  value={gridRawText}
                  onChange={(e) => handleGridTextChange(e.target.value)}
                  rows={8}
                  placeholder={`1\t1\t월\t1\t국어\t김철수\t과학실1\t이동A\n1\t1\t월\t2\t수학\t이영희\n1\t2\t월\t1\t영어\t박민수`}
                  className="w-full p-3 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-indigo-50/60 p-3 rounded-md text-xs text-indigo-900 border border-indigo-100 flex items-start gap-2">
                  <span className="text-base">📌</span>
                  <div>
                    <span className="font-bold">교사별 주당 시수표 열 순서 가이드:</span>
                    <p className="mt-0.5 text-indigo-700">
                      <code>[ 교사성명 | 과목명 | 주당 시수(숫자) ]</code>
                    </p>
                  </div>
                </div>
                <textarea
                  value={timeCountRawText}
                  onChange={(e) => handleTimeCountTextChange(e.target.value)}
                  rows={8}
                  placeholder={`김철수\t국어\t16\n이영희\t수학\t18\n박민수\t영어\t14`}
                  className="w-full p-3 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          {/* 파싱 미리보기 요약 */}
          {parsedGrids.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-xs text-emerald-900 flex justify-between items-center">
              <div>
                <span className="font-bold">✅ 파싱 성공: </span>
                총 {parsedGrids.length}개 학급 ({totalParsedLessons}시간 수업 데이터) 파싱 완료.
              </div>
              <button
                onClick={autoMatchTeachers}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow transition-all"
              >
                교사 매핑 진행 (2단계) →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 2단계: 교사 성명 <-> GWS 이메일 매핑 ─────────────────── */}
      {activeStep === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">Step 2. 교사 성명 매핑</h3>
              <p className="text-xs text-gray-500 mt-1">
                시간표 엑셀 상의 교사 이름과 Google Workspace 계정 이메일을 대조합니다.
              </p>
            </div>
            <button
              onClick={runValidation}
              disabled={validating}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow transition-all flex items-center gap-2"
            >
              {validating ? "검증 중..." : "검증 리포트 확인 (3단계) →"}
            </button>
          </div>

          {/* 매핑 상태 리스트 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 font-bold text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">시간표 교사명</th>
                  <th className="px-4 py-3 text-left">매칭 상태</th>
                  <th className="px-4 py-3 text-left">매핑할 GWS 교사 계정 (이메일)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.keys(teacherEmailMap).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      매핑할 교사 목록이 없습니다. 1단계 붙여넣기를 먼저 진행하세요.
                    </td>
                  </tr>
                ) : (
                  Object.entries(teacherEmailMap).map(([tName, email]) => {
                    const isMatched = Boolean(email);
                    return (
                      <tr key={tName} className={isMatched ? "bg-white" : "bg-amber-50/40"}>
                        <td className="px-4 py-3 font-bold text-gray-900">{tName}</td>
                        <td className="px-4 py-3">
                          {isMatched ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              자동 매칭됨
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              미매칭 (지정 필요)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <AutocompleteInput
                            value={email}
                            onChange={(val) =>
                              setTeacherEmailMap((prev) => ({ ...prev, [tName]: val }))
                            }
                            type="user"
                            domain={domain}
                            placeholder="교사 이메일 선택 또는 검색"
                            onSelect={(selectedEmail) =>
                              setTeacherEmailMap((prev) => ({
                                ...prev,
                                [tName]: selectedEmail,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3단계: 검증 리포트 & 커밋 ───────────────────────────────── */}
      {activeStep === 3 && validationReport && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">Step 3. 시간표 무결성 검증 리포트</h3>
              <p className="text-xs text-gray-500 mt-1">
                교사 오버랩, 학급 셀 누락, 시수표 불일치 항목을 점검하고 초안 학기로 저장합니다.
              </p>
            </div>
            <button
              onClick={handleCommit}
              disabled={!validationReport.canCommit || committing}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow-md transition-all flex items-center gap-2"
            >
              {committing ? "저장 중..." : "💾 기초시간표 초안(Draft) 저장하기"}
            </button>
          </div>

          {commitMessage && (
            <div
              className={`p-4 rounded-lg text-xs font-bold border ${
                commitMessage.type === "success"
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                  : "bg-red-50 text-red-900 border-red-200"
              }`}
            >
              {commitMessage.text}
            </div>
          )}

          {/* 저장 여부 판정 배너 */}
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              validationReport.canCommit
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-red-50 border-red-200 text-red-900"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{validationReport.canCommit ? "✅" : "❌"}</span>
              <div>
                <h4 className="font-bold text-sm">
                  {validationReport.canCommit
                    ? "검증 성공: 초안 학기로 저장할 준비가 되었습니다."
                    : "저장 불가: 미매칭 교사가 존재합니다."}
                </h4>
                <p className="text-xs opacity-80 mt-0.5">
                  {validationReport.isValid
                    ? "교사 수업 중복 및 누락 문제 없이 완벽합니다."
                    : "일부 경고(오버랩/시수 차이)가 있으나 초안 저장 후 수정이 가능합니다."}
                </p>
              </div>
            </div>
          </div>

          {/* 4종 KPI 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-center">
              <span className="text-xs text-indigo-600 font-semibold">총 학급 수</span>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                {validationReport.summary.totalClasses}개
              </div>
            </div>
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-center">
              <span className="text-xs text-indigo-600 font-semibold">총 교사 수</span>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                {validationReport.summary.totalTeachers}명
              </div>
            </div>
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-center">
              <span className="text-xs text-indigo-600 font-semibold">총 시수</span>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                {validationReport.summary.totalLessons}시간
              </div>
            </div>
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-center">
              <span className="text-xs text-indigo-600 font-semibold">일별 최대 교시</span>
              <div className="text-2xl font-black text-indigo-900 mt-1">
                {validationReport.summary.maxPeriodsPerDay}교시
              </div>
            </div>
          </div>

          {/* Issue Panel 1: 미매칭 교사 (Unmatched) */}
          {validationReport.unmatchedTeachers.length > 0 && (
            <div className="border border-red-200 rounded-xl bg-red-50/30 p-4 space-y-2">
              <h4 className="text-xs font-bold text-red-900 flex items-center gap-1.5">
                <span>🔴 미매칭 교사 ({validationReport.unmatchedTeachers.length}명)</span>
              </h4>
              <ul className="list-disc list-inside text-xs text-red-800 space-y-1">
                {validationReport.unmatchedTeachers.map((u) => (
                  <li key={u.teacherName}>
                    <span className="font-bold">{u.teacherName}</span> (총 {u.occurrenceCount}회 사용됨) - 2단계에서 GWS 이메일을 지정하세요.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Issue Panel 2: 교사 오버랩 (Teacher Overlap) */}
          {validationReport.overlaps.length > 0 && (
            <div className="border border-amber-200 rounded-xl bg-amber-50/30 p-4 space-y-2">
              <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <span>⚠️ 교사 중복 수업 (오버랩 {validationReport.overlaps.length}건)</span>
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto text-xs text-amber-900">
                {validationReport.overlaps.map((ov, idx) => (
                  <div key={idx} className="bg-white p-2.5 rounded border border-amber-200 flex justify-between items-center">
                    <div>
                      <span className="font-bold text-amber-950">{ov.teacherName} 교사</span> ({ov.day}요일 {ov.period}교시)
                    </div>
                    <div className="text-amber-800">
                      충돌 학급: {ov.classes.map((c) => `${c.grade}-${c.classNum}(${c.subjectName})`).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issue Panel 3: 학급 셀 오류 (Class Cell Issues) */}
          {validationReport.cellIssues.length > 0 && (
            <div className="border border-amber-200 rounded-xl bg-amber-50/30 p-4 space-y-2">
              <h4 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <span>⚠️ 학급 셀 및 수업 이상 ({validationReport.cellIssues.length}건)</span>
              </h4>
              <ul className="list-disc list-inside text-xs text-amber-900 space-y-1">
                {validationReport.cellIssues.map((ci, idx) => (
                  <li key={idx}>{ci.issue}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Issue Panel 4: 시수표 불일치 (Time Mismatches) */}
          {validationReport.timeMismatches.length > 0 && (
            <div className="border border-blue-200 rounded-xl bg-blue-50/30 p-4 space-y-2">
              <h4 className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                <span>ℹ️ 시수표 대조 불일치 ({validationReport.timeMismatches.length}건)</span>
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto text-xs text-blue-900">
                {validationReport.timeMismatches.map((tm, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border border-blue-200 flex justify-between">
                    <span>
                      <span className="font-bold">{tm.teacherName}</span> ({tm.subjectName})
                    </span>
                    <span>
                      시간표 시수: <span className="font-bold">{tm.gridHours}시간</span> / 시수표 목표: <span className="font-bold">{tm.targetHours}시간</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4단계: 등록된 학기 관리 & 일과계 관리자 설정 ─────────────── */}
      {activeStep === 4 && (
        <div className="space-y-6">
          {/* 학기 목록 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-3">
              📋 등록된 시간표 학기 목록 ({terms.length}개)
            </h3>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 font-bold text-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left">학기 ID</th>
                    <th className="px-4 py-3 text-left">학기명</th>
                    <th className="px-4 py-3 text-left">상태</th>
                    <th className="px-4 py-3 text-left">등록자 / 등록일</th>
                    <th className="px-4 py-3 text-right">제어 액션</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {terms.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        등록된 학기가 없습니다. 상단 '1단계 데이터 붙여넣기'로 새 학기를 생성하세요.
                      </td>
                    </tr>
                  ) : (
                    terms.map((t) => (
                      <tr key={t.id} className={t.status === "active" ? "bg-indigo-50/30" : ""}>
                        <td className="px-4 py-3 font-mono font-bold text-indigo-900">{t.id}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{t.name}</td>
                        <td className="px-4 py-3">
                          {t.status === "active" && (
                            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              🚀 정식 활성중
                            </span>
                          )}
                          {t.status === "draft" && (
                            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-800">
                              📝 초안(Draft)
                            </span>
                          )}
                          {t.status === "archived" && (
                            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">
                              📦 과거 보관
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {t.importedBy} ({new Date(t.importedAt).toLocaleDateString()})
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {t.status !== "active" && (
                            <button
                              onClick={() => handleActivateTerm(t.id, t.name)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-[11px] transition-all"
                            >
                              🚀 활성화
                            </button>
                          )}
                          {t.status === "draft" && (
                            <button
                              onClick={() => handleDeleteTerm(t.id, t.name)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded text-[11px] transition-all"
                            >
                              🗑️ 삭제
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 일과계 관리자 설정 (super_admin 전용) */}
          {isSuperAdmin && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-3 flex items-center justify-between">
                <span>🛡️ 일과계 관리자 권한 지정 (super_admin 전용)</span>
                <span className="text-xs text-gray-500 font-normal">
                  지정된 교직원은 시간표 가져오기 및 학기 관리 권한을 가집니다.
                </span>
              </h3>

              <div className="flex gap-2 max-w-md">
                <AutocompleteInput
                  value={newManagerEmail}
                  onChange={setNewManagerEmail}
                  type="user"
                  domain={domain}
                  placeholder="추가할 일과계 교사 이메일 선택"
                  onSelect={(email) => setNewManagerEmail(email)}
                />
                <button
                  onClick={handleAddManager}
                  disabled={savingManagers}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow shrink-0"
                >
                  추가
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {(settings?.managerEmails || []).length === 0 ? (
                  <p className="text-xs text-gray-400">지정된 일과계 관리자가 없습니다 (super_admin만 관리 가능).</p>
                ) : (
                  (settings?.managerEmails || []).map((mEmail) => (
                    <span
                      key={mEmail}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-900 border border-indigo-200"
                    >
                      <span>{mEmail}</span>
                      <button
                        onClick={() => handleRemoveManager(mEmail)}
                        disabled={savingManagers}
                        className="hover:text-red-600 font-bold text-indigo-400"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
