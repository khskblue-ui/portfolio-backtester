/**
 * 트라이팟 신호 슬리브 — 백테스트 엔진이 쓰는 규칙 정의 (순수 함수, React·DOM 무관)
 *
 * 규칙은 연구 코드 `scripts/tripod/lib.mjs`의 computeSignals(RULE_DEFAULT)를 그대로 옮겼다.
 * 실전 추적(live.mjs)·연구 결과와 같은 판정 배열이 나와야 하므로 이동평균(누적합 갱신)과
 * 52주 고점(단조 덱) 계산 방식까지 같게 했다. 일치 여부는 tripod.test.ts가 저장소 스냅숏으로 확인한다.
 *
 * - 국면: 나스닥100 종가 > 250일선 × 1.01이면 상승, < 250일선 × 0.95면 하락, 그 사이는 직전 국면 유지
 * - 상승 국면: VIX 10일 평균 < 28 이고 52주(252거래일) 종가 고점 대비 낙폭 ≥ −9% → 3배(T3), 아니면 1.5배(B15)
 * - 하락 국면: VIX 10일 평균 < 18 → 1.5배(B15), 아니면 현금
 * - 첫 밴드 이탈 전에는 현금. t일 종가로 판정하고 체결은 엔진의 체결 시점 설정(기본 다음 거래일 종가)을 따른다
 */

import type { TripodState } from './types'

/** 규칙 계수 (연구 RULE_DEFAULT와 같은 값 — 결과를 보고 바꾸지 말 것) */
export const TRIPOD_RULE = {
  maWin: 250,
  upBand: 1.01,
  downBand: 0.95,
  vixWin: 10,
  vixUp: 28,
  vixDown: 18,
  ddLimit: -0.09,
  ddWin: 252,
} as const

/** 신호 원천 티커 (야후) — 판정에만 쓰고 보유하지 않는다 */
export const TRIPOD_SIGNAL_INDEX = '^NDX'
export const TRIPOD_SIGNAL_VIX = '^VIX'

/** 트라이팟 슬리브가 사고파는 상품 [1배, 2배, 3배] — 상장 전 구간은 합성으로 이어 붙인 -EXT (1985-10~) */
export const TRIPOD_PRODUCTS = ['QQQ-EXT', 'QLD-EXT', 'TQQQ-EXT'] as const

/** 가상 슬리브 티커 → 최대 노출. 2배판은 3배 자리에 QLD 100%를 쓴다 */
export const TRIPOD_SLEEVES: Record<string, { top: 2 | 3; label: string }> = {
  TRIPOD: { top: 3, label: '트라이팟' },
  'TRIPOD-2X': { top: 2, label: '트라이팟 2배판' },
}

export function isTripodTicker(ticker: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRIPOD_SLEEVES, ticker.trim().toUpperCase())
}

/** 상태 → [QQQ, QLD, TQQQ, 현금] 비중 */
export function tripodWeights(state: TripodState, top: 2 | 3): [number, number, number, number] {
  if (state === 'T3') return top === 3 ? [0, 0, 1, 0] : [0, 1, 0, 0]
  if (state === 'B15') return [0.5, 0.5, 0, 0]
  return [0, 0, 0, 1]
}

/** 슬리브가 실제로 보유할 수 있는 상품 티커 (2배판은 TQQQ를 쓰지 않음) */
export function tripodComponentsFor(ticker: string): string[] {
  const top = TRIPOD_SLEEVES[ticker.trim().toUpperCase()]?.top
  if (top == null) return []
  return top === 3 ? [...TRIPOD_PRODUCTS] : [TRIPOD_PRODUCTS[0], TRIPOD_PRODUCTS[1]]
}

/**
 * 같은 전략에 따로 넣을 수 없는 티커 — 구성 상품과 그 실물(상장 후 같은 증권). 한 계좌의 같은 증권은
 * 이동평균 원가가 하나로 합쳐져야 하는데 슬리브별로 따로 들고 있으면 양도세가 어긋나므로 검증에서 막는다
 */
export function tripodConflictsFor(ticker: string): string[] {
  const real: Record<string, string> = { 'QQQ-EXT': 'QQQ', 'QLD-EXT': 'QLD', 'TQQQ-EXT': 'TQQQ' }
  return tripodComponentsFor(ticker).flatMap((c) => [c, real[c]])
}

/** 상태의 노출 배수 (요약 표시용) */
export function tripodExposure(state: TripodState, top: 2 | 3): number {
  return state === 'T3' ? top : state === 'B15' ? 1.5 : 0
}

