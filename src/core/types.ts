/**
 * 백테스터 타입 정의 — 설정형 포트폴리오 백테스터 v1 (PRD v1.1)
 *
 * 모든 금액은 USD. v1은 FX 미지원 — 결과는 원화 실현손익이 아님(UI 상시 경고).
 * 세금 계산에 필요한 원화 기준(250만 공제 등)은 config의 가정 환율로 근사.
 */

// ─── 데이터 레이어 ────────────────────────────────────────────────────────────

/** 단일 자산의 일별 시계열 (비조정 가격 + 배당 분해 + 총수익) */
export interface DailySeries {
  ticker: string
  /** "YYYY-MM-DD" (거래소 로컬 날짜) */
  dates: string[]
  /** 시가 (비조정, 스플릿만 반영) — t+1 체결용 */
  open: number[]
  /** 종가 (비조정, 스플릿만 반영) — 평가·시그널용 */
  close: number[]
  /** 수정종가 (배당+스플릿 반영) — 총수익 검증용. 세금 계산에 사용 금지(이중계산). */
  adjClose: number[]
  /** ex-date 기준 주당 배당금 (USD). 배당 없는 날은 키 없음 */
  dividends: Record<string, number>
}

/** 공통 거래 캘린더에 정렬된 데이터 번들 */
export interface AlignedDataBundle {
  /** 공통 거래일 (NYSE 캘린더 기준 교집합) */
  dates: string[]
  /** ticker → 캘린더에 정렬된 시계열 */
  series: Record<string, AlignedSeries>
  /** 데이터셋 스냅샷 해시 (재현성 — 같은 데이터 = 같은 해시) */
  snapshotHash: string
  /** 자산별 원본 시작일 (비정렬 시작일 경고용) */
  firstDates: Record<string, string>
  /** 최늦 시작일로 클립됐을 때 잘려나간 자산 경고 */
  clipWarnings: string[]
}

export interface AlignedSeries {
  ticker: string
  open: number[]
  close: number[]
  adjClose: number[]
  /** dates 인덱스 → 주당 배당 (없으면 0) */
  divPerShare: number[]
}

// ─── 전략 DSL ─────────────────────────────────────────────────────────────────

/** 현금 슬리브 전용 가상 티커 */
export const CASH_TICKER = 'CASH'

export interface SleeveConfig {
  /** 자산 티커 (Yahoo Finance 심볼) 또는 'CASH' */
  ticker: string
  /** 목표 비중 (0~1, 합계 1) */
  targetWeight: number
  /** 세금 자산군 (기본 foreign_equity) */
  taxClass?: TaxAssetClass
}

/** 5.4 자산군별 세금 플러그인 분류 */
export type TaxAssetClass = 'foreign_equity' | 'crypto' | 'exempt'

/**
 * 4.3 적립 배분 정책
 * - to_underweight: 목표 대비 부족분에 비례 배분(shortfall-proportional).
 *   전 슬리브 부족분 충족 후 잔여는 목표비중 비례. (결정론 고정 — PRD 4.3)
 * - pro_rata: 목표비중 비례
 * - fixed_split: 고정 분할 (fixedSplit 필수)
 */
export type AllocationPolicy = 'to_underweight' | 'pro_rata' | 'fixed_split'

export interface ContributionConfig {
  /** 초기 일시 투자금 (USD) */
  initialUsd: number
  /** 월 적립금 (USD) — 매월 첫 거래일 종가에 유입, 다음날 시가 체결 */
  monthlyUsd: number
  allocation: AllocationPolicy
  /** fixed_split일 때 ticker → 비율 (합 1) */
  fixedSplit?: Record<string, number>
}

/** 4.4 리밸런싱 트리거 */
export type RebalanceTrigger = 'none' | 'periodic' | 'bands' | 'band_or_periodic'

/**
 * 매도 정책:
 * - sell_to_target: 트리거 발동 시 매도 포함 전면 리밸런싱
 * - no_sell: 절대 매도 안 함 — 적립·현금을 미달 슬리브로만 (과대 슬리브는 무동작+플래그)
 * - no_sell_except_periodic: 밴드는 매수만, periodic 주기 도래 시에만 매도 허용
 */
export type SellMode = 'sell_to_target' | 'no_sell' | 'no_sell_except_periodic'

export interface RebalanceConfig {
  trigger: RebalanceTrigger
  /** periodic 주기 (개월) */
  periodMonths?: number
  /** 절대 밴드 (%p): |현재비중 − 목표| ≥ bandAbsPct/100 */
  bandAbsPct?: number
  /** 상대 밴드 (%): |현재/목표 − 1| ≥ bandRelPct/100 */
  bandRelPct?: number
  mode: SellMode
}

export interface CostConfig {
  /** 거래 수수료 (bps of notional) */
  feeBps: number
  /** 스프레드/슬리피지 (bps) — 사이즈 무관 고정 근사(PRD 4.5). 매수 +, 매도 − */
  spreadBps: number
}

