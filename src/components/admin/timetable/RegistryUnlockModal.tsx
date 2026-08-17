"use client";

import { useEffect, useState } from "react";

export function getStoredUnlockReason(termId?: string | null): string {
  if (typeof window === "undefined" || !termId) return "";
  try {
    return sessionStorage.getItem(`registry_unlock_reason_${termId}`) || "";
  } catch {
    return "";
  }
}

export function setStoredUnlockReason(termId: string | null | undefined, reason: string): void {
  if (typeof window === "undefined" || !termId) return;
  try {
    const trimmed = reason.trim();
    if (trimmed) {
      sessionStorage.setItem(`registry_unlock_reason_${termId}`, trimmed);
    } else {
      sessionStorage.removeItem(`registry_unlock_reason_${termId}`);
    }
  } catch {}
}

export function clearStoredUnlockReason(termId?: string | null): void {
  if (typeof window === "undefined" || !termId) return;
  try {
    sessionStorage.removeItem(`registry_unlock_reason_${termId}`);
  } catch {}
}

interface RegistryUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  termId?: string | null;
  loading?: boolean;
}

export default function RegistryUnlockModal({
  isOpen,
  onClose,
  onConfirm,
  termId,
  loading = false,
}: RegistryUnlockModalProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (isOpen) {
      const stored = getStoredUnlockReason(termId);
      setReason(stored);
    }
  }, [isOpen, termId]);

  if (!isOpen) return null;

  const trimmed = reason.trim();
  const isValid = trimmed.length >= 2 && trimmed.length <= 200;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;
    setStoredUnlockReason(termId, trimmed);
    await onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>🔒</span>
            <span>편성 등록부 잠금 해제</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 font-bold hover:text-gray-600 p-1"
          >
            ✕
          </button>
        </div>

        {/* 안내 문구 (스펙 §4 확정 문안) */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 leading-relaxed space-y-1">
          <p>
            운영 중인 학기의 편성 등록 내용은 잠겨 있습니다. 이미 승인된 교체·이동의 판정 근거가 되기 때문입니다. 꼭 고쳐야 하면 사유를 입력하고 잠금을 해제해 주세요.
          </p>
        </div>

        {/* 해제 경고 (스펙 §4 ⓑ 확정 문안) */}
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 text-xs text-amber-950 leading-relaxed flex items-start gap-2">
          <span className="text-base leading-none">⚠️</span>
          <p className="font-semibold">
            이 변경은 이미 확정된 교체의 판정 근거를 바꿉니다. 변경 내용과 사유는 작업 기록에 남습니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              해제 사유 입력 <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 1학년 과학 이동수업 분반 추가, 특별실 위치 조정 등"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none"
              disabled={loading}
              autoFocus
            />
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span className={trimmed.length > 0 && !isValid ? "text-red-600 font-semibold" : "text-gray-400"}>
                {trimmed.length === 0
                  ? "사유를 2자 이상 200자 이하로 입력해 주세요."
                  : trimmed.length < 2
                  ? "사유가 너무 짧습니다 (최소 2자)."
                  : trimmed.length > 200
                  ? "사유가 너무 깁니다 (최대 200자)."
                  : "올바른 사유입니다."}
              </span>
              <span className={`font-mono ${trimmed.length > 200 ? "text-red-600 font-bold" : "text-gray-500"}`}>
                {trimmed.length} / 200자
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!isValid || loading}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
            >
              {loading && <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />}
              <span>🔓 잠금 해제 및 반영</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
