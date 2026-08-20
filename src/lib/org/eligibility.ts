/** 쪽지·업무를 보낼 자격 — 교직원 조직도에 소속이 등록돼 있어야 한다 (2026-08-20 단일화) */
export function canUseMessaging(
  userData: unknown,
  teacherProfile: { departments?: string[] | null } | null | undefined
): boolean {
  return !!userData && !!(teacherProfile?.departments && teacherProfile.departments.length > 0);
}

/**
 * 「자격 없음」 표시 여부 — 자격 판정의 단순 반대가 아니다.
 *
 * `userData`가 아직 안 온 로딩 구간에서는 **false**를 돌려 경고가 번쩍이는 것을 막는다.
 * `!canUseMessaging(...)`으로 대체하면 그 깜빡임이 생긴다 (2026-08-20 단일화 시 확인).
 */
export function isMessagingIneligible(
  userData: unknown,
  teacherProfile: { departments?: string[] | null } | null | undefined
): boolean {
  return !!userData && !(teacherProfile?.departments?.length);
}
