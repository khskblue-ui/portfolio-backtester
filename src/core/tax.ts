/**
 * 한국 세금 엔진 (PRD §5) — 순수 함수 모음
 *
 * ⚠ v1 한계(5.5): 실제 해외주식 양도세는 원화 환산 손익(FX 포함) 기준.
 * v1은 USD 손익 × 가정 환율 근사 — UI에 상시 경고 노출.
 *
 * 핵심 규칙(5.2): 양도세는 거래별이 아니라 "연간 실현손익 통산 − 250만 공제(연 1회) → 22%".
 * 거래마다 매기면 틀림. 손실 이월 없음.
 */

import type { TaxConfig, TaxAssetClass, TaxLogEntry } from './types'

/**
 * 연간 양도세 (해외주식 그룹 — 5.2)
 * @param netRealizedUsd 해당 연도 그룹 내 실현손익 통산 (손실 상계 후)
 * @returns 납부 세액 (USD, 음수 없음)
 */
export function computeCapitalGainsTax(netRealizedUsd: number, tax: TaxConfig): TaxLogEntry | null {
  if (!tax.enabled) return null
  const gainKrw = netRealizedUsd * tax.assumedUsdKrw
  const taxableKrw = Math.max(0, gainKrw - tax.capitalGains.annualDeductionKrw)
  const taxUsd = (taxableKrw * (tax.capitalGains.ratePct / 100)) / tax.assumedUsdKrw
  if (taxUsd <= 0) return null
  return {
    year: 0, // 호출자가 채움
    kind: 'capital_gains',
    netRealizedUsd,
    deductionKrw: Math.min(Math.max(0, gainKrw), tax.capitalGains.annualDeductionKrw),
    taxUsd,
  }
}

/**
 * 가상자산 양도세 (5.4) — 과세 반복 유예 중, enabled=false 기본.
 * 시행 시 세율·공제 별도 그룹으로 통산 (해외주식과 손익통산 불가).
 */
export function computeCryptoTax(netRealizedUsd: number, tax: TaxConfig): TaxLogEntry | null {
  if (!tax.enabled || !tax.crypto.enabled) return null
  const gainKrw = netRealizedUsd * tax.assumedUsdKrw
  const taxableKrw = Math.max(0, gainKrw - tax.crypto.annualDeductionKrw)
  const taxUsd = (taxableKrw * (tax.crypto.ratePct / 100)) / tax.assumedUsdKrw
  if (taxUsd <= 0) return null
  return {
    year: 0,
    kind: 'crypto',
    netRealizedUsd,
    deductionKrw: Math.min(Math.max(0, gainKrw), tax.crypto.annualDeductionKrw),
    taxUsd,
  }
}

/**
 * 배당 원천징수 (5.3) — 수령 시점 차감.
 * 미국 15% 원천 → 외국납부세액공제로 국내 분리과세(≤2천만) 추가징수 없음 근사.
 * @returns 순수령액 (USD)
 */
export function applyDividendWithholding(
  grossUsd: number,
  tax: TaxConfig
): { netUsd: number; withheldUsd: number } {
  if (!tax.enabled) return { netUsd: grossUsd, withheldUsd: 0 }
  const withheldUsd = grossUsd * (tax.dividends.usWithholdingPct / 100)
  return { netUsd: grossUsd - withheldUsd, withheldUsd }
}

/**
 * 연말 배당 종합과세 근사 (5.3)
 *
 * (포트 배당 + 가정 기타 금융소득) > 2,000만 KRW → 초과분에
 * max(0, 한계세율 − 원천세율) 추가 과세. ⚠ 비교과세 정밀 로직이 아닌 근사임(명시).
 */
export function computeDividendComprehensiveTax(
  annualGrossDividendsUsd: number,
  tax: TaxConfig
): TaxLogEntry | null {
  if (!tax.enabled || annualGrossDividendsUsd <= 0) return null
  const divKrw = annualGrossDividendsUsd * tax.assumedUsdKrw
  const totalFinancialIncomeKrw = divKrw + tax.dividends.assumedOtherFinancialIncomeKrw
  if (totalFinancialIncomeKrw <= tax.dividends.comprehensiveThresholdKrw) return null

  // 임계 초과분 중 "포트폴리오 배당이 차지하는 부분"만 추가 과세 대상
  const overKrw = Math.min(divKrw, totalFinancialIncomeKrw - tax.dividends.comprehensiveThresholdKrw)
  const extraRatePct = Math.max(0, tax.dividends.assumedMarginalRatePct - tax.dividends.usWithholdingPct)
  const taxUsd = (overKrw * (extraRatePct / 100)) / tax.assumedUsdKrw
  if (taxUsd <= 0) return null
  return {
    year: 0,
    kind: 'dividend_comprehensive',
    netRealizedUsd: annualGrossDividendsUsd,
    deductionKrw: 0,
    taxUsd,
  }
}

/** 티커의 세금 자산군 판별 (5.4 플러그인) — 명시 override 없으면 크립토만 자동 분류 */
export function resolveTaxClass(ticker: string, override?: TaxAssetClass): TaxAssetClass {
  if (override) return override
  if (ticker.toUpperCase().endsWith('-USD')) return 'crypto'
  return 'foreign_equity'
}

/** 기본 세금 설정 — 2026년 기준 근사값. "현행법 확인" 플래그는 UI에서 상시 노출 */
export function defaultTaxConfig(): TaxConfig {
  return {
    enabled: true,
    costBasisMethod: 'moving_average',
    assumedUsdKrw: 1400,
    capitalGains: {
      ratePct: 22,
      annualDeductionKrw: 2_500_000,
    },
    dividends: {
      usWithholdingPct: 15,
      comprehensiveThresholdKrw: 20_000_000,
      assumedOtherFinancialIncomeKrw: 0,
      assumedMarginalRatePct: 26.4,
    },
    crypto: {
      enabled: false,
      ratePct: 22,
      annualDeductionKrw: 2_500_000,
    },
  }
}
