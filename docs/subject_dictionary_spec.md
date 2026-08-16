# 과목 이름 단일 사전 스펙 — 추측은 관문에서 한 번, 내부는 정확 일치만

- **확정 근거**: development_roadmap.md §2 「과목 이름 단일 사전 원칙」 (2026-08-16 사용자 확정 ①~④ + 2026-08-17 다년 일반화 요건 ⑤~⑦)
- **대체 대상**: 2026-08-16 밤~17 새벽의 이름 매칭 연쇄 보수 커밋들(`ab740da`·`7953439`·`bbbe47f`·`3d47c34`·`d4e687c`·`3c9eaba`·`5e39005`·`68ea7b1`)이 만든 임시 다리. 이 규칙들은 삭제가 아니라 **관문 후보 제안 엔진으로 강등·재사용**한다.
- **분업**: 스펙+서버·엔진 코어 = Claude / 관문 UI = Antigravity (이 문서 §6이 인계 경계)

## §0. 원칙과 근거 사고

사용자 원문: *"시스템이 어떤 약칭이 뭐일 것이다를 추측하는 게 아니라, 새 테이블 짤 때 있는 그 리소스만으로 모든 시스템이 돌아가게 해야."*

2026-08-16 하루에만 실사고 3건 — 특별실 판정("과탐"↔과학탐구실험2 미연결 11건 오경보), 이동수업 대조(지구과학↔지구과학Ⅱ 미연결), H7 동시수업 위반 오탐 8건("인공Ⅱ"·"수탐A" 미연결). 각 소비자가 **각자 느슨 매칭을 반복하다 각자 다르게 틀렸다**. 매칭 규칙이 5곳+클라이언트 사본 1곳에 산재하고(전수 지도: 이 문서 §7), 규칙을 한 곳에서 고치면 다른 곳이 어긋난다.

**전환 후 세계**: 추측(느슨 매칭)은 배정표 불러오기 **관문에서 후보를 제안할 때 한 번만** 쓰고, 사람이 확정한다. 확정 결과는 사전에 박제되고, 이후 모든 내부 판정(솔버 특별실·이동수업·검사기·조립)은 **사전 항목 안에서의 정확 일치만** 쓴다.

## §1. 데이터 모델

### 1-1. 학기 사전 = `term.subjects` (기존 필드 확장)

`TimetableSubject`(types.ts)에 **확정 별칭** 필드를 추가한다:

```ts
export interface TimetableSubject {
  name: string;        // 정식 과목명 (시스템 표기 원본 — 그리드·등록부가 쓰는 그 문자열)
  shortName: string;   // 약칭
  teacherEmails: string[];
  aliases?: string[];  // [신설] 사람이 관문에서 확정한 다른 표기 ("과탐", "인공Ⅱ", "수탐A" …)
}
```

- **한 과목의 합법 표기 집합** = { name, shortName, ...aliases }. 이 집합 안에서의 정규화 완전 일치가 내부 동일성 판정의 전부다.
- aliases는 시스템이 추측해 넣지 않는다 — **관문에서 사람이 확정한 쌍만** 들어간다.
- NEIS 등재명은 기존 `NeisMapRegistry`(timetable_neis_map)가 그대로 담당한다. 이 스펙은 건드리지 않는다(축이 다름: 사전은 「우리 안 표기 동치」, NEIS 맵은 「우리 표기 ↔ 나이스 표기」).

### 1-2. 확정 이력 = `timetable_subject_history/{domain}` (신설, 학기 무관 영속 단일 문서)

요건 ⑥ "학습 아닌 기록". term.subjects는 가져오기마다 재생성되므로(§7-지도 1) 다년 기억은 별도 문서 — NeisMapRegistry와 같은 패턴.

```ts
export interface SubjectNameHistoryEntry {
  alias: string;         // 확정된 표기 ("과탐")
  canonicalName: string; // 그때 연결된 정식명 ("과학탐구실험2")
  shortName?: string;    // 그때의 약칭 (신규 등록·시딩 재사용용)
  confirmedBy: string;
  confirmedAt: number;
}
export interface SubjectNameHistory { entries: SubjectNameHistoryEntry[]; updatedAt?: number; }
```

