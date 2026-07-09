/**
 * 전략 프리셋 — UI 시작점. PRD §0 유니버스(VOO/QQQM/GLD/IEI/BTC-USD) 기반.
 */

import type { StrategyConfig } from './types'
import { defaultTaxConfig } from './tax'

/**
 * 전략 ID — UI 식별자(엔진 출력과 무관). 순번 카운터는 localStorage 복원 후
 * 리셋되어 기존 전략과 충돌하므로 UUID 사용.
 */
export function nextId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const baseDefaults = () => ({
  costs: { feeBps: 7, spreadBps: 3 },
  execution: { fractionalShares: true, cashAnnualYieldPct: 4.0, minTradeUsd: 100 },
  tax: defaultTaxConfig(),
})

export function presetSp500Dca(): StrategyConfig {
  return {
    id: nextId(),
    name: 'S&P500 월 적립 (벤치마크)',
    sleeves: [{ ticker: 'VOO', targetWeight: 1 }],
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'pro_rata' },
    rebalance: { trigger: 'none', mode: 'sell_to_target' },
    ...baseDefaults(),
  }
}

export function preset6040Monthly(): StrategyConfig {
  return {
    id: nextId(),
    name: '60/40 월간 리밸런싱',
    sleeves: [
      { ticker: 'VOO', targetWeight: 0.6 },
      { ticker: 'IEI', targetWeight: 0.4 },
    ],
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    rebalance: { trigger: 'periodic', periodMonths: 1, mode: 'sell_to_target' },
    ...baseDefaults(),
  }
}

export function presetBandNoSell(): StrategyConfig {
  return {
    id: nextId(),
    name: '멀티에셋 밴드5%p 무매도+반기 매도',
    sleeves: [
      { ticker: 'VOO', targetWeight: 0.5 },
      { ticker: 'QQQM', targetWeight: 0.2 },
      { ticker: 'GLD', targetWeight: 0.15 },
      { ticker: 'BTC-USD', targetWeight: 0.1 },
      { ticker: 'CASH', targetWeight: 0.05 },
    ],
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    rebalance: {
      trigger: 'band_or_periodic',
      periodMonths: 6,
      bandAbsPct: 5,
      mode: 'no_sell_except_periodic',
    },
    ...baseDefaults(),
  }
}

export function defaultStrategies(): StrategyConfig[] {
  return [presetSp500Dca(), preset6040Monthly(), presetBandNoSell()]
}

/**
 * 역사 구간 탐구용 프리셋 — 역사 연구 탭의 "이 구간을 백테스트" 버튼이 사용.
 * 전 자산이 월간 합성(-HIST)이라 1871년부터 어떤 구간이든 실행 가능.
 */
export function histEraStrategies(): StrategyConfig[] {
  const contribution = { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' as const }
  return [
    {
      id: nextId(),
      name: '주식 100% (역사)',
      sleeves: [{ ticker: 'SPX-HIST', targetWeight: 1 }],
      contribution,
      rebalance: { trigger: 'none', mode: 'sell_to_target' },
      ...baseDefaults(),
    },
    {
      id: nextId(),
      name: '60/40 (역사)',
      sleeves: [
        { ticker: 'SPX-HIST', targetWeight: 0.6 },
        { ticker: 'UST10-HIST', targetWeight: 0.4 },
      ],
      contribution,
      rebalance: { trigger: 'periodic', periodMonths: 3, mode: 'sell_to_target' },
      ...baseDefaults(),
    },
    {
      id: nextId(),
      name: '주식55/채권30/금15 (역사)',
      sleeves: [
        { ticker: 'SPX-HIST', targetWeight: 0.55 },
        { ticker: 'UST10-HIST', targetWeight: 0.3 },
        { ticker: 'GOLD-HIST', targetWeight: 0.15 },
      ],
      contribution,
      rebalance: { trigger: 'periodic', periodMonths: 3, mode: 'sell_to_target' },
      ...baseDefaults(),
    },
  ]
}

/** 새 커스텀 전략 뼈대 */
export function emptyStrategy(name: string): StrategyConfig {
  return {
    id: nextId(),
    name,
    sleeves: [
      { ticker: 'VOO', targetWeight: 0.8 },
      { ticker: 'CASH', targetWeight: 0.2 },
    ],
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    rebalance: { trigger: 'bands', bandAbsPct: 5, mode: 'sell_to_target' },
    ...baseDefaults(),
  }
}
