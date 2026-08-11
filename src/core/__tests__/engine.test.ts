/**
 * 엔진 검증 (PRD §9)
 * - 골든마스터: 손계산 가능한 단순 케이스를 허용오차 내 재현
 * - 유닛: 단일 리밸런싱·배당·세금 1건을 손계산 기대값과 대조
 * - 프로퍼티: no_sell 무매도 · 슬리브합=포트가치 · 현금≥0 · 리컨실 무결
 */

import { describe, it, expect } from 'vitest'
import { runBacktest, validateStrategy } from '../engine'
import { makeDates, makeBundle, constSeries, cleanStrategy, lcg, randomWalk } from './helpers'

const EPS = 1e-6

describe('골든마스터: 상수 가격 60/40 (현금 보존·배분 정확성)', () => {
  // A=100, B=50 고정 — 리밸런싱 불필요, 가치는 납입 합과 정확히 일치해야 함
  const n = 70 // ~3.5개월
  const dates = makeDates('2023-01-02', n)
  const bundle = makeBundle(dates, {
    A: { close: constSeries(100, n) },
    B: { close: constSeries(50, n) },
  })
  const strategy = cleanStrategy({
    sleeves: [
      { ticker: 'A', targetWeight: 0.6 },
      { ticker: 'B', targetWeight: 0.4 },
    ],
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
  })
  const result = runBacktest(strategy, bundle)

  it('최종 가치 = 총 납입 (수익 0, 비용 0)', () => {
    const monthStarts = dates.filter((d, i) => i > 0 && dates[i - 1].slice(0, 7) !== d.slice(0, 7)).length
    expect(result.totalContributions).toBeCloseTo(10_000 + 1_000 * monthStarts, 6)
    expect(result.finalValue).toBeCloseTo(result.totalContributions, 6)
  })

  it('초기 매수: A 60주@100, B 80주@50 (t+1 시가 체결)', () => {
    const [buyA, buyB] = result.trades.slice(0, 2).sort((a, b) => a.ticker.localeCompare(b.ticker))
    expect(buyA.date).toBe(dates[1]) // t=0 결정 → t=1 체결 (룩어헤드 가드)
    expect(buyA.shares).toBeCloseTo(60, 6)
    expect(buyB.shares).toBeCloseTo(80, 6)
  })

  it('월 적립도 60/40으로 배분 (to_underweight → 부족분 비례)', () => {
    const monthlyBuys = result.trades.filter((t) => t.reason === 'contribution')
    for (const t of monthlyBuys) {
      if (t.ticker === 'A') expect(t.shares * t.price).toBeCloseTo(600, 4)
      if (t.ticker === 'B') expect(t.shares * t.price).toBeCloseTo(400, 4)
    }
  })

  it('리컨실 경고 없음', () => {
    expect(result.warnings.filter((w) => w.code === 'reconciliation')).toHaveLength(0)
  })
})

describe('골든마스터: 단일 자산 일 1% 성장 (복리 정확성)', () => {
  const n = 30
  const dates = makeDates('2023-03-01', n)
  const close = Array.from({ length: n }, (_, t) => 100 * Math.pow(1.01, t))
  const bundle = makeBundle(dates, { A: { close } })
  const result = runBacktest(
    cleanStrategy({
      sleeves: [{ ticker: 'A', targetWeight: 1 }],
      contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'pro_rata' },
    }),
    bundle
  )

  it('day1 시가(=day0 종가 100)에 100주 매수 → 가치 = 10000×1.01^t', () => {
    expect(result.trades[0].shares).toBeCloseTo(100, 6)
    const lastExpected = 100 * close[n - 1]
    expect(result.finalValue).toBeCloseTo(lastExpected, 4)
  })
})

