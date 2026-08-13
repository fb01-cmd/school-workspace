import { TeacherProfile } from "@/context/AuthContext";

export interface DisplayName {
  name: string;        // 표시 이름
  suffix?: string;     // §11-5 동명이인 부제 (지금은 undefined)
  extension?: string;  // §11-6 내선번호
}

/**
 * 이름 표기 단일 소재지 헬퍼 (스펙 §11-7 0단계)
 *
 * 우선순위: profile.name(이메일 로컬부와 다를 때만) > GWS 이름 > 이메일 로컬부
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

  if (rawProfileName && rawProfileName.toLowerCase() !== localPart) {
    chosenName = rawProfileName;
  } else if (gwsName && gwsName.trim()) {
    chosenName = gwsName.trim();
  } else {
    chosenName = localPart;
  }

  return {
    name: chosenName,
    suffix: undefined,
    extension: profile?.extension,
  };
}
