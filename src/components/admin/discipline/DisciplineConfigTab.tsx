import { useState, useEffect } from "react";
import { DisciplineConfig, DisciplineItem, DisciplineStage, DisciplineRule } from "@/lib/discipline/types";

interface DisciplineConfigTabProps {
  initialConfig: DisciplineConfig;
  onConfigUpdated: () => void;
}

export default function DisciplineConfigTab({ initialConfig, onConfigUpdated }: DisciplineConfigTabProps) {
  const [items, setItems] = useState<DisciplineItem[]>(initialConfig.items || []);
  const [stages, setStages] = useState<DisciplineStage[]>(initialConfig.stages || []);
  const [rules, setRules] = useState<DisciplineRule[]>(initialConfig.rules || []);
  const [visibility, setVisibility] = useState(initialConfig.visibility || { homeroomCanViewOtherClasses: true });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 리셋 마커 실행 모달 상태
  const [resetGrade, setResetGrade] = useState<number | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    setItems(initialConfig.items || []);
    setStages(initialConfig.stages || []);
    setRules(initialConfig.rules || []);
    setVisibility(initialConfig.visibility || { homeroomCanViewOtherClasses: true });
    setHasUnsavedChanges(false);
  }, [initialConfig]);

  const markDirty = () => setHasUnsavedChanges(true);

  // 1. 규정 저장 (Update API)
  const saveConfig = async (): Promise<boolean> => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/discipline/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          // 서버 계약: 규정 본문은 config 객체로 감싸 전달 (resetMarkers는 전송 불가 — 서버가 보존)
          config: { items, stages, rules, visibility },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "규정 저장에 실패했습니다.");
      }

      setHasUnsavedChanges(false);
      setMessage({ type: "success", text: "규정이 성공적으로 저장되었습니다." });
      onConfigUpdated();
      return true;
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "오류가 발생했습니다." });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 2. 학년별 리셋 마커 실행 (자동 저장 후 실행 UX)
  const handleExecuteResetGrade = async () => {
    if (!resetGrade) return;

    setResetLoading(true);
    setMessage(null);
    try {
      // 💡 6a-2 교훈 반영: 미저장 수정사항이 있다면 자동 저장 후 리셋 진행
      if (hasUnsavedChanges) {
        setMessage({ type: "success", text: "미저장 규정 변경사항을 먼저 자동 저장합니다..." });
        const saved = await saveConfig();
        if (!saved) return;
      }

      const res = await fetch("/api/discipline/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_grade",
          grade: resetGrade,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "학년 회차 리셋 실패");
      }

      setMessage({
        type: "success",
        text: `${resetGrade}학년 회차가 성공적으로 리셋되었습니다. (이후 입력분부터 다시 집계)`,
      });

      setResetGrade(null);
      onConfigUpdated();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "리셋 실행 중 오류 발생" });
    } finally {
      setResetLoading(false);
    }
  };

  // ── 아이템 조작 ──────────────────────────────────────────
  const addItem = () => {
    const newItem: DisciplineItem = {
      id: `item_${Date.now()}`,
      label: "새 지도 항목",
      category: "생활지도",
      active: true,
    };
    setItems([...items, newItem]);
    markDirty();
  };

  const updateItem = (id: string, key: keyof DisciplineItem, value: any) => {
    setItems(items.map((it) => (it.id === id ? { ...it, [key]: value } : it)));
    markDirty();
  };

  // ── 단계 조작 ──────────────────────────────────────────
  const addStage = () => {
    const nextOrder = (stages.reduce((max, s) => Math.max(max, s.order || 0), 0) || 0) + 1;
    const newStage: DisciplineStage = {
      id: `stage_${Date.now()}`,
      order: nextOrder,
      label: `${nextOrder}단계`,
    };
    setStages([...stages, newStage]);
    markDirty();
  };

  const updateStage = (id: string, key: keyof DisciplineStage, value: any) => {
    setStages(stages.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
    markDirty();
  };

  // ── 규칙 조작 ──────────────────────────────────────────
  const addRule = () => {
    const defaultStage = stages[0]?.id || "";
    const defaultItem = items[0]?.id || "";
    const newRule: DisciplineRule = {
      id: `rule_${Date.now()}`,
      trigger: {
        itemId: defaultItem,
        countThreshold: 3,
      },
      targetStageId: defaultStage,
    };
    setRules([...rules, newRule]);
    markDirty();
  };

  const updateRule = (id: string, updater: (r: DisciplineRule) => DisciplineRule) => {
    setRules(rules.map((r) => (r.id === id ? updater(r) : r)));
    markDirty();
  };

  const deleteRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
    markDirty();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Top Banner & Action */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            ⚙️ 생활지도 규정 및 단계 매핑 편집기
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            학교 생활지도 항목, 단계 순서, n회차 도달 시 자동 단계 매핑 규칙을 설정합니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {hasUnsavedChanges && (
            <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-md animate-pulse border border-amber-200 dark:border-amber-800">
              ⚠️ 미저장 변경사항 있음
            </span>
          )}

          <button
            onClick={() => saveConfig()}
            disabled={saving || !hasUnsavedChanges}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center space-x-2"
          >
            {saving ? (
              <span>저장 중...</span>
            ) : (
              <span>💾 규정 저장</span>
            )}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm font-medium ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 1. 지도 항목(Items) 설정 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">1. 지도 항목 목록</h3>
            <p className="text-xs text-gray-500">기록 시 선택할 생활지도 항목입니다.</p>
          </div>
          <button
            onClick={addItem}
            className="text-xs font-bold px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg"
          >
            ➕ 항목 추가
          </button>
        </div>

        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <input
                type="text"
                value={it.label}
                onChange={(e) => updateItem(it.id, "label", e.target.value)}
                placeholder="항목 이름 (예: 사복 착용)"
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <input
                type="text"
                value={it.category}
                onChange={(e) => updateItem(it.id, "category", e.target.value)}
                placeholder="분류 (예: 생활지도, 선도)"
                className="w-36 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <label className="flex items-center space-x-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={it.active !== false}
                  onChange={(e) => updateItem(it.id, "active", e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>활성</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* 2. 지도 단계(Stages) 설정 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">2. 지도 단계 정의</h3>
            <p className="text-xs text-gray-500">조치 단계를 순서대로 등록합니다. 단계 순서가 클수록 상위 단계입니다.</p>
          </div>
          <button
            onClick={addStage}
            className="text-xs font-bold px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg"
          >
            ➕ 단계 추가
          </button>
        </div>

        <div className="space-y-2">
          {stages.map((st) => (
            <div
              key={st.id}
              className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <span className="text-xs font-bold text-gray-500 w-12">순서:</span>
              <input
                type="number"
                value={st.order}
                onChange={(e) => updateStage(st.id, "order", parseInt(e.target.value, 10) || 1)}
                className="w-16 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-bold"
              />
              <input
                type="text"
                value={st.label}
                onChange={(e) => updateStage(st.id, "label", e.target.value)}
                placeholder="단계 이름 (예: 담임 지도)"
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 3. 자동 규칙(Rules) 매핑 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">3. 자동 단계 도달 규칙</h3>
            <p className="text-xs text-gray-500">특정 항목 또는 카테고리 누적 n회 도달 시 지정된 단계로 자동 진입합니다.</p>
          </div>
          <button
            onClick={addRule}
            className="text-xs font-bold px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg"
          >
            ➕ 규칙 추가
          </button>
        </div>

        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="p-4 bg-gray-50 dark:bg-gray-900/30 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <span className="font-bold text-blue-600 dark:text-blue-400">조건:</span>
                
                {/* Trigger 타겟 선택 (Item vs Category) */}
                <select
                  value={rule.trigger.itemId ? `item:${rule.trigger.itemId}` : `cat:${rule.trigger.category}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateRule(rule.id, (r) => {
                      if (val.startsWith("item:")) {
                        return { ...r, trigger: { ...r.trigger, itemId: val.replace("item:", ""), category: undefined } };
                      } else {
                        return { ...r, trigger: { ...r.trigger, category: val.replace("cat:", ""), itemId: undefined } };
                      }
                    });
                  }}
                  className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                >
                  <optgroup label="특정 항목">
                    {items.map((it) => (
                      <option key={it.id} value={`item:${it.id}`}>
                        [항목] {it.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="카테고리 전체">
                    {Array.from(new Set(items.map((it) => it.category || "생활지도"))).map((cat) => (
                      <option key={cat} value={`cat:${cat}`}>
                        [카테고리] {cat}
                      </option>
                    ))}
                  </optgroup>
                </select>

                <span>누적</span>
                <input
                  type="number"
                  value={rule.trigger.countThreshold}
                  onChange={(e) => {
                    const cnt = parseInt(e.target.value, 10) || 1;
                    updateRule(rule.id, (r) => ({ ...r, trigger: { ...r.trigger, countThreshold: cnt } }));
                  }}
                  className="w-16 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm text-center font-bold bg-white dark:bg-gray-700"
                />
                <span>회 도달 시 &rarr;</span>

                <span className="font-bold text-blue-600 dark:text-blue-400">결과 단계:</span>
                <select
                  value={rule.targetStageId}
                  onChange={(e) => {
                    const stId = e.target.value;
                    updateRule(rule.id, (r) => ({ ...r, targetStageId: stId }));
                  }}
                  className="p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm font-bold"
                >
                  {stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      [{st.order}단계] {st.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => deleteRule(rule.id)}
                className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium self-end md:self-auto"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 4. 타반 열람 권한 & 기타 설정 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
        <h3 className="text-base font-bold text-gray-900 dark:text-white">4. 열람 정책 설정</h3>
        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={visibility.homeroomCanViewOtherClasses}
            onChange={(e) => {
              setVisibility({ homeroomCanViewOtherClasses: e.target.checked });
              markDirty();
            }}
            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            담임 교사가 타반 학생의 지도 기록도 열람(View)할 수 있도록 허용 (기록 입력은 자기 반만 가능)
          </span>
        </label>
      </div>

      {/* 5. 학년별 회차 리셋 마커 (자동 저장 후 실행 UX 적용) */}
      <div className="bg-amber-50/50 dark:bg-amber-900/10 p-6 rounded-xl border border-amber-200 dark:border-amber-800 space-y-4">
        <div>
          <h3 className="text-base font-bold text-amber-900 dark:text-amber-300 flex items-center space-x-2">
            <span>🔄 학년별 회차 리셋</span>
          </h3>
          <p className="text-xs text-amber-800 dark:text-amber-400 mt-1">
            새 학기 또는 학학년 초기화 시 해당 학년의 회차 누적을 0부터 다시 시작합니다. (과거 지도 기록 데이터 자체는 삭제되지 않습니다)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {[1, 2, 3].map((g) => {
            const markerTS = (initialConfig.resetMarkers || {})[g.toString()];
            const markerStr = markerTS ? new Date(markerTS).toLocaleString("ko-KR") : "설정 안 됨 (최초)";
            return (
              <div
                key={g}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-amber-200 dark:border-amber-800 flex-1 min-w-[200px] flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white">{g}학년 리셋 마커</div>
                  <div className="text-xs text-gray-500 mt-0.5">{markerStr}</div>
                </div>
                <button
                  onClick={() => setResetGrade(g)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-sm"
                >
                  리셋 실행
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 학년 리셋 Confirm 모달 (자동 저장 후 실행 UX 적용) */}
      {resetGrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              ⚠️ {resetGrade}학년 회차 리셋 확인
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {resetGrade}학년 학생들의 회차 계산 기준 시점을 현재 시간으로 갱신합니다. 기존 기록은 삭제되지 않으며 이후 발생하는 기록부터 다시 카운트됩니다.
            </p>

            {hasUnsavedChanges && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs font-bold rounded-lg">
                💡 미저장 상태인 규정 변경사항이 있습니다. 리셋 실행 시 규정이 자동으로 함께 저장됩니다.
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setResetGrade(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleExecuteResetGrade}
                disabled={resetLoading}
                className="px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow disabled:opacity-50"
              >
                {resetLoading ? "리셋 처리 중..." : "자동 저장 후 리셋 실행"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
