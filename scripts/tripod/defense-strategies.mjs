// 방어형 후보 규칙 — 명세: docs/research/tripod/defense-spec.md (2026-10-27 사전 등록, 결과를 보기 전에 고정)
// 각 함수는 시장 m(loadMarket 형태: dates·close·irx)을 받아 날짜별 목표 노출 L(0~2배)을 돌려준다.
// L[i]는 i일 종가로 정한 값이고 다음 거래일 종가에 체결한다(strategies.mjs planOf). 지표가 준비되기 전에는 null.
// VIX를 쓰지 않으므로 1990년 이전·미국 밖 시장에도 그대로 적용된다.
import { sma } from './lib.mjs'

/** 명세 §2의 값 (결과를 보고 바꾸지 말 것) */
export const DEF = Object.freeze({
  lamFast: 0.94, lamSlow: 0.97, init: 20, volReady: 252, refMin: 1260,
  lmax: 2, alpha: 0.75, ddWin: 252, step: 0.5, maWin: 250, upBand: 1.01, downBand: 0.95,
})

/** EWMA 연율 변동성. 처음 init개 로그수익의 평균제곱으로 시작하고 volReady번째 거래일부터 값을 낸다 */
export function ewmaVol(close, lam, { init = DEF.init, ready = DEF.volReady } = {}) {
  const n = close.length
  const out = new Array(n).fill(null)
  let v = 0
  for (let i = 1; i < n; i++) {
    const r = Math.log(close[i] / close[i - 1])
    if (i <= init) { v += (r * r) / init; continue }
    v = lam * v + (1 - lam) * r * r
    if (i >= ready) out[i] = Math.sqrt(v * 252)
  }
  return out
}

/** 보수적 변동성 = max(빠른 추정, 느린 추정): 급등에는 빨리, 진정에는 천천히 반응 */
export function conservativeVol(close) {
  const f = ewmaVol(close, DEF.lamFast), s = ewmaVol(close, DEF.lamSlow)
  return f.map((x, i) => (x === null || s[i] === null ? null : Math.max(x, s[i])))
}

/** 최대·최소 힙 한 쌍으로 확장 창 중앙값 */
class RunningMedian {
  constructor() { this.lo = []; this.hi = [] } // lo: 최대 힙(작은 절반), hi: 최소 힙(큰 절반)
  static push(h, x, less) {
    h.push(x)
    let i = h.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (!less(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p }
  }
  static pop(h, less) {
    const top = h[0], last = h.pop()
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < h.length && less(h[l], h[m])) m = l
        if (r < h.length && less(h[r], h[m])) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m], h[i]]; i = m
      }
    }
    return top
  }
  add(x) {
    const gt = (a, b) => a > b, lt = (a, b) => a < b
    if (!this.lo.length || x <= this.lo[0]) RunningMedian.push(this.lo, x, gt)
    else RunningMedian.push(this.hi, x, lt)
    if (this.lo.length > this.hi.length + 1) RunningMedian.push(this.hi, RunningMedian.pop(this.lo, gt), lt)
    else if (this.hi.length > this.lo.length) RunningMedian.push(this.lo, RunningMedian.pop(this.hi, lt), gt)
  }
  get size() { return this.lo.length + this.hi.length }
  get value() { return this.lo.length > this.hi.length ? this.lo[0] : (this.lo[0] + this.hi[0]) / 2 }
}

/**
 * 기준 변동성: 데이터 첫날부터 그날까지 vol의 중앙값. 월말 종가에만 갱신해 다음 월말까지 유지, 표본 refMin개 이상부터 유효.
 * 마지막 날이 월말인지는 다음 날 데이터가 없어 알 수 없으므로 m.lastIsMonthEnd(실전 추적이 거래소 달력으로 채움)를 쓴다.
 */
export function referenceVol(m, vol, refMin = DEF.refMin) {
  const n = vol.length
  const rm = new RunningMedian()
  const out = new Array(n).fill(null)
  let cur = null
  for (let i = 0; i < n; i++) {
    if (vol[i] !== null) rm.add(vol[i])
    const monthEnd = i < n - 1 ? m.dates[i].slice(0, 7) !== m.dates[i + 1].slice(0, 7) : !!m.lastIsMonthEnd
    if (monthEnd && rm.size >= refMin) cur = rm.value
    out[i] = cur
  }
  return out
}

/** 250일선 밴드 국면: 'UP'·'DOWN', 첫 이탈 전은 'NONE'(현금), 이동평균 준비 전은 null */
export function bandRegime(close) {
  const ma = sma(close, DEF.maWin)
  let reg = 'NONE'
  return close.map((c, i) => {
    if (Number.isNaN(ma[i])) return null
    if (c > DEF.upBand * ma[i]) reg = 'UP'
    else if (c < DEF.downBand * ma[i]) reg = 'DOWN'
    return reg
  })
}

const roundStep = (x) => Math.round(x / DEF.step) * DEF.step

/** 분산 조절 노출 V = min(lmax, (σ_ref/σ)²) (반올림 전) */
export function varianceExposure(m) {
  const vol = conservativeVol(m.close)
  const ref = referenceVol(m, vol)
  return vol.map((s, i) => (s === null || ref[i] === null ? null : Math.min(DEF.lmax, (ref[i] / s) ** 2)))
}

/**
 * 후보별 목표 노출. kind: 'd1' 추세+분산 · 'd2' +낙폭 예산 · 'd3' 분산만 · 'd4' 추세 1배.
 * D2의 그림자 순자산은 세전으로, i일 수익은 i−1일 종가에 보유한 노출(= i−2일 판정)로 번다.
 */
