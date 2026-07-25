import { useState, useEffect } from "react";

/**
 * 담임 현황 (읽기 전용)
 *
 * 담임 정보의 단일 원본은 승인된 교직원 프로필(조직 정보 신청 → 수퍼어드민 승인)이다.
 * 이 화면은 그 데이터를 학년·반 순으로 모아 보여주기만 하며, 여기서 편집하지 않는다.
 * (별도 담임 배정표 편집은 2026-07-25 베이스 데이터 중복 제거로 폐기)
 */

interface HomeroomEntry {
  grade: number;
  classNum: number;
  email: string;
  name: string;
}

interface HomeroomAssignmentTabProps {
  domain: string;
}

export default function HomeroomAssignmentTab({ domain: _domain }: HomeroomAssignmentTabProps) {
  const [entries, setEntries] = useState<HomeroomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHomeroom = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_homeroom" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "담임 현황을 불러오지 못했습니다.");
      }
      setEntries(data.entries || []);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHomeroom();
  }, []);

  const grades = [1, 2, 3];
  // 같은 반에 복수 담임(공동담임)이 있을 수 있으므로 반 키로 그룹화
  const byClass = new Map<string, HomeroomEntry[]>();
  for (const e of entries) {
    const key = `${e.grade}-${e.classNum}`;
    const arr = byClass.get(key) || [];
    arr.push(e);
    byClass.set(key, arr);
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">🏫 학급 담임 현황 (읽기 전용)</h2>
          <p className="text-sm text-gray-500">
            승인된 교직원 프로필(조직도)에서 자동으로 가져온 담임 정보입니다. 담임 교사에게는
            자기 반 학생의 생활지도 기록 작성·열람 권한이 자동 부여됩니다.
          </p>
        </div>
        <button
          onClick={fetchHomeroom}
          className="p-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 self-start md:self-auto"
        >
          🔄 새로고침
        </button>
      </div>

      {/* 변경 경로 안내 */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900">
        ✏️ <strong>담임을 바꾸려면?</strong> 이 화면에서는 편집하지 않습니다. 해당 교사가{" "}
        <strong>프로필 카드의 [조직 정보 신청]</strong>에서 담임 학년·반을 제출하고, 수퍼어드민이{" "}
        <strong>[프로필 승인 대기]</strong>에서 승인하면 즉시 여기와 생활지도 권한에 반영됩니다.
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-500">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          담임 현황을 불러오는 중...
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 text-red-700 rounded-xl border border-red-200 text-center">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-white rounded-xl border border-gray-100 space-y-2">
          <div className="text-3xl">📭</div>
          <p className="font-medium">승인된 담임 프로필이 아직 없습니다.</p>
          <p className="text-xs">
            담임 선생님들에게 [조직 정보 신청]에서 담임 반을 제출하도록 안내하고, 프로필 승인 대기에서 승인해 주세요.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grades.map((grade) => {
            const gradeEntries = entries.filter((e) => e.grade === grade);
            return (
              <div
                key={grade}
                className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4"
              >
                <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-3 flex items-center justify-between">
                  <span>{grade}학년 담임</span>
                  <span className="text-xs font-normal text-gray-500">{gradeEntries.length}명</span>
                </h3>

                {gradeEntries.length === 0 ? (
                  <p className="text-sm text-gray-400">승인된 담임이 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from(new Set(gradeEntries.map((e) => e.classNum)))
                      .sort((a, b) => a - b)
                      .map((classNum) => {
                        const classTeachers = byClass.get(`${grade}-${classNum}`) || [];
                        return (
                          <div
                            key={classNum}
                            className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between"
                          >
                            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-1 rounded">
                              {grade}학년 {classNum}반
                            </span>
                            <div className="text-right">
                              {classTeachers.map((t) => (
                                <div key={t.email}>
                                  <span className="text-sm font-bold text-gray-900">{t.name || t.email}</span>
                                  <span className="block text-[11px] text-gray-500">{t.email}</span>
                                </div>
                              ))}
                              {classTeachers.length > 1 && (
                                <span className="text-[10px] text-amber-600 font-bold">공동담임 {classTeachers.length}명</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
