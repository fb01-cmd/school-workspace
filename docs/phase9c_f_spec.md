# Phase 9c-F — NEIS 일괄 내보내기 스펙 v1 (2026-08-11)

> 상위: [`phase9c_spec.md`](./phase9c_spec.md) §8. 완전 대체 4축(①자동 생성 ②검증 ③수동 미세조정 ④NEIS 일괄 내보내기)의 마지막 축.
> 원천: 매뉴얼 §10(NEIS 일괄 업로드) + [`9c_research_notes.md`](./9c_research_notes.md) §2 (빈칸 문제 = 알려진 함정).

## 0. 범위 분할 — F-1 (지금) / F-2 (9월 샘플 확보 후)

CSV 정확 스키마는 **컴시간 NEIS 폴더 샘플 파일을 확보해야 확정**된다(9월 질문지 요청 항목). 따라서:

- **F-1 (이번 구현)**: NEIS 매핑 등록부 + **사전 검증 리포트** — 샘플 없이도 설계가 닫히는 부분. 빈칸 3원인 예방이 Phase F의 실무 가치 핵심이므로 선행 구현이 맞다. 로직·API = Claude, UI = Antigravity.
- **F-2 (샘플 확보 후)**: 학급별 CSV 직렬화 + 다운로드. 파일명 `기초시간표(YYYY-학년,반).csv` 관례 계승, 인코딩(EUC-KR 가능성)·컬럼 구조·창체/가상 교사 표현은 샘플로 확정.

## 1. 문제의 성격 — 검증의 이원화

나이스 업로드 후 **빈칸이 나오는 3원인**(매뉴얼 §10·FAQ): ① 과목명이 NEIS에 미등록 ② 교사명이 NEIS에 미등록 ③ 교사-과목 담당이 NEIS에 미등록.

근본 제약: **플랫폼은 NEIS를 조회할 수 없다.** 그러므로 검증은 두 층으로 갈린다:

| 층 | 무엇을 아는가 | 판정 성격 |
|---|---|---|
| **차단(Blocker)** | 플랫폼이 스스로 아는 것 — 과목 NEIS명 매핑 데이터의 유무 | 미비 시 내보내기 불가 (틀린 CSV를 만들 수 없음) |
| **체크리스트(Warning)** | NEIS 쪽 등록 상태 — 플랫폼은 검증 불가, 일과계가 나이스 화면에서 확인 후 표시 | 자가 확인. 잔존 시 내보내기는 가능하되 F-2에서 확인 다이얼로그 |

리포트의 역할 = "업로드 전에 나이스에서 등록해야 할 것"의 **실행 가능한 목록**을 뽑아주는 것 (9c §3-4 눈높이 원칙 계승 — 조치 단위로만 노출).

## 2. 데이터 모델 — NEIS 매핑 등록부

`timetable_neis_map/{domain}` **단일 문서, 학기 무관 영속**.

> **9c 스펙 §8 정정(v1.1)**: 원안 "정식과목명·단축과목명 구조에 NEIS명 열 추가"는 기각 — `term.subjects`는 가져오기마다 재생성되고 초안 승격 시에도 새로 만들어져, 거기에 열을 추가하면 **신학기마다 매핑이 유실**된다. NEIS 등재명은 학기를 넘어 안정적인 데이터이므로 별도 영속 등록부가 맞다.

```typescript
interface NeisSubjectMapping {
  platformName: string; // 우리 정식 과목명 (term.subjects[].name)
  neisName: string;     // NEIS 등재명. "" = 미확정. 동일해도 명시 저장 = "확인했다"의 의미
}

interface NeisMapRegistry {
  subjects: NeisSubjectMapping[];
  confirmedTeachers: string[]; // teacherKey(이메일 소문자) — "NEIS에 교원 등재 확인함"
  confirmedPairs: string[];    // "teacherKey|정규화 과목명" — "NEIS에 담당 등록 확인함"
  updatedBy?: string;
  updatedAt?: number;
}
```

- 과목 매칭은 `normSubject`(NFC·공백 제거·소문자 — 검사기와 동일 규약) 기준. 저장은 원문 유지.
- `confirmedPairs`의 키는 서버 리포트가 산출해 내려주는 값을 그대로 돌려 보낸다(클라 조립 금지).
- 저장은 전체 교체(revision_save_draft 패턴) + sanitize: 문자열 trim·길이 상한(60자)·목록 상한(과목 300·교사 500·pair 5,000)·중복 제거. 위반 시 400.

## 3. 사전 검증 리포트 (순수 함수 — Claude)

`buildNeisPrecheckReport(grids, registry) → NeisPrecheckReport` — Firestore 무의존, 검사기(validateTimetable)와 같은 계열의 순수 관문.

**입력 그리드 = 내보내기 대상 그대로**: 현행 학기 기초 그리드 또는 초안(Phase D draft)의 재생 현재 그리드. 시수표·제약 모델은 불필요(검사는 Phase A 소관 — 이 리포트는 매핑만 본다).

### 판정 항목

