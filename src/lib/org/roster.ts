import { db, auth } from "@/lib/firebase/config";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getClientCache, setClientCache, invalidateClientCache } from "@/lib/cache/clientCache";
import { ROSTER_INDEX_COLLECTION, isRosterIndexUsable } from "@/lib/org/roster_index_shared";
import type { TeacherProfile } from "@/context/AuthContext";

export const TEACHER_PROFILES_CACHE_KEY = "teacher_profiles:all";

/** 재조립 요청 억제 마커 — 폴백에 빠진 클라이언트가 전부 요청하면 서버 89 reads × N (스펙 §3) */
const REBUILD_MARKER_KEY = "roster_index:rebuild_requested";
const REBUILD_MARKER_TTL_MS = 5 * 60 * 1000;

/**
 * 명단 색인 재조립을 서버에 요청한다 (fire-and-forget).
 *
 * ⚠️ 반드시 프로필 쓰기가 **확정된 뒤에** 불러라 (스펙 §2-3-①).
 * 쓰기 전이나 동시에 부르면 옛 값으로 색인이 만들어지고, 그 색인이 다음 보정까지
 * 진실 행세를 한다. 평소엔 안 드러나고 바쁜 날에만 틀리는 종류다.
 */
export function requestRosterIndexRebuild(): void {
  if (typeof window === "undefined") return;
  if (getClientCache(REBUILD_MARKER_KEY)) return; // 5분 내 중복 요청 억제
  setClientCache(REBUILD_MARKER_KEY, true, REBUILD_MARKER_TTL_MS);
  void (async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await fetch("/api/org/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "rebuild" }),
      });
    } catch {
      // 실패해도 화면을 막지 않는다 — 하루 1회 보정이 흡수한다 (스펙 §2-2)
    }
  })();
}

/**
 * teacher_profiles 캐시 무효화 헬퍼
 *
 * 클라이언트 쓰기 4경로(승인·수동 편집·내선 수정·조직도 일괄 반영)가 전부 이 함수를
 * 지나므로, 서버 색인 재조립도 여기에 얹는다 (스펙 §2-1 갈래 ①).
 * 서버 쓰기 경로는 이 함수를 지나지 않으므로 각자 buildRosterIndex를 직접 부른다.
 */
export function invalidateTeacherProfilesCache(): void {
  invalidateClientCache(TEACHER_PROFILES_CACHE_KEY);
  requestRosterIndexRebuild();
}

/**
 * Firestore teacher_profiles 전수 로더 (스펙 §5-4, §6)
 *
 * 캐시 우선(기본 TTL 사용 — 5*60*1000 전달을 생략하여 절약 모드의 TTL 연장 손잡이가 적용되도록 함).
 * forceRefresh=true 시 캐시를 무효화하고 Firestore에서 새로 읽어온다.
 */
export async function loadTeacherProfiles(forceRefresh = false): Promise<TeacherProfile[]> {
  if (forceRefresh) {
    // 강제 갱신은 프로필을 방금 고쳤다는 뜻이다 — 서버 색인도 다시 만들게 한다.
    invalidateTeacherProfilesCache();
  }
  const cached = forceRefresh ? null : (getClientCache(TEACHER_PROFILES_CACHE_KEY) as TeacherProfile[] | null);
  let rawProfiles: TeacherProfile[];
  if (cached) {
    rawProfiles = cached;
  } else {
    rawProfiles = await fetchProfilesViaIndexOrOrigin();
    // 스펙 §5-4: 캐시 TTL을 숫자로 넘기지 않고 기본 TTL을 사용
    setClientCache(TEACHER_PROFILES_CACHE_KEY, rawProfiles);
  }

  return rawProfiles.map((data) => ({
    ...data,
    email: (data.email || "").toLowerCase(),
  }));
}

/**
 * 명단 색인 우선 읽기 → 못 쓰면 원본 전수 폴백 (스펙 §3)
 *
 * 정상: 문서 1건 = **1 read**. 폴백: teacher_profiles 전수 = 89 reads (색인 도입 전과 동일).
 * 색인을 못 믿는 조건은 스펙 §3 표와 같다 — 없음·구조 불일치·개수 불일치·48시간 초과.
 * 폴백에 빠지면 재조립을 요청하되, requestRosterIndexRebuild가 5분 마커로 스탬피드를 막는다.
 */
async function fetchProfilesViaIndexOrOrigin(): Promise<TeacherProfile[]> {
  const domain = auth.currentUser?.email?.split("@")[1]?.toLowerCase();
  if (domain) {
    try {
      const snap = await getDoc(doc(db, ROSTER_INDEX_COLLECTION, domain));
      const data = snap.exists() ? (snap.data() as any) : null;
      if (isRosterIndexUsable(data)) return data.profiles as TeacherProfile[];
    } catch {
      // 색인 읽기 실패는 치명적이지 않다 — 원본으로 간다
    }
  }
  // ── 폴백: 원본 전수 ──
  const snap = await getDocs(collection(db, "teacher_profiles"));
  requestRosterIndexRebuild();
  return snap.docs.map((d) => d.data() as TeacherProfile);
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
