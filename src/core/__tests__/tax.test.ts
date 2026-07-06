/**
 * 세금 엔진 손계산 대조 (§5, §9)
 */

import { describe, it, expect } from 'vitest'
import {
  computeCapitalGainsTax,
  computeCryptoTax,
  applyDividendWithholding,
  computeDividendComprehensiveTax,
  resolveTaxClass,
  defaultTaxConfig,
} from '../tax'
import type { TaxConfig } from '../types'

function cfg(overrides?: Partial<TaxConfig>): TaxConfig {
  return { ...defaultTaxConfig(), assumedUsdKrw: 1000, ...overrides }
}

describe('양도세 — 연 손익통산 (5.2)', () => {
  it('공제 이하 이익 → 세금 없음', () => {
    // $2,000 × 1000 = 2,000,000 KRW ≤ 2,500,000 공제
    expect(computeCapitalGainsTax(2000, cfg())).toBeNull()
  })

  it('손계산: $10,000 이익 → (10M − 2.5M) × 22% = 1,650,000 KRW = $1,650', () => {
    const t = computeCapitalGainsTax(10_000, cfg())!
    expect(t.taxUsd).toBeCloseTo(1650, 8)
    expect(t.deductionKrw).toBe(2_500_000)
  })

  it('연간 순손실 → 세금 없음 (손익통산)', () => {
    expect(computeCapitalGainsTax(-5000, cfg())).toBeNull()
  })

  it('비활성 시 null', () => {
    expect(computeCapitalGainsTax(10_000, cfg({ enabled: false }))).toBeNull()
  })
})

describe('가상자산 (5.4 — 유예 중, 기본 비활성)', () => {
  it('기본 설정에선 과세 안 함 ("현행법 확인" 플래그 케이스)', () => {
    expect(computeCryptoTax(100_000, cfg())).toBeNull()
  })

  it('활성 시 별도 그룹 과세', () => {
    const c = cfg()
    c.crypto.enabled = true
    const t = computeCryptoTax(10_000, c)!
    expect(t.kind).toBe('crypto')
    expect(t.taxUsd).toBeCloseTo(1650, 8)
  })
})

describe('배당 원천징수 (5.3)', () => {
  it('미국 15% 원천 → 순수령 85%', () => {
    const { netUsd, withheldUsd } = applyDividendWithholding(100, cfg())
    expect(netUsd).toBeCloseTo(85, 10)
    expect(withheldUsd).toBeCloseTo(15, 10)
  })

  it('세금 비활성 → 전액 수령', () => {
    expect(applyDividendWithholding(100, cfg({ enabled: false })).netUsd).toBe(100)
  })
})

describe('배당 종합과세 근사 (5.3)', () => {
  it('금융소득 2,000만 이하 → 추가 과세 없음', () => {
    // $10,000 배당 × 1000 = 10M KRW < 20M
    expect(computeDividendComprehensiveTax(10_000, cfg())).toBeNull()
  })

  it('임계 초과분에 (한계세율 − 원천세율) 근사 과세', () => {
    // $30,000 × 1000 = 30M KRW → 초과 10M × (26.4% − 15%) = 1,140,000 KRW = $1,140
    const t = computeDividendComprehensiveTax(30_000, cfg())!
    expect(t.taxUsd).toBeCloseTo(1140, 6)
  })

  it('기타 금융소득 가정 반영 — 임계 판정 이동', () => {
    const c = cfg()
    c.dividends.assumedOtherFinancialIncomeKrw = 15_000_000
    // 배당 10M + 기타 15M = 25M → 초과 5M 전액이 배당 귀속분
    const t = computeDividendComprehensiveTax(10_000, c)!
    expect(t.taxUsd).toBeCloseTo((5_000_000 * 0.114) / 1000, 6)
  })
})

describe('자산군 플러그인 (5.4)', () => {
  it('크립토 자동 분류, override 우선', () => {
    expect(resolveTaxClass('BTC-USD')).toBe('crypto')
    expect(resolveTaxClass('VOO')).toBe('foreign_equity')
    expect(resolveTaxClass('GLD', 'exempt')).toBe('exempt')
  })
})
