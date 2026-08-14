# 의존성 취약점 점검 보고서 (`npm audit --omit=dev`)

> **조사 일시**: 2026-08-14  
> **기준 명령**: `npm audit --omit=dev`  
> **목적**: 프로덕션 의존성 취약점 13건에 대한 패키지별 명세, 소스코드 사용 현황 및 실제 런타임 도달 경로 사실 수집  
> **주의**: 본 문서는 원시 사실(Fact) 수집 문서이며, 대응 방향 및 조치 결정은 Claude가 수행함 (`npm audit fix` 실행 금지 준수).

---

## 1. 취약점 요약 (Summary)

- **총 집계 건수**: 13건
  - **High**: 7건 (`next`, `postcss`, `sharp`, `xlsx`, `fast-xml-parser`, `brace-expansion`, `nanoid`)
  - **Moderate**: 6건 (`uuid`, `gaxios`, `teeny-request`, `retry-request`, `@google-cloud/storage`, `firebase-admin`)
- **직접 의존성 (Direct Dependencies)**: 3개 (`next`, `xlsx`, `firebase-admin`)
- **간접/트랜지티브 의존성 (Transitive Dependencies)**: 10개

---

## 2. 패키지별 도달 가능성 현황표 (Audit Matrix)

| 패키지명 | 심각도 | 직접/간접 | 주요 취약점 내용 (GHSA / CVE) | 우리 코드 사용 위치 | 실제 런타임 도달 가능성 |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **`next`** | **High** | Direct | App Router DoS/SSRF/Cache Confusion, Rewrites SSRF, SVG DoS 등 9건 | `package.json`, `next.config.ts`, `src/app/api/` 라우트 핸들러 | **부분 도달 가능** (`rewrites` 설정 및 POST API 캐시 레이어) / Server Actions·Middleware 미사용 |
| **`postcss`** | **High** | Indirect | CSS Stringify XSS, `sourceMappingURL` Path Traversal / `.map` 파일 유출 4건 | `postcss.config.mjs`, `@tailwindcss/postcss` | **도달 불가** (빌드 타임 CSS 컴파일 전용) |
| **`sharp`** | **High** | Indirect | `libvips` C++ 메모리 손상 (CVE-2026-33327 외 3건) | Next.js 내장 Image Optimization API 의존성 | **도달 불가** (`next/image` 및 이미지 처리 API 미사용) |
| **`xlsx`** | **High** | Direct | SheetJS Prototype Pollution (GHSA-4r6h-8v6p-xvw6), ReDoS (GHSA-5pgg-2g8v-p4x9) | `TimetableImportTab.tsx`, `NeisExportTab.tsx`, `HourTotalsTab.tsx`, `DisciplineSummarySection.tsx`, `scripts/discipline_sheet_migration.ts` | **도달 가능** (`TimetableImportTab.tsx` 업로드 파싱 시 `XLSX.read` 실행) |
| **`fast-xml-parser`** | **High** | Indirect | DOCTYPE 처리 재설정으로 인한 Entity Expansion (XML DoS) | `@google-cloud/storage` 하위 의존성 | **도달 불가** (GCS XML API 및 XML 파싱 직호출 없음) |
| **`brace-expansion`** | **High** | Indirect | Unbounded expansion / intermediate array 메모리 고갈 DoS | `glob` (Next.js 빌드 파일 탐색) 하위 의존성 | **도달 불가** (빌드 시점 static glob 전용) |
| **`nanoid`** | **High** | Indirect | non-secure / custom generator 파라미터(size 0/음수) 무한 루프 DoS | `postcss` 하위 의존성 | **도달 불가** (`src/` 내 직접 호출 및 파라미터 주입 없음) |
| **`uuid`** | **Moderate** | Indirect | v3/v5/v6 `buf` 인자 전달 시 버퍼 경계 검사 누락 (Out-of-bounds write) | `gaxios`, `teeny-request` 하위 의존성 | **도달 불가** (`src/` 내 직접 호출 및 `buf` 전달 사용처 없음) |
| **`gaxios`** | **Moderate** | Indirect | 하위 의존성 `uuid` 연쇄 집계 (자체 취약점 0건) | `src/lib/google/workspace.ts` (`googleapis`) | **도달 불가** (자체 취약점 없음, `uuid.v4()` 사용) |
| **`teeny-request`** | **Moderate** | Indirect | 하위 의존성 `uuid` 연쇄 집계 (자체 취약점 0건) | GCP SDK HTTP Client Wrapper | **도달 불가** (자체 취약점 없음) |
| **`retry-request`** | **Moderate** | Indirect | 하위 의존성 `teeny-request` $\rightarrow$ `uuid` 연쇄 집계 (자체 취약점 0건) | GCP SDK HTTP Client Retry | **도달 불가** (자체 취약점 없음) |
| **`@google-cloud/storage`** | **Moderate** | Indirect | 하위 의존성 `retry-request` $\rightarrow$ `teeny-request` $\rightarrow$ `uuid` 연쇄 집계 | `firebase-admin` 하위 의존성 | **도달 불가** (자체 취약점 없음, Storage Direct Call 없음) |
| **`firebase-admin`** | **Moderate** | Direct | 하위 의존성 `@google-cloud/storage` 체인 연쇄 집계 (자체 취약점 0건) | `src/lib/firebase/admin.ts` | **도달 불가** (자체 취약점 0건, Auth/Firestore는 `uuid` 버퍼 경로 미경유) |