export interface ExecutionConfig {
  /** 분수주 허용 여부. false면 정수주 + 잔여현금 이월(PRD 4.5) */
  fractionalShares: boolean
  /** 유휴현금 연 수익률 (%) — SGOV/단기국채 근사(PRD 4.5) */
  cashAnnualYieldPct: number
  /** 현금 스윕: 유휴현금(CASH 목표 초과분)이 이 금액을 넘으면 다음날 매수 */
  minTradeUsd: number
}

// ─── 세금 설정 (§5) ───────────────────────────────────────────────────────────

export interface TaxConfig {
  enabled: boolean
  /**
   * 5.1 원가법 — v1은 이동평균만 구현 (한국 증권사 기본).
   * FIFO는 P2. "증권사 방식 확인" 필요.
   */
  costBasisMethod: 'moving_average'
  /** v1 한계: USD 손익 × 가정 환율로 원화 근사 (실제는 거래일 환율 — P2) */
  assumedUsdKrw: number
  capitalGains: {
    /** 양도세율 (%) — 22 (지방세 포함) */
    ratePct: number
    /** 연 1회 기본공제 (KRW) — 250만 */
    annualDeductionKrw: number
  }
  dividends: {
    /** 미국 원천징수 (%) — 15. 외국납부세액공제로 국내 추가징수 없음(≤2천만) */
    usWithholdingPct: number
    /** 금융소득 종합과세 임계 (KRW) — 2,000만 */
    comprehensiveThresholdKrw: number
    /** 가정: 포트폴리오 외 기타 금융소득 (KRW/년) */
    assumedOtherFinancialIncomeKrw: number
    /** 가정 한계세율 (%) — 임계 초과 시 (한계세율 − 원천세율) 추가 과세 근사 */
    assumedMarginalRatePct: number
  }
  /** 5.4 가상자산 — 과세 반복 유예 중. 기본 비활성 + "현행법 확인" 플래그 */
  crypto: {
    enabled: boolean
    ratePct: number
    annualDeductionKrw: number
  }
}

// ─── 전략 ─────────────────────────────────────────────────────────────────────

export interface StrategyConfig {
  id: string
  name: string
  sleeves: SleeveConfig[]
  contribution: ContributionConfig
  rebalance: RebalanceConfig
  costs: CostConfig
  execution: ExecutionConfig
  tax: TaxConfig
}

// ─── 엔진 출력 ────────────────────────────────────────────────────────────────

export interface TradeLogEntry {
  date: string
  ticker: string
  side: 'BUY' | 'SELL'
  shares: number
  price: number
  fee: number
  /** 매도 시 실현손익 = 양도가액(매도 수수료 차감 후) − 이동평균 취득가액(매수 수수료 포함) — 세법 규약 */
  realizedPnl?: number
  /** 체결 사유 */
  reason: 'initial' | 'contribution' | 'rebalance' | 'cash_sweep' | 'forced_tax_sale'
}

export interface TaxLogEntry {
  year: number
  kind: 'capital_gains' | 'dividend_comprehensive' | 'crypto'
  /** 연간 통산 실현손익 (USD) */
  netRealizedUsd: number
  /** 적용 공제 (KRW) */
  deductionKrw: number
  /** 납부 세액 (USD) */
  taxUsd: number
}

export interface DailyPoint {
  date: string
  /** 종가 기준 총 평가액 (현금 포함) */
  value: number
  /** 당일 외부 현금흐름 (적립/초기 납입) — TWRR 계산용 */
  externalFlow: number
  /** 누적 납입 */
  cumContributions: number
  /** 슬리브별 평가액 */
  sleeveValues: Record<string, number>
  cash: number
}

export interface EngineWarning {
  date: string
  code: 'no_sell_overweight' | 'negative_cash_tax' | 'band_unclosable' | 'reconciliation'
  message: string
}

export interface BacktestResult {
  strategyId: string
  daily: DailyPoint[]
  trades: TradeLogEntry[]
  taxes: TaxLogEntry[]
  dividendsGrossUsd: number
  dividendsWithheldUsd: number
  totalFeesUsd: number
  totalTaxesUsd: number
  warnings: EngineWarning[]
  finalValue: number
  totalContributions: number
}

// ─── 지표 (§6) ────────────────────────────────────────────────────────────────

export interface Metrics {
  /** TWRR 연환산 (%) — 전략 자체 성과, 다중 비교 잣대 */
  twrrAnnualPct: number
  /** MWRR/IRR 연환산 (%) — 실제 달러 경험 */
  mwrrAnnualPct: number
  /** growth-of-$1 (TWRR) 시계열 — 낙폭은 여기서 계산(6.2) */
  growthOf1: { date: string; value: number }[]
  /** 최대 낙폭 (%) — TWRR 기준 */
  maxDrawdownPct: number
  /** 최장 수면하 기간 (달력일 — 전고점 날짜부터의 실제 경과일, 해상도 불변) */
  maxUnderwaterDays: number
  /** 스텝 변동성 연환산 (%) — 연환산 계수는 관측 스텝/년(일별 ≈252, 역사 월간 12) */
  volAnnualPct: number
  /** 연도별 TWRR (%) — 서브기간 견고성(6.4) */
  annualReturns: { year: number; returnPct: number }[]
  finalValue: number
  totalContributions: number
}
