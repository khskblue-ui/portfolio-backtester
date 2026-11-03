/**
 * UI 공통 — 팔레트·포맷터·스타일 토큰·공통 설정 모델
 */

import { defaultTaxConfig, type StrategyConfig, type ContributionOverride } from '@/core'

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
  /** 유휴현금 금리 원천 — tbill: 그날 미국 단기국채(^IRX) 실제 금리, fixed: cashYieldPct 고정 */
  cashYieldMode: 'tbill' | 'fixed'
  cashYieldPct: number
  fractionalShares: boolean
  taxEnabled: boolean
  assumedUsdKrw: number
  marginalRatePct: number
  otherFinancialIncomeKrw: number
  cryptoTaxEnabled: boolean
  startDate: string
  endDate: string
  /** 기간별 월 적립 조정 (고급) — 전 전략 동일 적용 */
  contributionOverrides: ContributionOverride[]
}

export const defaultSharedSettings = (): SharedSettings => ({
  initialUsd: 10_000,
  monthlyUsd: 1_000,
  feeBps: 7,
  spreadBps: 3,
  cashYieldMode: 'tbill',
  cashYieldPct: 4,
  fractionalShares: true,
  taxEnabled: true,
  assumedUsdKrw: 1400,
  marginalRatePct: 26.4,
  otherFinancialIncomeKrw: 0,
  cryptoTaxEnabled: false,
  startDate: '',
  endDate: '',
  contributionOverrides: [],
})

/**
 * 저장본·가져온 파일의 공통 설정을 현재 스키마로 맞춘다 — 없는 필드는 기본값.
 * 유휴현금 금리 원천(cashYieldMode)이 생기기 전에 고정 금리를 직접 바꿔 둔 사용자(기본 4% 아님)는
 * 그 선택을 존중해 고정 모드로 두고, 나머지는 실제 단기국채 금리(기본)로 옮긴다
 */
export function normalizeShared(raw: Partial<SharedSettings> | null | undefined): SharedSettings {
  const base = defaultSharedSettings()
  const merged = { ...base, ...(raw ?? {}) }
  if (raw?.cashYieldMode !== 'tbill' && raw?.cashYieldMode !== 'fixed') {
    merged.cashYieldMode = raw?.cashYieldPct != null && raw.cashYieldPct !== base.cashYieldPct ? 'fixed' : 'tbill'
  }
  return merged
}

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
    contribution: { ...s.contribution, initialUsd: g.initialUsd, monthlyUsd: g.monthlyUsd, overrides: g.contributionOverrides },
    costs: { feeBps: g.feeBps, spreadBps: g.spreadBps },
    execution: {
      ...s.execution,
      fractionalShares: g.fractionalShares,
      cashAnnualYieldPct: g.cashYieldPct,
      cashYieldSource: g.cashYieldMode,
    },
    tax,
  }
}

export const fmtUsd = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
/** 손익용 부호 표기: +$1,234 / −$1,234 */
export const fmtSignedUsd = (v: number) =>
  `${v < 0 ? '−' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
/**
 * 표 셀·라벨용 줄바꿈 정리: 짧은 괄호 묶음 "(1차대전 인플레)" 안의 공백을
 * NBSP로 바꿔 괄호가 줄에 걸쳐 갈라지지 않게 한다. 긴 괄호(13자 이상)는
 * 통째로 묶으면 오히려 넘치므로 그대로 둔다. 본문 문단이 아닌 컴팩트한
 * 라벨/셀에만 쓸 것.
 */
export const nbspShortParens = (text: string, maxLen = 12) =>
  text.replace(/\(([^()]+)\)/g, (m, inner: string) =>
    inner.length <= maxLen ? `(${inner.replace(/ /g, '\u00A0')})` : m,
  )

export const fmtPct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')

/** 최장 회복기간 표기 — 기간 끝까지 회복하지 못한 구간이면 '미회복'을 붙인다 */
export const fmtUnderwater = (m: { maxUnderwaterDays: number; maxUnderwaterOngoing?: boolean }) =>
  `${m.maxUnderwaterDays}${m.maxUnderwaterOngoing ? '\u00a0미회복' : ''}`

/** 연도별 수익률 라벨 — 시작·끝 해가 1년이 안 되면 잰 달을 붙인다 (예: 2021 (8~12월)) */
export function yearLabel(a: { year: number; from?: string; to?: string }): string {
  if (!a.from || !a.to) return String(a.year)
  const startMonth = Number(a.from.slice(0, 4)) === a.year ? Number(a.from.slice(5, 7)) : 1
  const endMonth = Number(a.to.slice(5, 7))
  return startMonth > 1 || endMonth < 12 ? `${a.year} (${startMonth}~${endMonth}월)` : String(a.year)
}

/** 세금 드래그(세전 TWRR − 세후 TWRR, %p/년) 표기 — 세후가 더 높게 나온 경로 효과면 + 부호 */
export const fmtDrag = (drag: number) => `${drag >= 0 ? '−' : '+'}${Math.abs(drag).toFixed(2)}%p/년`

/**
 * 세전·세후 실행에서 낙폭 규칙 발동 구간이 달랐는가 — 원천징수 몇 달러 차이로 문턱을 넘는 날이 달라지면 두 실행의 매매가
 * 갈라져, 세전−세후 차이에 세금이 아닌 경로 효과가 섞인다
 */
export function rulePathsDiffer(a: { ruleEpisodes: unknown[] }, b: { ruleEpisodes: unknown[] }): boolean {
  return JSON.stringify(a.ruleEpisodes) !== JSON.stringify(b.ruleEpisodes)
}

/** 거래 사유 표기 (엔진 TradeLogEntry.reason) */
const TRADE_REASON_LABEL: Record<string, string> = {
  initial: '초기 매수',
  contribution: '적립',
  rebalance: '리밸런싱',
  cash_sweep: '배당·잔액 재투자',
  dd_rule: '낙폭 규칙 투입',
  signal: '신호 전환',
  forced_tax_sale: '세금 납부 매도',
}

/** 거래 횟수의 사유별 구성 — "초기 매수 3 · 배당·잔액 재투자 6" */
export function tradeReasonSummary(trades: { reason: string }[]): string {
  const count = new Map<string, number>()
  for (const t of trades) count.set(t.reason, (count.get(t.reason) ?? 0) + 1)
  return Object.keys(TRADE_REASON_LABEL)
    .filter((k) => count.has(k))
    .map((k) => `${TRADE_REASON_LABEL[k]} ${count.get(k)}`)
    .join(' · ')
}
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
/** 유기체 문법의 타일(홈·가이드북·역사·신호) — 카드 선 대신 옅은 반투명 바탕으로만 구분.
 *  백테스트(도구 UI)는 cardCls의 경계선 문법을 유지한다 */
export const tileCls = 'bg-white/70 dark:bg-white/[0.045] rounded-2xl'
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
