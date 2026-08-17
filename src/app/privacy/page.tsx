import Link from "next/link";
import { POLICY_VERSION, POLICY_EFFECTIVE_DATE } from "@/lib/policy/version";

export const metadata = {
  title: "개인정보 처리 안내 | 효명고등학교 관리 시스템",
  description: "효명고등학교 관리 시스템의 개인정보 처리 방침 및 고지 사항입니다.",
};

const thClass = "p-3 sm:p-4 font-bold text-slate-700";
const tdClass = "p-3 sm:p-4 align-top";
const tdHeadClass = "p-3 sm:p-4 align-top font-semibold text-slate-900";
const sectionClass = "bg-white rounded-xl p-8 shadow-sm border border-slate-200/80 space-y-4";
const sectionTitleClass = "text-lg font-bold text-slate-900";
const bodyTextClass = "text-xs sm:text-sm text-slate-600 leading-relaxed";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 헤더 */}
        <div className={sectionClass}>
          <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-100 pb-6">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              효명고등학교 관리 시스템 개인정보 처리 안내
            </h1>
            <div className="text-right text-xs text-slate-500">
              <div>버전: <strong className="text-slate-800 font-mono">v{POLICY_VERSION}</strong></div>
              <div>시행일: {POLICY_EFFECTIVE_DATE}</div>
            </div>
          </div>

          <p className={bodyTextClass}>
            본 시스템은 효명고등학교(이하 &ldquo;학교&rdquo;)가 학생 계정 관리, 생활지도, 시간표 운영 등
            학교 업무를 수행하기 위하여 운영하며, 개인정보는 그에 필요한 최소한의 범위에서만 처리합니다.
            처리하는 개인정보의 항목과 방법을 다음과 같이 고지합니다.
          </p>
        </div>

        {/* 1. 교직원 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>1. 교직원 개인정보의 처리</h2>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={`${thClass} w-1/4`}>저장 항목</th>
                  <th className={`${thClass} w-1/4`}>처리 목적</th>
                  <th className={`${thClass} w-1/4`}>열람 범위</th>
                  <th className={`${thClass} w-1/4`}>보유 기간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                <tr>
                  <td className={tdHeadClass}>교직원 이메일·성명·담당 업무·내선번호(선택)</td>
                  <td className={tdClass}>로그인 인증·권한 구분, 교직원 조직도 관리</td>
                  <td className={tdClass}>교직원</td>
                  <td className={tdClass}>전출·퇴직 처리 시 삭제</td>
                </tr>

                <tr>
                  <td className={tdHeadClass}>시간표·수업 교환 신청 내역</td>
                  <td className={tdClass}>시간표 운영</td>
                  <td className={tdClass}>교직원</td>
                  <td className={tdClass}>학년도 경과 후 정리</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>쪽지 내용(제목·본문·링크·첨부 이미지)과 주고받은 분·읽은 시각</td>
                  <td className={tdClass}>교직원 간 업무 연락 및 수신 확인</td>
                  <td className={tdClass}>보낸 분과 받는 분만. 받는 분에게는 함께 받은 분 목록과 각자의 읽은 시각이 보입니다</td>
                  <td className={tdClass}>보낸 날부터 365일 보존 후 파기</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>시스템 사용 기록(감사 기록)</td>
                  <td className={tdClass}>시스템 운영 감사</td>
                  <td className={tdClass}>교직원 열람. 수정·삭제 불가</td>
                  <td className={tdClass}>5년 보존 후 파기</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 2. 학생 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>2. 학생 개인정보의 처리</h2>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={`${thClass} w-1/4`}>저장 항목</th>
                  <th className={`${thClass} w-1/4`}>처리 목적</th>
                  <th className={`${thClass} w-1/4`}>열람 범위</th>
                  <th className={`${thClass} w-1/4`}>보유 기간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                <tr>
                  <td className={tdHeadClass}>학생 이메일·성명·학번</td>
                  <td className={tdClass}>계정 관리, 명렬표 작성, 수업 도구 정리</td>
                  <td className={tdClass}>교직원</td>
                  <td className={tdClass}>졸업·전출 계정 정리 시 함께 삭제</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>생활지도 기록(지도 항목·발생일·비고)</td>
                  <td className={tdClass}>학생 생활지도. 민감 정보로 취급</td>
                  <td className={tdClass}>담임 교사는 담당 학급에 한함. 그 외 별도 권한을 부여받은 교사</td>
                  <td className={tdClass}>졸업·제적 시 파기</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>졸업 계정 정리 안내 확인 기록(서명 포함)</td>
                  <td className={tdClass}>계정 삭제 안내 고지 증빙</td>
                  <td className={tdClass}>교직원</td>
                  <td className={tdClass}>제출 후 3년 보존 후 파기</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className={`list-disc list-inside ${bodyTextClass} space-y-1 pt-1`}>
            <li>주민등록번호, 개인 전화번호(휴대전화·자택 전화), 주소, 학부모 정보는 수집·저장하지 않습니다. (업무용 내선번호는 본인 또는 관리자가 직접 등록하는 선택 항목입니다.)</li>

            <li>
              구글 계정 내 메일·드라이브 등의 원본 데이터는 본 시스템이 아닌 학교–Google 간
              교육용 계약(Google Workspace for Education)에 따라 관리됩니다.
            </li>
          </ul>
        </div>

        {/* 3. 위탁 및 제3자 제공 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>3. 개인정보의 위탁 및 제3자 제공</h2>
          <p className={bodyTextClass}>
            본 시스템은 다음의 외부 서비스를 이용하여 운영되며, 데이터의 저장·처리는 해당 업체의 서버에서 이루어집니다.
          </p>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={`${thClass} w-1/4`}>위탁 업체</th>
                  <th className={`${thClass} w-2/4`}>위탁 업무</th>
                  <th className={`${thClass} w-1/4`}>보관 위치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                <tr>
                  <td className={tdHeadClass}>Google (Firebase)</td>
                  <td className={tdClass}>로그인 인증, 시스템 데이터 저장</td>
                  <td className={tdClass}>Google Cloud 서버</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>Vercel</td>
                  <td className={tdClass}>웹 애플리케이션 호스팅</td>
                  <td className={tdClass}>Vercel 서버(미국)</td>
                </tr>
                <tr>
                  <td className={tdHeadClass}>Google (Workspace)</td>
                  <td className={tdClass}>학교 계정·메일·수업 도구 관리, 알림 발송</td>
                  <td className={tdClass}>Google 서버(학교–Google 교육용 계약)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">위 서비스 외에 개인정보를 제3자에게 제공하지 않습니다.</p>
        </div>

        {/* 4. 이용자의 권리 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>4. 이용자의 권리</h2>
          <ul className={`list-disc list-inside ${bodyTextClass} space-y-1.5`}>
            <li>학생·학부모·교직원은 언제든지 자신의 개인정보에 대한 열람·정정·삭제를 요청할 수 있습니다.</li>
            <li>요청은 담임 교사 또는 플랫폼 담당자(playviolin@hmh.or.kr)에게 합니다.</li>
            <li>학교가 의무적으로 보존하여야 하는 기록은 삭제가 제한될 수 있으며, 이 경우 그 사유를 안내합니다.</li>
          </ul>
        </div>

        {/* 5. 보호 조치 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>5. 개인정보 보호를 위한 조치</h2>
          <ul className={`list-disc list-inside ${bodyTextClass} space-y-1.5`}>
            <li>학교 구글 계정(@hmh.or.kr)으로만 로그인할 수 있습니다.</li>
            <li>역할과 권한에 따라 열람 범위를 제한합니다. 생활지도 기록은 담임 교사와 별도 권한을 부여받은 교사만 열람할 수 있습니다.</li>
            <li>민감 정보는 화면에서 저장소에 직접 접근할 수 없으며, 서버의 권한 검사를 거쳐야만 처리됩니다.</li>
            <li>모든 통신은 암호화(HTTPS)하여 전송합니다.</li>
            <li>계정 삭제, 기록 무효화 등 중요한 작업은 작업자와 일시를 감사 기록으로 남깁니다.</li>
          </ul>
        </div>

        {/* 6. 개정 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>6. 안내의 개정</h2>
          <p className={bodyTextClass}>
            본 시스템은 기능이 지속적으로 추가되고 있습니다. 처리하는 개인정보가 변경되는 경우
            본 안내를 개정하고 로그인 시 재고지하며, 별도의 동의가 필요한 사항이 발생하는 경우
            그 시점에 동의 절차를 거칩니다.
          </p>
          <p className="text-xs text-slate-400 mt-2">최종 수정일: 2026년 8월 13일 (내선번호 선택 등록 반영)</p>

        </div>

        {/* 7. 문의처 */}
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>7. 문의처</h2>
          <p className={bodyTextClass}>
            개인정보 처리에 관한 문의는 플랫폼 담당자(playviolin@hmh.or.kr)에게 합니다.
          </p>
        </div>

        {/* 하단 이동 */}
        <div className="text-center pt-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-lg transition-all shadow-sm"
          >
            로그인 페이지로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