- **소비처는 관문 후보 랭킹뿐이다.** 런타임 판정(솔버·검사기·스탬프)은 이 문서를 절대 읽지 않는다 — 읽는 순간 "기록"이 "추측 사전"으로 승격되어 원칙이 무너진다.
- 갱신은 append 우선. 같은 (alias, canonicalName) 쌍은 confirmedAt만 갱신. alias가 **다른** canonicalName으로 재확정되면 옛 엔트리를 지우고 새 엔트리를 쓴다(마지막 확정이 이긴다 — 해마다 관행이 바뀌는 실물 수용).

### 1-3. 박제 = `HoursPlanRow.subjectName / subjectShort` (기존 필드, 의미 확정)

관문 확정 후 저장되는 행은:
- `subjectName` ← 사전 항목의 `name` (그리드·등록부와 같은 문자열)
- `subjectShort` ← 사전 항목의 `shortName`
- `neisName` ← **건드리지 않는다** — 나이스 맵(NeisMapRegistry) 축의 필드를 원문 보관용으로 겸용하면 B1 검증이 오염된다. 배정표 원문 표기는 확정 이력(§1-2)에 남는다.

이후 이 행을 읽는 누구도 이름을 추측할 필요가 없다.

## §2. 단일 소재지 모듈 — `src/lib/timetable/subjectDict.ts` (신설)

매칭 규칙의 산재(§7 리스크)를 접는 단일 소재지. 다른 파일은 이 모듈만 import한다.

```ts
/** 사전 색인: 정규화 표기 → 사전 항목. 충돌(두 항목이 같은 표기 주장 — 앞 2글자 약칭 폴백
 *  관행상 실데이터에 실재: "과학"↔"과학사")은 던지지 않고 그 표기를 색인에서 제외한다 —
 *  겹친 표기는 정확 일치가 어느 쪽에도 붙지 않는다(판정 불능 = 추측 금지의 색인판).
 *  단 관문 저장의 확정 반영(applySubjectConfirmations)은 항목 표기 충돌을 오류로 거부한다. */
export function buildSubjectIndex(subjects: TimetableSubject[]): SubjectIndex;
/** 내부 판정의 전부 — 색인 정확 일치. 실패 시 null (추측하지 않는다). */
export function resolveExact(index: SubjectIndex, raw: string): TimetableSubject | null;
/** 두 표기가 같은 사전 항목인가 — 소비자용 한 줄 판정 */
export function sameSubjectExact(index: SubjectIndex, a: string, b: string): boolean;
/** 관문 전용 후보 제안 — 이력 1순위 → subjectMatches → subjectStemLoose 순. 런타임 판정에 쓰지 말 것. */
export function suggestCandidates(raw: string, subjects: TimetableSubject[], history: SubjectNameHistoryEntry[]): SubjectCandidate[];
```

- 정규화는 `normSubject`(validate.ts의 기존 단일 소재지)를 재사용한다. simul.ts·venue.ts·solver.ts의 사본 3곳은 이 모듈 경유로 수렴시킨다.
- `subjectMatches`·`subjectStemLoose`(hoursAssignment.ts)는 **이 모듈의 suggestCandidates 내부로만** 노출한다(요건: "후보 제안 엔진으로만 강등·재사용"). 기존 export는 전환 완료 시점까지 유지(§5 전환 계획).

## §3. 관문 — 배정표 불러오기 결과 화면의 대조·확정

### 3-1. 서버: `finalizeHoursAssignmentJob` 반환 확장

기존 반환에 **과목 대조 결과**를 추가한다:

```ts
subjectResolution: Array<{
  rawName: string;                 // 배정표 표기 (부서표 유래, 학년 무관 과목 단위)
  status: "exact" | "suggested" | "new";
  resolved?: { name: string; shortName: string };   // exact일 때 — 확인 불요, 표시만
  candidates: Array<{ name: string; shortName: string; via: "history" | "suggest" }>;
  historyShortName?: string;       // new일 때 신규 등록 약칭 기본값 (이력 → 앞 2글자 순)
}>;
```

