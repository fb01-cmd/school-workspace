"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { User, onIdTokenChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { UserData, handleUserRoles } from "@/lib/firebase/auth";
import PolicyAckModal from "@/components/policy/PolicyAckModal";

export interface TeacherProfile {
  email: string;
  name?: string;
  departments: string[];  // 다중 부서
  noDept?: boolean;      // 소속 없음 (관리 계정 등)
  position?: string;     // 직책 (교사, 부장 등)
  isDeptHead?: boolean;  // 부서장 여부 (전체 중 하나라도 부서장인지 여부)
  deptHeadMap?: Record<string, boolean>; // 부서별 부서장 여부 맵
  isHomeroom?: boolean;
  homeroom?: { grade: number; class: number };
  extension?: string;
  updatedAt?: string;
}

export interface SchedulePeriod {
  period: string;      // e.g. "1", "lunch", "7"
  name: string;        // e.g. "1교시", "점심시간"
  startTime: string;   // e.g. "09:00"
  endTime: string;     // e.g. "09:50"
}

export interface SchoolSettings {
  gradesCount: number;
  classCounts: Record<string, number>;
  allowedBookmarkOUs?: string[];
  ouMapping?: {
    teachers?: string;
    students?: Record<string, string>;
    graduates?: string;
    transferOut?: string;
    teachersOB?: string;
  };
  teacherSettings?: {
    autoJoinGroups?: string[];
  };
  schedule?: SchedulePeriod[];
  departments?: string[];
  positions?: string[];
  blockedOuPaths?: string[];
}

export interface OrgUnit {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  schoolSettings: SchoolSettings | null;
  orgUnits: OrgUnit[];
  teacherProfile: TeacherProfile | null;
  loading: boolean;
  refreshUserData?: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userData: null,
  schoolSettings: null,
  orgUnits: [],
  teacherProfile: null,
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings | null>(null);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // 프리페치는 uid당 1회만 실행 (user 문서 스냅샷이 다시 발화할 때마다
  // 대용량 프리페치 4종이 반복 실행되던 문제 방지)
  const prefetchedUidRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | null = null;
    let unsubscribeSettings: (() => void) | null = null;
    let unsubscribeTeacherProfile: (() => void) | null = null;

