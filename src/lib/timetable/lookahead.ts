/**
 * 수읽기 엔진 L1 — 결정론 빔 탐색으로 기보(수순)를 제안 (timetable_lookahead_spec §2·§3)
 *
 * 체스 엔진과 같은 원리: LLM이 아니다. 수는 채점기(moveCandidates — 본검사기 단일 소재지)가
 * 만들고, 평가는 사전식 [목표 감점 해소, 공식 총점]이다. AI 호출 0 · Firestore 읽기 0 ·
 * 같은 입력 = 같은 기보(결정론).
 *
 * L1 범위: 이동·맞바꿈(swap op)만 — 빼두기(park)를 중간 수로 쓰는 수읽기는 L2(스펙 §6).
 * displace(밀어내기)도 held 상태를 남기므로 L1 제외.
 *
 * 예산: validateTimetable 호출 수로 센다(엔진 비용의 사실상 전부). 소진 시 그때까지의
 * 최선 기보만 반환하고 budgetExhausted를 정직하게 표시한다 — 화면은 "N가지 수를 읽었습니다 +
 * 더 깊이 읽기"로 노출한다(스펙 §2).
 */
import {
  ClassGrid,
  TimetableConstraintModel,
  BaseRevisionOp,
  SoftPenaltyCode,
  TermPenaltyDetail,
} from "./types";
import { validateTimetable } from "./validate";
import { applyRevisionOps, cloneClassGrids } from "./utils";
import { evaluateMoveCandidates } from "./moveCandidates";

export interface LookaheadTarget {
  /** 감점 항목의 축 — TermPenaltyDetail.scope 그대로 */
  scope: "teacher" | "class";
  /** teacher = 이메일, class = "학년-반" (TermPenaltyDetail.key 그대로) */
  key: string;
  /** 감점 항목의 요일 (0 또는 생략 = 요일 무관 항목) */
  day?: number;
  /** 좁히고 싶은 감점 코드 (생략 = 그 축·요일의 전 감점) */
  code?: SoftPenaltyCode;
}

export interface LookaheadLine {
  /** 한 수 = op 1건 (직접 조정과 같은 어휘 — 전부 같은 학급 swap) */
  ops: BaseRevisionOp[];
  /** 수마다 적용 후 공식 총점 — 중간 악화 라인도 정직 표시 (스펙 §3) */
  stepScores: number[];
  /** 최종 총점 변화 (음수 = 개선) */
  finalDelta: number;
  /** 목표 감점이 0이 됐는가 */
  targetResolved: boolean;
  /** 목표 감점 점수 변화 (음수 = 개선) */
  targetDelta: number;
  /** 미니 그리드 미리보기용 — 이 기보가 건드리는 칸들 */
  touched: Array<{ grade: number; classNum: number; day: number; period: number }>;
  /**
   * **목표 말고 다른 감점이 어떻게 되는가** (2026-08-22 사용자 실기기 요구).
   *
   * 총점만 보여 주면 「0.5점 개선」이 어디서 벌고 어디서 잃은 숫자인지 알 수 없어
   * *"이 감점을 늘리더라도 진행할지"* 를 판단할 수 없다. 그래서 목표 감점을 뺀 나머지의
   * 변화를 전건 싣는다. `text`는 **검사기가 쓴 문장 그대로**다(문구 단일 원본).
   *
   * 나빠지는 것(`worse`·`new`)이 먼저 오도록 정렬해 둔다 — 화면이 그대로 쓰면 된다.
   */
  sideEffects: LookaheadSideEffect[];
}

export interface LookaheadSideEffect {
  /** new = 없던 것이 생김 · worse = 커짐 · gone = 없어짐 · better = 줄어듦 */
  kind: "new" | "worse" | "gone" | "better";
  code: SoftPenaltyCode;
  /** 검사기가 만든 사람 문장 (예: "김○○ 화요일 시수 쏠림 (5시간)") */
  text: string;
  before: number;
  after: number;
  /** 양수 = 나빠짐 */
  delta: number;
}

export interface LookaheadResult {
  lines: LookaheadLine[];
  /** 이번 탐색이 소모한 검사기 호출 수 ("N가지 수를 읽었습니다" 표시용) */
  evaluated: number;
  budgetExhausted: boolean;
}

/** 목표 감점 점수 — report에서 target에 해당하는 감점 합 */
function targetPoints(
  report: ReturnType<typeof validateTimetable>,
  target: LookaheadTarget
): number {
  let sum = 0;
  for (const d of report.soft.details) {
    if (d.scope !== target.scope || d.key !== target.key) continue;
    if (target.day !== undefined && target.day !== 0 && d.day !== target.day) continue;
    if (target.code && d.code !== target.code) continue;
    sum += d.points;
  }
  return sum;
}

