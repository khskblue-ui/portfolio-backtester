/**
 * 통합: Yahoo v8 응답 형태 → 파싱 → 캘린더 정렬 → 엔진 → 지표 전 파이프라인
 * (실데이터 fetch는 브라우저에서 수행 — 여기선 응답 스키마 계약을 고정)
 */

import { describe, it, expect } from 'vitest'
import { parseYahooChart, alignToCommonCalendar } from '../data'
import { runBacktest } from '../engine'
import { computeMetrics } from '../metrics'
import { cleanStrategy, makeDates, lcg, randomWalk } from './helpers'

/** Yahoo v8 chart 응답 모사 — 주식: 평일 09:30 ET 타임스탬프 + gmtoffset −5h */
function yahooEquityPayload(dates: string[], close: number[], divs: Record<string, number>) {
  const gmtoffset = -18_000
  const timestamps = dates.map((d) => Date.parse(d + 'T14:30:00Z') / 1000)
  const dividends: Record<string, { amount: number; date: number }> = {}
  for (const [d, amount] of Object.entries(divs)) {
    const ts = Date.parse(d + 'T14:30:00Z') / 1000
    dividends[String(ts)] = { amount, date: ts }
  }
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset },
          timestamp: timestamps,
          events: { dividends },
          indicators: {
            quote: [{ open: close.map((c, i) => (i > 0 ? close[i - 1] : c)), close: [...close] }],
            adjclose: [{ adjclose: [...close] }],
          },
        },
      ],
    },
  }
}

/** 크립토: 매일 00:00 UTC (주말 포함), gmtoffset 0 */
function yahooCryptoPayload(dates: string[], close: number[]) {
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: 0 },
          timestamp: dates.map((d) => Date.parse(d + 'T00:00:00Z') / 1000),
          indicators: {
            quote: [{ open: close.map((c, i) => (i > 0 ? close[i - 1] : c)), close: [...close] }],
            adjclose: [{ adjclose: [...close] }],
          },
        },
      ],
    },
  }
}

function allDays(start: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(start + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('통합 파이프라인 (Yahoo 스키마 계약)', () => {
  const nEq = 520 // ~2년 거래일
  const eqDates = makeDates('2022-01-03', nEq)
  const rand = lcg(7)
  const vooClose = randomWalk(350, nEq, rand)
  // 분기 배당 근사 — 60거래일마다 $1.5
  const divs: Record<string, number> = {}
  for (let i = 59; i < nEq; i += 60) divs[eqDates[i]] = 1.5

  const cryptoDays = allDays('2022-01-01', 740)
  const btcClose = randomWalk(45_000, 740, rand)

  const voo = parseYahooChart(yahooEquityPayload(eqDates, vooClose, divs), 'VOO')
  const btc = parseYahooChart(yahooCryptoPayload(cryptoDays, btcClose), 'BTC-USD')

  it('파싱: 거래소 로컬 날짜 변환 + 배당 이벤트 매핑', () => {
    expect(voo.dates).toEqual(eqDates) // ET 오프셋 적용해 원래 날짜 복원
    expect(Object.keys(voo.dividends)).toHaveLength(Object.keys(divs).length)
    expect(voo.dividends[eqDates[59]]).toBeCloseTo(1.5, 10)
  })

  it('파싱: 결측 행(null close) 제거', () => {
    const payload = yahooEquityPayload(eqDates.slice(0, 5), [100, 101, 102, 103, 104], {})
    ;(payload.chart.result[0].indicators.quote[0].close as (number | null)[])[2] = null
    const parsed = parseYahooChart(payload, 'X')
    expect(parsed.dates).toHaveLength(4)
  })

  it('정렬: 크립토(365일)는 주식 캘린더로 서브샘플', () => {
    const bundle = alignToCommonCalendar([voo, btc])
    expect(bundle.dates.every((d) => eqDates.includes(d))).toBe(true)
    expect(bundle.series['BTC-USD'].close).toHaveLength(bundle.dates.length)
  })

  it('엔진+지표: 전 파이프라인 무결 (비용·세금 포함)', () => {
    const bundle = alignToCommonCalendar([voo, btc])
    const strategy = cleanStrategy({
      sleeves: [
        { ticker: 'VOO', targetWeight: 0.7 },
        { ticker: 'BTC-USD', targetWeight: 0.2 },
        { ticker: 'CASH', targetWeight: 0.1 },
      ],
      contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
      rebalance: { trigger: 'band_or_periodic', periodMonths: 6, bandAbsPct: 5, mode: 'sell_to_target' },
      costs: { feeBps: 7, spreadBps: 3 },
      execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
    })
    strategy.tax.enabled = true
    const result = runBacktest(strategy, bundle)
    const metrics = computeMetrics(result)

    expect(result.warnings.filter((w) => w.code === 'reconciliation')).toHaveLength(0)
    expect(result.dividendsGrossUsd).toBeGreaterThan(0)
    expect(result.totalFeesUsd).toBeGreaterThan(0)
    expect(Number.isFinite(metrics.twrrAnnualPct)).toBe(true)
    expect(Number.isFinite(metrics.mwrrAnnualPct)).toBe(true)
    expect(metrics.maxDrawdownPct).toBeLessThanOrEqual(0)
    expect(metrics.growthOf1).toHaveLength(result.daily.length)
    // 납입 = 초기 + 월 적립 (외부 흐름 원장 일치)
    const flowSum = result.daily.reduce((s, d) => s + d.externalFlow, 0)
    expect(flowSum).toBeCloseTo(result.totalContributions, 6)
  })
})