// ─── 지표 (연구 코드와 같은 계산) ─────────────────────────────────────────────

/** 단순이동평균 — 누적합에서 창 밖 값을 빼는 방식 (연구 sma와 비트 단위 일치) */
function sma(arr: ArrayLike<number>, w: number): Float64Array {
  const out = new Float64Array(arr.length).fill(NaN)
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
    if (i >= w) s -= arr[i - w]
    if (i >= w - 1) out[i] = s / w
  }
  return out
}

/** 종가 기준 최근 win거래일(오늘 포함) 최고가 대비 낙폭 (연구 drawdown52 'c252') */
function drawdownFromHigh(close: ArrayLike<number>, win: number): Float64Array {
  const n = close.length
  const out = new Float64Array(n).fill(NaN)
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    while (dq.length && close[dq[dq.length - 1]] <= close[i]) dq.pop()
    dq.push(i)
    const lo = i - win + 1
    while (dq[0] < lo) dq.shift()
    if (lo >= 0) out[i] = close[i] / close[dq[0]] - 1
  }
  return out
}

/**
 * VIX를 지수 달력에 맞춘다 — 같은 날짜 값만 쓰고, 없으면 직전 값을 이어 쓴다(시작 전은 NaN).
 * 미국 지수와 VIX는 같은 날 장이 끝나므로 같은 날짜 값이 판정 시점에 알려진 값이다(연구 loadMarket).
 */
export function alignVixToIndex(indexDates: string[], vixDates: string[], vixClose: number[]): number[] {
  const m = new Map<string, number>()
  for (let i = 0; i < vixDates.length; i++) m.set(vixDates[i], vixClose[i])
  let last = NaN
  return indexDates.map((d) => {
    const v = m.get(d)
    if (v != null) last = v
    return last
  })
}

export interface TripodSignals {
  /** 지수 거래일 */
  dates: string[]
  /** 그날 종가로 정한 목표 상태 (지표 준비 전 null) */
  target: (TripodState | null)[]
  regime: ('UP' | 'DOWN' | null)[]
}

/**
 * 매일 장 마감 후 판정한 목표 상태. close·vix는 dates와 같은 길이(vix는 alignVixToIndex 결과).
 * 지표가 준비되는 조건: 250일선, VIX 10일 창에 결측 없음, 52주 낙폭 계산 가능.
 */
export function computeTripodSignals(dates: string[], close: number[], vix: number[]): TripodSignals {
  const r = TRIPOD_RULE
  const n = dates.length
  const ma = sma(close, r.maWin)
  const vix10 = sma(vix.map((v) => (Number.isNaN(v) ? 0 : v)), r.vixWin)
  const vixGap = sma(vix.map((v) => (Number.isNaN(v) ? 1 : 0)), r.vixWin) // 결측이 섞인 창 배제
  const dd = drawdownFromHigh(close, r.ddWin)
  const target: (TripodState | null)[] = new Array(n).fill(null)
  const regime: ('UP' | 'DOWN' | null)[] = new Array(n).fill(null)
  let reg: 'UP' | 'DOWN' | null = null
  for (let i = 0; i < n; i++) {
    const ready = !Number.isNaN(ma[i]) && vixGap[i] === 0 && !Number.isNaN(dd[i])
    if (!ready) continue
    const p = close[i]
    if (p > r.upBand * ma[i]) reg = 'UP'
    else if (p < r.downBand * ma[i]) reg = 'DOWN'
    regime[i] = reg
    let t: TripodState
    if (reg === null) t = 'CASH'
    else if (reg === 'UP') t = vix10[i] < r.vixUp && dd[i] >= r.ddLimit ? 'T3' : 'B15'
    else t = vix10[i] < r.vixDown ? 'B15' : 'CASH'
    target[i] = t
  }
  return { dates, target, regime }
}

/**
 * 지수 달력의 판정을 백테스트 달력에 옮긴다 — 각 날짜에 "그날 이전(포함) 마지막 지수 거래일"의 판정.
 * 백테스트 달력은 보유 자산들의 거래일 교집합이라 지수 달력과 거의 같고, 빠진 날은 다음 날 판정이 대신한다.
 */
export function alignTripodTargets(sig: TripodSignals, dates: string[]): (TripodState | null)[] {
  const out: (TripodState | null)[] = new Array(dates.length).fill(null)
  let j = -1
  for (let k = 0; k < dates.length; k++) {
    while (j + 1 < sig.dates.length && sig.dates[j + 1] <= dates[k]) j++
    out[k] = j >= 0 ? sig.target[j] : null
  }
  return out
}