---

## 3. 상세 조사 분석 (Detailed Investigation)

### 3.1 `xlsx` (Direct Dependency, High)

#### (1) 취약점 명세
- **GHSA-4r6h-8v6p-xvw6** (High / CVSS 7.8): Prototype Pollution in SheetJS (`<0.19.3`). 악의적으로 조작된 엑셀(`.xlsx`/`.xls`) 파일 파싱 시 `Object.prototype` 오염.
- **GHSA-5pgg-2g8v-p4x9** (High / CVSS 7.5): Regular Expression Denial of Service (ReDoS) in SheetJS (`<0.20.2`). 조작된 엑셀 정규식 처리 시 CPU 100% 점유 DoS.
- **현재 설치 버전**: `0.18.5` (`package.json`: `"xlsx": "^0.18.5"`)

#### (2) 우리 코드 내 실제 파일 경로 및 사용 방식 (전수 인용)

##### 1. [`src/components/admin/timetable/TimetableImportTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/TimetableImportTab.tsx) (시간표 엑셀 파싱 - **파싱 파이프라인**)
- **라인 8**: `import * as XLSX from "xlsx";`
- **라인 135-137** (전체시간표 파싱):
  ```typescript
  const parseFullScheduleBuffer = (arrayBuffer: ArrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
  ```
- **라인 227-229** (주간시간표 파싱):
  ```typescript
  const parseWeeklyScheduleBuffer = (arrayBuffer: ArrayBuffer) => {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
  ```

##### 2. [`src/components/admin/timetable/NeisExportTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/NeisExportTab.tsx) (NEIS 수업교환 내보내기 - **내보내기 전용**)
- **라인 4**: `import * as XLSX from "xlsx";`
- **라인 102-104**:
  ```typescript
  XLSX.utils.book_append_sheet(wb, ws, "NEIS_수업교환목록");
  const filename = `NEIS_수업교환목록_${startDate}_${endDate}.xlsx`;
  XLSX.writeFile(wb, filename);
  ```

##### 3. [`src/components/admin/timetable/HourTotalsTab.tsx`](file:///home/fb01/school/src/components/admin/timetable/HourTotalsTab.tsx) (수업시수 내보내기 - **내보내기 전용**)
- **라인 4**: `import * as XLSX from "xlsx";`
- **라인 92-95**:
  ```typescript
  XLSX.utils.book_append_sheet(wb, wbClass, "학급별 시수");
  const filename = `수업시수집계_${endDate}.xlsx`;
  XLSX.writeFile(wb, filename);
  ```

##### 4. [`src/components/admin/discipline/DisciplineSummarySection.tsx`](file:///home/fb01/school/src/components/admin/discipline/DisciplineSummarySection.tsx) (생활지도 통계 내보내기 - **내보내기 전용**)
- **라인 2**: `import * as XLSX from "xlsx";`
- **라인 265-266**:
  ```typescript
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "생활지도 종합현황");
  XLSX.writeFile(wb, filename);
  ```

##### 5. [`scripts/discipline_sheet_migration.ts`](file:///home/fb01/school/scripts/discipline_sheet_migration.ts) (일회성 마이그레이션 스크립트)
- **라인 3**: `import * as XLSX from "xlsx";`

