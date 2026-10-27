/**
 * 앱 백테스트의 트라이팟 슬리브 = 연구 코드(scripts/tripod/lib.mjs) — 저장소 데이터 스냅숏으로 대조
 *
 * 1) 판정: 앱 이식(src/core/tripod.ts)이 연구 computeSignals와 1985~2026 전 구간에서 같은 배열
 * 2) 자산곡선: 같은 가상 상품(연구 buildProducts)을 앱 엔진에 넣으면 연구 simulate와 같은 곡선
 *    - 비용 0: 다음 날 종가(close1)·다음 날 시가(open1) 모두 부동소수 오차 안에서 일치
 *    - 편도 5bp: 연구는 현금 쪽 다리까지 회전율로 세어(Σ|Δw|) 현금 전환에 비용을 두 번 매긴다.
 *      앱 엔진은 실제 체결된 매도·매수에만 매기므로, 전환마다 그 차이를 곱해 보정한 값과 일치
 */

import { describe, it, expect } from 'vitest'
import { runBacktest } from '@/core/engine'
import { computeTripodSignals, alignVixToIndex } from '@/core/tripod'
import { defaultTaxConfig } from '@/core/tax'
import type { AlignedDataBundle, AlignedSeries, StrategyConfig, TripodState } from '@/core/types'
import { loadMarket, readBars, buildProducts, computeSignals, simulate, RULE_DEFAULT, COST_DEFAULT } from '../scripts/tripod/lib.mjs'

type Mkt = { dates: string[]; close: number[]; vix: number[]; irx: number[] } & Record<string, unknown>
type Prod = { full: Float64Array[]; night: Float64Array[] }
type Sim = { v: Float64Array; trades: { i: number; from: TripodState; to: TripodState }[] }

const END = '2026-08-28' // 연구 문서 기준 기간
const mkt = loadMarket({ end: END }) as Mkt
const sig = computeSignals(mkt, RULE_DEFAULT) as { target: (TripodState | null)[] }

describe('판정 이식 = 연구 computeSignals', () => {
  it('1985~2026 전 구간 목표 상태 배열이 같다 (VIX 정렬 포함)', () => {
    const full = loadMarket({ end: '9999-12-31' }) as Mkt
    const ndx = readBars('NDX') as { d: string; c: number }[]
    const vix = readBars('VIX') as { d: string; c: number }[]
    const vixAligned = alignVixToIndex(ndx.map((x) => x.d), vix.map((x) => x.d), vix.map((x) => x.c))
    const ours = computeTripodSignals(ndx.map((x) => x.d), ndx.map((x) => x.c), vixAligned)
    const theirs = computeSignals(full, RULE_DEFAULT) as { target: (TripodState | null)[]; regime: (string | null)[] }
    expect(ours.dates).toEqual(full.dates)
    expect(ours.target).toEqual(theirs.target)
    expect(ours.regime).toEqual(theirs.regime)
    // 판정이 실제로 세 상태를 모두 오간다 (비어 있는 비교 방지)
    const changes = ours.target.filter((t, i) => i > 0 && t !== ours.target[i - 1]).length
    expect(changes).toBeGreaterThan(200)
  })
})

/** 연구 가상 상품 계수 → 앱 번들 (QQQ-EXT·QLD-EXT·TQQQ-EXT, 시작가 100, 배당은 계수에 내재) */
function bundleFrom(prod: Prod, s: number, e: number, top: 2 | 3 = 3): AlignedDataBundle {
  const series: Record<string, AlignedSeries> = {}
  const keys = ['QQQ-EXT', 'QLD-EXT', 'TQQQ-EXT']
  keys.forEach((ticker, k) => {
    const kk = top === 2 && k === 2 ? 1 : k // 2배판 대조용: 3배 자리에 2배 상품을 둔다
    const close = [100]
    const open = [100]
    for (let i = s + 1; i <= e; i++) {
      open.push(close[close.length - 1] * prod.night[kk][i])
      close.push(close[close.length - 1] * prod.full[kk][i])
    }
    series[ticker] = { ticker, open, close, adjClose: [...close], divPerShare: new Array(close.length).fill(0) }
  })
  const dates = mkt.dates.slice(s, e + 1)
  return {
    dates,
    series,
    snapshotHash: 'research',
    firstDates: {},
    clipWarnings: [],
    tripod: { target: sig.target.slice(s, e + 1), lastSignalDate: dates[dates.length - 1] },
  }
}

function strategy(timing: 'next_open' | 'next_close', feeBps: number, ticker = 'TRIPOD'): StrategyConfig {
  return {
    id: 't',
    name: 't',
    sleeves: [{ ticker, targetWeight: 1 }],
    contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'to_underweight' },
    rebalance: { trigger: 'none', mode: 'sell_to_target' },
    costs: { feeBps, spreadBps: 0 },
    execution: { fractionalShares: true, cashAnnualYieldPct: 0, minTradeUsd: 100, timing },
    tax: { ...defaultTaxConfig(), enabled: false },
  }
}

