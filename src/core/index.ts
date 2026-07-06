/**
 * 설정형 포트폴리오 백테스터 — 공개 API (PRD v1.1)
 *
 * 파이프라인(§8): [Data] → [Engine] → [Metrics] → [Compare]
 */

import type { StrategyConfig, AlignedDataBundle, BacktestResult, Metrics } from './types'
import { runBacktest } from './engine'
import { computeMetrics } from './metrics'

export * from './types'
export { loadDataBundle, alignToCommonCalendar, fetchDailySeries, isCryptoTicker } from './data'
export { runBacktest, validateStrategy } from './engine'
export { computeMetrics, xirr } from './metrics'
export { defaultTaxConfig } from './tax'
export { ASSET_CATALOG, assetCautionFor, type CatalogEntry, type AssetGroup } from './catalog'
export * from './presets'

export interface StrategyRun {
  config: StrategyConfig
  /** 세후 실행 (세금 활성 시) — 세금이 복리에 미치는 드래그 반영 */
  postTax: { result: BacktestResult; metrics: Metrics }
  /** 세전 실행 (동일 설정, 세금만 비활성) — 세금 드래그 분리 표시용 */
  preTax: { result: BacktestResult; metrics: Metrics }
}

/**
 * 다중 전략 비교 (§7) — 같은 데이터·같은 현금흐름, 규칙만 다르게.
 * 각 전략을 세전/세후 2회 실행해 세금 드래그를 분리해 보여준다(5.5 핵심 가치).
 */
export function runComparison(strategies: StrategyConfig[], bundle: AlignedDataBundle): StrategyRun[] {
  return strategies.map((config) => {
    const postResult = runBacktest(config, bundle)
    const preConfig: StrategyConfig = { ...config, tax: { ...config.tax, enabled: false } }
    const preResult = runBacktest(preConfig, bundle)
    return {
      config,
      postTax: { result: postResult, metrics: computeMetrics(postResult) },
      preTax: { result: preResult, metrics: computeMetrics(preResult) },
    }
  })
}