#### (3) 실제 도달 가능 경로 평가
- **도달 가능 (Reachable)**:  
  `TimetableImportTab.tsx`에서 교사 및 관리자가 업로드한 컴시간알리미 엑셀 파일 (`전체시간표.xlsx`, `주간시간표.xlsx`)을 클라이언트 브라우저상에서 `XLSX.read(arrayBuffer, { type: "array" })`로 직접 파싱합니다.  
  공격자가 악의적으로 프로토타입 오염 코드 또는 ReDoS를 유발하도록 조작한 엑셀 파일(`.xlsx`/`.xls`)을 기초시간표 등록 화면에 업로드할 경우, 해당 바이너리를 파싱하는 관리자/교사의 브라우저 실행 컨텍스트에서 **취약점 코드가 실행되는 경로에 도달**합니다.
- **참고사항**: 파일 내보내기 컴포넌트(`NeisExportTab`, `HourTotalsTab`, `DisciplineSummarySection`)는 외부 데이터를 파싱(`XLSX.read`)하지 않고 자체 JSON/배열을 엑셀로 내보내므로 해당 3개 사용처는 취약점 파싱 경로에 해당하지 않습니다.

---

### 3.2 `next` (Direct Dependency, High)

#### (1) 취약점 명세
- **현재 설치 버전**: `16.2.10` (`package.json`: `"next": "16.2.10"`)
- **영향 범위**: `>=16.0.0 <16.2.11`
- **취약점 항목 (총 9건)**:
  1. `GHSA-6gpp-xcg3-4w24` (High): App Router에서 Turbopack 및 single locale 사용 시 Middleware / Proxy 우회
  2. `GHSA-m99w-x7hq-7vfj` (High): Server Actions 사용 시 App Router DoS
  3. `GHSA-89xv-2m56-2m9x` (High): Custom Server 사용 시 Server Actions SSRF
  4. `GHSA-68g3-v927-f742` (Moderate): Request Body가 있는 요청의 Cache Confusion
  5. `GHSA-4633-3j49-mh5q` (Moderate): 유효하지 않은 UTF-8 바이트 시퀀스 포함 시 Cache Confusion
  6. `GHSA-4c39-4ccg-62r3` (Moderate): Edge runtime 내 Server Action 페이로드 크기 제한 미흡
  7. `GHSA-p9j2-gv94-2wf4` (High): Rewrites 동적 호스트명 조작 SSRF
  8. `GHSA-q8wf-6r8g-63ch` (Moderate): SVG Image Optimization DoS
  9. `GHSA-955p-x3mx-jcvp` (Moderate): 내부 Server Function 엔드포인트 노출

#### (2) 우리 코드 내 실제 파일 경로 및 사용 방식

##### 1. [`next.config.ts`](file:///home/fb01/school/next.config.ts) (`rewrites` 사용)
- **라인 8-15**:
  ```typescript
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://school-sync-hub.firebaseapp.com/__/auth/:path*",
      },
    ];
  }
  ```

##### 2. [`package.json`](file:///home/fb01/school/package.json) 및 [`src/app/api/`](file:///home/fb01/school/src/app/api/)
- 전체 프로젝트 웹 프레임워크 및 App Router Route Handler (`src/app/api/roster/feed/route.ts` 등 다수)

#### (3) 실제 도달 가능 경로 평가
- **도달 가능 (부분 도달)**:
  - `rewrites()` 사용: `next.config.ts`에서 Firebase Auth 프록시용 `rewrites`를 정의하여 사용 중입니다. 단, `destination`이 고정 문자열(`https://school-sync-hub.firebaseapp.com/...`)로 하드코딩되어 있으므로 공격자 제어 호스트명에 의한 SSRF(GHSA-p9j2-gv94-2wf4) 직접 도달 위험은 낮습니다.
  - Cache Confusion (GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q): `src/app/api/...` 하위에 POST/PUT/DELETE 라우트 핸들러가 다수 존재하며, Vercel edge/CDN 캐싱 레이어 설정에 따라 응답 캐시 혼동 가능성이 존재합니다.
