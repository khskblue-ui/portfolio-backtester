/**
 * UI 공통 — 팔레트·포맷터·스타일 토큰·공통 설정 모델
 */

import { defaultTaxConfig, type StrategyConfig } from '@/core'

/** 검증된 카테고리컬 팔레트 (라이트/다크 별도 스텝, 순서 고정 — 순환 금지) */
export const SERIES_COLORS_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948']
export const SERIES_COLORS_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767']
export const MAX_STRATEGIES = SERIES_COLORS_LIGHT.length

/**
 * 전 전략 공통 설정 (§7: 같은 데이터·동일 납입 스케줄·동일 비용/세금 가정 —
 * 규칙만 다르게 해야 사과 대 사과 비교)
 */
export interface SharedSettings {
  initialUsd: number
  monthlyUsd: number
  feeBps: number
  spreadBps: number
  cashYieldPct: number
  fractionalShares: boolean
  taxEnabled: boolean
  assumedUsdKrw: number
  marginalRatePct: number
  otherFinancialIncomeKrw: number
  cryptoTaxEnabled: boolean
  startDate: string
}

export const defaultSharedSettings = (): SharedSettings => ({
  initialUsd: 10_000,
  monthlyUsd: 1_000,
  feeBps: 7,
  spreadBps: 3,
  cashYieldPct: 4,
  fractionalShares: true,
  taxEnabled: true,
  assumedUsdKrw: 1400,
  marginalRatePct: 26.4,
  otherFinancialIncomeKrw: 0,
  cryptoTaxEnabled: false,
  startDate: '',
})

/** 공통 설정을 전략에 주입 — 실행 직전에 적용해 전략 간 가정 불일치를 차단 */
export function applyShared(s: StrategyConfig, g: SharedSettings): StrategyConfig {
  const tax = defaultTaxConfig()
  tax.enabled = g.taxEnabled
  tax.assumedUsdKrw = g.assumedUsdKrw
  tax.dividends.assumedMarginalRatePct = g.marginalRatePct
  tax.dividends.assumedOtherFinancialIncomeKrw = g.otherFinancialIncomeKrw
  tax.crypto.enabled = g.cryptoTaxEnabled
  return {
    ...s,
    contribution: { ...s.contribution, initialUsd: g.initialUsd, monthlyUsd: g.monthlyUsd },
    costs: { feeBps: g.feeBps, spreadBps: g.spreadBps },
    execution: {
      ...s.execution,
      fractionalShares: g.fractionalShares,
      cashAnnualYieldPct: g.cashYieldPct,
    },
    tax,
  }
}

export const fmtUsd = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
export const fmtPct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')

export const inputCls =
  'w-full min-w-0 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
export const selectCls =
  'border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
export const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-300'
export const cardCls =
  'bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700'
