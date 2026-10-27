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

/**
 * 트라이팟 전략 — 체결은 규칙 원안대로 다음 거래일 종가.
 * 섞는 자산이 있으면 적립은 부족한 쪽부터, 비중은 1년마다 목표로 되돌린다
 */
export function presetTripod(
  name = '트라이팟 100%',
  sleeves: StrategyConfig['sleeves'] = [{ ticker: 'TRIPOD', targetWeight: 1 }]
): StrategyConfig {
  const d = baseDefaults()
  const mixed = sleeves.length > 1
  return {
    id: nextId(),
    name,
    sleeves,
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    rebalance: mixed ? { trigger: 'periodic', periodMonths: 12, mode: 'sell_to_target' } : { trigger: 'none', mode: 'sell_to_target' },
    ...d,
    execution: { ...d.execution, timing: 'next_close' },
  }
}

/**
 * 트라이팟 비교 세트 — 트라이팟 탭의 "백테스트에서 비교하기" 버튼이 사용.
 * 같은 적립·기간·세금 가정에서 트라이팟·2배판·현금 혼합을 QQQ 보유·QQQ+현금과 견준다. 비교가 규칙 차이로 흐려지지 않게
 * 다섯 전략 모두 다음 거래일 종가 체결, 적립은 부족한 쪽부터, 현금 혼합 둘은 똑같이 연 1회 리밸런싱으로 맞췄다.
 * QQQ는 1999-03 상장 전을 나스닥100 지수 합성으로 이은 QQQ-EXT라서 세트 전체가 1990년부터 돈다
 */
export function tripodComparisonStrategies(): StrategyConfig[] {
  const d = baseDefaults()
  const mk = (name: string, sleeves: StrategyConfig['sleeves'], yearly: boolean): StrategyConfig => ({
    id: nextId(),
    name,
    sleeves,
    contribution: { initialUsd: 10_000, monthlyUsd: 1_000, allocation: 'to_underweight' },
    rebalance: yearly ? { trigger: 'periodic', periodMonths: 12, mode: 'sell_to_target' } : { trigger: 'none', mode: 'sell_to_target' },
    ...d,
    execution: { ...d.execution, timing: 'next_close' },
  })
  return [
    mk('트라이팟 100%', [{ ticker: 'TRIPOD', targetWeight: 1 }], false),
    mk('트라이팟 2배판 100%', [{ ticker: 'TRIPOD-2X', targetWeight: 1 }], false),
    mk('트라이팟 60 + 현금 40 (연 1회 리밸런싱)', [{ ticker: 'TRIPOD', targetWeight: 0.6 }, { ticker: 'CASH', targetWeight: 0.4 }], true),
    mk('QQQ 100%', [{ ticker: 'QQQ-EXT', targetWeight: 1 }], false),
    mk('QQQ 60 + 현금 40 (연 1회 리밸런싱)', [{ ticker: 'QQQ-EXT', targetWeight: 0.6 }, { ticker: 'CASH', targetWeight: 0.4 }], true),
  ]
}
