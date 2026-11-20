# CLAUDE.md — 투자의 정석 (portfolio-backtester)

투자 교육(가이드북·역사 연구·현재 신호) + 포트폴리오 백테스터 웹앱.
배포: main 푸시 → Vercel 자동 배포 → https://tujajungseok.com/
(Vercel 기본 주소 https://portfolio-backtester-chi.vercel.app/ 도 같은 배포를 가리킨다 — 배포 확인용)
저작권: 김현성 (lifescienkhs@naver.com) — 푸터에 표기됨, 유지할 것.

세션 인수인계 상세(작업 이력·아키텍처·미결 과제)는 **docs/HANDOFF.md**를 먼저 읽을 것.

## 사용자 표준 규칙 (모든 세션에서 유효)

1. **작업물은 전부 깃허브에**. 로컬에만 남기지 말 것(사용자는 공용 컴퓨터 사용).
   작업 단위마다 커밋·푸시하고, 푸시 후 Vercel 배포가 READY인지 확인.
   **묻지 말고 main에 바로 반영**할 것(2026-10-21 사용자 지시). PR·머지 확인 절차 생략.
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
node scripts/e2e/e2e-fullaudit.mjs         # 6개 뷰 × 390/1280/1440 오버플로 검사
node scripts/e2e/e2e-wrapaudit.mjs         # 괄호 줄바꿈 품질 검사 (허용 잔존: 22자+ 본문 괄호)
# 백테스트 실행 흐름(트라이팟 포함)은 저장소 데이터 스냅숏을 야후 형식으로 서빙해 실제로 돌린다:
FIXTURES=1 PORT=4176 node scripts/e2e/staticserver.mjs &
node scripts/e2e/e2e-tripodrun.mjs         # 트라이팟 탭 → 비교 세트 실행 → 결과·보고서, 혼합·적립·기간 지정
```

테스트는 현재 267개(엔진 골든·새 돈 배분·트라이팟 슬리브·연구 코드 대조·실데이터 통합·가이드/도해 무결성·연대기·신호·광기의 해부·트라이팟 대시보드 앵커).
콘텐츠 수치를 바꾸면 tests/의 must-contain 앵커도 함께 갱신해야 한다.

## 아키텍처 지도

- `src/core/` — engine.ts(결정론 시뮬레이터: t 종가 관측 → t+1 시가 체결(전략별로 t+1 종가 선택 가능),
  낙폭 규칙, ruleEpisodes, TRIPOD 신호 슬리브, 기간 끝 청산 기준), data.ts(야후 v8 파싱·달력 정렬·-HIST 번들·
  -EXT 연결 상품(상장 전은 ^NDX 총수익 합성)·트라이팟 신호(판정 준비일 1990-01-15부터)·^IRX 현금 금리), tripod.ts(트라이팟 판정 — 연구 `scripts/tripod/lib.mjs`와
  같은 배열을 `tests/tripod-backtest.test.ts`가 강제하므로 규칙은 두 곳을 같이 바꿀 것), tax.ts(한국 세금 근사),
  metrics.ts(TWRR/MWRR/MDD·청산 기준 MWRR), types.ts
- `src/ui/` — App.tsx(셸: 좌측 레일/하단 탭바, 워크벤치 분할+모바일 위저드),
  HomeView(콕핏), GuideView+guideContent/tradingGuide(가이드 1·2부)+GuideFigure(도해)+
  guideProgress(학습 진도), HistoryView+eraTimelines/eraStories, NowView+nowSignals,
  TripodView+tripodData(트라이팟 국면 대시보드: 판정 로직 없이 signals/tripod/dashboard.json만 표시.
  실시간은 /tripod-signal/* rewrite → GitHub 원본, 실패 시 빌드 저장본 /data/tripod-dashboard.json),
  StrategyCard/SettingsPanel/ResultsSection/ReportView, maniaStory(특집 컬럼)
- `docs/guides/trading-discipline.md` — 1부 원문(수치 변경 시 tradingGuide.ts·
  scripts/verify-timing-math.mjs와 3중 동기화)
- `scripts/` — build-history.mjs(데이터 번들 생성), verify-*.mjs(수치 재검증), e2e/, tripod/(외부 매매법 검증·실전 추적)
- `signals/tripod/` — 트라이팟 실전 추적 기록. GitHub Actions(`.github/workflows/tripod-signal.yml`)가
  매 거래일 main에 직접 커밋하므로 **푸시 전에 항상 `git pull`**. 손으로 고치지 말 것(기록은 추가만).
  이 폴더만 바뀐 커밋은 `vercel.json`의 `ignoreCommand`로 배포를 건너뛴다

## 사용자 운용 전략 현황 (2026-11-21 기준, 바뀌면 이 절을 고칠 것)

사용자가 실제 자산으로 운용하기로 한 규칙이다(2026-11-18 확인). 앱 기능이 아니라 사용자의 개인 운용 계획이고,
문서는 `docs/research/reserve-plan/reserve-plan.pdf`(생성 `scripts/reserve/build-report.mjs`, 자료 `data-src/reserve/`),
논의 경과는 docs/HANDOFF.md 2절의 30번 항목에 있다. 확정된 내용을 다시 설계하자고 하지 말 것.

- **비중**: 기준 비중은 QQQ 50, 암호화폐 10, 금 10, 현금 30. 처음 계획은 QQQ 40, 현금 40에서 시작해 1번 규칙으로 한 번 사는 것이었고,
  1번 규칙은 2026년 11월 하락에서 이미 썼다(2026-11-21 사용자 확인). 지금부터는 기준 비중에서 2, 3, 4번만 본다.
  암호화폐 10은 비트코인 8, 이더리움 2로 맞춘다(2026-11-19 사용자 결정). 4번 규칙의 20%는 둘을 합친 비중으로 본다.
- **규칙 네 개**
  1. (완료, 다시 쓰지 않는다) 처음 한 번: QQQ가 역대 최고 종가보다 20% 이상 내리면 기준 비중으로 맞춘다(현금 40 → 30).
  2. 현금이 20% 이하나 40% 이상이면 전부 기준 비중으로 되돌린다(1번을 썼으므로 40% 상한도 켜져 있다).
  3. 새로 들어오는 돈은 현금이 기준(30%)보다 적으면 현금에, 아니면 기준보다 모자란 자산에 넣는다.
  4. 금이나 암호화폐가 20% 이상이면 10%로 줄이고 판 돈은 현금에 둔다.
- **운용 방식**: 그날 종가로 판단하고 다음 거래일 종가에 바로 조절한다(월 1회 점검 아님). 같은 날 여러 규칙이면 4번, 현금 20%, 현금 40% 순서.
  규칙에 없는 주식은 일반 주식이면 QQQ 몫에, 암호화폐 관련 주식이면 암호화폐 몫에 넣어 센다(2026-11-21 사용자 결정).
  전체의 0.5% 미만 매매는 하지 않는다. 조건은 사용자가 직접 확인한다(자동 알림 없음).
  현금은 달러 단기 국채 ETF, 금은 KRX 금현물 계좌와 실물(매매는 KRX 계좌에서만, 실물은 비중 계산에만), 암호화폐는 거래소, 나머지는 증권사 계좌.
  전부 일반 계좌에서 한다(언제 현금이 필요할지 모른다는 이유. 연금저축, IRP, ISA는 쓰지 않는다). 사고판 날의 비중과 이유는 사용자가 따로 기록한다.
- **지금 상태**: 1번 규칙을 쓴 뒤다. 다음에 사는 때는 현금이 40%가 되는 날이고(기준 비중에서 현금 외 자산이 36%쯤 내려야 한다), 파는 때는 현금이 20%가 되는 날이다.
  QQQ 역대 최고 종가 759.66달러(2026-10-06), 2026-11-20 종가 608.45달러(최고 종가보다 19.9% 낮음). 장중 고가가 아니라 종가로 본다.
- **합의된 해석**: 이 규칙은 초과 수익이 아니라 지키기 쉬운 틀이다(기준 비중을 매달 되돌린 것과 결과가 거의 같다). 기대 연수익률은 8~11%로 본다
  (기준 비중에서 시작한 계산, 2026-11-20 자료: 최근 5년 10.4%, 2004년부터 11.0%, 1999년부터 8.8%. 2014년부터의 17.9%는 비트코인 초기 상승 몫). 낙폭은 평소 25~35%, 닷컴 버블 같은 장에서는 더 깊다.
- **사용자가 정한 것(다시 권하지 말 것, 물으면 답한다)**: 환율은 분석에서 뺀다(원화 기준 검증은 하지 않았다).
  절세 계좌는 쓰지 않는다. 금 실물과 KRX 계좌의 비율은 사용자가 알아서 관리한다. 주식 몫을 S&P 500이나 배당 ETF로 나누는 안은 계산만 해 보았고 사용자가 고르지 않았다.
  이 규칙을 앱 백테스터에 넣는 일은 보류.
- **개인 정보**: 이 저장소는 공개다. 보유 금액, 평균 단가, 매수 기록, 증권사와 거래소 이름은 어떤 파일에도 적지 않는다.
- **돈을 뺄 때**: 따로 규칙을 두지 않는다. 필요한 돈은 현금에서 빼고, 그래서 현금이 20% 이하가 되면 2번 규칙이 그대로 처리한다(2026-11-19). 새 규칙으로 다시 꺼내지 말 것.
- **자료 갱신**: 사이트의 `/yf` 프록시로 일봉을 받아 `data-src/reserve/*.csv`(QQQ, GLD, BTC-USD, ETH-USD, IRX)에 덧붙이고 `node scripts/reserve/build-report.mjs`를 돌린다
  (본문 서술은 `check()`가 계산과 맞는지 강제한다. 계산은 기준 비중에서 시작하고, 현금 40%에서 1번 규칙을 기다린 경우는 비교용 `wait`로만 남아 있다). 그 뒤 `plain-korean-writing` 검사에서 거부 0건, 쪽수 10쪽을 확인한다.
