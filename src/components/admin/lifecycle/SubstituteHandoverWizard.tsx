"use client";

// 대체 교사 담당 일괄 이관 마법사 — docs/substitute_handover_spec.md §3~§5, §8 순서 2
//
// 화면 용어는 「기간제」가 아니라 **「대체 교사」**다 (2026-08-21 사용자 지적).
// 이유 둘: ⓐ 기간제 교사 중에는 몇 해째 정교사처럼 계속 근무하시는 분들이 있어
// 「기간제」가 이 화면이 다루는 「자리를 대신 맡는 상황」과 어긋난다 ⓑ 그 자리를
// **시간강사**가 대신할 때도 있다 — 신분으로 이름 붙이면 그 경우가 빠진다.
// 이 화면이 다루는 것은 신분이 아니라 **역할**이다.
//
// 5단계 마법사 흐름:
// (1) 대상 교사 및 인수일 선택
// (2) 미리보기 결과 확인 및 사전 검증 안내
// (3) 담임 승계 및 소속 부서 배치 설정
// (4) 클래스룸 공동교사 연동 (초대 / 내보내기)
// (5) 실행 및 요약 결과 보고
//
// 시간표 계산은 클라이언트에서 절대 재구현하지 않고 POST /api/workspace/handover의
// preview / commit 응답을 그대로 사용한다.

import { useState } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { invalidateClientCache } from "@/lib/cache/clientCache";

const DAY_NAMES = ["", "월", "화", "수", "목", "금", "토", "일"];

interface HandoverWeekIntent {
  grade: number;
  classNum: number;
  day: number;
  period: number;
  subjectName: string;
}

interface HandoverPreview {
  termId: string;
  fromName: string;
  toName: string;
  takeoverDate: string;
  weekId: string;
  effectiveFrom: string;
  weekIntents: HandoverWeekIntent[];
  revisionCellCount: number;
  homeroom: { grade: number; class: number } | null;
  toProfileExists: boolean;
  toDepartments: string[];
  fromDepartments: string[];
  courses: { id: string; name: string; section?: string }[];
  coursesError: string | null;
  existingDraftId: string | null;
}

interface HandoverSummary {
  batchId: string;
  weekChanges: { done: number; failed: string[] };
  revisionId: string | null;
  effectiveFrom: string;
  homeroomMoved: boolean;
  departmentsAssigned: boolean;
  courses: { done: number; failed: string[] };
}

interface Props {
  domain: string;
  operatorEmail: string;
}

