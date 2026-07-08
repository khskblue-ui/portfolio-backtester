/**
 * public/data/history.json 무결성 — 리서치 검증 수치와의 드리프트 가드
 * (src/ 밖: 앱 tsconfig의 브라우저 타입 제약을 받지 않고 node fs 사용)
 */

import { describe, it, expect } from 'vitest'

describe('역사 차트 번들 (public/data/history.json) 무결성', async () => {
  const { readFileSync } = await import('node:fs')
  const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))

  it('시리즈 길이 일치 + 1900-01 시작 = 100', () => {
    const s = h.series
    expect(s.dates[0]).toBe('1900-01')
    expect(s.stock.length).toBe(s.dates.length)
    expect(s.bond.length).toBe(s.dates.length)
    expect(s.gold.length).toBe(s.dates.length)
    expect(s.stock[0]).toBeCloseTo(100, 6)
  })

  it('검증된 3대 구간이 리서치 수치와 일치 (데이터 드리프트 가드)', () => {
    interface Ep { peak: string; trough: string; recovery: string | null; depthPct: number; assets: Record<string, { toTroughPct: number | null; toRecoveryPct: number | null }> }
    const ep = (p: string): Ep => h.episodes.find((e: Ep) => e.peak.startsWith(p))
    const gd = ep('1929-09')
    expect(gd.depthPct).toBeLessThan(-70)
    expect(gd.recovery).toBe('1936-11')
    const stag = ep('1973-01')
    expect(stag.recovery).toBe('1985-01')
    expect(stag.depthPct).toBeCloseTo(-50.1, 0)
    const lost = ep('2000-08')
    expect(lost.recovery).toBe('2013-05')
    // WWI 재검증 확정치
    const wwi = ep('1916-11')
    expect(wwi).toBeDefined()
    expect(wwi.depthPct).toBeCloseTo(-47.1, 0)
  })

  it('구간별 자산 성과 존재 (1929 채권 플러스 / 1973 금 폭등 패턴)', () => {
    const gd = h.episodes.find((e: { peak: string }) => e.peak === '1929-09')
    expect(gd.assets.bond.toRecoveryPct).toBeGreaterThan(0)
    const stag = h.episodes.find((e: { peak: string }) => e.peak === '1973-01')
    expect(stag.assets.gold.toTroughPct).toBeGreaterThan(100)
  })
})
