# 시간표 편성 탐색 기법 리서치 (2026-08-22)

> 계기: 사용자 지시 — *"웹사이트 등을 다 뒤져보면 시간표 로직 좋은 거에 대한 아이디어가 있을 수 있지 않을까?"*
> 조사 = Claude 백그라운드 에이전트(웹 검색·원문 열람). 요약·적용 판단 = Claude.
> 직결 문제의식: ⑦-e까지 와서도 남는 잔존 위반(시드 1의 김원선 목 5-6-7)은 **2자 교환·3자 회전 반경 밖**이다 — 학계도 같은 진단으로 「더 큰 이웃」으로 갔다.

## 우리 구조와의 관계 (요약)

우리 솔버(MRV 그리디 → ejection → 국소 탐색 → 위반 표적 사후 보수)는 학계 표준 구조(ITC 2011 우승 솔버 = 구축 → 국소 탐색 보수)와 같은 계열이다. 이식 가치 1순위는 **위반 표적 LNS(부분 파괴·재배치)**와 **Kempe 체인 교환** — 둘 다 "배치 단계에서 조이지 않고 사후에 고친다"는 우리 노선과 같은 철학이고 결정론 구현이 가능하다.

## 추천 상위 5

### 1. 위반 표적 LNS — 부분 파괴 후 재배치 (Demirović & Musliu) ★원문 확인
- 출처: [MaxSAT-based LNS for HSTT (PDF, TU Wien)](https://dbai.tuwien.ac.at/user/demir/papers/MaxSAT%20Based%20Large%20Neighborhood%20Search%20for%20High%20School%20Timetabling-%20Demirovi%C4%87,%20Musliu.pdf) · [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0305054816301927)
- 국소 탐색이 막히면 해의 일부만 파괴(배치 해제)하고 그 부분만 재배치. 파괴 단위 = 자원 2개 조합(교사 A+B가 걸린 수업 전부) 또는 요일 부분집합. 작은 근방부터, 근방당 최대 2회 방문.
- 이식: 사후 보수가 멈춘 잔존 위반에 대해 ①위반 교사+상대 교사(또는 학급) 조합 ②위반 요일 1개를 해제하고 기존 MRV 그리디+ejection으로 재배치. 개선 시만 채택 + 실패 시 원복이면 결정론 유지.
- 효과 축: 총점·구조적 잔존(S2·S4류). 위험: 재배치가 다른 축을 흔듦 → 전체 점수 개선 시만 채택 필수. 파괴 범위 크면 느림 → 소근방 한정.

### 2. Kempe 체인 교환 (두 시간대 간 충돌 연결 요소 통째 맞바꾸기)
- 출처: [Hybrid SA with Kempe Chain (ResearchGate)](https://www.researchgate.net/publication/221635609_A_Hybrid_Simulated_Annealing_with_Kempe_Chain_Neighborhood_for_the_University_Timetabling_Problem) · [이웃 구조 비교 연구](https://www.researchgate.net/publication/220403505_Neighborhood_analysis_A_case_study_on_curriculum-based_course_timetabling)
- 시간대 p·q 사이에서 "옮기면 충돌하는 것들을 연쇄로 함께 옮기는" 연결 요소 전체 교환. 하드 제약이 자동 보존. 비교 연구들에서 이웃 중 최상위 효과(단, 대학 시간표 기준 — 고교 효과 크기는 추정).
- 이식: 위반 수업에서 시작해 (요일p·교시p, 요일q·교시q) 체인을 BFS로 결정론 전개 → 가상 점수 → 개선 시만 적용. 체인 길이 상한(6~8)으로 통제. **잔존 김원선류(모든 2자·3자 후보가 feasibility 탈락)의 정확한 처방.**
- 효과 축: S2·S1 동시. 위험: 긴 체인이 다른 축을 흔듦 → 개선-한정 채택.

### 3. 슬롯쌍 교환의 학급 간 전파 (Zhang et al. 2010) ★원문 확인
- 출처: [EJOR 2010 (PDF)](https://staff.fmi.uvt.ro/~daniela.zaharie/am2016/proiecte/aplicatii/timetabling/SA+timetabling3.pdf)
- 한 학급의 p↔q 교환이 하드 충돌로 기각될 때, 충돌 상대 학급에도 같은 (p,q) 교환을 이어 붙여 충돌을 소멸시킨다(Kempe의 학급 축 특수형). 이 논문 감점 설계가 우리와 거의 일치(주간 부하 균형=S1, 같은 날 같은 과목=몫).
- 이식: 기존 「같은 학급 맞교환」의 확장이라 구현 최소. 효과 축: 국소 탐색 도달 범위 → 총점. 위험: 낮음(개선-한정 시).

### 4. Late Acceptance Hill-Climbing (LAHC) — 수용 기준 한 줄 교체
- 출처: [Burke & Bykov, EJOR](https://www.sciencedirect.com/science/article/abs/pii/S0377221716305495) · [PATAT 2008 (PDF)](https://patatconference.org/patat2008/proceedings/Bykov-HC2a.pdf)
- "지금보다 좋으면 수락" 대신 "L번 전 점수보다 좋으면 수락". 매개변수 = 이력 길이 L 하나. 시드 고정 rng 그대로라 결정론 유지.
- 이식: 30k 국소 탐색의 수용 판정만 교체(원형 배열 L≈500~5000) + 최고해 스냅숏 별도 보관. 효과 축: 국소 최적 탈출 → 총점. 위험: L 튜닝 실패 시 예산 내 수렴 못 할 수 있음(효과 크기 추정).

### 5. Ejection 심화 — FET식 깊이 + 전역 예산 + 순환 방지
- 출처: [FET 생성 알고리즘 공식 문서](https://lalescu.ro/liviu/fet/doc/en/generation-algorithm-description.html) · [FET 포럼(저자)](https://lalescu.ro/liviu/fet/forum/index.php?topic=444.0)
- FET는 깊이 ~14 재귀 + 전역 호출 예산(~2n) + 순환 방지로 밀어내기를 깊게 쓴다(수많은 실학교 검증).
- 이식: 현 깊이 2를 "깊이 8~14 + 전역 호출 예산 + 최근 밀려난 수업 재이동 금지(타부 표식)"로. 효과 축: 하드 충족·폴백 감소. 위험: 깊은 체인이 잘 짜인 부분을 헤집음 — 하드 우선이라 소프트 일시 악화 가능.

## 나머지 (짧게)

- SA+ILS 하이브리드(GOAL, ITC 2011 우승) — 구축기/보수기 분리 + 보수기에 다양한 이웃. [Springer](https://link.springer.com/article/10.1007/s10479-014-1685-4) (원문 유료 — 2차 인용 기반)
- KHE 다형 ejection chain — 한 체인에 이동·교환 등 이종 보수 혼합. [Semantic Scholar](https://www.semanticscholar.org/paper/The-KHE-High-School-Timetabling-Engine-Kingston/a9e8c1ae3c3e32b1b1cbc7c1a178ff1e337441c2) (⚠ KHE 공식 사이트 접속 불가 — 2차 출처 기반)
- 다중 시작 — 이미 시드 포트폴리오 8종으로 구현돼 있음 (추가 이득은 Web Worker 병렬화 정도)
- 타부 리스트 — 보수 패스의 제자리걸음 방지 최소 장치 (현재는 단조 감소 조건이 같은 역할)
- 단계적 감점(soft cardinality) — 상한 이분법 대신 초과량 비례 벌점. 죽음/경유 차등이 이미 이 정신 — S1도 5·6·7시간 등급화 가능
- aSc Timetables 실무 규칙 — 교사 연속 상한 3(더블 예외), 공강 이중 상한(주간 총량+하루), **생성기가 어떤 제약을 완화했는지 보고하는 진단 UX**(이식 가치: 편성 실패 시 원인 제약 표시). [연속 상한](https://help.asctimetables.com/text.php?id=1038&lang=en) · [공강 제한](https://help.edupage.org/?lang_id=1&p=u1%2Fu3%2Fu57%2Fu79%2Ft168)
- OR-Tools CP-SAT 관행 — 연속 상한 = 슬라이딩 윈도 합 ≤ k 선형화. [Medium 예제](https://medium.com/suboptimally-speaking/school-timetabling-with-constraint-programming-495f1126c28d)
- XHSTT 벤치마크 — 실인스턴스 30여 개, 회귀 벤치마크 확장용 데이터원(형식 변환 비용 있음). [Springer](https://link.springer.com/article/10.1007/s10479-011-1012-2)

## 확인 한계 (조사 에이전트 명시)

- 원문 직접 확인 = Demirović & Musliu(LNS)·Zhang et al.·FET 문서 셋뿐. KHE 사이트 접속 불가, GOAL 원문 유료.
- "Kempe 최상위 효과"는 대학 시간표 기준 — 고교 30학급 효과 크기는 추정.