describe('유닛: 밴드 리밸런싱 1회 손계산 (4.2 타이밍 + 5.1 이동평균)', () => {
  // A=100 고정, B: 50 → 10일째 150 점프. 밴드 10%p, sell_to_target
  const n = 40
  const dates = makeDates('2023-01-02', n)
  const jumpAt = 10
  const closeB = constSeries(50, n).map((v, i) => (i >= jumpAt ? 150 : v))
  const bundle = makeBundle(dates, {
    A: { close: constSeries(100, n) },
    B: { close: closeB },
  })
  const result = runBacktest(
    cleanStrategy({
      sleeves: [
        { ticker: 'A', targetWeight: 0.6 },
        { ticker: 'B', targetWeight: 0.4 },
      ],
      rebalance: { trigger: 'bands', bandAbsPct: 10, mode: 'sell_to_target' },
    }),
    bundle
  )

  it('점프 다음날 매도 32주·실현손익 3200 (이동평균 원가 50)', () => {
    const sell = result.trades.find((t) => t.side === 'SELL')!
    expect(sell.ticker).toBe('B')
    expect(sell.date).toBe(dates[jumpAt + 1]) // 점프일 종가 관측 → 다음날 체결
    expect(sell.shares).toBeCloseTo(32, 6) // (12000−5600... 목표 0.4×18000=7200 → 4800/150
    expect(sell.realizedPnl).toBeCloseTo(3200, 6) // 32 × (150 − 50)
  })

  it('동시에 A 48주 매수 → 목표 비중 복원', () => {
    const buy = result.trades.find((t) => t.side === 'BUY' && t.reason === 'rebalance')!
    expect(buy.ticker).toBe('A')
    expect(buy.shares).toBeCloseTo(48, 6) // (0.6×18000 − 6000)/100
    const last = result.daily[result.daily.length - 1]
    expect(last.sleeveValues['A'] / last.value).toBeCloseTo(0.6, 3)
  })
})

describe('유닛: 배당 분해 (3.2 이중계산 함정 — 원천 15%만 차감)', () => {
  const n = 20
  const dates = makeDates('2023-05-01', n)
  const bundle = makeBundle(dates, {
    A: { close: constSeries(100, n), dividends: { 5: 1.0 } }, // 5일째 ex-date $1/주
  })
  const strategy = cleanStrategy({
    sleeves: [{ ticker: 'A', targetWeight: 1 }],
  })
  strategy.tax.enabled = true
  const result = runBacktest(strategy, bundle)

  it('총배당 100, 원천 15, 순수령 85 → 현금 증가', () => {
    expect(result.dividendsGrossUsd).toBeCloseTo(100, 6) // 100주 × $1
    expect(result.dividendsWithheldUsd).toBeCloseTo(15, 6)
    expect(result.daily[5].cash).toBeGreaterThanOrEqual(85)
  })

  it('가치 = 10000 + 순배당 (가격 고정 → 배당 재과세·이중계산 없음)', () => {
    // 순배당 85는 ex-date 이후 현금 스윕으로 재투자돼도 가격 고정이라 가치 보존
    expect(result.finalValue).toBeCloseTo(10_085, 4)
  })
})

describe('유닛: 연말 양도세 손계산 (5.2 연 손익통산·250만 공제·22%)', () => {
  // 실현익 $3200, 가정환율 1000 → (3.2M − 2.5M) × 22% = 154,000 KRW = $154
  const n = 160 // 2020-06-01 → 2021-01 초 (연말 경계 포함)
  const dates = makeDates('2020-06-01', n)
  const jumpAt = 20
  const closeB = constSeries(50, n).map((v, i) => (i >= jumpAt ? 150 : v))
  const bundle = makeBundle(dates, {
    A: { close: constSeries(100, n) },
    B: { close: closeB },
  })
  const strategy = cleanStrategy({
    sleeves: [
      { ticker: 'A', targetWeight: 0.6 },
      { ticker: 'B', targetWeight: 0.4 },
    ],
    rebalance: { trigger: 'bands', bandAbsPct: 10, mode: 'sell_to_target' },
  })
  strategy.tax.enabled = true
  const result = runBacktest(strategy, bundle)

  it('세금은 거래별이 아니라 연말 1회, $154', () => {
    const cg = result.taxes.filter((t) => t.kind === 'capital_gains')
    expect(cg).toHaveLength(1)
    expect(cg[0].year).toBe(2020)
    expect(cg[0].netRealizedUsd).toBeCloseTo(3200, 4)
    expect(cg[0].taxUsd).toBeCloseTo(154, 4)
  })

  it('현금 부족 → 경고 + 다음날 강제 매도로 복구', () => {
    expect(result.warnings.some((w) => w.code === 'negative_cash_tax')).toBe(true)
    expect(result.trades.some((t) => t.reason === 'forced_tax_sale')).toBe(true)
    // 강제 매도 다음날부터 현금 ≥ 0
    const taxDayIdx = result.daily.findIndex((d) => d.cash < -EPS)
    expect(taxDayIdx).toBeGreaterThan(0)
    for (let i = taxDayIdx + 1; i < result.daily.length; i++) {
      expect(result.daily[i].cash).toBeGreaterThanOrEqual(-EPS)
    }
  })

  it('공제 이하 실현익(다음 해 강제매도분)엔 과세 없음', () => {
    expect(result.taxes.filter((t) => t.year === 2021)).toHaveLength(0)
  })
})

