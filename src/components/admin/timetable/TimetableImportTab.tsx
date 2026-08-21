"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache, invalidateClientCache, setClientCache } from "@/lib/cache/clientCache";
import HelpTip from "@/components/common/HelpTip";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import * as XLSX from "xlsx";
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

/**
 * 컴시간 엑셀 가져오기(1~3단계) 화면 노출 여부 — 2026-08-14 사용자 결정으로 숨김.
 * 신학기 편성이 자체 경로(9c-H: 시수표 업로드·자동 작성)로 확정되어 쓸 일이 없고,
 * 일과계 실사용자에게 혼란을 준다. 코드를 지우지 않는 이유: 2단계 성명→이메일 매핑 UI를
 * 9c-H 시수표 업로드가 재사용할 예정(phase9c_h_spec.md §0-1a). 복원은 true로.
 */
const SHOW_COMCIGAN_IMPORT = false;

export default function TimetableImportTab({
  settings,
  terms,
  onRefreshData,
}: TimetableImportTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";
  const isSuperAdmin = userData?.role === "super_admin";

  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(SHOW_COMCIGAN_IMPORT ? 1 : 4);

  // 학기 기본 정보
  const [termId, setTermId] = useState("2026-2");
  const [termName, setTermName] = useState("2026학년도 2학기");
  const [sourceNote, setSourceNote] = useState("컴시간 엑셀 전체시간표 업로드");

  // 가져오기 방식 (excel: 파일 업로드 추천, paste: TSV 붙여넣기 폴백)
  const [importMode, setImportMode] = useState<"excel" | "paste">("excel");

  // 엑셀 파일 상태
  const [fullScheduleFileName, setFullScheduleFileName] = useState("");
  const [weeklyScheduleFileName, setWeeklyScheduleFileName] = useState("");
  const [fullScheduleSummary, setFullScheduleSummary] = useState("");
  const [weeklyScheduleSummary, setWeeklyScheduleSummary] = useState("");

  // 주간시간표 분석 결과 보관 (업로드 순서 독립적 교차 검증용)
  const [weeklyTeachersData, setWeeklyTeachersData] = useState<{
    teachers: { seq: number; name: string; teacherRaw: string; lessons: any[] }[];
    duplicateWarnings: { name: string; seq: number; prevSeq: number }[];
    occupiedCells: number;
    freeCells: number;
  } | null>(null);

  // 교차 검증 리포트
  const [crossValidation, setCrossValidation] = useState<{
    matchCount: number;
    mismatchList: string[];
    duplicateWarnings: { name: string; seq: number; prevSeq: number }[];
    occupiedCells: number;
    freeCells: number;
    realTeacherCount: number;
    virtualTeacherCount: number;
  } | null>(null);

  // 붙여넣기 원본 텍스트 및 탭 상태 (1: 전체시간표, 2: 시수표)
  const [pasteTab, setPasteTab] = useState<"grid" | "timeCount">("grid");
  const [gridRawText, setGridRawText] = useState("");
  const [timeCountRawText, setTimeCountRawText] = useState("");

  // 분석된 중간 데이터
  const [parsedGrids, setParsedGrids] = useState<IntermediateClassGrid[]>([]);
  const [parsedTimeCounts, setParsedTimeCounts] = useState<TeacherTimeCount[]>([]);

  // 교사 매핑 (teacherName -> email)
  const [teacherEmailMap, setTeacherEmailMap] = useState<Record<string, string>>({});
  // 가상 교사(SLAT·창체 등) — 계정 없이 저장 (2026-08-02)
  const [virtualTeacherNames, setVirtualTeacherNames] = useState<string[]>([]);
  // 매핑 검색어 표시 전용 state — 제출값(teacherEmailMap)은 onSelect에서만 세팅 (AGENTS.md §4)
  const [mappingQueries, setMappingQueries] = useState<Record<string, string>>({});
  const [gwsTeachers, setGwsTeachers] = useState<any[]>([]);

  // 검증 리포트 및 커밋 상태
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<TimetableValidationReport | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 일과계 관리자 이메일 입력 (super_admin 전용)
  const [newManagerQuery, setNewManagerQuery] = useState("");
  const [selectedManagerEmail, setSelectedManagerEmail] = useState("");
  const [savingManagers, setSavingManagers] = useState(false);

  // 열람 전용 참관자(observerEmails) 입력 (super_admin 전용, phase9b_spec §5)
  const [newObserverQuery, setNewObserverQuery] = useState("");
  const [selectedObserverEmail, setSelectedObserverEmail] = useState("");
  const [savingObservers, setSavingObservers] = useState(false);

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

  // 요일 텍스트/숫자 분석 헬퍼
  const parseDayNumber = (val: string): number => {
    const clean = val.trim().replace("요일", "");
    if (clean === "월" || clean === "1") return 1;
    if (clean === "화" || clean === "2") return 2;
    if (clean === "수" || clean === "3") return 3;
    if (clean === "목" || clean === "4") return 4;
    if (clean === "금" || clean === "5") return 5;
    return 1;
  };

  // ─── §9-2 엑셀 파일 파서 1: 전체시간표.xlsx ──────────────────────────────
  const parseFullScheduleBuffer = (arrayBuffer: ArrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

    let headerRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const c0 = String(rows[i][0] || "").trim();
      const c1 = String(rows[i][1] || "").trim();
      if (c0 === "학년" || c1 === "반" || (c0.includes("학년") && c1.includes("반"))) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error("전체시간표.xlsx 헤더 행('학년', '반')을 찾을 수 없습니다.");
    }

    const dayRow = rows[headerRowIdx];
    const periodRow = rows[headerRowIdx + 1];

    const colMap: { colIndex: number; day: number; period: number; dayLabel: string }[] = [];
    let currentDayLabel = "";
    let dayIndex = 0;

    for (let col = 2; col < dayRow.length; col++) {
      const dayLabel = String(dayRow[col] || "").trim();
      if (dayLabel) {
        currentDayLabel = dayLabel;
        dayIndex++;
      }
      const periodNum = parseInt(String(periodRow[col] || "").trim(), 10);
      if (currentDayLabel && !isNaN(periodNum)) {
        colMap.push({ colIndex: col, day: dayIndex, period: periodNum, dayLabel: currentDayLabel });
      }
    }

    const gridMap = new Map<string, IntermediateClassGrid>();
    let lastGrade = 1;
    let occupiedCount = 0;

    for (let i = headerRowIdx + 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const rawGrade = String(row[0] || "").trim();
      if (rawGrade) {
        const g = parseInt(rawGrade, 10);
        if (!isNaN(g)) lastGrade = g;
      }

      const rawClass = String(row[1] || "").trim();
      const classNum = parseInt(rawClass, 10);
      if (isNaN(classNum)) continue;

      const key = `${lastGrade}-${classNum}`;
      const existing = gridMap.get(key) || { grade: lastGrade, classNum, cells: [] };

      colMap.forEach(({ colIndex, day, period }) => {
        const cellVal = String(row[colIndex] || "").trim();
        if (!cellVal) return;

        occupiedCount++;
        const parts = cellVal.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        let subjectName = "";
        let teacherName = "";

        if (parts.length >= 2) {
          subjectName = parts[0];
          teacherName = parts[1];
        } else if (parts.length === 1) {
          subjectName = parts[0];
          teacherName = parts[0]; // 가상 교사 (SLAT, 창체 등)
        }

        existing.cells.push({
          day,
          period,
          subjectName,
          teacherName,
        });
      });

      gridMap.set(key, existing);
    }

    const grids = Array.from(gridMap.values()).sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
    return { grids, totalOccupiedCells: occupiedCount, colMap };
  };

  // ─── §9-2 엑셀 파일 파서 2: 주간시간표.xlsx ──────────────────────────────
  const parseWeeklyScheduleBuffer = (arrayBuffer: ArrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];

    let headerRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const c0 = String(rows[i][0] || "").trim();
      if (c0 === "교사" || c0.includes("교사")) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error("주간시간표.xlsx 헤더 행('교사')을 찾을 수 없습니다.");
    }

    const dayRow = rows[headerRowIdx];
    const periodRow = rows[headerRowIdx + 1];

    const colMap: { colIndex: number; day: number; period: number }[] = [];
    let currentDayLabel = "";
    let dayIndex = 0;

    for (let col = 1; col < dayRow.length; col++) {
      const dayLabel = String(dayRow[col] || "").trim();
      if (dayLabel) {
        currentDayLabel = dayLabel;
        dayIndex++;
      }
      const periodNum = parseInt(String(periodRow[col] || "").trim(), 10);
      if (currentDayLabel && !isNaN(periodNum)) {
        colMap.push({ colIndex: col, day: dayIndex, period: periodNum });
      }
    }

    let occupiedCells = 0;
    let freeCells = 0;
    const duplicateWarnings: { name: string; seq: number; prevSeq: number }[] = [];
    const seenNames = new Map<string, number>();
    const teacherList: { seq: number; name: string; teacherRaw: string; lessons: any[] }[] = [];
    const tcMap = new Map<string, { teacherName: string; subjectName: string; targetHours: number }>();

    for (let i = headerRowIdx + 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const teacherRaw = String(row[0] || "").trim();
      if (!teacherRaw) continue;

      const match = teacherRaw.match(/^\((\d+)\)\s*(.+)$/);
      let seq = 0;
      let name = teacherRaw;

      if (match) {
        seq = parseInt(match[1], 10);
        name = match[2].trim();
      }

      if (seenNames.has(name)) {
        duplicateWarnings.push({ name, seq, prevSeq: seenNames.get(name)! });
      } else {
        seenNames.set(name, seq);
      }

      const lessons: any[] = [];

      colMap.forEach(({ colIndex, day, period }) => {
        const cellVal = String(row[colIndex] || "").trim();
        if (!cellVal) {
          freeCells++;
          return;
        }

        occupiedCells++;
        const parts = cellVal.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const classCode = parts[0] || "";
        const subjectName = parts[1] || parts[0] || "";

        let grade = 0;
        let classNum = 0;
        const codeMatch = classCode.match(/^(\d)(\d{2})$/);
        if (codeMatch) {
          grade = parseInt(codeMatch[1], 10);
          classNum = parseInt(codeMatch[2], 10);
        }

        lessons.push({ day, period, classCode, grade, classNum, subjectName });

        if (subjectName) {
          const tcKey = `${name}__${subjectName}`;
          const existing = tcMap.get(tcKey) || { teacherName: name, subjectName, targetHours: 0 };
          existing.targetHours += 1;
          tcMap.set(tcKey, existing);
        }
      });

      teacherList.push({ seq, name, teacherRaw, lessons });
    }

    const teacherTimeCounts = Array.from(tcMap.values()).sort((a, b) =>
      a.teacherName.localeCompare(b.teacherName, "ko")
    );

    return {
      teachers: teacherList,
      occupiedCells,
      freeCells,
      duplicateWarnings,
      teacherTimeCounts,
    };
  };

  // 요일 한글 표기 헬퍼 (1 -> "월", 2 -> "화", ...)
  const getDayName = (day: number): string => {
    const dayNames = ["", "월", "화", "수", "목", "금", "토", "일"];
    return dayNames[day] || `${day}`;
  };

  // 교차 검증 헬퍼 (순방향 + 역방향 누락 검증)
  const performCrossValidation = (
    grids: IntermediateClassGrid[],
    weeklyTeachers: { seq: number; name: string; teacherRaw: string; lessons: any[] }[],
    duplicateWarnings: any[],
    occupiedCells: number,
    freeCells: number
  ) => {
    let matchCount = 0;
    const mismatchList: string[] = [];
    const matchedFullKeys = new Set<string>();

    const fullMap = new Map<string, { subjectName: string; teacherName: string; grade: number; classNum: number; day: number; period: number }>();
    grids.forEach((g) => {
      g.cells.forEach((c) => {
        const key = `${g.grade}-${g.classNum}-${c.day}-${c.period}`;
        fullMap.set(key, { subjectName: c.subjectName, teacherName: c.teacherName, grade: g.grade, classNum: g.classNum, day: c.day, period: c.period });
      });
    });

    // 1. 순방향 검증 (주간시간표 -> 전체시간표)
    let weeklySkipped = 0; // 반 코드 해석 실패로 검증에서 빠진 주간 수업 — 조용히 버리면 검증이 통째로 무력화된다
    weeklyTeachers.forEach((t) => {
      t.lessons.forEach((l) => {
        if (!(l.grade && l.classNum)) weeklySkipped++;
        if (l.grade && l.classNum) {
          const key = `${l.grade}-${l.classNum}-${l.day}-${l.period}`;
          const fullCell = fullMap.get(key);
          const dayStr = getDayName(l.day);
          if (!fullCell) {
            mismatchList.push(`[${dayStr}요일 ${l.period}교시] 주간시간표(${t.name}) -> 전체시간표 해당 학급(${l.grade}-${l.classNum}반) 교시 없음`);
          } else {
            const fullTeacher = fullCell.teacherName.trim();
            const fullSubj = fullCell.subjectName.trim();
            // 소비된 셀은 일치 여부와 무관하게 기록 — 순방향 불일치가 역방향 누락으로 이중 보고되는 것 방지
            matchedFullKeys.add(key);
            // 교사·과목 모두 일치해야 match — 과목만 같은 교사 오배정을 잡는 것이 교차 검증의 목적
            if (fullTeacher === t.name && fullSubj === l.subjectName) {
              matchCount++;
            } else if (fullTeacher === t.name) {
              mismatchList.push(`[${dayStr}요일 ${l.period}교시 ${l.grade}-${l.classNum}반] 과목 불일치: 전체시간표(${fullSubj}) vs 주간시간표(${l.subjectName}) — 교사 ${t.name}`);
            } else {
              mismatchList.push(`[${dayStr}요일 ${l.period}교시 ${l.grade}-${l.classNum}반] 교사 불일치: 전체시간표(${fullSubj}/${fullTeacher}) vs 주간시간표(${l.subjectName}/${t.name})`);
            }
          }
        }
      });
    });

    // 2. 역방향 누락 검증 (전체시간표 -> 주간시간표) — 가상 교사 셀 제외
    let virtualExcluded = 0;
    fullMap.forEach((cell, key) => {
      const isVirtualTeacher =
        cell.teacherName === cell.subjectName ||
        cell.teacherName.includes("SLAT") ||
        cell.teacherName.includes("창체") ||
        cell.subjectName.includes("SLAT") ||
        cell.subjectName.includes("창체");

      if (isVirtualTeacher) virtualExcluded++;
      if (!isVirtualTeacher && !matchedFullKeys.has(key)) {
        const dayStr = getDayName(cell.day);
        mismatchList.push(
          `[${dayStr}요일 ${cell.period}교시 ${cell.grade}-${cell.classNum}반] 역방향 누락: 전체시간표 수업(${cell.subjectName}/${cell.teacherName})이 주간시간표에 존재하지 않음`
        );
      }
    });

    // ── fail-open 방지 가드 (2026-08-06): 비교가 성립하지 않은 검증을 "문제없음"으로 통과시키지 않는다.
    // (실사고: 줄바꿈 없는 파일 2종 → 전체는 전부 가상 교사로 오분류, 주간은 반 코드 해석 실패로 전량 제외
    //  → 일치 0·불일치 0의 초록 리포트가 떴다. 비교 0건은 성공이 아니라 형식 오류다.)
    if (weeklySkipped > 0)
      mismatchList.unshift(
        `[형식 경고] 주간시간표 수업 ${weeklySkipped}건의 반 코드를 해석하지 못해 검증에서 제외되었습니다 — 셀이 "반코드 줄바꿈 과목" 형식인지 확인하세요.`
      );
    if (occupiedCells > 0 && virtualExcluded > occupiedCells * 0.3)
      mismatchList.unshift(
        `[형식 경고] 전체시간표 ${virtualExcluded}건이 과목·교사 분리 실패(또는 가상 수업)로 검증에서 제외되었습니다 — 셀이 "과목 줄바꿈 교사" 형식인지 확인하세요.`
      );
    if (occupiedCells > 0 && matchCount === 0)
      mismatchList.unshift(
        `[검증 불성립] 일치한 수업 셀이 0개입니다 — 두 파일의 셀 형식이 맞지 않아 교차 검증이 전혀 수행되지 못했습니다. 이 상태의 "불일치 0건"은 정상이 아니므로 저장 전에 파일 형식을 확인하세요.`
      );

    const realTeacherCount = weeklyTeachers.filter((t) => !t.name.includes("SLAT") && !t.name.includes("창체")).length;
    const virtualTeacherCount = weeklyTeachers.length - realTeacherCount;

    setCrossValidation({
      matchCount,
      mismatchList,
      duplicateWarnings,
      occupiedCells,
      freeCells,
      realTeacherCount,
      virtualTeacherCount,
    });
  };

  // 파일 업로드 핸들러 (업로드 순서에 구애받지 않고 양방향 트리거)
  const handleFullFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(`파일이 너무 큽니다 (${(file.size / (1024 * 1024)).toFixed(1)}MB). 시간표 파일은 10MB 이하여야 합니다 — 다른 파일을 고르신 것은 아닌지 확인해 주세요.`);
      e.target.value = "";
      return;
    }

    setFullScheduleFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const { grids, totalOccupiedCells } = parseFullScheduleBuffer(buffer);
        setParsedGrids(grids);
        setFullScheduleSummary(`학급 ${grids.length}개, 수업 셀 ${totalOccupiedCells}개 분석 완료`);
        setSourceNote(`컴시간 엑셀 업로드 (${file.name})`);

        if (weeklyTeachersData) {
          performCrossValidation(
            grids,
            weeklyTeachersData.teachers,
            weeklyTeachersData.duplicateWarnings,
            weeklyTeachersData.occupiedCells,
            weeklyTeachersData.freeCells
          );
        }
      } catch (err: any) {
        alert(`전체시간표.xlsx 분석 실패: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleWeeklyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(`파일이 너무 큽니다 (${(file.size / (1024 * 1024)).toFixed(1)}MB). 시간표 파일은 10MB 이하여야 합니다 — 다른 파일을 고르신 것은 아닌지 확인해 주세요.`);
      e.target.value = "";
      return;
    }

    setWeeklyScheduleFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const { teachers, occupiedCells, freeCells, duplicateWarnings, teacherTimeCounts } =
          parseWeeklyScheduleBuffer(buffer);

        const weeklyInfo = { teachers, duplicateWarnings, occupiedCells, freeCells };
        setWeeklyTeachersData(weeklyInfo);
        setWeeklyScheduleSummary(`교사 ${teachers.length}명, 수업 셀 ${occupiedCells}개, 공강 ${freeCells}개`);
        setParsedTimeCounts(teacherTimeCounts);

        if (parsedGrids.length > 0) {
          performCrossValidation(parsedGrids, teachers, duplicateWarnings, occupiedCells, freeCells);
        }
      } catch (err: any) {
        alert(`주간시간표.xlsx 분석 실패: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 2. 전체시간표 붙여넣기 텍스트 분석 (폴백)
  const parseGridText = (text: string) => {
    if (!text.trim()) {
      setParsedGrids([]);
      return;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const gridMap = new Map<string, IntermediateClassGrid>();

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("\t").map((p) => p.trim());

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

  // 3. 교사별 시수표 붙여넣기 텍스트 분석 (폴백)
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

  // 학생 계정 판정 — 학번형 이메일 또는 학생 OU (2026-08-02 오매핑 사고 재발 방지)
  const isStudentAccount = (u: any): boolean =>
    /^\d+@/.test(u?.primaryEmail || "") ||
    String(u?.orgUnitPath || "").startsWith("/학생");

  // 자동 매칭 후보는 교직원 OU로 한정 — 학생·기기(전자칠판 등)·공용 계정의 이름 우연 일치 차단
  // (실사례: "창체" → 창체부전자칠판 eb-s-01@ /기기, "김동현" → 동명이인 학생 24029@ /학생)
  const isStaffAccount = (u: any): boolean =>
    String(u?.orgUnitPath || "").startsWith("/교직원");

  // 4. 교사 자동 매칭 실행 — 후보 풀 교직원 한정
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
    const staffPool = gwsTeachers.filter(isStaffAccount);

    for (const name of Array.from(teacherNames)) {
      if (newMap[name]) continue;

      const cleanName = name.trim();
      const matched = staffPool.find((u) => {
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

  // 가상 교사 지정/해제 토글
  const toggleVirtualTeacher = (tName: string) => {
    setVirtualTeacherNames((prev) => {
      if (prev.includes(tName)) return prev.filter((n) => n !== tName);
      // 가상 교사 지정 시 매핑된 계정·검색어를 함께 비운다 (서버는 동시 지정을 거부)
      setTeacherEmailMap((m) => ({ ...m, [tName]: "" }));
      setMappingQueries((q) => ({ ...q, [tName]: "" }));
      return [...prev, tName];
    });
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
      virtualTeacherNames,
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

    if (!confirm(`'${termName} (${termId})' 기초시간표를 초안 상태로 저장하시겠습니까?`)) {
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
      virtualTeacherNames,
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

  // 7. 신학기 초안 생성 및 학기 활성화 / 삭제
  const [newDraftTermId, setNewDraftTermId] = useState("");
  const [newDraftTermName, setNewDraftTermName] = useState("");
  const [creatingDraft, setCreatingDraft] = useState(false);

  const handleCreateDraftTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    const tId = newDraftTermId.trim();
    if (!tId) {
      alert("학기 ID(예: 2027-1)를 입력해주세요.");
      return;
    }
    if (!/^\d{4}-[12]$/.test(tId)) {
      alert("학기 ID 형식이 올바르지 않습니다. 'YYYY-1' 또는 'YYYY-2' 형식으로 입력해주세요 (예: 2027-1).");
      return;
    }
    setCreatingDraft(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "term_create_draft",
          newTermId: tId,
          newTermName: newDraftTermName.trim() || `${tId.split("-")[0]}학년도 ${tId.split("-")[1]}학기`,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`신학기 초안(${tId})이 생성되었습니다. 작업 대상 학기에서 선택하여 시간표 작성을 시작할 수 있습니다.`);
        setNewDraftTermId("");
        setNewDraftTermName("");
        onRefreshData();
      } else {
        alert(data.error || "초안 학기 생성에 실패했습니다.");
      }
    } catch (err: any) {
      alert(`오류: ${err.message || String(err)}`);
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleActivateTerm = async (id: string, name: string) => {
    const confirmMsg = `'${name} (${id})' 학기를 정식 운영 시간표로 전환하시겠습니까?\n\n[전환 전 확인 사항]\n1. 기초시간표 학급별 수업 시간 편성 완료 여부\n2. 시간표 검사기 필수 조건(교사 동시 배정 등) 충족 여부\n\n※ 전환 즉시 전교생 및 교직원에게 이 학기의 시간표가 정식 운영 시간표로 표출되며, 기존 학기는 보관 상태로 전환됩니다.`;
    if (!confirm(confirmMsg)) {
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
        alert("학기가 성공적으로 전환되었습니다.");
        onRefreshData();
      } else {
        alert(`전환 실패: ${data.error}`);
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
    if (!selectedManagerEmail) return;
    const currentList = settings?.managerEmails || [];
    const targetEmail = selectedManagerEmail.trim().toLowerCase();
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
        setNewManagerQuery("");
        setSelectedManagerEmail("");
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

  // 8-b. 열람 전용 참관자(observerEmails) 저장 (super_admin 전용, phase9b_spec §5)
  const handleAddObserver = async () => {
    if (!selectedObserverEmail) return;
    const currentList = settings?.observerEmails || [];
    const targetEmail = selectedObserverEmail.trim().toLowerCase();
    if (currentList.includes(targetEmail)) {
      alert("이미 참관자로 등록된 이메일입니다.");
      return;
    }
    // managerEmails와 중복 차단
    if ((settings?.managerEmails || []).includes(targetEmail)) {
      alert("이미 일과계 관리자로 등록된 이메일입니다. 관리자는 열람 권한을 이미 지닕니다.");
      return;
    }

    const updated = [...currentList, targetEmail];
    setSavingObservers(true);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_observers", observerEmails: updated }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClientCache("timetable:settings", {
          settings: data.settings,
          terms,
        });
        setNewObserverQuery("");
        setSelectedObserverEmail("");
        onRefreshData();
      } else {
        alert(`참관자 추가 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSavingObservers(false);
    }
  };

  const handleRemoveObserver = async (email: string) => {
    const updated = (settings?.observerEmails || []).filter((o) => o !== email);
    setSavingObservers(true);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_observers", observerEmails: updated }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClientCache("timetable:settings", {
          settings: data.settings,
          terms,
        });
        onRefreshData();
      } else {
        alert(`참관자 삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSavingObservers(false);
    }
  };

  const totalParsedLessons = parsedGrids.reduce((acc, g) => acc + g.cells.length, 0);

  return (
    <div className="space-y-6">
      {/* 제목 없음 — 바로 위 탭 버튼이 「학기 & 권한 관리」로 켜져 있다.
          짙은 배너였던 것은 이 화면이 「컴시간 가져오기」 4단계 마법사였던 시절(779dedc)의 잔재다.
          마법사가 꺼지고(SHOW_COMCIGAN_IMPORT) 탭 하나가 된 뒤로는 이 탭만 상위 화면처럼 보였다. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            일과계 전용 관리자
          </span>
          <HelpTip title="학기 관리 상세 안내" variant="light">
            <p>등록된 학기 목록을 확인하고, 초안 학기를 정식 시간표로 활성화하거나 삭제할 수 있습니다.</p>
            <p>시간표 담당 관리자와 열람 전용 참관자 지정도 이 화면에서 합니다.</p>
          </HelpTip>
        </div>
        <button
          onClick={() => setActiveStep(4)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all self-start md:self-auto"
        >
          📋 등록된 학기 목록 ({terms.length}개)
        </button>
      </div>

      {/* 워크플로우 4단계 스테퍼 (Stepper) — 컴시간 가져오기 숨김 시 스테퍼 전체 비노출 (4단계만 남아 무의미) */}
      {SHOW_COMCIGAN_IMPORT && (
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
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs">
              1
            </span>
            <span>데이터 분석</span>
          </button>

          <button
            onClick={() => {
              if (parsedGrids.length > 0) autoMatchTeachers();
              else alert("먼저 1단계에서 엑셀 파일이나 텍스트를 분석해 주세요.");
            }}
            className={`py-2.5 px-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
              activeStep === 2
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs">
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
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs">
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
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-xs">
              4
            </span>
            <span>학기 & 권한 관리</span>
          </button>
        </div>
      </div>
      )}

      {/* ── 1단계: 엑셀 분석 ──────────────────────────── */}
      {activeStep === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="border-b border-gray-100 pb-4 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span>Step 1. 학기 설정 및 컴시간 엑셀 분석</span>
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                컴시간에서 내보낸 엑셀(.xlsx) 파일 2종을 업로드하거나, 기존 TSV 텍스트 붙여넣기를 이용하세요.
              </p>
            </div>

            {/* 방식 선택 버튼 */}
            <div className="flex bg-gray-100 p-1 rounded-lg gap-1 border border-gray-200">
              <button
                type="button"
                onClick={() => setImportMode("excel")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  importMode === "excel"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                📁 엑셀 업로드 (.xlsx) — 추천
              </button>
              <button
                type="button"
                onClick={() => setImportMode("paste")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  importMode === "paste"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                📋 텍스트 붙여넣기 (엑셀 업로드가 안 될 때)
              </button>
            </div>
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

          {/* 엑셀 파일 업로드 모드 */}
          {importMode === "excel" ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Slot 1: 전체시간표.xlsx (필수) */}
                <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/20 rounded-xl p-5 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                      <span>1️⃣</span>
                      <span>전체시간표.xlsx</span>
                      <span className="bg-red-100 text-red-700 text-xs font-extrabold px-1.5 py-0.5 rounded">필수</span>
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    컴시간에서 내보낸 <code>전체시간표.xlsx</code> 파일 (학급별 전체시간표 그리드).
                  </p>

                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFullFileChange}
                    className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
                  />

                  {fullScheduleSummary && (
                    <div className="mt-3 bg-white p-2.5 rounded-lg border border-indigo-100 text-xs text-indigo-900 font-medium">
                      {fullScheduleSummary}
                    </div>
                  )}
                </div>

                {/* Slot 2: 주간시간표.xlsx (선택) */}
                <div className="border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50/40 rounded-xl p-5 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>2️⃣</span>
                      <span>주간시간표.xlsx</span>
                      <span className="bg-slate-200 text-slate-700 text-xs font-bold px-1.5 py-0.5 rounded">선택 (교차 검증)</span>
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    컴시간 <code>주간시간표.xlsx</code> 파일 (교사별 피벗표). 업로드 시 교사 시수표 자동 생성 및 교차 검증이 실행됩니다.
                  </p>

                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleWeeklyFileChange}
                    className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-800 cursor-pointer"
                  />

                  {weeklyScheduleSummary && (
                    <div className="mt-3 bg-white p-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 font-medium">
                      {weeklyScheduleSummary}
                    </div>
                  )}
                </div>
              </div>

              {/* 교차 검증 결과 배너 */}
              {crossValidation && (
                <div className="bg-indigo-900 text-white rounded-xl p-5 space-y-3 shadow-md">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold flex items-center gap-2">
                      <span>🔍</span>
                      <span>전체시간표 ↔ 주간시간표 교차 검증 리포트</span>
                    </h4>
                    <span className="text-xs bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 font-bold px-2.5 py-0.5 rounded-full">
                      검증 교시 셀 {crossValidation.occupiedCells}개
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-white/10 p-3 rounded-lg">
                    <div>
                      <span className="text-indigo-200 block text-[11px]">일치한 수업 셀</span>
                      <span className="text-lg font-bold text-emerald-300">{crossValidation.matchCount}개</span>
                    </div>
                    <div>
                      <span className="text-indigo-200 block text-[11px]">교사 수 (실제+가상)</span>
                      <span className="text-lg font-bold text-white">
                        {crossValidation.realTeacherCount}명 <span className="text-indigo-300 text-xs">(+가상 {crossValidation.virtualTeacherCount})</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-indigo-200 block text-[11px]">수업 셀 / 공강 셀</span>
                      <span className="text-lg font-bold text-white">
                        {crossValidation.occupiedCells} / {crossValidation.freeCells}
                      </span>
                    </div>
                    <div>
                      <span className="text-indigo-200 block text-[11px]">불일치 / 동명이인</span>
                      <span className="text-lg font-bold text-amber-300">
                        {crossValidation.mismatchList.length}건 / {crossValidation.duplicateWarnings.length}건
                      </span>
                    </div>
                  </div>

                  {crossValidation.mismatchList.length > 0 && (
                    <div className="bg-amber-950/80 border border-amber-500/50 p-3 rounded-lg text-xs space-y-1 max-h-32 overflow-y-auto">
                      <p className="font-bold text-amber-300">⚠️ 교차 검증 불일치 항목:</p>
                      {crossValidation.mismatchList.map((m, idx) => (
                        <p key={idx} className="text-amber-200/90 leading-tight">• {m}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* 붙여넣기 모드 (폴백) */
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
                  1️⃣ 전체시간표 복사-붙여넣기 ({parsedGrids.length}개 학급, {totalParsedLessons}개 수업 분석됨)
                </button>
                <button
                  onClick={() => setPasteTab("timeCount")}
                  className={`pb-2 text-xs font-bold border-b-2 transition-all ${
                    pasteTab === "timeCount"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  2️⃣ 교사별 시수표 복사-붙여넣기 ({parsedTimeCounts.length}건 분석됨)
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
          )}

          {/* 분석 미리보기 요약 */}
          {parsedGrids.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-xs text-emerald-900 flex justify-between items-center">
              <div>
                <span className="font-bold">✅ 분석 성공: </span>
                총 {parsedGrids.length}개 학급 ({totalParsedLessons}시간 수업 데이터) 분석 완료.
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
                      매핑할 교사 목록이 없습니다. 1단계 분석을 먼저 진행하세요.
                    </td>
                  </tr>
                ) : (
                  Object.entries(teacherEmailMap).map(([tName, email]) => {
                    const isVirtual = virtualTeacherNames.includes(tName);
                    const isMatched = Boolean(email);
                    return (
                      <tr key={tName} className={isVirtual ? "bg-indigo-50/40" : isMatched ? "bg-white" : "bg-amber-50/40"}>
                        <td className="px-4 py-3 font-bold text-gray-900">{tName}</td>
                        <td className="px-4 py-3">
                          {isVirtual ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-indigo-100 text-indigo-800">
                              가상 교사 (계정 없음)
                            </span>
                          ) : isMatched ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">
                              자동 매칭됨
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                              미매칭 (지정 필요)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!isVirtual && (
                              <AutocompleteInput
                                value={mappingQueries[tName] ?? email}
                                onChange={(val) => {
                                  // 검색어는 표시 전용 — 제출값은 onSelect에서만 (AGENTS.md §4)
                                  setMappingQueries((prev) => ({ ...prev, [tName]: val }));
                                  setTeacherEmailMap((prev) => ({ ...prev, [tName]: "" }));
                                }}
                                type="user"
                                domain={domain}
                                placeholder="교사 이메일 선택 또는 검색"
                                onSelect={(selectedEmail) => {
                                  const norm = (selectedEmail || "").toLowerCase();
                                  const account = gwsTeachers.find(
                                    (u) => (u.primaryEmail || "").toLowerCase() === norm
                                  );
                                  if (account && isStudentAccount(account)) {
                                    alert(
                                      `${norm} 은(는) 학생 계정입니다 (${account.orgUnitPath || "학번형 이메일"}).\n동명이인 학생 오매핑 방지를 위해 교직원 계정만 지정할 수 있습니다.`
                                    );
                                    setMappingQueries((prev) => ({ ...prev, [tName]: "" }));
                                    return;
                                  }
                                  setTeacherEmailMap((prev) => ({ ...prev, [tName]: norm }));
                                  setMappingQueries((prev) => ({ ...prev, [tName]: norm }));
                                }}
                              />
                            )}
                            <button
                              onClick={() => toggleVirtualTeacher(tName)}
                              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                isVirtual
                                  ? "bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                                  : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200"
                              }`}
                              title="SLAT·창체처럼 실제 인물이 아닌 컴시간 자리표시 이름은 계정 없이 저장합니다"
                            >
                              {isVirtual ? "가상 지정 해제" : "가상 교사로 지정"}
                            </button>
                          </div>
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
                통과하면 초안 학기로 저장됩니다.
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
                    : "저장 불가: 미매칭 교사 또는 의심 매핑(학생 계정 등)이 존재합니다."}
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
              <p className="text-2xl font-bold text-indigo-950 mt-1">
                {validationReport.summary?.totalClasses || 0}개
              </p>
            </div>
            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 text-center">
              <span className="text-xs text-emerald-600 font-semibold">총 수업 교시 수</span>
              <p className="text-2xl font-bold text-emerald-950 mt-1">
                {validationReport.summary?.totalLessons || 0}시간
              </p>
            </div>
            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 text-center">
              <span className="text-xs text-amber-600 font-semibold">교사 중복(오버랩)</span>
              <p className="text-2xl font-bold text-amber-950 mt-1">
                {validationReport.overlaps?.length || 0}건
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <span className="text-xs text-slate-600 font-semibold">미매칭 교사 수</span>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {validationReport.unmatchedTeachers?.length || 0}명
              </p>
            </div>
          </div>

          {/* 의심 매핑 상세 (저장 차단 사유) — 2026-08-02 학생 오매핑 재발 방지 */}
          {(validationReport.suspiciousMappings?.length || 0) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-red-800">
                🚫 의심 매핑 {validationReport.suspiciousMappings.length}건 — 해결 전에는 저장할 수 없습니다
              </h4>
              <ul className="text-xs text-red-900 space-y-1">
                {validationReport.suspiciousMappings.map((s, i) => (
                  <li key={i}>
                    <b>{s.teacherName}</b> → {s.email} : {s.reason}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-700">
                2단계로 돌아가 교직원 계정을 다시 지정하거나, 실제 인물이 아닌 이름(SLAT·창체 등)은 "가상 교사로 지정"을 사용하세요.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 4단계: 학기 관리 & 일과계 관리자 지정 ──────────────────── */}
      {activeStep === 4 && (
        <div className="space-y-6">
          {/* 신학기 초안 만들기 카드 (spec §1) */}
          <div className="bg-indigo-50/60 rounded-xl border border-indigo-100 p-6 space-y-3">
            <h3 className="text-base font-bold text-indigo-950 flex items-center gap-2">
              <span>✨</span>
              <span>신학기 초안 만들기</span>
            </h3>
            <p className="text-xs text-indigo-900/80">
              새 학기 시간표를 미리 준비하기 위한 빈 초안 학기를 생성합니다. 초안 작업 중에는 현재 운영 중인 시간표에 전혀 영향을 주지 않습니다.
            </p>
            <form onSubmit={handleCreateDraftTerm} className="flex flex-wrap items-end gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-indigo-950 mb-1">
                  학기 ID (필수)
                </label>
                <input
                  type="text"
                  placeholder="예: 2027-1"
                  value={newDraftTermId}
                  onChange={(e) => setNewDraftTermId(e.target.value)}
                  className="px-3 py-2 bg-white border border-indigo-200 rounded-lg text-xs font-mono font-bold text-gray-900 w-32 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[11px] font-bold text-indigo-950 mb-1">
                  학기 명칭 (선택)
                </label>
                <input
                  type="text"
                  placeholder="예: 2027학년도 1학기 (미입력 시 자동)"
                  value={newDraftTermName}
                  onChange={(e) => setNewDraftTermName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-lg text-xs font-medium text-gray-900 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={creatingDraft || !newDraftTermId.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-xs"
              >
                {creatingDraft ? "생성 중..." : "+ 신학기 초안 만들기"}
              </button>
            </form>
          </div>

          {/* 학기 목록 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">📋 시간표 학기 관리</h3>
            <p className="text-xs text-gray-500">
              초안 작성이 끝나면 정식 운영 학기로 전환하세요.
            </p>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 font-bold text-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left">학기 명칭 (ID)</th>
                    <th className="px-4 py-3 text-left">상태</th>
                    <th className="px-4 py-3 text-left">출처 노트</th>
                    <th className="px-4 py-3 text-right">작업</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {terms.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        등록된 학기가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    terms.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-3 font-bold text-gray-900">
                          {t.name} <span className="text-gray-400 font-normal">({t.id})</span>
                        </td>
                        <td className="px-4 py-3">
                          {t.status === "active" ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              🟢 현재 활성 학기
                            </span>
                          ) : t.status === "draft" ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              🟡 초안 (Draft)
                            </span>
                          ) : (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                              ⚪ 보관됨 (Archived)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{t.sourceNote || "-"}</td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {t.status === "draft" && (
                            <>
                              <button
                                onClick={() => handleActivateTerm(t.id, t.name)}
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-[11px] transition-all shadow-xs"
                              >
                                활성화
                              </button>
                              <button
                                onClick={() => handleDeleteTerm(t.id, t.name)}
                                className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded text-[11px] transition-all"
                              >
                                삭제
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 일과계 관리자 이메일 지정 (super_admin 전용) */}
          {isSuperAdmin && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span>🔑</span>
                <span>시간표 일과계 관리자 지정</span>
              </h3>

              <div className="flex gap-2 max-w-md">
                <AutocompleteInput
                  value={newManagerQuery}
                  onChange={(val) => {
                    setNewManagerQuery(val);
                    setSelectedManagerEmail("");
                  }}
                  type="user"
                  domain={domain}
                  placeholder="추가할 일과계 교직원 이메일 검색"
                  onSelect={(email, name) => {
                    setSelectedManagerEmail(email);
                    setNewManagerQuery(`${name || ""} (${email})`);
                  }}
                />
                <button
                  onClick={handleAddManager}
                  disabled={savingManagers || !selectedManagerEmail}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shrink-0 shadow-xs"
                >
                  {savingManagers ? "저장 중..." : "관리자 추가"}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {(settings?.managerEmails || []).length === 0 ? (
                  <p className="text-xs text-gray-400">지정된 일과계 관리자가 없습니다. (super_admin만 관리 중)</p>
                ) : (
                  settings?.managerEmails?.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs font-bold"
                    >
                      <span>{m}</span>
                      <button
                        onClick={() => handleRemoveManager(m)}
                        className="text-indigo-400 hover:text-indigo-600 font-bold ml-1 text-sm leading-none"
                        title="삭제"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 열람 전용 참관자 지정 (super_admin 전용, phase9b_spec §5) */}
          {isSuperAdmin && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span>👁️</span>
                <span>열람 전용 참관자 지정</span>
              </h3>
              <p className="text-xs text-gray-500">
                수업교환 신청 요청대장과 변경 내역을 <strong>읽기 전용</strong>으로 열람할 교직원을 등록합니다.
                승인·반려 버튼은 디스플레이되지 않으며 서버도 거부합니다. (DM 발송 없음)
              </p>

              <div className="flex gap-2 max-w-md">
                <AutocompleteInput
                  value={newObserverQuery}
                  onChange={(val) => {
                    setNewObserverQuery(val);
                    setSelectedObserverEmail("");
                  }}
                  type="user"
                  domain={domain}
                  placeholder="추가할 참관자 이메일 검색 (교무부장 등)"
                  onSelect={(email, name) => {
                    setSelectedObserverEmail(email);
                    setNewObserverQuery(`${name || ""} (${email})`);
                  }}
                />
                <button
                  onClick={handleAddObserver}
                  disabled={savingObservers || !selectedObserverEmail}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shrink-0 shadow-xs"
                >
                  {savingObservers ? "저장 중..." : "참관자 추가"}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {(settings?.observerEmails || []).length === 0 ? (
                  <p className="text-xs text-gray-400">등록된 열람 전용 참관자가 없습니다.</p>
                ) : (
                  settings?.observerEmails?.map((o) => (
                    <span
                      key={o}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-bold"
                    >
                      <span>{o}</span>
                      <button
                        onClick={() => handleRemoveObserver(o)}
                        className="text-amber-400 hover:text-amber-600 font-bold ml-1 text-sm leading-none"
                        title="삭제"
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