| 코드 | 층 | 내용 | 산출 |
|---|---|---|---|
| **B1** | 차단 | 그리드에 쓰인 과목 중 NEIS명 미확정(등록부에 없거나 neisName 빈 값) | 과목별 {platformName, 수업 수, 학급 수} |
| **W1** | 경고 | 가상 교사(이메일 없음 — 창체·SLAT) 수업 — NEIS 표현 방식이 미정(F-2 열린 질문) | 교사명별 수업 수 |
| **W2** | 체크리스트 | 실교사 중 NEIS 교원 등재 미확인(confirmedTeachers에 없음) | 교사별 수업 수 |
| **W3** | 체크리스트 | (실교사 × 과목) 담당 조합 중 미확인(confirmedPairs에 없음) | pair별 {교사, 과목, NEIS명, 학급 수, key} |

- `readyForExport = (B1 == 0)`. W 계열은 내보내기를 막지 않는다(§1 이원화).
- 복수교사 수업은 교사별로 각각 pair 집계(NEIS도 교사별 담당 등록).
- summary: 학급·수업·과목·실교사·pair 총수 + 각 확인 완료 수 → UI가 "23/25 과목 매핑 완료" 식 진행률 표시 가능.

### 자가 테스트

`scripts/neis_precheck_selftest.ts` (Firestore 무의존) — B1·W1·W2·W3 발화와 소거(등록부 채우면 0)를 합성 그리드로 검증. 검사기 자가 테스트(validate_selftest.ts)와 동일 관행.

## 4. API (manage 라우트 action 3종)

권한: 셋 다 authz 기본 거부 폴스루 = **일과계 관리자 + super_admin** (D-1 판단 재사용 — authz.ts 무변경).

| action | 입력 | 출력 | 비고 |
|---|---|---|---|
| `neis_map_get` | termId? (기본 active) | registry + subjectsSeed(해당 학기 과목명·약칭 목록) | seed는 UI 매핑표의 행 원천 (term 문서에 이미 있어 추가 읽기 0) |
| `neis_map_save` | neisMap (전체 교체) | success | sanitize 400 / 감사 로그 |
| `neis_precheck` | termId? 또는 draftId | report + target{kind, id, label} | draftId 지정 시 초안 재생 현재 그리드 대상 |

읽기 예산: precheck 1회 = 학급 그리드 ~30 + 등록부 1 (초안 대상이면 getDraft 경유 동일 규모). 수동 버튼 트리거라 무시 가능 수준.

## 5. UI (Antigravity — F-1 후반, IA 명시)

**배치: 기존 "NEIS 내보내기" 탭(`NeisExportTab`, activeTab === "neis") 안에 섹션 추가.** 새 탭을 만들지 않는다 — 기존 탭은 9b 수업교환 NEIS 목록(월별 입력용)이고, 기초시간표 일괄 내보내기도 같은 "나이스 입력 업무" 우산이므로 한 화면이 실무 동선에 맞다.

- 섹션 1 (기존 유지): 수업교환 NEIS 목록.
- **섹션 2 (신설): "기초시간표 일괄 내보내기(사전 검증)"**
  1. 대상 선택: 현행 학기(기본) / 자동 작성 초안 드롭다운(draft_list 재사용)
  2. [사전 검증 실행] → 리포트 표시: B1(빨강, 차단)·W1(주황)·W2/W3(체크리스트 — 항목별 "나이스에서 확인함" 체크 → neis_map_save)
  3. 과목 매핑표: subjectsSeed 기반 행(플랫폼명·약칭·NEIS명 입력칸), "전부 플랫폼명 그대로 채우기" 일괄 버튼(정식명이 이미 NEIS 일치인 경우가 다수 — 가져오기 파서의 전제) 후 개별 수정
  4. [CSV 내보내기] 버튼: F-2 전까지 **비활성 + "9월 나이스 샘플 확보 후 활성화" 안내** (자리만 마련)
- 색·경고는 U8 일람표 통합, red는 차단 전용(기존 원칙).
- UI 문구에 "매핑·registry" 같은 개발 용어 금지 — "나이스 등재명", "나이스에서 확인함" 눈높이.

## 6. F-2 — CSV 직렬화 (샘플 확보 후, 스텁)

- 학급별 1파일 `기초시간표(YYYY-학년,반).csv`, ZIP 일괄 다운로드 여부는 학급 수(30) 고려해 UI에서 결정.
- 셀 값 = **NEIS 등재명 치환**(매핑표 통과분만) + 교사명.
- 게이트: B1 = 0 필수(버튼 비활성), W 잔존 시 "미확인 N건 — 빈칸 위험" 확인 다이얼로그.
- 열린 질문(9월 질문지에 포함):
  1. 컴시간 NEIS 폴더 샘플 파일 1개 (스키마·인코딩 확정)
  2. **창체·SLAT 등 가상 교사 수업이 컴시간 NEIS 파일에서 어떻게 표현되는가** (제외? 교사명 공란? 별도 코드?)
  3. 복수교사 수업의 파일 내 표기(2행? 병기?)

## 7. 분업·순서

| 단계 | 담당 | 내용 |
|---|---|---|
| F-1a (이번) | Claude | types·순수 리포트 함수·서버 로더/저장·route action 3종·자가 테스트·실데이터 실측 |
| F-1b | Antigravity | §5 UI (NeisExportTab 섹션 2) |
| F-2 | 사용자→Claude→Antigravity | 9월 질문지 샘플 → CSV 직렬화 스펙 확정 → 구현 |

검증: 자가 테스트 + **2026-2 실데이터 실측**(빈 등록부 → B1 = 실사용 과목 전수와 일치, 시드 채움 → B1 = 0) — 검사기 Phase A와 같은 그라운드 트루스 방식.
