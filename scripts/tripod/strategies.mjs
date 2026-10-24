// 실전 추적(live.mjs)과 대안 평가(alternatives.mjs)가 함께 쓰는 전략 정의
// 명세: docs/research/tripod/candidates-spec.md (2026-10-24 사전 등록, 결과를 보기 전에 고정)
// 각 전략은 시장 m(loadMarket 형태)을 받아 날짜별 목표 노출 L을 돌려준다.
// L[i]는 i일 종가로 정한 값이고 다음 거래일 종가에 체결한다(planOf). 지표가 준비되기 전에는 null.
import { computeSignals, RULE_DEFAULT, sma } from './lib.mjs'

/** 노출 L(0~3배) → [QQQ, QLD, TQQQ, 현금] 비중. 트라이팟의 1.5배(QQQ 50% + QLD 50%)와 같은 조합 방식 */
export const weightsOf = (L) => (L <= 1 ? [L, 0, 0, 1 - L] : L <= 2 ? [2 - L, L - 1, 0, 0] : [0, 3 - L, L - 2, 0])

export const TREND_WINDOWS = [100, 150, 200, 250, 300]
const VOL_DAYS = 20, BASE_DAYS = 1260, BASE_MIN = 252

/** 트라이팟 목표 노출: TQQQ 100% → top(3, 2배판은 2), 1.5배 → 1.5, 현금 → 0 */
export function tripodExposure(m, top = 3) {
  const sig = computeSignals(m, RULE_DEFAULT)
  return { L: sig.target.map((t) => (t === null ? null : t === 'T3' ? top : t === 'B15' ? 1.5 : 0)), sig }
}

/** 추세 앙상블 점수 s: 이동평균(TREND_WINDOWS) 가운데 종가가 위에 있는 비율 */
export function trendScore(m) {
  const mas = TREND_WINDOWS.map((w) => sma(m.close, w))
  return m.close.map((c, i) => (mas.some((ma) => Number.isNaN(ma[i])) ? null : mas.filter((ma) => c > ma[i]).length / mas.length))
}

/** 직전 20거래일 실현변동성(연율, 로그수익 표본표준편차) */
export function realizedVol(m) {
  const n = m.close.length
  const vol = new Array(n).fill(null)
  for (let i = VOL_DAYS; i < n; i++) {
    let s = 0, q = 0
    for (let j = i - VOL_DAYS + 1; j <= i; j++) { const r = Math.log(m.close[j] / m.close[j - 1]); s += r; q += r * r }
    const mu = s / VOL_DAYS
    vol[i] = Math.sqrt(Math.max(0, (q - VOL_DAYS * mu * mu) / (VOL_DAYS - 1)) * 252)
  }
  return vol
}

/**
 * 상대 변동성 상한 = lmax × 기준변동성 ÷ 현재변동성. 월말 종가에만 갱신하고 다음 월말까지 유지.
 * 기준변동성은 직전 1,260거래일(최소 252일) 20일 실현변동성의 중앙값.
 * 마지막 날이 월말인지는 다음 날 데이터가 없어 알 수 없으므로 m.lastIsMonthEnd(실전 추적이 거래소 달력으로 채움)를 쓴다.
 */
export function relVolCap(m, lmax) {
  const n = m.close.length
  const vol = realizedVol(m)
  const cap = new Array(n).fill(null)
  let cur = null
  for (let i = 0; i < n; i++) {
    const monthEnd = i < n - 1 ? m.dates[i].slice(0, 7) !== m.dates[i + 1].slice(0, 7) : !!m.lastIsMonthEnd
    if (monthEnd && vol[i] !== null) {
      const hist = []
      for (let j = Math.max(0, i - BASE_DAYS + 1); j <= i; j++) if (vol[j] !== null) hist.push(vol[j])
      if (hist.length >= BASE_MIN) {
        hist.sort((a, b) => a - b)
        const h = hist.length
        const med = h % 2 ? hist[(h - 1) / 2] : (hist[h / 2 - 1] + hist[h / 2]) / 2
        cur = lmax * med / vol[i]
      }
    }
    cap[i] = cur
  }
  return cap
}

/** 추세 앙상블 + 상대 변동성: min(lmax × s, 상한)을 0.5배 단위로 내림 */
export function tevExposure(m, lmax) {
  const s = trendScore(m), cap = relVolCap(m, lmax)
  return s.map((x, i) => (x === null || cap[i] === null ? null : Math.max(0, Math.floor(Math.min(lmax * x, cap[i], lmax) * 2) / 2)))
}

export const STRATEGIES = [
  { id: 'tripod', name: '트라이팟', desc: '영상 규칙(250일선 국면 · VIX10 · 52주 낙폭), 최대 3배', exposure: (m) => tripodExposure(m, 3).L, usesVix: true },
  { id: 't2', name: '트라이팟 2배판', desc: '트라이팟 규칙, TQQQ 자리에 QLD', exposure: (m) => tripodExposure(m, 2).L, usesVix: true },
  { id: 'te3', name: '추세 앙상블 3배', desc: '100~300일선 5개 중 위에 있는 비율 × 3배', exposure: (m) => trendScore(m).map((s) => (s === null ? null : 3 * s)) },
  { id: 'tev3', name: '추세 앙상블 + 상대 변동성 3배', desc: 'min(3 × 추세 비율, 3 × 5년 중앙 변동성 ÷ 20일 변동성), 0.5배 단위', exposure: (m) => tevExposure(m, 3) },
  { id: 'tev2', name: '추세 앙상블 + 상대 변동성 2배', desc: '같은 규칙, 최대 2배', exposure: (m) => tevExposure(m, 2) },
]

/** 목표 노출 배열 → simTax 계획(다음 거래일 종가 체결, 준비 전에는 현금) */
export const planOf = (L) => (i) => { const x = L[i - 1] ?? 0; return { key: String(x), w: weightsOf(x) } }