    const unsubscribeAuth = onIdTokenChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          // 쿠키 설정 (로컬 개발 서버 HTTP 환경 호환을 위해 Secure는 제외하되, 경로 설정 명시)
          document.cookie = `token=${token}; path=/; SameSite=Lax`;
        } catch (tokenErr) {
          console.error("쿠키 토큰 설정 실패:", tokenErr);
        }

        // Listen to user data from Firestore in real-time
        // onIdTokenChanged는 토큰 갱신(약 1시간)마다 재호출되므로,
        // 기존 리스너를 해제하지 않으면 장시간 세션에서 리스너가 누적된다
        if (unsubscribeDoc) unsubscribeDoc();
        const userRef = doc(db, "users", currentUser.uid);
        unsubscribeDoc = onSnapshot(userRef, (userSnap) => {
          if (userSnap.exists()) {
            const data = userSnap.data() as UserData;
            setUserData(data);

            // Listen to school settings from Firestore in real-time
            if (data.domain) {
              if (unsubscribeSettings) unsubscribeSettings();
              const settingsRef = doc(db, "settings", data.domain);
              unsubscribeSettings = onSnapshot(settingsRef, (settingsSnap) => {
                if (settingsSnap.exists()) {
                  const sData = settingsSnap.data();
                  setSchoolSettings({
                    gradesCount: sData.gradesCount || 3,
                    classCounts: sData.classCounts || {},
                    allowedBookmarkOUs: sData.allowedBookmarkOUs || [],
                    ouMapping: sData.ouMapping || {},
                    teacherSettings: sData.teacherSettings || {},
                    // 아래 3종을 빠뜨리면 관리자가 저장한 순서·일과표가 전 화면에서 무시되고 하드코딩 기본값으로 폴백된다
                    schedule: sData.schedule,
                    departments: sData.departments,
                    positions: sData.positions,
                    // 이 필드가 빠져있어 blockedOuPaths가 Firestore에 저장돼 있어도 화면엔 항상
                    // 빈 목록으로 보이던 실제 원인 (2026-08-11) — 하이드레이션 effect 자체는 정상이었음
                    blockedOuPaths: sData.blockedOuPaths || [],
                  });
                } else {
                  setSchoolSettings({
                    gradesCount: 3,
                    classCounts: {},
                    allowedBookmarkOUs: [],
                    ouMapping: {},
                    teacherSettings: {},
                  });
                }
                setLoading(false);
              }, (err) => {
                console.error("Error listening to settings:", err);
                setLoading(false);
              });
            } else {
              setLoading(false);
            }

            // 교직원인 경우 teacher_profiles 실시간 구독
            if (data.domain && (data.role === "super_admin" || data.role === "teacher") && data.email) {
              if (unsubscribeTeacherProfile) unsubscribeTeacherProfile();
              const profileRef = doc(db, "teacher_profiles", data.email);
              unsubscribeTeacherProfile = onSnapshot(profileRef, (snap) => {
                if (snap.exists()) {
                  setTeacherProfile(snap.data() as TeacherProfile);
                } else {
                  setTeacherProfile(null);
                }
              });
            }

            // 로그인 성공 시 백그라운드 프리페칭 실행 (교사 및 어드민만, uid당 1회)
            if (data.domain && (data.role === "super_admin" || data.role === "teacher") && prefetchedUidRef.current !== currentUser.uid) {
              prefetchedUidRef.current = currentUser.uid;
              const domain = data.domain;
              setTimeout(() => {
                // 1. OUs 로드
                fetch("/api/workspace/ou")
                  .then(res => res.ok ? res.json() : null)
                  .then(ouData => {
                    if (ouData) {
                      const units = ouData.orgUnits || [];
                      const { setClientCache } = require("@/lib/cache/clientCache");
                      setClientCache("ou:all", units);
                      setOrgUnits(units); // ← context state에도 저장 (즉시 접근 가능)
                    }
                  }).catch(() => {});

                // 2. 전체 사용자 로드 (검색 및 캐시용)
                fetch("/api/workspace/users", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "list", orgUnitPaths: ["all"] })
                })
                  .then(res => res.ok ? res.json() : null)
                  .then(uData => {
                    if (uData) {
                      const { setClientCache } = require("@/lib/cache/clientCache");
                      setClientCache("users:all", uData.users || []);
                    }
                  }).catch(() => {});

                // 3. 그룹 로드
                fetch("/api/workspace/groups", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "list", domain })
                })
                  .then(res => res.ok ? res.json() : null)
                  .then(gData => {
                    if (gData) {
                      const { setClientCache } = require("@/lib/cache/clientCache");
                      setClientCache("groups:all", gData.groups || []);
                    }
                  }).catch(() => {});

                // 4. 생활지도 권한·규정 프리페치 ( discipline:my — 교직원 전용 웜업 & 캐시 적재 )
                fetch("/api/discipline/permissions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "my" })
                })
                  .then(res => res.ok ? res.json() : null)
                  .then(dData => {
                    if (dData) {
                      const { setClientCache } = require("@/lib/cache/clientCache");
                      setClientCache("discipline:my", dData);
                    }
                  }).catch(() => {});
              }, 100);
            }
          } else {
            // Self-heal: If document is missing (e.g. previous permission error), create it now.
            handleUserRoles(currentUser).catch((error) => {
              console.error("Error creating user roles on sign in:", error);
              setLoading(false);
            });
          }
        }, (error) => {
          console.error("Error fetching user data:", error);
          setLoading(false);
        });
      } else {
        // 쿠키 만료/삭제 및 캐시 전부 삭제
        document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax";
        try {
          const { invalidateClientCache } = require("@/lib/cache/clientCache");
          invalidateClientCache();
        } catch (cacheErr) {}
        setUserData(null);
        setSchoolSettings(null);
        setOrgUnits([]);
        setTeacherProfile(null);
        prefetchedUidRef.current = null; // 재로그인 시 프리페치 다시 실행되도록
        setLoading(false);
        if (unsubscribeDoc) unsubscribeDoc();
        if (unsubscribeSettings) unsubscribeSettings();
        if (unsubscribeTeacherProfile) unsubscribeTeacherProfile();
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
      if (unsubscribeSettings) unsubscribeSettings();
      if (unsubscribeTeacherProfile) unsubscribeTeacherProfile();
    };
  }, []);

  const refreshUserData = async () => {
    if (user) {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        setUserData(snap.data() as UserData);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ user, userData, schoolSettings, orgUnits, teacherProfile, loading, refreshUserData }}>
      {children}
      {user && userData && <PolicyAckModal />}
    </AuthContext.Provider>
  );
};