- **도달 불가 (미사용 기능)**:
  - **Server Actions**: 프로젝트 전체에서 `'use server'` 키워드 및 Server Actions를 일절 사용하지 않음 (Route Handler 및 Firebase Client/Admin SDK 구조). Server Actions 관련 DoS/SSRF/Edge payload 3개 취약점 미도달.
  - **Middleware**: 프로젝트 내 `middleware.ts` 파일 미존재. Turbopack Middleware Bypass 미도달.
  - **Edge Runtime**: 모든 API 라우트는 Node.js default runtime 사용. Edge payload limit 미도달.
  - **`next/image`**: `src/` 내 `next/image` 컴포넌트 사용 0건 (`grep` 확인 완료). SVG Image DoS 미도달.

---

### 3.3 `postcss` (Indirect Dependency via `next` / `@tailwindcss/postcss`, High)

#### (1) 취약점 명세
- **GHSA-qx2v-qp2m-jg93** (Moderate): CSS Stringify output 이스케이프 미흡 XSS (`<8.5.10`)
- **GHSA-6g55-p6wh-862q**, **GHSA-fxqj-rqcc-2cmp**, **GHSA-r28c-9q8g-f849** (High/Moderate): CSS 주석 내 `sourceMappingURL` 통한 Arbitrary File Read / Path Traversal (`<=8.5.22`)

