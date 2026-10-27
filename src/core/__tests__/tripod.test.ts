/**
 * 트라이팟 슬리브 엔진 검증 — 손계산 골든 · 등가 프로퍼티 · 룩어헤드 · 세금 · 바깥 리밸런싱 · 검증 규칙
 * (연구 코드와의 일치는 tests/tripod-backtest.test.ts가 저장소 스냅숏으로 확인한다)
 */

import { describe, it, expect } from 'vitest'
import { runBacktest, validateStrategy } from '../engine'
import { computeMetrics } from '../metrics'
import { alignTripodTargets, alignVixToIndex, computeTripodSignals, tripodComponentsFor, isTripodTicker } from '../tripod'
import { spliceSeries } from '../synthetic'
import { makeDates, makeBundle, cleanStrategy, lcg, randomWalk } from './helpers'
import type { AlignedDataBundle, StrategyConfig, TripodState, DailySeries } from '../types'

/** QQQ-EXT·QLD-EXT·TQQQ-EXT 세 상품 + 트라이팟 판정 배열로 번들 구성 */
function triBundle(
  dates: string[],
  closes: { q: number[]; l: number[]; t: number[] },
  target: (TripodState | null)[],
  extra?: { dividendsT?: Record<number, number>; opens?: { q: number[]; l: number[]; t: number[] } }
): AlignedDataBundle {
  const b = makeBundle(dates, {
    'QQQ-EXT': { close: closes.q, open: extra?.opens?.q },
    'QLD-EXT': { close: closes.l, open: extra?.opens?.l },
    'TQQQ-EXT': { close: closes.t, open: extra?.opens?.t, dividends: extra?.dividendsT },
  })
  b.tripod = { target, lastSignalDate: dates[dates.length - 1] }
  return b
}

const tripodStrategy = (partial: Partial<StrategyConfig> = {}, ticker = 'TRIPOD', weight = 1): StrategyConfig => {
  const base = cleanStrategy({ sleeves: [{ ticker, targetWeight: weight }, ...(weight < 1 ? [{ ticker: 'CASH', targetWeight: 1 - weight }] : [])] })
  return { ...base, ...partial, execution: { ...base.execution, timing: 'next_close', ...(partial.execution ?? {}) } }
}

