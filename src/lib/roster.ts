/**
 * 학적/명렬표 데이터 및 학번 파싱 유틸리티 (Phase 6a)
 * 
 * 구글 워크스페이스 디렉터리의 familyName(학번 5자리 규칙: e.g. 10101 -> 1학년 01반 01번)을
 * 파싱하여 학학년, 반, 번호 정보 및 이름을 구조화합니다.
 */

export interface RawGoogleUser {
  id: string;
  primaryEmail: string;
  name?: {
    familyName?: string;
    givenName?: string;
  };
  suspended?: boolean;
  orgUnitPath?: string;
}

export interface ParsedStudent {
  id: string;
  email: string;
  name: string;
  familyName: string;
  givenName: string;
  grade: number;      // e.g. 1
  classNum: number;   // e.g. 1
  studentNum: number; // e.g. 1
  rawStudentId: string; // "10101"
  isParsed: boolean;
  suspended: boolean;
}

export interface RosterFeedStudent {
  studentId: string;
  grade: number;
  classNum: number;
  number: number;
  name: string;
  email: string;
  suspended: boolean;
}

export interface RosterFeedUnparsed {
  studentId: string;
  name: string;
  email: string;
  suspended: boolean;
}

/**
 * 구글 유저 객체에서 familyName을 추출하여 학번/학년/반/번호를 파싱합니다.
 * StudentRoster.tsx 및 /api/roster/feed 공통 사용.
 */
export function parseStudentUser(u: RawGoogleUser): ParsedStudent {
  const familyName = u.name?.familyName || "";
  const givenName = u.name?.givenName || "";
  const email = u.primaryEmail || "";
  const suspended = Boolean(u.suspended);

  // Regex match: e.g. 10101 (5 digits) -> Grade 1, Class 01, Number 01
  const match = familyName.trim().match(/^(\d)(\d{2})(\d{2})$/);

  if (match) {
    return {
      id: u.id,
      email,
      name: givenName.trim(), // Extracted givenName strictly so that familyName is not prefixed
      familyName,
      givenName,
      grade: parseInt(match[1], 10),
      classNum: parseInt(match[2], 10),
      studentNum: parseInt(match[3], 10),
      rawStudentId: familyName.trim(),
      isParsed: true,
      suspended,
    };
  } else {
    // Fallback for students with unformatted familyName
    return {
      id: u.id,
      email,
      name: `${familyName}${givenName}`.trim(),
      familyName,
      givenName,
      grade: 0,
      classNum: 0,
      studentNum: 99,
      rawStudentId: familyName.trim(),
      isParsed: false,
      suspended,
    };
  }
}
