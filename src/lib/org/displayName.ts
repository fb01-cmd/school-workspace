import { TeacherProfile } from "@/context/AuthContext";

export interface DisplayName {
  name: string;        // 표시 이름
  suffix?: string;     // §11-5 동명이인 부제 (지금은 undefined)
  extension?: string;  // §11-6 내선번호
}

/**
 * 이름 표기 단일 소재지 헬퍼 (스펙 §11-7)
 *
 * 우선순위: GWS 이름 > profile.name(이메일 로컬부와 다를 때만) > 이메일 로컬부
 * 가드: profile.name이 이메일 로컬부와 같으면(trim·대소문자 무시) 굳어진 폴백으로 판단하여 이름 없음으로 취급.
 */
export function resolveDisplayName(
  email: string,
  profile?: TeacherProfile,
  gwsName?: string
): DisplayName {
  const cleanEmail = (email || "").trim().toLowerCase();
  const localPart = cleanEmail.split("@")[0] || cleanEmail;

  let chosenName = "";
  const rawProfileName = profile?.name?.trim() || "";

  if (gwsName && gwsName.trim()) {
    chosenName = gwsName.trim();
  } else if (rawProfileName && !isFrozenLocalPartName(rawProfileName, email)) {
    chosenName = rawProfileName;
  } else {
    chosenName = localPart;
  }


  return {
    name: chosenName,
    suffix: undefined,
    extension: profile?.extension,
  };
}

/**
 * "굳어진 폴백" 가드 — 이름이 이메일 로컬부와 같으면(trim·대소문자 무시) 사람이 넣은 이름이
 * 아니라 표시용 폴백이 데이터로 굳은 것으로 판단한다. 이 비교의 단일 소재지.
 * 저장·프리필 경로에서 이 가드를 통과한 이름만 실명 취급할 것.
 */
export function isFrozenLocalPartName(
  name: string | null | undefined,
  email: string
): boolean {
  const cleanEmail = (email || "").trim().toLowerCase();
  const localPart = cleanEmail.split("@")[0] || cleanEmail;
  const n = (name || "").trim().toLowerCase();
  return !!n && n === localPart;
}
