"use client";

import { useEffect, useState, useCallback } from "react";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";

export type GradeClassesMap = Record<number, number[]>;

// 반환 배열은 참조 안정성이 필수 — 소비자 useEffect 의존성으로 쓰이므로
// 매 렌더 새 배열을 만들면 무한 재실행(fetch 루프)이 된다. 모듈 상수로 고정한다.
const FALLBACK_CLASS_LIST: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EMPTY_CLASS_LIST: readonly number[] = [];

const DEFAULT_FALLBACK_CLASSES: GradeClassesMap = {
  1: [...FALLBACK_CLASS_LIST],
  2: [...FALLBACK_CLASS_LIST],
  3: [...FALLBACK_CLASS_LIST],
};

export interface UseAvailableClassesOptions {
  /** 데이터가 비어있을 때(가져오기 전 초안 등) 1~12반으로 폴백할지 여부 (기본값: false) */
  fallbackOnEmpty?: boolean;
}

export function useAvailableClasses(
  termId?: string | null,
  options?: UseAvailableClassesOptions
) {
  const [classesByGrade, setClassesByGrade] = useState<GradeClassesMap>({});
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkErrorFallback, setIsNetworkErrorFallback] = useState<boolean>(false);

  const fallbackOnEmpty = options?.fallbackOnEmpty ?? false;

  const fetchClasses = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      setIsNetworkErrorFallback(false);

      const cacheKey = `timetable:classes:${termId || "active"}`;

      if (!forceRefresh) {
        const cached = getClientCache(cacheKey);
        if (cached) {
          setClassesByGrade(cached.classesByGrade || {});
          setTermMeta(cached.termMeta || null);
          setLoading(false);
          return;
        }
      }

      try {
        const res = await fetch("/api/timetable/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "classes",
            termId: termId || undefined,
          }),
        });

        if (res.ok) {
          const result = await res.json();
          const data: GradeClassesMap = result.data || {};
          setClassesByGrade(data);
          setTermMeta(result.term || null);
          setClientCache(cacheKey, { classesByGrade: data, termMeta: result.term || null });
        } else {
          const errData = await res.json().catch(() => ({}));
          setError(errData.error || "실존 학년·반 목록을 불러오지 못했습니다.");
          setClassesByGrade(DEFAULT_FALLBACK_CLASSES);
          setIsNetworkErrorFallback(true);
        }
      } catch (err: any) {
        setError(`네트워크 오류: ${err.message}`);
        setClassesByGrade(DEFAULT_FALLBACK_CLASSES);
        setIsNetworkErrorFallback(true);
      } finally {
        setLoading(false);
      }
    },
    [termId]
  );

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const getClassesForGrade = useCallback(
    (grade: number, customFallbackOnEmpty?: boolean): number[] => {
      const list = classesByGrade[grade];
      if (isNetworkErrorFallback) {
        return (list as number[]) || (FALLBACK_CLASS_LIST as number[]);
      }

      const shouldFallback =
        customFallbackOnEmpty !== undefined ? customFallbackOnEmpty : fallbackOnEmpty;

      if (!list || list.length === 0) {
        return shouldFallback
          ? (FALLBACK_CLASS_LIST as number[])
          : (EMPTY_CLASS_LIST as number[]);
      }

      // state에 담긴 배열을 그대로 반환 (참조 안정) — 호출부는 이 배열을 변형하지 말 것
      return list;
    },
    [classesByGrade, isNetworkErrorFallback, fallbackOnEmpty]
  );

  return {
    classesByGrade,
    termMeta,
    loading,
    error,
    getClassesForGrade,
    refresh: () => fetchClasses(true),
  };
}