interface BeamNode {
  grids: ClassGrid[];
  ops: BaseRevisionOp[];
  stepScores: number[];
  touched: LookaheadLine["touched"];
  total: number; // 공식 총점
  tp: number; // 목표 감점
}

export function searchLookaheadLines(args: {
  grids: ClassGrid[];
  model: TimetableConstraintModel;
  target: LookaheadTarget;
  /** 최대 수읽기 깊이 (기본 4) */
  depth?: number;
  /** 빔 폭 — 깊이마다 살아남는 국면 수 (기본 4) */
  beamWidth?: number;
  /** 국면당 전개할 수(手) 상한 (기본 4) */
  movesPerNode?: number;
  /** 국면당 집어볼 수업 상한 (기본 6) */
  picksPerNode?: number;
  /** 검사기 호출 예산 (기본 1500 — 화면 「더 깊이 읽기」로 증액) */
  budget?: number;
}): LookaheadResult {
  const { grids, model, target } = args;
  const depth = args.depth ?? 4;
  const beamWidth = args.beamWidth ?? 4;
  const movesPerNode = args.movesPerNode ?? 4;
  const picksPerNode = args.picksPerNode ?? 6;
  const budget = args.budget ?? 1500;

  let evaluated = 0;
  let exhausted = false;
  const spend = (n: number): boolean => {
    if (evaluated + n > budget) {
      exhausted = true;
      return false;
    }
    evaluated += n;
    return true;
  };

  const baseReport = validateTimetable(grids, model);
  evaluated += 1;
  const baseTotal = baseReport.soft.total;
  const baseTp = targetPoints(baseReport, target);
  if (baseTp <= 0) return { lines: [], evaluated, budgetExhausted: false };

  /** 목표와 관련된 집기 후보 칸 — 결정론 정렬 (day, period, 학급) */
  const relatedPicks = (
    g: ClassGrid[]
  ): Array<{ grade: number; classNum: number; day: number; period: number }> => {
    const out: Array<{ grade: number; classNum: number; day: number; period: number }> = [];
    for (const grid of g) {
      for (const cell of grid.cells || []) {
        if (!(cell.lessons || []).length) continue;
        if (target.day !== undefined && target.day !== 0 && cell.day !== target.day) continue;
        if (target.scope === "class") {
          if (`${grid.grade}-${grid.classNum}` !== target.key) continue;
        } else {
          const hit = cell.lessons.some((l) =>
            (l.teachers || []).some(
              (t) => (t.email || "").trim().toLowerCase() === target.key
            )
          );
          if (!hit) continue;
        }
        out.push({ grade: grid.grade, classNum: grid.classNum, day: cell.day, period: cell.period });
      }
    }
    out.sort((a, b) => a.day - b.day || a.period - b.period || a.grade - b.grade || a.classNum - b.classNum);
    return out.slice(0, picksPerNode);
  };

  const opKey = (op: BaseRevisionOp): string =>
    op.type === "swap"
      ? `${op.grade}-${op.classNum}|${[`${op.a.day}-${op.a.period}`, `${op.b.day}-${op.b.period}`].sort().join("|")}`
      : JSON.stringify(op);

  let beam: BeamNode[] = [
    { grids, ops: [], stepScores: [], touched: [], total: baseTotal, tp: baseTp },
  ];
  const done: LookaheadLine[] = [];
  const seenLines = new Set<string>();

  for (let d = 0; d < depth && beam.length && !exhausted; d++) {
    const nextNodes: BeamNode[] = [];
    for (const node of beam) {
      if (exhausted) break;
      const picks = relatedPicks(node.grids);
      for (const pick of picks) {
        // evaluateMoveCandidates 비용 ≈ 기준 1회 + 후보칸 수 — 보수적으로 36으로 계상
        if (!spend(36)) break;
        const res = evaluateMoveCandidates({ grids: node.grids, model, pick });
        if (res.pickBlocked) continue;
        // L1 수 = move/swap 후보만, 개선 우선 정렬 (결정론: delta → day → period)
        const moves = res.candidates
          .filter((c) => c.verdict !== "blocked" && (c.kind === "move" || c.kind === "swap"))
          .sort((a, b) => a.softDelta - b.softDelta || a.day - b.day || a.period - b.period)
          .slice(0, movesPerNode);
        for (const mv of moves) {
          const op: BaseRevisionOp = {
            type: "swap",
            grade: pick.grade,
            classNum: pick.classNum,
            a: { day: pick.day, period: pick.period },
            b: { day: mv.day, period: mv.period },
          };
          // 직전 수를 그대로 되무르는 왕복 수는 배제 (제자리걸음 방지)
          if (node.ops.length && opKey(node.ops[node.ops.length - 1]) === opKey(op)) continue;
          if (!spend(1)) break;
          const trial = cloneClassGrids(node.grids);
          applyRevisionOps(trial, [op]);
          const rep = validateTimetable(trial, model);
          const child: BeamNode = {
            grids: trial,
            ops: [...node.ops, op],
            stepScores: [...node.stepScores, rep.soft.total],
            touched: [
              ...node.touched,
              { grade: pick.grade, classNum: pick.classNum, day: pick.day, period: pick.period },
              { grade: pick.grade, classNum: pick.classNum, day: mv.day, period: mv.period },
            ],
            total: rep.soft.total,
            tp: targetPoints(rep, target),
          };
          if (child.tp <= 0) {
            const lineKey = child.ops.map(opKey).sort().join("§");
            if (!seenLines.has(lineKey)) {
              seenLines.add(lineKey);
              done.push({
                ops: child.ops,
                stepScores: child.stepScores,
                finalDelta: child.total - baseTotal,
                targetResolved: true,
                targetDelta: child.tp - baseTp,
                touched: child.touched,
                sideEffects: [],
              });
            }
          } else {
            nextNodes.push(child);
          }
        }
      }
    }
    // 빔 선발 — 사전식 [목표 감점, 공식 총점], 동률은 수순 짧은 것
    nextNodes.sort(
      (a, b) => a.tp - b.tp || a.total - b.total || a.ops.length - b.ops.length
    );
    beam = nextNodes.slice(0, beamWidth);
  }

  // 완결 기보가 없으면 부분 개선(목표 감점을 줄인) 기보라도 상위로
  if (done.length === 0) {
    for (const node of beam) {
      if (node.tp < baseTp && node.ops.length) {
        done.push({
          ops: node.ops,
          stepScores: node.stepScores,
          finalDelta: node.total - baseTotal,
          targetResolved: false,
          targetDelta: node.tp - baseTp,
          touched: node.touched,
          sideEffects: [],
        });
      }
    }
  }

  done.sort(
    (a, b) =>
      Number(b.targetResolved) - Number(a.targetResolved) ||
      a.finalDelta - b.finalDelta ||
      a.ops.length - b.ops.length
  );
  const top = done.slice(0, 3);
  // 부작용은 **돌려줄 기보에만** 계산한다 — 탐색 중 전 노드에 들고 다니면 메모리·시간이
  // 붙는데, 사용자가 보는 것은 상위 3개뿐이다. 기보당 검사기 1회면 된다.
  for (const line of top) {
    const g = cloneClassGrids(grids);
    applyRevisionOps(g, line.ops);
    line.sideEffects = diffSideEffects(baseReport, validateTimetable(g, model), target);
  }
  return { lines: top, evaluated, budgetExhausted: exhausted };
}

