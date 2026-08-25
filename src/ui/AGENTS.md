<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# src/ui

## 목적

화면 레이어 전체. React 컴포넌트 15개(.tsx)와 순수 콘텐츠·로직 모듈 11개(.ts)로
구성된다. 구조 패턴이 일관됨: **콘텐츠·로직은 import가 거의 없는 순수 leaf 모듈,
JSX와 상태는 전부 .tsx**. 이 분리는 fast refresh 유지 목적도 있다
(비컴포넌트 export가 .tsx에 섞이면 fast refresh가 깨져서 episodeInfo.ts처럼 분리).

## 주요 파일 — 순수 모듈 (.ts)

| 파일 | 설명 |
|------|------|
| `common.ts` | 공유 기반 (124줄). `SERIES_COLORS_LIGHT/DARK` 전략 팔레트(6색 고정, `MAX_STRATEGIES`=팔레트 길이), `SharedSettings`+`applyShared()`(전 전략 동일 가정 주입 — 사과 대 사과 비교 보장), 포맷터 4종(U+2212 마이너스), `nbspShortParens()`(괄호 줄바꿈 방지), 클래스 토큰(`cardCls` 등), `uniqueRunLabels()`(recharts dataKey 충돌 방지 — 외관 아닌 정확성 헬퍼) |
| `guideContent.ts` | 가이드 2부(경제 공부) 콘텐츠 (956줄, 최대 파일). `GUIDE_CHAPTERS` 9 STEP + `GUIDE_GLOSSARY` + `GUIDE_INTRO`. **가이드 시스템 전체의 타입 홈** (`GuideSection`/`GuideChapter`/`GlossaryEntry`/`AppQuote`) |
| `tradingGuide.ts` | 가이드 1부(매매 습관 교정) 콘텐츠 (550줄). `TRADING_GUIDE_CHAPTERS` 7챕터 + `TRADING_GUIDE_GLOSSARY` 24항목. `docs/guides/trading-discipline.md`의 앱 포팅 — **3중 동기화 대상** |
| `guideProgress.ts` | 가이드 학습 진도 (75줄). `GUIDE_PROGRESS_KEY`(`bt_guide_progress_v1`), `loadGuideProgress()`, `computePartProgress()`. GuideView가 쓰고 HomeView가 읽는 유일한 교차 뷰 키 |
| `nowSignals.ts` | 신호 판정 순수 로직 (306줄). `assessNow(history, live?)` → 신호 5종(`market`/`valuation`/`inflation`/`realRate`/`curve`), `ok/watch/alert` 3단계. 테스트 가능성을 위해 의도적으로 순수 함수 |
| `nowData.ts` | 신호용 라이브 데이터 수집 (154줄). `fetchLiveSnapshot()` — 소스별 독립 try/catch, 필드 단위 번들 폴백, 3시간 캐시(`bt_now_live_v2`) |
| `eraTimelines.ts` | 역사 에피소드 국면별 연대기 (603줄). 국면 클릭 시 차트 음영의 데이터 원천 |
| `eraStories.ts` | 에피소드별 "통념 vs 실제 구조" 내러티브 (215줄) + `STORY_EPISTEMICS` 면책 |
| `episodeInfo.ts` | 7개 낙폭 에피소드 구조 원인 메타 (41줄, `YYYY-MM` 키) |
| `maniaStory.ts` | 특집 컬럼 "광기의 해부" (134줄). 닷컴·서브프라임 vs 현재 AI 랠리, `dataAsOf` 필드 보유 |
| `historyExtra.ts` | 나스닥 오버레이 라이브 페치 (170줄). 컨센서스 가드(닷컴 −60% 체크 등) 실패 시 null |

## 주요 파일 — 컴포넌트 (.tsx)

