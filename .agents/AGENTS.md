<!-- BEGIN:autocomplete-input-rules -->
# 계정 및 그룹 입력 필드 자동완성(Autocomplete) 의존 규칙

이 프로젝트에서 사용자 계정(이메일, 아이디) 혹은 구글 워크스페이스 그룹 메일 주소를 텍스트로 직접 입력하거나 검색해야 하는 새로운 입력창을 개발할 때, 다음 개발 수명 주기를 준수해야 한다:

1. **공통 AutocompleteInput 컴포넌트 사용**:
   - 직접 텍스트 인풋창을 설계하지 않고, `AutocompleteInput` (또는 이를 래핑한 자동완성 전용 컴포넌트)을 공용으로 사용하여 이메일, 성, 이름 기반의 통합 검색 및 드롭다운 선택을 구현한다.
   
2. **성능 최적화 필수**:
   - 자동완성 검색 기능 구현 시 **디바운스(Debounce, 200~300ms)**를 필수 적용하여 사용자가 타이핑하는 동안 서버 요청이 몰리지 않도록 보호한다.
   - 그룹 메일 등 데이터 용량이 고정적이고 작은 정보는 페이지 로드 시 1회만 fetch하여 **로컬 메모리 필터링**을 적용하고, 사용자 계정 등 가변적인 대량 정보는 입력에 따라 API를 **온디맨드 호출**한다.

3. **성/이름 검색 지원**:
   - 일반 계정 검색의 경우, 사용자가 이메일 아이디 외에도 성(Family Name) 또는 이름(Given Name)을 입력해도 검색이 지원되도록 API 쿼리를 연동한다.
<!-- END:autocomplete-input-rules -->

<!-- BEGIN:deployment-checklist-rules -->
# 정식 배포(Deployment) 시 체크리스트 점검 의존 규칙

이 프로젝트의 정식 상용 배포(Deployment) 요청 시, AI 코딩 에이전트는 다음 사항을 반드시 이행해야 한다:

1. **배포 체크리스트 파일 사전 로드**:
   - 배포 지원을 시작하기 전에 반드시 아래 아티팩트 파일을 로드하여 점검 사항 및 검증 시나리오를 숙지한다:
     - [deployment_checklist.md](file:///home/fb01/.gemini/antigravity-ide/brain/df7bb5f4-6ff8-4650-9da8-db5a2dbf44d9/deployment_checklist.md)

2. **환경 변수 가이드**:
   - Vercel 등 배포 플랫폼에 입력할 환경 변수를 안내할 때, 이메일 발신 전용 알리미 계정(`GOOGLE_WORKSPACE_SENDER_EMAIL="hmnotice@hmh.or.kr"`) 및 실제 배포 도메인 주소(`NEXT_PUBLIC_BASE_URL`)가 누락되지 않도록 강조하여 사용자에게 알린다.

3. **서비스 계정 역할(IAM) 검증 안내**:
   - 배포 후 Firebase 인증 동기화가 에러 없이 작동할 수 있도록, 최고관리자 위임(Domain-wide delegation) 셋업과 더불어 서비스 계정에 **`Firebase 인증 관리자`** 역할이 정상적으로 부여되었는지 검사 단계를 안내한다.
<!-- END:deployment-checklist-rules -->
