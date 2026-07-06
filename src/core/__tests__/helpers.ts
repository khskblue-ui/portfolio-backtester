/**
 * 테스트 헬퍼 — 합성 시계열 생성 (네트워크 없이 결정론 검증)
 */

import type { AlignedDataBundle, AlignedSeries, StrategyConfig } from '../types'

/** start부터 주말(토·일) 제외 n개 거래일 생성 */
export function makeDates(start: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(start + 'T00:00:00Z')
  while (dates.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

export interface SyntheticAsset {
  /** 종가 시계열 (dates와 같은 길이) */
  close: number[]
  /** 시가 — 생략 시 "전일 종가"(t+1 시가 체결 = t 종가 체결과 등가로 손계산 단순화) */
  open?: number[]
  /** 날짜 인덱스 → 주당 배당 */
  dividends?: Record<number, number>
}

export function makeBundle(dates: string[], assets: Record<string, SyntheticAsset>): AlignedDataBundle {
  const series: Record<string, AlignedSeries> = {}
  const firstDates: Record<string, string> = {}
  for (const [ticker, a] of Object.entries(assets)) {
    if (a.close.length !== dates.length) throw new Error(`${ticker} 길이 불일치`)
    const open = a.open ?? [a.close[0], ...a.close.slice(0, -1)]
    const divPerShare = new Array<number>(dates.length).fill(0)
    for (const [idx, amt] of Object.entries(a.dividends ?? {})) divPerShare[Number(idx)] = amt
    series[ticker] = { ticker, open, close: [...a.close], adjClose: [...a.close], divPerShare }
    firstDates[ticker] = dates[0]
  }
  return { dates, series, snapshotHash: 'test', firstDates, clipWarnings: [] }
}

/** 상수 가격 시계열 */
export function constSeries(price: number, n: number): number[] {
  return new Array<number>(n).fill(price)
}

/** 결정론 LCG (프로퍼티 테스트용 — Math.random 금지) */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** 랜덤워크 가격 (일 ±2% 균등) */
export function randomWalk(start: number, n: number, rand: () => number): number[] {
  const out = [start]
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + (rand() - 0.5) * 0.04))
  return out
}

/** 비용·세금 0의 기본 전략 (손계산 대조용) */
export function cleanStrategy(partial: Partial<StrategyConfig> & Pick<StrategyConfig, 'sleeves'>): StrategyConfig {
  return {
    id: 'test',
    name: 'test',
    contribution: { initialUsd: 10_000, monthlyUsd: 0, allocation: 'to_underweight' },
    rebalance: { trigger: 'none', mode: 'sell_to_target' },
    costs: { feeBps: 0, spreadBps: 0 },
    execution: { fractionalShares: true, cashAnnualYieldPct: 0, minTradeUsd: 100 },
    tax: {
      enabled: false,
      costBasisMethod: 'moving_average',
      assumedUsdKrw: 1000,
      capitalGains: { ratePct: 22, annualDeductionKrw: 2_500_000 },
      dividends: {
        usWithholdingPct: 15,
        comprehensiveThresholdKrw: 20_000_000,
        assumedOtherFinancialIncomeKrw: 0,
        assumedMarginalRatePct: 26.4,
      },
      crypto: { enabled: false, ratePct: 22, annualDeductionKrw: 2_500_000 },
    },
    ...partial,
  }
}
