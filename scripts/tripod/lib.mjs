// 트라이팟 매매법 독립 재현 검증 — 공용 모듈 (데이터 · 가상 상품 · 규칙 · 지표)
// 명세: docs/research/tripod/spec-v2.md, 결과: docs/research/tripod-verification.md
// Node 표준 라이브러리만 사용. 앱 엔진(src/core)과는 독립 구현이다.
import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = path.resolve(import.meta.dirname, '../../data-src/tripod')
const DAY = 86_400_000

// ── 데이터 ────────────────────────────────────────────────────────────────

export function readBars(name) {
  const lines = fs.readFileSync(path.join(DATA_DIR, `${name}.csv`), 'utf8').trim().split('\n').slice(1)
  return lines.map((l) => {
    const [d, o, h, lo, c, a] = l.split(',')
    return { d, o: +o, h: +h, l: +lo, c: +c, a: a === '' ? NaN : +a }
  })
}

export function readDivs(name) {
  const f = path.join(DATA_DIR, `${name}-div.csv`)
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map((l) => {
    const [d, amt] = l.split(',')
    return { d, amt: +amt }
  })
}

const DIV_ETF = { NDX: 'QQQ', GSPC: 'SPY' } // 배당 프록시 ETF가 있는 지수
const US_INDEX = new Set(['NDX', 'GSPC', 'IXIC', 'RUT'])

/**
 * 기준 지수 달력으로 정렬한 일별 데이터.
 * base: 'NDX'(기본)·'GSPC'(배당 프록시 ETF: NDX→QQQ, GSPC→SPY) 또는 critique.mjs용 다른 지수
 * (IXIC·RUT·N225·GDAXI·FTSE·HSI·KS11, 배당 프록시 없음 → preDivYield만 적용).
 * VIX·IRX는 기준 달력에 맞춰 직전 값 forward-fill. 미국 밖 지수는 같은 날짜의 VIX가
 * 그 시장 마감 뒤에 확정되므로 날짜가 앞선 미국 거래일 값만 쓴다(미래 참조 방지).
 * irxName: 금리 계열 파일명. 1984년 이전이 필요하면 'IRX-1971'.
 */
export function loadMarket({ base = 'NDX', end = '2026-08-28', irxName = 'IRX' } = {}) {
  const idx = readBars(base).filter((x) => x.d <= end)
  const etf = DIV_ETF[base] ?? null
  const ffill = US_INDEX.has(base)
    ? (bars) => {
        const m = new Map(bars.map((x) => [x.d, x.c]))
        let last = NaN
        return idx.map((x) => { const v = m.get(x.d); if (v != null) last = v; return last })
      }
    : (bars) => {
        let j = -1
        return idx.map((x) => { while (j + 1 < bars.length && bars[j + 1].d < x.d) j++; return j < 0 ? NaN : bars[j].c })
      }
  const etfBars = etf ? readBars(etf) : []
  const etfClose = new Map(etfBars.map((x) => [x.d, x.c]))
  // 배당락일 → 배당수익률(전 거래일 ETF 종가 대비)
  const divYield = new Map()
  for (const dv of etf ? readDivs(etf) : []) {
    const i = etfBars.findIndex((x) => x.d >= dv.d)
    if (i > 0) divYield.set(etfBars[i].d, dv.amt / etfBars[i - 1].c)
  }
  return {
    base, etf, etfStart: etf ? etfBars[0].d : '9999-12-31',
    dates: idx.map((x) => x.d),
    open: idx.map((x) => x.o), high: idx.map((x) => x.h), close: idx.map((x) => x.c),
    vix: ffill(readBars('VIX')),
    irx: ffill(readBars(irxName)),
    etfClose, divYield,
  }
}

// ── 가상 상품 ─────────────────────────────────────────────────────────────

/**
 * 비용 모델 — 2단계(calibrate.mjs)에서 확정해 동결한 값. 트라이팟 결과를 보고 바꾸지 말 것.
 * - preDivYield: ETF 상장 전(NDX는 1999-03 이전) 지수 배당수익률 가정(연 %).
 *   0이 영상의 QQQ 보유 성과에 가장 가깝다(0.25여도 CAGR +0.07%p).
 * - etfFee: 1배 ETF 보수(연 %). ETF 분배금은 보수 차감 후라 상장 후 구간은 보수만큼 되돌려 총수익(gross)을 만든다
 * - levFee: 레버리지 ETF 보수(연 %)
 * - spread: 차입금리(^IRX) 위 스프레드(연 %). 0.75는 실제 QLD·TQQQ 추적오차(+0.21·+0.14%p)와
 *   영상의 QLD·TQQQ 보유 성과(19.7%·16.4%) 양쪽에 동시에 맞는 값이다.
 */
