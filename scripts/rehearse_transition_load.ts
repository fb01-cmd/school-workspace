/**
 * 전환일 부하 리허설 스펙 구현 스크립트 (docs/transition_day_rehearsal_spec.md)
 *
 * 목적:
 *   기관 일괄 전환일에 시간표 조회 API(/api/timetable/view)가 Vercel 서버리스 인스턴스 분산 환경에서
 *   콜드 스타트 비용(인스턴스당 ~85 Firestore 읽기)을 얼마나 발생시키는지 실측하고 R(냉시작 비율)을 계산합니다.
 *
 * 핵심 규칙 (스펙 §4, §5):
 *   1. 단계별 실행: --stage=0|1|2|3 파라미터를 받아 단일 단계만 실행하고 멈춥니다. 자동으로 다음 단계로 넘어가지 않습니다.
 *   2. 동시 발사: 동시성 20~50으로 마이크로 버스트 동시 요청을 보냅니다 (순차 요청 금지 - 순차 시 R이 인위적으로 낮아짐).
 *   3. R 계산: x-tt-instance (프로세스 고유 ID) header의 distinct 개수로 R을 계산합니다 (x-tt-cache 헤더 사용 금지).
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=0
 *   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=1
 *   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=2 [--url=https://school-workspace.vercel.app]
 *   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=3
 */

import { adminDb } from "../src/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";

interface RequestResult {
  index: number;
  status: number;
  instanceId: string | null;
  cacheHeader: string | null;
  hits: string | null;
  misses: string | null;
  responseTimeMs: number;
  weekId: string;
}

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