describe('트라이팟 슬리브 — 손계산 골든 (6거래일)', () => {
  const dates = makeDates('2024-01-02', 6)
  // 판정(그날 종가): 3배 → 3배 → 1.5배 → 1.5배 → 현금 → 현금
  const target: TripodState[] = ['T3', 'T3', 'B15', 'B15', 'CASH', 'CASH']
  const closes = {
    q: [100, 100, 110, 110, 110, 110],
    l: [100, 100, 100, 120, 120, 120],
    t: [100, 110, 121, 121, 100, 100],
  }

  it('다음 거래일 종가 체결: 0일 판정 → 1일 종가 진입, 2일 판정(1.5배) → 3일 종가 전환, 4일 판정(현금) → 5일 종가 매도', () => {
    const res = runBacktest(tripodStrategy(), triBundle(dates, closes, target))
    // 1일 종가 110에 TQQQ 10,000달러 → 2일 121 → 11,000. 3일 종가에 TQQQ 전량(11,000) 매도,
    // QQQ 5,500(110에 50주)·QLD 5,500(120에 45.83주). 4일 TQQQ 급락(121→100)은 이미 피했다. 5일 종가에 전량 현금
    expect(res.daily.map((d) => Math.round(d.value))).toEqual([10_000, 10_000, 11_000, 11_000, 11_000, 11_000])
    const t = res.trades.map((x) => `${x.date}|${x.side}|${x.ticker}|${x.reason}|${x.price}`)
    expect(t).toEqual([
      `${dates[1]}|BUY|TQQQ-EXT|initial|110`,
      `${dates[3]}|SELL|TQQQ-EXT|signal|121`,
      `${dates[3]}|BUY|QQQ-EXT|signal|110`,
      `${dates[3]}|BUY|QLD-EXT|signal|120`,
      `${dates[5]}|SELL|QQQ-EXT|signal|110`,
      `${dates[5]}|SELL|QLD-EXT|signal|120`,
    ])
    expect(res.trades.find((x) => x.ticker === 'QQQ-EXT')!.shares).toBeCloseTo(50, 9)
    expect(res.daily[5].sleeveValues.TRIPOD).toBeCloseTo(11_000, 6)
    expect(res.daily[5].sleeveValues.CASH).toBeCloseTo(0, 6) // 슬리브 몫 현금은 CASH 슬리브가 아니다
    expect(res.tripod?.switches.map((s) => `${s.from}>${s.to}`)).toEqual(['null>T3', 'T3>B15', 'B15>CASH'])
    expect(res.tripod?.daysByState).toEqual({ T3: 2, B15: 2, CASH: 1 })
    expect(res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
  })

  it('다음 거래일 시가 체결로 바꾸면 같은 판정이 하루 일찍(시가) 체결된다 — 시가 = 전일 종가인 데이터에서 13,310', () => {
    const res = runBacktest(tripodStrategy({ execution: { timing: 'next_open' } as StrategyConfig['execution'] }), triBundle(dates, closes, target))
    // 1일 시가 100에 100주 → 3일 시가 121에 매도 12,100 → QQQ 110·QLD 100에 반씩 → 3일 종가 6,050 + 7,260
    expect(Math.round(res.finalValue)).toBe(13_310)
    expect(res.trades[0].price).toBe(100)
  })
})

describe('트라이팟 슬리브 — 신호가 고정이면 일반 보유와 같다 (등가 프로퍼티)', () => {
  const n = 320
  const dates = makeDates('2019-01-02', n)
  const rand = lcg(42)
  const closes = { q: randomWalk(100, n, rand), l: randomWalk(100, n, rand), t: randomWalk(100, n, rand) }
  const divs = { 40: 0.4, 100: 0.35, 160: 0.5, 220: 0.45, 280: 0.4 }
  const withCosts = (s: StrategyConfig): StrategyConfig => ({
    ...s,
    contribution: { ...s.contribution, initialUsd: 10_000, monthlyUsd: 1_000 },
    costs: { feeBps: 7, spreadBps: 3 },
    execution: { ...s.execution, cashAnnualYieldPct: 4, timing: 'next_close' },
    tax: { ...s.tax, enabled: true, assumedUsdKrw: 1400 },
  })
  const same = (a: { daily: { value: number }[] }, b: { daily: { value: number }[] }) => {
    expect(a.daily.length).toBe(b.daily.length)
    for (let i = 0; i < a.daily.length; i++) expect(a.daily[i].value).toBeCloseTo(b.daily[i].value, 6)
  }

  it('항상 3배 판정 = TQQQ-EXT 100% 적립 보유 (배당 원천징수·현금 스윕·비용 포함)', () => {
    const b = triBundle(dates, closes, new Array(n).fill('T3'), { dividendsT: divs })
    const tri = runBacktest(withCosts(tripodStrategy()), b)
    const hold = runBacktest(withCosts(cleanStrategy({ sleeves: [{ ticker: 'TQQQ-EXT', targetWeight: 1 }] })), b)
    same(tri, hold)
    expect(tri.dividendsWithheldUsd).toBeCloseTo(hold.dividendsWithheldUsd, 6)
    expect(tri.tripod?.switches).toHaveLength(1) // 첫 진입만
  })

  it('항상 1.5배 판정 = QQQ-EXT 50% + QLD-EXT 50% 무리밸런싱 적립(부족분 우선)', () => {
    const b = triBundle(dates, closes, new Array(n).fill('B15'))
    const tri = runBacktest(withCosts(tripodStrategy()), b)
    const mix = runBacktest(
      withCosts(cleanStrategy({ sleeves: [{ ticker: 'QQQ-EXT', targetWeight: 0.5 }, { ticker: 'QLD-EXT', targetWeight: 0.5 }] })),
      b
    )
    same(tri, mix)
  })

  it('항상 현금 판정 = 현금 100% (슬리브 몫 현금도 같은 금리)', () => {
    const b = triBundle(dates, closes, new Array(n).fill('CASH'))
    const tri = runBacktest(withCosts(tripodStrategy()), b)
    const cash = runBacktest(withCosts(cleanStrategy({ sleeves: [{ ticker: 'CASH', targetWeight: 1 }] })), b)
    same(tri, cash)
    expect(tri.trades).toHaveLength(0)
  })

  it('2배판의 3배 판정 = QLD-EXT 100% 보유 (TQQQ를 쓰지 않음)', () => {
    const b = triBundle(dates, closes, new Array(n).fill('T3'))
    const tri = runBacktest(withCosts(tripodStrategy({}, 'TRIPOD-2X')), b)
    const hold = runBacktest(withCosts(cleanStrategy({ sleeves: [{ ticker: 'QLD-EXT', targetWeight: 1 }] })), b)
    same(tri, hold)
    expect(tri.trades.every((x) => x.ticker === 'QLD-EXT')).toBe(true)
  })
})

describe('트라이팟 슬리브 — 미래 정보 차단', () => {
  const n = 120
  const dates = makeDates('2022-03-01', n)
  const rand = lcg(9)
  const closes = { q: randomWalk(100, n, rand), l: randomWalk(100, n, rand), t: randomWalk(100, n, rand) }
  const states: TripodState[] = ['T3', 'B15', 'CASH']
  const sig = Array.from({ length: n }, () => states[Math.floor(rand() * 3)])

  for (const timing of ['next_close', 'next_open'] as const) {
    it(`${timing}: k+1일 이후 판정을 바꿔도 k+1일 종가까지의 평가액은 그대로`, () => {
      const k = 60
      const altered = sig.map((s, i) => (i > k ? (s === 'T3' ? 'CASH' : 'T3') : s))
      const st = tripodStrategy({ execution: { timing } as StrategyConfig['execution'] })
      const a = runBacktest(st, triBundle(dates, closes, sig))
      const b = runBacktest(st, triBundle(dates, closes, altered))
      for (let i = 0; i <= k + 1; i++) expect(b.daily[i].value).toBe(a.daily[i].value)
      expect(b.daily[n - 1].value).not.toBe(a.daily[n - 1].value)
    })
  }
})

describe('트라이팟 슬리브 — 세금·바깥 리밸런싱·정수주', () => {
  const n = 520
  const dates = makeDates('2020-01-02', n)
  const rand = lcg(2024)
  const up = (start: number, drift: number) => {
    const out = [start]
    for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (rand() - 0.5) * 0.03))
    return out
  }
  const closes = { q: up(100, 0.0008), l: up(100, 0.0016), t: up(100, 0.0024) }
  // 40거래일마다 상태가 돌아가는 신호
  const cycle: TripodState[] = ['T3', 'B15', 'T3', 'CASH', 'B15']
  const sig = Array.from({ length: n }, (_, i) => cycle[Math.floor(i / 40) % cycle.length])

  it('신호 전환 매도가 연간 양도세로 정산된다 (세후 < 세전, 세금 기록 존재)', () => {
    const b = triBundle(dates, closes, sig)
    const st = tripodStrategy({ tax: { ...cleanStrategy({ sleeves: [] }).tax, enabled: true, assumedUsdKrw: 1400 } })
    const post = runBacktest(st, b)
    const pre = runBacktest({ ...st, tax: { ...st.tax, enabled: false } }, b)
    expect(post.taxes.some((x) => x.kind === 'capital_gains')).toBe(true)
    expect(post.trades.filter((x) => x.reason === 'signal' && x.side === 'SELL').every((x) => x.realizedPnl != null)).toBe(true)
    expect(post.finalValue).toBeLessThan(pre.finalValue)
    expect(post.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
  })

  it('트라이팟 60% + 현금 40% 월간 리밸런싱: 체결한 날 바깥 비중이 60/40으로 돌아간다(비용 0)', () => {
    // 월초 결정(i−1일 종가) → i일 종가 체결. 결정 시점 가격으로 정한 수량이라 i일 가격이 움직이면
    // 정확히 60/40이 되지 않으므로, 체결일만 가격을 고정한 데이터로 확인한다
    const monthStartNext = (i: number) => i >= 2 && dates[i - 1].slice(0, 7) !== dates[i - 2].slice(0, 7)
    const hold = (arr: number[]) => {
      const out = [arr[0]]
      for (let i = 1; i < n; i++) out.push(monthStartNext(i) ? out[i - 1] : out[i - 1] * (arr[i] / arr[i - 1]))
      return out
    }
    const b = triBundle(dates, { q: hold(closes.q), l: hold(closes.l), t: hold(closes.t) }, sig)
    const st = tripodStrategy({ rebalance: { trigger: 'periodic', periodMonths: 1, mode: 'sell_to_target' } }, 'TRIPOD', 0.6)
    const res = runBacktest(st, b)
    let checked = 0
    for (let i = 2; i < n; i++) {
      if (!monthStartNext(i)) continue
      const d = res.daily[i]
      expect(d.sleeveValues.TRIPOD / d.value).toBeCloseTo(0.6, 6)
      expect(d.sleeveValues.CASH / d.value).toBeCloseTo(0.4, 6)
      checked++
    }
    expect(checked).toBeGreaterThan(20)
    expect(res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
  })

  it('랜덤 신호 · 적립 · 비용 · 세금 · 밴드 · 정수주에서도 현금 원장과 슬리브 합계가 맞는다', () => {
    const r2 = lcg(77)
    const states: TripodState[] = ['T3', 'B15', 'CASH']
    const noisy = Array.from({ length: n }, () => states[Math.floor(r2() * 3)])
    const b = triBundle(dates, closes, noisy, { dividendsT: { 50: 0.3, 300: 0.3 } })
    for (const fractionalShares of [true, false]) {
      const base = tripodStrategy({ rebalance: { trigger: 'bands', bandAbsPct: 5, mode: 'sell_to_target' } }, 'TRIPOD', 0.7)
      const st: StrategyConfig = {
        ...base,
        contribution: { ...base.contribution, monthlyUsd: 700 },
        costs: { feeBps: 7, spreadBps: 3 },
        execution: { ...base.execution, fractionalShares, cashAnnualYieldPct: 3 },
        tax: { ...base.tax, enabled: true, assumedUsdKrw: 1400 },
      }
      const res = runBacktest(st, b)
      expect(res.warnings.filter((w) => w.code === 'reconciliation')).toEqual([])
      for (const d of res.daily) {
        const sum = Object.values(d.sleeveValues).reduce((a, x) => a + x, 0)
        expect(Math.abs(sum - d.value)).toBeLessThan(1e-6 * Math.max(1, d.value))
        expect(d.cash).toBeGreaterThan(-0.01)
      }
      expect(computeMetrics(res).twrrAnnualPct).toBeTypeOf('number')
    }
  })
})

describe('트라이팟 슬리브 — 검증 규칙', () => {
  it('한 전략에 트라이팟 슬리브는 하나만', () => {
    const st = cleanStrategy({ sleeves: [{ ticker: 'TRIPOD', targetWeight: 0.5 }, { ticker: 'TRIPOD-2X', targetWeight: 0.5 }] })
    expect(validateStrategy(st).some((e) => e.includes('하나만'))).toBe(true)
  })
  it('구성 상품과 같은 티커를 같은 전략에 따로 넣으면 오류', () => {
    const st = cleanStrategy({ sleeves: [{ ticker: 'TRIPOD', targetWeight: 0.5 }, { ticker: 'QQQ', targetWeight: 0.5 }] })
    expect(validateStrategy(st).some((e) => e.includes('QQQ') && e.includes('따로'))).toBe(true)
    // 실물 티커(같은 증권)도 막는다
    const real = cleanStrategy({ sleeves: [{ ticker: 'TRIPOD', targetWeight: 0.5 }, { ticker: 'TQQQ', targetWeight: 0.5 }] })
    expect(validateStrategy(real).some((e) => e.includes('TQQQ') && e.includes('따로'))).toBe(true)
    const ok = cleanStrategy({ sleeves: [{ ticker: 'TRIPOD-2X', targetWeight: 0.5 }, { ticker: 'TQQQ-EXT', targetWeight: 0.5 }] })
    expect(validateStrategy(ok)).toEqual([]) // 2배판은 TQQQ를 쓰지 않는다
  })
  it('번들에 신호가 없으면 실행 전에 막는다', () => {
    const dates = makeDates('2024-01-02', 5)
    const b = makeBundle(dates, { 'QQQ-EXT': { close: [1, 1, 1, 1, 1] }, 'QLD-EXT': { close: [1, 1, 1, 1, 1] }, 'TQQQ-EXT': { close: [1, 1, 1, 1, 1] } })
    expect(validateStrategy(tripodStrategy(), b).some((e) => e.includes('신호 데이터'))).toBe(true)
  })
  it('티커 판별·구성 상품', () => {
    expect(isTripodTicker('tripod')).toBe(true)
    expect(isTripodTicker('TRIPODX')).toBe(false)
    expect(tripodComponentsFor('TRIPOD')).toEqual(['QQQ-EXT', 'QLD-EXT', 'TQQQ-EXT'])
    expect(tripodComponentsFor('TRIPOD-2X')).toEqual(['QQQ-EXT', 'QLD-EXT'])
  })
})

describe('트라이팟 신호 보조 함수', () => {
  it('VIX는 지수 날짜의 값만 쓰고 없으면 직전 값을 잇는다(시작 전 NaN)', () => {
    const out = alignVixToIndex(['d1', 'd2', 'd3', 'd4'], ['d2', 'd2x', 'd4'], [20, 99, 22])
    expect(out[0]).toBeNaN()
    expect(out.slice(1)).toEqual([20, 20, 22])
  })
  it('판정을 백테스트 달력으로 옮길 때는 그날 이전(포함) 마지막 판정', () => {
    const sig = { dates: ['2024-01-02', '2024-01-03', '2024-01-05'], target: ['T3', 'B15', 'CASH'] as TripodState[], regime: [] }
    expect(alignTripodTargets(sig, ['2024-01-01', '2024-01-03', '2024-01-04', '2024-01-08'])).toEqual([null, 'B15', 'B15', 'CASH'])
  })
  it('지표가 준비되기 전(250일 미만)은 판정 없음, 첫 밴드 이탈 전은 현금', () => {
    const n = 300
    const dates = makeDates('2010-01-04', n)
    // 249일 동안 100, 그 뒤 완만히 상승 → 250일선 × 1.01 위로 올라가는 날부터 상승 국면
    const close = Array.from({ length: n }, (_, i) => (i < 260 ? 100 : 100 + (i - 259) * 0.5))
    const sig = computeTripodSignals(dates, close, new Array(n).fill(15))
    expect(sig.target.slice(0, 251).every((t) => t === null)).toBe(true) // 52주 낙폭이 252일째부터
    expect(sig.target[251]).toBe('CASH')
    const firstUp = sig.regime.indexOf('UP')
    expect(firstUp).toBeGreaterThan(260)
    expect(close[firstUp]).toBeGreaterThan(1.01 * (close.slice(firstUp - 249, firstUp + 1).reduce((a, b) => a + b, 0) / 250))
    expect(sig.target[firstUp]).toBe('T3')
  })
})

describe('실물 + 상장 전 합성 연결 (spliceSeries)', () => {
  const s = (ticker: string, dates: string[], close: number[], dividends: Record<string, number> = {}): DailySeries => ({
    ticker, dates, open: close.map((c) => c * 0.99), close, adjClose: close.map((c) => c * 0.9), dividends,
  })
  it('상장 전 구간은 실물 첫 종가에 맞춰 스케일, 상장일 수익률은 합성의 수익률, 배당은 실물만', () => {
    const syn = s('X-SIM', ['d1', 'd2', 'd3', 'd4'], [100, 110, 121, 133.1])
    const real = s('X', ['d3', 'd4'], [50, 60], { d4: 0.2 })
    const out = spliceSeries('X-EXT', real, syn)
    expect(out.dates).toEqual(['d1', 'd2', 'd3', 'd4'])
    // k = 50 / 121
    expect(out.close[0]).toBeCloseTo((100 * 50) / 121, 9)
    expect(out.close[2] / out.close[1]).toBeCloseTo(121 / 110, 12) // 상장일 = 합성 수익률
    expect(out.close.slice(2)).toEqual([50, 60]) // 상장 후 = 실물
    expect(out.dividends).toEqual({ d4: 0.2 })
    // adjClose도 실물 조정비율(0.9)에 이어진다
    expect(out.adjClose[1] / out.close[1]).toBeCloseTo(0.9, 12)
  })
  it('합성이 실물보다 늦게 시작하면 실물 그대로', () => {
    const syn = s('X-SIM', ['d3', 'd4'], [1, 2])
    const real = s('X', ['d1', 'd2', 'd3'], [5, 6, 7])
    expect(spliceSeries('X-EXT', real, syn).close).toEqual([5, 6, 7])
  })
})

describe('유휴현금 금리 — 단기국채 실제 금리 모드', () => {
  const dates = makeDates('2024-01-02', 60)
  const flat = new Array(60).fill(100)
  const cashOnly = (source: 'fixed' | 'tbill', pct: number) => {
    const st = cleanStrategy({ sleeves: [{ ticker: 'CASH', targetWeight: 1 }] })
    return { ...st, execution: { ...st.execution, cashAnnualYieldPct: pct, cashYieldSource: source } }
  }
  it('할인율 5%는 실효 수익률(91일물 연복리 ≈ 5.23%, 채권 환산 5.13%)로 바꿔 쓴다 = 같은 값의 고정 금리와 같다', async () => {
    const { tbillEffectiveYield } = await import('../engine')
    const eff = tbillEffectiveYield(5)
    // 가격 1 − 0.05·91/360 = 0.987361 → (1/가격)^(365/91) − 1
    expect(eff).toBeCloseTo(Math.pow(1 / (1 - (0.05 * 91) / 360), 365 / 91) - 1, 12)
    expect(eff).toBeGreaterThan(0.0523)
    expect(eff).toBeLessThan(0.0524)
    const b = makeBundle(dates, { VOO: { close: flat } })
    b.cashRate = new Array(60).fill(5)
    const a = runBacktest(cashOnly('tbill', 0), b)
    const f = runBacktest(cashOnly('fixed', eff * 100), b)
    expect(a.finalValue).toBeCloseTo(f.finalValue, 9)
    expect(a.finalValue).toBeGreaterThan(10_000)
  })
  it('전일 종가 금리를 그날까지의 기간에 쓴다(룩어헤드 없음)', () => {
    const b = makeBundle(dates, { VOO: { close: flat } })
    b.cashRate = dates.map((_, i) => (i < 30 ? 0 : 10))
    const res = runBacktest(cashOnly('tbill', 0), b)
    expect(res.daily[30].value).toBe(10_000) // 30일 이자는 29일 금리(0%)
    expect(res.daily[31].value).toBeGreaterThan(10_000)
  })
  it('자료가 없는 날(NaN)은 고정 금리로 대체', () => {
    const b = makeBundle(dates, { VOO: { close: flat } })
    b.cashRate = new Array(60).fill(NaN)
    expect(runBacktest(cashOnly('tbill', 5), b).finalValue).toBeCloseTo(runBacktest(cashOnly('fixed', 5), b).finalValue, 9)
  })
  it('단기국채 모드인데 금리 데이터가 없으면 실행 전에 막는다', () => {
    const b = makeBundle(dates, { VOO: { close: flat } })
    expect(validateStrategy(cashOnly('tbill', 4), b).some((e) => e.includes('^IRX'))).toBe(true)
  })
})

describe('체결 시점 — 일반 전략의 다음 거래일 종가 체결', () => {
  it('next_close는 다음 거래일 종가로, next_open은 시가로 체결된다', () => {
    const dates = makeDates('2024-01-02', 4)
    const b = makeBundle(dates, { VOO: { close: [100, 120, 130, 130], open: [100, 105, 125, 130] } })
    const st = cleanStrategy({ sleeves: [{ ticker: 'VOO', targetWeight: 1 }] })
    const open = runBacktest(st, b)
    const close = runBacktest({ ...st, execution: { ...st.execution, timing: 'next_close' } }, b)
    expect(open.trades[0].price).toBe(105)
    expect(close.trades[0].price).toBe(120)
    expect(close.trades[0].date).toBe(dates[1])
    expect(close.daily[1].value).toBeCloseTo(10_000, 9) // 종가 체결 직후 평가 = 투입액
  })
})

describe('데이터 로드 — TRIPOD 슬리브 해석 (야후 응답 스텁)', () => {
  it('구성 상품(QQQ-EXT·QLD-EXT·TQQQ-EXT)을 연결해 붙이고, 판정이 준비되는 날부터 비교하며, ^NDX·^VIX는 보유 시계열에 넣지 않는다', async () => {
    const { loadDataBundle } = await import('../data')
    const { vi } = await import('vitest')
    const DAY = 86_400
    const t0 = Date.parse('2001-01-02T14:30:00Z') / 1000
    const N = 420
    const yahoo = (closes: number[], startDay = 0) => ({
      chart: {
        result: [
          {
            meta: { gmtoffset: -18000, dataGranularity: '1d' },
            timestamp: closes.map((_, i) => t0 + (startDay + i) * DAY),
            indicators: { quote: [{ open: closes, close: closes }], adjclose: [{ adjclose: closes }] },
          },
        ],
      },
    })
    const rising = (n: number, start: number, g: number) => Array.from({ length: n }, (_, i) => start * (1 + g) ** i)
    const bodies: Record<string, unknown> = {
      '%5ENDX': yahoo(rising(N, 1000, 0.001)), // 지수가 가장 먼저(0일째) 시작
      QQQ: yahoo(rising(N - 50, 100, 0.001), 50), // 50일째 상장 → 그 전은 지수 합성
      QLD: yahoo(rising(N - 300, 50, 0.002), 300), // 300일째 상장
      TQQQ: yahoo(rising(N - 350, 20, 0.003), 350), // 350일째 상장
      '%5EIRX': yahoo(new Array(N).fill(4)),
      '%5EVIX': yahoo(new Array(N).fill(15)),
    }
    const fetchMock = vi.fn((url: string) => {
      const key = Object.keys(bodies).find((k) => url.includes(`/chart/${k}?`))
      if (!key) return Promise.resolve(new Response('{}', { status: 404 }))
      return Promise.resolve(new Response(JSON.stringify(bodies[key]), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const b = await loadDataBundle(['TRIPOD', 'CASH'], { cashRate: true })
      expect(Object.keys(b.series).sort()).toEqual(['QLD-EXT', 'QQQ-EXT', 'TQQQ-EXT'])
      // 판정 준비(250일선·52주 낙폭: 252일째) 전 구간은 잘라 낸다 — 경고로 안내
      const day = (k: number) => new Date((t0 + k * DAY - 18000) * 1000).toISOString().slice(0, 10)
      expect(b.dates[0]).toBe(day(251))
      expect(b.dates).toHaveLength(N - 251)
      expect(b.clipWarnings.some((w) => w.includes('판정은') && w.includes(day(251)))).toBe(true)
      expect(b.tripod?.target.every((t) => t !== null)).toBe(true)
      // 연결 지점: 실물 상장일 종가 = 실물 첫 종가 (QLD 300일째, TQQQ 350일째)
      expect(b.series['QLD-EXT'].close[300 - 251]).toBeCloseTo(50, 9)
      expect(b.series['TQQQ-EXT'].close[350 - 251]).toBeCloseTo(20, 9)
      expect(b.cashRate?.every((r) => r === 4)).toBe(true)
      const urls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('%5ENDX'))).toBe(true)
      expect(urls.some((u) => u.includes('%5EVIX'))).toBe(true)
      // 해시는 신호까지 포함 — 같은 입력이면 같은 지문
      const again = await loadDataBundle(['TRIPOD'], { cashRate: true })
      expect(again.snapshotHash).toBe(b.snapshotHash)
      // 종료일이 판정 준비일보다 앞이면 원인을 알려 준다
      await expect(loadDataBundle(['TRIPOD'], { endDate: day(100) })).rejects.toThrow(/트라이팟은 .*부터 계산할 수 있습니다/)
    } finally {
      vi.unstubAllGlobals()
    }
  }, 30000)

  it('구성 상품 조회가 실패하면 사용자가 넣지 않은 티커 대신 TRIPOD에 필요한 자료라고 알린다', async () => {
    const { loadDataBundle } = await import('../data')
    const { vi } = await import('vitest')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))))
    try {
      await expect(loadDataBundle(['TRIPOD'])).rejects.toThrow(/TRIPOD 계산에 필요한 .* 자료를 받지 못했습니다\(HTTP 404\)/)
      // 사용자가 직접 넣은 티커는 원래 안내(심볼 확인)를 유지
      await expect(loadDataBundle(['NOPE'])).rejects.toThrow(/존재하지 않는 티커/)
    } finally {
      vi.unstubAllGlobals()
    }
  }, 30000)

  it('미국 장중에 받은 오늘 봉은 판정에서 뺀다 (동부 16:20 전)', async () => {
    const { dropUnsettledBar } = await import('../data')
    const s: DailySeries = { ticker: '^NDX', dates: ['2026-10-26', '2026-10-27'], open: [1, 2], close: [1, 2], adjClose: [1, 2], dividends: {} }
    // 2026-10-27 14:00 동부(서머타임, UTC−4) = 18:00 UTC → 장중 → 오늘 봉 제외
    expect(dropUnsettledBar(s, new Date('2026-10-27T18:00:00Z')).dates).toEqual(['2026-10-26'])
    // 16:30 동부 = 20:30 UTC → 확정
    expect(dropUnsettledBar(s, new Date('2026-10-27T20:30:00Z')).dates).toEqual(['2026-10-26', '2026-10-27'])
    // 다음 날 새벽(한국 시간 오전) → 어제 봉은 확정
    expect(dropUnsettledBar(s, new Date('2026-10-28T01:00:00Z')).dates).toHaveLength(2)
  })
})

