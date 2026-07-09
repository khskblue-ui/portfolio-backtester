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
  'w-full min-w-0 bg-white dark:bg-[#171c28] border border-[#d3d8e3] dark:border-[#363a45] dark:text-zinc-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2962ff]/30 focus:border-[#2962ff] dark:focus:border-[#3d74ff]'
export const selectCls =
  'bg-white dark:bg-[#171c28] border border-[#d3d8e3] dark:border-[#363a45] dark:text-zinc-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2962ff]/30 focus:border-[#2962ff] dark:focus:border-[#3d74ff]'
export const labelCls = 'text-xs font-medium text-zinc-600 dark:text-zinc-400'
/** 패널 카드 — 화이트 서피스 + 헤어라인 + 미세 그림자 (금융 터미널 대시보드 질감) */
export const cardCls =
  'bg-white dark:bg-[#1e222d] rounded-xl border border-[#e0e3eb] dark:border-[#2a2e39] shadow-[0_1px_3px_rgba(19,23,34,0.04)] dark:shadow-none'
/** 주 액션 버튼 — 프라이머리 블루 */
export const btnPrimaryCls = 'btn-primary'

/**
 * 중복 전략 이름을 "이름 (2)"식으로 구분한 표시 라벨 (id → 라벨).
 * recharts가 dataKey(이름)로 시리즈를 식별하므로 이름이 겹치면 뒤 전략이
 * 앞 전략의 선을 덮어쓴다 — 차트·툴팁·표 전부 이 라벨을 쓰면 충돌이 없다.
 */
export function uniqueRunLabels(runs: { config: { id: string; name: string } }[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const r of runs) counts.set(r.config.name, (counts.get(r.config.name) ?? 0) + 1)
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const r of runs) {
    const n = r.config.name
    if ((counts.get(n) ?? 0) > 1) {
      const k = (seen.get(n) ?? 0) + 1
      seen.set(n, k)
      out.set(r.config.id, `${n} (${k})`)
    } else out.set(r.config.id, n)
  }
  return out
}
/** 보조 버튼 — 화이트 서피스 + 헤어라인 */
export const btnGhostCls =
  'bg-white dark:bg-[#1e222d] border border-[#d3d8e3] dark:border-[#363a45] text-zinc-700 dark:text-zinc-300 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39]'
