/**
 * Phase 9a: 시간표 백엔드 서비스 & Firestore DB 로더 (admin SDK 전용)
 * 
 * 상위 스펙: phase9a_spec.md §2, §3, §4
 */

import { adminDb, DecodedAuthAccess } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  ClassCellIssue,
  ClassGrid,
  FreeTeacher,
  IntermediateClassGrid,
  IntermediateImportPayload,
  SwapDraft,
  SuspiciousMappingIssue,
  TeacherOverlapIssue,
  TeacherTimeCount,
  TeacherTimetable,
  TeacherTimetableCell,
  TimeCountMismatchIssue,
  TimetableLesson,
  TimetableSettings,
  TimetableSubject,
  TimetableTeacher,
  TimetableTerm,
  TimetableValidationReport,
  UnmatchedTeacherIssue,
} from "./types";

// ── Firestore 경로 헬퍼 ────────────────────────────────────────

export const swapDraftsColRef = (domain: string) =>
  adminDb.collection("swap_drafts").doc(domain).collection("drafts");

export const timetableSettingsDocRef = (domain: string) =>
  adminDb.collection("timetable_settings").doc(domain);

export const timetableTermsColRef = (domain: string) =>
  adminDb.collection("timetable_terms").doc(domain).collection("terms");

export const classGridsColRef = (domain: string, termId: string) =>
  adminDb
    .collection("timetable_terms")
    .doc(domain)
    .collection("terms")
    .doc(termId)
    .collection("classGrids");

// ── 직렬화 헬퍼 ────────────────────────────────────────────────

export function toMillis(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof (v as any)?.toMillis === "function") return (v as any).toMillis();
  return null;
}

// ── 설정 (Settings) CRUD ────────────────────────────────────────

export async function loadTimetableSettings(domain: string): Promise<TimetableSettings> {
  const snap = await timetableSettingsDocRef(domain).get();
  if (!snap.exists) {
    return {
      managerEmails: [],
      activeTermId: null,
      days: 5,
      periodsPerDay: 7,
      lunchAfterPeriod: 4,
      observerEmails: [],
      teacherOpen: false,
      teacherPilotEmails: [],
    };
  }
  const data = snap.data() || {};
  return {
    managerEmails: Array.isArray(data.managerEmails)
      ? data.managerEmails.map((e) => String(e).trim().toLowerCase())
      : [],
    activeTermId: data.activeTermId || null,
    days: Number(data.days) || 5,
    periodsPerDay: Number(data.periodsPerDay) || 7,
    lunchAfterPeriod: Number(data.lunchAfterPeriod) || 4,
    observerEmails: Array.isArray(data.observerEmails)
      ? data.observerEmails.map((e) => String(e).trim().toLowerCase())
      : [],
    teacherOpen: !!data.teacherOpen,
    teacherPilotEmails: Array.isArray(data.teacherPilotEmails)
      ? data.teacherPilotEmails.map((e) => String(e).trim().toLowerCase())
      : [],
  };
}

export async function saveTimetableSettings(
  domain: string,
  settings: Partial<TimetableSettings>
): Promise<TimetableSettings> {
  const current = await loadTimetableSettings(domain);
  const updated: TimetableSettings = {
    ...current,
    ...settings,
    managerEmails: Array.isArray(settings.managerEmails)
      ? settings.managerEmails.map((e) => String(e).trim().toLowerCase())
      : current.managerEmails,
  };
  await timetableSettingsDocRef(domain).set(updated, { merge: true });
  return updated;
}

// ── 학기 (Term) CRUD & 생명주기 ─────────────────────────────────

export async function loadTimetableTerm(
  domain: string,
  termId: string
): Promise<TimetableTerm | null> {
  const snap = await timetableTermsColRef(domain).doc(termId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    name: data.name || snap.id,
    status: data.status || "draft",
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    importedAt: toMillis(data.importedAt) || 0,
    importedBy: data.importedBy || "",
    activatedAt: toMillis(data.activatedAt),
    sourceNote: data.sourceNote || "",
  };
}

export async function loadAllTerms(domain: string): Promise<TimetableTerm[]> {
  const snap = await timetableTermsColRef(domain).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      name: data.name || doc.id,
      status: data.status || "draft",
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
      importedAt: toMillis(data.importedAt) || 0,
      importedBy: data.importedBy || "",
      activatedAt: toMillis(data.activatedAt),
      sourceNote: data.sourceNote || "",
    };
  });
}

export async function loadActiveTerm(domain: string): Promise<TimetableTerm | null> {
  const settings = await loadTimetableSettings(domain);
  if (settings.activeTermId) {
    const term = await loadTimetableTerm(domain, settings.activeTermId);
    if (term) return term;
  }
  // fallback: status === "active" 문서를 무작위 검색
  const snap = await timetableTermsColRef(domain).where("status", "==", "active").limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() || {};
  return {
    id: doc.id,
    name: data.name || doc.id,
    status: "active",
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    importedAt: toMillis(data.importedAt) || 0,
    importedBy: data.importedBy || "",
    activatedAt: toMillis(data.activatedAt),
    sourceNote: data.sourceNote || "",
  };
}

// ── 학급 시간표 그리드 (ClassGrid) Operations ─────────────────

export async function loadAllClassGrids(domain: string, termId: string): Promise<ClassGrid[]> {
  const snap = await classGridsColRef(domain, termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      grade: Number(data.grade) || 0,
      classNum: Number(data.classNum) || 0,
      cells: Array.isArray(data.cells) ? data.cells : [],
    };
  });
}

export async function loadClassGrid(
  domain: string,
  termId: string,
  grade: number,
  classNum: number
): Promise<ClassGrid | null> {
  const docId = `${grade}-${classNum}`;
  const snap = await classGridsColRef(domain, termId).doc(docId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    grade: Number(data.grade) || grade,
    classNum: Number(data.classNum) || classNum,
    cells: Array.isArray(data.cells) ? data.cells : [],
  };
}

export async function saveAllClassGrids(
  domain: string,
  termId: string,
  grids: ClassGrid[]
): Promise<void> {
  const colRef = classGridsColRef(domain, termId);
  // Firestore batch Write limit (500) 이하인 400개 단위로 저장
  for (let i = 0; i < grids.length; i += 400) {
    const batch = adminDb.batch();
    for (const grid of grids.slice(i, i + 400)) {
      const docId = `${grid.grade}-${grid.classNum}`;
      batch.set(colRef.doc(docId), grid);
    }
    await batch.commit();
  }
}

// ── 가져오기 중간 형식 -> ClassGrid & TimetableSubject 변환 ────

export function convertIntermediateToClassGrids(payload: IntermediateImportPayload): {
  classGrids: ClassGrid[];
  subjects: TimetableSubject[];
  maxPeriodsPerDay: number;
} {
  const teacherEmailMap = payload.teacherEmailMap || {};
  const virtualNames = new Set(
    (payload.virtualTeacherNames || []).map((n) => n.trim()).filter(Boolean)
  );
  const gridMap = new Map<string, ClassGrid>(); // "grade-classNum" -> ClassGrid
  const subjectMap = new Map<string, { shortName: string; teacherEmails: Set<string> }>();
  let maxPeriodsPerDay = 7;

  for (const rawGrid of payload.rawClassGrids || []) {
    const key = `${rawGrid.grade}-${rawGrid.classNum}`;
    const cellMap = new Map<string, TimetableLesson[]>(); // "day-period" -> TimetableLesson[]

    for (const rawCell of rawGrid.cells || []) {
      if (rawCell.period > maxPeriodsPerDay) {
        maxPeriodsPerDay = rawCell.period;
      }
      const cellKey = `${rawCell.day}-${rawCell.period}`;
      // 가상 교사(SLAT·창체 등)는 계정이 실수로 매핑돼 있어도 이메일 없이 저장 —
      // 엔진의 가상 교사 판정(이메일 없음 = 하드 제외)과 정합 유지
      const teacherEmail = virtualNames.has(rawCell.teacherName?.trim())
        ? ""
        : (teacherEmailMap[rawCell.teacherName] || "").trim().toLowerCase();
      const teacherObj: TimetableTeacher = {
        email: teacherEmail,
        name: rawCell.teacherName,
      };

      const subjName = rawCell.subjectName.trim();
      const subjShort = rawCell.subjectShort?.trim() || subjName.slice(0, 2);

      // 과목 매핑 집계
      if (!subjectMap.has(subjName)) {
        subjectMap.set(subjName, { shortName: subjShort, teacherEmails: new Set() });
      }
      if (teacherEmail) {
        subjectMap.get(subjName)!.teacherEmails.add(teacherEmail);
      }

      const existingLessons = cellMap.get(cellKey) || [];
      // 동일 요일·교시에 같은 과목명/coTeachingKey인 레슨이 있으면 교사만 추가
      const existingLesson = existingLessons.find(
        (l) => l.subjectName === subjName && (rawCell.room ? l.room === rawCell.room : true)
      );

      if (existingLesson) {
        if (!existingLesson.teachers.some((t) => t.name === rawCell.teacherName)) {
          existingLesson.teachers.push(teacherObj);
        }
      } else {
        existingLessons.push({
          subjectName: subjName,
          subjectShort: subjShort,
          teachers: [teacherObj],
          // Firestore는 undefined 값을 거부하므로 교실 정보가 있을 때만 속성을 포함
          ...(rawCell.room ? { room: rawCell.room } : {}),
        });
      }
      cellMap.set(cellKey, existingLessons);
    }

    const cells = Array.from(cellMap.entries()).map(([cKey, lessons]) => {
      const [dayStr, periodStr] = cKey.split("-");
      return {
        day: Number(dayStr),
        period: Number(periodStr),
        lessons,
      };
    });

    gridMap.set(key, {
      grade: rawGrid.grade,
      classNum: rawGrid.classNum,
      cells,
    });
  }

  const classGrids = Array.from(gridMap.values()).sort(
    (a, b) => a.grade - b.grade || a.classNum - b.classNum
  );

  const subjects: TimetableSubject[] = Array.from(subjectMap.entries()).map(([name, info]) => ({
    name,
    shortName: info.shortName,
    teacherEmails: Array.from(info.teacherEmails),
  }));

  return { classGrids, subjects, maxPeriodsPerDay };
}

// ── 가져오기 검증 파서 (import_validate) ───────────────────────

