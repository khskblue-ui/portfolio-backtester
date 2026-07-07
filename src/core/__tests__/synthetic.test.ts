/**
 * 합성 레버리지 검증 — 손계산 대조 (일간 리셋 × L − 차입비용 − 보수)
 */

import { describe, it, expect, vi } from 'vitest'
import { buildLeveragedSeries } from '../synthetic'
import { loadDataBundle } from '../data'
import type { DailySeries } from '../types'

const mk = (ticker: string, dates: string[], close: number[], adjClose?: number[], open?: number[]): DailySeries => ({
  ticker,
  dates,
  close: [...close],
  open: open ?? [close[0], ...close.slice(0, -1)],
  adjClose: adjClose ?? [...close],
  dividends: {},
})

describe('buildLeveragedSeries 손계산 (2배)', () => {
  it('합성수익 = 2×기초수익 − 1×(금리+스프레드)/365 − 보수/365', () => {
    // 기초 +10% 하루, 금리 3.05%+스프레드 0.6% = 3.65%, 보수 3.65%/년 (숫자 깔끔하게)
    const base = mk('QQQ', ['2001-01-02', '2001-01-03'], [100, 110])
    const rate = mk('^IRX', ['2001-01-02', '2001-01-03'], [3.05, 3.05])
    const syn = buildLeveragedSeries('QLD-SIM', base, rate, {
      base: 'QQQ', leverage: 2, expensePct: 3.65, borrowSpreadPct: 0.6,
    })
    // 차입 = (2−1)×(3.05+0.6)/100/365 = 0.0001, 보수 = 3.65/100/365 = 0.0001
    const expected = 100 * (1 + 2 * 0.1 - 0.0001 - 0.0001)
    expect(syn.close[1]).toBeCloseTo(expected, 10)
    expect(syn.close[0]).toBe(100)
  })

  it('주말 경과(Δt=3일)엔 차입·보수도 3일치', () => {
    const base = mk('QQQ', ['2001-01-05', '2001-01-08'], [100, 100]) // 금→월, 기초 0%
    const rate = mk('^IRX', ['2001-01-05', '2001-01-08'], [3.05, 3.05])
    const syn = buildLeveragedSeries('QLD-SIM', base, rate, {
      base: 'QQQ', leverage: 2, expensePct: 3.65, borrowSpreadPct: 0.6,
    })
    expect(syn.close[1]).toBeCloseTo(100 * (1 - 3 * 0.0001 - 3 * 0.0001), 10)
  })

  it('배당은 adjClose 경유로 내재 (총수익 기반)', () => {
    // close는 배당락으로 하락, adjClose(총수익)는 보합 → 합성은 배당 포함 수익 사용
    const base = mk('QQQ', ['2001-01-02', '2001-01-03'], [100, 98], [100, 100])
    const rate = mk('^IRX', ['2001-01-02', '2001-01-03'], [0, 0])
    const syn = buildLeveragedSeries('X-SIM', base, rate, { base: 'QQQ', leverage: 2, expensePct: 0, borrowSpreadPct: 0 })
    expect(syn.close[1]).toBeCloseTo(100, 10) // 총수익 0% × 2 = 0%
  })

  it('금리 결측일은 직전 값 forward-fill', () => {
    const base = mk('QQQ', ['2001-01-02', '2001-01-03', '2001-01-04'], [100, 100, 100])
    const rate = mk('^IRX', ['2001-01-02', '2001-01-04'], [3.05, 7.3 - 0.6]) // 01-03 결측
    const syn = buildLeveragedSeries('X-SIM', base, rate, { base: 'QQQ', leverage: 2, expensePct: 0, borrowSpreadPct: 0.6 })
    expect(syn.close[1]).toBeCloseTo(100 * (1 - 0.0365 / 365), 10) // 01-03: 3.05+0.6=3.65%
    expect(syn.close[2]).toBeCloseTo(syn.close[1] * (1 - 0.073 / 365), 8) // 01-04: 6.7+0.6=7.3%
  })

  it('하루 −33.4% × 3배 = 사실상 전멸 — 음수 불가 클램프', () => {
    const base = mk('QQQ', ['2001-01-02', '2001-01-03', '2001-01-04'], [100, 60, 66])
    const rate = mk('^IRX', base.dates, [0, 0, 0])
    const syn = buildLeveragedSeries('X-SIM', base, rate, { base: 'QQQ', leverage: 3, expensePct: 0, borrowSpreadPct: 0 })
    expect(syn.close[1]).toBeGreaterThan(0)
    expect(syn.close[1]).toBeLessThan(0.001) // 1e-6 클램프 잔존가치
  })
})

describe('loadDataBundle 합성 해석 (TQQQ-SIM → QQQ + ^IRX 조회)', () => {
  it('기초·금리를 조회해 합성 시계열을 번들에 넣음', async () => {
    const DAY = 86_400
    const t0 = Date.parse('2001-01-02T14:30:00Z') / 1000
    const yahoo = (closes: number[]) => ({
      chart: {
        result: [
          {
            meta: { gmtoffset: -18000, dataGranularity: '1d' },
            timestamp: closes.map((_, i) => t0 + i * DAY),
            indicators: {
              quote: [{ open: [closes[0], ...closes.slice(0, -1)], close: closes }],
              adjclose: [{ adjclose: closes }],
            },
          },
        ],
      },
    })
    const fetchMock = vi.fn((url: string) => {
      const body = url.includes('%5EIRX') ? yahoo([5.27, 5.27, 5.27]) : yahoo([100, 110, 121])
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const bundle = await loadDataBundle(['TQQQ-SIM'])
      expect(bundle.series['TQQQ-SIM']).toBeDefined()
      expect(bundle.series['TQQQ-SIM'].close[0]).toBe(100)
      // +10% 하루 → 3배 ≈ +30% (차입·보수 미세 차감)
      expect(bundle.series['TQQQ-SIM'].close[1]).toBeGreaterThan(129)
      expect(bundle.series['TQQQ-SIM'].close[1]).toBeLessThan(130)
      const urls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('/QQQ?'))).toBe(true)
      expect(urls.some((u) => u.includes('%5EIRX'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  }, 15000)
})
