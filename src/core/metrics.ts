/**
 * 백테스트 지표 (PRD §6)
 *
 * - ⚠ 적립식은 CAGR만으론 오답(6.1): MWRR(현금흐름 반영)과 TWRR(전략 자체) 둘 다.
 * - ⚠ 낙폭은 포트 가치가 아니라 growth-of-$1(TWRR) 시계열에서(6.2) —
 *   적립이 가치를 부풀려 진짜 전략 낙폭을 가리기 때문.
 *
 * TWRR 규약: 외부 현금흐름은 당일 종가 직전 유입으로 간주 —
 * r_t = (V_t − F_t) / V_{t−1} − 1 (엔진의 4단계 유입 순서와 일치)
 */

import type { BacktestResult, Metrics } from './types'

export function computeMetrics(result: BacktestResult): Metrics {
  const { daily } = result
  const n = daily.length

  // ── growth-of-$1 (TWRR) ──
  const growthOf1: { date: string; value: number }[] = []
  const dailyReturns: number[] = []
  let g = 1
  growthOf1.push({ date: daily[0].date, value: 1 })
  for (let t = 1; t < n; t++) {
    const prev = daily[t - 1].value
    if (prev > 0) {
      // r ≥ −1 클램프: 극단 엣지(연말 세금 차감으로 가치가 음수)에서 r<−1이
      // 곱해지면 growth가 음수·MDD<−100%가 되는 불변식 위반 방지 — 전액 손실로 처리
      const r = Math.max(-1, (daily[t].value - daily[t].externalFlow) / prev - 1)
      dailyReturns.push(r)
      g *= 1 + r
    } else {
      dailyReturns.push(0)
    }
    growthOf1.push({ date: daily[t].date, value: g })
  }

  // TWRR 연환산 — 실제 경과 연수 기준
  const years = (Date.parse(daily[n - 1].date) - Date.parse(daily[0].date)) / (365.25 * 86_400_000)
  // g <= 0(전액 손실)이면 0%가 아니라 -100%/년 — MDD -100%와 모순되게 '무손실'로 읽히는 것 방지
  const twrrAnnualPct = years > 0 ? (g > 0 ? (Math.pow(g, 1 / years) - 1) * 100 : -100) : 0

  // ── MDD & 최장 회복기간 (growth-of-$1 기준 — 6.2) ──
  // 회복기간은 달력일 기준: 전고점 날짜 → 그 아래에 머문 마지막 날짜의 실제 경과일.
  // 스텝 수 카운트는 데이터 해상도(일별 252스텝/년 vs 역사 월간 12스텝/년)에 따라
  // 의미가 달라지므로 날짜 차이로 측정해 해상도 불변으로 만든다.
  let peak = growthOf1[0].value
  let peakDate = growthOf1[0].date
  let maxDrawdownPct = 0
  let maxUnderwaterDays = 0
  for (const p of growthOf1) {
    if (p.value >= peak) {
      peak = p.value
      peakDate = p.date
    } else {
      const uw = Math.round((Date.parse(p.date) - Date.parse(peakDate)) / 86_400_000)
      if (uw > maxUnderwaterDays) maxUnderwaterDays = uw
      const dd = (p.value / peak - 1) * 100
      if (dd < maxDrawdownPct) maxDrawdownPct = dd
    }
  }

  // ── 변동성 (스텝 수익률 → 연환산) ──
  // 연환산 계수 = 실제 관측된 스텝/년 (일별 ≈ 252, 역사 월간 = 12) — 해상도에 자동 적응
  const stepsPerYear = years > 0 ? Math.min(366, Math.max(1, (n - 1) / years)) : 252
  const mean = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0
  const variance =
    dailyReturns.length > 1
      ? dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1)
      : 0
  const volAnnualPct = Math.sqrt(variance) * Math.sqrt(stepsPerYear) * 100

  // ── 연도별 TWRR (서브기간 견고성 — 6.4) ──
  const annualReturns: { year: number; returnPct: number }[] = []
  let yearProd = 1
  let curYear = Number(daily[0].date.slice(0, 4))
  for (let t = 1; t < n; t++) {
    const y = Number(daily[t].date.slice(0, 4))
    if (y !== curYear) {
      annualReturns.push({ year: curYear, returnPct: (yearProd - 1) * 100 })
      curYear = y
      yearProd = 1
    }
    yearProd *= 1 + dailyReturns[t - 1]
  }
  annualReturns.push({ year: curYear, returnPct: (yearProd - 1) * 100 })

  // ── MWRR (XIRR — 6.1) ──
  const flows: { date: string; amount: number }[] = []
  for (const d of daily) {
    if (d.externalFlow > 0) flows.push({ date: d.date, amount: -d.externalFlow })
  }
  flows.push({ date: daily[n - 1].date, amount: daily[n - 1].value })
  const mwrrAnnualPct = xirr(flows) * 100

  return {
    twrrAnnualPct,
    mwrrAnnualPct,
    growthOf1,
    maxDrawdownPct,
    maxUnderwaterDays,
    volAnnualPct,
    annualReturns,
    finalValue: result.finalValue,
    totalContributions: result.totalContributions,
  }
}

/**
 * XIRR — 이분법 (결정론, Newton 발산 리스크 회피)
 * @returns 연환산 수익률 (해 없으면 NaN)
 */
export function xirr(flows: { date: string; amount: number }[]): number {
  if (flows.length < 2) return NaN
  const t0 = Date.parse(flows[0].date)
  const yearsFrom = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86_400_000))

  const npv = (rate: number) =>
    flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, yearsFrom[i]), 0)

  let lo = -0.9999
  let hi = 1e6 // 단기간 백테스트의 연환산(예: 1개월 +50% ≈ 연 117배)도 브래킷 안에 들어오도록
  let fLo = npv(lo)
  const fHi = npv(hi)
  if (fLo * fHi > 0) return NaN
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2
    const fMid = npv(mid)
    if (Math.abs(fMid) < 1e-10 || hi - lo < 1e-10) return mid
    if (fLo * fMid < 0) {
      hi = mid
    } else {
      lo = mid
      fLo = fMid
    }
  }
  return (lo + hi) / 2
}
