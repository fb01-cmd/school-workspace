import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  buildSeedConfig,
  configDocRef,
  loadAuthzContext,
} from "@/lib/discipline/server";
import { judgeDiscipline } from "@/lib/discipline/authz";
import { DisciplineConfig } from "@/lib/discipline/types";

/**
 * Phase 6b: 생활지도 규정 관리 API
 *
 * POST /api/discipline/config
 * - action: "get"         → 규정 조회 (교직원 전체 — 기록 입력 화면의 항목 목록에 필요)
 * - action: "update"      → 규정 저장 (manage_rules 권한)
 * - action: "reset_grade" → 학년별 수동 리셋 마커 갱신 (manage_rules 권한)
 *                           ⚠️ 기록 삭제가 아니라 마커 갱신 — 회차 집계 기준점만 이동
 */

const ID_RE = /^[\w-]{1,50}$/;

/** 규정 payload 서버 사이드 검증 — 실패 시 오류 메시지, 성공 시 정제된 config 반환 */
function validateConfigPayload(
  body: any
): { ok: true; config: Omit<DisciplineConfig, "resetMarkers"> } | { ok: false; error: string } {
  const items = body?.items;
  const stages = body?.stages;
  const rules = body?.rules;
  const visibility = body?.visibility;

  if (!Array.isArray(items) || items.length === 0 || items.length > 200)
    return { ok: false, error: "항목(items) 목록이 비어 있거나 형식이 올바르지 않습니다." };
  if (!Array.isArray(stages) || stages.length === 0 || stages.length > 50)
    return { ok: false, error: "단계(stages) 목록이 비어 있거나 형식이 올바르지 않습니다." };
  if (!Array.isArray(rules) || rules.length > 500)
    return { ok: false, error: "규칙(rules) 목록 형식이 올바르지 않습니다." };

  const cleanItems = [];
  const itemIds = new Set<string>();
  const categories = new Set<string>();
  for (const it of items) {
    if (!it || typeof it.id !== "string" || !ID_RE.test(it.id))
      return { ok: false, error: `항목 id 형식 오류: ${String(it?.id)}` };
    if (itemIds.has(it.id)) return { ok: false, error: `항목 id 중복: ${it.id}` };
    if (typeof it.label !== "string" || !it.label.trim() || it.label.length > 100)
      return { ok: false, error: `항목 이름이 비었거나 너무 깁니다: ${it.id}` };
    const category = typeof it.category === "string" ? it.category.trim().slice(0, 50) : "";
    itemIds.add(it.id);
    if (category) categories.add(category);
    cleanItems.push({
      id: it.id,
      label: it.label.trim(),
      category,
      active: it.active !== false,
    });
  }

  const cleanStages = [];
  const stageIds = new Set<string>();
  for (const st of stages) {
    if (!st || typeof st.id !== "string" || !ID_RE.test(st.id))
      return { ok: false, error: `단계 id 형식 오류: ${String(st?.id)}` };
    if (stageIds.has(st.id)) return { ok: false, error: `단계 id 중복: ${st.id}` };
    if (typeof st.label !== "string" || !st.label.trim() || st.label.length > 100)
      return { ok: false, error: `단계 이름이 비었거나 너무 깁니다: ${st.id}` };
    const order = Number(st.order);
    if (!Number.isFinite(order))
      return { ok: false, error: `단계 순서(order)가 숫자가 아닙니다: ${st.id}` };
    stageIds.add(st.id);
    cleanStages.push({
      id: st.id,
      label: st.label.trim(),
      order,
      homeroomResolvable: st.homeroomResolvable === true,
    });
  }

  const cleanRules = [];
  const ruleIds = new Set<string>();
  for (const r of rules) {
    if (!r || typeof r.id !== "string" || !ID_RE.test(r.id))
      return { ok: false, error: `규칙 id 형식 오류: ${String(r?.id)}` };
    if (ruleIds.has(r.id)) return { ok: false, error: `규칙 id 중복: ${r.id}` };
    const t = r.trigger;
    const hasItem = typeof t?.itemId === "string" && t.itemId;
    const hasCategory = typeof t?.category === "string" && t.category;
    if (!t || (!hasItem && !hasCategory) || (hasItem && hasCategory))
      return { ok: false, error: `규칙 ${r.id}: trigger는 itemId 또는 category 중 하나만 지정해야 합니다.` };
    if (hasItem && !itemIds.has(t.itemId))
      return { ok: false, error: `규칙 ${r.id}: 존재하지 않는 항목(${t.itemId})을 참조합니다.` };
    if (hasCategory && !categories.has(t.category))
      return { ok: false, error: `규칙 ${r.id}: 존재하지 않는 카테고리(${t.category})를 참조합니다.` };
    const threshold = Number(t.countThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100)
      return { ok: false, error: `규칙 ${r.id}: 회차(countThreshold)는 1~100 정수여야 합니다.` };
    if (typeof r.targetStageId !== "string" || !stageIds.has(r.targetStageId))
      return { ok: false, error: `규칙 ${r.id}: 존재하지 않는 단계(${String(r.targetStageId)})를 참조합니다.` };
    ruleIds.add(r.id);
    cleanRules.push({
      id: r.id,
      trigger: hasItem
        ? { itemId: t.itemId, countThreshold: threshold }
        : { category: t.category, countThreshold: threshold },
      targetStageId: r.targetStageId,
    });
  }

  return {
    ok: true,
    config: {
      items: cleanItems,
      stages: cleanStages,
      rules: cleanRules,
      visibility: {
        homeroomCanViewOtherClasses: visibility?.homeroomCanViewOtherClasses === true,
      },
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    // 생활지도 데이터는 학생 역할 전면 차단 (판정 엔진 0순위와 이중 방어)
    if (auth.role === "student")
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

    const domain = auth.email.split("@")[1];
    if (!domain)
      return NextResponse.json({ error: "도메인 정보를 확인할 수 없습니다." }, { status: 400 });

    const body = await req.json();
    const { action } = body;
    const { ctx, config, configSeeded } = await loadAuthzContext(domain, auth);

    // ── 규정 조회 ──
    if (action === "get") {
      return NextResponse.json({ config, seeded: configSeeded });
    }

    // ── 규정 저장 ──
    if (action === "update") {
      const judgment = judgeDiscipline(ctx, "manage_rules");
      if (!judgment.allowed)
        return NextResponse.json({ error: "규정 편집 권한이 없습니다." }, { status: 403 });

      const validated = validateConfigPayload(body.config);
      if (!validated.ok)
        return NextResponse.json({ error: validated.error }, { status: 400 });

      // resetMarkers는 update로 건드리지 못한다 — merge로 기존 마커 보존, reset_grade 전용
      await configDocRef(domain).set(
        {
          ...validated.config,
          updatedAt: Timestamp.now(),
          updatedBy: auth.email,
        },
        { merge: true }
      );

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 규정 관리자",
        action: "생활지도 규정 저장",
        targetEmail: domain,
        details: `항목 ${validated.config.items.length}개 / 단계 ${validated.config.stages.length}개 / 규칙 ${validated.config.rules.length}개 (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true });
    }

    // ── 학년별 수동 리셋 ──
    if (action === "reset_grade") {
      const judgment = judgeDiscipline(ctx, "manage_rules");
      if (!judgment.allowed)
        return NextResponse.json({ error: "리셋 실행 권한이 없습니다." }, { status: 403 });

      const grade = Number(body.grade);
      if (!Number.isInteger(grade) || grade < 1 || grade > 3)
        return NextResponse.json({ error: "학년은 1~3 사이여야 합니다." }, { status: 400 });

      // 규정 문서가 아직 없으면(시드 상태) 마커만 있는 빈 규정이 생기지 않도록 시드를 먼저 영속화
      const snap = await configDocRef(domain).get();
      if (!snap.exists) {
        await configDocRef(domain).set({
          ...buildSeedConfig(),
          resetMarkers: {},
          updatedAt: Timestamp.now(),
          updatedBy: auth.email,
        });
      }

      const now = Timestamp.now();
      await configDocRef(domain).set(
        { resetMarkers: { [String(grade)]: now } },
        { merge: true }
      );

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 규정 관리자",
        action: "생활지도 회차 리셋",
        targetEmail: domain,
        details: `${grade}학년 회차 집계 리셋 (기록 삭제 아님 — 마커 갱신, 판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, grade, resetAt: now.toMillis() });
    }

    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("[Discipline Config API Error]:", error);
    return NextResponse.json(
      { error: `규정 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