// 비교 시작일: 2000년 이후 첫날 가운데 전날·당일 판정이 같은 단일 자산 상태(3배 또는 현금)인 날.
// 연구는 시작일에 이미 그 상태로 출발하고 앱은 다음 날 체결로 진입하므로, 1일차 종가부터 곡선을 맞춘다
const e = mkt.dates.length - 1
let s = mkt.dates.findIndex((d) => d >= '2000-01-03')
while (!(sig.target[s - 1] === sig.target[s] && (sig.target[s] === 'T3' || sig.target[s] === 'CASH'))) s++

// 금리 0 시장: 앱 엔진의 고정 유휴현금 금리(0%)와 연구의 현금 수익(^IRX)을 같게 맞춘다
const m0 = { ...mkt, irx: mkt.irx.map(() => 0) }
const prod0 = buildProducts(m0, COST_DEFAULT) as Prod

const curve = (vals: ArrayLike<number>) => Array.from(vals, (x) => x / vals[1])

describe('엔진 자산곡선 = 연구 simulate (2000~2026, 비용 0)', () => {
  for (const [timing, exec] of [['next_close', 'close1'], ['next_open', 'open1']] as const) {
    it(`${timing} = 연구 ${exec}`, () => {
      const res = runBacktest(strategy(timing, 0), bundleFrom(prod0, s, e))
      const ref = simulate(m0, prod0, sig, { startIdx: s, endIdx: e, exec, costBps: 0 }) as Sim
      const a = curve(res.daily.map((d) => d.value))
      const b = curve(ref.v)
      expect(a.length).toBe(b.length)
      let worst = 0
      for (let j = 1; j < a.length; j++) worst = Math.max(worst, Math.abs(a[j] / b[j] - 1))
      expect(worst).toBeLessThan(1e-9)
      // 전환 횟수·날짜도 같다 (앱의 첫 진입 제외)
      const ours = res.tripod!.switches.slice(1).map((x) => `${x.date}:${x.from}>${x.to}`)
      const theirs = ref.trades.map((t) => `${mkt.dates[t.i]}:${t.from}>${t.to}`)
      expect(ours).toEqual(theirs)
      expect(theirs.length).toBeGreaterThan(150)
    })
  }

  it('2배판 = 연구 규칙에서 3배 자리를 2배 상품으로 바꾼 곡선', () => {
    const res = runBacktest(strategy('next_close', 0, 'TRIPOD-2X'), bundleFrom(prod0, s, e))
    const prod2 = { full: [prod0.full[0], prod0.full[1], prod0.full[1], prod0.full[3]], night: [prod0.night[0], prod0.night[1], prod0.night[1], prod0.night[3]] }
    const ref = simulate(m0, prod2, sig, { startIdx: s, endIdx: e, exec: 'close1', costBps: 0 }) as Sim
    const a = curve(res.daily.map((d) => d.value))
    const b = curve(ref.v)
    let worst = 0
    for (let j = 1; j < a.length; j++) worst = Math.max(worst, Math.abs(a[j] / b[j] - 1))
    expect(worst).toBeLessThan(1e-9)
    expect(res.trades.some((t) => t.ticker === 'TQQQ-EXT')).toBe(false)
  })
})

describe('엔진 자산곡선 = 연구 simulate (편도 5bp, 비용 규약 차이 보정)', () => {
  it('전환마다 (엔진 체결 비용 ÷ 연구 회전율 비용)을 곱하면 매일 일치', () => {
    const f = 5 / 1e4
    const res = runBacktest(strategy('next_close', 5), bundleFrom(prod0, s, e))
    const ref = simulate(m0, prod0, sig, { startIdx: s, endIdx: e, exec: 'close1', costBps: 5 }) as Sim
    const engineFactor = (from: TripodState, to: TripodState) =>
      to === 'CASH' ? 1 - f : from === 'CASH' ? 1 / (1 + f) : (1 - f) / (1 + f)
    const fixAt = new Map<number, number>()
    for (const t of ref.trades) fixAt.set(t.i - s, engineFactor(t.from, t.to) / (1 - 2 * f))
    const a = curve(res.daily.map((d) => d.value))
    const b = curve(ref.v)
    let corr = 1
    let worst = 0
    for (let j = 2; j < a.length; j++) {
      corr *= fixAt.get(j) ?? 1
      worst = Math.max(worst, Math.abs(a[j] / (b[j] * corr) - 1))
    }
    expect(worst).toBeLessThan(1e-9)
    // 보정 크기 자체는 작다: 현금 전환 1회당 약 5bp
    expect(corr).toBeGreaterThan(1)
    expect(corr).toBeLessThan(1.1)
  })
})
