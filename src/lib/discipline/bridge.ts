/**
 * Phase 6b 후속 — 기존 시트 실대체 전환 브리지 코어 모듈
 *
 * 매핑 스펙 (development_roadmap.md 2026-08-09 확정):
 * - 단방향(시트 체크박스 → 플랫폼 가져오기) 추가 전용 크론.
 * - 무상태·멱등 설계: 시트건수(최대 회차) vs 플랫폼건수(voided 포함) 차액 대조 후 누락분만 수입.
 * - 안전 가드:
 *   ① 킬 스위치 (discipline_config.sheetBridgeEnabled === true 필요, 기본값 false/no-op)
 *   ② 폭주 가드 1: 탭 머리글 불일치 시 해당 탭 스킵+경고
 *   ③ 폭주 가드 2: 1회 실행 추가 건수 > 30건 시 전체 중단
 */

import { google } from "googleapis";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  loadDisciplineConfig,
  recordFromDoc,
  recordsColRef,
  triggerAutoStageEventIfNeeded,
} from "./server";

export const DISCIPLINE_BRIDGE_SHEETS: Record<number, string> = {
  1: "1T50su8s2SCYJ96koiGxwugrWEADLLHFmZ2-LOVxf4VY",
  2: "1GarUv1xBpi_8Xht9cD9-UsDkEZnGI2iLFj-NGbrhf-s",
  3: "1p9CGMtQl953T7Y_o88dalNG52tifzBJPia_AO6Dryf0",
};

export const DISCIPLINE_BRIDGE_COLS: { col: number; itemId: string; nth: number; label: string }[] = [
  { col: 2, itemId: "item_uniform", nth: 1, label: "교복1회(담임)" },
  { col: 3, itemId: "item_uniform", nth: 2, label: "교복2회(생활지도교사)" },
  { col: 4, itemId: "item_uniform", nth: 3, label: "교복3회(위원회)" },
  { col: 5, itemId: "item_smoking", nth: 1, label: "흡연1회(1단계)" },
  { col: 6, itemId: "item_smoking", nth: 2, label: "흡연2회(위원회)" },
  { col: 7, itemId: "item_phone",   nth: 1, label: "휴대폰1회(1단계)" },
  { col: 8, itemId: "item_phone",   nth: 2, label: "휴대폰2회(위원회)" },
];

export const MAX_BRIDGE_ADDITIONS_PER_RUN = 30;

function jwtAuth(scopes: string[]) {
  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const saEmail = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL;
  const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || "admin@hmh.or.kr";

  if (!privateKey || !saEmail) {
    throw new Error("GWS Service Account credentials are missing in environment variables.");
  }

  return new google.auth.JWT({
    email: saEmail,
    key: privateKey,
    scopes,
    subject: adminEmail,
  });
}

export function parseNoteDate(note: string): number | null {
  if (!note) return null;
  const m = note.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return Date.parse(`2026-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T03:00:00Z`);
}

export interface BridgeExclusion {
  key: string;
  name: string;
  reason: string;
  checksCount: number;
}

export interface BridgeRunOptions {
  domain?: string;
  dryRun?: boolean;
  bypassKillSwitch?: boolean;
}

export interface BridgeRunResult {
  success: boolean;
  skipped?: boolean;
  aborted?: boolean;
  dryRun?: boolean;
  reason?: string;
  checkedRowsCount?: number;
  checkedTotalCount?: number;
  addedRecordsCount?: number;
  createdEventsCount?: number;
  excluded?: BridgeExclusion[];
  warnings?: string[];
}

interface StudentRosterEntry {
  name: string;
  email: string;
  suspended: boolean;
  studentId: string;
}

