# 알리미 웹 푸시 1단계 — 시간표 변경 알림 스펙

> 2026-08-07 Claude 설계. 로드맵 §2 "효명고 알리미"(0원 경로)의 1단계.
> 서버부(이 문서 §1~§8) = Claude 구현, 알림 설정 UI(§9) = Antigravity 구현.

## §0 목적·범위

- **목적**: 시간표 변경(수업교환 승인·일과계 직권 배정·승인 취소)이 확정되는 즉시, **당사자 교사**와 **해당 반 학생**의 설치형 웹앱으로 푸시 알림을 보낸다. 상용 알림 플랫폼 없이 표준 웹 푸시(VAPID)만 사용 — 비용 0원.
- **범위(1단계)**: 시간표 변경 알림만. 급식·공지 등 다른 알림 유형은 후속 단계에서 topic 확장으로 수용한다(§2 데이터 모델이 이미 대비).
- **범위 밖**: 기초 시간표 개정(`revision_apply`)·학기 임포트는 개별 수업 변경 알림 대상이 아니다(운영 준비 작업이므로).
- **기존 채널과의 관계**: 교사 대상 구글 챗 DM(승인·반려·취소 시)은 그대로 유지. 웹 푸시는 잠금화면까지 도달하는 추가 채널이며, 학생에게는 최초의 알림 채널이다.

## §1 아키텍처

```
[브라우저(설치형 웹앱)]                       [서버(Vercel)]
 sw.js push 핸들러  ◄── 푸시 서비스 ◄── web-push(VAPID 서명) ◄── 발송 훅
 pushManager.subscribe ──► POST /api/push subscribe ──► Firestore push_subscriptions
```

- 라이브러리: `web-push`(npm, MIT). VAPID 키 쌍은 환경변수(§8).
- 구독(엔드포인트+암호키)은 Firestore에 서버 전용으로 저장. 클라이언트 직접 읽기/쓰기 전면 차단(§7).
- 발송은 커밋 응답을 막지 않도록 Next `after()`(응답 후 실행)로 수행(§5).

## §2 데이터 모델 — `push_subscriptions/{domain}/subs/{subId}`

- **subId** = sha256(endpoint) hex — 같은 브라우저의 재구독은 자연 upsert(멱등), 1인 다기기 허용.
- 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| endpoint | string | 푸시 서비스 URL |
| keys | {p256dh, auth} | 암호화 키 (구독 객체 그대로) |
| email / uid / role | string | 구독 시점 인증 정보 (email 소문자) |
| grade / classNum | number? | **학생만.** 구독 시점에 `resolveStudentClass`로 서버가 강제 도출 — 클라이언트 신고값을 받지 않는다 |
| userAgent | string? | 200자 절단, 기기 구분용 |
| createdAt / updatedAt | number | ms |

- **정리 규칙**: 발송 시 푸시 서비스가 404/410을 반환하면 만료 구독이므로 문서를 즉시 삭제. 재구독(로그인 포털 진입 시 자동, §9)이 upsert로 학년·반 등 스냅샷을 갱신하므로 진급·반 변경도 자연 치유.

## §3 API — `POST /api/push` (action 기반, 기존 관례)

전 액션 `verifyAuthAccess` 필수. domain = 이메일 도메인.

| action | 권한 | 입력 | 동작 |
|---|---|---|---|
| `config` | 로그인 | — | `{ enabled, publicKey }` — 키 미설정이면 enabled:false (UI는 기능 숨김) |
| `subscribe` | 로그인 | `subscription{endpoint, keys{p256dh,auth}}` | 형식 검증(https·길이) 후 upsert. 학생이면 학년·반 서버 도출(도출 실패해도 교사 몫 없이 저장은 함 — 이메일 기반 발송은 가능) |
| `unsubscribe` | 로그인 | `endpoint` | **본인(email 일치) 구독만** 삭제. 없는 문서는 성공 처리(멱등) |
| `status` | 로그인 | `endpoint` | `{ subscribed }` — 본인 소유 여부까지 확인 |
| `test_send` | 시간표 관리자(managerEmails)·super_admin | — | **본인** 구독 전체로 시험 알림 1건. 구독별 성공/실패 반환 — 실기기 검증용 |

- 서버 이중 방어 관례 준수: endpoint는 `https://` 시작·2048자 이하만 수용, keys 두 필드 필수.

## §4 발송 라이브러리 — `src/lib/push/webpush.ts`