- **exact**: 사전 색인 정확 일치. 자동 확정 — 사람 클릭 불요(해마다 확인 클릭이 줄어드는 경로: 별칭이 쌓일수록 exact가 늘어난다).
- **suggested**: 정확 일치는 없으나 후보 있음. 이력(history) 후보가 있으면 1순위·기본 선택으로 제시하되 **확정 클릭은 사람이 한다**.
- **new**: 후보 없음 = 신규 과목(요건 ⑤ — 교육과정 개편 대응). "새 과목 등록"으로 흡수 — 정식명은 배정표 표기, 약칭은 기본값 제시 후 사람이 수정 가능.
- **진짜 신학기(사전이 빈 학기)**: 전 항목이 new로 나온다. 이때 배정표가 사전의 시드다(확정 ④). 이력이 있으면 약칭·별칭 기본값이 채워져 클릭 수가 준다.

### 3-2. 저장: `saveHoursPlan` 파라미터 확장 + 박제 + 사전 갱신

저장 요청에 확정 목록을 싣는다:

```ts
subjectConfirmations?: Array<{
  rawName: string;
  action: "link" | "create";
  canonicalName: string;           // link: 기존 항목 name / create: 새 항목 name(=rawName 원칙)
  shortName?: string;              // create일 때 필수
}>;
```

서버가 저장 시점에 원자적으로 수행한다 (클라이언트 조립 금지 — NeisMap confirmedPairs와 같은 원칙):
1. **사전 갱신**: create → term.subjects에 새 항목 추가. link(rawName ≠ canonicalName) → 해당 항목 aliases에 rawName 추가.
2. **박제**: 전 행의 subjectName/subjectShort를 확정된 사전 항목 표기로 치환(§1-3).
3. **이력 기록**: 확정 쌍을 timetable_subject_history에 append(§1-2).
4. **검증**: 확정 후에도 사전에서 해석 안 되는 행 이름이 남으면 **저장 거부**(400) — 관문을 통과하지 않은 행이 내부로 스며드는 유일한 구멍을 막는다.

### 3-3. 학기 수명주기 (요건 ⑤)

- **승계**: 신학기 학기 문서를 만들 때 전 학기 term.subjects를 **aliases 포함** 복사한다(기존 승계 지점에 aliases만 편승). 컴시간 재가져오기가 term.subjects를 재생성하는 기존 경로(§7-지도 1-b)는 **aliases를 보존 병합**하도록 수정한다 — 재생성이 별칭을 지우면 사전이 매 가져오기마다 기억상실에 걸린다.
- **신규 과목**: 관문의 new 흐름이 유일한 입구(§3-1). 별도 과목 관리 화면은 만들지 않는다(입구가 둘이면 사전이 갈라진다).

## §4. 소비자 전환 — 내부는 정확 일치만

전수 지도(§7)의 소비자들을 다음 규칙으로 전환한다:

| 소비자 | 현행 | 전환 후 |
|---|---|---|
| `simul.ts` buildSimulMatcher(그리드 simul 스탬프·H7 검사기 경유) | 정확→약칭→줄기 3단 | `sameSubjectExact` (사전 색인) |
| `solver.ts` venueProbe(특별실 판정) | 완전→약칭 다리→느슨 2단 | `sameSubjectExact` |
| `solver.ts` 동시수업 구성원 수집(:522) | 태그 우선 + 이름 3단 폴백 | 태그 우선 + `sameSubjectExact` |
| `hoursAssignment.ts` sameSubject(조립 태그 매칭 :574) | 동치집합+느슨 2단 | `sameSubjectExact` |
| `hoursAssignment.ts` 이동수업 대조·클러스터링·개설반 정규화 | subjectMatches 직접 | `sameSubjectExact` + 미해석 표기는 확인 목록 고지 |
| `venue.ts` buildVenueMatcher(그리드 room 스탬프) | **완전일치만** (§7 비대칭 리스크) | `sameSubjectExact` — 비대칭 해소(별칭이 사전에 있으니 안전하게 넓어진다) |
| 모달 `subjectLooseMatch`(클라 사본) | 서버 규칙 수동 사본 | 관문 후보는 서버 subjectResolution이 내려주므로 **사본 삭제** (UI 인계 §6) |

**정확 일치가 실패하면?** 추측으로 메꾸지 않는다. 대신:
- 판정 소비자(스탬프·검사기): 미연결로 두되 **"사전에 없는 표기" 고지**를 확인 목록/검사 결과에 남긴다 — 출구는 "배정표 다시 불러와 관문에서 확정" 또는 등록부 표기 수정. (확인 목록 출구 규칙, AGENTS ui-copy-rules 5)
- 관문(불러오기): §3이 전담.

