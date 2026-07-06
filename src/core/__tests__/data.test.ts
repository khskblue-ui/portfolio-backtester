/**
 * 데이터 레이어 검증 (§3) — 캘린더 정렬·클립·배당 이월·스냅샷 해시
 */

import { describe, it, expect } from 'vitest'
import { alignToCommonCalendar, hashBundle, isCryptoTicker } from '../data'
import type { DailySeries } from '../types'

function series(ticker: string, dates: string[], price = 100, dividends: Record<string, number> = {}): DailySeries {
  return {
    ticker,
    dates,
    open: dates.map(() => price),
    close: dates.map(() => price),
    adjClose: dates.map(() => price),
    dividends,
  }
}

// 2023-01-02(월)~2023-01-13(금) — 주식 거래일
const EQUITY_DATES = [
  '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06',
  '2023-01-09', '2023-01-10', '2023-01-11', '2023-01-12', '2023-01-13',
]
// 크립토는 주말 포함 365일
const CRYPTO_DATES = [
  '2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06',
  '2023-01-07', '2023-01-08', '2023-01-09', '2023-01-10', '2023-01-11', '2023-01-12', '2023-01-13',
]

describe('공통 거래 캘린더 (3.3)', () => {
  it('크립토(365일)는 주식 거래일에만 샘플링 — 주말 밴드 트리거 왜곡 방지', () => {
    const bundle = alignToCommonCalendar([
      series('VOO', EQUITY_DATES),
      series('BTC-USD', CRYPTO_DATES),
    ])
    expect(bundle.dates).toEqual(EQUITY_DATES.slice(0)) // 캘린더 = 주식 거래일
    expect(bundle.series['BTC-USD'].close).toHaveLength(EQUITY_DATES.length)
  })

  it('비정렬 시작일: 히스토리 가장 짧은 자산에 맞춰 클립 + 원인 자산 지목 경고', () => {
    const late = series('BTC-USD', CRYPTO_DATES.slice(6)) // 01-07부터
    const bundle = alignToCommonCalendar([series('VOO', EQUITY_DATES), late])
    expect(bundle.dates[0]).toBe('2023-01-09') // 01-07(토) 이후 첫 거래일
    expect(bundle.clipWarnings.length).toBeGreaterThan(0)
    // 경고는 클립"당한" 자산이 아니라 기간을 결정한 "원인" 자산(BTC-USD)을 지목해야 함
    expect(bundle.clipWarnings[0]).toContain('BTC-USD')
    expect(bundle.clipWarnings[0]).toContain('2023-01-09')
    expect(bundle.clipWarnings[0]).toContain('때문')
  })

  it('사용자 지정 시작일보다 늦어지는 경우 경고에 지정일 명시', () => {
    const late = series('BTC-USD', CRYPTO_DATES.slice(6))
    const bundle = alignToCommonCalendar([series('VOO', EQUITY_DATES), late], { startDate: '2023-01-02' })
    expect(bundle.clipWarnings[0]).toContain('2023-01-02')
    expect(bundle.clipWarnings[0]).toContain('BTC-USD')
  })

  it('종료일 지정: 해당일 이후 데이터 제외', () => {
    const bundle = alignToCommonCalendar([series('VOO', EQUITY_DATES)], { endDate: '2023-01-10' })
    expect(bundle.dates[bundle.dates.length - 1]).toBe('2023-01-10')
    expect(bundle.dates[0]).toBe('2023-01-02')
  })

  it('주말 배당(ex-date 캘린더 밖)은 다음 거래일로 이월 — 현금흐름 유실 방지', () => {
    const bundle = alignToCommonCalendar([
      series('VOO', EQUITY_DATES),
      series('BTC-USD', CRYPTO_DATES, 100, { '2023-01-07': 1.5 }), // 토요일 "배당"
    ])
    const idx = bundle.dates.indexOf('2023-01-09')
    expect(bundle.series['BTC-USD'].divPerShare[idx]).toBeCloseTo(1.5, 10)
  })

  it('거래일 배당은 해당일에 매핑', () => {
    const bundle = alignToCommonCalendar([series('VOO', EQUITY_DATES, 100, { '2023-01-05': 0.8 })])
    const idx = bundle.dates.indexOf('2023-01-05')
    expect(bundle.series['VOO'].divPerShare[idx]).toBeCloseTo(0.8, 10)
  })
})