export const COST_DEFAULT = { preDivYield: 0, etfFee: 0.20, levFee: 0.95, spread: 0.75, divs: true }

/**
 * 일별 상품 계수. 인덱스 i는 (i-1 종가 → i 종가) 구간.
 * full[k][i]: 종가→종가 계수, night[k][i]: 종가→시가 계수 (시가 체결용).
 * k: 0=QQQ(1배) 1=QLD(2배) 2=TQQQ(3배) 3=현금
 */
export function buildProducts(mkt, cost = COST_DEFAULT) {
  const n = mkt.dates.length
  const L = [1, 2, 3]
  const full = [0, 1, 2, 3].map(() => new Float64Array(n).fill(1))
  const night = [0, 1, 2, 3].map(() => new Float64Array(n).fill(1))
  for (let i = 1; i < n; i++) {
    const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / DAY
    const yr = dt / 365
    const rf = (mkt.irx[i - 1] / 100) * yr
    let div = 0
    if (cost.divs) {
      if (mkt.dates[i] < mkt.etfStart) div = (cost.preDivYield / 100) * yr
      else div = (mkt.divYield.get(mkt.dates[i]) ?? 0) + (cost.etfFee / 100) * yr
    }
    const rPx = mkt.close[i] / mkt.close[i - 1] - 1
    const rOn = mkt.open[i] / mkt.close[i - 1] - 1
    const rTr = rPx + div
    for (let k = 0; k < 3; k++) {
      const fee = (k === 0 ? cost.etfFee : cost.levFee) / 100 * yr
      const fin = (L[k] - 1) * (rf + (cost.spread / 100) * yr)
      full[k][i] = Math.max(0, 1 + L[k] * rTr - fin - fee)
      night[k][i] = Math.max(1e-12, 1 + L[k] * rOn)
    }
    full[3][i] = 1 + rf
    night[3][i] = 1
  }
  return { full, night }
}

/** 단일 상품 보유 자산곡선 (start~end, 시작 1) */
export function holdCurve(mkt, prod, k, startIdx, endIdx = mkt.dates.length - 1) {
  const v = new Float64Array(endIdx - startIdx + 1)
  v[0] = 1
  for (let i = startIdx + 1; i <= endIdx; i++) v[i - startIdx] = v[i - startIdx - 1] * prod.full[k][i]
  return v
}

// ── 지표 (신호용) ─────────────────────────────────────────────────────────

export function sma(arr, w) {
  const out = new Float64Array(arr.length).fill(NaN)
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
    if (i >= w) s -= arr[i - w]
    if (i >= w - 1) out[i] = s / w
  }
  return out
}

export function ema(arr, w) {
  const out = new Float64Array(arr.length).fill(NaN)
  const a = 2 / (w + 1)
  let e = NaN
  for (let i = 0; i < arr.length; i++) {
    e = Number.isNaN(e) ? arr[i] : a * arr[i] + (1 - a) * e
    if (i >= w - 1) out[i] = e
  }
  return out
}

/**
 * 52주 고점 대비 낙폭. def:
 *  'c252' 종가 252거래일 최고가(기본) / 'h252' 장중 고가 252거래일 /
 *  'c250' 종가 250거래일 / 'c365' 종가 달력 365일
 */
export function drawdown52(mkt, def = 'c252') {
  const n = mkt.dates.length
  const src = def === 'h252' ? mkt.high : mkt.close
  const out = new Float64Array(n).fill(NaN)
  const dq = [] // 단조 감소 덱(인덱스)
  let lo = 0
  for (let i = 0; i < n; i++) {
    while (dq.length && src[dq[dq.length - 1]] <= src[i]) dq.pop()
    dq.push(i)
    if (def === 'c365') {
      const t0 = Date.parse(mkt.dates[i]) - 365 * DAY
      while (Date.parse(mkt.dates[lo]) <= t0) lo++
    } else {
      lo = i - (def === 'c250' ? 250 : 252) + 1
    }
    while (dq[0] < lo) dq.shift()
    if (lo >= 0) out[i] = mkt.close[i] / src[dq[0]] - 1
  }
  return out
}

// ── 트라이팟 규칙 ─────────────────────────────────────────────────────────

export const TARGETS = {
  T3: [0, 0, 1, 0], // TQQQ 100%
  B15: [0.5, 0.5, 0, 0], // QQQ 50% + QLD 50%
  CASH: [0, 0, 0, 1],
}

export const RULE_DEFAULT = {
  maWin: 250, maType: 'sma', upBand: 1.01, downBand: 0.95,
  vixWin: 10, vixUp: 28, vixDown: 18, ddLimit: -0.09, useDD: true,
  ddDef: 'c252',
  hold: 'A', // V3 — 'A': 밴드 안에서는 국면만 유지, 'B': 목표 포트폴리오 전체 유지
  init: 'cash', // V4 — 'cash': 첫 밴드 이탈 전까지 현금, 'ma': 첫날 지수>MA면 UP
  signalFrom: null, // 신호 상태기계 시작일(null=지표가 계산되는 첫날)
}