- `isWebPushConfigured()` — 키 없으면 모든 발송이 조용히 no-op(개발 환경 보호).
- `sendPushToSubs(domain, subs, payload)` — `webpush.sendNotification`(TTL 24h), 404/410 문서 삭제, 결과 `{sent, removed, failed}`. **어떤 실패도 throw하지 않는다** — 알림 실패가 시간표 커밋을 깨면 안 된다.
- 수신자 조회: `listSubsByEmails`(in 쿼리 30개 단위 청크), `listSubsByClass`(grade·classNum 동등 쿼리 — 복합 색인 불요).
- **수신자 도출 규칙** (`notifyTimetableChanges(domain, changes[])`):
  - swap → 교사 a·b, 학생 해당 반 / substitute → 결강·보강 교사, 해당 반 / crossSwap → out·in 교사, 해당 반
  - `revertOf` 있으면 같은 도출에 "변경 취소" 문구.
  - **집계**: 일괄 반영(batch) 등으로 한 사람에게 변경이 여러 건이면 **알림 1건으로 합산**("시간표 변경 N건 — 첫 건 요약 외"). 스팸 방지.
- **페이로드**(JSON): `{ title, body, url, tag }`. tag는 `timetable`(같은 태그 알림은 최신으로 교체 — 잠금화면 도배 방지).
- **문구 원칙**: 개발 용어 금지. 날짜는 weekId(월요일)+요일로 실제 날짜 병기. 예:
  - 교환: `8/11(화) 2교시 사회 ↔ 8/13(목) 3교시 수학 (2-1반)`
  - 보강: `8/13(목) 5교시 과학 보강 — 김OO 선생님 (2-1반)`
  - 취소: `시간표 변경이 취소되었습니다 — 8/11(화) 2교시 (2-1반)`
- url: 학생 구독(role=student) → `/student-portal`, 그 외 → `/`.

## §5 발송 훅 — `/api/timetable/manage` 4곳

커밋이 성공한 뒤 `after(() => notifyTimetableChanges(domain, [change...]))`로 발송(응답 지연 0).

| 액션 | 전달 change |
|---|---|
| `approve` | 승인 결과 change 1건 |
| `direct_commit` | change 1건 |
| `direct_commit_batch` | 성공 항목들의 change 배열 — **한 번에 전달**해 수신자별 집계 |
| `revert_change` | revert change 1건 |

서버 내부(`server.ts`)가 아니라 라우트에서 훅을 거는 이유: 커밋 트랜잭션과 알림의 결합을 피하고, 배치 집계 지점을 한 곳으로 모으기 위함.

## §6 서비스워커 — `public/sw.js`

- `push` 이벤트: 페이로드 JSON 파싱 → `showNotification(title, { body, tag, icon: /icon-192.png, badge, data: { url } })`.
- `notificationclick`: 알림 닫고, 열린 앱 창이 있으면 focus, 없으면 `data.url` 새 창.
- 기존 최소 SW(설치성 충족용)에 추가만 — 오프라인 캐싱은 여전히 하지 않는다.

## §7 보안·개인정보

- 구독 컬렉션은 firestore.rules의 **deny-by-default로 이미 클라이언트 전면 차단**(admin SDK 전용) — 규칙 추가 불요. 엔드포인트·암호키가 새면 제3자가 그 사람에게 푸시를 보낼 수 있으므로 클라이언트에 절대 노출하지 않는다.
- 페이로드는 과목·교시·반 수준의 시간표 정보만 — 이름 외 개인정보·생활지도성 정보 금지(잠금화면에 뜨는 텍스트임).
- unsubscribe/status는 본인 소유 검증(타인 구독 삭제·탐지 차단).

## §8 환경변수·운영

- `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` — 생성 완료, `.env.local` 반영. **키 쌍을 바꾸면 기존 구독 전체가 무효화되므로 재생성 금지.**
- VAPID subject = `mailto:` + 알리미 계정(`GOOGLE_WORKSPACE_SENDER_EMAIL` 폴백 패턴 준수).
- **사용자 액션(배포 전)**: Vercel 프로젝트 환경변수에 위 2개 키 추가. (deployment_checklist에도 반영)
- iOS는 **홈 화면에 설치한 웹앱에서만**(16.4+) 푸시 수신 — iorad 설치 튜토리얼의 "알림 켜기" 단계와 연결되는 전제.

## §9 알림 설정 UI (Antigravity 인계 스펙)

- **공용 컴포넌트 1개** `PushNotificationManager`(가칭, `src/components/common/`)를 만들고 **두 곳에 마운트**: ① 교사 홈 대시보드(`src/app/admin/page.tsx`) 상단 카드 영역 ② 학생 포털(`student-portal/page.tsx`) 상단. 다른 화면에는 넣지 않는다(IA 명시 — 임의 배치 금지).
- 동작:
  1. 마운트 시 `POST /api/push {action:"config"}` — `enabled:false`거나 브라우저가 푸시 미지원(`'PushManager' in window` 등)이면 **아무것도 렌더하지 않는다**.
  2. `Notification.permission === "granted"`이고 기존 구독이 있으면 **조용히 재구독**(`pushManager.subscribe` 기존 객체 → `subscribe` 액션 재전송 — 학년·반 스냅샷 갱신). UI는 "알림 받는 중" 소형 표시 + 끄기.
  3. `permission === "default"`면 "시간표가 바뀌면 알림 받기" 버튼 → 클릭 시 권한 요청 → granted면 `subscribe(applicationServerKey: config.publicKey — urlBase64→Uint8Array 변환 필요)` → 서버 등록.
  4. `denied`면 "브라우저 알림이 꺼져 있어요. 주소창 오른쪽 설정에서 알림을 허용해 주세요." 한 줄(개발 용어 금지).
  5. 끄기 = `pushManager` 구독 해제 + `unsubscribe` 액션.
