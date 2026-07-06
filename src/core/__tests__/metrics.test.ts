/**
 * 지표 검증 (§6) — TWRR/MWRR/MDD 손계산 대조
 */

import { describe, it, expect } from 'vitest'
import { computeMetrics, xirr } from '../metrics'
import type { BacktestResult, DailyPoint } from '../types'

function makeResult(points: { date: string; value: number; flow?: number }[]): BacktestResult {
  const daily: DailyPoint[] = points.map((p) => ({
    date: p.date,
    value: p.value,
    externalFlow: p.flow ?? 0,
    cumContributions: 0,
    sleeveValues: {},
    cash: 0,
  }))
  return {
    strategyId: 'test',
    daily,
    trades: [],
    taxes: [],
    dividendsGrossUsd: 0,
    dividendsWithheldUsd: 0,
    totalFeesUsd: 0,
    totalTaxesUsd: 0,
    warnings: [],
    finalValue: daily[daily.length - 1].value,
    totalContributions: 0,
  }
}

describe('XIRR (6.1)', () => {
  it('1000 → 1년 뒤 1100 = 정확히 10%', () => {
    const r = xirr([
      { date: '2019-01-01', amount: -1000 },
      { date: '2020-01-01', amount: 1100 }, // 365일
    ])
    expect(r).toBeCloseTo(0.1, 8)
  })

  it('적립 2회: 손계산 해 대조', () => {
    // -1000(t=0), -1000(t=0.5년=182.5일 근사 183일), +2200(t=1년)
    // NPV(r)=0: 2200 = 1000(1+r) + 1000(1+r)^(182/365)
    const r = xirr([
      { date: '2019-01-01', amount: -1000 },
      { date: '2019-07-02', amount: -1000 },
      { date: '2020-01-01', amount: 2200 },
    ])
    const t2 = (Date.parse('2020-01-01') - Date.parse('2019-07-02')) / (365 * 86_400_000)
    const npv = -1000 * (1 + r) ** 1 - 1000 * (1 + r) ** t2 + 2200
    expect(npv).toBeCloseTo(0, 6)
    expect(r).toBeGreaterThan(0.12) // 대략 13%대
  })

  it('부호 변화 없으면 NaN', () => {
    expect(
      xirr([
        { date: '2019-01-01', amount: 1000 },
        { date: '2020-01-01', amount: 1100 },
      ])
    ).toBeNaN()
  })
})

describe('TWRR — 납입 타이밍 무관 (6.1/6.3)', () => {
  it('외부 유입은 수익률에서 제외', () => {
    // day0: 100 납입, day1: 시장 +10% → 110, day2: 100 납입(유입) + 시장 0% → 210
    const m = computeMetrics(
      makeResult([
        { date: '2023-01-02', value: 100, flow: 100 },
        { date: '2023-01-03', value: 110 },
        { date: '2023-01-04', value: 210, flow: 100 },
      ])
    )
    // growth: 1 → 1.1 → 1.1 (유입 100 제외 시 day2 수익률 0)
    expect(m.growthOf1[1].value).toBeCloseTo(1.1, 10)
    expect(m.growthOf1[2].value).toBeCloseTo(1.1, 10)
  })

  it('MWRR은 납입 타이밍을 반영해 TWRR과 달라짐', () => {
    // 상승 직전 큰 납입 → MWRR > TWRR
    const m = computeMetrics(
      makeResult([
        { date: '2022-01-03', value: 100, flow: 100 },
        { date: '2022-07-01', value: 100 },      // 상반기 0%
        { date: '2022-07-05', value: 1100, flow: 1000 }, // 큰 납입
        { date: '2023-01-02', value: 1650 },     // 하반기 +50%
      ])
    )
    expect(m.mwrrAnnualPct).toBeGreaterThan(m.twrrAnnualPct)
  })
})

describe('MDD — growth-of-$1 기준 (6.2 적립 왜곡 차단)', () => {
  it('적립으로 가치가 늘어도 전략 낙폭은 그대로 잡아냄', () => {
    // 시장 −50% 하락하는데 대규모 납입으로 포트 "가치"는 상승하는 케이스
    const m = computeMetrics(
      makeResult([
        { date: '2023-01-02', value: 100, flow: 100 },
        { date: '2023-01-03', value: 1050, flow: 1000 }, // 시장 −50% (100→50) + 납입 1000
        { date: '2023-01-04', value: 1050 },
      ])
    )
    // 가치 기준으론 낙폭 0처럼 보이지만 TWRR 기준 MDD = −50%
    expect(m.maxDrawdownPct).toBeCloseTo(-50, 6)
  })

  it('수면하 기간 카운트', () => {
    const m = computeMetrics(
      makeResult([
        { date: '2023-01-02', value: 100, flow: 100 },
        { date: '2023-01-03', value: 90 },
        { date: '2023-01-04', value: 95 },
        { date: '2023-01-05', value: 120 },
      ])
    )
    expect(m.maxUnderwaterDays).toBe(2)
    expect(m.maxDrawdownPct).toBeCloseTo(-10, 6)
  })
})

describe('연도별 수익률 (6.4 서브기간)', () => {
  it('연 경계에서 분리 집계', () => {
    const m = computeMetrics(
      makeResult([
        { date: '2022-12-29', value: 100, flow: 100 },
        { date: '2022-12-30', value: 110 },
        { date: '2023-01-02', value: 121 },
        { date: '2023-01-03', value: 133.1 },
      ])
    )
    expect(m.annualReturns).toHaveLength(2)
    expect(m.annualReturns[0]).toEqual({ year: 2022, returnPct: expect.closeTo(10, 6) })
    expect(m.annualReturns[1].year).toBe(2023)
    expect(m.annualReturns[1].returnPct).toBeCloseTo(21, 6)
  })
})
