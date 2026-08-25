<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# src/core

## 목적

결정론 백테스트 엔진 — 데이터 → 엔진 → 세금 → 지표. **React 무관 순수 TS**이며 전부
테스트로 고정돼 있다. 코드 주석의 `§번호`는 `docs/PRD.md` 섹션 앵커.
import 그래프는 엄격한 비순환: `types` → {`synthetic`,`tax`,`metrics`} →
{`catalog`,`presets`,`engine`} → `data` → `index`. 특히 **engine은 data를 import하지
않는다** (미리 만들어진 `AlignedDataBundle`을 소비).

## 주요 파일

| 파일 | 설명 |
|------|------|
| `types.ts` | 타입 어휘 전체 (~296줄, leaf). 전략 DSL(`AllocationPolicy`/`RebalanceTrigger`/`SellMode`/`DrawdownRule`), 데이터 형태(`DailySeries`/`AlignedDataBundle`), 세금·출력 레코드. 유일한 값 export는 `CASH_TICKER` |
| `engine.ts` | 상태기계 시뮬레이터 (~610줄). `runBacktest()`, `validateStrategy()`(한국어 오류 반환). t 종가 관측 → t+1 시가 체결을 `pendingOrders` 큐로 구조화해 **룩어헤드가 코드상 불가능** |
| `data.ts` | 데이터 레이어 (~585줄). Yahoo v8 파싱(`parseYahooChart`), 해상도 다운그레이드 복구(20년 청크 재조회), 429 백오프(1.5s→3s→6s, 순차 +400ms), 24h localStorage 캐시, 공통 캘린더 정렬(`alignToCommonCalendar`), 스냅샷 해시(FNV-1a), `-HIST` 번들 로더, `-SIM` 합성 해석 |
| `tax.ts` | 한국 세제 순수 함수 (~124줄). 연 손익통산 양도세(가정환율 × −250만 → 22%), 배당 15% 원천 + 종합과세 근사, 크립토 별도 그룹(기본 비활성), `resolveTaxClass` |
| `metrics.ts` | 지표 (~137줄). TWRR(외부 흐름 제거)·MWRR(`xirr` — 결정론 이분법)·growth-of-$1 기준 MDD·수면하 일수(달력일 기준 — 해상도 불변)·관측 빈도 자동 연율화(일간 ≈252, 월간 12) |
| `catalog.ts` | 자산 카탈로그 ~40종 (~150줄). 그룹 7종, `-HIST` 4종·`-SIM` 4종 포함, `assetCautionFor()`(지수·선물·합성·월간 주의문), `isBundleTicker()` |
| `synthetic.ts` | 레버리지 ETF 소급 합성 (~83줄). `buildLeveragedSeries` — `1 + L·r − (L−1)(^IRX+스프레드)/365 − 보수/365`, 배당락일 시가 보정으로 유령 ×L 갭 방지, 음수 방지 클램프 |
| `presets.ts` | 전략 프리셋 (~128줄). 기본 3종 + `histEraStrategies()`(역사 탭 -HIST 3종) + `emptyStrategy()`. id는 UUID(`nextId` — 카운터는 localStorage 복원 후 충돌) |
| `index.ts` | 공개 배럴 + `runComparison()` — 각 전략을 **세금 on/off 2회 실행**해 세금 드래그 분리. 파서·해시·세금 계산 함수 등은 의도적으로 미재수출(테스트가 모듈 직접 import) |

## 엔진 하루 처리 순서 (engine.ts 메인 루프의 번호 주석과 1:1)

| # | 단계 | 요점 |
|---|------|------|
| 1 | 유휴현금 이자 | 실제 경과일수 복리. 배당보다 먼저(당일 배당에 이전 기간 이자 미부과) |
| 2 | 배당 (ex-date) | 체결 전 보유분 기준, 15% 원천 즉시 차감 |
| 3 | 오더 체결 (t 시가) | **매도 먼저**(이동평균 원가 → `yearRealized`), 매수는 예산 비례 축소, 정수주 모드는 floor |
| 4 | 외부 현금 유입 | i===0 포함 월 시작일 적립. overrides → 전일 관측 규칙의 `contributionMultiplier` 순 적용 |
| 5 | 종가 평가 | `value = cash + marketValue(i)` |
| 5.5 | 낙폭 관측 | growth 피크·투입원금 두 기준, **가장 깊은 규칙 하나만** `activeRule`로 |
| 6 | 의사결정 | `pendingOrders = decide(i)` — 내일 시가 체결 큐 적재 (마지막 봉 제외) |
| 7 | 연말 세금 | 양도·크립토·배당 종합과세 → 현금 차감 → **세후 값으로 5.5 낙폭 소급 재관측**(1스텝 지연 방지) → 현금 음수면 1% 버퍼 비례 강제매도 큐 |
| 7.5 | 강제매도 재시도 | 갭다운으로 여전히 음수면 2% 버퍼 재큐 — `cash ≥ 0` 불변식 복원 |
| 8 | 기록 + 리컨실 | `DailyPoint` push, 독립 현금 원장·슬리브 합계 대조 (`RECON_EPS = 1e-6`) |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **위 하루 순서는 불변 규약이다.** 단계 순서를 바꾸거나 사이에 단계를 끼울 때는
  PRD와 대조하고 골든 테스트로 증명할 것. 룩어헤드가 생기는 변경(당일 관측 → 당일 체결)은
  절대 금지.
- **React·DOM import 금지.** 이 레이어는 Node 테스트에서 그대로 돌아야 한다.
- **이중 스트림 규약**: 성과 복리는 비조정 가격 + 배당 현금흐름, `adjClose`는 검증용.
  adjClose로 수익 계산에 배당세까지 매기면 이중계산이 된다 (PRD §3.2).
- `^IRX`는 0·음수 종가가 유효 관측 — 파서의 양수 필터에서 예외 처리돼 있다. 유지할 것.
- 선두 결측 forward-fill은 "직전 관측" 시드가 규약 (시리즈 최초 가격으로 채우면 왜곡 —
  감사에서 잡힌 버그).
- `-HIST`(월간 합성)와 일별·크립토 자산 혼합은 `loadDataBundle`이 throw로 차단한다.
  이 가드를 약화하지 말 것.
- 캘린더는 비크립토 거래일의 교집합 — 주말 크립토 변동이 밴드를 터뜨리지 못하게 하는
  장치다 (PRD §3.3).
- 오류 메시지·경고문은 한국어로, 원인과 해결 방법 포함.

### 테스트 요건

`__tests__/`의 골든마스터·손계산 앵커가 수치를 고정한다 (`__tests__/AGENTS.md` 참조).
엔진·세금·지표 수정 후 `npx vitest run` 필수 — 골든 값이 바뀌는 변경이면 손계산을
다시 도출해 테스트와 함께 갱신하고 커밋 메시지에 근거를 남길 것.

## 의존 관계

### 내부

- `src/fetchUtil.ts` (data.ts의 타임아웃 fetch), `public/data/history-assets.json`
  (`-HIST` 번들), `/yf`·`/stooq` 프록시 (functions/, api/, vite dev 프록시)

### 외부

- 없음 (의존성 zero — 표준 라이브러리만). UI 쪽에서만 react·recharts 사용

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
