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
      const teacherEmail = (teacherEmailMap[rawCell.teacherName] || "").trim().toLowerCase();
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
          room: rawCell.room,
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
  const unmatchedTeachersSet = new Map<string, number>();

  // 1. 미매칭 교사 체크
  for (const rawGrid of payload.rawClassGrids || []) {
    for (const cell of rawGrid.cells || []) {
      const tName = cell.teacherName?.trim();
      if (!tName) continue;
      const email = teacherEmailMap[tName];
      if (!email) {
        unmatchedTeachersSet.set(tName, (unmatchedTeachersSet.get(tName) || 0) + 1);
      }
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

  const canCommit = unmatchedTeachers.length === 0;
  const isValid = canCommit && overlaps.length === 0 && cellIssues.length === 0;

  return {
    isValid,
    canCommit,
    overlaps,
    cellIssues,
    timeMismatches,
    unmatchedTeachers,
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
