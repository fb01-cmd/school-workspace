/**
 * 교사 자동가입 GWS 그룹 기본 목록 — **단일 소재지**.
 *
 * 실제 운영 목록은 `settings/{domain}.teacherSettings.autoJoinGroups`이고 이 상수는
 * 그 값이 없을 때의 폴백이다. 원래 이 배열이 두 곳(lifecycle 서버 폴백·OUConfiguration
 * 화면 초기값)에 통째로 복붙돼 있었다 — 그룹명을 바꿀 때 한쪽만 고치면 화면에는 새 목록이
 * 뜨는데 설정 문서가 빈 학교에서는 실제 프로비저닝이 옛 목록으로 돈다(2026-08-13 전수
 * 스캔에서 발견, `DEFAULT_DEPARTMENTS` 5곳 복붙과 같은 계열). 순수 상수 파일이므로
 * 서버·클라이언트 어느 쪽에서 import해도 안전하다.
 */
export const DEFAULT_TEACHER_GROUPS = [
  "ts@hmh.or.kr",
  "classroom_teachers@hmh.or.kr",
  "hmhteacher@hmh.or.kr",
  "hmh_teachers@hmh.or.kr",
];
