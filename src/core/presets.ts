/**
 * 전략 프리셋 — UI 시작점. PRD §0 유니버스(VOO/QQQM/GLD/IEI/BTC-USD) 기반.
 */

import type { StrategyConfig } from './types'
import { defaultTaxConfig } from './tax'

/**
 * 전략 ID — UI 식별자(엔진 출력과 무관). 순번 카운터는 localStorage 복원 후
 * 리셋되어 기존 전략과 충돌하므로 UUID 사용.
 */
function nextId(): string {
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
