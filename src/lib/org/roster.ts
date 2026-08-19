import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { getClientCache, setClientCache, invalidateClientCache } from "@/lib/cache/clientCache";
import type { TeacherProfile } from "@/context/AuthContext";

export const TEACHER_PROFILES_CACHE_KEY = "teacher_profiles:all";

/**
 * teacher_profiles 캐시 무효화 헬퍼
 */
export function invalidateTeacherProfilesCache(): void {
  invalidateClientCache(TEACHER_PROFILES_CACHE_KEY);
}

/**
 * Firestore teacher_profiles 전수 로더 (스펙 §5-4, §6)
 *
 * 캐시 우선(기본 TTL 사용 — 5*60*1000 전달을 생략하여 절약 모드의 TTL 연장 손잡이가 적용되도록 함).
 * forceRefresh=true 시 캐시를 무효화하고 Firestore에서 새로 읽어온다.
 */
export async function loadTeacherProfiles(forceRefresh = false): Promise<TeacherProfile[]> {
  if (forceRefresh) {
    invalidateClientCache(TEACHER_PROFILES_CACHE_KEY);
  }
  const cached = forceRefresh ? null : (getClientCache(TEACHER_PROFILES_CACHE_KEY) as TeacherProfile[] | null);
  let rawProfiles: TeacherProfile[];
  if (cached) {
    rawProfiles = cached;
  } else {
    const snap = await getDocs(collection(db, "teacher_profiles"));
    rawProfiles = snap.docs.map((d) => d.data() as TeacherProfile);
    // 스펙 §5-4: 캐시 TTL을 숫자로 넘기지 않고 기본 TTL을 사용
    setClientCache(TEACHER_PROFILES_CACHE_KEY, rawProfiles);
  }

  return rawProfiles.map((data) => ({
    ...data,
    email: (data.email || "").toLowerCase(),
    name: data.name || (data.email || "").split("@")[0],
  }));
}

/**
 * Firestore teacher_profiles 를 email -> TeacherProfile 맵으로 반환
 */
export async function loadTeacherProfileMap(forceRefresh = false): Promise<Map<string, TeacherProfile>> {
  const profiles = await loadTeacherProfiles(forceRefresh);
  const map = new Map<string, TeacherProfile>();
  for (const p of profiles) {
    if (p.email) {
      map.set(p.email.toLowerCase(), p);
    }
  }
  return map;
}

/**
 * GWS 유저 목록에서 표시 이름 맵 추출 (email.toLowerCase() -> fullName)
 */
export function buildGwsNameMap(users: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(users)) return map;
  users.forEach((u: any) => {
    const email = (u.primaryEmail || u.email || "").toLowerCase();
    if (!email) return;
    const name =
      u.name?.fullName ||
      (u.name?.familyName ? `${u.name.familyName}${u.name.givenName || ""}` : null);
    if (name && typeof name === "string" && name.trim()) {
      map.set(email, name.trim());
    }
  });
  return map;
}

/**
 * GWS 유저 목록에서 재직 교직원 이메일 집합 추출 (OrgChartBuilder.teacherUserList / OrgChartTree.activeEmails 동일 기준)
 * 전출·명퇴로 교직원 OU를 떠난 계정의 잔존 프로필 필터용. 캐시가 없으면 null 반환(필터 생략).
 */
export function getActiveTeacherEmails(
  cachedUsers: any[] | null | undefined,
  teacherOU?: string
): Set<string> | null {
  if (!Array.isArray(cachedUsers) || cachedUsers.length === 0) return null;
  const normalizedOU = (teacherOU || "").toLowerCase();
  const set = new Set<string>();
  cachedUsers.forEach((u: any) => {
    const email = (u.primaryEmail || u.email || "").toLowerCase();
    if (!email || /^\d{5}@/.test(email)) return;
    const orgPath = (u.orgUnitPath || "").toLowerCase();
    if (normalizedOU) {
      if (orgPath !== normalizedOU && !orgPath.startsWith(normalizedOU + "/")) return;
    } else if (orgPath.includes("student") || orgPath.includes("학생")) {
      return;
    }
    set.add(email);
  });
  return set;
}

/**
 * GWS 유저 목록에서 재직 교직원 객체 목록 필터링 (OrgChartBuilder.teacherUserList)
 */
export function filterActiveTeachers(
  gwsUsers: any[],
  teacherOU?: string
): any[] {
  const normalizedOU = (teacherOU || "").toLowerCase();
  return gwsUsers.filter((u) => {
    const email = (u.primaryEmail || u.email || "").toLowerCase();
    if (/^\d{5}@/.test(email)) return false; // 학번 계정 제외
    const orgPath = (u.orgUnitPath || "").toLowerCase();
    if (normalizedOU) {
      return orgPath === normalizedOU || orgPath.startsWith(normalizedOU + "/");
    }
    if (orgPath.includes("student") || orgPath.includes("학생")) return false;
    return true;
  });
}