## §5. 전환 계획 — 안전망의 수명

한 번에 끊으면 위험한 이유: 지금 운영 학기의 등록부 태그("인공Ⅱ"·"과탐")는 아직 사전 별칭으로 확정되지 않았다. 코어만 먼저 배포하고 느슨 매칭을 즉시 제거하면 어젯밤 고친 H7·특별실 실사고가 그대로 재발한다.

- **1단계 (이번 커밋, 코어)**: 소비자들이 사전 색인 정확 일치를 **1차 판정**으로 쓰되, 실패 시 기존 느슨 매칭 폴백을 유지한다. 단 폴백이 판정을 결정하면 그 사실을 수집해 확인 목록·검사 결과에 "임시 연결 — 사전 확정 필요" 고지로 노출한다(조용한 추측 금지).
- **2단계 (관문 UI 배포 + 운영 학기 별칭 확정 후)**: 폴백 제거 — subjectMatches·subjectStemLoose의 소비자 노출을 닫고 suggestCandidates 내부로만 남긴다. 제거 조건은 "운영 학기에서 폴백 고지 0건"이며, 제거는 별도 커밋으로 한다(회귀 시 되돌리기 쉬운 단위).

## §6. Antigravity UI 인계 경계

- 결과 모달(AssignmentHoursModal)의 이슈 목록 위에 **과목 대조 섹션** 신설: subjectResolution을 exact(접힌 확인 표시)/suggested(드롭다운, 이력 후보 기본 선택)/new(약칭 입력 동반 등록 카드)로 렌더. 기존 "이동수업 현황 과목 연결" 드롭다운은 이 일반화에 흡수.
- 저장 시 subjectConfirmations 조립·전송. 미확정 항목이 남으면 저장 버튼 비활성 + 남은 개수 안내.
- 화면 문구: "사전"·"alias"·"canonical" 같은 용어 금지 — "과목 이름 맞추기"·"이 배정표의 「과탐」은 어떤 과목인가요?" 눈높이(ui-copy-rules).
- `subjectLooseMatch` 클라 사본 삭제(§4 표).

## §7. 부록 — 현행 산재 지도 (2026-08-17 전수 조사)

- 사전 원천: term.subjects는 컴시간 가져오기·그리드 채택 시 재생성(server.ts:629·8181-8199), 약칭 폴백 `slice(0,2)`.
- 매칭 함수: subjectMatches(hoursAssignment.ts:98)·subjectStemLoose(:134)·normSubject(validate.ts:40, 사본 simul/venue/solver)·canon(지역 3곳)·subjectLooseMatch(AssignmentHoursModal.tsx:216, 클라 사본).
- 소비 지점: solver.ts:451·453·522, simul.ts:45, hoursAssignment.ts:444·461·574-575·682·700·770. H7 검사기는 buildSimulMatcher 경유 간접 소비(validate.ts:269~).
- 확인된 비대칭: venue.ts:44(완전일치만) vs solver.ts:447(느슨) — 같은 특별실 판정이 경로마다 다른 규칙.

## §8. 검증 (셀프테스트)

`scripts/verify_subject_dict.ts` 신설 + `verify_hours_hwpx.ts` 회귀 유지:
1. 색인·정확 일치: name/shortName/alias 각 표기로 resolveExact 성공, 사전 밖 표기는 null.
2. 실사고 재연 4종: "과탐"↔과학탐구실험2, "지구과학"↔지구과학Ⅱ, "인공Ⅱ"↔인공지능 기초, "수탐A"↔수학과제탐구 — **별칭 확정 전에는 suggested 후보로만**, 확정 후에는 exact.
3. 경계 보호: 물리학Ⅰ/물리학Ⅱ가 어떤 경로로도 서로 엮이지 않음(후보 제안에서도 끝 숫자 보호 유지).
4. 신학기 시딩: 빈 사전 + 이력 → 전 항목 new + 약칭 기본값이 이력에서 옴.
5. 저장 가드: 미확정 표기가 남은 rows 저장 시 400.
6. 색인 충돌: 두 항목이 같은 표기(겹친 약칭)를 주장하면 그 표기는 판정 불능 처리(§2) — 정식명 해석은 계속 산다. 확정 반영 단계의 항목 표기 충돌은 오류 거부.