| 파일 | 설명 |
|------|------|
| `HistoryView.tsx` | 역사 연구 탭 (866줄, 최대 컴포넌트). 1900~ 차트, 에피소드 7종, 연대기 음영, 오버레이, 모달 2종 진입. **로컬 `SERIES_COLORS`는 자산 의미론 맵 — common.ts 전략 팔레트와 별개(의도된 분리)** |
| `GuideView.tsx` | 가이드 탭 셸 (463줄). 파트 전환, TOC, `**bold**` 미니 렌더러, 인용/비유/함정/표/도해 블록, 용어 사전, 스크롤 진도 기록 |
| `HomeView.tsx` | 홈 콕핏 (239줄). 체제 히어로 + 신호 5종 + 이어서 카드. **세 도메인(신호·학습·백테스트)을 모두 잇는 유일한 허브** |
| `NowView.tsx` | 현재 신호 탭 (341줄). 체크리스트 + 신호별 1900~ 추이 차트(역사 임계선) |
| `ResultsSection.tsx` | 백테스트 결과 (507줄). 비교 차트 브러시, 지표 표, 세전/세후 토글, 규칙 에피소드 음영 |
| `StrategyCard.tsx` | 전략 편집기 (322줄). 슬리브·적립 배분·리밸런싱 규칙 DSL |
| `SettingsPanel.tsx` | 공통 가정(`SharedSettings`) 편집기 (146줄) |
| `ReportView.tsx` | 인쇄 보고서 오버레이 (328줄). 인쇄 관례상 항상 라이트 스타일, `SERIES_COLORS_LIGHT`만 사용 |
| `GuideFigure.tsx` | 도해 렌더러 (189줄). `bars`/`flow`/`quad` 3종 — **HTML·CSS 전용, SVG 텍스트 금지가 의도**(폭·테마 무관 라벨 안정). 도해 타입 홈(guideContent가 타입 역수입하는 유일한 사례) |
| `EraStoryModal.tsx` / `ManiaStoryModal.tsx` | 포털 모달. ManiaStoryModal은 History·Now 두 곳에서 열림 |
| `HelpTip.tsx` | "?" 팝오버 (106줄). body 포털 + 뷰포트 클램프. 최다 재사용 프리미티브 |
| `NowPanel.tsx` | 신호 체크리스트 카드 (83줄, 표현 전용 — 로직은 nowSignals) |
| `NumberInput.tsx` | ko-KR 천 단위 구분 숫자 입력 (59줄) |
| `EpistemicsBanner.tsx` | "백테스트는 예측이 아님" 상시 경고 (19줄) |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **앱 콘텐츠에 이모지 금지.** 아이콘은 lucide-react 인라인 SVG만.
- **`guideContent.ts`의 `quotes[].quote` 15건은 텍스트 결합**: eraTimelines/nowSignals/
  NowView/HistoryView의 앱 원문을 글자 그대로 손 복사한 것. 참조가 아닌 텍스트 동기화라
  이 코드베이스에서 가장 깨지기 쉬운 결합이다. **어느 쪽도 단독 수정 금지** — 둘 다
  바꾸고 `npx vitest run`으로 확인.
- **`tradingGuide.ts` 수치 변경 = 3중 동기화**: `docs/guides/trading-discipline.md` +
  `scripts/verify-timing-math.mjs`와 함께.
- **분량 킥커는 GuideView가 reduce로 동적 계산 — 하드코딩 금지.** 유일한 수동 지점은
  `GUIDE_INTRO`의 "1부 90분 + 2부 124분" 문구(분량 변경 시 갱신).
- **`nbspShortParens` 상한 규약**: 기본 12자(도해 라벨) / 본문 rich 18 / 표 셀 20 /
  도해 캡션 20 / 용어 사전 22. 소비처는 GuideFigure(8곳)·GuideView(6곳)뿐.
  새 텍스트 표면을 추가하면 같은 규약으로 감쌀 것.
- **색 체계 2개를 혼동하지 말 것**: common.ts `SERIES_COLORS_*`는 전략 팔레트(백테스트),
  HistoryView 로컬 `SERIES_COLORS`는 자산·매크로 의미색. 이름이 비슷하지만 무관.
- **백테스트 결과 차트는 선형 유지 — 로그 축 금지** (사용자 지시로 확정).
- 도해 데이터 수치는 본문에 이미 있는 값만 사용(새 수치 창작 금지, note에 가정 명시).
- 문체: em-dash 남용 금지(제목·결측·보호 인용 예외), 번역투·메타 신호어 지양.
- localStorage 키는 `bt_` 접두 + 스키마 버전 접미(`bt_theme`만 예외적 무버전 raw 문자열).
  구조 변경 시 키 버전을 올려 자연 리셋시킬 것. 전체 인벤토리: `bt_theme`,
  `bt_strategies_v1`, `bt_shared_v1`, `bt_guide_progress_v1`, `bt_nasdaq_v1`,
  `bt_ndx100_v2`, `bt_now_live_v2`, `bt_series_v2_<ticker>`(core/data.ts).

### 테스트 요건

- 콘텐츠 모듈(guideContent/tradingGuide/eraTimelines/nowSignals/maniaStory 등)은
  `tests/*.test.ts`의 must-contain 앵커가 수치·문구를 고정한다. 콘텐츠 수정 시 앵커 동반 갱신.
- UI 변경 후: `npx tsc --noEmit && npx eslint <파일> && npx vitest run && npm run build`,
  이어서 `scripts/e2e/` 3종(오버플로·괄호 줄바꿈) 실행.

### 공통 패턴

- 새 콘텐츠성 export는 .tsx가 아닌 .ts 모듈로 (fast refresh 보호).
- 모달은 `createPortal`, 팝오버는 HelpTip 재사용.
- 숫자 표기는 common.ts 포맷터(U+2212 마이너스) 경유.

## 의존 관계

### 내부

- `@/core` — 엔진 타입·실행(백테스트 계열 컴포넌트, HomeView). **가이드 계열은 core와 완전 분리**
  (GuideView는 core를 전혀 import하지 않음)
- import 방향: common.ts는 순수 leaf(9개 파일이 의존), 콘텐츠 모듈은 전부 zero-import leaf

### 외부

- react 19, recharts 3 (차트), lucide-react (아이콘), tailwindcss 4 (스타일)

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
