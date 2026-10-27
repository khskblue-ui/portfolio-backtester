import { describe, it, expect } from 'vitest'
import { normalizeShared, defaultSharedSettings, applyShared } from '@/ui/common'
import { presetTripod } from '@/core'

describe('공통 설정 정규화 (유휴현금 금리 원천 추가에 따른 이전 저장본 이전)', () => {
  it('새 사용자 기본값은 단기국채 실제 금리', () => {
    expect(defaultSharedSettings().cashYieldMode).toBe('tbill')
  })
  it('이전 저장본: 기본 4%를 그대로 두었으면 실제 금리, 직접 바꿨으면 고정 모드로 존중', () => {
    const old = { ...defaultSharedSettings() } as Partial<ReturnType<typeof defaultSharedSettings>>
    delete old.cashYieldMode
    expect(normalizeShared(old).cashYieldMode).toBe('tbill')
    expect(normalizeShared({ ...old, cashYieldPct: 2.5 }).cashYieldMode).toBe('fixed')
    expect(normalizeShared({ ...old, cashYieldPct: 2.5, cashYieldMode: 'tbill' }).cashYieldMode).toBe('tbill')
    expect(normalizeShared(null)).toEqual(defaultSharedSettings())
  })
  it('공통 설정을 전략에 넣어도 전략의 체결 시점은 유지되고 금리 원천이 전달된다', () => {
    const s = applyShared(presetTripod(), defaultSharedSettings())
    expect(s.execution.timing).toBe('next_close')
    expect(s.execution.cashYieldSource).toBe('tbill')
  })
})
