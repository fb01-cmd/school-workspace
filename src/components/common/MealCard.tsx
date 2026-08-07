"use client";

import { useEffect, useState } from "react";

interface Dish {
  name: string;
  allergyCodes: string;
}

interface MealDay {
  date: string; // YYYY-MM-DD
  mealName: string;
  dishes: Dish[];
  calories?: string;
}

const DAY_LABELS: Record<number, string> = {
  0: "일",
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
};

export default function MealCard() {
  const [meals, setMeals] = useState<MealDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // KST 오늘 날짜 (YYYY-MM-DD)
  const todayStr = (() => {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  })();

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const fetchMeals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        const mealList: MealDay[] = data.meals || [];
        setMeals(mealList);
        if (mealList.length > 0) {
          // 오늘 날짜 식단이 있으면 선택, 없으면 첫 번째 식단 선택
          const hasToday = mealList.some((m) => m.date === todayStr);
          if (hasToday) {
            setSelectedDate(todayStr);
          } else {
            setSelectedDate(mealList[0].date);
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "급식 정보를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeals();
  }, []);

  const selectedMeal = meals.find((m) => m.date === selectedDate);

  // 선택된 날짜의 요일 계산
  const getDayLabel = (dateStr: string) => {
    const parts = dateStr.split("-").map(Number);
    if (parts.length < 3) return "";
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return DAY_LABELS[d.getDay()] || "";
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 flex flex-col justify-between">
      <div>
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                나이스 연동
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                효명고 식단표
              </span>
            </div>
            <h3 className="text-base font-black text-slate-900 mt-1 flex items-center gap-2">
              <span>🍱 오늘의 급식</span>
            </h3>
          </div>

          <button
            onClick={fetchMeals}
            disabled={loading}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
          >
            🔄 새로고침
          </button>
        </div>

        {/* 날짜 선택 탭 (주간 탭) */}
        {meals.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto py-2 border-b border-slate-100">
            {meals.map((m) => {
              const dayNum = m.date.slice(8, 10);
              const dayLbl = getDayLabel(m.date);
              const isToday = m.date === todayStr;
              const isSelected = m.date === selectedDate;

              return (
                <button
                  key={m.date}
                  type="button"
                  onClick={() => setSelectedDate(m.date)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center min-w-[3rem] ${
                    isSelected
                      ? "bg-amber-500 text-white shadow-xs"
                      : isToday
                      ? "bg-amber-50 text-amber-900 border border-amber-200"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <span className="text-[10px] opacity-80">{dayLbl}</span>
                  <span className="text-sm font-black">{dayNum}일</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 식단 내용 표시 */}
        <div className="mt-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500 font-semibold space-y-2">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-amber-500 border-t-transparent" />
              <p>나이스에서 급식 정보를 불러오는 중입니다...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 text-center">
              {error}
            </div>
          ) : !selectedMeal || selectedMeal.dishes.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 space-y-1 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-2xl">🍽️</span>
              <p className="font-bold text-slate-600">등록된 급식 식단이 없습니다.</p>
              <p className="text-[11px] text-slate-400">주말 또는 휴업일에는 급식이 제공되지 않습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-amber-50/80 border border-amber-200/80 px-3.5 py-2 rounded-xl text-xs">
                <span className="font-extrabold text-amber-950 flex items-center gap-1.5">
                  <span>🍚 {selectedMeal.mealName || "중식"}</span>
                  <span className="text-[11px] font-normal text-amber-800">
                    ({selectedMeal.date} {getDayLabel(selectedMeal.date)}요일)
                  </span>
                </span>
                {selectedMeal.calories && (
                  <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full">
                    🔥 {selectedMeal.calories}
                  </span>
                )}
              </div>

              {/* 반찬 메뉴 리스트 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selectedMeal.dishes.map((dish, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs flex items-center justify-between"
                  >
                    <span className="font-bold text-slate-800">{dish.name}</span>
                    {dish.allergyCodes && (
                      <span
                        className="text-[9px] text-slate-400 font-medium px-1.5 py-0.5 bg-white rounded border border-slate-200"
                        title={`알레르기 정보: ${dish.allergyCodes}`}
                      >
                        알레르기 {dish.allergyCodes}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-right">
        출처: 나이스 교육정보 개방 포털 (효명고등학교)
      </div>
    </div>
  );
}