#### (2) 우리 코드 내 사용 방식
- [`postcss.config.mjs`](file:///home/fb01/school/postcss.config.mjs) 및 [`package.json`](file:///home/fb01/school/package.json) devDependencies (`@tailwindcss/postcss`: `^4`, `tailwindcss`: `^4`).

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  PostCSS는 개발자의 CSS 소스코드(`src/app/globals.css`)를 빌드 시점에 번들링/컴파일하는 도구입니다. 런타임에 외부 입력(사용자가 작성한 CSS 문장)을 PostCSS 엔진으로 스트링리파이/파싱하는 서버 라우트가 전무하므로, 런타임 XSS 및 `sourceMappingURL` 파일 읽기 취약점 경로에 도달하지 않습니다.

---

### 3.4 `sharp` (Indirect Dependency via `next`, High)

#### (1) 취약점 명세
- **GHSA-f88m-g3jw-g9cj** (High): `sharp` 패키지가 바이너리로 포함하는 C/C++ 이미지 처리 라이브러리 `libvips` 상의 고위험 취약점 (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 - Out-of-bounds read/write, 메모리 손상).

#### (2) 우리 코드 내 사용 방식
- Next.js의 내장 Image Optimization API 의존성으로 `node_modules`에 포함됨.

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  우리 코드베이스는 `next/image` 컴포넌트 및 동적 이미지 최적화/변환 API를 일절 사용하지 않습니다 (`src/` 전수 검색 결과 0건). `sharp` native 바인딩 함수가 서버 런타임에 호출되는 경로가 없습니다.

---

### 3.5 `fast-xml-parser` (Indirect Dependency via `@google-cloud/storage`, High)

#### (1) 취약점 명세
- **GHSA-8r6m-32jq-jx6q** (High): 반복된 DOCTYPE 선언 시 Entity Expansion 한계치가 리셋되는 XML Entity Expansion DoS 취약점.

#### (2) 우리 코드 내 사용 방식
- `firebase-admin` $\rightarrow$ `@google-cloud/storage` $\rightarrow$ `fast-xml-parser` 체인으로 `node_modules`에 종속.

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  `@google-cloud/storage`는 XML API 응답 파싱 시 이 패키지를 사용하나, 우리 코드는 Google Cloud Storage API 또는 XML 파싱 함수를 직접 호출하지 않으며 `firebase-admin` (Auth, Firestore) 사용 중 XML 파싱 엔진이 호출되지 않습니다.

---

### 3.6 `brace-expansion` (Indirect Dependency via `glob`, High)

#### (1) 취약점 명세
- **GHSA-mh99-v99m-4gvg**, **GHSA-rgw5-rvv9-x895** (High): Unbounded expansion / intermediate array 생성을 통한 OOM Process Crash DoS.

#### (2) 우리 코드 내 사용 방식
- `glob` 패키지의 하위 의존성 (Next.js 빌드 파일 시스템 검색용).

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  빌드 시점 소스 파일 정적 탐색에 사용되며, 외부 사용자의 제어 불가능한 브레이스 패턴(`{a,b,c...}`)을 서버에서 런타임에 글로빙 파싱하는 코드가 없습니다.

---

### 3.7 `nanoid` (Indirect Dependency via `postcss`, High)

#### (1) 취약점 명세
- **GHSA-28wg-ghj8-5hjv**, **GHSA-2v37-7h3g-55p8** (High): non-secure / custom generator에 size 0 또는 음수 파라미터 전달 시 무한 루프 발생 DoS.

#### (2) 우리 코드 내 사용 방식
- `postcss` 내장 고정 ID 생성용 하위 의존성.

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  `src/` 내 `nanoid` 직접 import 및 호출이 없으며 (`grep` 확인 0건), 외부 파라미터가 `nanoid` 호출 인자로 전달되는 런타임 경로가 존재하지 않습니다.

---

### 3.8 `firebase-admin` 및 하위 GCP 통신 패키지 5종 (`uuid`, `gaxios`, `teeny-request`, `retry-request`, `@google-cloud/storage`) (Moderate 6건)

#### (1) 취약점 명세
- **`uuid`** (**GHSA-w5hq-g745-h8pq**, Moderate): v3/v5/v6 함수 호출 시 사용자 지정 `buf` 버퍼 인자에 대한 경계 검사 누락 (Out-of-bounds write).
- **`gaxios`**, **`teeny-request`**, **`retry-request`**, **`@google-cloud/storage`**, **`firebase-admin`**:  
  위 5개 패키지는 **자체 코드에 0개의 직접 취약점**을 가지며, 하위 의존성 트리 끝단의 `uuid` 취약점으로 인해 `npm audit` 연쇄 반응으로 집계됨.

#### (2) 우리 코드 내 실제 파일 경로 및 사용 방식
- [`src/lib/firebase/admin.ts`](file:///home/fb01/school/src/lib/firebase/admin.ts): `firebase-admin` Auth, Firestore 객체 생성 및 활용
- [`src/lib/google/workspace.ts`](file:///home/fb01/school/src/lib/google/workspace.ts): `googleapis` 내 `gaxios` 사용

#### (3) 실제 도달 가능 경로 평가
- **도달 불가 (Unreachable)**:  
  `uuid` 취약점은 v3/v5/v6 함수에 개발자가 직접 `buf` 버퍼 객체를 인자로 전달할 때 발생하는 특수 상황입니다. 우리 코드 및 하위 SDK(`gaxios`, `teeny-request`)는 `uuid` v4(랜덤 ID)만을 표준 생성으로 호출하며 `buf` 인자를 커스텀 전달하지 않습니다. 또한 `firebase-admin` 및 GCP SDK 5종은 자체 취약점이 존재하지 않습니다.

---

## 4. 종합 요약표 (Fact Checklist for Decision Making)

| 구분 | 전체 취약점 개수 | 실제 런타임 영향 경로 존재 여부 | 주요 원인 및 세부 내용 |
| :--- | :---: | :---: | :--- |
| **`xlsx`** | High 2건 | **도달 가능 (High)** | `TimetableImportTab.tsx`에서 사용자 업로드 파일 `XLSX.read` 파싱 경로 존재 |
| **`next`** | High 4건 / Mod 5건 | **부분 도달 가능 (Medium)** | `rewrites` 프록시 및 API Route Handler 캐시 레이어 (Server Actions/Middleware는 미사용) |
| **기타 11개 패키지** | High 3건 / Mod 5건 | **도달 불가 (None)** | 빌드 전용(`postcss`, `brace-expansion`, `nanoid`), 미사용 기능(`sharp`, `fast-xml-parser`), 단순 하위 의존성 연쇄 집계(`uuid`, `firebase-admin` 등 6종) |

---

## 5. Claude 판단 (2026-08-14, Opus 5) — 조치 결정

### 5-0. 사실 검증 결과

보고서의 핵심 주장을 실물로 대조했다. **전부 맞다.**

| 주장 | 확인 |
|---|---|
| Server Actions 미사용 | `src/` 전체 `"use server"` **0건** ✓ → next 취약점 3건 도달 불가 |
| `middleware.ts` 없음 | 파일 부재 확인 ✓ → Middleware 우회 도달 불가 |
| `next/image` 미사용 | `src/` 전체 **0건** ✓ → `sharp`·SVG DoS 도달 불가 |
| 설치 버전 | `next 16.2.10` / `xlsx 0.18.5` ✓ |

**보고서가 빠뜨린 결정적 사실 2개를 추가로 확인했다.** 이 둘이 조치를 완전히 갈라놓는다.

### 5-1. `next` — **지금 올린다** (패치가 이미 나와 있다)

```
npm 레지스트리의 16.2.x: … 16.2.10(현재), 16.2.11, 16.2.12
취약 영향 범위: >=16.0.0 <16.2.11
```

**16.2.11에서 고쳐졌고 16.2.12까지 나와 있다.** 같은 마이너 안의 패치 상승이라 위험이 낮고, **9건이 한 번에 사라진다.**

> 단, `AGENTS.md`가 경고하듯 이 버전대의 Next.js는 학습 데이터와 다르다. **패치 상승이라도 `npx tsc --noEmit` + `npm run build` + 실화면 확인을 거친다.**

### 5-2. `xlsx` — **지금 바꾸지 않는다** (npm에 고친 버전이 없다)

```
npm 레지스트리의 xlsx 최신 = 0.18.5   ← 지금 우리가 쓰는 그 버전
dist-tags: { latest: '0.18.5' }
```

**고칠 버전이 npm에 존재하지 않는다.** SheetJS가 0.19 이후 npm 배포를 중단했고 수정본은 자체 CDN에만 있다. → `npm audit fix`를 돌려도 이 항목은 **영원히 안 없어진다.** (그래서 이 경고가 계속 남아 있었던 것이고, 돌리지 말라고 한 판단이 맞았다.)

선택지는 셋뿐이고 셋 다 지금은 손해가 크다:
1. **CDN 타르볼로 교체** — 의존성 출처가 npm 밖이 된다. 배포 재현성·잠금 파일 무결성이 약해지고, Vercel 빌드가 외부 호스트에 의존하게 된다. **무료·단순 원칙에 반한다.**
2. **다른 라이브러리로 교체**(exceljs 등) — 파싱 5곳·내보내기 3곳을 다시 쓰고 회귀 검증해야 한다. **9c 시한(11월 말)을 앞두고 쓸 시간이 아니다.**
3. **지금 유지** ← 채택

**위험이 좁다는 것이 근거다:**
- 파싱은 **브라우저에서만** 일어난다 — `TimetableImportTab.tsx`는 `"use client"`이고, **서버 코드에 `XLSX.read`가 0건**이다(`src/app`·`src/lib` 전수). 서버는 이 파일을 만지지 않는다.
- 업로드할 수 있는 사람은 **로그인한 일과계 교사·관리자**뿐이다. 외부인 경로가 없다.
- 즉 성립하는 공격은 *"권한 있는 교사가 남에게 받은 악성 엑셀을 자기 브라우저에서 여는 것"* 이다. 파일 출처가 컴시간(학교 자체 프로그램)이라 현실성이 낮다.
- 다만 0은 아니다 — 그 교사가 super_admin이면 오염된 탭에서 이어지는 조작이 영향을 받을 수 있다.

**결정적 근거 하나 더 — 이 경로는 스스로 사라진다.** `XLSX.read`가 있는 유일한 이유가 **컴시간 엑셀 가져오기**다. 9c(자동 시간표 작성)가 완성되면 컴시간에서 시간표를 받아올 이유 자체가 없어진다. 남는 것은 내보내기(`XLSX.writeFile`) 3곳뿐이고 **그건 취약점 경로가 아니다**(외부 입력을 파싱하지 않는다).

> **즉 이 항목은 라이브러리를 갈아엎어 없애는 것보다, 9c를 끝내서 없애는 편이 싸다.**

**경감 조치(값싼 것만)**: 업로드 전 확장자·크기 상한 검사. 이미 있으면 그대로 두고, 없으면 추가한다. 방어 효과는 제한적이지만 비용이 0에 가깝다.

### 5-3. 나머지 11개 — **아무것도 하지 않는다**

빌드 전용(`postcss`·`brace-expansion`·`nanoid`), 미사용 기능(`sharp`·`fast-xml-parser`), 하위 의존성 연쇄 집계(`uuid` 계열 6종). `next` 패치가 올라가면 이 중 일부는 자연 해소된다.

### 5-4. 재점검 시점

- `next` 패치 후 `npm audit --omit=dev` 재실행 → 남은 건수 기록
- **9c 완성 시** `xlsx` 파싱 경로 제거 여부 확인 → 제거됐으면 이 항목 종결
- 그 전에 `xlsx`에 **원격 실행(RCE)급** 취약점이 새로 나오면 그때는 §5-2의 선택지 1·2를 다시 연다