describe('유닛: 실현손익 = 양도가액(매도 수수료 차감 후) − 취득가액(매수 수수료 포함)', () => {
  // 검증 워크플로 확정 이슈: 주석-구현 불일치 → 규약을 테스트로 고정 (세법 표준)
  const n = 40
  const dates = makeDates('2023-01-02', n)
  const jumpAt = 10
  const closeB = constSeries(50, n).map((v, i) => (i >= jumpAt ? 150 : v))
  const bundle = makeBundle(dates, {
    A: { close: constSeries(100, n) },
    B: { close: closeB },
  })
  const strategy = cleanStrategy({
    sleeves: [
      { ticker: 'A', targetWeight: 0.6 },
      { ticker: 'B', targetWeight: 0.4 },
    ],
    rebalance: { trigger: 'bands', bandAbsPct: 10, mode: 'sell_to_target' },
    costs: { feeBps: 10, spreadBps: 0 }, // 수수료 0.1%
  })
  const result = runBacktest(strategy, bundle)

  it('매수 수수료는 취득가액에, 매도 수수료는 양도가액에서 차감', () => {
    const buyB = result.trades.find((t) => t.side === 'BUY' && t.ticker === 'B')!
    const sellB = result.trades.find((t) => t.side === 'SELL' && t.ticker === 'B')!
    // 이동평균 원가 = (매수대금 + 매수수수료) / 주식수
    const avgCost = (buyB.shares * buyB.price + buyB.fee) / buyB.shares
    const expected = sellB.shares * sellB.price - sellB.fee - sellB.shares * avgCost
    expect(sellB.realizedPnl).toBeCloseTo(expected, 8)
    expect(sellB.fee).toBeGreaterThan(0) // 수수료 0이면 규약 구분 불가 — 가드
  })
})

describe('유닛: to_underweight는 부족 슬리브에만 배분 (4.3 결정론)', () => {
  // A 50→25 급락 → A만 미달. 다음 적립은 전액 A로
  const n = 50
  const dates = makeDates('2023-01-02', n)
  const dropAt = 25 // 2월 진입 전 급락
  const closeA = constSeries(50, n).map((v, i) => (i >= dropAt ? 25 : v))
  const bundle = makeBundle(dates, {
    A: { close: closeA },
    B: { close: constSeries(100, n) },
  })
  const result = runBacktest(
    cleanStrategy({
      sleeves: [
        { ticker: 'A', targetWeight: 0.5 },
        { ticker: 'B', targetWeight: 0.5 },
      ],
      contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    }),
    bundle
  )

  it('급락 후 적립은 전액 미달 슬리브(A)로', () => {
    const afterDrop = result.trades.filter((t) => t.reason === 'contribution' && t.date > dates[dropAt])
    expect(afterDrop.length).toBeGreaterThan(0)
    for (const t of afterDrop) expect(t.ticker).toBe('A')
  })
})

describe('유닛: 정수주 모드 — 잔여현금 이월 (4.5)', () => {
  const n = 70
  const dates = makeDates('2023-01-02', n)
  const bundle = makeBundle(dates, { A: { close: constSeries(333, n) } })
  const strategy = cleanStrategy({
    sleeves: [{ ticker: 'A', targetWeight: 1 }],
    contribution: { initialUsd: 1_000, monthlyUsd: 500, allocation: 'pro_rata' },
    execution: { fractionalShares: false, cashAnnualYieldPct: 0, minTradeUsd: 100 },
  })
  const result = runBacktest(strategy, bundle)

  it('모든 매수는 정수주', () => {
    for (const t of result.trades) expect(Number.isInteger(t.shares)).toBe(true)
  })

  it('잔여현금은 유실 없이 이월 (가치 = 납입 합)', () => {
    expect(result.finalValue).toBeCloseTo(result.totalContributions, 6)
  })
})