/** 감점 한 건의 신원 — 같은 코드·대상·요일이면 같은 감점으로 본다 */
function detailKey(d: {
  code: string;
  scope: string;
  key: string;
  day: number;
}): string {
  return `${d.code}|${d.scope}|${d.key}|${d.day}`;
}

/**
 * 목표를 **뺀** 나머지 감점의 전후 대조.
 *
 * 목표 감점은 `targetDelta`가 따로 말하므로 여기서 제외한다 — 안 그러면 화면에서
 * "이 감점 해소"와 "이 감점 줄어듦"이 겹쳐 나와 무엇이 대가인지 흐려진다.
 */
function diffSideEffects(
  before: ReturnType<typeof validateTimetable>,
  after: ReturnType<typeof validateTimetable>,
  target: LookaheadTarget
): LookaheadSideEffect[] {
  const isTarget = (d: TermPenaltyDetail) => {
    if (d.scope !== target.scope || d.key !== target.key) return false;
    if (target.day !== undefined && target.day !== 0 && d.day !== target.day) return false;
    if (target.code && d.code !== target.code) return false;
    return true;
  };
  const sum = (rep: ReturnType<typeof validateTimetable>) => {
    const m = new Map<string, { d: TermPenaltyDetail; points: number }>();
    for (const d of rep.soft.details) {
      if (isTarget(d)) continue;
      const k = detailKey(d);
      const cur = m.get(k);
      if (cur) cur.points += d.points;
      else m.set(k, { d, points: d.points });
    }
    return m;
  };
  const b = sum(before);
  const a = sum(after);
  const out: LookaheadSideEffect[] = [];
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const bp = b.get(k)?.points ?? 0;
    const ap = a.get(k)?.points ?? 0;
    if (bp === ap) continue;
    const d = (a.get(k) ?? b.get(k))!.d;
    out.push({
      kind: bp === 0 ? "new" : ap === 0 ? "gone" : ap > bp ? "worse" : "better",
      code: d.code,
      text: d.text,
      before: bp,
      after: ap,
      delta: ap - bp,
    });
  }
  // 나빠지는 것이 위로, 그 안에서는 크게 나빠진 것이 위로 (화면이 그대로 쓴다)
  out.sort((x, y) => y.delta - x.delta || x.text.localeCompare(y.text));
  return out;
}