export default function SubstituteHandoverWizard({ domain, operatorEmail }: Props) {
  // 단계: 1(선택) -> 2(미리보기) -> 3(담임/부서) -> 4(클래스룸) -> 5(실행 및 요약)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // 1단계 입력값
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromQuery, setFromQuery] = useState("");

  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [toQuery, setToQuery] = useState("");

  const [takeoverDate, setTakeoverDate] = useState(() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  });
  const [isReturn, setIsReturn] = useState(false); // false: 대체 교사 부임(인수), true: 원 교사 복직(역이관)

  // 2단계 미리보기 데이터
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<HandoverPreview | null>(null);

  // 3단계 담임 & 부서 선택
  const [homeroomOption, setHomeroomOption] = useState<"to" | "custom" | "none">("to");
  const [customHomeroomEmail, setCustomHomeroomEmail] = useState("");
  const [customHomeroomName, setCustomHomeroomName] = useState("");
  const [customHomeroomQuery, setCustomHomeroomQuery] = useState("");
  const [assignDepartments, setAssignDepartments] = useState(true);

  // 4단계 클래스룸 선택
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());

  // 5단계 커밋 실행 및 요약
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<HandoverSummary | null>(null);

  // 1단계 -> 2단계 미리보기 요청
  const handleFetchPreview = async () => {
    if (!fromEmail || !toEmail) {
      setPreviewError("이관 전 교사와 이관 후 교사를 모두 선택해 주세요.");
      return;
    }
    if (fromEmail.toLowerCase() === toEmail.toLowerCase()) {
      setPreviewError("이관 전 교사와 이관 후 교사가 동일합니다. 서로 다른 교사를 선택해 주세요.");
      return;
    }
    if (!takeoverDate) {
      setPreviewError("인수일을 선택해 주세요.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/workspace/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          fromEmail,
          toEmail,
          date: takeoverDate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "미리보기를 불러오지 못했습니다.");
      }

      const preview: HandoverPreview = data.preview;
      setPreviewData(preview);

      // 기본값 세팅
      if (preview.courses && preview.courses.length > 0) {
        setSelectedCourseIds(new Set(preview.courses.map((c) => c.id)));
      } else {
        setSelectedCourseIds(new Set());
      }
      setAssignDepartments(preview.toDepartments.length === 0);
      setHomeroomOption("to");
      setCustomHomeroomEmail("");
      setCustomHomeroomName("");
      setCustomHomeroomQuery("");

      setStep(2);
    } catch (err: any) {
      setPreviewError(err.message || "미리보기 조회 중 오류가 발생했습니다.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // 4단계 -> 5단계 커밋 실행
  const handleCommit = async () => {
    if (!previewData) return;

    let homeroomSuccessorEmail: string | null = null;
    if (previewData.homeroom) {
      if (homeroomOption === "to") {
        homeroomSuccessorEmail = toEmail;
      } else if (homeroomOption === "custom") {
        if (!customHomeroomEmail) {
          setCommitError("담임을 승계할 제3자 교사를 선택해 주세요.");
          return;
        }
        homeroomSuccessorEmail = customHomeroomEmail;
      }
    }

    setCommitLoading(true);
    setCommitError(null);
    try {
      const res = await fetch("/api/workspace/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          fromEmail,
          toEmail,
          date: takeoverDate,
          homeroomSuccessorEmail,
          assignDepartments: assignDepartments && previewData.toDepartments.length === 0,
          courseAction: isReturn ? "remove" : "invite",
          courseIds: Array.from(selectedCourseIds),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "이관 처리에 실패했습니다.");
      }

      setSummaryData(data.summary);
      invalidateClientCache("teacher_profiles:all");
      invalidateClientCache("users:all");
      setStep(5);
    } catch (err: any) {
      setCommitError(err.message || "이관 실행 중 오류가 발생했습니다.");
    } finally {
      setCommitLoading(false);
    }
  };

  // 전체 리셋
  const handleReset = () => {
    setStep(1);
    setFromEmail("");
    setFromName("");
    setFromQuery("");
    setToEmail("");
    setToName("");
    setToQuery("");
    setPreviewData(null);
    setSummaryData(null);
    setPreviewError(null);
    setCommitError(null);
    setSelectedCourseIds(new Set());
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
      {/* 상단 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🔄</span>
            <span>대체 교사 담당 일괄 이관 마법사</span>
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            수업 시간표 · 담임 학급 · 클래스룸을 함께 넘깁니다.
          </p>
        </div>
        {step > 1 && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-gray-500 hover:text-gray-700 underline self-start sm:self-auto cursor-pointer"
          >
            처음부터 다시 작성
          </button>
        )}
      </div>

      {/* 단계 인디케이터 */}
      <div className="flex items-center justify-between gap-1 text-sm border-b border-gray-100 pb-3 overflow-x-auto select-none">
        <span className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${step === 1 ? "bg-indigo-600 text-white" : step > 1 ? "bg-indigo-100 text-indigo-700" : "text-gray-400"}`}>
          ① 대상·일자 선택
        </span>
        <span className="text-gray-300">›</span>
        <span className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${step === 2 ? "bg-indigo-600 text-white" : step > 2 ? "bg-indigo-100 text-indigo-700" : "text-gray-400"}`}>
          ② 변경 사항 확인
        </span>
        <span className="text-gray-300">›</span>
        <span className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${step === 3 ? "bg-indigo-600 text-white" : step > 3 ? "bg-indigo-100 text-indigo-700" : "text-gray-400"}`}>
          ③ 담임·부서 설정
        </span>
        <span className="text-gray-300">›</span>
        <span className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${step === 4 ? "bg-indigo-600 text-white" : step > 4 ? "bg-indigo-100 text-indigo-700" : "text-gray-400"}`}>
          ④ 클래스룸 연동
        </span>
        <span className="text-gray-300">›</span>
        <span className={`px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${step === 5 ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
          ⑤ 완료 요약
        </span>
      </div>

      {/* ── 1단계: 대상 교사 및 인수일 선택 ── */}
      {step === 1 && (
        <div className="space-y-6 max-w-xl">
          {/* 이관 유형 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">이관 유형</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsReturn(false)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  !isReturn
                    ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-1 ring-indigo-600"
                    : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
                }`}
              >
                <div className="text-sm font-bold">대체 교사 부임 (신규 인수)</div>
                <div className="text-xs text-gray-500 font-normal mt-0.5">
                  원 교사의 수업과 클래스룸을 대체 교사에게 넘깁니다.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsReturn(true)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  isReturn
                    ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-1 ring-indigo-600"
                    : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
                }`}
              >
                <div className="text-sm font-bold">원 교사 복직 (역이관)</div>
                <div className="text-xs text-gray-500 font-normal mt-0.5">
                  대체 교사의 수업을 원 교사에게 원상 복귀하고 클래스룸에서 정리합니다.
                </div>
              </button>
            </div>
          </div>

          {/* 이관 전 교사 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              {isReturn ? "대체 교사 (이관 전)" : "휴직·원 교사 (이관 전)"}
            </label>
            <AutocompleteInput
              type="user"
              teachersOnly
              value={fromQuery}
              onChange={(val) => {
                setFromQuery(val);
                setFromEmail("");
                setFromName("");
              }}
              domain={domain}
              onSelect={(email, name) => {
                setFromEmail(email);
                setFromName(name || email.split("@")[0]);
                setFromQuery(`${name || email.split("@")[0]} (${email})`);
              }}
              placeholder="이름 또는 이메일 검색..."
              className="w-full"
            />
            {fromEmail && (
              <p className="text-sm text-indigo-700 font-medium mt-1">
                ✓ 선택됨: <span className="font-bold">{fromName}</span> ({fromEmail})
              </p>
            )}
          </div>

          {/* 이관 후 교사 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              {isReturn ? "복직 교사 (이관 후)" : "대체 교사 (이관 후)"}
            </label>
            <AutocompleteInput
              type="user"
              teachersOnly
              value={toQuery}
              onChange={(val) => {
                setToQuery(val);
                setToEmail("");
                setToName("");
              }}
              domain={domain}
              onSelect={(email, name) => {
                setToEmail(email);
                setToName(name || email.split("@")[0]);
                setToQuery(`${name || email.split("@")[0]} (${email})`);
              }}
              placeholder="이름 또는 이메일 검색..."
              className="w-full"
            />
            {toEmail && (
              <p className="text-sm text-indigo-700 font-medium mt-1">
                ✓ 선택됨: <span className="font-bold">{toName}</span> ({toEmail})
              </p>
            )}
          </div>

          {/* 인수일 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              {isReturn ? "복직일 (인수 시작일)" : "부임일 (인수 시작일)"}
            </label>
            <input
              type="date"
              value={takeoverDate}
              onChange={(e) => setTakeoverDate(e.target.value)}
              className="w-full px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              인수일부터 그 주의 금요일까지는 해당 요일 수업이 즉시 변경되고, 다음 주 월요일부터는 기초시간표 개정판으로 적용됩니다.
            </p>
          </div>

          {previewError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              ⚠️ {previewError}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={handleFetchPreview}
              disabled={previewLoading || !fromEmail || !toEmail || !takeoverDate}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-40 transition-colors cursor-pointer flex items-center justify-center gap-2 text-sm"
            >
              {previewLoading ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>변경 사항 계산 중…</span>
                </>
              ) : (
                <span>다음 (변경 사항 확인) ›</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── 2단계: 변경 사항 확인 (미리보기) ── */}
      {step === 2 && previewData && (
        <div className="space-y-6">
          {/* 주요 경고/사전 검증 박스 */}
          {previewData.existingDraftId && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 text-sm text-red-900 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-base text-red-700">
                <span>⛔</span>
                <span>시간표 개정 초안이 이미 존재합니다</span>
              </div>
              <p className="leading-relaxed">
                현재 시간표 관리 메뉴에 <strong>작업 중인 기초시간표 개정 초안</strong>이 있습니다.
                인수인계 마법사가 다른 관리자의 작업 초안을 덮어쓰지 않도록 실행이 제한됩니다.
              </p>
              <p className="text-xs text-red-700 font-semibold">
                조치 방법: [시간표 편성·수정] 메뉴에서 기존 초안을 적용하거나 삭제한 후 다시 진행해 주세요.
              </p>
            </div>
          )}

          {!previewData.toProfileExists && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900 space-y-1">
              <div className="font-bold flex items-center gap-1 text-amber-800">
                <span>⚠️</span>
                <span>인수 교사의 승인된 프로필이 없습니다</span>
              </div>
              <p className="text-xs leading-relaxed">
                {previewData.toName} 선생님의 교직원 프로필이 아직 생성되지 않았거나 승인 대기 상태입니다.
                [교직원 조직도 관리] 메뉴에서 먼저 승인을 완료해 주세요.
              </p>
            </div>
          )}

          {previewData.toDepartments.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-sm text-blue-900 flex items-start gap-2">
              <span className="text-base">ℹ️</span>
              <div className="text-xs space-y-0.5">
                <p className="font-bold text-blue-950">인수 교사의 소속 부서가 아직 없습니다.</p>
                <p className="text-blue-800">
                  다음 단계에서 원 교사의 소속 부서
                  ({previewData.fromDepartments.length > 0 ? previewData.fromDepartments.join(", ") : "소속 없음"})로
                  자동 배치를 지정할 수 있습니다.
                </p>
              </div>
            </div>
          )}

          {/* 변경 계획 요약 카드 4종 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">인수일 기준 걸치는 주</div>
              <div className="text-lg font-bold text-slate-900">
                {previewData.weekIntents.length}건 변경
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {previewData.takeoverDate} 요일부터 주말 전까지 직권 보강 적용
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">기초시간표 개정판</div>
              <div className="text-lg font-bold text-slate-900">
                {previewData.revisionCellCount}개 수업 치환
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {previewData.effectiveFrom} 주간부터 자동 적용
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">담임 학급</div>
              <div className="text-lg font-bold text-slate-900">
                {previewData.homeroom
                  ? `${previewData.homeroom.grade}학년 ${previewData.homeroom.class}반`
                  : "담임 없음"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {previewData.homeroom ? "다음 단계에서 승계자 지정" : "해당 사항 없음"}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 font-medium mb-1">클래스룸 코스</div>
              <div className="text-lg font-bold text-slate-900">
                {previewData.courses.length}개 코스
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isReturn ? "공동교사에서 내보내기" : "공동교사로 초대"}
              </div>
            </div>
          </div>

          {/* 걸치는 주 세부 수업 목록 */}
          {previewData.weekIntents.length > 0 ? (
            <div>
              <h4 className="text-sm font-bold text-gray-800 mb-2">
                걸치는 주 즉시 변경 수업 목록 ({previewData.weekIntents.length}건)
              </h4>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                <table className="min-w-[700px] text-left text-sm divide-y divide-gray-200">
                  <thead className="bg-gray-50 text-gray-700 font-bold sticky top-0">
                    <tr>
                      <th className="px-3 py-2">학급</th>
                      <th className="px-3 py-2">요일</th>
                      <th className="px-3 py-2">교시</th>
                      <th className="px-3 py-2">과목</th>
                      <th className="px-3 py-2">담당 변경</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {previewData.weekIntents.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {item.grade}학년 {item.classNum}반
                        </td>
                        <td className="px-3 py-2 text-slate-700">{DAY_NAMES[item.day]}요일</td>
                        <td className="px-3 py-2 text-slate-700">{item.period}교시</td>
                        <td className="px-3 py-2 text-slate-900 font-medium">{item.subjectName}</td>
                        <td className="px-3 py-2 text-indigo-700 font-bold">
                          {previewData.fromName} → {previewData.toName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
              걸치는 주 변경 대상 수업이 없습니다. (인수일이 다음 주 월요일이거나 주말인 경우 바로 개정판으로 적용됩니다)
            </div>
          )}

          {/* 단계 이동 버튼 */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
            >
              ← 이전
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!!previewData.existingDraftId || !previewData.toProfileExists}
              className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer"
            >
              다음 (담임·부서 설정) ›
            </button>
          </div>
        </div>
      )}

      {/* ── 3단계: 담임 승계 및 부서 배치 설정 ── */}
      {step === 3 && previewData && (
        <div className="space-y-6 max-w-xl">
          {/* 담임 승계 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              담임 승계 설정
            </label>
            {previewData.homeroom ? (
              <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-700 mb-1">
                  이관 대상 담임 학급: <span className="text-indigo-600 font-bold text-sm">{previewData.homeroom.grade}학년 {previewData.homeroom.class}반</span>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="homeroom"
                      checked={homeroomOption === "to"}
                      onChange={() => setHomeroomOption("to")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      <strong>{previewData.toName}</strong> 선생님에게 담임 승계 (기본)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="homeroom"
                      checked={homeroomOption === "custom"}
                      onChange={() => setHomeroomOption("custom")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>제3자 교사에게 승계 (예: 학년부장 등)</span>
                  </label>

                  {homeroomOption === "custom" && (
                    <div className="ml-6 mt-2">
                      <AutocompleteInput
                        type="user"
                        teachersOnly
                        value={customHomeroomQuery}
                        onChange={(val) => {
                          setCustomHomeroomQuery(val);
                          setCustomHomeroomEmail("");
                          setCustomHomeroomName("");
                        }}
                        domain={domain}
                        onSelect={(email, name) => {
                          setCustomHomeroomEmail(email);
                          setCustomHomeroomName(name || email.split("@")[0]);
                          setCustomHomeroomQuery(`${name || email.split("@")[0]} (${email})`);
                        }}
                        placeholder="담임을 맡을 교사 이름 검색..."
                        className="w-full"
                      />
                      {customHomeroomEmail && (
                        <p className="text-sm text-indigo-700 font-medium mt-1">
                          ✓ 담임 승계자: <span className="font-bold">{customHomeroomName}</span> ({customHomeroomEmail})
                        </p>
                      )}
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="homeroom"
                      checked={homeroomOption === "none"}
                      onChange={() => setHomeroomOption("none")}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-600">담임 변경 안 함 (공석 유지 또는 나중에 지정)</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500">
                이관 전 교사는 담임 학급이 없습니다.
              </div>
            )}
          </div>

          {/* 소속 부서 배치 */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              소속 부서 배치
            </label>
            {previewData.toDepartments.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignDepartments}
                    onChange={(e) => setAssignDepartments(e.target.checked)}
                    className="mt-0.5 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <div>
                    <span className="font-semibold">
                      원 교사의 소속 부서를 인수 교사에게 그대로 배정
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      배정할 부서:{" "}
                      <span className="font-bold text-slate-700">
                        {previewData.fromDepartments.length > 0
                          ? previewData.fromDepartments.join(", ")
                          : "없음"}
                      </span>
                    </p>
                  </div>
                </label>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
                인수 교사는 이미 부서가 배치되어 있습니다:{" "}
                <span className="font-bold text-gray-800">{previewData.toDepartments.join(", ")}</span>
              </div>
            )}
          </div>

          {/* 단계 이동 버튼 */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
            >
              ← 이전
            </button>
            <button
              type="button"
              onClick={() => {
                if (previewData.homeroom && homeroomOption === "custom" && !customHomeroomEmail) {
                  alert("담임을 승계할 제3자 교사를 검색해 선택해 주세요.");
                  return;
                }
                setStep(4);
              }}
              className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              다음 (클래스룸 연동) ›
            </button>
          </div>
        </div>
      )}

      {/* ── 4단계: 클래스룸 공동교사 연동 ── */}
      {step === 4 && previewData && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-800">
                구글 클래스룸 {isReturn ? "공동교사 내보내기" : "공동교사 초대"}
              </label>
              {previewData.courses.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCourseIds(new Set(previewData.courses.map((c) => c.id)))
                    }
                    className="text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                  >
                    전체 선택
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCourseIds(new Set())}
                    className="text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    전체 해제
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {isReturn
                ? `선택한 클래스룸에서 ${previewData.fromName} 선생님을 공동교사 목록에서 내보냅니다.`
                : `선택한 클래스룸에 ${previewData.toName} 선생님을 공동교사로 초대합니다.`}
            </p>

            {previewData.coursesError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-3">
                ⚠️ {previewData.coursesError}
              </div>
            )}

            {previewData.courses.length > 0 ? (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto bg-white">
                {previewData.courses.map((course) => {
                  const isChecked = selectedCourseIds.has(course.id);
                  return (
                    <label
                      key={course.id}
                      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = new Set(selectedCourseIds);
                          if (e.target.checked) next.add(course.id);
                          else next.delete(course.id);
                          setSelectedCourseIds(next);
                        }}
                        className="text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-slate-800">{course.name}</span>
                        {course.section && (
                          <span className="text-slate-400 ml-1.5 font-normal">({course.section})</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-xs text-gray-500">
                연동할 수 있는 활성 클래스룸 코스가 없습니다. 이 단계를 건너뜁니다.
              </div>
            )}
          </div>

          {commitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              ❌ {commitError}
            </div>
          )}

          {/* 단계 이동 및 실행 버튼 */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={commitLoading}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
            >
              ← 이전
            </button>
            <button
              type="button"
              onClick={handleCommit}
              disabled={commitLoading}
              className="px-6 py-2.5 text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-2"
            >
              {commitLoading ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>이관 실행 중…</span>
                </>
              ) : (
                <span>🚀 일괄 이관 실행하기</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── 5단계: 완료 요약 결과 ── */}
      {step === 5 && summaryData && previewData && (
        <div className="space-y-6">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-emerald-900 space-y-2">
            <div className="flex items-center gap-2 text-base font-bold text-emerald-800">
              <span>🎉</span>
              <span>대체 교사 담당 일괄 이관이 성공적으로 완료되었습니다!</span>
            </div>
            <p className="text-xs text-emerald-700">
              {previewData.fromName} 선생님의 담당 업무가 {previewData.toName} 선생님에게 안전하게 이관되었습니다.
            </p>
          </div>

          {/* 요약 상세 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
                <span>걸치는 주 시간표 직권 변경</span>
                <span className="text-indigo-600 font-bold">
                  {summaryData.weekChanges.done}건 완료
                </span>
              </div>
              <p className="text-slate-500">
                인수일({previewData.takeoverDate})부터 주말 전까지의 수업이 {previewData.toName} 선생님 담당으로 변경되었습니다.
              </p>
              {summaryData.weekChanges.failed.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-2 rounded mt-2">
                  <div className="font-bold mb-1">일부 변경 실패 ({summaryData.weekChanges.failed.length}건):</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {summaryData.weekChanges.failed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
                <span>기초시간표 개정판 적용</span>
                <span className="text-indigo-600 font-bold">
                  {summaryData.revisionId ? "개정판 적용됨" : "생성 없음"}
                </span>
              </div>
              <p className="text-slate-500">
                {summaryData.effectiveFrom} 주간부터 모든 기초 시간표가 {previewData.toName} 선생님 이름으로 반영됩니다.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
                <span>담임 학급 승계</span>
                <span className="text-indigo-600 font-bold">
                  {summaryData.homeroomMoved ? "승계 완료" : "변경 없음"}
                </span>
              </div>
              <p className="text-slate-500">
                {summaryData.homeroomMoved
                  ? `${previewData.homeroom?.grade}학년 ${previewData.homeroom?.class}반 담임 프로필이 갱신되었습니다.`
                  : "담임 학급 변경이 없거나 담임이 아니었습니다."}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
                <span>구글 클래스룸 연동</span>
                <span className="text-indigo-600 font-bold">
                  {summaryData.courses.done}건 처리
                </span>
              </div>
              <p className="text-slate-500">
                {isReturn
                  ? "선택한 코스에서 공동교사 권한을 해제했습니다."
                  : "선택한 코스에 공동교사 초대를 발송했습니다."}
              </p>
              {summaryData.courses.failed.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-2 rounded mt-2">
                  <div className="font-bold mb-1">일부 코스 실패 ({summaryData.courses.failed.length}건):</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {summaryData.courses.failed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2.5 rounded-lg transition-colors cursor-pointer text-sm"
            >
              새로운 인수인계 작업하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