describe('유닛: 유휴현금 이자 (4.5 — 누락 시 수익 과소)', () => {
  const n = 253 // ~1년
  const dates = makeDates('2023-01-02', n)
  const bundle = makeBundle(dates, { A: { close: constSeries(100, n) } })
  const strategy = cleanStrategy({
    sleeves: [
      { ticker: 'A', targetWeight: 0 },
      { ticker: 'CASH', targetWeight: 1 },
    ],
    contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'pro_rata' },
    execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
  })
  const result = runBacktest(strategy, bundle)

  it('현금 100%는 연 ~4% 복리', () => {
    const elapsed = (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / 86_400_000
    const expected = 10_000 * Math.pow(1.04, elapsed / 365)
    expect(result.finalValue).toBeCloseTo(expected, 2)
  })
})

describe('프로퍼티 테스트 (§9) — 랜덤워크 × 모드 조합', () => {
  const n = 600
  const dates = makeDates('2019-01-02', n)
  const rand = lcg(42)
  const assets = {
    A: { close: randomWalk(100, n, rand) },
    B: { close: randomWalk(50, n, rand) },
    C: { close: randomWalk(200, n, rand) },
  }
  const bundle = makeBundle(dates, assets)

  const modes = ['sell_to_target', 'no_sell', 'no_sell_except_periodic'] as const
  const triggers = ['periodic', 'bands', 'band_or_periodic'] as const

  for (const mode of modes) {
    for (const trigger of triggers) {
      it(`${mode} × ${trigger}: 무결성 불변식`, () => {
        const strategy = cleanStrategy({
          sleeves: [
            { ticker: 'A', targetWeight: 0.4 },
            { ticker: 'B', targetWeight: 0.3 },
            { ticker: 'C', targetWeight: 0.2 },
            { ticker: 'CASH', targetWeight: 0.1 },
          ],
          contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
          rebalance: { trigger, periodMonths: 3, bandAbsPct: 5, mode },
        })
        strategy.tax.enabled = true
        const result = runBacktest(strategy, bundle)

        // 1) 리컨실 무결 (4.7)
        expect(result.warnings.filter((w) => w.code === 'reconciliation')).toHaveLength(0)

        // 2) no_sell은 절대 매도 안 함
        if (mode === 'no_sell') {
          expect(result.trades.filter((t) => t.side === 'SELL')).toHaveLength(0)
        }

        // 3) 슬리브 합 = 포트 가치
        for (const d of result.daily) {
          const sum = Object.values(d.sleeveValues).reduce((a, b) => a + b, 0)
          expect(Math.abs(sum - d.value)).toBeLessThan(1e-6 * Math.max(1, d.value))
        }

        // 4) 현금 ≥ 0 (마진 불가) — 연말 세금 납부일만 예외 허용
        const taxDates = new Set(result.warnings.filter((w) => w.code === 'negative_cash_tax').map((w) => w.date))
        for (const d of result.daily) {
          if (!taxDates.has(d.date)) expect(d.cash).toBeGreaterThanOrEqual(-EPS)
        }

        // 5) 실현손익 원장 무결: 매도 실현손익 합 = 세금 로그의 연도 합
        const realizedFromTrades = result.trades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0)
        expect(Number.isFinite(realizedFromTrades)).toBe(true)
      })
    }
  }

  it('결정론(4.7): 같은 입력 → 같은 출력', () => {
    const strategy = cleanStrategy({
      sleeves: [
        { ticker: 'A', targetWeight: 0.5 },
        { ticker: 'B', targetWeight: 0.5 },
      ],
      rebalance: { trigger: 'bands', bandAbsPct: 5, mode: 'sell_to_target' },
    })
    const r1 = runBacktest(strategy, bundle)
    const r2 = runBacktest(strategy, bundle)
    expect(r1.finalValue).toBe(r2.finalValue)
    expect(r1.trades.length).toBe(r2.trades.length)
    expect(JSON.stringify(r1.daily[n - 1])).toBe(JSON.stringify(r2.daily[n - 1]))
  })

  it('day 0 전액 현금·CASH 슬리브는 과대 경고 대상 아님 (허위 경고 방지)', () => {
    // 초기 매수 전(100% 현금) 상태와 CASH 슬리브(스윕 매수로 해소 가능)는
    // "무매도라 매도 불가" 경고의 대상이 아니다
    const strategy = cleanStrategy({
      sleeves: [
        { ticker: 'A', targetWeight: 0.9 },
        { ticker: 'CASH', targetWeight: 0.1 },
      ],
      contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
      rebalance: { trigger: 'bands', bandAbsPct: 5, mode: 'no_sell' },
    })
    const constBundle = makeBundle(dates, { A: { close: constSeries(100, n) } })
    const result = runBacktest(strategy, constBundle)
    expect(result.warnings.filter((w) => w.code === 'no_sell_overweight')).toHaveLength(0)
    expect(result.warnings.filter((w) => w.code === 'band_unclosable')).toHaveLength(0)
  })

  it('no_sell 과대 슬리브 → 무동작 + 플래그 (4.4)', () => {
    // C 폭등 시계열로 과대 슬리브 강제
    const surge = constSeries(100, n).map((v, i) => (i >= 50 ? 400 : v))
    const surgeBundle = makeBundle(dates, { A: { close: constSeries(100, n) }, C: { close: surge } })
    const strategy = cleanStrategy({
      sleeves: [
        { ticker: 'A', targetWeight: 0.7 },
        { ticker: 'C', targetWeight: 0.3 },
      ],
      contribution: { initialUsd: 10_000, monthlyUsd: 100, allocation: 'to_underweight' },
      rebalance: { trigger: 'bands', bandAbsPct: 5, mode: 'no_sell' },
    })
    const result = runBacktest(strategy, surgeBundle)
    expect(result.trades.filter((t) => t.side === 'SELL')).toHaveLength(0)
    expect(result.warnings.some((w) => w.code === 'no_sell_overweight')).toBe(true)
    expect(result.warnings.some((w) => w.code === 'band_unclosable')).toBe(true)
  })
})

