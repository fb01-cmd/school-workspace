# 효명고등학교 관리 시스템 (school-sync-hub)

Google Workspace 계정·학적 관리와 시간표·결보강 운영을 한곳에서 처리하는 학교 내부 시스템.
Next.js + Firebase(Firestore·Auth) + Vercel, 전 구성 무료 티어 원칙.

## 문서 안내 (읽는 순서)

1. **[AGENTS.md](./AGENTS.md)** — 모든 공통 규칙의 단일 원본 (협업 분업·보안·배포 체크리스트 등)
2. [product_overview.md](./product_overview.md) — 제품 개요 한 장
3. [development_roadmap.md](./development_roadmap.md) — Phase 현황·아이디어 목록
4. [project_notes.md](./project_notes.md) — 세션 핸드오버·의사결정 누적 기록
5. 운영 매뉴얼: [operations_handbook.md](./operations_handbook.md) · [deployment_checklist.md](./deployment_checklist.md) · [discipline_manual.md](./discipline_manual.md) · [roster_feed_manual.md](./roster_feed_manual.md) · [personal_data_inventory.md](./personal_data_inventory.md)
6. 활성 스펙: [phase9b_spec.md](./phase9b_spec.md)(시간표·결보강) 및 [docs/](./docs) — 완료된 과거 스펙·참고자료는 [archive/](./archive)

## 개발

```bash
npm run dev    # 개발 서버 (localhost:3000)
npx tsc --noEmit && npm run build   # 배포 전 확인 (힙 옵션은 build 스크립트에 이미 들어 있다 — 따로 붙이지 마라)
```

환경 변수는 `.env.local`(로컬)과 Vercel 프로젝트 설정(배포)에 있으며 저장소에 커밋하지 않는다.