/** 매일 장 마감 후 판정한 목표('T3'|'B15'|'CASH')와 국면 배열 */
export function computeSignals(mkt, rule = RULE_DEFAULT) {
  const r = { ...RULE_DEFAULT, ...rule }
  const n = mkt.dates.length
  const ma = r.maType === 'ema' ? ema(mkt.close, r.maWin) : sma(mkt.close, r.maWin)
  const vix10 = sma(mkt.vix.map((v) => (Number.isNaN(v) ? 0 : v)), r.vixWin)
  const vixOk = sma(mkt.vix.map((v) => (Number.isNaN(v) ? 1 : 0)), r.vixWin) // 결측 포함 창 배제
  const dd = drawdown52(mkt, r.ddDef)
  const target = new Array(n).fill(null)
  const regime = new Array(n).fill(null)
  let reg = null
  let prevT = null
  for (let i = 0; i < n; i++) {
    const ready = !Number.isNaN(ma[i]) && vixOk[i] === 0 && (!r.useDD || !Number.isNaN(dd[i])) &&
      (!r.signalFrom || mkt.dates[i] >= r.signalFrom)
    if (!ready) continue
    const p = mkt.close[i]
    const inBand = !(p > r.upBand * ma[i]) && !(p < r.downBand * ma[i])
    if (p > r.upBand * ma[i]) reg = 'UP'
    else if (p < r.downBand * ma[i]) reg = 'DOWN'
    else if (reg === null && r.init === 'ma') reg = p > ma[i] ? 'UP' : 'DOWN'
    regime[i] = reg
    let t
    if (reg === null) t = 'CASH'
    else if (r.hold === 'B' && inBand && prevT !== null) t = prevT
    else if (reg === 'UP') t = vix10[i] < r.vixUp && (!r.useDD || dd[i] >= r.ddLimit) ? 'T3' : 'B15'
    else t = vix10[i] < r.vixDown ? 'B15' : 'CASH'
    target[i] = t
    prevT = t
  }
  return { target, regime, ma, vix10, dd }
}

const sameHold = (a, b) => a === b // B15는 국면과 무관하게 같은 보유라 문자열 비교로 충분

/**
 * 자산곡선 시뮬레이션.
 * exec (V1): 'close0' 당일 종가 / 'close1' 다음 날 종가 / 'open1' 다음 날 시가
 *   진단용: 'peek' 판정일 수익까지 새 보유로 계산(미래 참조 — 구현 실수 재현용), 'close2' 이틀 뒤 종가
 * rebal (V10): 'signal' 신호 변경 때만 / 'daily' 매일 목표 비중 / 'monthly' 월초
 * costBps (V12): 편도 거래비용(bp, 매매 금액 기준)
 */
export function simulate(mkt, prod, sig, { startIdx, endIdx = mkt.dates.length - 1, exec = 'close1', rebal = 'signal', costBps = 5 } = {}) {
  const lag = { peek: -1, close0: 0, close1: 1, open1: 1, close2: 2 }[exec]
  if (lag === undefined) throw new Error(`exec 미지원: ${exec}`)
  const v = new Float64Array(endIdx - startIdx + 1)
  let w = [0, 0, 0, 1] // 시작 전 현금
  let held = 'CASH'
  const trades = [] // { i(체결일), from, to }
  let val = 1
  v[0] = 1
  const tc = costBps / 1e4
  const rebalanceTo = (tgt, i) => {
    const goal = TARGETS[tgt]
    const turn = goal.reduce((s, g, k) => s + Math.abs(g - w[k]), 0)
    val *= 1 - tc * turn
    w = goal.slice()
    if (tgt !== held) trades.push({ i, from: held, to: tgt })
    held = tgt
  }
  // i일에 체결되는 목표: close0은 i일 판정, close1·open1은 i-1일 판정
  const decided = (i) => (i - lag > endIdx ? held : sig.target[i - lag] ?? 'CASH')
  // 시작일 종가 시점에 이미 그 목표를 보유한 상태로 출발(진입 비용·매매 횟수 미산입)
  held = decided(startIdx)
  w = TARGETS[held].slice()
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const want = decided(i)
    const change = !sameHold(want, held)
    if (exec === 'open1' && change) {
      // 전일 종가→당일 시가는 기존 보유, 시가에 교체, 시가→종가는 새 보유
      let tot = 0
      const mid = w.map((wk, k) => { const x = wk * prod.night[k][i]; tot += x; return x })
      val *= tot
      w = mid.map((x) => x / tot)
      rebalanceTo(want, i)
      tot = 0
      const nw = w.map((wk, k) => { const x = wk * prod.full[k][i] / prod.night[k][i]; tot += x; return x })
      val *= tot
      w = nw.map((x) => x / tot)
    } else {
      let tot = 0
      const nw = w.map((wk, k) => { const x = wk * prod.full[k][i]; tot += x; return x })
      val *= tot
      w = nw.map((x) => (tot > 0 ? x / tot : 0))
      if (change) rebalanceTo(want, i) // 종가 체결(close0: 당일 판정, close1: 전일 판정)
      else if (rebal === 'daily' || (rebal === 'monthly' && mkt.dates[i].slice(5, 7) !== mkt.dates[i - 1].slice(5, 7))) {
        const goal = TARGETS[held]
        const turn = goal.reduce((s, g, k) => s + Math.abs(g - w[k]), 0)
        val *= 1 - tc * turn
        w = goal.slice()
      }
    }
    v[i - startIdx] = val
  }
  return { v, trades }
}