/** GWS Directory에서 학생 명단 수집 (학번 5자리 regex 대조, suspended 유저 구분) */
async function loadRosterFromDirectory() {
  const auth = jwtAuth(["https://www.googleapis.com/auth/admin.directory.user"]);
  const admin = google.admin({ version: "directory_v1", auth });
  const byKey = new Map<string, StudentRosterEntry>();
  let pageToken: string | undefined;

  do {
    const res = await admin.users.list({
      customer: "my_customer",
      maxResults: 500,
      pageToken,
      projection: "basic",
    });
    for (const u of res.data.users || []) {
      const fam = (u.name?.familyName || "").trim();
      const m = fam.match(/^(\d)(\d{2})(\d{2})$/);
      if (!m) continue;
      const key = `${parseInt(m[1], 10)}-${parseInt(m[2], 10)}-${parseInt(m[3], 10)}`;
      byKey.set(key, {
        name: (u.name?.givenName || "").trim(),
        email: (u.primaryEmail || "").trim().toLowerCase(),
        suspended: Boolean(u.suspended),
        studentId: `${m[1]}${m[2]}${m[3]}`,
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return byKey;
}

/** 탭 머리글 라벨 검증 (폭주 가드 1) */
function validateTabHeader(values: any[][]): boolean {
  if (!values || values.length === 0) return false;
  // A1:J3 영역 내에 "번호"/"학번", "성명"/"이름", "비고" 등이 포함되어 있는지 확인 (공백 제거 후 대조)
  const text = values
    .flatMap((r) => r.map((cell) => String(cell ?? "")))
    .join("")
    .replace(/\s+/g, "");
  const hasNum = text.includes("번호") || text.includes("학번");
  const hasName = text.includes("성명") || text.includes("이름");
  const hasNote = text.includes("비고");
  return hasNum && hasName && hasNote;
}

export async function runDisciplineSheetBridge(
  options: BridgeRunOptions = {}
): Promise<BridgeRunResult> {
  const domain = options.domain || "hmh.or.kr";
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];

  // ── 킬 스위치 체크 (discipline_config.sheetBridgeEnabled === true 필요) ──
  const { config } = await loadDisciplineConfig(domain);
  if (config.sheetBridgeEnabled !== true && !options.bypassKillSwitch) {
    console.log(`[Discipline Bridge] 킬 스위치 비활성화 상태 (sheetBridgeEnabled !== true). 실행 건너뜀.`);
    return {
      success: true,
      skipped: true,
      reason: "Bridge kill-switch active (sheetBridgeEnabled is false or missing)",
    };
  }

  // ── 1. GWS Directory 학생 명단 로드 ──
  const roster = await loadRosterFromDirectory();

  // ── 2. 구글 시트 3부 스캔 및 체크 추출 ──
  const sheetsApi = google.sheets({
    version: "v4",
    auth: jwtAuth(["https://www.googleapis.com/auth/spreadsheets"]),
  });

  interface RawSheetCheck {
    grade: number;
    classNum: number;
    num: number;
    name: string;
    col: number;
    note: string;
  }

  const rawChecks: RawSheetCheck[] = [];
  let checkedRowsCount = 0;

  // 읽기 호출 수 주의 (2026-08-13 실사고): 원래는 탭마다 values.get 2회(머리글+데이터)
  // × 10반 × 3부 = **한 번 돌 때 60콜**이었는데, Sheets API의 분당 사용자별 읽기 한도가
  // 정확히 60이라 벼랑 끝에 걸쳐 있었다 — 통합 크론 수동 실행에서 quota exceeded로 실증.
  // 지금은 스프레드시트당 2콜(탭 목록 1 + batchGet 1) = **총 6콜**. 탭 부재 처리도
  // "400 에러를 잡아 스킵"에서 "메타데이터로 실재 탭만 조회"로 바뀌어 정공법이 됐다.
  for (const [gradeStr, id] of Object.entries(DISCIPLINE_BRIDGE_SHEETS)) {
    const grade = Number(gradeStr);

    // 실재 탭 목록 조회 (1콜) — 10반이 없는 학년 등은 여기서 자연히 걸러진다
    let existingTabs: string[];
    try {
      const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId: id,
        fields: "sheets.properties.title",
      });
      const titles = new Set(
        (meta.data.sheets || []).map((s) => s.properties?.title || "")
      );
      existingTabs = Array.from({ length: 10 }, (_, i) => `${grade}-${i + 1}`).filter((t) =>
        titles.has(t)
      );
    } catch (err: any) {
      const warnMsg = `[Sheet Read Error] ${grade}학년 시트 탭 목록 조회 오류: ${String(err?.message || err)}`;
      console.warn(warnMsg);
      warnings.push(warnMsg);
      continue;
    }
    if (existingTabs.length === 0) continue;

    // 전 탭 일괄 읽기 (1콜) — 탭마다 머리글(A1:J3)·데이터(A4:J80) 두 범위를 쌍으로 요청.
    // valueRenderOption은 데이터 파싱(체크박스 boolean) 요건을 따르며, 머리글 검증은
    // 텍스트 포함 검사라 렌더 옵션과 무관하다.
    let valueRanges;
    try {
      const batch = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges: existingTabs.flatMap((t) => [`'${t}'!A1:J3`, `'${t}'!A4:J80`]),
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      valueRanges = batch.data.valueRanges || [];
    } catch (err: any) {
      const warnMsg = `[Sheet Read Error] ${grade}학년 시트 일괄 읽기 오류: ${String(err?.message || err)}`;
      console.warn(warnMsg);
      warnings.push(warnMsg);
      continue;
    }

    for (let ti = 0; ti < existingTabs.length; ti++) {
      const tab = existingTabs[ti];
      const c = Number(tab.split("-")[1]);
      const headValues = valueRanges[ti * 2]?.values || [];
      const dataValues = valueRanges[ti * 2 + 1]?.values || [];

      // 폭주 가드 1: 머리글 검증
      if (!validateTabHeader(headValues)) {
        const warnMsg = `[Header Validation Failed] 탭 '${tab}' 머리글 검증 실패. 해당 탭 스킵.`;
        console.warn(warnMsg);
        warnings.push(warnMsg);
        continue;
      }

      for (const row of dataValues) {
        const num = Number(row[0]);
        const name = String(row[1] ?? "").trim();
        if (!Number.isInteger(num) || num < 1 || !name) continue;

        const note = String(row[9] ?? "").trim();
        let rowHasCheck = false;

        for (const cd of DISCIPLINE_BRIDGE_COLS) {
          if (row[cd.col] === true) {
            rawChecks.push({ grade, classNum: c, num, name, col: cd.col, note });
            rowHasCheck = true;
          }
        }
        if (rowHasCheck) checkedRowsCount++;
      }
    }
  }

  // ── 3. 명단 대조 및 학번×항목 단위 건수 집계 ──
  const excludedMap = new Map<string, BridgeExclusion>();

  interface StudentTarget {
    key: string; // "1-1-1"
    studentId: string; // "10101"
    studentEmail: string;
    studentName: string;
    grade: number;
    classNum: number;
    note: string;
    itemMaxNth: Record<string, number>;
  }

  const studentTargetsMap = new Map<string, StudentTarget>();

  // 학생×항목별 체크 컬렉션
  const studentChecksMap = new Map<string, Map<string, number[]>>();

  for (const ch of rawChecks) {
    const key = `${ch.grade}-${ch.classNum}-${ch.num}`;
    const stu = roster.get(key);
    const colDef = DISCIPLINE_BRIDGE_COLS.find((cd) => cd.col === ch.col)!;

    if (!stu || stu.name !== ch.name || stu.suspended) {
      let reason = "플랫폼에 해당 학번 없음";
      if (stu) {
        if (stu.suspended) reason = "플랫폼 계정 일시정지(suspended) 상태";
        else if (stu.name !== ch.name) reason = `학번의 플랫폼 이름 불일치(플랫폼: ${stu.name})`;
      }
      const exclKey = `${key}|${ch.name}`;
      const existingExcl = excludedMap.get(exclKey) || {
        key,
        name: ch.name,
        reason,
        checksCount: 0,
      };
      existingExcl.checksCount++;
      excludedMap.set(exclKey, existingExcl);
      continue;
    }

    if (!studentChecksMap.has(key)) {
      studentChecksMap.set(key, new Map());
      studentTargetsMap.set(key, {
        key,
        studentId: stu.studentId,
        studentEmail: stu.email,
        studentName: stu.name,
        grade: ch.grade,
        classNum: ch.classNum,
        note: ch.note,
        itemMaxNth: {},
      });
    }

    const itemMap = studentChecksMap.get(key)!;
    const nths = itemMap.get(colDef.itemId) || [];
    nths.push(colDef.nth);
    itemMap.set(colDef.itemId, nths);

    // 비고 정보 최신 업데이트 (비고가 비어있지 않은 경우)
    if (ch.note && !studentTargetsMap.get(key)!.note) {
      studentTargetsMap.get(key)!.note = ch.note;
    }
  }

  // 항목별 maxNth 도출 및 비접두열 경고 검출
  for (const [key, itemMap] of studentChecksMap.entries()) {
    const target = studentTargetsMap.get(key)!;
    for (const [itemId, nths] of itemMap.entries()) {
      const maxNth = Math.max(...nths);
      const minNth = Math.min(...nths);
      if (minNth > 1 || nths.length !== maxNth) {
        const warnMsg = `[Non-prefix Check Warning] ${key} ${target.studentName} (${itemId}): 체크된 회차=[${nths.join(",")}], 최대 회차 ${maxNth} 채택.`;
        console.warn(warnMsg);
        warnings.push(warnMsg);
      }
      target.itemMaxNth[itemId] = maxNth;
    }
  }

  // ── 4. 플랫폼 Firestore 기록과 건수 대조 (voided 포함) ──
  interface PendingAddition {
    target: StudentTarget;
    itemId: string;
    occurredAt: number;
    noteText: string;
  }

  const pendingAdditions: PendingAddition[] = [];

  for (const target of studentTargetsMap.values()) {
    // 해당 학생의 기존 기록 조회 (grade 일치, voided 포함)
    const recSnap = await recordsColRef(domain)
      .where("studentId", "==", target.studentId)
      .get();
    const existingRecs = recSnap.docs.map((d) => recordFromDoc(d.id, d.data()));
    const gradeRecs = existingRecs.filter((r) => r.grade === target.grade);

    for (const [itemId, sheetCount] of Object.entries(target.itemMaxNth)) {
      const platformCount = gradeRecs.filter((r) => r.itemId === itemId).length;
      if (sheetCount > platformCount) {
        const diff = sheetCount - platformCount;
        const occurredAt = Date.now();

        const noteParts = [target.note].filter(Boolean);
        noteParts.push("[시트 자동 가져옴]");
        noteParts.push("[날짜 근사]");
        const noteText = noteParts.join(" ");

        for (let i = 0; i < diff; i++) {
          pendingAdditions.push({
            target,
            itemId,
            occurredAt,
            noteText,
          });
        }
      }
    }
  }

  // ── 5. 폭주 가드 2: 1회 실행 추가 건수 상한 30건 초과 여부 검사 ──
  if (pendingAdditions.length > MAX_BRIDGE_ADDITIONS_PER_RUN) {
    const abortReason = `폭주 방지 가드 발동: 추가 예정 기록 건수(${pendingAdditions.length}건)가 1회 실행 상한(${MAX_BRIDGE_ADDITIONS_PER_RUN}건)을 초과함. 실행 중단.`;
    console.error(`[Discipline Bridge Aborted] ${abortReason}`);

    if (!dryRun) {
      await writeAuditLog({
        operatorEmail: "admin@hmh.or.kr",
        operatorName: "생활지도 시트 브리지 크론",
        action: "시트 브리지 동기화 중단 (폭주 가드)",
        targetEmail: `${domain} 학생전체`,
        details: abortReason,
        status: "failure",
      });
    }

    return {
      success: false,
      aborted: true,
      dryRun,
      reason: abortReason,
      checkedRowsCount,
      checkedTotalCount: rawChecks.length,
      addedRecordsCount: 0,
      createdEventsCount: 0,
      excluded: Array.from(excludedMap.values()),
      warnings,
    };
  }

  // ── 6. 드라이런(dryRun) 모드 처리 ──
  if (dryRun) {
    console.log(`[Discipline Bridge Dry-Run] 대조 ${checkedRowsCount}행(${rawChecks.length}건 체크) → 추가 예정 ${pendingAdditions.length}건, 제외 ${excludedMap.size}명`);
    return {
      success: true,
      dryRun: true,
      checkedRowsCount,
      checkedTotalCount: rawChecks.length,
      addedRecordsCount: pendingAdditions.length,
      createdEventsCount: 0,
      excluded: Array.from(excludedMap.values()),
      warnings,
    };
  }

  // ── 7. 실제 기록 추가 및 단계 자동 판정 실행 ──
  let addedRecordsCount = 0;
  let createdEventsCount = 0;
  const affectedStudentIds = new Set<string>();

  for (const item of pendingAdditions) {
    const recId = "rec_brg_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
    await recordsColRef(domain)
      .doc(recId)
      .set({
        studentId: item.target.studentId,
        studentEmail: item.target.studentEmail,
        studentName: item.target.studentName,
        grade: item.target.grade,
        classNum: item.target.classNum,
        itemId: item.itemId,
        occurredAt: Timestamp.fromMillis(item.occurredAt),
        note: item.noteText.slice(0, 500),
        recordedBy: "admin@hmh.or.kr",
        recordedAt: Timestamp.now(),
        voided: false,
      });
    addedRecordsCount++;
    affectedStudentIds.add(item.target.studentId);
  }

  // 단계 자동 판정 실행 (추가 대상 학생 단위)
  for (const studentId of affectedStudentIds) {
    const target = Array.from(studentTargetsMap.values()).find(
      (t) => t.studentId === studentId
    );
    if (!target) continue;

    const { createdEventId } = await triggerAutoStageEventIfNeeded({
      domain,
      config,
      studentId: target.studentId,
      studentEmail: target.studentEmail,
      studentName: target.studentName,
      grade: target.grade,
      classNum: target.classNum,
      operatorEmail: "admin@hmh.or.kr",
    });

    if (createdEventId) createdEventsCount++;
  }

  // ── 8. 감사 로그 기록 (1줄 요약) ──
  await writeAuditLog({
    operatorEmail: "admin@hmh.or.kr",
    operatorName: "생활지도 시트 브리지 크론",
    action: "시트 브리지 동기화 완료",
    targetEmail: `${domain} 학생전체`,
    details: `시트 대조 ${checkedRowsCount}행(${rawChecks.length}건 체크) 중 누락 기록 ${addedRecordsCount}건 수입 완료 (단계 이벤트 ${createdEventsCount}건 생성, 제외 ${excludedMap.size}명)`,
    status: "success",
  });

  return {
    success: true,
    dryRun: false,
    checkedRowsCount,
    checkedTotalCount: rawChecks.length,
    addedRecordsCount,
    createdEventsCount,
    excluded: Array.from(excludedMap.values()),
    warnings,
  };
}