export function defenseExposure(m, kind) {
  const n = m.close.length
  const reg = bandRegime(m.close)
  const V = kind === 'd4' ? null : varianceExposure(m)
  const L = new Array(n).fill(null)
  if (kind !== 'd2') {
    for (let i = 0; i < n; i++) {
      if (kind === 'd4') { if (reg[i] !== null) L[i] = reg[i] === 'UP' ? 1 : 0; continue }
      if (V[i] === null) continue
      if (kind === 'd3') L[i] = roundStep(V[i])
      else if (reg[i] !== null) L[i] = reg[i] === 'UP' ? roundStep(V[i]) : 0
    }
    return L
  }
  // D2: 낙폭 예산 — 그림자 순자산 W와 직전 252거래일 최고치(단조 덱)
  const W = new Float64Array(n)
  W[0] = 1
  const dq = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const dt = (Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5 / 365
      // 금리 자료가 없는 날(1984년 이전 ^IRX, 일부 시장 첫날)은 0으로 둔다. 첫 평가에서 NaN이 그림자 순자산 전체로
      // 번져 나스닥 종합·FTSE100의 D2가 계산되지 않은 것을 고친 것이다(규칙 값은 그대로)
      const rf = Number.isFinite(m.irx[i - 1]) ? (m.irx[i - 1] / 100) * dt : 0
      const r = m.close[i] / m.close[i - 1] - 1
      const h = i >= 2 ? (L[i - 2] ?? 0) : 0
      W[i] = W[i - 1] * (1 + h * (r - rf) + rf)
    }
    while (dq.length && W[dq[dq.length - 1]] <= W[i]) dq.pop()
    dq.push(i)
    while (dq[0] <= i - DEF.ddWin) dq.shift()
    if (V[i] === null || reg[i] === null) continue
    if (reg[i] !== 'UP') { L[i] = 0; continue }
    const M = W[dq[0]]
    const g = Math.min(1, Math.max(0, (1 - (DEF.alpha * M) / W[i]) / (1 - DEF.alpha)))
    L[i] = roundStep(Math.min(DEF.lmax, V[i] * g))
  }
  return L
}

export const DEFENSE = [
  { id: 'd1', name: '추세 + 분산 조절 2배', desc: '상승 국면이면 min(2, (기준 변동성 ÷ 보수적 변동성)²), 하락 국면이면 현금. 0.5배 단위' },
  { id: 'd2', name: '추세 + 분산 조절 + 낙폭 예산', desc: 'D1에 그림자 순자산의 1년 고점 대비 여유 계수(낙폭 한도 25%)를 곱함' },
  { id: 'd3', name: '분산 조절 2배', desc: '국면 없이 min(2, (기준 변동성 ÷ 보수적 변동성)²)' },
  { id: 'd4', name: '추세 국면 1배', desc: '250일선 밴드 상승 국면이면 1배, 하락이면 현금' },
].map((s) => ({ ...s, exposure: (m) => defenseExposure(m, s.id) }))

// ── 2차 후보 (명세 §6, 1차 결과를 본 뒤 등록) ────────────────────────────

/** 반켈리 비율 (분수 켈리 관례값, 결과를 보고 바꾸지 말 것) */
export const KELLY_FRACTION = 0.5

/**
 * 초과수익 추정 μ̂: 데이터 첫날부터 그날까지 일간 (지수 종가 수익률 − ^IRX 일할)의 산술평균 × 252.
 * 월말 종가에만 갱신해 다음 월말까지 유지, 표본 refMin개 이상부터 유효. 금리 결측일은 금리 0
 */
export function excessMean(m, refMin = DEF.refMin) {
  const n = m.close.length
  const out = new Array(n).fill(null)
  let s = 0, k = 0, cur = null
  for (let i = 1; i < n; i++) {
    const dt = (Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5 / 365
    const rf = Number.isFinite(m.irx[i - 1]) ? (m.irx[i - 1] / 100) * dt : 0
    s += m.close[i] / m.close[i - 1] - 1 - rf
    k++
    const monthEnd = i < n - 1 ? m.dates[i].slice(0, 7) !== m.dates[i + 1].slice(0, 7) : !!m.lastIsMonthEnd
    if (monthEnd && k >= refMin) cur = (s / k) * 252
    out[i] = cur
  }
  return out
}

/** 반켈리 노출 K = min(2, max(0, 0.5 × μ̂ / σ²)) (반올림 전) */
export function kellyRaw(m) {
  const vol = conservativeVol(m.close), mu = excessMean(m)
  return vol.map((s, i) => (s === null || mu[i] === null ? null : Math.min(DEF.lmax, Math.max(0, (KELLY_FRACTION * mu[i]) / (s * s)))))
}

/** K1: 반켈리 분산 조절, K2: + 추세 국면(하락이면 현금) */
export function kellyExposure(m, trend) {
  const K = kellyRaw(m)
  const reg = trend ? bandRegime(m.close) : null
  return K.map((x, i) => {
    if (x === null || (trend && reg[i] === null)) return null
    if (trend && reg[i] !== 'UP') return 0
    return roundStep(x)
  })
}

export const DEFENSE2 = [
  { id: 'k1', name: '반켈리 분산 조절', desc: 'min(2, 0.5 × 과거 초과수익 평균 ÷ 보수적 변동성²), 0.5배 단위', exposure: (m) => kellyExposure(m, false) },
  { id: 'k2', name: '반켈리 분산 조절 + 추세 국면', desc: 'K1을 250일선 밴드 상승 국면에서만, 하락이면 현금', exposure: (m) => kellyExposure(m, true) },
]
