# CLAUDE.md — 투자의 정석 (portfolio-backtester)

투자 교육(가이드북·역사 연구·현재 신호) + 포트폴리오 백테스터 웹앱.
배포: main 푸시 → Vercel 자동 배포 → https://portfolio-backtester-chi.vercel.app/
저작권: 김현성 (lifescienkhs@naver.com) — 푸터에 표기됨, 유지할 것.

세션 인수인계 상세(작업 이력·아키텍처·미결 과제)는 **docs/HANDOFF.md**를 먼저 읽을 것.

## 사용자 표준 규칙 (모든 세션에서 유효)

1. **작업물은 전부 깃허브에**. 로컬에만 남기지 말 것(사용자는 공용 컴퓨터 사용).
   작업 단위마다 커밋·푸시하고, 푸시 후 Vercel 배포가 READY인지 확인.
2. **앱 콘텐츠에 이모지 금지**. 아이콘은 lucide-react 인라인 SVG만.
3. **콘텐츠 정확도는 컨센서스 수준이 최우선**. 수치·역사 서술은 검증된 값만.
   앱에 이미 있는 검증 수치와 어긋나는 새 수치를 만들지 말 것.
4. **문체: em-dash(—) 남용 금지**. 삽입구는 괄호, 리드인은 쉼표, 사슬 연결은 문장 분리.
   예외(유지): 절·장 제목의 디자인 대시, 데이터 결측 표시 '—', 보호 인용문 원문.
   번역투·AI 문체(그것은/이것은, 존재하다, 같은 종결어미 근접 반복, 메타 신호어) 지양.
5. **가이드 인용 동기화**: `guideContent.ts`의 `quotes[].quote` 문자열은
   eraTimelines/nowSignals/NowView/HistoryView 등의 앱 원문을 글자 그대로 인용한다.
   원문·인용 어느 쪽도 단독 수정 금지(둘 다 같이 바꾸고 테스트로 확인).
6. **줄바꿈 품질**: 짧은 괄호 묶음이 줄에 걸쳐 갈라지면 안 됨 —
   `nbspShortParens`(src/ui/common.ts) 사용. UI 변경 후 `scripts/e2e/` 검수 실행.
7. UI는 기존 디자인 시스템을 확장: IBM Plex Sans KR/Mono, 프라이머리 #2962ff,
   라이트 #eef1f5 페이지·#fff 카드·헤어라인 #e0e3eb, 다크 #131722/#1e222d/#2a2e39,
   시리즈 팔레트는 common.ts의 SERIES_COLORS_*. 카드 rounded-xl + 미세 그림자.

## 검증 워크플로 (변경 후 필수)

```bash
npx tsc --noEmit && npx eslint <변경 파일> && npx vitest run && npm run build
# UI 변경 시 추가로 (Playwright 필요 — scripts/e2e/README 참조):
node scripts/e2e/staticserver.mjs &        # dist를 4175 포트로 서빙 (/yf,/fred는 404)
node scripts/e2e/e2e-fullaudit.mjs         # 5개 뷰 × 390/1280/1440 오버플로 검사
node scripts/e2e/e2e-wrapaudit.mjs         # 괄호 줄바꿈 품질 검사 (허용 잔존: 22자+ 본문 괄호)
```

테스트는 현재 170개(엔진 골든·가이드/도해 무결성·연대기·신호·광기의 해부 앵커).
콘텐츠 수치를 바꾸면 tests/의 must-contain 앵커도 함께 갱신해야 한다.

## 아키텍처 지도

- `src/core/` — engine.ts(결정론 시뮬레이터: t 종가 관측 → t+1 시가 체결, 낙폭 규칙,
  ruleEpisodes), data.ts(야후 v8 파싱·달력 정렬·-HIST 번들), tax.ts(한국 세금 근사),
  metrics.ts(TWRR/MWRR/MDD), types.ts
- `src/ui/` — App.tsx(셸: 좌측 레일/하단 탭바, 워크벤치 분할+모바일 위저드),
  HomeView(콕핏), GuideView+guideContent/tradingGuide(가이드 1·2부)+GuideFigure(도해)+
  guideProgress(학습 진도), HistoryView+eraTimelines/eraStories, NowView+nowSignals,
  StrategyCard/SettingsPanel/ResultsSection/ReportView, maniaStory(특집 컬럼)
- `docs/guides/trading-discipline.md` — 1부 원문(수치 변경 시 tradingGuide.ts·
  scripts/verify-timing-math.mjs와 3중 동기화)
- `scripts/` — build-history.mjs(데이터 번들 생성), verify-*.mjs(수치 재검증), e2e/
