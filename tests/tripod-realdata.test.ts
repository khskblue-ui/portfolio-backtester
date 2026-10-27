/**
 * 실데이터 통합 검사 — 저장소 스냅숏(data-src/tripod)을 야후 v8 응답 형식으로 돌려주는 fetch 스텁을 깔고
 * 앱의 loadDataBundle(연결 상품 → 공통 달력 → 트라이팟 판정 → 단기국채 금리) → 엔진 → 지표를 그대로 돌린다.
 *
 * 1) 2010-02-11~2026-10-20(실제 ETF만 쓰는 구간): 연구 문서 §10.1 표와 같은 값
 * 2) 1991~2026(상장 전은 나스닥100 지수 총수익 합성 연결): 연구 §2.3 기본 조합(32.6% / -61.4%)·§8.2 세후(27.0%)와 비교
 *
 * 남는 차이(허용 오차 안): 연구는 배당을 수정종가로 그날 재투자하고 현금 전환 비용을 두 번 세며 현금 이자를 15.4% 원천징수한다.
 * 앱은 배당을 현금으로 받아 다음 체결에 다시 사고(현금 스윕) 실제 체결에만 비용을 매기며, 이자도 15.4% 원천징수한다
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadDataBundle } from '@/core/data'
import { runBacktest } from '@/core/engine'
import { computeMetrics } from '@/core/metrics'
import { defaultTaxConfig } from '@/core/tax'
import type { AlignedDataBundle, StrategyConfig } from '@/core/types'

const SNAP = path.resolve(__dirname, '../data-src/tripod')
const FILE: Record<string, string> = { QQQ: 'QQQ', QLD: 'QLD', TQQQ: 'TQQQ', '^NDX': 'NDX', '^VIX': 'VIX', '^IRX': 'IRX' }

/** 스냅숏 CSV → 야후 v8 chart 응답 (scripts/e2e/staticserver.mjs FIXTURES 모드와 같은 변환) */
function yahooFixture(symbol: string): unknown {
  const name = FILE[symbol]
  if (!name) return null
  const rows = fs.readFileSync(path.join(SNAP, `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
  const ts = (d: string) => Date.parse(`${d}T14:30:00Z`) / 1000
  const dividends: Record<string, { amount: number; date: number }> = {}
  const divFile = path.join(SNAP, `${name}-div.csv`)
  if (fs.existsSync(divFile)) {
    for (const l of fs.readFileSync(divFile, 'utf8').trim().split('\n').slice(1)) {
      const [d, amt] = l.split(',')
      dividends[String(ts(d))] = { amount: Number(amt), date: ts(d) }
    }
  }
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: -18000, dataGranularity: '1d' },
          timestamp: rows.map((r) => ts(r[0])),
          events: { dividends },
          indicators: {
            quote: [{ open: rows.map((r) => Number(r[1])), close: rows.map((r) => Number(r[4])) }],
            adjclose: [{ adjclose: rows.map((r) => (r[5] === '' ? Number(r[4]) : Number(r[5]))) }],
          },
        },
      ],
    },
  }
}

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const sym = decodeURIComponent(String(url).split('/chart/')[1]?.split('?')[0] ?? '')
      const body = yahooFixture(sym)
      return Promise.resolve(body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{}', { status: 404 }))
    })
  )
})
afterAll(() => vi.unstubAllGlobals())

// 스냅숏 수집 시각 이후로 고정 — 장중 봉 제외 규칙이 결과를 바꾸지 않게
const NOW = new Date('2026-10-21T12:00:00Z')

function run(bundle: AlignedDataBundle, ticker: string, tax: boolean) {
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

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('실데이터: 앱 파이프라인 = 연구 §10.1 (실제 ETF 2010-02-11~2026-10-20)', () => {
  let b: AlignedDataBundle
  beforeAll(async () => {
    b = await loadDataBundle(['TRIPOD', 'QQQ', 'QLD', 'TQQQ'], { startDate: '2010-02-11', endDate: '2026-10-20', cashRate: true, now: NOW })
  }, 60000)

  it('기간·달력: TQQQ 상장일부터, 연결 상품은 이 구간에서 실물 그대로', () => {
    expect(b.dates[0]).toBe('2010-02-11')
    expect(b.dates[b.dates.length - 1]).toBe('2026-10-20')
    expect(b.series['TQQQ-EXT'].close).toEqual(b.series['TQQQ'].close)
    expect(b.series['QLD-EXT'].close).toEqual(b.series['QLD'].close)
    expect(b.series['QQQ-EXT'].close).toEqual(b.series['QQQ'].close)
    expect(b.series['QQQ-EXT'].divPerShare).toEqual(b.series['QQQ'].divPerShare)
  })

  it('트라이팟 세전 30.5% / −61.3%, 청산 기준 세후 25.1% (연구 표와 같은 값)', () => {
    const pre = run(b, 'TRIPOD', false)
    const post = run(b, 'TRIPOD', true)
    near(pre.m.twrrAnnualPct, 30.5, 0.3)
    near(pre.m.maxDrawdownPct, -61.3, 0.5)
    near(post.m.liquidatedMwrrAnnualPct, 25.1, 0.3)
    expect(pre.res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
    expect(post.res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
  })

  it('보유 비교: QQQ 세전 19.3% · 청산 기준 세후 17.5%, QLD 32.5%, TQQQ 41.9%', () => {
    near(run(b, 'QQQ', false).m.twrrAnnualPct, 19.3, 0.2)
    const q = run(b, 'QQQ', true)
    near(q.m.liquidatedMwrrAnnualPct, 17.5, 0.2)
    // 청산하지 않은 세후(원천징수만)는 이연된 양도세가 빠져 더 높게 보인다 — 청산 기준이 필요한 이유
    expect(q.m.mwrrAnnualPct - q.m.liquidatedMwrrAnnualPct).toBeGreaterThan(1)
    near(run(b, 'QLD', false).m.twrrAnnualPct, 32.5, 0.3)
    near(run(b, 'TQQQ', false).m.twrrAnnualPct, 41.9, 0.3)
  })
})

describe('실데이터: 1991~2026 (상장 전은 나스닥100 지수 합성 연결)', () => {
  let b: AlignedDataBundle
  beforeAll(async () => {
    b = await loadDataBundle(['TRIPOD', 'QQQ-EXT'], { startDate: '1991-01-02', endDate: '2026-08-28', cashRate: true, now: NOW })
  }, 60000)

  it('QQQ-EXT는 상장(1999-03-10) 전은 지수 합성, 그 뒤는 실물 QQQ 가격·배당', () => {
    expect(b.dates[0]).toBe('1991-01-02')
    const i = b.dates.indexOf('1999-03-10')
    expect(i).toBeGreaterThan(0)
    expect(b.series['QQQ-EXT'].divPerShare.slice(0, i).every((x) => x === 0)).toBe(true)
    expect(b.series['QQQ-EXT'].close[i]).toBeCloseTo(51.0625, 6) // 실물 QQQ 첫 종가
  })

  it('트라이팟 세전 32.6% / −61.4%(연구 §2.3 기본 조합), 청산 기준 세후 27.0%(연구 §8.2)와 같다', () => {
    const pre = run(b, 'TRIPOD', false)
    // 남는 차이는 합성 비용 가정(앱 스프레드 0.6%·TQQQ 보수 0.86%, 연구 0.75%·0.95%)과 현금 이자 환산 차이
    near(pre.m.twrrAnnualPct, 32.6, 0.4)
    near(pre.m.maxDrawdownPct, -61.4, 0.5)
    expect(pre.res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
    // 전환 횟수는 연구와 같은 판정이므로 연 8회 안팎(연구 7.94회/년)
    near((pre.res.tripod!.switches.length - 1) / 35.65, 7.94, 0.3)
    const post = run(b, 'TRIPOD', true)
    near(post.m.liquidatedMwrrAnnualPct, 27.0, 0.5)
  })

  it('보유 비교: QQQ-EXT 15.5%, 상장 전 연결 상품은 연구 가상 상품과 연 0.3%p 안에서 같다', () => {
    near(run(b, 'QQQ-EXT', false).m.twrrAnnualPct, 15.5, 0.2)
  })

  it('2000년 이전을 다음 거래일 시가로 체결하면 지수 시가를 물려받은 연결 상품마다 알린다(TQQQ-EXT만 들어도)', () => {
    // 일반 자산의 기본 체결은 다음 거래일 시가, 트라이팟 슬리브가 있으면 다음 거래일 종가
    for (const t of ['TQQQ-EXT', 'QLD-EXT', 'QQQ-EXT']) {
      expect(run(b, t, false).res.warnings.find((w) => w.code === 'data_caveat')?.message).toContain(t)
    }
    expect(run(b, 'TRIPOD', false).res.warnings.some((w) => w.code === 'data_caveat')).toBe(false)
  })
})
