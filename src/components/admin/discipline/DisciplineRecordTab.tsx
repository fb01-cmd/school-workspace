import { useState, useEffect } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { DisciplineItem, DisciplineGrant } from "@/lib/discipline/types";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";

interface HomeroomStudent {
  email: string;
  name: string;
  studentId: string;
  numStr: string;
  label: string;
}

interface UserPermissions {
  role?: string;
  email?: string;
  canView?: boolean;
  canRecord?: boolean;
  canResolve?: boolean;
  canManageRules?: boolean;
  canManagePermissions?: boolean;
  isHomeroom?: boolean;
  // 서버(permissions my)는 { grade, classNum } 객체 배열을 반환한다 — 문자열 가정 금지
  homeroomClasses?: Array<{ grade: number; classNum: number } | string>;
  grants?: DisciplineGrant[];
  myGrants?: DisciplineGrant[];
}

interface DisciplineRecordTabProps {
  domain: string;
  configItems: DisciplineItem[];
  permissions?: UserPermissions | null;
}

export default function DisciplineRecordTab({
  domain,
  configItems,
  permissions,
}: DisciplineRecordTabProps) {
  const [studentInput, setStudentInput] = useState("");
  const [selectedStudentEmail, setSelectedStudentEmail] = useState("");
  const [selectedStudentName, setSelectedStudentName] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(""); // 학번 5자리 (명단 familyName 원본)
  const [selectedHomeroomEmail, setSelectedHomeroomEmail] = useState("");

  // KST 오늘 날짜 (YYYY-MM-DD)
  const getTodayKSTStr = () => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  };

  const [occurredDateStr, setOccurredDateStr] = useState(getTodayKSTStr);
  const [note, setNote] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 우리 반 학생 목록 & 권한 상태
  const [homeroomStudents, setHomeroomStudents] = useState<HomeroomStudent[]>([]);
  const [loadingHomeroom, setLoadingHomeroom] = useState(false);

  // 서버 응답의 객체 배열을 정규화 (방어적으로 문자열 형태도 허용)
  const homeroomClassList = (permissions?.homeroomClasses || [])
    .map((hc) => {
      if (hc && typeof hc === "object") {
        const grade = Number((hc as any).grade);
        const classNum = Number((hc as any).classNum);
        return Number.isInteger(grade) && Number.isInteger(classNum) ? { grade, classNum } : null;
      }
      const m = String(hc).match(/(\d+)\s*[-학년\s]\s*(\d+)/);
      return m ? { grade: Number(m[1]), classNum: Number(m[2]) } : null;
    })
    .filter((v): v is { grade: number; classNum: number } => v !== null);

  const hasHomeroom = homeroomClassList.length > 0;
  const homeroomLabel = homeroomClassList.map((h) => `${h.grade}-${h.classNum}`).join(", ");

  // grant로 기록 범위가 반을 넘는 사용자 (all 또는 grade 권한 보유)
  const hasBroaderRecordGrant = Boolean(
    permissions?.role === "super_admin" ||
    (permissions?.grants || permissions?.myGrants || []).some((g) => {
      const hasRecordRight = g.rights?.includes("record");
      const isBroaderScope = g.scope?.type === "all" || g.scope?.type === "grade";
      return hasRecordRight && isBroaderScope;
    })
  );

  // active인 항목만 필터링
  const activeItems = configItems.filter((it) => it.active !== false);
  const categories = Array.from(new Set(activeItems.map((it) => it.category || "기타")));

  // 담임 교사인 경우 우리 반 학생 목록 로딩 (users:all 캐시 활용)
  useEffect(() => {
    if (!hasHomeroom || !permissions?.homeroomClasses) return;

    const targetPrefixes = homeroomClassList.map(
      (h) => `${h.grade}${String(h.classNum).padStart(2, "0")}` // 예: "101"
    );

    if (targetPrefixes.length === 0) return;

    const processUsers = (users: any[]) => {
      const filtered: HomeroomStudent[] = [];
      for (const u of users) {
        const email = u.primaryEmail || u.email || "";
        const familyName = typeof u.name === "object" ? u.name?.familyName || "" : "";
        const givenName = typeof u.name === "object" ? u.name?.givenName || "" : u.name || "";

        // 학번(familyName) 5자리 정규식 대조
        if (/^\d{5}$/.test(familyName)) {
          const isTargetClass = targetPrefixes.some((p) => familyName.startsWith(p));
          if (isTargetClass) {
            const numStr = familyName.slice(3, 5); // 번호 2자리 (01, 02...)
            const studentName = givenName.trim() || familyName;
            filtered.push({
              email,
              name: studentName,
              studentId: familyName,
              numStr,
              label: `${numStr} ${studentName}`,
            });
          }
        }
      }

      // 번호순 정렬
      filtered.sort((a, b) => parseInt(a.numStr, 10) - parseInt(b.numStr, 10));
      setHomeroomStudents(filtered);
    };

    const cachedUsers = getClientCache("users:all");
    if (cachedUsers) {
      processUsers(cachedUsers);
    } else {
      setLoadingHomeroom(true);
      fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ["all"] }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.users) {
            setClientCache("users:all", data.users);
            processUsers(data.users);
          }
        })
        .catch((err) => console.error("Failed to load users for homeroom dropdown", err))
        .finally(() => setLoadingHomeroom(false));
    }
  }, [hasHomeroom, permissions?.homeroomClasses]);

  // 학번 해석: 이메일 앞자리가 아니라 명단 데이터의 학번(familyName)이 단일 원본이다.
  // (학생 실계정 이메일은 입학년도 기반(예: 26027@)이라 학번과 다름 — 이메일 파싱 금지)
  const resolveStudentId = (email: string): string => {
    const lower = email.trim().toLowerCase();
    const hs = homeroomStudents.find((s) => s.email.toLowerCase() === lower);
    if (hs) return hs.studentId;
    const users: any[] = getClientCache("users:all") || [];
    const u = users.find((x) => (x.primaryEmail || x.email || "").toLowerCase() === lower);
    const fam = typeof u?.name === "object" ? (u.name?.familyName || "").trim() : "";
    return /^\d{5}$/.test(fam) ? fam : "";
  };

  // 학생 선택 핸들러
  const handleSelectStudent = (email: string, name?: string) => {
    setSelectedStudentEmail(email);
    setSelectedStudentName(name || email);
    setStudentInput(email);
    setSelectedStudentId(resolveStudentId(email));

    // 반 드롭다운 동기화
    const homeroomMatch = homeroomStudents.find(
      (s) => s.email.toLowerCase() === email.toLowerCase()
    );
    if (homeroomMatch) {
      setSelectedHomeroomEmail(homeroomMatch.email);
    } else {
      setSelectedHomeroomEmail("");
    }
  };

  const handleSelectHomeroomStudent = (email: string) => {
    setSelectedHomeroomEmail(email);
    if (!email) {
      setSelectedStudentEmail("");
      setSelectedStudentName("");
      setSelectedStudentId("");
      setStudentInput("");
      return;
    }
    const student = homeroomStudents.find((s) => s.email === email);
    if (student) {
      handleSelectStudent(student.email, student.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!selectedStudentEmail) {
      setMessage({ type: "error", text: "학생을 선택해주세요." });
      return;
    }

    const studentId = selectedStudentId || resolveStudentId(selectedStudentEmail);
    if (!studentId) {
      setMessage({
        type: "error",
        text: "학번을 확인할 수 없습니다. 목록에서 학생을 다시 선택해주세요.",
      });
      return;
    }

    if (!selectedItemId) {
      setMessage({ type: "error", text: "지도 항목을 선택해주세요." });
      return;
    }

    if (!occurredDateStr) {
      setMessage({ type: "error", text: "발생일을 선택해주세요." });
      return;
    }

    const dateParts = occurredDateStr.split("-").map(Number);
    if (dateParts.length !== 3 || dateParts.some(isNaN)) {
      setMessage({ type: "error", text: "올바른 발생일을 입력해주세요." });
      return;
    }

    const [year, month, day] = dateParts;
    // 선택 날짜의 12:00 KST = UTC 03:00
    const occurredAtMs = Date.UTC(year, month - 1, day, 3, 0, 0, 0);
    const occurredAtIso = new Date(occurredAtMs).toISOString();

    setLoading(true);
    try {
      const res = await fetch("/api/discipline/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          studentId,
          studentName: selectedStudentName,
          itemId: selectedItemId,
          occurredAt: occurredAtIso,
          note: note.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "지도 기록 입력에 실패했습니다.");
      }

      setMessage({
        type: "success",
        text: `[${selectedStudentName || selectedStudentEmail}] 지도 기록이 성공적으로 등록되었습니다.${
          data.stageEventCreated ? " (단계 도달 — 처리함에 사안이 생성되었습니다)" : ""
        }`,
      });

      // 폼 초기화
      setStudentInput("");
      setSelectedStudentEmail("");
      setSelectedStudentName("");
      setSelectedStudentId("");
      setSelectedHomeroomEmail("");
      setSelectedItemId("");
      setNote("");
      setOccurredDateStr(getTodayKSTStr());
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">📝 지도 기록 입력</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          학생의 생활지도 항목 및 발생 사실을 기록합니다. 입력된 사안은 실시간으로 단계 조건이 자동 계산됩니다.
        </p>

        {message && (
          <div
            className={`p-4 mb-6 rounded-lg text-sm font-medium ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. 대상 학생 선택 */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
              대상 학생 <span className="text-red-500">*</span>
            </label>

            {/* 우리 반 학생 드롭다운 (담임 교사일 때 기본 표시) */}
            {hasHomeroom && (
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  🏫 우리 반 학생 목록 ({homeroomLabel})
                </div>
                {loadingHomeroom ? (
                  <div className="text-xs text-gray-400 p-2">우리 반 학생 목록을 불러오는 중...</div>
                ) : (
                  <select
                    value={selectedHomeroomEmail}
                    onChange={(e) => handleSelectHomeroomStudent(e.target.value)}
                    className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- 우리 반 학생 선택 --</option>
                    {homeroomStudents.map((student) => (
                      <option key={student.email} value={student.email}>
                        {student.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* 검색창 AutocompleteInput: grant로 기록 범위가 반을 넘는 사용자에게만 병행 노출 (담임이 아닌 사용자는 필수 노출) */}
            {(!hasHomeroom || hasBroaderRecordGrant) && (
              <div>
                {hasHomeroom && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium pt-1">
                    🔍 타 학급 / 전체 학생 직접 검색
                  </div>
                )}
                <AutocompleteInput
                  type="user"
                  domain={domain}
                  value={studentInput}
                  onChange={(val) => {
                    setStudentInput(val);
                    setSelectedStudentEmail(val);
                  }}
                  onSelect={handleSelectStudent}
                  placeholder="학생 이름 또는 이메일/학번 검색"
                  className="w-full"
                />
              </div>
            )}

            {selectedStudentEmail && (
              <div className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-md inline-block">
                선택된 학생: {selectedStudentName} ({selectedStudentEmail})
              </div>
            )}
          </div>

          {/* 2. 지도 항목 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              지도 항목 선택 <span className="text-red-500">*</span>
            </label>
            {activeItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 border border-dashed rounded-lg">
                등록되어 활성화된 지도 항목이 없습니다. (규정 편집기에서 항목을 추가하세요)
              </div>
            ) : (
              <div className="space-y-4">
                {categories.map((cat) => {
                  const catItems = activeItems.filter((it) => (it.category || "기타") === cat);
                  return (
                    <div key={cat} className="space-y-2">
                      <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {cat}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {catItems.map((item) => {
                          const isSelected = selectedItemId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedItemId(item.id)}
                              className={`p-3.5 text-left rounded-xl border text-sm font-medium transition-all min-h-[52px] flex items-center justify-between ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-500"
                                  : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700 dark:bg-gray-700/50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                              }`}
                            >
                              <span>{item.label}</span>
                              {isSelected && (
                                <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. 발생일 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              발생일 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={occurredDateStr}
              onChange={(e) => setOccurredDateStr(e.target.value)}
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              사안이 발생한 날짜를 선택하세요. (기본값: 오늘)
            </p>
          </div>

          {/* 4. 비고 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              비고 / 상세 내용
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예: 1교시 생활지도 사복 착용 지적 (구체적 상황 기재)"
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            ></textarea>
          </div>

          {/* 제출 버튼 */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !selectedStudentEmail || !selectedItemId}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all text-base flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>기록 등록 중...</span>
                </>
              ) : (
                <span>📝 생활지도 기록 등록</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