export function validateTimetableImport(
  payload: IntermediateImportPayload
): TimetableValidationReport {
  const teacherEmailMap = payload.teacherEmailMap || {};
  const virtualNames = new Set(
    (payload.virtualTeacherNames || []).map((n) => n.trim()).filter(Boolean)
  );
  const unmatchedTeachersSet = new Map<string, number>();

  // 1. 미매칭 교사 체크 — 가상 교사(SLAT·창체 등)로 지정된 이름은 계정 없이 허용
  for (const rawGrid of payload.rawClassGrids || []) {
    for (const cell of rawGrid.cells || []) {
      const tName = cell.teacherName?.trim();
      if (!tName) continue;
      if (virtualNames.has(tName)) continue;
      const email = teacherEmailMap[tName];
      if (!email) {
        unmatchedTeachersSet.set(tName, (unmatchedTeachersSet.get(tName) || 0) + 1);
      }
    }
  }

  // 1-b. 의심 매핑 체크 (저장 차단) — 2026-08-02 오매핑 사고 재발 방지 서버측 이중 방어
  //   학번형(^\d+@) 계정은 이 학교의 학생 계정 규칙: 동명이인 학생 오매핑의 실제 사고 패턴
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const suspiciousMappings: SuspiciousMappingIssue[] = [];
  for (const [teacherName, rawEmail] of Object.entries(teacherEmailMap)) {
    const email = (rawEmail || "").trim().toLowerCase();
    if (virtualNames.has(teacherName.trim())) {
      if (email)
        suspiciousMappings.push({
          teacherName,
          email,
          reason: "가상 교사로 지정됐는데 계정도 매핑됨 — 둘 중 하나만 선택",
        });
      continue;
    }
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      suspiciousMappings.push({ teacherName, email, reason: "이메일 형식이 아님 (검색어 원문 의심)" });
    } else if (/^\d+@/.test(email)) {
      suspiciousMappings.push({ teacherName, email, reason: "학번형 계정 — 동명이인 학생 오매핑 의심" });
    }
  }

  const unmatchedTeachers: UnmatchedTeacherIssue[] = Array.from(
    unmatchedTeachersSet.entries()
  ).map(([teacherName, occurrenceCount]) => ({ teacherName, occurrenceCount }));

  // 2. 교사 중복 수업 검사 (Teacher Overlap)
  // Key를 객체 배열로 관리하여 하이픈 포함 교사명 깨짐 방지
  interface SlotKey {
    teacherName: string;
    day: number;
    period: number;
  }
  interface SlotEntry {
    grade: number;
    classNum: number;
    subjectName: string;
    coTeachingKey?: string;
  }

  const teacherSlots: { key: SlotKey; entries: SlotEntry[] }[] = [];

  for (const rawGrid of payload.rawClassGrids || []) {
    for (const cell of rawGrid.cells || []) {
      const tName = cell.teacherName?.trim();
      if (!tName) continue;

      let slot = teacherSlots.find(
        (s) =>
          s.key.teacherName === tName &&
          s.key.day === cell.day &&
          s.key.period === cell.period
      );
      if (!slot) {
        slot = { key: { teacherName: tName, day: cell.day, period: cell.period }, entries: [] };
        teacherSlots.push(slot);
      }
      slot.entries.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        subjectName: cell.subjectName,
        coTeachingKey: cell.coTeachingKey?.trim(),
      });
    }
  }

  const overlaps: TeacherOverlapIssue[] = [];
  for (const slot of teacherSlots) {
    if (slot.entries.length > 1) {
      // 반(grade-classNum) 단위 고유 엔트리 추출
      const uniqueClasses = slot.entries.filter(
        (c, idx, self) =>
          self.findIndex((s) => s.grade === c.grade && s.classNum === c.classNum) === idx
      );

      if (uniqueClasses.length > 1) {
        // 🔴 수정 2: 모든 엔트리가 동일한 non-empty coTeachingKey를 갖고 있다면 의도된 이동/동시수업이므로 오버랩에서 제외
        const firstKey = uniqueClasses[0].coTeachingKey;
        const isCoTeachingGroup =
          Boolean(firstKey) && uniqueClasses.every((c) => c.coTeachingKey === firstKey);

        if (!isCoTeachingGroup) {
          overlaps.push({
            teacherName: slot.key.teacherName,
            teacherEmail: teacherEmailMap[slot.key.teacherName],
            day: slot.key.day,
            period: slot.key.period,
            classes: uniqueClasses.map((c) => ({
              grade: c.grade,
              classNum: c.classNum,
              subjectName: c.subjectName,
            })),
          });
        }
      }
    }
  }

  // 3. 학급 셀 검사 (Class Cell Issues)
  const cellIssues: ClassCellIssue[] = [];
  let maxPeriodsPerDay = 7;

  for (const rawGrid of payload.rawClassGrids || []) {
    const classLabel = `${rawGrid.grade}학년 ${rawGrid.classNum}반`;
    const totalCells = (rawGrid.cells || []).length;

    // 🔴 3-a. 학급별 수업 수가 없거나 10시간 미만인 경우 (누락 의심)
    if (totalCells === 0) {
      cellIssues.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        issue: `${classLabel}: 학급 시간표에 등록된 수업이 0개입니다. (누락 의심)`,
      });
    } else if (totalCells < 10) {
      cellIssues.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        issue: `${classLabel}: 주당 수업 수가 ${totalCells}시간으로 극단적으로 적습니다. (누락 의심)`,
      });
    }

    // 🔴 3-b. 동일 학급 같은 요일·교시에 동일 과목 / 교사 중복 등록 검사
    const cellOccurrences = new Map<
      string,
      { day: number; period: number; count: number; subjectName: string; teacherName: string }
    >();

    for (const cell of rawGrid.cells || []) {
      if (cell.period > maxPeriodsPerDay) maxPeriodsPerDay = cell.period;

      const cKey = `${cell.day}-${cell.period}-${cell.subjectName.trim()}-${cell.teacherName.trim()}`;
      const existing = cellOccurrences.get(cKey);
      if (existing) {
        existing.count++;
      } else {
        cellOccurrences.set(cKey, {
          day: cell.day,
          period: cell.period,
          count: 1,
          subjectName: cell.subjectName.trim(),
          teacherName: cell.teacherName.trim(),
        });
      }
    }

    for (const item of cellOccurrences.values()) {
      if (item.count > 1) {
        cellIssues.push({
          grade: rawGrid.grade,
          classNum: rawGrid.classNum,
          issue: `${classLabel}: ${item.day}요일 ${item.period}교시에 동일 과목(${item.subjectName}) / 교사(${item.teacherName}) 중복 데이터 ${item.count}건`,
        });
      }
    }
  }

  // 4. 시수 대조 (Time Count Mismatch)
  const timeMismatches: TimeCountMismatchIssue[] = [];
  if (Array.isArray(payload.teacherTimeCounts) && payload.teacherTimeCounts.length > 0) {
    // grid 계산 시수: key: "teacherName-subjectName" -> total hours
    const actualHoursMap = new Map<string, number>();
    for (const rawGrid of payload.rawClassGrids || []) {
      for (const cell of rawGrid.cells || []) {
        const tName = cell.teacherName?.trim();
        const sName = cell.subjectName?.trim();
        if (!tName || !sName) continue;
        const key = `${tName}-${sName}`;
        actualHoursMap.set(key, (actualHoursMap.get(key) || 0) + 1);
      }
    }

    for (const tc of payload.teacherTimeCounts) {
      const tName = tc.teacherName.trim();
      const sName = tc.subjectName.trim();
      const key = `${tName}-${sName}`;
      const actual = actualHoursMap.get(key) || 0;
      if (actual !== tc.targetHours) {
        timeMismatches.push({
          teacherName: tName,
          teacherEmail: teacherEmailMap[tName],
          subjectName: sName,
          gridHours: actual,
          targetHours: tc.targetHours,
        });
      }
    }
  }

  const totalClasses = (payload.rawClassGrids || []).length;
  const teacherNamesSet = new Set<string>();
  let totalLessons = 0;

  for (const grid of payload.rawClassGrids || []) {
    for (const cell of grid.cells || []) {
      totalLessons++;
      if (cell.teacherName) teacherNamesSet.add(cell.teacherName.trim());
    }
  }

  const canCommit = unmatchedTeachers.length === 0 && suspiciousMappings.length === 0;
  const isValid = canCommit && overlaps.length === 0 && cellIssues.length === 0;

  return {
    isValid,
    canCommit,
    overlaps,
    cellIssues,
    timeMismatches,
    unmatchedTeachers,
    suspiciousMappings,
    summary: {
      totalClasses,
      totalTeachers: teacherNamesSet.size,
      totalLessons,
      maxPeriodsPerDay,
    },
  };
}

// ── 학기 가져오기 커밋 (import_commit) ───────────────────────────

export async function commitTimetableImport(
  domain: string,
  payload: IntermediateImportPayload,
  userEmail: string
): Promise<TimetableTerm> {
  const termId = payload.termId.trim();
  const termName = payload.termName.trim() || termId;

  // 서버측 재검증 (2026-08-02 이중 방어): UI 우회 호출로 미매칭·의심 매핑이 저장되는 것 차단
  const report = validateTimetableImport(payload);
  if (!report.canCommit) {
    const reasons = [
      ...report.unmatchedTeachers.map((u) => `미매칭: ${u.teacherName}`),
      ...report.suspiciousMappings.map((s) => `${s.teacherName}(${s.email}): ${s.reason}`),
    ];
    throw new Error(`저장 조건 미충족 — ${reasons.slice(0, 5).join(" / ")}${reasons.length > 5 ? ` 외 ${reasons.length - 5}건` : ""}`);
  }

  // 🔴 수정 1: 기존 학기 존재 여부 및 status 검사
  const existingTerm = await loadTimetableTerm(domain, termId);
  if (existingTerm && existingTerm.status !== "draft") {
    throw new Error(
      `학기(${termId})는 이미 ${existingTerm.status === "active" ? "활성" : "보관"} 상태입니다. 활성/보관 학기는 덮어쓸 수 없으며, draft 상태이거나 신규 학기 ID만 저장 가능합니다.`
    );
  }

  // 기존 draft 학기를 재저장하는 경우 기존 classGrids 문서를 전체 삭제하여 유령 문서 방지
  if (existingTerm && existingTerm.status === "draft") {
    const oldGridsSnap = await classGridsColRef(domain, termId).get();
    for (let i = 0; i < oldGridsSnap.docs.length; i += 400) {
      const batch = adminDb.batch();
      for (const doc of oldGridsSnap.docs.slice(i, i + 400)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }

  const { classGrids, subjects, maxPeriodsPerDay } = convertIntermediateToClassGrids(payload);

  const termDoc: TimetableTerm = {
    id: termId,
    name: termName,
    status: "draft",
    subjects,
    importedAt: Date.now(),
    importedBy: userEmail.toLowerCase(),
    sourceNote: payload.sourceNote || "웹 시트 엑셀 붙여넣기 파싱",
  };

  // 1. Term 문서 저장 (draft 상태)
  await timetableTermsColRef(domain).doc(termId).set(termDoc);

  // 2. ClassGrid 문서들 저장
  await saveAllClassGrids(domain, termId, classGrids);

  // 3. 학교 설정 내 periodsPerDay 갱신
  await saveTimetableSettings(domain, { periodsPerDay: maxPeriodsPerDay });

  return termDoc;
}

// ── 학기 활성화 / 삭제 ─────────────────────────────────────────

export async function activateTerm(domain: string, termId: string): Promise<TimetableTerm> {
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error(`학기(${termId})를 찾을 수 없습니다.`);

  // 기존 active 학기들을 archived로 전환
  const activeSnap = await timetableTermsColRef(domain).where("status", "==", "active").get();
  const batch = adminDb.batch();
  for (const doc of activeSnap.docs) {
    if (doc.id !== termId) {
      batch.update(doc.ref, { status: "archived" });
    }
  }

  // 대상 학기를 active로 전환
  batch.update(timetableTermsColRef(domain).doc(termId), {
    status: "active",
    activatedAt: Date.now(),
  });
  await batch.commit();

  // 설정 문서 activeTermId 갱신
  await saveTimetableSettings(domain, { activeTermId: termId });

  term.status = "active";
  term.activatedAt = Date.now();
  return term;
}

export async function deleteTerm(domain: string, termId: string): Promise<void> {
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error(`학기(${termId})를 찾을 수 없습니다.`);
  if (term.status === "active") {
    throw new Error("현재 활성화된 학기는 삭제할 수 없습니다. 다른 학기를 먼저 활성화하세요.");
  }

  // 1. 하위 classGrids 컬렉션 삭제
  const gridsSnap = await classGridsColRef(domain, termId).get();
  for (let i = 0; i < gridsSnap.docs.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of gridsSnap.docs.slice(i, i + 400)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  // 2. Term 문서 삭제
  await timetableTermsColRef(domain).doc(termId).delete();
}

// ── View 데이터 합성 유틸리티 ──────────────────────────────────

export function synthesizeTeacherTimetable(
  allGrids: ClassGrid[],
  teacherEmail: string
): TeacherTimetableCell[] {
  const normEmail = teacherEmail.trim().toLowerCase();
  const cells: TeacherTimetableCell[] = [];

  for (const grid of allGrids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const matches = (lesson.teachers || []).some(
          (t) => t.email.trim().toLowerCase() === normEmail
        );
        if (matches) {
          cells.push({
            day: cell.day,
            period: cell.period,
            grade: grid.grade,
            classNum: grid.classNum,
            subjectName: lesson.subjectName,
            subjectShort: lesson.subjectShort,
            room: lesson.room,
            // 주간 합성본이 입력이면 변경 마킹을 그대로 전달 (phase9b_spec §3)
            ...((lesson as any).changed ? { changed: (lesson as any).changed } : {}),
          });
        }
      }
    }
  }

  cells.sort(
    (a, b) => a.day - b.day || a.period - b.period || a.grade - b.grade || a.classNum - b.classNum
  );
  return cells;
}

export function synthesizeFreeTeachers(
  allGrids: ClassGrid[],
  allTeachers: TimetableTeacher[],
  day: number,
  period: number
): FreeTeacher[] {
  const busyTeacherEmails = new Set<string>();

  for (const grid of allGrids) {
    for (const cell of grid.cells || []) {
      if (cell.day === day && cell.period === period) {
        for (const lesson of cell.lessons || []) {
          for (const teacher of lesson.teachers || []) {
            if (teacher.email) {
              busyTeacherEmails.add(teacher.email.trim().toLowerCase());
            }
          }
        }
      }
    }
  }

  const freeList: FreeTeacher[] = [];
  const addedEmails = new Set<string>();

  for (const teacher of allTeachers) {
    const email = teacher.email.trim().toLowerCase();
    if (!email || busyTeacherEmails.has(email) || addedEmails.has(email)) continue;
    addedEmails.add(email);
    freeList.push({
      email,
      name: teacher.name,
    });
  }

  freeList.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return freeList;
}

// ── 학생 학적 반(grade, classNum) 판별 ─────────────────────────

export async function resolveStudentClass(
  auth: DecodedAuthAccess
): Promise<{ grade: number; classNum: number } | null> {
  const email = auth.email.trim().toLowerCase();

  // 1. Firestore users/{uid} 문서 조회
  if (auth.uid) {
    const userSnap = await adminDb.collection("users").doc(auth.uid).get();
    if (userSnap.exists) {
      const data = userSnap.data() || {};
      const grade = Number(data.grade);
      const classNum = Number(data.classNum);
      if (Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNum) && classNum >= 1) {
        return { grade, classNum };
      }
      // studentId (e.g. "10101") regex check
      if (typeof data.studentId === "string") {
        const m = data.studentId.trim().match(/^(\d)(\d{2})(\d{2})$/);
        if (m) {
          return { grade: parseInt(m[1], 10), classNum: parseInt(m[2], 10) };
        }
      }
    }
  }

  // 2. 이메일 아이디 패턴 (e.g. 10101@hmh.or.kr)
  const localPart = email.split("@")[0];
  const m = localPart.match(/^(\d)(\d{2})(\d{2})$/);
  if (m) {
    return { grade: parseInt(m[1], 10), classNum: parseInt(m[2], 10) };
  }

  return null;
}