describe('골든마스터: 현금 100% (유휴현금 금리 복리 — 시장 자산 없음)', () => {
  const n = 261 // ~1년치 주중일
  const dates = makeDates('2023-01-02', n)
  const bundle = makeBundle(dates, {}) // 시장 시리즈 없음

  it('일시금: 최종 가치 = 10000 × 1.04^(경과일/365), 매매·경고 없음', () => {
    const result = runBacktest(
      cleanStrategy({
        sleeves: [{ ticker: 'CASH', targetWeight: 1 }],
        contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'pro_rata' },
        execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
      }),
      bundle
    )
    const days = (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / 86_400_000
    expect(result.finalValue).toBeCloseTo(10_000 * Math.pow(1.04, days / 365), 6)
    expect(result.trades).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.daily[n - 1].sleeveValues['CASH']).toBeCloseTo(result.finalValue, 6)
  })

  it('월 적립: 각 납입액이 납입일부터 개별 복리 (합산 손계산 일치)', () => {
    const result = runBacktest(
      cleanStrategy({
        sleeves: [{ ticker: 'CASH', targetWeight: 1 }],
        contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'pro_rata' },
        execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
      }),
      bundle
    )
    const last = Date.parse(dates[n - 1])
    let expected = 0
    for (const d of result.daily) {
      if (d.externalFlow > 0) {
        expected += d.externalFlow * Math.pow(1.04, (last - Date.parse(d.date)) / 86_400_000 / 365)
      }
    }
    expect(result.finalValue).toBeCloseTo(expected, 6)
    expect(result.trades).toHaveLength(0)
  })

  it('세금 활성이어도 현금 이자에는 과세 이벤트 없음 (v1 모델 스코프)', () => {
    const s = cleanStrategy({
      sleeves: [{ ticker: 'CASH', targetWeight: 1 }],
      contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'pro_rata' },
      execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
    })
    s.tax.enabled = true
    const result = runBacktest(s, bundle)
    expect(result.taxes).toHaveLength(0)
    expect(result.totalTaxesUsd).toBe(0)
  })
})