// ── 성과 지표 ─────────────────────────────────────────────────────────────

export function years(mkt, a, b) {
  return (Date.parse(mkt.dates[b]) - Date.parse(mkt.dates[a])) / DAY / 365.25
}

export function cagr(v, yrs) {
  return v[v.length - 1] > 0 ? (v[v.length - 1] / v[0]) ** (1 / yrs) - 1 : -1
}

export function maxDD(v) {
  let pk = v[0], m = 0
  for (const x of v) { if (x > pk) pk = x; const d = x / pk - 1; if (d < m) m = d }
  return m
}

/** 울서 지수: 전 기간 러닝 피크 대비 %낙폭의 RMS. step=1 일간, 'm'이면 월말 표본 */
export function ulcer(v, dates = null) {
  let pk = -Infinity, s = 0, c = 0
  for (let i = 0; i < v.length; i++) {
    if (v[i] > pk) pk = v[i]
    if (dates && i < v.length - 1 && dates[i].slice(0, 7) === dates[i + 1].slice(0, 7)) continue
    const d = (v[i] / pk - 1) * 100
    s += d * d; c++
  }
  return Math.sqrt(s / c)
}

/**
 * 소르티노 변형들 (영상에 정의 없음 — 비교 대상으로 정의를 고른다)
 *  d0: 일간, 목표 0, 산술평균×252 / (하방편차×√252)
 *  d0c: 분자를 CAGR로
 *  dx: 일간 초과수익(무위험 차감) 기준
 *  m0: 월간, 목표 0, 평균×12 / (하방편차×√12)
 *  neg: 하방편차를 음수 일만의 표준편차로(흔한 변형)
 */
export function sortinoVariants(v, rfDaily, dates, yrs) {
  const r = [], rx = []
  for (let i = 1; i < v.length; i++) { const x = v[i] / v[i - 1] - 1; r.push(x); rx.push(x - rfDaily[i]) }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
  const dd0 = (a) => Math.sqrt(a.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / a.length)
  const neg = r.filter((x) => x < 0)
  const negStd = Math.sqrt(neg.reduce((s, x) => s + (x - mean(neg)) ** 2, 0) / (neg.length - 1))
  const m = []
  let last = v[0]
  for (let i = 1; i < v.length; i++) {
    if (i === v.length - 1 || dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) { m.push(v[i] / last - 1); last = v[i] }
  }
  return {
    d0: (mean(r) * 252) / (dd0(r) * Math.sqrt(252)),
    d0c: cagr(v, yrs) / (dd0(r) * Math.sqrt(252)),
    dx: (mean(rx) * 252) / (dd0(rx) * Math.sqrt(252)),
    m0: (mean(m) * 12) / (dd0(m) * Math.sqrt(12)),
    neg: (mean(r) * 252) / (negStd * Math.sqrt(252)),
  }
}

/** 월말 마지막 거래일 인덱스 목록 (start~end) */
export function monthEnds(mkt, a, b) {
  const out = []
  for (let i = a; i <= b; i++) if (i === b || mkt.dates[i].slice(0, 7) !== mkt.dates[i + 1].slice(0, 7)) out.push(i)
  return out
}

/** 진입 인덱스 e에서 N년 뒤(달력) 이하 마지막 거래일 인덱스, 범위 밖이면 -1 */
export function exitAfter(mkt, e, nYears, endIdx) {
  const d = mkt.dates[e]
  const target = `${+d.slice(0, 4) + nYears}${d.slice(4)}`
  if (target > mkt.dates[endIdx]) return -1
  let lo = e, hi = endIdx
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (mkt.dates[mid] <= target) lo = mid; else hi = mid - 1 }
  return lo
}

export function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export const idxOf = (mkt, d) => mkt.dates.findIndex((x) => x >= d)
