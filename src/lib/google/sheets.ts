import { google } from "googleapis";
import { isMock, listUsersInOUs } from "./workspace";
import { adminDb } from "@/lib/firebase/admin";
import { parseStudentUser } from "@/lib/roster";

/**
 * Google Sheets API 클라이언트를 초기화합니다.
 * 서비스 계정 비공개키로 최고 관리자(GOOGLE_WORKSPACE_ADMIN_EMAIL) 계정을 사칭(impersonate)하여
 * https://www.googleapis.com/auth/spreadsheets 스코프를 획득합니다.
 */
export const getSheetsClient = () => {
  if (isMock) return null;

  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!privateKey || !process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });

  return google.sheets({ version: "v4", auth });
};

/**
 * 스프레드시트 URL 또는 ID 문자열에서 순수 시트 ID를 추출합니다.
 */
export const extractSpreadsheetId = (input: string): string => {
  if (!input) return "";
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
};

export interface UpdateSheetResult {
  success: boolean;
  masterSheetId?: string;
  updatedGrades?: number[];
  totalStudentsCount?: number;
  updatedAt?: string;
  error?: string;
  isMock?: boolean;
}

/**
 * Phase 6a-2: 명렬표 마스터 시트 자동 갱신 서버 유틸리티
 * 
 * 지정된 공유 드라이브 스프레드시트에 학년별 탭(1학년, 2학년, 3학년 ...)을 생성/초기화(clear)한 후,
 * GWS에서 조회된 학생 명단을 학번/반/번호/성명/이메일 형식으로 재작성합니다.
 */
export async function updateMasterRosterSheet(domain: string): Promise<UpdateSheetResult> {
  try {
    if (!domain) {
      return { success: false, error: "도메인 정보가 올바르지 않습니다." };
    }

    // 1. Firestore에서 학교 설정 및 masterSheetId 읽기
    const settingsSnap = await adminDb.collection("settings").doc(domain).get();
    if (!settingsSnap.exists) {
      return { success: false, error: "학교 설정(settings) 문서를 찾을 수 없습니다." };
    }

    const schoolSettings = settingsSnap.data() || {};
    const rawSheetId = schoolSettings.masterSheetId || schoolSettings.rosterMasterSheetId || "";
    const cleanSheetId = extractSpreadsheetId(rawSheetId);

    if (!cleanSheetId) {
      return {
        success: false,
        error: "마스터 시트 ID가 설정되어 있지 않습니다. [시스템 설정]에서 공유 드라이브 스프레드시트 주소를 등록해 주세요.",
      };
    }

    // 2. 학생 OU 목록 및 학생 유저 조회
    let orgUnitPaths: string[] = ["/students"];
    if (schoolSettings?.ouMapping?.students) {
      const paths = Object.values(schoolSettings.ouMapping.students) as string[];
      if (paths.length > 0) orgUnitPaths = paths;
    }

    const rawUsers = await listUsersInOUs(orgUnitPaths);
    const parsedUsers = rawUsers.map(parseStudentUser);

    const gradesCount = schoolSettings.gradesCount || 3;
    const gradesList: number[] = Array.from({ length: gradesCount }, (_, i) => i + 1);

    // 3. 가짜 데이터 모드(Mock Mode)일 때 분기
    if (isMock) {
      return {
        success: true,
        isMock: true,
        masterSheetId: cleanSheetId,
        updatedGrades: gradesList,
        totalStudentsCount: parsedUsers.length,
        updatedAt: new Date().toISOString(),
      };
    }

    // 4. Google Sheets API 클라이언트 초기화
    const sheets = getSheetsClient();
    if (!sheets) {
      return {
        success: false,
        error: "Google Sheets API 서비스 계정 인증 정보를 구성할 수 없습니다. .env.local 설정을 확인해 주세요.",
      };
    }

    // 5. 시트 메타데이터 조회 (인증/스코프 미등록 에러 조기 감지)
    let spreadsheetRes;
    try {
      spreadsheetRes = await sheets.spreadsheets.get({
        spreadsheetId: cleanSheetId,
      });
    } catch (err: any) {
      const errMsg = String(err?.message || "");
      const isPermissionOrScopeError =
        err?.code === 403 ||
        errMsg.includes("403") ||
        errMsg.includes("insufficientPermissions") ||
        errMsg.includes("Not Authorized") ||
        errMsg.includes("API Not Enabled") ||
        errMsg.includes("accessNotConfigured") ||
        errMsg.includes("scope");

      if (isPermissionOrScopeError) {
        return {
          success: false,
          error: "구글 관리자 콘솔(admin.google.com)의 도메인 전체 위임 설정에 'https://www.googleapis.com/auth/spreadsheets' OAuth 스코프 추가 등록 및 GCP Console에서 Google Sheets API를 [사용(ENABLE)]으로 설정해야 합니다.",
        };
      }
      return {
        success: false,
        error: `구글 시트 접근 실패: ${errMsg || "시트 ID를 확인해 주세요."}`,
      };
    }

    // 6. 기존 탭(Sheets) 확인 및 부재 시 학년별 탭 신설
    const existingSheets = spreadsheetRes.data.sheets || [];
    const existingTabTitles = new Set(
      existingSheets.map((s) => s.properties?.title).filter(Boolean)
    );

    const sheetsToAdd: string[] = [];
    for (const g of gradesList) {
      const tabTitle = `${g}학년`;
      if (!existingTabTitles.has(tabTitle)) {
        sheetsToAdd.push(tabTitle);
      }
    }

    if (sheetsToAdd.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: cleanSheetId,
        requestBody: {
          requests: sheetsToAdd.map((title) => ({
            addSheet: {
              properties: { title },
            },
          })),
        },
      });
    }

    // 7. 학년별 탭 전체 클리어 후 재작성
    let totalWrittenCount = 0;
    const header = ["학번", "반", "번호", "성명", "이메일"];

    for (const g of gradesList) {
      const tabTitle = `${g}학년`;
      const studentsInGrade = parsedUsers.filter((s) => s.isParsed && s.grade === g && !s.suspended);

      // 반, 번호 순 정렬
      studentsInGrade.sort((a, b) => {
        if (a.classNum !== b.classNum) return a.classNum - b.classNum;
        return a.studentNum - b.studentNum;
      });

      const rows = studentsInGrade.map((s) => [
        s.rawStudentId,
        s.classNum,
        s.studentNum,
        s.name,
        s.email,
      ]);

      totalWrittenCount += rows.length;

      // 전체 클리어 — 범위를 고정(A1:Z1000)하지 않고 탭 이름만 지정하면 탭 전체가 클리어됨
      await sheets.spreadsheets.values.clear({
        spreadsheetId: cleanSheetId,
        range: `'${tabTitle}'`,
      });

      // 헤더 + 데이터 업데이트
      await sheets.spreadsheets.values.update({
        spreadsheetId: cleanSheetId,
        range: `'${tabTitle}'!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [header, ...rows],
        },
      });
    }

    return {
      success: true,
      masterSheetId: cleanSheetId,
      updatedGrades: gradesList,
      totalStudentsCount: totalWrittenCount,
      updatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("[Sheets Auto Sync Error]:", error);
    return {
      success: false,
      error: `명렬표 마스터 시트 갱신 중 오류 발생: ${error.message}`,
    };
  }
}