describe('유휴현금 금리 — 데이터 로드 대체 경로', () => {
  it('역사 월간(-HIST) 모드는 ^IRX를 받지 않고 고정 금리로 둔다(경고)', async () => {
    const { loadDataBundle, resetHistAssetsCache } = await import('../data')
    const { vi } = await import('vitest')
    const months = Array.from({ length: 14 }, (_, i) => `19${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ meta: { note: 't', dataEnd: '1921-02' }, assets: { 'SPX-HIST': { dates: months, close: months.map((_, i) => 100 + i) } } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const b = await loadDataBundle(['SPX-HIST'], { cashRate: true })
      expect(b.cashRate?.every((r) => Number.isNaN(r))).toBe(true)
      expect(b.clipWarnings.some((w) => w.includes('역사 월간 모드는 고정 금리'))).toBe(true)
      expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('IRX'))).toBe(true)
      const res = runBacktest({ ...cleanStrategy({ sleeves: [{ ticker: 'SPX-HIST', targetWeight: 0.5 }, { ticker: 'CASH', targetWeight: 0.5 }] }), execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100, cashYieldSource: 'tbill' } }, b)
      expect(res.finalValue).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
      resetHistAssetsCache()
    }
  })

  it('^IRX 조회가 실패해도 실행은 고정 금리로 계속된다(경고)', async () => {
    const { loadDataBundle } = await import('../data')
    const { vi } = await import('vitest')
    const DAY = 86_400
    const t0 = Date.parse('2021-01-04T14:30:00Z') / 1000
    const closes = [100, 101, 102, 103]
    const body = { chart: { result: [{ meta: { gmtoffset: -18000, dataGranularity: '1d' }, timestamp: closes.map((_, i) => t0 + i * DAY), indicators: { quote: [{ open: closes, close: closes }], adjclose: [{ adjclose: closes }] } }] } }
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(url.includes('%5EIRX') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 }))
    ))
    try {
      const b = await loadDataBundle(['VOO'], { cashRate: true })
      expect(b.cashRate).toHaveLength(4)
      expect(b.cashRate?.every((r) => Number.isNaN(r))).toBe(true)
      expect(b.clipWarnings.some((w) => w.includes('받지 못해 고정 금리'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  }, 20000)
})

describe('청산 기준 (기간 끝 전량 매도 가정)', () => {
  const dates = makeDates('2024-03-04', 6)
  const b = makeBundle(dates, { VOO: { close: [100, 100, 120, 150, 180, 200] } })
  const taxed = (feeBps = 0) => {
    const st = cleanStrategy({ sleeves: [{ ticker: 'VOO', targetWeight: 1 }] })
    return { ...st, costs: { feeBps, spreadBps: 0 }, tax: { ...st.tax, enabled: true } }
  }
  it('미실현 이익 $10,000(가정 환율 1,000원) → (1,000만 − 250만) × 22% = $1,650, 청산 후 $18,350', () => {
    const res = runBacktest(taxed(), b)
    expect(res.finalValue).toBeCloseTo(20_000, 6)
    expect(res.liquidation?.taxUsd).toBeCloseTo(1_650, 6)
    expect(res.liquidation?.valueUsd).toBeCloseTo(18_350, 6)
    const m = computeMetrics(res)
    expect(m.liquidatedValue).toBeCloseTo(18_350, 6)
  })
  it('같은 해에 이미 실현한 이익과 공제를 나눠 쓴다 (증분 세액)', () => {
    // 3일 종가 150에 절반 매도 결정 → 4일 체결가 180: 실현 50주 × (180 − 100) = $4,000
    const st = { ...taxed(), rebalance: { trigger: 'bands' as const, bandAbsPct: 1, mode: 'sell_to_target' as const } }
    const half = { ...st, sleeves: [{ ticker: 'VOO', targetWeight: 0.5 }, { ticker: 'CASH', targetWeight: 0.5 }] }
    const res = runBacktest(half, b)
    const realized = res.trades.filter((t) => t.side === 'SELL').reduce((a, t) => a + (t.realizedPnl ?? 0), 0)
    const cg = (usd: number) => Math.max(0, usd * 1000 - 2_500_000) * 0.22 / 1000
    const unrealized = res.daily[5].sleeveValues.VOO - (res.daily[5].sleeveValues.VOO / 200) * 100
    expect(res.liquidation?.taxUsd).toBeCloseTo(cg(realized + unrealized) - cg(realized), 6)
  })
  it('세금을 끄면 청산 비용(수수료)만 빠진다', () => {
    const st = { ...taxed(10), tax: { ...taxed().tax, enabled: false } }
    const res = runBacktest(st, b)
    expect(res.liquidation?.taxUsd).toBe(0)
    expect(res.liquidation?.costUsd).toBeCloseTo(res.finalValue * 0.001, 6)
  })
})

describe('검수 반영 (2026-10-27)', () => {
  it('지수 총수익 재구성: proxy 상장 전은 가격지수 그대로, 상장 뒤는 분배금 수익률 + 보수 되돌림', async () => {
    const { buildIndexTotalReturn } = await import('../synthetic')
    const idx: DailySeries = { ticker: '^I', dates: ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-06'], open: [100, 100, 110, 110], close: [100, 110, 110, 121], adjClose: [100, 110, 110, 121], dividends: {} }
    const proxy: DailySeries = { ticker: 'P', dates: ['2020-01-02', '2020-01-03', '2020-01-06'], open: [10, 11, 11], close: [11, 11, 12.1], adjClose: [11, 11, 12.1], dividends: { '2020-01-03': 0.11 } }
    const tr = buildIndexTotalReturn('^I-TR', idx, proxy, 36.5) // 연 36.5% = 하루 0.1% (보수 되돌림 확인용 큰 값)
    // 01-02: proxy 상장일 → 보수 되돌림만(1일): 110/100 − 1 + 0.001
    expect(tr.adjClose[1] / tr.adjClose[0] - 1).toBeCloseTo(0.1 + 0.001, 12)
    // 01-03: 가격 0% + 분배금 0.11/11 = 1% + 보수 1일 0.1%
    expect(tr.adjClose[2] / tr.adjClose[1] - 1).toBeCloseTo(0.01 + 0.001, 12)
    // 01-06(3일 경과): 가격 10% + 보수 3일 0.3%
    expect(tr.adjClose[3] / tr.adjClose[2] - 1).toBeCloseTo(0.1 + 0.003, 12)
    expect(tr.close).toEqual(idx.close)
  })

  it('이자 원천징수 15.4%: 세금 반영 시 이자에서 떼고 기록한다(세금 끄면 그대로)', () => {
    const dates = makeDates('2024-01-02', 260)
    const b = makeBundle(dates, { VOO: { close: new Array(260).fill(100) } })
    const st = cleanStrategy({ sleeves: [{ ticker: 'CASH', targetWeight: 1 }] })
    const base = { ...st, execution: { ...st.execution, cashAnnualYieldPct: 5 } }
    const off = runBacktest(base, b)
    const on = runBacktest({ ...base, tax: { ...base.tax, enabled: true, interestWithholdingPct: 15.4 } }, b)
    // 원천징수 뒤 잔고로 복리가 붙으므로 세후 이자 총액 기준으로 맞춘다: 원천 = 순이자 × 0.154 / 0.846
    const net = on.finalValue - 10_000
    expect(on.interestWithheldUsd).toBeCloseTo((net * 0.154) / 0.846, 6)
    expect(on.finalValue).toBeLessThan(off.finalValue)
    expect(off.interestWithheldUsd).toBe(0)
  })

  it('비중 0% 트라이팟은 체결 시점 기본값을 바꾸지 않는다', async () => {
    const { executionTiming } = await import('../engine')
    expect(executionTiming(cleanStrategy({ sleeves: [{ ticker: 'TRIPOD', targetWeight: 0 }, { ticker: 'VOO', targetWeight: 1 }] }))).toBe('next_open')
  })

  it('신호 전환 때 전체 비중 맞추기: 전환 체결일에 바깥 비중이 목표로 돌아간다(비용 0, 체결일 가격 고정)', () => {
    const n = 200
    const dates = makeDates('2021-01-04', n)
    const rand = lcg(5)
    const states: TripodState[] = ['T3', 'B15', 'CASH']
    const sig: TripodState[] = Array.from({ length: n }, (_, i) => states[Math.floor(i / 25) % 3])
    // 결정(i−1) → 체결(i) 사이 가격을 고정해 정확한 비중을 확인한다: 전환 체결일의 수익률 0
    const switchExec = new Set<number>()
    for (let i = 2; i < n; i++) if (sig[i - 1] !== sig[i - 2]) switchExec.add(i)
    const walk = () => {
      const out = [100]
      for (let i = 1; i < n; i++) out.push(switchExec.has(i) ? out[i - 1] : out[i - 1] * (1 + (rand() - 0.45) * 0.06))
      return out
    }
    const b = triBundle(dates, { q: walk(), l: walk(), t: walk() }, sig)
    const st = tripodStrategy({ rebalance: { trigger: 'none', mode: 'sell_to_target', onTripodSwitch: true } }, 'TRIPOD', 0.6)
    const res = runBacktest(st, b)
    let checked = 0
    for (const i of switchExec) {
      if (i < 3) continue
      expect(res.daily[i].sleeveValues.TRIPOD / res.daily[i].value).toBeCloseTo(0.6, 6)
      checked++
    }
    expect(checked).toBeGreaterThan(4)
    // 끄면 전환일에도 바깥 비중이 흘러간 그대로
    const off = runBacktest({ ...st, rebalance: { trigger: 'none', mode: 'sell_to_target' } }, b)
    const drift = [...switchExec].filter((i) => i >= 3).some((i) => Math.abs(off.daily[i].sleeveValues.TRIPOD / off.daily[i].value - 0.6) > 0.01)
    expect(drift).toBe(true)
  })

  it('2000년 이전 시가가 전일 종가 복사본인 자산을 시가 체결로 들면 경고', () => {
    const dates = makeDates('1998-01-02', 60)
    const close = Array.from({ length: 60 }, (_, i) => 100 + i)
    const b = makeBundle(dates, { X: { close } }) // makeBundle 기본: 시가 = 전일 종가
    const st = cleanStrategy({ sleeves: [{ ticker: 'X', targetWeight: 1 }] })
    expect(runBacktest(st, b).warnings.some((w) => w.code === 'data_caveat')).toBe(true)
    expect(runBacktest({ ...st, execution: { ...st.execution, timing: 'next_close' } }, b).warnings.some((w) => w.code === 'data_caveat')).toBe(false)
  })

  it('연결일 시가는 합성 시가를 같은 비율로 옮긴 값(밤사이·장중 수익률이 합성과 같음)', () => {
    const syn: DailySeries = { ticker: 'S', dates: ['d1', 'd2', 'd3'], open: [100, 104, 108], close: [100, 105, 110], adjClose: [100, 105, 110], dividends: {} }
    const real: DailySeries = { ticker: 'R', dates: ['d2', 'd3'], open: [9, 10.2], close: [10, 10.5], adjClose: [10, 10.5], dividends: {} }
    const out = spliceSeries('R-EXT', real, syn)
    const k = 10 / 105
    expect(out.open[1]).toBeCloseTo(104 * k, 12) // 실물 첫 시가 9 대신
    expect(out.open[1] / out.close[0]).toBeCloseTo(104 / 100, 12)
    expect(out.open[2]).toBe(10.2) // 그 뒤는 실물
  })

  it('시작일이 자산 데이터보다 앞서면 자산이 하나뿐이어도 늦춰진 이유를 알리고, 거래일이 없으면 가능한 첫날을 알려 준다', async () => {
    const { alignToCommonCalendar } = await import('../data')
    const s: DailySeries = { ticker: 'VOO', dates: ['2010-09-09', '2010-09-10', '2010-09-13'], open: [1, 1, 1], close: [1, 1, 1], adjClose: [1, 1, 1], dividends: {} }
    const b = alignToCommonCalendar([s], { startDate: '2000-01-01' })
    expect(b.clipWarnings.some((w) => w.includes('2000-01-01') && w.includes('VOO'))).toBe(true)
    expect(() => alignToCommonCalendar([s], { endDate: '2005-01-01' })).toThrow(/2010-09-09부터입니다\(VOO\)/)
  })

  it('실물 티커도 트라이팟과 충돌 목록에 든다', async () => {
    const { tripodConflictsFor } = await import('../tripod')
    expect(tripodConflictsFor('TRIPOD')).toEqual(['QQQ-EXT', 'QQQ', 'QLD-EXT', 'QLD', 'TQQQ-EXT', 'TQQQ'])
    expect(tripodConflictsFor('TRIPOD-2X')).toEqual(['QQQ-EXT', 'QQQ', 'QLD-EXT', 'QLD'])
  })
})