// ═════════════════════════════════════════════════════════════
// Phase 9b: 주 등록 · 변경 로그 · 수업교환 신청 · 승인 트랜잭션
// 상위 스펙: phase9b_spec.md §2, §5, §6
// ═════════════════════════════════════════════════════════════

import { sendGoogleChat } from "@/lib/google/workspace";
import {
  accumulateWeeklyHours,
  countSubstituteTotals,
  flattenNeisChanges,
  isSlotWithinWeek,
  synthesizeWeeklyGrids,
} from "./weekly";
import {
  findCrossSwapCandidates,
  findSubstituteCandidates,
  findSwapCandidates,
  resolveSourceLesson,
} from "./swap";
import {
  CrossSwapLessonRef,
  HourTotalsResult,
  NeisRow,
  ProjectedDayLoad,
  SubstituteCandidate,
  SwapCandidate,
  SwapCandidateSnapshot,
  SwapRequest,
  SwapRequestReason,
  SwapRequestType,
  SwapSourceSlot,
  SWAP_REASON_TYPES,
  TimetableChange,
  TimetableWeek,
  WeekRegisterInput,
  WeeklyClassGrid,
  WeeklySynthesisResult,
} from "./types";

export const timetableWeeksColRef = (domain: string) =>
  adminDb.collection("timetable_weeks").doc(domain).collection("weeks");

export const timetableChangesColRef = (domain: string) =>
  adminDb.collection("timetable_changes").doc(domain).collection("changes");

export const swapRequestsColRef = (domain: string) =>
  adminDb.collection("swap_requests").doc(domain).collection("requests");

// ── 주 등록 (weeks CRUD) ──────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysISO(dateStr: string, add: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function normalizeWeekDays(input: WeekRegisterInput): TimetableWeek["days"] {
  const byDay = new Map<number, { holiday?: boolean; periodsByGrade?: Record<string, number> }>();
  for (const d of input.days || []) {
    const dayNum = Number(d.day);
    if (dayNum >= 1 && dayNum <= 5) byDay.set(dayNum, d);
  }
  const days: TimetableWeek["days"] = [];
  for (let day = 1; day <= 5; day++) {
    const src = byDay.get(day);
    days.push({
      day,
      date: addDaysISO(input.startDate, day - 1),
      holiday: !!src?.holiday,
      ...(src?.periodsByGrade && Object.keys(src.periodsByGrade).length > 0
        ? { periodsByGrade: src.periodsByGrade }
        : {}),
    });
  }
  return days;
}

