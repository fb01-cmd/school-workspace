# 주간 합성 캐시 스펙 (view 경로 Firestore 읽기 절감)

작성: Claude, 2026-08-08. 근거: project_notes.md [2026-08-08] "개학 실사용 Firestore 일일 읽기량 추산" 엔트리.

## 1. 배경·목표

- `/api/timetable/view` 1회 ≈ **~85 Firestore 읽기** (인증 1 + 설정 2 + 학기 1 + 주 목록 ~25 + 학급 그리드 30 + 분반 ~15 + 특별실 ~6 + 개정판 ~2 + 주 변경분 ~5).
- 무료 한도 5만/일 기준, 학생 채택 50%를 넘으면 **한도 초과 확정** — 채택 성공이 곧 장애가 되는 구조.
- 목표: 조회 요청당 읽기를 **~2-4** (인증 + 캐시 버전 1 + 학생 학적)로 낮춘다. 자료 특성(읽기 다수·쓰기 소수·쓰기 전부 우리 코드 경유)에 맞는 서버 캐시.
- **절대 불변식: 무효화 누락 = 낡은 시간표 노출.** 결보강 커밋 직후 교사·학생이 보는 화면은 반드시 새 상태여야 한다.

## 2. 아키텍처 결정 — 왜 unstable_cache/revalidateTag가 아닌가

원 권고(읽기량 추산 엔트리)는 `unstable_cache` + `revalidateTag`였다. 설계 검토에서 다음 이유로 **"버전 문서 + 프로세스 인메모리 캐시"** 로 변경한다.

| 방식 | 판정 | 근거 |
|---|---|---|
| `use cache` (Next 16 정식) | ❌ | `cacheComponents: true` 전역 옵션 전제 — 앱 전체 렌더링·캐시 의미가 바뀌는 옵션을 개학 직전에 켤 수 없다. 또한 런타임 캐시는 서버리스에서 인스턴스 인메모리(비공유)라 이점도 제한적. |
| `unstable_cache` + `revalidateTag` | ❌ | ① Next 16에서 deprecated (동봉 문서 명시: "replaced by use cache"). ② **채움 경합 창**: 쓰기 직전 시작된 캐시 채움이 쓰기 후 완료되면 낡은 데이터가 신선한 항목으로 저장돼 다음 무효화까지 생존 — 불변식 위반. ③ Vercel Data Cache의 무료(Hobby) 한도·과금 정책 의존 — 무료 원칙과 충돌 위험. |
| **버전 문서 + 인메모리 캐시** | ✅ | 무효화가 **정확**(경합 창 없음, 아래 §3), 플랫폼 의존 0, deprecated API 0. 대가: 요청당 버전 읽기 1회 + 서버리스 인스턴스별 캐시(콜드 인스턴스마다 재채움 ~85읽기 — §7 추산상 무시 가능). |

### 버전 키가 경합에도 정확한 이유

쓰기 W가 버전을 v1→v2로 올리는 시나리오에서, W 직전에 시작된 조회 R(v1 읽음)의 캐시 채움이 W 이후 완료되더라도 그 결과는 **v1 키**에 저장된다. W 이후의 모든 조회는 v2를 읽으므로 v1 항목에는 닿지 않는다. 태그 무효화처럼 "무효화 시점 vs 저장 시점"의 순서에 기대지 않는다.

## 3. 설계

### 3-1. 캐시 버전 문서 — `src/lib/timetable/cacheVersion.ts` (신규)

- Firestore `timetable_cache_meta/{domain}` 문서 `{ v: number, bumpedAt }`.
- `getTimetableCacheVersion(domain)`: 문서 1읽기, 없으면 0. **view 라우트가 요청마다 호출** (캐시하지 않는다 — 이 1읽기가 정확성의 원천).
- `bumpTimetableCacheVersion(domain)`: `FieldValue.increment(1)` merge set. **실패해도 throw하지 않는다** — 본 쓰기는 이미 커밋됐으므로 bump 실패로 작업 전체를 실패시키면 사용자 재시도 → 중복 커밋 위험이 더 크다. 실패는 콘솔 에러로 남기고 TTL 안전망(§3-2)이 흡수.

### 3-2. 인메모리 캐시 — `src/lib/timetable/viewCache.ts` (신규)