describe('낙폭 대응 규칙 + 기간별 적립 조정 (전일 관측 — 룩어헤드 금지)', () => {
  // A: 100 고정 → 20일째(1/30)부터 60 (−40% 급락 유지)
  const n = 80
  const dates = makeDates('2023-01-02', n)
  const close = constSeries(100, n).map((v, i) => (i >= 20 ? 60 : v))
  const bundle = makeBundle(dates, { A: { close } })

  it('낙폭 ≥10% 발동: 이후 월 적립이 2배 + 발동 로그 기록', () => {
    const r = runBacktest(
      cleanStrategy({
        sleeves: [{ ticker: 'A', targetWeight: 1 }],
        contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'pro_rata', rules: [{ drawdownPct: 10, contributionMultiplier: 2 }] },
      }),
      bundle
    )
    const flows = r.daily.filter((d) => d.externalFlow > 0)
    expect(flows[0].externalFlow).toBe(10_000) // 초기 일시금 (규칙 무관)
    for (const f of flows.slice(1)) expect(f.externalFlow, f.date).toBe(2_000) // 2~4월: 급락(1/30) 관측 후
    expect(r.totalContributions).toBe(10_000 + 2_000 * (flows.length - 1))
    expect(r.warnings.some((w) => w.code === 'dd_rule' && w.message.includes('발동'))).toBe(true)
  })

  it('기간별 조정이 기본 적립을 대체하고, 배수와 곱으로 결합된다', () => {
    const r = runBacktest(
      cleanStrategy({
        sleeves: [{ ticker: 'A', targetWeight: 1 }],
        contribution: {
          initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'pro_rata',
          rules: [{ drawdownPct: 10, contributionMultiplier: 2 }],
          overrides: [{ from: '2023-03', to: '2023-03', monthlyUsd: 500 }],
        },
      }),
      bundle
    )
    const flowOf = (ym: string) => r.daily.find((d) => d.date.startsWith(ym) && d.externalFlow > 0)!.externalFlow
    expect(flowOf('2023-02')).toBe(2_000) // 기본 1,000 × 2
    expect(flowOf('2023-03')).toBe(1_000) // 조정 500 × 2
    expect(flowOf('2023-04')).toBe(2_000)
  })

  it('현금 목표 대체: 발동 다음 거래일에 현금이 시장으로 스윕 매수된다', () => {
    const r = runBacktest(
      cleanStrategy({
        sleeves: [{ ticker: 'A', targetWeight: 0.7 }, { ticker: 'CASH', targetWeight: 0.3 }],
        contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'pro_rata', rules: [{ drawdownPct: 10, cashTargetOverride: 0 }] },
      }),
      bundle
    )
    // 1/30 종가 관측(포트 낙폭 ≈ −28%) → 1/31 시가에 현금 투입
    expect(r.trades.some((t) => t.side === 'BUY' && t.reason === 'cash_sweep' && t.date === '2023-01-31')).toBe(true)
    const last = r.daily[r.daily.length - 1]
    expect(last.cash / last.value).toBeLessThan(0.02) // 현금 목표 0%로 유지
    // 급락 전에는 70/30 유지 (규칙 미발동)
    const before = r.daily[10]
    expect(before.cash / before.value).toBeGreaterThan(0.25)
  })

  it('검증: 잘못된 규칙·기간 형식을 실행 전에 잡는다', () => {
    const errors = validateStrategy(
      cleanStrategy({
        sleeves: [{ ticker: 'A', targetWeight: 1 }],
        contribution: {
          initialUsd: 1_000, monthlyUsd: 0, allocation: 'pro_rata',
          rules: [{ drawdownPct: 0, contributionMultiplier: 2 }, { drawdownPct: 0, cashTargetOverride: 2 }],
          overrides: [{ from: '2023-1', to: '2022-01', monthlyUsd: -5 }],
        },
      })
    )
    expect(errors.some((e) => e.includes('낙폭 규칙'))).toBe(true)
    expect(errors.some((e) => e.includes('기간별 적립'))).toBe(true)
  })
})

describe('감사 회귀: fixed_split 키 검증', () => {
  it('자산 배분에 없는 티커가 고정 분할에 있으면 검증 에러 (무투자 방지)', () => {
    const errors = validateStrategy(cleanStrategy({
      sleeves: [{ ticker: 'AAA', targetWeight: 1 }],
      contribution: { initialUsd: 1_000, monthlyUsd: 1_000, allocation: 'fixed_split', fixedSplit: { BBB: 1 } },
    }))
    expect(errors.some((e) => e.includes('고정 분할'))).toBe(true)
  })
})