export async function registerWeek(
  domain: string,
  input: WeekRegisterInput,
  userEmail: string
): Promise<TimetableWeek> {
  const startDate = (input.startDate || "").trim();
  if (!DATE_RE.test(startDate)) throw new Error("startDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (new Date(`${startDate}T00:00:00Z`).getUTCDay() !== 1)
    throw new Error("주 시작일은 월요일이어야 합니다.");
  const term = await loadTimetableTerm(domain, input.termId);
  if (!term) throw new Error(`학기(${input.termId})를 찾을 수 없습니다.`);
  if (term.status === "archived") throw new Error("보관된 학기에는 주를 등록할 수 없습니다.");

  const weekId = startDate;
  const existing = await timetableWeeksColRef(domain).doc(weekId).get();
  if (existing.exists) throw new Error(`이미 등록된 주(${weekId})입니다. week_update를 사용하세요.`);

  const week: TimetableWeek = {
    id: weekId,
    termId: input.termId,
    startDate,
    days: normalizeWeekDays(input),
    ...(input.note ? { note: input.note } : {}),
    createdBy: userEmail.toLowerCase(),
    createdAt: Date.now(),
  };
  await timetableWeeksColRef(domain).doc(weekId).set(week);
  return week;
}

export async function updateWeek(
  domain: string,
  weekId: string,
  input: Partial<WeekRegisterInput>,
  userEmail: string
): Promise<TimetableWeek> {
  const ref = timetableWeeksColRef(domain).doc(weekId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const current = snap.data() as TimetableWeek;

  const updated: TimetableWeek = {
    ...current,
    ...(input.days
      ? { days: normalizeWeekDays({ termId: current.termId, startDate: current.startDate, days: input.days }) }
      : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  // note가 빈 문자열이면 필드 제거 (Firestore undefined 금지 원칙과 동일 계열)
  if (!updated.note) delete (updated as any).note;
  await ref.set({ ...updated, updatedBy: userEmail.toLowerCase(), updatedAt: Date.now() });
  return updated;
}

export async function loadWeek(domain: string, weekId: string): Promise<TimetableWeek | null> {
  const snap = await timetableWeeksColRef(domain).doc(weekId).get();
  if (!snap.exists) return null;
  return snap.data() as TimetableWeek;
}

export async function listWeeks(domain: string, termId?: string): Promise<TimetableWeek[]> {
  let q: FirebaseFirestore.Query = timetableWeeksColRef(domain);
  if (termId) q = q.where("termId", "==", termId);
  const snap = await q.get();
  return snap.docs
    .map((d) => d.data() as TimetableWeek)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * 오늘이 속한 등록된 주 (view 라우트의 현재 주 폴백용).
 * 복합 인덱스를 피하려고 termId 등호 조회 후 메모리에서 판별한다 (학기당 주 ~25개).
 */
export async function findCurrentWeek(domain: string, termId: string): Promise<TimetableWeek | null> {
  const today = new Date().toISOString().slice(0, 10);
  const weeks = await listWeeks(domain, termId);
  return (
    weeks.find((w) => w.startDate <= today && addDaysISO(w.startDate, 6) >= today) || null
  );
}

// ── 변경 로그 로드 & 주간 합성 ────────────────────────────────

export async function loadWeekChanges(domain: string, weekId: string): Promise<TimetableChange[]> {
  const snap = await timetableChangesColRef(domain).where("weekId", "==", weekId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export async function loadTermChanges(domain: string, termId: string): Promise<TimetableChange[]> {
  const snap = await timetableChangesColRef(domain).where("termId", "==", termId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export async function synthesizeWeek(
  domain: string,
  week: TimetableWeek,
  extraChanges?: TimetableChange[]
): Promise<WeeklySynthesisResult> {
  const [baseGrids, changes, settings] = await Promise.all([
    loadAllClassGrids(domain, week.termId),
    loadWeekChanges(domain, week.id),
    loadTimetableSettings(domain),
  ]);
  // extraChanges(가상 what-if — §14-1)는 실 변경 뒤에 적용돼야 한다. 합성기가 appliedAt으로
  // 재정렬하므로, 호출부는 extraChanges의 appliedAt을 미래값으로 세팅해 전달한다.
  const all = extraChanges?.length ? [...changes, ...extraChanges] : changes;
  return synthesizeWeeklyGrids(baseGrids, week, all, settings);
}

/** 학기 과목·그리드에서 전체 교사 수집 (view 라우트 free 액션과 동일 규칙) */
export function collectTermTeachers(term: TimetableTerm, grids: WeeklyClassGrid[]): TimetableTeacher[] {
  const teacherMap = new Map<string, TimetableTeacher>();
  for (const subj of term.subjects || []) {
    for (const email of subj.teacherEmails || []) {
      const normEmail = email.trim().toLowerCase();
      if (normEmail && !teacherMap.has(normEmail)) {
        teacherMap.set(normEmail, { email: normEmail, name: normEmail.split("@")[0] });
      }
    }
  }
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        for (const teacher of lesson.teachers || []) {
          const normEmail = (teacher.email || "").trim().toLowerCase();
          if (normEmail) {
            teacherMap.set(normEmail, { email: normEmail, name: teacher.name || normEmail.split("@")[0] });
          }
        }
      }
    }
  }
  return Array.from(teacherMap.values());
}

// ── §14-1 가상 합성(what-if): PENDING 신청·초안 → 가상 change ──

/** 신청·초안 공통 최소 형태 — 가상 change 변환 입력 */
interface VirtualSwapItem {
  key: string; // 가상 change id 구성용 (req-{id} / draft-{id})
  termId: string;
  weekId: string;
  targetWeekId?: string;
  type: SwapRequestType;
  requesterEmail: string;
  requesterName: string;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
}

/**
 * 한 항목을 특정 주(weekId)에 적용될 가상 change로 변환 (phase9b_spec §14-1).
 *
 * 승인 트랜잭션(approveSwapRequest)이 생성하는 3형태(swap/cross_swap 쌍/substitute)와 같은
 * 문서 모양을 **스냅샷 값으로 근사**한다 — change 필드를 바꿀 때는 반드시 양쪽을 함께 고칠 것.
 * (승인 쪽은 재검증된 그리드에서 lesson 세부를 읽지만, 여기는 검증 없이 스냅샷만 쓰므로
 *  함수를 공유하지 않는다. 무효 항목은 합성기가 integrityWarnings로 건너뛴다(§3-4) —
 *  what-if 목적에는 그 방어 동작이 정확히 원하는 것이다.)
 *
 * appliedAt은 호출부가 미래값으로 지정한다 — 합성기의 appliedAt 재정렬에서 실 변경 뒤에
 * 적용되는 것을 보장하기 위함. 가상 문서는 절대 저장하지 않는다.
 */
function buildVirtualChanges(item: VirtualSwapItem, weekId: string, appliedAt: number): TimetableChange[] {
  const common = {
    termId: item.termId,
    appliedBy: "__virtual__",
    appliedAt,
  };
  const isCross = !!item.targetWeekId && item.targetWeekId !== item.weekId;

  if (!isCross) {
    if (item.weekId !== weekId) return [];
    if (item.type === "substitute") {
      return [{
        id: `virtual-${item.key}`, weekId, type: "substitute", ...common,
        substitute: {
          grade: item.source.grade, classNum: item.source.classNum,
          day: item.source.day, period: item.source.period,
          subjectName: item.source.subjectName,
          absentTeacherEmail: item.requesterEmail, absentTeacherName: item.requesterName,
          subTeacherEmail: item.candidate.counterpartEmail, subTeacherName: item.candidate.counterpartName,
        },
      }];
    }
    if (item.candidate.targetDay == null || item.candidate.targetPeriod == null) return [];
    return [{
      id: `virtual-${item.key}`, weekId, type: "swap", ...common,
      swap: {
        grade: item.source.grade, classNum: item.source.classNum,
        a: {
          day: item.source.day, period: item.source.period,
          subjectName: item.source.subjectName,
          teacherEmail: item.requesterEmail, teacherName: item.requesterName,
        },
        b: {
          day: item.candidate.targetDay, period: item.candidate.targetPeriod,
          subjectName: item.candidate.counterpartSubjectName || "",
          teacherEmail: item.candidate.counterpartEmail, teacherName: item.candidate.counterpartName,
        },
      },
    }];
  }

  // 교차 주: 이 주에 해당하는 쪽 문서만 (approve의 changeA/changeB와 동일 방향)
  if (item.candidate.targetDay == null || item.candidate.targetPeriod == null) return [];
  const myRef: CrossSwapLessonRef = {
    subjectName: item.source.subjectName,
    subjectShort: item.source.subjectName.slice(0, 2), // 근사 — 가상 문서는 표시용이 아님
    teacherEmail: item.requesterEmail,
    teacherName: item.requesterName,
  };
  const otherRef: CrossSwapLessonRef = {
    subjectName: item.candidate.counterpartSubjectName || "",
    subjectShort: (item.candidate.counterpartSubjectName || "").slice(0, 2),
    teacherEmail: item.candidate.counterpartEmail,
    teacherName: item.candidate.counterpartName,
  };
  if (weekId === item.weekId) {
    return [{
      id: `virtual-${item.key}-a`, weekId, type: "cross_swap", ...common,
      crossSwap: {
        exchangeId: `virtual-${item.key}`, otherWeekId: item.targetWeekId!,
        grade: item.source.grade, classNum: item.source.classNum,
        day: item.source.day, period: item.source.period,
        out: myRef, in: otherRef,
      },
    }];
  }
  if (weekId === item.targetWeekId) {
    return [{
      id: `virtual-${item.key}-b`, weekId, type: "cross_swap", ...common,
      crossSwap: {
        exchangeId: `virtual-${item.key}`, otherWeekId: item.weekId,
        grade: item.source.grade, classNum: item.source.classNum,
        day: item.candidate.targetDay, period: item.candidate.targetPeriod,
        out: otherRef, in: myRef,
      },
    }];
  }
  return [];
}

/**
 * 본인 PENDING 신청(+선택 시 초안)을 주별 가상 change 목록으로 로드 (§14-1).
 * excludeSource: 지금 후보를 조회하는 소스 셀과 같은 항목은 제외 — 자기 자신과의 충돌 방지.
 */
async function loadMyVirtualOverlay(
  domain: string,
  userEmail: string,
  weekIds: string[],
  opts: { includeMyPending?: boolean; includeDrafts?: boolean },
  excludeSource: { weekId: string; source: SwapSourceSlot } | null
): Promise<{ byWeek: Map<string, TimetableChange[]>; pendingCount: number; draftCount: number }> {
  const norm = userEmail.trim().toLowerCase();
  const items: VirtualSwapItem[] = [];
  let pendingCount = 0;
  let draftCount = 0;

  const isExcluded = (weekId: string, s: SwapSourceSlot) =>
    excludeSource !== null &&
    weekId === excludeSource.weekId &&
    s.grade === excludeSource.source.grade && s.classNum === excludeSource.source.classNum &&
    s.day === excludeSource.source.day && s.period === excludeSource.source.period;
  const touches = (weekId: string, targetWeekId?: string) =>
    weekIds.includes(weekId) || (targetWeekId ? weekIds.includes(targetWeekId) : false);

  if (opts.includeMyPending) {
    const snap = await swapRequestsColRef(domain)
      .where("requesterEmail", "==", norm)
      .where("status", "==", "PENDING")
      .get();
    for (const doc of snap.docs) {
      const r = doc.data() as SwapRequest;
      if (!touches(r.weekId, r.targetWeekId) || isExcluded(r.weekId, r.source)) continue;
      items.push({
        key: `req-${doc.id}`, termId: r.termId, weekId: r.weekId, targetWeekId: r.targetWeekId,
        type: r.type, requesterEmail: norm, requesterName: r.requesterName,
        source: r.source, candidate: r.candidate,
      });
      pendingCount++;
    }
  }

  if (opts.includeDrafts) {
    const drafts = await listSwapDrafts(domain, norm);
    for (const d of drafts) {
      if (!touches(d.sourceWeekId, d.targetWeekId) || isExcluded(d.sourceWeekId, d.source)) continue;
      // 이미 같은 소스 셀의 PENDING 신청이 겹쳐 있으면 초안은 건너뜀 (이중 적용 방지)
      if (items.some((it) => isSameSourceSlot(it, d.sourceWeekId, d.source))) continue;
      items.push({
        key: `draft-${d.id}`, termId: d.termId, weekId: d.sourceWeekId, targetWeekId: d.targetWeekId,
        type: "swap", requesterEmail: norm,
        requesterName: d.requesterName || norm.split("@")[0],
        source: d.source, candidate: d.candidate,
      });
      draftCount++;
    }
  }

  const byWeek = new Map<string, TimetableChange[]>();
  // 실 변경 뒤 + 항목 생성순 적용 보장: 미래 시각 + 순번
  const futureBase = Date.now() + 10_000_000;
  let seq = 0;
  for (const it of items) {
    for (const wid of weekIds) {
      const chs = buildVirtualChanges(it, wid, futureBase + seq);
      if (chs.length) {
        byWeek.set(wid, [...(byWeek.get(wid) || []), ...chs]);
        seq += chs.length;
      }
    }
  }
  return { byWeek, pendingCount, draftCount };
}

function isSameSourceSlot(it: VirtualSwapItem, weekId: string, s: SwapSourceSlot): boolean {
  return (
    it.weekId === weekId &&
    it.source.grade === s.grade && it.source.classNum === s.classNum &&
    it.source.day === s.day && it.source.period === s.period
  );
}

/** 가상 합성본에서 본인 요일별 시수 집계 (§14-1 projectedDayLoads) */
function countMyDayLoads(grids: WeeklyClassGrid[], email: string): ProjectedDayLoad[] {
  const counts = new Map<number, number>();
  for (const cell of synthesizeTeacherTimetable(grids, email)) {
    counts.set(cell.day, (counts.get(cell.day) || 0) + 1);
  }
  return [1, 2, 3, 4, 5].map((day) => ({ day, count: counts.get(day) || 0 }));
}

/**
 * §14-2 v2: 등록된 전 주의 "예상 내 시간표" — 알리미식 일렬 나열용.
 * PENDING 신청·초안(클릭 누적분)을 가상 적용한 각 주의 본인 셀·요일 시수를 한 번에 반환.
 * 셀 changed.changeId 접두어("virtual-req-"/"virtual-draft-")로 UI가 대기/초안 반영분을 구분한다.
 */
export async function computeMyProjectedWeeks(
  domain: string,
  userEmail: string,
  opts: { includeMyPending: boolean; includeDrafts: boolean }
): Promise<{
  termId: string | null;
  weeks: Array<{
    weekId: string;
    startDate: string;
    days: TimetableWeek["days"];
    cells: TeacherTimetableCell[];
    dayLoads: ProjectedDayLoad[];
  }>;
  assumedPendingCount: number;
  assumedDraftCount: number;
}> {
  const term = await loadActiveTerm(domain);
  if (!term) return { termId: null, weeks: [], assumedPendingCount: 0, assumedDraftCount: 0 };

  const weeks = await listWeeks(domain, term.id);
  weeks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const overlay = await loadMyVirtualOverlay(
    domain, userEmail, weeks.map((w) => w.id), opts, null
  );

  // 기초 그리드·설정은 주마다 같으므로 1회만 로드 (주당 changes만 개별 조회)
  const [baseGrids, settings] = await Promise.all([
    loadAllClassGrids(domain, term.id),
    loadTimetableSettings(domain),
  ]);

  // 주별 changes는 서로 독립이므로 병렬 조회 — 직렬 왕복 누적(주 수 × RTT) 방지
  const changesByWeek = new Map(
    await Promise.all(
      weeks.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const)
    )
  );

  const out: Array<{
    weekId: string; startDate: string; days: TimetableWeek["days"];
    cells: TeacherTimetableCell[]; dayLoads: ProjectedDayLoad[];
  }> = [];
  for (const week of weeks) {
    const changes = changesByWeek.get(week.id) || [];
    const virtual = overlay.byWeek.get(week.id) || [];
    const { grids } = synthesizeWeeklyGrids(baseGrids, week, [...changes, ...virtual], settings);
    out.push({
      weekId: week.id,
      startDate: week.startDate,
      days: week.days,
      cells: synthesizeTeacherTimetable(grids, userEmail),
      dayLoads: countMyDayLoads(grids, userEmail),
    });
  }
  return {
    termId: term.id,
    weeks: out,
    assumedPendingCount: overlay.pendingCount,
    assumedDraftCount: overlay.draftCount,
  };
}

/**
 * §14-2 v2.1: 소스 셀 1개에 대해 등록된 **전 주**의 맞교환 후보를 한 번에 계산.
 * 그리드 인라인 하이라이트용 — 같은 주는 same-week 엔진, 나머지 주는 cross 엔진.
 * 오버레이(PENDING·초안)는 전 주에 공통 적용(기본 켜짐 권장 — 클릭 누적 위에서 탐색).
 */
export async function computeCandidatesAllWeeks(
  domain: string,
  requesterEmail: string,
  sourceWeekId: string,
  source: SwapSourceSlot,
  whatIf?: { includeMyPending?: boolean; includeDrafts?: boolean }
): Promise<{
  sourceSubjectName: string;
  weeks: Array<{ weekId: string; startDate: string; swapCandidates: SwapCandidate[] }>;
  assumedPendingCount: number;
  assumedDraftCount: number;
  error?: string;
}> {
  const sourceWeek = await loadWeek(domain, sourceWeekId);
  if (!sourceWeek) throw new Error(`등록되지 않은 주(${sourceWeekId})입니다.`);
  const term = await loadTimetableTerm(domain, sourceWeek.termId);
  if (!term) throw new Error(`학기(${sourceWeek.termId})를 찾을 수 없습니다.`);

  const allWeeks = await listWeeks(domain, term.id);
  allWeeks.sort((a, b) => a.startDate.localeCompare(b.startDate));

  const wantWhatIf = !!(whatIf?.includeMyPending || whatIf?.includeDrafts);
  const overlay = wantWhatIf
    ? await loadMyVirtualOverlay(
        domain, requesterEmail, allWeeks.map((w) => w.id), whatIf!,
        { weekId: sourceWeekId, source }
      )
    : null;

  // 기초 그리드·설정 1회 로드, 주별 합성 (computeMyProjectedWeeks와 동일 패턴)
  const [baseGrids, settings] = await Promise.all([
    loadAllClassGrids(domain, term.id),
    loadTimetableSettings(domain),
  ]);
  // 주별 changes 병렬 조회 (computeMyProjectedWeeks와 동일 이유)
  const changesByWeek = new Map(
    await Promise.all(
      allWeeks.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const)
    )
  );
  const synthByWeek = new Map<string, WeeklyClassGrid[]>();
  for (const week of allWeeks) {
    const changes = changesByWeek.get(week.id) || [];
    const virtual = overlay?.byWeek.get(week.id) || [];
    const { grids } = synthesizeWeeklyGrids(baseGrids, week, [...changes, ...virtual], settings);
    synthByWeek.set(week.id, grids);
  }

  const srcGrids = synthByWeek.get(sourceWeekId)!;
  const src = resolveSourceLesson(srcGrids, requesterEmail, source);
  if (!src.ok) {
    return {
      sourceSubjectName: "", weeks: [], error: src.error,
      assumedPendingCount: overlay?.pendingCount || 0, assumedDraftCount: overlay?.draftCount || 0,
    };
  }
  const sourceSubjectName = src.lesson!.subjectName;
  const fullSource: SwapSourceSlot = { ...source, subjectName: sourceSubjectName };

  const weeks: Array<{ weekId: string; startDate: string; swapCandidates: SwapCandidate[] }> = [];
  for (const week of allWeeks) {
    if (week.id === sourceWeekId) {
      const res = findSwapCandidates(srcGrids, sourceWeek, settings, requesterEmail, fullSource);
      // 소스 레벨 오류는 위 resolveSourceLesson에서 이미 걸렀으므로 여기 error는 후보 0건으로 취급
      weeks.push({ weekId: week.id, startDate: week.startDate, swapCandidates: res.candidates || [] });
    } else {
      const res = findCrossSwapCandidates(
        srcGrids, sourceWeek, synthByWeek.get(week.id)!, week, settings, requesterEmail, fullSource
      );
      weeks.push({ weekId: week.id, startDate: week.startDate, swapCandidates: res.candidates || [] });
    }
  }

  return {
    sourceSubjectName,
    weeks,
    assumedPendingCount: overlay?.pendingCount || 0,
    assumedDraftCount: overlay?.draftCount || 0,
  };
}

// ── 후보 탐색 (라우트 → 엔진 연결) ────────────────────────────

export async function computeCandidates(
  domain: string,
  requesterEmail: string,
  weekId: string,
  source: SwapSourceSlot,
  targetWeekId?: string,
  whatIf?: { includeMyPending?: boolean; includeDrafts?: boolean }
): Promise<{
  swapCandidates: SwapCandidate[];
  substituteCandidates: SubstituteCandidate[];
  sourceSubjectName: string;
  targetWeekId?: string;
  error?: string;
  // §14-1 가상 합성 부가 정보 (whatIf 요청 시에만)
  assumedPendingCount?: number;
  assumedDraftCount?: number;
  projectedDayLoads?: ProjectedDayLoad[]; // 소스 주 — 현재 검토 후보 미포함 (±1은 UI 계산)
  projectedTargetDayLoads?: ProjectedDayLoad[]; // 교차 주일 때 대상 주
}> {
  const week = await loadWeek(domain, weekId);
  if (!week) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const term = await loadTimetableTerm(domain, week.termId);
  if (!term) throw new Error(`학기(${week.termId})를 찾을 수 없습니다.`);
  const settings = await loadTimetableSettings(domain);

  // §14-1: 본인 PENDING 신청(+선택 초안)을 가상 change로 겹쳐 누적 기준으로 계산
  const wantWhatIf = !!(whatIf?.includeMyPending || whatIf?.includeDrafts);
  const overlayWeekIds = [weekId, ...(targetWeekId && targetWeekId !== weekId ? [targetWeekId] : [])];
  const overlay = wantWhatIf
    ? await loadMyVirtualOverlay(domain, requesterEmail, overlayWeekIds, whatIf!, { weekId, source })
    : null;
  const whatIfExtras = overlay
    ? { assumedPendingCount: overlay.pendingCount, assumedDraftCount: overlay.draftCount }
    : {};

  const { grids } = await synthesizeWeek(domain, week, overlay?.byWeek.get(weekId));
  const src = resolveSourceLesson(grids, requesterEmail, source);
  if (!src.ok) {
    return { swapCandidates: [], substituteCandidates: [], sourceSubjectName: "", error: src.error };
  }
  const sourceSubjectName = src.lesson!.subjectName;
  const fullSource: SwapSourceSlot = { ...source, subjectName: sourceSubjectName };

  // 조건부 판별을 위해 base (가상 합성 없는 확정 시간표) 교환 후보 키 Set 추출 (overlay 항목이 1건 이상일 때만)
  let baseKeySet: Set<string> | null = null;
  const overlayCount = overlay ? (overlay.pendingCount + overlay.draftCount) : 0;
  if (overlayCount > 0) {
    // 기본값 빈 Set: base 계산이 실패하면(소스 수업 자체가 가상 이동분인 경우 등) 확정 시간표에는
    // 어떤 후보도 성립하지 않는 것이므로 전 후보를 조건부로 표시하는 것이 맞다
    baseKeySet = new Set();
    try {
      if (targetWeekId && targetWeekId !== weekId) {
        const targetWeekForBase = await loadWeek(domain, targetWeekId);
        if (targetWeekForBase && targetWeekForBase.termId === week.termId) {
          const { grids: baseGrids } = await synthesizeWeek(domain, week);
          const { grids: baseTargetGrids } = await synthesizeWeek(domain, targetWeekForBase);
          const baseCrossRes = findCrossSwapCandidates(
            baseGrids, week, baseTargetGrids, targetWeekForBase, settings, requesterEmail, fullSource
          );
          if (!baseCrossRes.error) {
            baseKeySet = new Set(
              baseCrossRes.candidates.map(
                (c) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`
              )
            );
          }
        }
      } else {
        const { grids: baseGrids } = await synthesizeWeek(domain, week);
        const baseSwapRes = findSwapCandidates(baseGrids, week, settings, requesterEmail, fullSource);
        if (!baseSwapRes.error) {
          baseKeySet = new Set(
            baseSwapRes.candidates.map(
              (c) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`
            )
          );
        }
      }
    } catch {
      // base 계산 실패 시 무시
    }
  }

  // ── 교차 주 맞교환 (§4-3b): 두 합성본 기준 별도 엔진. 특별보강은 교차 주 개념이 없음 ──
  if (targetWeekId && targetWeekId !== weekId) {
    const targetWeek = await loadWeek(domain, targetWeekId);
    if (!targetWeek) throw new Error(`등록되지 않은 주(${targetWeekId})입니다. 일과계가 먼저 주를 등록해야 교환할 수 있습니다.`);
    if (targetWeek.termId !== week.termId)
      throw new Error("다른 학기의 주와는 교환할 수 없습니다.");
    const { grids: targetGrids } = await synthesizeWeek(
      domain, targetWeek, overlay?.byWeek.get(targetWeekId)
    );
    const crossRes = findCrossSwapCandidates(
      grids, week, targetGrids, targetWeek, settings, requesterEmail, fullSource
    );
    if (crossRes.error) {
      return {
        swapCandidates: [], substituteCandidates: [], sourceSubjectName, targetWeekId,
        error: crossRes.error,
      };
    }

    let finalCandidates = crossRes.candidates;
    if (baseKeySet) {
      finalCandidates = finalCandidates.map((c) => {
        const key = `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`;
        if (!baseKeySet!.has(key)) {
          return { ...c, conditional: true };
        }
        return c;
      });
    }

    return {
      swapCandidates: finalCandidates,
      substituteCandidates: [],
      sourceSubjectName,
      targetWeekId,
      ...(overlay
        ? {
            ...whatIfExtras,
            projectedDayLoads: countMyDayLoads(grids, requesterEmail),
            projectedTargetDayLoads: countMyDayLoads(targetGrids, requesterEmail),
          }
        : {}),
    };
  }

  const swapRes = findSwapCandidates(grids, week, settings, requesterEmail, fullSource);
  // 소스 레벨 오류(블록 교사 등)는 두 후보 목록 모두에 대해 치명적 — 전파한다
  if (swapRes.error) {
    return { swapCandidates: [], substituteCandidates: [], sourceSubjectName, error: swapRes.error };
  }

  let finalCandidates = swapRes.candidates;
  if (baseKeySet) {
    finalCandidates = finalCandidates.map((c) => {
      const key = `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`;
      if (!baseKeySet!.has(key)) {
        return { ...c, conditional: true };
      }
      return c;
    });
  }

  const allTeachers = collectTermTeachers(term, grids);
  const termChanges = await loadTermChanges(domain, week.termId);
  const substituteTotals = countSubstituteTotals(termChanges);
  const subjectTeacherEmails = new Set(
    (term.subjects || [])
      .filter((s) => s.name === sourceSubjectName)
      .flatMap((s) => s.teacherEmails.map((e) => e.trim().toLowerCase()))
  );
  const subRes = findSubstituteCandidates(
    grids, week, settings, requesterEmail, fullSource,
    allTeachers, substituteTotals, subjectTeacherEmails
  );

  return {
    swapCandidates: finalCandidates,
    substituteCandidates: subRes.candidates,
    sourceSubjectName,
    ...(overlay
      ? { ...whatIfExtras, projectedDayLoads: countMyDayLoads(grids, requesterEmail) }
      : {}),
  };
}

// ── 신청 생성·조회·취소 (§5 서버 검증) ────────────────────────

function validateReason(reason: SwapRequestReason | undefined): SwapRequestReason {
  if (!reason || !SWAP_REASON_TYPES.includes(reason.type))
    throw new Error("신청 사유를 선택해야 합니다.");
  const note = (reason.note || "").trim();
  if (reason.type === "기타" && !note) throw new Error("기타 사유는 내용 입력이 필수입니다.");
  return { type: reason.type, ...(note ? { note } : {}) };
}

export async function createSwapRequest(
  domain: string,
  requesterEmail: string,
  params: {
    weekId: string;
    type: SwapRequestType;
    source: SwapSourceSlot;
    candidate: SwapCandidateSnapshot;
    reason?: SwapRequestReason;
    targetWeekId?: string; // 교차 주 맞교환 (§4-3b) — 없거나 weekId와 같으면 같은-주
  },
  options?: { skipManagerNotify?: boolean; direct?: boolean; batchId?: string }
): Promise<SwapRequest> {
  const reason = validateReason(params.reason);
  const week = await loadWeek(domain, params.weekId);
  if (!week) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);

  const targetWeekId =
    params.targetWeekId && params.targetWeekId !== params.weekId ? params.targetWeekId : undefined;
  if (targetWeekId && params.type !== "swap")
    throw new Error("교차 주 교환은 맞교환만 가능합니다.");

  // 서버 재계산 검증: 클라이언트가 보낸 후보는 신뢰하지 않는다 (AGENTS.md §5 이중 방어)
  const computed = await computeCandidates(
    domain, requesterEmail, params.weekId, params.source, targetWeekId
  );
  if (computed.error) throw new Error(computed.error);

  let candidate: SwapCandidateSnapshot;
  let requesterName = requesterEmail.split("@")[0];
  if (params.type === "swap") {
    const match = computed.swapCandidates.find(
      (c) =>
        c.targetDay === params.candidate.targetDay &&
        c.targetPeriod === params.candidate.targetPeriod &&
        c.counterpartEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
    );
    if (!match) {
      // 실패 시에만 whatIf: { includeMyPending: true, includeDrafts: false }로 한 번 더 계산해, 거기에 해당 후보가 존재하면 구분된 사유 던짐
      try {
        const whatIfComputed = await computeCandidates(
          domain,
          requesterEmail,
          params.weekId,
          params.source,
          targetWeekId,
          { includeMyPending: true, includeDrafts: false }
        );
        const conditionalMatch = whatIfComputed.swapCandidates.find(
          (c) =>
            c.targetDay === params.candidate.targetDay &&
            c.targetPeriod === params.candidate.targetPeriod &&
            c.counterpartEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
        );
        if (conditionalMatch) {
          throw new Error(
            "이 후보는 본인의 다른 대기 신청이 승인되어야 성립하는 조건부 후보입니다. 해당 신청이 승인된 뒤 다시 신청해 주세요."
          );
        }
      } catch (e: any) {
        if (e.message.includes("조건부 후보입니다")) throw e;
      }
      throw new Error("선택한 후보가 더 이상 유효하지 않습니다. 후보를 다시 조회해 주세요.");
    }
    candidate = { ...match, ...(targetWeekId ? { targetWeekId } : {}) }; // 서버 계산값 스냅샷 (점수·감점 포함)
  } else {
    const match = computed.substituteCandidates.find(
      (c) => c.teacherEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
    );
    if (!match) throw new Error("선택한 보강 교사가 더 이상 공강이 아닙니다. 후보를 다시 조회해 주세요.");
    candidate = {
      counterpartEmail: match.teacherEmail,
      counterpartName: match.teacherName,
      score: 0,
      penalties: [],
    };
  }

  // 신청자 실명: 합성본의 본인 lesson에서 추출
  const { grids } = await synthesizeWeek(domain, week);
  const src = resolveSourceLesson(grids, requesterEmail, params.source);
  if (src.ok && src.lesson) requesterName = src.lesson.teachers[0]?.name || requesterName;

  // 같은 소스 셀 중복 PENDING 차단
  const dupSnap = await swapRequestsColRef(domain)
    .where("weekId", "==", params.weekId)
    .where("requesterEmail", "==", requesterEmail.toLowerCase())
    .where("status", "==", "PENDING")
    .get();
  const dup = dupSnap.docs.some((d) => {
    const s = (d.data() as SwapRequest).source;
    return (
      s.grade === params.source.grade && s.classNum === params.source.classNum &&
      s.day === params.source.day && s.period === params.source.period
    );
  });
  if (dup) throw new Error("같은 수업에 대해 이미 대기 중인 신청이 있습니다.");

  const ref = swapRequestsColRef(domain).doc();
  const request: SwapRequest = {
    id: ref.id,
    termId: week.termId,
    weekId: params.weekId,
    type: params.type,
    ...(targetWeekId ? { targetWeekId } : {}),
    requesterEmail: requesterEmail.toLowerCase(),
    requesterName,
    source: { ...params.source, subjectName: computed.sourceSubjectName },
    candidate,
    reason,
    status: "PENDING",
    createdAt: Date.now(),
    ...(options?.direct ? { direct: true } : {}),
    ...(options?.batchId ? { batchId: options.batchId } : {}),
  };
  await ref.set(request);

  // 알림: 일과계에게 (실패해도 신청은 유효). 직권 흐름은 관리자 본인이 만들었으므로 생략
  if (options?.skipManagerNotify) return request;
  const settings = await loadTimetableSettings(domain);
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const summary =
    `📋 새 수업교환 신청\n` +
    `신청자: ${requesterName} (${requesterEmail})\n` +
    `대상: ${request.source.grade}-${request.source.classNum} ${dayNames[request.source.day]} ${request.source.period}교시 ${request.source.subjectName}\n` +
    `유형: ${params.type === "swap" ? `맞교환 (상대: ${candidate.counterpartName})` : `특별보강 (보강: ${candidate.counterpartName})`}${targetWeekId ? `\n교차 주 교환: ${targetWeekId} 주 ${dayNames[candidate.targetDay || 0]} ${candidate.targetPeriod}교시와 맞교환` : ""}\n` +
    `사유: ${reason.type}${reason.note ? ` — ${reason.note}` : ""}`;
  for (const manager of settings.managerEmails) {
    try {
      await sendGoogleChat(manager, summary);
    } catch (e: any) {
      console.error(`[swap_request] 일과계 알림 실패 (${manager}):`, e.message);
    }
  }

  return request;
}

/**
 * 장바구니 일괄 제출 요약 알림 (§14-2) — 항목별 개별 DM 대신 일과계에 1건만 보낸다.
 * (개별 create는 skipManagerNotify로 호출되므로 이 함수가 유일한 알림 경로)
 */
export async function notifySwapBatchToManagers(
  domain: string,
  requesterName: string,
  requesterEmail: string,
  createdCount: number,
  totalCount: number
): Promise<void> {
  const settings = await loadTimetableSettings(domain);
  const msg =
    `📋 수업교환 일괄 신청 접수\n` +
    `신청자: ${requesterName} (${requesterEmail})\n` +
    `접수: ${createdCount}건${createdCount < totalCount ? ` (제출 ${totalCount}건 중 ${totalCount - createdCount}건 재검증 탈락)` : ""}\n` +
    `요청대장에서 묶음으로 확인할 수 있습니다.`;
  for (const manager of settings.managerEmails) {
    try {
      await sendGoogleChat(manager, msg);
    } catch (e: any) {
      console.error(`[swap_batch] 일과계 알림 실패 (${manager}):`, e.message);
    }
  }
}

export async function listSwapRequests(
  domain: string,
  filter: { weekId?: string; status?: string; requesterEmail?: string }
): Promise<SwapRequest[]> {
  let q: FirebaseFirestore.Query = swapRequestsColRef(domain);
  if (filter.weekId) q = q.where("weekId", "==", filter.weekId);
  if (filter.status) q = q.where("status", "==", filter.status);
  if (filter.requesterEmail) q = q.where("requesterEmail", "==", filter.requesterEmail.toLowerCase());
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ ...(d.data() as SwapRequest), id: d.id }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 요청대장 사전 검증: PENDING 신청이 현재 확정 시간표 기준으로 여전히 성립하는지.
 * 승인 트랜잭션(approveSwapRequest)의 재검증과 같은 규칙을 목록 시점에 미리 돌려,
 * 먼저 승인된 다른 건 때문에 이미 불가능해진 신청을 일과계가 화면에서 바로 보게 한다.
 * (실제 차단은 여전히 승인 트랜잭션이 담당 — 여기는 표시용이라 트랜잭션 불필요)
 */
export async function validatePendingSwapRequests(
  domain: string,
  requests: SwapRequest[]
): Promise<Record<string, { ok: boolean; reason?: string }>> {
  const out: Record<string, { ok: boolean; reason?: string }> = {};
  const pendings = requests.filter((r) => r.status === "PENDING");
  if (pendings.length === 0) return out;

  const settings = await loadTimetableSettings(domain);
  const baseGridsByTerm = new Map<string, ClassGrid[]>();
  for (const termId of new Set(pendings.map((r) => r.termId))) {
    baseGridsByTerm.set(termId, await loadAllClassGrids(domain, termId));
  }

  // 관련 주 합성본은 주당 1회만 (병렬 로드)
  const weekIds = Array.from(new Set(pendings.flatMap((r) => [r.weekId, r.targetWeekId || r.weekId])));
  const weekObjs = new Map<string, TimetableWeek | null>();
  const gridsByWeek = new Map<string, WeeklyClassGrid[]>();
  await Promise.all(
    weekIds.map(async (wid) => {
      const [w, changes] = await Promise.all([loadWeek(domain, wid), loadWeekChanges(domain, wid)]);
      weekObjs.set(wid, w);
      const base = w ? baseGridsByTerm.get(w.termId) : null;
      if (w && base) gridsByWeek.set(wid, synthesizeWeeklyGrids(base, w, changes, settings).grids);
    })
  );

  for (const r of pendings) {
    try {
      const week = weekObjs.get(r.weekId);
      const grids = gridsByWeek.get(r.weekId);
      if (!week || !grids) {
        out[r.id] = { ok: false, reason: `주(${r.weekId}) 등록이 삭제되어 승인할 수 없습니다.` };
        continue;
      }
      const src = resolveSourceLesson(grids, r.requesterEmail, r.source);
      if (!src.ok) {
        out[r.id] = { ok: false, reason: src.error || "원래 수업이 다른 변경으로 이미 이동/변경되었습니다." };
        continue;
      }
      if (r.type === "substitute") {
        // 특별보강은 소스 수업 성립만 사전 확인 (보강 교사 가용성은 승인 트랜잭션에서 재검증)
        out[r.id] = { ok: true };
        continue;
      }
      const fullSource: SwapSourceSlot = { ...r.source, subjectName: src.lesson!.subjectName };
      const isCross = !!r.targetWeekId && r.targetWeekId !== r.weekId;
      let stillValid = false;
      let engineError: string | undefined;
      if (!isCross) {
        const res = findSwapCandidates(grids, week, settings, r.requesterEmail, fullSource);
        engineError = res.error;
        stillValid = !res.error && (res.candidates || []).some(
          (c) =>
            c.targetDay === r.candidate.targetDay &&
            c.targetPeriod === r.candidate.targetPeriod &&
            c.counterpartEmail === r.candidate.counterpartEmail
        );
      } else {
        const tWeek = weekObjs.get(r.targetWeekId!);
        const tGrids = gridsByWeek.get(r.targetWeekId!);
        if (!tWeek || !tGrids) {
          out[r.id] = { ok: false, reason: `대상 주(${r.targetWeekId}) 등록이 삭제되어 승인할 수 없습니다.` };
          continue;
        }
        const res = findCrossSwapCandidates(grids, week, tGrids, tWeek, settings, r.requesterEmail, fullSource);
        engineError = res.error;
        stillValid = !res.error && (res.candidates || []).some(
          (c) =>
            c.targetDay === r.candidate.targetDay &&
            c.targetPeriod === r.candidate.targetPeriod &&
            c.counterpartEmail === r.candidate.counterpartEmail
        );
      }
      out[r.id] = stillValid
        ? { ok: true }
        : { ok: false, reason: engineError || "먼저 승인된 다른 변경으로 이 교체안이 더 이상 성립하지 않습니다." };
    } catch (e: any) {
      out[r.id] = { ok: false, reason: e?.message || "사전 검증 중 오류가 발생했습니다." };
    }
  }
  return out;
}

export async function cancelSwapRequest(
  domain: string,
  requesterEmail: string,
  requestId: string
): Promise<SwapRequest> {
  const ref = swapRequestsColRef(domain).doc(requestId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const req = snap.data() as SwapRequest;
    if (req.requesterEmail !== requesterEmail.toLowerCase())
      throw new Error("본인의 신청만 취소할 수 있습니다.");
    if (req.status !== "PENDING") throw new Error("대기 중인 신청만 취소할 수 있습니다.");
    tx.update(ref, { status: "CANCELED", decidedAt: Date.now() });
    return { ...req, id: requestId, status: "CANCELED" as const };
  });
}

// ── 승인·반려·취소(revert) — §5 트랜잭션 ──────────────────────

/**
 * 승인: Firestore 트랜잭션 안에서 그 주 changes를 다시 읽고 후보를 재검증한다.
 * 다른 승인으로 상황이 바뀌었으면 실패 — 승인 간 경합이 유일한 동시성 위험 지점(§5).
 */
export async function approveSwapRequest(
  domain: string,
  managerEmail: string,
  requestId: string
): Promise<{ request: SwapRequest; change: TimetableChange }> {
  // 기초 그리드·설정·주는 승인 중 변하지 않으므로 트랜잭션 밖에서 읽는다.
  const reqSnapPre = await swapRequestsColRef(domain).doc(requestId).get();
  if (!reqSnapPre.exists) throw new Error("신청을 찾을 수 없습니다.");
  const reqPre = reqSnapPre.data() as SwapRequest;
  const [week, baseGrids, settings] = await Promise.all([
    loadWeek(domain, reqPre.weekId),
    loadAllClassGrids(domain, reqPre.termId),
    loadTimetableSettings(domain),
  ]);
  if (!week) throw new Error(`등록되지 않은 주(${reqPre.weekId})입니다.`);

  // 교차 주 (§4-3b): 대상 주 문서도 트랜잭션 밖에서 읽는다 (주 문서는 승인 중 불변)
  const isCross = !!reqPre.targetWeekId && reqPre.targetWeekId !== reqPre.weekId;
  const targetWeek = isCross ? await loadWeek(domain, reqPre.targetWeekId!) : null;
  if (isCross && !targetWeek)
    throw new Error(`등록되지 않은 주(${reqPre.targetWeekId})입니다. 대상 주 등록이 삭제되어 승인할 수 없습니다.`);

  const result = await adminDb.runTransaction(async (tx) => {
    const reqRef = swapRequestsColRef(domain).doc(requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const request = { ...(reqSnap.data() as SwapRequest), id: requestId };
    if (request.status !== "PENDING") throw new Error("대기 중인 신청만 승인할 수 있습니다.");

    const changesSnap = await tx.get(
      timetableChangesColRef(domain).where("weekId", "==", request.weekId)
    );
    const changes = changesSnap.docs
      .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
      .sort((a, b) => a.appliedAt - b.appliedAt);

    // 교차 주: 대상 주 changes도 트랜잭션 안에서 재읽기 (양주 재검증 — §4-3b)
    let targetChanges: TimetableChange[] = [];
    if (isCross) {
      const targetChangesSnap = await tx.get(
        timetableChangesColRef(domain).where("weekId", "==", request.targetWeekId!)
      );
      targetChanges = targetChangesSnap.docs
        .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
        .sort((a, b) => a.appliedAt - b.appliedAt);
    }

    // 트랜잭션 내 재검증: 현재 오버레이 기준으로 후보가 여전히 성립하는가
    const { grids } = synthesizeWeeklyGrids(baseGrids, week, changes, settings);
    const src = resolveSourceLesson(grids, request.requesterEmail, request.source);
    if (!src.ok) throw new Error(`승인 불가 — ${src.error} 신청자의 재신청이 필요합니다.`);

    // ── 교차 주 맞교환 승인: 양방향 재검증 → 문서쌍(exchangeId) 원자 커밋 (§4-3b) ──
    if (isCross) {
      const cand = request.candidate;
      const { grids: targetGrids } = synthesizeWeeklyGrids(baseGrids, targetWeek!, targetChanges, settings);
      const crossRes = findCrossSwapCandidates(
        grids, week, targetGrids, targetWeek!, settings, request.requesterEmail, request.source
      );
      if (crossRes.error) throw new Error(`승인 불가 — ${crossRes.error} 신청자의 재신청이 필요합니다.`);
      const still = crossRes.candidates.find(
        (c) =>
          c.targetDay === cand.targetDay &&
          c.targetPeriod === cand.targetPeriod &&
          c.counterpartEmail === cand.counterpartEmail
      );
      if (!still)
        throw new Error("승인 불가 — 다른 변경으로 상황이 바뀌어 후보가 더 이상 유효하지 않습니다. 신청자의 재신청이 필요합니다.");

      // 상대 수업 전체 정보(약칭·특별실)는 재검증된 대상 주 합성본 셀에서 직접 읽는다
      const targetGrid = targetGrids.find(
        (g) => g.grade === request.source.grade && g.classNum === request.source.classNum
      )!;
      const counterpartLesson = targetGrid.cells.find(
        (c) => c.day === still.targetDay && c.period === still.targetPeriod
      )!.lessons[0];

      const myRef: CrossSwapLessonRef = {
        subjectName: src.lesson!.subjectName,
        subjectShort: src.lesson!.subjectShort,
        teacherEmail: request.requesterEmail,
        teacherName: request.requesterName,
        ...(src.lesson!.room ? { room: src.lesson!.room } : {}),
      };
      const otherRef: CrossSwapLessonRef = {
        subjectName: counterpartLesson.subjectName,
        subjectShort: counterpartLesson.subjectShort,
        teacherEmail: still.counterpartEmail,
        teacherName: still.counterpartName,
        ...(counterpartLesson.room ? { room: counterpartLesson.room } : {}),
      };

      const exchangeId = timetableChangesColRef(domain).doc().id;
      const refA = timetableChangesColRef(domain).doc();
      const refB = timetableChangesColRef(domain).doc();
      const now = Date.now();
      const common = {
        termId: request.termId,
        type: "cross_swap" as const,
        requestId,
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: now,
      };
      const changeA: TimetableChange = {
        id: refA.id,
        weekId: request.weekId,
        ...common,
        crossSwap: {
          exchangeId,
          otherWeekId: request.targetWeekId!,
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: request.source.day,
          period: request.source.period,
          out: myRef,
          in: otherRef,
        },
      };
      const changeB: TimetableChange = {
        id: refB.id,
        weekId: request.targetWeekId!,
        ...common,
        crossSwap: {
          exchangeId,
          otherWeekId: request.weekId,
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: still.targetDay,
          period: still.targetPeriod,
          out: otherRef,
          in: myRef,
        },
      };
      tx.set(refA, changeA);
      tx.set(refB, changeB);
      tx.update(reqRef, {
        status: "APPROVED",
        decidedBy: managerEmail.toLowerCase(),
        decidedAt: now,
        appliedChangeIds: [refA.id, refB.id],
      });
      return {
        request: { ...request, status: "APPROVED" as const, appliedChangeIds: [refA.id, refB.id] },
        change: changeA,
      };
    }

    const changeRef = timetableChangesColRef(domain).doc();
    let change: TimetableChange;

    if (request.type === "swap") {
      const cand = request.candidate;
      const swapRes = findSwapCandidates(grids, week, settings, request.requesterEmail, request.source);
      const still = swapRes.candidates.find(
        (c) =>
          c.targetDay === cand.targetDay &&
          c.targetPeriod === cand.targetPeriod &&
          c.counterpartEmail === cand.counterpartEmail
      );
      if (!still)
        throw new Error("승인 불가 — 다른 변경으로 상황이 바뀌어 후보가 더 이상 유효하지 않습니다. 신청자의 재신청이 필요합니다.");

      change = {
        id: changeRef.id,
        termId: request.termId,
        weekId: request.weekId,
        type: "swap",
        requestId,
        swap: {
          grade: request.source.grade,
          classNum: request.source.classNum,
          a: {
            day: request.source.day,
            period: request.source.period,
            subjectName: request.source.subjectName,
            teacherEmail: request.requesterEmail,
            teacherName: request.requesterName,
          },
          b: {
            day: still.targetDay,
            period: still.targetPeriod,
            subjectName: still.counterpartSubjectName,
            teacherEmail: still.counterpartEmail,
            teacherName: still.counterpartName,
          },
        },
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: Date.now(),
      };
    } else {
      // 특별보강: 보강 교사가 여전히 그 슬롯에 공강인지 재확인
      const idxFree = !synthesizeWeeklyGrids(baseGrids, week, changes, settings)
        .grids.some((g) =>
          g.cells.some(
            (c) =>
              c.day === request.source.day &&
              c.period === request.source.period &&
              c.lessons.some((l) =>
                (l.teachers || []).some(
                  (t) => t.email.trim().toLowerCase() === request.candidate.counterpartEmail
                )
              )
          )
        );
      if (!idxFree)
        throw new Error("승인 불가 — 보강 교사가 해당 교시에 더 이상 공강이 아닙니다. 신청자의 재신청이 필요합니다.");

      change = {
        id: changeRef.id,
        termId: request.termId,
        weekId: request.weekId,
        type: "substitute",
        requestId,
        substitute: {
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: request.source.day,
          period: request.source.period,
          subjectName: request.source.subjectName,
          absentTeacherEmail: request.requesterEmail,
          absentTeacherName: request.requesterName,
          subTeacherEmail: request.candidate.counterpartEmail,
          subTeacherName: request.candidate.counterpartName,
        },
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: Date.now(),
      };
    }

    tx.set(changeRef, change);
    tx.update(reqRef, {
      status: "APPROVED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: change.appliedAt,
      appliedChangeIds: [changeRef.id],
    });
    return { request: { ...request, status: "APPROVED" as const, appliedChangeIds: [changeRef.id] }, change };
  });

  // 알림: 신청자 + 상대 교사 (§5 — 교무부장은 열람 전용, DM 없음)
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const r = result.request;
  // 교차 주는 주가 다르므로 날짜를 병기한다 (§4-3b UI 원칙과 동일)
  const dateOfDay = (w: TimetableWeek | null, day: number): string =>
    w?.days.find((d) => d.day === day)?.date?.slice(5).replace("-", "/") || "";
  const msg =
    `✅ 수업교환 승인 완료${isCross ? " (교차 주)" : ""}\n` +
    `${r.source.grade}-${r.source.classNum} ${isCross ? `${dateOfDay(week, r.source.day)}(` : ""}${dayNames[r.source.day]} ${r.source.period}교시${isCross ? ")" : ""} ${r.source.subjectName}` +
    (r.type === "swap"
      ? ` ↔ ${isCross ? `${dateOfDay(targetWeek, r.candidate.targetDay || 0)}(` : ""}${dayNames[r.candidate.targetDay || 0]} ${r.candidate.targetPeriod}교시${isCross ? ")" : ""} ${r.candidate.counterpartSubjectName} (${r.candidate.counterpartName})`
      : ` → ${r.candidate.counterpartName} 선생님 특별보강`) +
    `\n승인: ${managerEmail}`;
  for (const to of [r.requesterEmail, r.candidate.counterpartEmail]) {
    try {
      await sendGoogleChat(to, msg);
    } catch (e: any) {
      console.error(`[swap_approve] 알림 실패 (${to}):`, e.message);
    }
  }

  return result;
}

export async function rejectSwapRequest(
  domain: string,
  managerEmail: string,
  requestId: string,
  decisionNote: string
): Promise<SwapRequest> {
  const note = (decisionNote || "").trim();
  if (!note) throw new Error("반려 사유는 필수입니다.");
  const ref = swapRequestsColRef(domain).doc(requestId);
  const updated = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const req = { ...(snap.data() as SwapRequest), id: requestId };
    if (req.status !== "PENDING") throw new Error("대기 중인 신청만 반려할 수 있습니다.");
    tx.update(ref, {
      status: "REJECTED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: Date.now(),
      decisionNote: note,
    });
    return { ...req, status: "REJECTED" as const, decisionNote: note };
  });

  try {
    await sendGoogleChat(
      updated.requesterEmail,
      `❌ 수업교환 신청 반려\n사유: ${note}\n반려: ${managerEmail}`
    );
  } catch (e: any) {
    console.error(`[swap_reject] 알림 실패:`, e.message);
  }
  return updated;
}

/** 승인 취소: 원본 불변 — 역방향(revert) 변경을 기록한다 (§2) */
export async function revertTimetableChange(
  domain: string,
  managerEmail: string,
  changeId: string
): Promise<TimetableChange> {
  const reverted = await adminDb.runTransaction(async (tx) => {
    const targetRef = timetableChangesColRef(domain).doc(changeId);
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists) throw new Error("취소할 변경을 찾을 수 없습니다.");
    const target = { ...(targetSnap.data() as TimetableChange), id: changeId };
    if (target.type === "revert") throw new Error("취소 기록 자체는 다시 취소할 수 없습니다.");

    // 취소 대상 문서 집합: 교차 주는 exchangeId 문서쌍 전체 — 한쪽만 취소 금지 (§4-3b)
    let targets: TimetableChange[] = [target];
    if (target.type === "cross_swap" && target.crossSwap) {
      const pairSnap = await tx.get(
        timetableChangesColRef(domain).where(
          "crossSwap.exchangeId", "==", target.crossSwap.exchangeId
        )
      );
      targets = pairSnap.docs.map((d) => ({ ...(d.data() as TimetableChange), id: d.id }));
      if (!targets.some((t) => t.id === changeId)) targets.push(target);
    }

    for (const t of targets) {
      const existingRevert = await tx.get(
        timetableChangesColRef(domain).where("revertOf", "==", t.id).limit(1)
      );
      if (!existingRevert.empty) throw new Error("이미 취소된 변경입니다.");
    }

    const now = Date.now();
    const reverts: TimetableChange[] = [];
    for (const t of targets) {
      const ref = timetableChangesColRef(domain).doc();
      const revert: TimetableChange = {
        id: ref.id,
        termId: t.termId,
        weekId: t.weekId,
        type: "revert",
        revertOf: t.id,
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: now,
      };
      tx.set(ref, revert);
      reverts.push(revert);
    }
    if (target.requestId) {
      tx.update(swapRequestsColRef(domain).doc(target.requestId), {
        status: "CANCELED",
        decidedBy: managerEmail.toLowerCase(),
        decidedAt: now,
        decisionNote: "일과계 승인 취소 (revert)",
      });
    }
    return { revert: reverts.find((r) => r.revertOf === changeId) || reverts[0], target };
  });

  // 알림: 원 승인 알림 수신자 전원 (§5)
  const recipients = new Set<string>();
  const t = reverted.target;
  if (t.swap) {
    recipients.add(t.swap.a.teacherEmail);
    recipients.add(t.swap.b.teacherEmail);
  }
  if (t.substitute) {
    recipients.add(t.substitute.absentTeacherEmail);
    recipients.add(t.substitute.subTeacherEmail);
  }
  if (t.crossSwap) {
    recipients.add(t.crossSwap.out.teacherEmail);
    recipients.add(t.crossSwap.in.teacherEmail);
  }
  for (const to of recipients) {
    try {
      await sendGoogleChat(to, `↩️ 승인되었던 수업교환이 취소되었습니다.\n취소: ${managerEmail}`);
    } catch (e: any) {
      console.error(`[swap_revert] 알림 실패 (${to}):`, e.message);
    }
  }
  return reverted.revert;
}

// ── 일과계 직권 배정 (§6 direct_* — 관리자 전용) ──────────────

export interface DirectSourceInfo {
  teacherEmail: string;
  teacherName: string;
  subjectName: string;
}

/** 직권 배정용 소스 슬롯 해석: 관리자가 지정한 슬롯의 (단일) 담당 교사를 서버가 찾는다 */
export function resolveDirectSource(
  grids: WeeklyClassGrid[],
  source: { grade: number; classNum: number; day: number; period: number }
): { ok: true; info: DirectSourceInfo } | { ok: false; error: string } {
  const grid = grids.find((g) => g.grade === source.grade && g.classNum === source.classNum);
  if (!grid) return { ok: false, error: "해당 학급 시간표를 찾을 수 없습니다." };
  const cell = grid.cells.find((c) => c.day === source.day && c.period === source.period);
  if (!cell || cell.lessons.length === 0) return { ok: false, error: "해당 교시에 수업이 없습니다." };
  if (cell.lessons.length > 1)
    return { ok: false, error: "동시수업(분반) 교시는 직권 배정 대상이 아닙니다." };
  const lesson = cell.lessons[0];
  if ((lesson.teachers || []).length > 1)
    return { ok: false, error: "복수교사 수업은 직권 배정 대상이 아닙니다." };
  const t = lesson.teachers[0];
  if (!t || !t.email?.trim())
    return { ok: false, error: "가상 교사(학교 공통 활동) 수업은 직권 배정 대상이 아닙니다." };
  return {
    ok: true,
    info: {
      teacherEmail: t.email.trim().toLowerCase(),
      teacherName: t.name,
      subjectName: lesson.subjectName,
    },
  };
}

/** 직권 후보 탐색: 슬롯 담당 교사를 서버가 해석한 뒤 그 교사 기준으로 엔진 실행 */
export async function computeDirectCandidates(
  domain: string,
  weekId: string,
  source: SwapSourceSlot,
  targetWeekId?: string
) {
  const week = await loadWeek(domain, weekId);
  if (!week) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const { grids } = await synthesizeWeek(domain, week);
  const resolved = resolveDirectSource(grids, source);
  if (!resolved.ok) return { error: resolved.error };
  const computed = await computeCandidates(
    domain, resolved.info.teacherEmail, weekId, source, targetWeekId
  );
  return { ...computed, sourceTeacher: resolved.info };
}

/**
 * 직권 배정 실행: 슬롯 담당 교사 명의의 신청을 서버가 생성한 뒤 즉시 승인한다.
 * 승인 재검증에 실패하면 생성한 신청을 자동 취소(CANCELED)해 유령 PENDING을 남기지 않는다.
 */
export async function directCommit(
  domain: string,
  managerEmail: string,
  params: {
    weekId: string;
    type: SwapRequestType;
    source: SwapSourceSlot;
    candidate: SwapCandidateSnapshot;
    reason?: SwapRequestReason;
    targetWeekId?: string; // 교차 주 맞교환 (§4-3b)
  }
): Promise<{ request: SwapRequest; change: TimetableChange }> {
  const week = await loadWeek(domain, params.weekId);
  if (!week) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);
  const { grids } = await synthesizeWeek(domain, week);
  const resolved = resolveDirectSource(grids, params.source);
  if (!resolved.ok) throw new Error(resolved.error);

  const request = await createSwapRequest(
    domain,
    resolved.info.teacherEmail,
    {
      weekId: params.weekId,
      type: params.type,
      source: params.source,
      candidate: params.candidate,
      reason: params.reason,
      targetWeekId: params.targetWeekId,
    },
    { skipManagerNotify: true, direct: true }
  );

  try {
    return await approveSwapRequest(domain, managerEmail, request.id);
  } catch (e) {
    // 직권 흐름에서 승인 실패 시 교사 명의의 유령 PENDING이 남지 않도록 자동 취소
    await swapRequestsColRef(domain).doc(request.id).update({
      status: "CANCELED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: Date.now(),
      decisionNote: "직권 배정 승인 실패로 자동 취소",
    });
    throw e;
  }
}

// ── 운영 도구 (phase9b_spec §8 — neis_list / hour_totals, 읽기 전용) ──

async function resolveTermIdOrThrow(domain: string, termId?: string): Promise<string> {
  if (termId) return termId;
  const settings = await loadTimetableSettings(domain);
  if (!settings.activeTermId) throw new Error("활성 학기가 없습니다. termId를 지정하세요.");
  return settings.activeTermId;
}

/** NEIS 입력용 수업교환 목록 (§8) — 기간 내 확정 변경 평탄화, revert 반영 */
export async function listNeisRows(
  domain: string,
  params: { termId?: string; startDate: string; endDate: string; type?: SwapRequestType }
): Promise<NeisRow[]> {
  const { startDate, endDate } = params;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate))
    throw new Error("startDate·endDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (startDate > endDate) throw new Error("startDate가 endDate보다 늦을 수 없습니다.");
  const termId = await resolveTermIdOrThrow(domain, params.termId);
  const [weeks, changes] = await Promise.all([
    listWeeks(domain, termId),
    loadTermChanges(domain, termId),
  ]);
  return flattenNeisChanges(weeks, changes, { startDate, endDate, type: params.type });
}

/**
 * 시수 집계 (§8) — 학기 시작~endDate까지 등록된 주의 합성본에서 실시수만 센다 (§12-3).
 * 저장하지 않고 매번 계산. 특별보강 누계는 엔진 공평 정렬과 동일 함수(countSubstituteTotals) 공유.
 */
export async function computeHourTotals(
  domain: string,
  params: { termId?: string; endDate: string }
): Promise<HourTotalsResult> {
  const { endDate } = params;
  if (!DATE_RE.test(endDate)) throw new Error("endDate는 YYYY-MM-DD 형식이어야 합니다.");
  const termId = await resolveTermIdOrThrow(domain, params.termId);

  const weeks = (await listWeeks(domain, termId)).filter((w) => w.startDate <= endDate);
  const acc = {
    byTeacher: new Map<string, { name: string; total: number }>(),
    bySubject: new Map<string, number>(),
    byClass: new Map<string, number>(),
  };
  for (const week of weeks) {
    const { grids } = await synthesizeWeek(domain, week);
    accumulateWeeklyHours(grids, week, endDate, acc);
  }

  // 특별보강 누계: 집계 구간의 주 + 슬롯 날짜가 endDate 이내인 change만. revert 기록은 항상 유지.
  const weekIds = new Set(weeks.map((w) => w.id));
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const termChanges = (await loadTermChanges(domain, termId)).filter((c) => {
    if (!weekIds.has(c.weekId)) return false;
    if (c.type === "revert") return true;
    if (c.type === "substitute" && c.substitute) {
      const date = weekById.get(c.weekId)?.days.find((d) => d.day === c.substitute!.day)?.date;
      return !!date && date <= endDate;
    }
    return true; // swap은 특별보강 누계와 무관
  });
  const subTotals = countSubstituteTotals(termChanges);

  return {
    termId,
    endDate,
    weeksCounted: weeks.length,
    byTeacher: Array.from(acc.byTeacher.entries())
      .map(([email, v]) => ({
        email,
        name: v.name,
        total: v.total,
        substituteCount: subTotals.get(email) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    bySubject: Array.from(acc.bySubject.entries())
      .map(([subjectName, total]) => ({ subjectName, total }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "ko")),
    byClass: Array.from(acc.byClass.entries())
      .map(([key, total]) => {
        const [grade, classNum] = key.split("-").map(Number);
        return { grade, classNum, total };
      })
      .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum),
  };
}

// ── 사전 양해 임시저장 CRUD (swap_drafts — phase9b_spec §13-1) ─

export async function saveSwapDraft(
  domain: string,
  userEmail: string,
  userName: string,
  draftId?: string,
  draftData?: any
): Promise<SwapDraft> {
  const colRef = swapDraftsColRef(domain);
  const now = Date.now();

  if (!draftData || !draftData.source || !draftData.candidate || !draftData.sourceWeekId) {
    throw new Error("초안 저장을 위한 필수 정보(source, candidate, sourceWeekId)가 누락되었습니다.");
  }

  // 상대 교사 이메일 형식 검증
  const counterpartEmail = draftData.candidate?.counterpartEmail;
  if (counterpartEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(counterpartEmail)) {
    throw new Error("상대 교사 이메일 형식이 올바르지 않습니다.");
  }

  let docId = draftId;

  if (docId) {
    // 1. (보안 가드) 수정 경로 소유권 확인 — 기존 초안 ID가 넘겨진 경우 작성자 본인 일치 검증
    const existingSnap = await colRef.doc(docId).get();
    if (!existingSnap.exists) {
      throw new Error("존재하지 않는 초안입니다.");
    }
    const existingData = existingSnap.data();
    if (existingData?.requesterEmail !== userEmail) {
      throw new Error("해당 초안을 수정할 권한이 없습니다.");
    }
  } else {
    // 2. 신규 생성 시 1인당 최대 20건 상한 검증
    const countSnap = await colRef.where("requesterEmail", "==", userEmail).get();
    if (countSnap.size >= 20) {
      throw new Error("임시저장 초안은 최대 20건까지 저장할 수 있습니다. 기존 초안을 정리 후 다시 시도해 주세요.");
    }
    docId = colRef.doc().id;
  }

  const activeTerm = await loadActiveTerm(domain);
  const termId = draftData.termId || activeTerm?.id || "2026-2";

  // 신청자 실명: 합성본의 소스 lesson에서 추출 (3단계 대비 실명 저장)
  let requesterName = userName || userEmail.split("@")[0];
  try {
    const week = await loadWeek(domain, draftData.sourceWeekId);
    if (week) {
      const { grids } = await synthesizeWeek(domain, week);
      const src = resolveSourceLesson(grids, userEmail, draftData.source);
      if (src.ok && src.lesson) {
        requesterName = src.lesson.teachers[0]?.name || requesterName;
      }
    }
  } catch (e) {
    // fallback to default
  }

  const docPayload = {
    requesterEmail: userEmail, // 서버가 본인으로 강제 세팅
    requesterName,
    termId,
    sourceWeekId: draftData.sourceWeekId,
    targetWeekId: draftData.targetWeekId || null,
    source: draftData.source,
    candidate: draftData.candidate,
    reason: draftData.reason || null,
    note: draftData.note || "",
    consentStatus: "NONE" as const,
    updatedAt: now,
    conditional: !!draftData.conditional,
    ...(draftId ? {} : { createdAt: now }),
  };

  await colRef.doc(docId).set(docPayload, { merge: true });

  const updatedSnap = await colRef.doc(docId).get();
  const savedData = updatedSnap.data()!;

  return {
    id: docId,
    requesterEmail: savedData.requesterEmail,
    requesterName: savedData.requesterName,
    termId: savedData.termId,
    sourceWeekId: savedData.sourceWeekId,
    targetWeekId: savedData.targetWeekId || undefined,
    source: savedData.source,
    candidate: savedData.candidate,
    reason: savedData.reason || undefined,
    note: savedData.note || "",
    consentStatus: savedData.consentStatus || "NONE",
    createdAt: toMillis(savedData.createdAt) || now,
    updatedAt: toMillis(savedData.updatedAt) || now,
    conditional: !!savedData.conditional,
  };
}

export async function listSwapDrafts(domain: string, userEmail: string): Promise<SwapDraft[]> {
  const colRef = swapDraftsColRef(domain);
  const snap = await colRef.where("requesterEmail", "==", userEmail).get();
  const drafts: SwapDraft[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      requesterEmail: data.requesterEmail,
      requesterName: data.requesterName || "",
      termId: data.termId || "",
      sourceWeekId: data.sourceWeekId || "",
      targetWeekId: data.targetWeekId || undefined,
      source: data.source,
      candidate: data.candidate,
      reason: data.reason || undefined,
      note: data.note || "",
      consentStatus: data.consentStatus || "NONE",
      createdAt: toMillis(data.createdAt) || Date.now(),
      updatedAt: toMillis(data.updatedAt) || Date.now(),
      conditional: !!data.conditional,
    };
  });
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSwapDraft(domain: string, userEmail: string, draftId: string): Promise<void> {
  const colRef = swapDraftsColRef(domain);
  const docRef = colRef.doc(draftId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new Error("존재하지 않는 초안입니다.");
  }
  if (snap.data()?.requesterEmail !== userEmail) {
    throw new Error("해당 초안을 삭제할 권한이 없습니다.");
  }
  await docRef.delete();
}