// 제한된 동시성으로 비동기 작업을 집합 처리하는 헬퍼 (동시 발사)
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const stageStr = parseArg("stage");
  if (!stageStr || !["0", "1", "2", "3"].includes(stageStr)) {
    console.error(`
❌ 오류: --stage=0|1|2|3 파라미터가 필요합니다.

사용법:
  npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=0
  npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=1
  npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=2
  npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=3 [--url=https://YOUR_PROD_URL]

단계별 실행 예산 (docs/transition_day_rehearsal_spec.md §4):
  - Stage 0: 1건    (최악 읽기 87)     - 헤더 수신 정상성 점검
  - Stage 1: 30건   (최악 읽기 2,610)  - R 1차 추정 (동시성 20)
  - Stage 2: 150건  (최악 읽기 13,050) - R 확정 및 통과 판정 (동시성 30)
  - Stage 3: 600건  (최악 읽기 52,200) - 조건부 부하 실측 (Stage 2 R < 0.10일 때 명시적 수동 실행)
`);
    process.exit(1);
  }

  const stage = parseInt(stageStr, 10);

  // Stage별 파라미터 (요청 수, 동시성)
  const STAGE_CONFIGS: Record<number, { requests: number; concurrency: number }> = {
    0: { requests: 1, concurrency: 1 },
    1: { requests: 30, concurrency: 20 },
    2: { requests: 150, concurrency: 30 },
    3: { requests: 600, concurrency: 50 },
  };

  const config = STAGE_CONFIGS[stage];

  // ── 안전 가드 (docs/transition_day_rehearsal_spec.md §4) ─────────────────
  // 지침이 문서에만 있으면 실행하는 자리에서는 아무도 보지 않는다.
  // 이 스크립트는 실서비스 할당량을 태우므로 가드를 여기에 둔다.
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const kstMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const RESET_MIN = 16 * 60; // 할당량 리셋 = KST 16:00
  const inSafeWindow = kstMin >= RESET_MIN - 30 && kstMin < RESET_MIN; // 15:30~15:59
  const worstReads = config.requests * (2 + 85); // R=1 최악 가정

  console.log(`- 현재 시각     : KST ${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`);
  console.log(`- 최악 읽기     : 약 ${worstReads.toLocaleString()}회 (R=1 가정, 무료 일일 한도 50,000)`);

  if (stage >= 2) {
    // 2026-08-14 사용자 정정: 확산이 모듈별 점진이라 지금 규모에선 캐시가 안 돌아도 한도 안이다.
    // 큰 단계는 실사용이 실제로 커진 뒤에 의미가 있다 (스펙 상단 전제 정정 참조).
    console.warn(`\n⚠️  Stage ${stage}는 지금 권장되지 않습니다.`);
    console.warn(`    확산이 점진적이라(모듈별 순차 이동) 현재 사용 규모에서는 캐시가 전혀 안 돌아도`);
    console.warn(`    무료 한도 안입니다. 지금 돌리면 답이 정해진 측정에 할당량만 씁니다.`);
    console.warn(`    → 하루 요청이 1,000을 넘기 시작한 뒤에 하세요. 그전엔 Stage 0~1로 충분합니다.`);
    if (!process.argv.includes("--force")) {
      console.error(`\n중단합니다. 그래도 돌리려면 --force 를 붙이세요.`);
      process.exit(1);
    }
    console.warn(`    --force 확인됨. 계속합니다.\n`);
  }

  if (!inSafeWindow && stage >= 1) {
    console.warn(`\n⚠️  권장 실행 시각이 아닙니다 — KST 15:30~15:59 (할당량 리셋 직전)에 하세요.`);
    console.warn(`    리셋 직후에 태우면 그 소모가 이후 24시간 예산을 깎고, 소진되면 다음 리셋까지`);
    console.warn(`    하루 종일 막힙니다(2026-08-08 전면 401이 그 형태). 리셋 직전이면 최악이라도`);
    console.warn(`    몇 분만 영향받고, 어차피 소멸할 잔여 할당량을 쓰는 셈입니다.`);
    if (!process.argv.includes("--force")) {
      console.error(`\n중단합니다. 그래도 돌리려면 --force 를 붙이세요.`);
      process.exit(1);
    }
    console.warn(`    --force 확인됨. 계속합니다.\n`);
  }
  // ─────────────────────────────────────────────────────────────────────────
  let rawUrl = parseArg("url") || process.env.PROD_URL || process.env.NEXT_PUBLIC_APP_URL || "https://school-workspace-eight.vercel.app";
  const targetUrl = rawUrl.replace(/\/+$/, "");

  console.log(`\n🚀 [전환일 리허설 실행] Stage ${stage}`);
  console.log(`------------------------------------------------------`);
  console.log(`- Target URL   : ${targetUrl}`);
  console.log(`- Total Requests: ${config.requests}건`);
  console.log(`- Concurrency   : ${config.concurrency} (동시 발사)`);

  if (targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1")) {
    console.warn(`\n⚠️  경고: 대상이 로컬 환경(${targetUrl})입니다.`);
    console.warn(`    로컬은 단일 Node 프로세스라 R(인스턴스 분산)이 항상 0에 수렴하여 측정이 무의미합니다.`);
    console.warn(`    실제 판정은 Vercel 프로덕션 URL에서 수행하세요.\n`);
  }

  // 1. Firebase 인증: Firestore에서 교사/super_admin 계정 1개 조회 및 customToken -> idToken 발급
  console.log(`🔑 Firebase Admin SDK로 인증 토큰 생성 중...`);
  const userSnap = await adminDb
    .collection("users")
    .where("role", "in", ["teacher", "super_admin"])
    .limit(1)
    .get();

  if (userSnap.empty) {
    throw new Error("Firestore users 컬렉션에서 teacher / super_admin 권한을 가진 유저를 찾을 수 없습니다.");
  }

  const teacherDoc = userSnap.docs[0];
  const uid = teacherDoc.id;
  const teacherEmail = teacherDoc.data().email || "unknown";
  console.log(`- 인증 대상 유저: ${teacherEmail} (UID: ${uid}, Role: ${teacherDoc.data().role})`);

  const authAdmin = getAuth();
  const customToken = await authAdmin.createCustomToken(uid);

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const tokenRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const tokenData = await tokenRes.json();
  if (!tokenData.idToken) {
    throw new Error(`Firebase Custom Token 교환 실패: ${JSON.stringify(tokenData)}`);
  }

  const idToken = tokenData.idToken;
  console.log(`✅ Firebase ID Token 발급 완료!`);

  // 2. Firestore에서 해당 도메인의 실재 주차(week) 목록 조회 (요청 다양성 흉내)
  const domain = teacherEmail.split("@")[1] || "hmh.or.kr";
  const weeksSnap = await adminDb
    .collection("timetable_weeks")
    .where("domain", "==", domain)
    .get();

  let weekIds: (string | undefined)[] = weeksSnap.docs.map((d) => d.id || d.data().id).filter(Boolean);
  if (weekIds.length === 0) {
    console.log(`ℹ️ 등록된 주차 문서가 없어 현재 주차(default) 폴백으로 요청을 보냅니다.`);
    weekIds = [undefined];
  } else {
    console.log(`✅ Firestore 등록 주차(${weekIds.length}개) 로드 완료: ${weekIds.slice(0, 5).join(", ")}...`);
  }

  // 3. 동시 발사 요청 실행 (주(week) 파라미터 다변화)
  console.log(`\n⚡ 동시 발사 시작 (${config.requests}개 요청, 동시성 ${config.concurrency})...`);
  const items = Array.from({ length: config.requests }, (_, i) => i);

  const startTime = Date.now();

  const results = await runConcurrent(items, config.concurrency, async (idx) => {
    const targetWeekId = weekIds[idx % weekIds.length];
    const reqUrl = `${targetUrl}/api/timetable/view`;
    const reqStart = Date.now();
    try {
      const payload: any = { action: "my" };
      if (targetWeekId) payload.weekId = targetWeekId;

      const resp = await fetch(reqUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `token=${idToken}`,
        },
        body: JSON.stringify(payload),
        redirect: "manual",
      });
      const elapsed = Date.now() - reqStart;
      return {
        index: idx,
        status: resp.status,
        instanceId: resp.headers.get("x-tt-instance"),
        cacheHeader: resp.headers.get("x-tt-cache"),
        hits: resp.headers.get("x-tt-hits"),
        misses: resp.headers.get("x-tt-misses"),
        responseTimeMs: elapsed,
        weekId: targetWeekId || "current",
      };
    } catch (err: any) {
      if (idx === 0) {
        console.warn(`⚠️ [요청 0 실패 상세]: ${err.message || err}`);
      }
      return {
        index: idx,
        status: 0,
        instanceId: null,
        cacheHeader: null,
        hits: null,
        misses: null,
        responseTimeMs: Date.now() - reqStart,
        weekId: targetWeekId || "current",
      };
    }
  });

  const totalDuration = Date.now() - startTime;

  // 3. 지표 집계 (R 계산: x-tt-instance distinct 수 기준)
  const validResults = results.filter((r) => r.status === 200 && r.instanceId);
  const totalCount = results.length;
  const validCount = validResults.length;

  const instanceSet = new Set(validResults.map((r) => r.instanceId));
  const distinctInstancesCount = instanceSet.size;

  // R (냉시작 비율) = distinct(x-tt-instance) / totalCount
  const R = validCount > 0 ? distinctInstancesCount / validCount : 0;
  const reqsPerInstance = distinctInstancesCount > 0 ? validCount / distinctInstancesCount : 0;

  // 전환일 3,850 요청 기준 예상 Firestore 읽기 수 식: (3850 * 2) + (3850 * R * 85)
  const estimatedReads = Math.round(7700 + 327250 * R);

  // HTTP 상태코드 요약 집계
  const statusCounts = new Map<number, number>();
  results.forEach((r) => {
    statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1);
  });
  const statusSummaryStr = Array.from(statusCounts.entries())
    .map(([st, cnt]) => `HTTP ${st}: ${cnt}건`)
    .join(", ");

  let verdict = "";
  let verdictPass = false;

  // Stage 0은 요청이 1건이라 R이 구조적으로 100%가 된다(인스턴스 1 ÷ 요청 1).
  // 거기서 판정을 내면 항상 "수정 필요"가 뜨는데, 그건 측정 결과가 아니라 표본이 1이라는 뜻이다.
  // Stage 0의 목적은 **헤더가 오는지 확인**하는 것뿐이므로 판정을 내지 않는다.
  if (stage === 0) {
    verdict = validCount > 0
      ? "⚪ 판정 없음 — Stage 0은 헤더 수신 확인 전용 (요청 1건이라 R은 항상 100%로 나온다)"
      : `🔴 측정 실패 (HTTP 200 응답 0건 - ${statusSummaryStr})`;
    verdictPass = validCount > 0;
  } else if (validCount === 0) {
    verdict = `🔴 측정 실패 (HTTP 200 응답 0건 - 응답 상태: ${statusSummaryStr})`;
    verdictPass = false;
  } else if (R < 0.10) {
    if (reqsPerInstance < 10 && stage > 0) {
      verdict = "🟢 통과 (Pass) - ⚠️ 경고: 인스턴스당 요청 수 < 10 (부하 패턴 변화 시 주의)";
      verdictPass = true;
    } else {
      verdict = "🟢 통과 (Pass) - 냉시작 비율 10% 미만으로 전환일 안전권";
      verdictPass = true;
    }
  } else {
    verdict = "🔴 수정 필요 (Needs Fix) - 냉시작 비율 R >= 0.10 (한계선 초과, 채택 전 구조 개선 필요)";
    verdictPass = false;
  }

  // 4. 결과 보고서 출력
  console.log(`\n======================================================`);
  console.log(`📊 [전환일 리허설 결과 보고서 - Stage ${stage}]`);
  console.log(`======================================================`);
  console.log(`- 대상 서버 URL       : ${targetUrl}`);
  console.log(`- 인증 사용자         : ${teacherEmail} (UID: ${uid})`);
  console.log(`- 동시성 설정         : ${config.concurrency} (동시 처리)`);
  console.log(`- 소요 시간           : ${totalDuration} ms`);
  console.log(`- 총 요청 수          : ${totalCount}건 (HTTP 200 성공: ${validCount}건)`);
  console.log(`- Distinct 인스턴스 수: ${distinctInstancesCount}개 (x-tt-instance 기반)`);
  console.log(`- 냉시작 비율 (R)     : ${(R * 100).toFixed(2)}% (${R.toFixed(4)})`);
  console.log(`- 인스턴스당 요청 수  : ${reqsPerInstance.toFixed(1)}건/인스턴스`);
  if (stage === 0) {
    console.log(`- 예상 읽기           : (Stage 0은 표본 1건이라 산출하지 않음)`);
  } else {
    // 주의: 3,850요청은 "전 교직원·학생이 일제히 쓰는" 가상의 최대 규모다.
    // 2026-08-14 사용자 정정으로 실제 확산은 모듈별 점진이라 당분간 이 규모에 닿지 않는다.
    // 현재 규모(하루 수백 요청)에서는 R=1이어도 한도 안이다 — 아래 값은 미래 상한선으로 읽어라.
    console.log(`- 예상 읽기(최대규모) : ${estimatedReads.toLocaleString()}회/일 (가상 3,850요청 기준, 허용 40,000)`);
    console.log(`  ※ 현재 실사용은 이보다 훨씬 작다. 이 값은 "많이 쓰게 되면" 기준의 상한선이다.`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`- 최종 판정           : ${verdict}`);
  console.log(`======================================================\n`);

  if (stage === 0) {
    if (validCount === 0) {
      console.error(`❌ [Stage 0 실패] 응답 헤더(x-tt-instance)를 받지 못했습니다.`);
      console.error(`   API 응답 상태코드 또는 프로덕션 배포 상태를 확인하세요.\n`);
    } else {
      console.log(`💡 [Stage 0 완료] 응답 및 x-tt-instance 헤더 정상 수신 확인.`);
      console.log(`   다음 단계 진행 명령:`);
      console.log(`   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=1 --url=${targetUrl}\n`);
    }
  } else if (stage === 1) {
    console.log(`💡 [Stage 1 완료] R 1차 추정 완료 (${(R * 100).toFixed(2)}%).`);
    console.log(`   다음 단계 진행 명령:`);
    console.log(`   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=2 --url=${targetUrl}\n`);
  } else if (stage === 2) {
    if (verdictPass) {
      console.log(`💡 [Stage 2 완료 - R < 0.10 통과] R 확정 판정이 완료되었습니다.`);
      console.log(`   수동으로 최종 부하 검증을 원하실 때만 명시적으로 Stage 3을 실행해 주세요:`);
      console.log(`   npx tsx --env-file=.env.local scripts/rehearse_transition_load.ts --stage=3 --url=${targetUrl}\n`);
    } else {
      console.log(`⚠️ [Stage 2 완료 - R >= 0.10 수정 필요]`);
      console.log(`   냉시작 비율이 한계선(10%)을 초과했습니다. Stage 3은 실행하지 마시고 docs/transition_day_rehearsal_spec.md §6 대안을 검토하세요.\n`);
    }
  } else if (stage === 3) {
    console.log(`🏁 [Stage 3 완료] 최고 부하 (600개 요청) 최종 리허설 테스트를 마쳤습니다.\n`);
  }
}

main().catch((err) => {
  console.error("\n💥 리허설 실행 중 치명적 에러 발생:", err);
  process.exit(1);
});
