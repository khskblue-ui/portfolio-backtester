/**
 * 실데이터 통합 검사 — 저장소 스냅숏(data-src/tripod)의 실제 QQQ·QLD·TQQQ·^NDX·^VIX·^IRX를
 * 앱 파이프라인(연결 상품 → 공통 달력 → 트라이팟 판정 → 엔진 → 지표)에 넣으면
 * 연구 문서 §10 A(실제 ETF, 2010-02-11~2026-10-20, 1억 원, 편도 5bp, 다음 날 종가)와 같은 값이 나온다.
 *
 * 남는 차이(허용 오차 안): 연구는 배당을 수정종가로 그날 재투자하고 현금 전환 비용을 두 번 세며,
 * 앱은 배당을 현금으로 받아 다음 체결에 다시 사고(현금 스윕) 실제 체결에만 비용을 매긴다
 */

import { describe, it, expect } from 'vitest'
import { alignToCommonCalendar, attachCashRate } from '@/core/data'
import { buildLeveragedSeries, spliceSeries } from '@/core/synthetic'
import { ASSET_CATALOG } from '@/core/catalog'
import { computeTripodSignals, alignVixToIndex, alignTripodTargets } from '@/core/tripod'
import { runBacktest } from '@/core/engine'
import { computeMetrics } from '@/core/metrics'
import { defaultTaxConfig } from '@/core/tax'
import type { DailySeries, StrategyConfig } from '@/core/types'
import { readBars, readDivs } from '../scripts/tripod/lib.mjs'

const toSeries = (name: string, ticker: string): DailySeries => {
  const bars = readBars(name) as { d: string; o: number; c: number; a: number }[]
  const divs = readDivs(name) as { d: string; amt: number }[]
  return {
    ticker,
    dates: bars.map((b) => b.d),
    open: bars.map((b) => b.o),
    close: bars.map((b) => b.c),
    adjClose: bars.map((b) => (Number.isNaN(b.a) ? b.c : b.a)),
    dividends: Object.fromEntries(divs.map((x) => [x.d, x.amt])),
  }
}

const qqq = toSeries('QQQ', 'QQQ')
const qld = toSeries('QLD', 'QLD')
const tqqq = toSeries('TQQQ', 'TQQQ')
const irx = toSeries('IRX', '^IRX')
const ndx = toSeries('NDX', '^NDX')
const vix = toSeries('VIX', '^VIX')
const spec = (t: string) => ASSET_CATALOG.find((e) => e.ticker === t)!.synthetic!
const qldExt = spliceSeries('QLD-EXT', qld, buildLeveragedSeries('QLD-SIM', qqq, irx, spec('QLD-SIM')))
const tqqqExt = spliceSeries('TQQQ-EXT', tqqq, buildLeveragedSeries('TQQQ-SIM', qqq, irx, spec('TQQQ-SIM')))

const bundle = alignToCommonCalendar([qqq, qldExt, tqqqExt, qld, tqqq], { startDate: '2010-02-11', endDate: '2026-10-20' })
const sig = computeTripodSignals(ndx.dates, ndx.close, alignVixToIndex(ndx.dates, vix.dates, vix.close))
bundle.tripod = { target: alignTripodTargets(sig, bundle.dates), lastSignalDate: ndx.dates[ndx.dates.length - 1] }
attachCashRate(bundle, irx)

const run = (ticker: string, tax: boolean) => {
  const st: StrategyConfig = {
    id: ticker,
    name: ticker,
    sleeves: [{ ticker, targetWeight: 1 }],
    contribution: { initialUsd: 100_000_000 / 1400, monthlyUsd: 0, allocation: 'to_underweight' },
    rebalance: { trigger: 'none', mode: 'sell_to_target' },
    costs: { feeBps: 5, spreadBps: 0 },
    execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100, cashYieldSource: 'tbill' },
    tax: { ...defaultTaxConfig(), enabled: tax },
  }
  const res = runBacktest(st, bundle)
  return { res, m: computeMetrics(res) }
}

describe('실데이터: 앱 파이프라인 = 연구 §10 A (실제 ETF 2010-02-11~2026-10-20)', () => {
  it('기간·달력: TQQQ 상장일부터, 연결 상품은 이 구간에서 실물 그대로', () => {
    expect(bundle.dates[0]).toBe('2010-02-11')
    expect(bundle.dates[bundle.dates.length - 1]).toBe('2026-10-20')
    expect(bundle.series['TQQQ-EXT'].close).toEqual(bundle.series['TQQQ'].close)
    expect(bundle.series['QLD-EXT'].close).toEqual(bundle.series['QLD'].close)
  })

  const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

  it('트라이팟 세전 30.5% / −61.3%, 청산 기준 세후 25.1% (연구 표와 같은 값)', () => {
    const pre = run('TRIPOD', false)
    const post = run('TRIPOD', true)
    near(pre.m.twrrAnnualPct, 30.5, 0.3)
    near(pre.m.maxDrawdownPct, -61.3, 0.5)
    near(post.m.liquidatedMwrrAnnualPct, 25.1, 0.3)
    expect(pre.res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
    expect(post.res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
  })

  it('보유 비교: QQQ 세전 19.3% · 청산 기준 세후 17.5%, QLD 32.5%, TQQQ 41.9%', () => {
    near(run('QQQ', false).m.twrrAnnualPct, 19.3, 0.2)
    const q = run('QQQ', true)
    near(q.m.liquidatedMwrrAnnualPct, 17.5, 0.2)
    // 청산하지 않은 세후(원천징수만)는 이연된 양도세가 빠져 더 높게 보인다 — 청산 기준이 필요한 이유
    expect(q.m.mwrrAnnualPct - q.m.liquidatedMwrrAnnualPct).toBeGreaterThan(1)
    near(run('QLD', false).m.twrrAnnualPct, 32.5, 0.3)
    near(run('TQQQ', false).m.twrrAnnualPct, 41.9, 0.3)
  })
})
