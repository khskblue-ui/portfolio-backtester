/**
 * 역사 월간 합성 자산(-HIST) 검증 — 월간 해상도에서의 지표·데이터·엔진 동작
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeMetrics } from '../metrics'
import { loadDataBundle, resetHistAssetsCache } from '../data'
import { isBundleTicker } from '../catalog'
import { runBacktest } from '../engine'
import type { BacktestResult, DailyPoint, StrategyConfig } from '../types'
import { defaultTaxConfig } from '../tax'

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

afterEach(() => {
  vi.unstubAllGlobals()
  resetHistAssetsCache()
})

describe('지표 — 월간 해상도 적응', () => {
  it('변동성 연환산 계수가 관측 스텝/년을 따름 (월간 = √12, √252 아님)', () => {
    // 25개월(2년), 월 수익률 +10%/−10% 교대 — 표본 sd를 √12로 연환산해야 함
    const points: { date: string; value: number; flow?: number }[] = []
    let v = 100
    for (let i = 0; i < 25; i++) {
      const y = 2020 + Math.floor(i / 12)
      const m = (i % 12) + 1
      if (i > 0) v *= i % 2 === 1 ? 1.1 : 0.9
      points.push({ date: `${y}-${String(m).padStart(2, '0')}-01`, value: v, flow: i === 0 ? 100 : 0 })
    }
    const m = computeMetrics(makeResult(points))
    // 손계산: 24개 수익률(+0.1 / −0.1 교대) 표본 sd ≈ 0.10206, ×√12 ≈ 35.4%
    expect(m.volAnnualPct).toBeGreaterThan(30)
    expect(m.volAnnualPct).toBeLessThan(40)
    // √252였다면 ~162% — 회귀 방지
    expect(m.volAnnualPct).toBeLessThan(100)
  })

  it('수면하는 달력일 기준 — 월간 스텝 2개 = 약 60일', () => {
    const m = computeMetrics(
      makeResult([
        { date: '2020-01-01', value: 100, flow: 100 },
        { date: '2020-02-01', value: 90 },
        { date: '2020-03-01', value: 95 },
        { date: '2020-04-01', value: 120 },
      ])
    )
    // 전고점 2020-01-01 → 마지막 수면하 2020-03-01 = 60일 (스텝 수 2가 아님)
    expect(m.maxUnderwaterDays).toBe(60)
  })
})

describe('데이터 — 번들 자산 로드·혼합 차단', () => {
  it('isBundleTicker: -HIST 카탈로그 자산 판별', () => {
    expect(isBundleTicker('SPX-HIST')).toBe(true)
    expect(isBundleTicker('UST10-HIST')).toBe(true)
    expect(isBundleTicker('GOLD-HIST')).toBe(true)
    expect(isBundleTicker('VOO')).toBe(false)
  })

  it('역사 월간 + 일별 자산 혼합은 명시적 에러 (조용한 캘린더 붕괴 방지)', async () => {
    await expect(loadDataBundle(['SPX-HIST', 'VOO'])).rejects.toThrow(/함께 실행할 수 없습니다/)
  })

  it('번들 자산만이면 월간 캘린더로 정렬 + 정보성 안내 (해상도 경고 아님)', async () => {
    const months = ['1929-09-01', '1929-10-01', '1929-11-01', '1929-12-01', '1930-01-01', '1930-02-01']
    const mkAsset = (base: number) => ({ dates: months, close: months.map((_, i) => base * (1 - i * 0.05)) })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            meta: { note: 'test', dataEnd: '1930-02' },
            assets: { 'SPX-HIST': mkAsset(100), 'UST10-HIST': mkAsset(50), 'GOLD-HIST': mkAsset(30) },
          }),
      })
    )
    const bundle = await loadDataBundle(['SPX-HIST', 'UST10-HIST'])
    expect(bundle.dates).toEqual(months)
    expect(bundle.series['SPX-HIST'].close[0]).toBeCloseTo(100, 10)
    // 월간 모드 안내는 있고, "해상도 경고"(왜곡 경고)는 없어야 함
    expect(bundle.clipWarnings.some((w) => w.includes('역사 월간 모드'))).toBe(true)
    expect(bundle.clipWarnings.some((w) => w.includes('해상도 경고'))).toBe(false)
  })

  it('엔진 월간 실행: 매월 적립·정합성 유지', async () => {
    const months = Array.from({ length: 13 }, (_, i) => {
      const y = 1930 + Math.floor(i / 12)
      const m = (i % 12) + 1
      return `${y}-${String(m).padStart(2, '0')}-01`
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            meta: { note: 'test', dataEnd: '1931-01' },
            assets: { 'SPX-HIST': { dates: months, close: months.map((_, i) => 100 + i) }, 'UST10-HIST': { dates: months, close: months.map(() => 50) }, 'GOLD-HIST': { dates: months, close: months.map(() => 30) } },
          }),
      })
    )
    const bundle = await loadDataBundle(['SPX-HIST'])
    const config: StrategyConfig = {
      id: 't',
      name: '역사 월간',
      sleeves: [{ ticker: 'SPX-HIST', targetWeight: 1 }],
      contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'pro_rata' },
      rebalance: { trigger: 'none', mode: 'sell_to_target' },
      costs: { feeBps: 7, spreadBps: 3 },
      execution: { fractionalShares: true, cashAnnualYieldPct: 0, minTradeUsd: 100 },
      tax: { ...defaultTaxConfig(), enabled: false },
    }
    const result = runBacktest(config, bundle)
    // 매 스텝이 월초 → 첫 달 초기+적립, 이후 매월 적립
    expect(result.totalContributions).toBe(10_000 + 1_000 * 12)
    // 정합성 위반(reconciliation) 경고 없음
    expect(result.warnings.filter((w) => w.code === 'reconciliation')).toHaveLength(0)
    expect(result.finalValue).toBeGreaterThan(20_000)
  })
})
