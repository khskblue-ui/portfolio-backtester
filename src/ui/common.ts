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
  endDate: string
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
  endDate: '',
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
/** 손익용 부호 표기: +$1,234 / −$1,234 */
export const fmtSignedUsd = (v: number) =>
  `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
export const fmtPct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')
export const fmtSignedPct = (v: number) =>
  Number.isFinite(v) ? `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}%` : '—'

export const inputCls =
  'w-full min-w-0 bg-white dark:bg-[#1b2029] border border-[#d5cdb9] dark:border-[#2e3646] dark:text-zinc-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 focus:border-zinc-500 dark:focus:ring-zinc-400'
export const selectCls =
  'bg-white dark:bg-[#1b2029] border border-[#d5cdb9] dark:border-[#2e3646] dark:text-zinc-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 focus:border-zinc-500 dark:focus:ring-zinc-400'
export const labelCls = 'text-xs font-medium text-zinc-600 dark:text-zinc-400'
export const cardCls =
  'bg-[#fbfaf5] dark:bg-[#161a22] rounded-md border border-[#ddd6c4] dark:border-[#262c39]'
/** 주 액션 버튼 — 잉크 블랙 (다크: 웜 화이트). 파란 기본값 탈피 */
export const btnPrimaryCls = 'btn-primary'
/** 보조 버튼 — 헤어라인 */
export const btnGhostCls =
  'border border-[#cfc7b2] dark:border-[#2e3646] text-zinc-700 dark:text-zinc-300 hover:bg-[#eee9db] dark:hover:bg-[#1e242f]'
