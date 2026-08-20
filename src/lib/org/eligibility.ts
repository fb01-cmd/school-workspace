/** 쪽지·업무를 보낼 자격 — 교직원 조직도에 소속이 등록돼 있어야 한다 (2026-08-20 단일화) */
export function canUseMessaging(
  userData: unknown,
  teacherProfile: { departments?: string[] | null } | null | undefined
): boolean {
  return !!userData && !!(teacherProfile?.departments && teacherProfile.departments.length > 0);
}