describe('스냅샷 해시 (3.4 재현성)', () => {
  it('같은 데이터 = 같은 해시, 데이터 수정 = 다른 해시', () => {
    const a = alignToCommonCalendar([series('VOO', EQUITY_DATES)])
    const b = alignToCommonCalendar([series('VOO', EQUITY_DATES)])
    expect(a.snapshotHash).toBe(b.snapshotHash)

    const modified = series('VOO', EQUITY_DATES)
    modified.close[3] = 101.23 // 벤더가 조용히 수정한 상황
    const c = alignToCommonCalendar([modified])
    expect(c.snapshotHash).not.toBe(a.snapshotHash)
  })

  it('hashBundle은 결정론', () => {
    const a = alignToCommonCalendar([series('VOO', EQUITY_DATES), series('GLD', EQUITY_DATES, 180)])
    expect(hashBundle(a)).toBe(hashBundle(a))
  })
})

describe('크립토 판별', () => {
  it('-USD 접미사', () => {
    expect(isCryptoTicker('BTC-USD')).toBe(true)
    expect(isCryptoTicker('eth-usd')).toBe(true)
    expect(isCryptoTicker('VOO')).toBe(false)
  })
})

describe('429 레이트리밋 재시도 (fetchDailySeries)', async () => {
  const { fetchDailySeries } = await import('../data')
  const { vi } = await import('vitest')

  const okPayload = {
    chart: {
      result: [
        {
          meta: { gmtoffset: 0 },
          timestamp: [1672617600, 1672704000],
          indicators: { quote: [{ open: [100, 101], close: [101, 102] }], adjclose: [{ adjclose: [101, 102] }] },
        },
      ],
    },
  }
  const res = (status: number, body?: unknown) =>
    new Response(body != null ? JSON.stringify(body) : '', { status })

  it('429 두 번 후 성공 → 재시도로 복구', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200, okPayload))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const series = await fetchDailySeries('SPY', { retryBaseMs: 1 })
      expect(series.dates).toHaveLength(2)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('429 지속 → 4회 시도 후 안내 메시지와 함께 실패', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(fetchDailySeries('SPY', { retryBaseMs: 1 })).rejects.toThrow(/429.*요청 과다/)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('404 등 4xx는 재시도 없이 즉시 실패', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(404))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(fetchDailySeries('NOPE', { retryBaseMs: 1 })).rejects.toThrow(/404/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('자산 카탈로그 (장기 히스토리 대체)', async () => {
  const { ASSET_CATALOG, assetCautionFor } = await import('../catalog')

  it('티커 중복 없음 + 닷컴버블 커버 자산 존재 (2000년 이전 시작)', () => {
    const tickers = ASSET_CATALOG.map((a) => a.ticker)
    expect(new Set(tickers).size).toBe(tickers.length)
    expect(ASSET_CATALOG.some((a) => a.startYear <= 1995)).toBe(true)
  })

  it('지수/선물엔 주의사항, 일반 ETF엔 없음', () => {
    expect(assetCautionFor('^GSPC')).toMatch(/배당 미포함/)
    expect(assetCautionFor('^UNKNOWN_INDEX')).toMatch(/배당 미포함/) // 패턴 감지
    expect(assetCautionFor('GC=F')).toMatch(/롤오버/)
    expect(assetCautionFor('SPY')).toBeNull()
  })
})

describe('Stooq CSV 파싱 (장기 히스토리 소스)', async () => {
  const { parseStooqCsv } = await import('../data')

  it('정상 CSV → DailySeries (배당 없음)', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n1990-01-02,401.5,403.0,400.1,402.3,0\n1990-01-03,402.3,404.0,401.0,403.8,0\n'
    const s = parseStooqCsv(csv, 'XAUUSD')
    expect(s.dates).toEqual(['1990-01-02', '1990-01-03'])
    expect(s.open[0]).toBeCloseTo(401.5, 10)
    expect(s.close[1]).toBeCloseTo(403.8, 10)
    expect(Object.keys(s.dividends)).toHaveLength(0)
  })

  it('무효 행(결측·0가격)은 건너뜀', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n1990-01-02,401.5,403,400,402.3,0\nbad,row,,,,\n1990-01-04,0,0,0,0,0\n1990-01-05,405,406,404,405.5,0\n'
    const s = parseStooqCsv(csv, 'XAUUSD')
    expect(s.dates).toEqual(['1990-01-02', '1990-01-05'])
  })

  it('심볼 없음 응답 → 안내 에러', () => {
    expect(() => parseStooqCsv('No data', 'NOPE')).toThrow(/Stooq/)
  })
})

describe('빈 티커 검증 (HTTP 404 원인 차단)', async () => {
  const { validateStrategy } = await import('../engine')
  const { cleanStrategy } = await import('./helpers')

  it('빈 티커 슬리브 → 검증 에러 (조회 전에 차단)', () => {
    const s = cleanStrategy({
      sleeves: [
        { ticker: 'VOO', targetWeight: 1 },
        { ticker: '', targetWeight: 0 },
      ],
    })
    expect(validateStrategy(s).some((e) => e.includes('빈 티커'))).toBe(true)
  })
})