- 문구에 "푸시", "PWA", "구독" 같은 용어 금지 — "알림 받기 / 알림 끄기".
- 관리자용: 시간표 관리 설정 탭 등에 넣지 않는다. 시험 발송은 `test_send`를 쓰는 별도 버튼을 **시간표 관리자에게만** 교사 포털 카드 안에 노출(관리자 판별은 config 응답의 `canTest` 사용).

## §10 검증

- 서버부: tsc·build + 구독 형식 검증·권한 게이트 코드 검토(이 문서 기준).
- 실기기(개학 후 통합 검증에 병합): 교사 크롬북/폰에서 알림 켜기 → `test_send` 수신 → 직권 배정 1건 반영 → 당사자 교사·해당 반 학생 기기 수신 확인 → 취소 알림 확인. iOS는 홈 화면 설치 후에만 되는 점 확인.

## §11 iOS(아이폰) 지원 — 설치·로그인·알림 전체 경로 (2026-08-11 실기기 검증 완료)

> iPhone iOS 18.7 실기기에서 설치 → 로그인 → 구독 등록 → 푸시 수신까지 전 경로 확인.
> 관련 수정 커밋: `9f7cbe1` (fix(auth): standalone 팝업 무한 대기).

### §11-1 iOS 제약 3가지 (설계가 아니라 애플 정책)

1. **푸시는 홈 화면에 설치된 앱(standalone)에서만 동작한다** (iOS 16.4+). Safari 창에서는 `PushManager` 자체가 없어 알림 카드가 렌더되지 않는다 — §9-1의 "미지원 시 미노출" 규칙에 의한 **정상 동작**이니 버그로 접수하지 말 것.
2. **설치는 Safari에서만 가능하다.** 카카오톡·문자 링크로 열리는 내장 브라우저에는 "홈 화면에 추가" 메뉴가 없다.
3. 홈 화면 추가 시 **"웹 앱으로 열기" 체크를 켠 채로** 추가해야 standalone 앱이 된다. 체크를 끄면 단순 바로가기(Safari로 열림)가 되어 1번에 걸린다.

### §11-2 로그인 로직 — standalone이면 팝업 대신 redirect

- **증상(수정 전)**: iOS 설치형 앱에서 `signInWithPopup`이 로그인 결과를 앱으로 돌려주지 못한 채 **오류도 없이** 멈춘다("로그인 중…" 무한 대기). 기존 폴백은 `auth/popup-blocked` 오류가 날 때만 redirect로 전환하는 구조라 무오류 정지 케이스에서는 발동하지 않았다.
- **수정(`src/lib/firebase/auth.ts`)**: `isStandaloneApp()` — `display-mode: standalone` 미디어쿼리 + iOS 레거시 `navigator.standalone` 이중 감지 — 가 참이면 팝업을 시도하지 않고 **처음부터 `signInWithRedirect`**를 쓴다. 일반 브라우저는 기존 팝업 경로 그대로.
- **redirect가 안전한 전제**: 인증 핸들러가 same-origin(`next.config.ts`의 `/__/auth/*` 프록시 + `authDomain = window.location.host`)이라 서드파티 저장소 차단의 영향을 받지 않는다. 이 프록시를 제거하면 iOS redirect 로그인이 다시 깨지므로 **함께 유지해야 한다**.
- **복귀 흐름**: redirect 복귀 → `AuthContext.onAuthStateChanged` → `handleUserRoles`(역할 동기화) → 로그인 페이지 useEffect가 역할·화면폭 기준 라우팅(`/m` 등). 실패 시 `login/page.tsx`의 `getRedirectResult`가 오류 코드를 화면에 표시한다 — 아이폰은 원격 디버깅이 불가하므로 이 표시가 유일한 단서다.

### §11-3 아이폰 사용자 안내 절차 (교사 안내용 — 그대로 복사해 쓰기)

1. 링크를 **Safari로** 열기 (카톡에서 열렸으면: 하단 공유 아이콘 → "Safari로 열기", 또는 주소 복사 후 Safari에 붙여넣기)
2. 하단 가운데 **공유 버튼(⬆️)** → 아래로 스크롤 → **"홈 화면에 추가"** ("웹 앱으로 열기" 체크는 켠 채로)
3. 홈 화면의 **효명고 아이콘으로** 앱 열기 → 로그인 (구글 화면으로 갔다가 자동으로 돌아옴)
4. 첫 화면의 "**🔔 알림 받기**" → 아이폰 확인 창에서 **허용**
5. 카드에 "**알림 켜짐**" 초록 표시가 보이면 완료
