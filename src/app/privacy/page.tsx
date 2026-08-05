import Link from "next/link";
import { POLICY_VERSION, POLICY_EFFECTIVE_DATE } from "@/lib/policy/version";

export const metadata = {
  title: "개인정보 처리 안내 | 효명고등학교 관리 시스템",
  description: "효명고등학교 관리 시스템의 개인정보 처리 방침 및 고지 사항입니다.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* 상단 네비게이션 & 헤더 */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
          <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-100 pb-6 mb-6">
            <div>
              <span className="inline-block px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-full mb-2">
                공개 개인정보 안내
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                효명고등학교 관리 시스템 개인정보 처리 안내
              </h1>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>버전: <strong className="text-indigo-600 font-mono">v{POLICY_VERSION}</strong></div>
              <div>시행일: {POLICY_EFFECTIVE_DATE}</div>
            </div>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            이 시스템은 효명고등학교가 학교 업무(학생 계정 관리, 생활지도, 시간표 운영 등)를 처리하기 위해 운영합니다.
            학교의 법령상 사무 수행을 위한 것으로, 처리하는 정보와 방법을 아래와 같이 고지해 드립니다.
          </p>
        </div>

        {/* 1. 교직원용 안내 */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 space-y-4">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>👩‍🏫 교직원용 개인정보 처리 안내</span>
          </h2>
          
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 sm:p-4 w-1/4">무엇을 저장하나</th>
                  <th className="p-3 sm:p-4 w-1/4">왜</th>
                  <th className="p-3 sm:p-4 w-1/4">누가 볼 수 있나</th>
                  <th className="p-3 sm:p-4 w-1/4">언제까지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                <tr>
                  <td className="p-3 sm:p-4 font-semibold text-slate-900">선생님의 학교 이메일·이름·담당 업무</td>
                  <td className="p-3 sm:p-4">로그인과 권한 구분, 교직원 조직도</td>
                  <td className="p-3 sm:p-4">교직원</td>
                  <td className="p-3 sm:p-4">전출·퇴직 처리 시 삭제</td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-semibold text-slate-900">학생의 학교 이메일·이름·학번</td>
                  <td className="p-3 sm:p-4">계정 관리, 명렬표, 수업 도구 정리</td>
                  <td className="p-3 sm:p-4">교직원</td>
                  <td className="p-3 sm:p-4">졸업·전출 계정 정리 시 함께 삭제</td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-semibold text-slate-900">학생 생활지도 기록 (지도 항목·날짜·메모)</td>
                  <td className="p-3 sm:p-4">학생 생활지도 (민감 정보로 취급)</td>
                  <td className="p-3 sm:p-4">담임은 자기 반, 그 외에는 별도 권한을 받은 선생님만</td>
                  <td className="p-3 sm:p-4">졸업·제적 시 파기</td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-semibold text-slate-900">시간표·수업 교환 신청 내역</td>
                  <td className="p-3 sm:p-4">시간표 운영</td>
                  <td className="p-3 sm:p-4">교직원</td>
                  <td className="p-3 sm:p-4">학년도 경과 후 정리</td>
                </tr>
                <tr>
                  <td className="p-3 sm:p-4 font-semibold text-slate-900">시스템 사용 기록 (작업 감사 로그)</td>
                  <td className="p-3 sm:p-4">안전한 운영 확인(감사)</td>
                  <td className="p-3 sm:p-4">교직원 열람, 수정·삭제 불가</td>
                  <td className="p-3 sm:p-4">별도 방침으로 보존 (5년)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="list-disc list-inside text-xs sm:text-sm text-slate-600 space-y-1.5 pt-2">
            <li>주민등록번호, 전화번호, 주소, 학부모 정보는 <strong>저장하지 않습니다</strong>.</li>
            <li>구글 계정 안의 메일·드라이브 원본은 이 시스템이 아니라 학교–Google 간 교육용 계약에 따라 관리됩니다.</li>
          </ul>
        </div>

        {/* 2. 학생용 안내 */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 space-y-4">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>🎓 학생용 개인정보 처리 안내</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-xl">
              <h3 className="font-bold text-blue-900 text-sm mb-2">📌 저장하는 것</h3>
              <p className="text-xs text-blue-800 leading-relaxed">
                학교 이메일, 이름, 학번. 생활지도가 있었던 경우 그 기록(담당 선생님만 볼 수 있습니다). 졸업할 때 계정 정리를 위한 안내 확인 기록.
              </p>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-100 p-4 rounded-xl">
              <h3 className="font-bold text-emerald-900 text-sm mb-2">🚫 저장하지 않는 것</h3>
              <p className="text-xs text-emerald-800 leading-relaxed">
                주민등록번호, 전화번호, 집 주소, 부모님 정보.
              </p>
            </div>

            <div className="bg-purple-50/60 border border-purple-100 p-4 rounded-xl">
              <h3 className="font-bold text-purple-900 text-sm mb-2">⏳ 언제까지 보관하나</h3>
              <p className="text-xs text-purple-800 leading-relaxed">
                졸업하거나 전학 가면 계정과 함께 정리됩니다.
              </p>
            </div>
          </div>
        </div>

        {/* 3. 공통 개정 및 문의 조항 */}
        <div className="bg-slate-900 text-white rounded-2xl p-8 shadow-md space-y-4">
          <h3 className="text-lg font-bold text-indigo-300">🔄 안내 개정 및 문의사항</h3>
          <div className="text-xs sm:text-sm text-slate-300 space-y-2 leading-relaxed">
            <p>
              <strong>이 시스템은 계속 새로운 기능이 더해지고 있습니다.</strong> 처리하는 정보가 늘어나거나 달라지면
              이 안내를 고쳐서 로그인할 때 다시 알려드리고, 법적으로 동의가 필요한 일이 생기면 그때 따로 여쭙습니다.
            </p>
            <p className="pt-2 border-t border-slate-800 text-slate-400">
              문의처: 효명고등학교 정보부 (관리자 계정 운영 부서)
            </p>
          </div>
        </div>

        {/* 하단 홈 이동 버튼 */}
        <div className="text-center pt-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
          >
            ← 로그인 페이지로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
