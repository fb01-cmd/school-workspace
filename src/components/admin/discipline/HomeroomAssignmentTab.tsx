import { useState, useEffect } from "react";

/**
 * 담임 현황 (읽기 전용 파생 뷰)
 *
 * 담임 정보의 단일 원본은 승인된 교직원 프로필(조직 정보 신청 → 수퍼어드민 승인)입니다.
 * 이 화면은 그 데이터를 학년·반 순으로 모아 보여주며, 다른 생활지도 탭과 동일한 디자인 톤으로 다듬어졌습니다.
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
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState<"all" | 1 | 2 | 3>("all");

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

  const grades = [1, 2, 3] as const;

  // 반 키(`${grade}-${classNum}`)로 그룹화
  const byClass = new Map<string, HomeroomEntry[]>();
  for (const e of entries) {
    const key = `${e.grade}-${e.classNum}`;
    const arr = byClass.get(key) || [];
    arr.push(e);
    byClass.set(key, arr);
  }

  // 검색 필터링
  const filteredEntries = entries.filter((e) => {
    if (gradeFilter !== "all" && e.grade !== gradeFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      `${e.grade}학년`.includes(q) ||
      `${e.classNum}반`.includes(q) ||
      `${e.grade}-${e.classNum}`.includes(q)
    );
  });

  // KPI 통계 계산
  const totalTeachers = entries.length;
  const totalAssignedClasses = byClass.size;
  const coHomeroomCount = Array.from(byClass.values()).filter((arr) => arr.length > 1).length;

  // 학년별 테마 색상 설정
  const getGradeTheme = (grade: number) => {
    switch (grade) {
      case 1:
        return {
          badgeBg: "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
          accentColor: "bg-indigo-600",
          cardBorder: "border-indigo-100 dark:border-indigo-900/50",
          headerBg: "from-indigo-50/80 to-white dark:from-indigo-950/30 dark:to-gray-800",
          tagBg: "bg-indigo-600 text-white",
          avatarBg: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200",
        };
      case 2:
        return {
          badgeBg: "bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
          accentColor: "bg-purple-600",
          cardBorder: "border-purple-100 dark:border-purple-900/50",
          headerBg: "from-purple-50/80 to-white dark:from-purple-950/30 dark:to-gray-800",
          tagBg: "bg-purple-600 text-white",
          avatarBg: "bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-200",
        };
      case 3:
        return {
          badgeBg: "bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800",
          accentColor: "bg-teal-600",
          cardBorder: "border-teal-100 dark:border-teal-900/50",
          headerBg: "from-teal-50/80 to-white dark:from-teal-950/30 dark:to-gray-800",
          tagBg: "bg-teal-600 text-white",
          avatarBg: "bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-200",
        };
      default:
        return {
          badgeBg: "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600",
          accentColor: "bg-gray-600",
          cardBorder: "border-gray-200 dark:border-gray-700",
          headerBg: "from-gray-50 to-white dark:from-gray-800 dark:to-gray-800",
          tagBg: "bg-gray-600 text-white",
          avatarBg: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
        };
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. 상단 헤더 배너 */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-4 -mr-4 w-48 h-48 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5 mb-1.5">
              <span className="text-2xl">🏫</span>
              <h2 className="text-xl font-bold text-white tracking-tight">학급 담임 현황 (읽기 전용)</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/30 text-blue-200 border border-blue-400/30 backdrop-blur-sm">
                조직도 단일 원본 연동
              </span>
            </div>
            <p className="text-sm text-blue-100/80 max-w-2xl leading-relaxed">
              승인된 교직원 프로필에서 자동으로 추출된 학급 담임 목록입니다. 담임 교사는 담당 학급 학생들의 생활지도 기록 작성 및 지도 이력 열람 권한을 자동으로 보유합니다.
            </p>
          </div>
          <button
            onClick={fetchHomeroom}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 active:bg-white/25 text-white text-sm font-medium rounded-xl border border-white/20 transition-all shadow-sm backdrop-blur-md self-start md:self-auto disabled:opacity-50"
          >
            <span className={loading ? "animate-spin" : ""}>🔄</span>
            <span>{loading ? "불러오는 중..." : "현황 새로고침"}</span>
          </button>
        </div>
      </div>

      {/* 2. 변경 경로 안내 카피 / 배너 */}
      <div className="p-4 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-xl text-sm text-amber-900 dark:text-amber-200 flex items-start space-x-3 shadow-xs">
        <span className="text-lg leading-none mt-0.5">💡</span>
        <div className="space-y-1">
          <p className="font-semibold text-amber-950 dark:text-amber-100">
            담임 교사 변경 및 배정 수정 안내
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-normal">
            담임 정보를 변경하려면 교사가 <strong>[마이페이지 → 조직 정보 신청]</strong>에서 학년·반을 변경 제출하고, 수퍼어드민이 <strong>[프로필 승인 대기]</strong>에서 승인하면 이곳 및 생활지도 권한에 즉시 반영됩니다.
          </p>
        </div>
      </div>

      {/* 3. 주요 요약 KPI 카운터 카드 (4종) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200/80 dark:border-gray-700 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">총 승인 담임 교사</p>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl font-black text-gray-900 dark:text-white">{totalTeachers}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">명</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200/80 dark:border-gray-700 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">담임 배정 학급</p>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{totalAssignedClasses}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">개 반</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200/80 dark:border-gray-700 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">공동담임 학급</p>
          <div className="flex items-baseline space-x-1.5">
            <span className={`text-2xl font-black ${coHomeroomCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
              {coHomeroomCount}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">개 반</span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200/80 dark:border-gray-700 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">조회 중인 담임 건수</p>
          <div className="flex items-baseline space-x-1.5">
            <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{filteredEntries.length}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">건</span>
          </div>
        </div>
      </div>

      {/* 4. 컨트롤 바 (학년 필터 + 검색창) */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* 학년 탭 버튼 */}
        <div className="flex items-center space-x-1 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setGradeFilter("all")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              gradeFilter === "all"
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 shadow-xs"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            전체 학년
          </button>
          {grades.map((g) => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                gradeFilter === g
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
              }`}
            >
              {g}학년
            </button>
          ))}
        </div>

        {/* 검색창 */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="교사 이름, 이메일, 반 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-3 top-2 text-gray-400 text-xs">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 5. 로딩 / 에러 / 데이터 없음 / 본문 Grid */}
      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm font-medium">담임 현황 데이터를 조회하는 중입니다...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center text-sm font-medium">
          ⚠️ {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs space-y-3">
          <div className="text-4xl">📭</div>
          <p className="font-bold text-gray-800 dark:text-gray-200 text-base">승인된 담임 프로필이 아직 없습니다</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
            담임 교사들이 [마이페이지 → 조직 정보 신청]에서 학급 담임 정보를 제출하면, 수퍼어드민 승인 후 자동으로 이곳에 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grades
            .filter((g) => gradeFilter === "all" || gradeFilter === g)
            .map((grade) => {
              const theme = getGradeTheme(grade);

              // 이 학년에 배정된 반 번호 목록 (또는 기본 1~12반)
              const assignedClassNums = Array.from(
                new Set(entries.filter((e) => e.grade === grade).map((e) => e.classNum))
              ).sort((a, b) => a - b);

              // 최대 반 번호 계산 (최소 10반 이상 표시)
              const maxClassNum = Math.max(10, ...assignedClassNums, 0);
              const displayClasses = Array.from({ length: maxClassNum }, (_, i) => i + 1);

              return (
                <div
                  key={grade}
                  className={`bg-white dark:bg-gray-800 rounded-2xl border ${theme.cardBorder} shadow-xs overflow-hidden transition-all`}
                >
                  {/* 학년 헤더 */}
                  <div className={`bg-gradient-to-r ${theme.headerBg} px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between`}>
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${theme.accentColor}`} />
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                        {grade}학년 담임 현황
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${theme.badgeBg}`}>
                        {assignedClassNums.length}개 반 배정 완료
                      </span>
                    </div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      총 {entries.filter((e) => e.grade === grade).length}명 등록됨
                    </span>
                  </div>

                  {/* 학급 카드 그리드 */}
                  <div className="p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {displayClasses.map((classNum) => {
                        const classTeachers = byClass.get(`${grade}-${classNum}`) || [];
                        const isMatchedBySearch =
                          !searchQuery.trim() ||
                          classTeachers.some((t) =>
                            t.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
                            t.email.toLowerCase().includes(searchQuery.toLowerCase().trim())
                          ) ||
                          `${grade}-${classNum}`.includes(searchQuery.trim()) ||
                          `${classNum}반`.includes(searchQuery.trim());

                        if (searchQuery.trim() && !isMatchedBySearch) return null;

                        const isAssigned = classTeachers.length > 0;
                        const isCoHomeroom = classTeachers.length > 1;

                        return (
                          <div
                            key={classNum}
                            className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                              isAssigned
                                ? isCoHomeroom
                                  ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60 shadow-2xs"
                                  : "bg-gray-50/60 dark:bg-gray-900/40 border-gray-200/90 dark:border-gray-700/80 hover:border-gray-300 dark:hover:border-gray-600 shadow-2xs"
                                : "bg-gray-50/20 dark:bg-gray-900/20 border-dashed border-gray-200 dark:border-gray-800 opacity-60"
                            }`}
                          >
                            {/* 클래스 배지 및 라벨 */}
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-bold px-2.5 py-1 rounded-md shadow-2xs ${
                                  isAssigned ? theme.tagBg : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                                }`}
                              >
                                {grade}-{classNum}반
                              </span>
                              {isCoHomeroom ? (
                                <span className="text-[10px] font-extrabold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700">
                                  👥 공동담임 ({classTeachers.length}명)
                                </span>
                              ) : !isAssigned ? (
                                <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                                  미배정
                                </span>
                              ) : null}
                            </div>

                            {/* 담임 교사 정보 */}
                            {isAssigned ? (
                              <div className="space-y-2.5">
                                {classTeachers.map((teacher) => {
                                  const initial = teacher.name ? teacher.name[0] : teacher.email[0].toUpperCase();
                                  return (
                                    <div key={teacher.email} className="flex items-center space-x-2.5">
                                      <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${theme.avatarBg}`}
                                      >
                                        {initial}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate leading-tight">
                                          {teacher.name || "이름 미설정"}
                                        </p>
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                          {teacher.email}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="py-2 text-center">
                                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                                  배정된 담임 없음
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