- 모듈 스코프 `Map<key, {at, promise}>`. **Promise를 저장**해 동시 요청 중복 채움(dogpile) 방지. 실패한 Promise는 즉시 제거(에러 10분 고정 방지).
- **TTL 10분** — 안전망. bump 유실·미처 못 본 쓰기 경로가 있어도 최대 10분 내 자가 치유. (정상 경로의 신선도는 버전 키가 보장하므로 TTL은 길어도 된다.)
- 항목 상한 40개(초과 시 오래된 것부터 제거). 항목당 그리드 30개 직렬화 수백 KB 수준 — 서버리스 메모리(1GB) 대비 안전.
- **킬스위치**: 환경변수 `TIMETABLE_VIEW_CACHE=off` → 항상 미스(기존과 동일 동작). 개학 당일 이상 징후 시 코드 수정 없이 끈다.

캐시 대상 3함수 (키에 항상 `version` 포함):

| 함수 | 키 | 내용 | 절감 |
|---|---|---|---|
| `getViewContextCached(domain, v, termId?)` | `ctx:{domain}:{v}:{termId}` | settings + term(termId 지정/active) + 주 목록 | ~29읽기 |
| `getWeekGridsCached(domain, v, termId, week, baseDate, settings)` | `grids:{domain}:{v}:{termId}:{weekId or base:날짜}` | 기초(개정 해석) + 주 변경분 + **합성 완료 그리드** + 무결성 경고 | ~58읽기 + 합성 CPU |
| `getBaseGridsCached(domain, v, termId)` | `basegrids:{domain}:{v}:{termId}` | `loadAllClassGrids` (teachers 드롭다운용) | ~51읽기 |

- "현재 주" 판별은 **캐시 밖**에서: 주 목록만 캐시하고 오늘 날짜 매칭은 요청 시 수행 (`pickCurrentWeek` 순수 함수로 분리). 날짜가 캐시 항목에 얼어붙는 것 방지. 기초 열람 키의 `baseDate`(오늘 주 월요일)도 라우트에서 계산해 키에 넣는다.
- **view 라우트만 캐시를 쓴다.** manage·requests·후보/체인 엔진·승인 검증 경로는 전부 기존 fresh 로더 유지 — 판단·커밋은 항상 실데이터로.

### 3-3. 보안·정합 불변식

1. 캐시 값은 **역할 무관 원본**(전체 그리드). 학생 sanitize(가상 교사 제거)는 기존대로 라우트에서 요청별 수행 — sanitize된 응답을 캐시에 넣지 않는다(역할 간 혼입 방지). sanitize는 새 객체를 만들므로(spread/map) 공유 객체 오염 없음.
2. 인증(`verifyAuthAccess`)·학생 학적(`resolveStudentClass`)은 캐시하지 않는다.
3. `integrityWarnings`는 캐시에 저장하되, 응답 동봉은 기존처럼 일과계·super_admin일 때만(라우트 필터 유지).
4. 캐시된 그리드는 요청 간 공유 — 소비 함수의 입력 변형 금지. 현행 전수 확인: `synthesizeWeeklyGrids`는 deepCopy 후 작업, `synthesizeTeacherTimetable`/`synthesizeFreeTeachers`/`buildSlotIndex`/`resolveTeacherName`/`sanitizeForStudent` 전부 읽기 전용 또는 새 객체 생성 ✓. **향후 view 경로에 그리드 후처리를 추가할 때 이 원칙 준수.**

## 4. 무효화(bump) 지점 — 전수 목록

원칙: **view가 읽는 자료를 바꾸는 모든 쓰기 함수의 말미**에서 bump. 라우트가 아니라 서버 함수 안에 넣어 누락 여지를 없앤다(단, 분반·특별실은 쓰기가 manage 라우트 인라인이라 라우트에서).

