"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { TimetableSettings, TimetableTerm } from "@/lib/timetable/types";

export function useTimetableSettings() {
  const { userData } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";

  const [settings, setSettings] = useState<TimetableSettings | null>(null);
  const [terms, setTerms] = useState<TimetableTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettingsAndTerms = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      if (!forceRefresh) {
        const cached = getClientCache("timetable:settings");
        if (cached) {
          setSettings(cached.settings);
          setTerms(cached.terms);
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      });

      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || null);
        setTerms(data.terms || []);
        setClientCache("timetable:settings", { settings: data.settings, terms: data.terms });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "시간표 정보를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndTerms();
  }, []);

  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);
  const isObserver =
    !isManager && (settings?.observerEmails || []).some((m) => m.toLowerCase() === userEmail);

  const periodsPerDay = settings?.periodsPerDay || 7;
  const activeTermId = settings?.activeTermId || null;

  return {
    settings,
    terms,
    loading,
    error,
    isManager,
    isObserver,
    periodsPerDay,
    activeTermId,
    refreshSettings: () => fetchSettingsAndTerms(true),
  };
}