| 쓰기 지점 | 위치 | view 영향 |
|---|---|---|
| `saveTimetableSettings` | server.ts | settings (관리자·교시 수 등) — set_managers/set_observers/import/activate 경유 포함 |
| `saveAllClassGrids` | server.ts | 기초 그리드 |
| `commitTimetableImport` | server.ts | term 문서(subjects → free 액션)·그리드 (내부 save들이 중복 bump — 무해) |
| `activateTerm` / `deleteTerm` | server.ts | 활성 학기 전환·제거 |
| `registerWeek` / `updateWeek` | server.ts | 주 목록·요일 구성 (`ensureDerivedWeeks`는 registerWeek 경유로 자동 포함) |
| `applyRevisionDraft` | server.ts | 개정판 applied 전환 → 기초 해석 변경 |
| `approveSwapRequest` | server.ts (tx 성공 직후, 알림 전) | changes 생성 — **directCommit·direct_commit_batch도 이 함수 경유로 포함** |
| `revertTimetableChange` | server.ts (tx 성공 직후) | revert change 생성 |
| `simul_save` / `simul_delete` | manage/route.ts | 분반 마크 (loadAllClassGrids가 마크 적용) |
| `venue_save` / `venue_delete` | manage/route.ts | 특별실 마크 |

**제외 목록과 사유** (여기 없는 쓰기를 추가할 때는 이 표에 판정을 기록할 것):

| 쓰기 | 제외 사유 |
|---|---|
| `saveRevisionDraft` / `deleteRevisionDraft` | draft는 view 합성이 읽지 않음 (`loadBaseGridsByWeek`는 `status === "applied"`만 필터) |
| `calendar_save` / `calendar_delete` | 학사일정 자체는 view 비대상. 주 파생에 반영되는 시점은 `ensureDerivedWeeks`→`registerWeek`이며 그때 bump됨 |
| `createSwapRequest` / `cancel` / `reject` / `validatePendingSwapRequests` | 요청 상태만 변경 — 합성은 APPROVED가 만든 changes만 읽음. 담기(pending) 오버레이는 별도 비캐시 경로 |
| swap draft 저장/삭제 | 사용자별 임시 저장 — view 비대상 |

## 5. 변경 파일

- 신규: `src/lib/timetable/cacheVersion.ts`, `src/lib/timetable/viewCache.ts`
- 수정: `src/lib/timetable/server.ts` (bump 호출 8곳 + `pickCurrentWeek` 분리), `src/app/api/timetable/manage/route.ts` (bump 4곳), `src/app/api/timetable/view/route.ts` (캐시 결선)

## 6. 예상 효과 (읽기 추산 엔트리 기준 재계산)

- 교사/학생 1조회: ~85 → **~2-4** (인증 1 + 버전 1 + 학생 학적 0-2). 캐시 미스 시에만 채움 ~85.
- 시나리오(교사 70·학생 800·학생 60% 사용): ~53K → **수천/일** (채움: 버전당·인스턴스당 1회 + 10분 TTL 재채움, 쓰기 수십 건/일 × ~85).
- 일과계 직권 화면(후보·체인·커밋)은 비캐시 유지 — 집중 작업 1시간 ~3-5천은 그대로. 필요 시 후속 단계에서 검토(커밋 재검증 fresh 유지 전제).

## 7. 검증 계획

1. `npx tsc --noEmit` + `npm run build` (DoD).
2. 정합 스모크(실기기, Antigravity 또는 사용자): ① 직권 담기 일괄 반영 직후 교사 my/학급 화면 새로고침 → 새 시간표 즉시 반영 ② 승인 취소(revert) 직후 동일 ③ 분반/특별실 등록 직후 그리드 마크 반영 ④ 주 등록/수정 직후 반영.
3. 읽기량 실측: 개학 첫 주 Firebase 콘솔 사용량 그래프로 일일 읽기 확인 (https://console.firebase.google.com/project/school-sync-hub/usage).

## 8. 리스크·한계

- **인스턴스별 캐시**: 서버리스 인스턴스마다 별도 채움. 인스턴스 교체가 잦으면 절감률 하락 — 그래도 상한은 "인스턴스 수 × 버전당 ~85읽기"라 예산 내. 개학 후 실측(§7-3)으로 확인.
- **bump 유실**(예: bump 실패, 규칙 밖 콘솔 직접 수정): 최대 10분 낡은 화면 → TTL로 자가 치유. Firestore 콘솔에서 시간표 데이터를 손으로 고치는 운영은 금지(어차피 기존 원칙).
- 새 쓰기 경로 추가 시 §4 표 갱신 누락이 유일한 구조적 위험 — 코드 리뷰 체크 항목으로 §4를 참조할 것.
