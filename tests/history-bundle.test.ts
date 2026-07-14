/**
 * public/data/history.json 무결성 — 리서치 검증 수치와의 드리프트 가드
 * (src/ 밖: 앱 tsconfig의 브라우저 타입 제약을 받지 않고 node fs 사용)
 */

import { describe, it, expect } from 'vitest'

describe('역사 차트 번들 (public/data/history.json) 무결성', async () => {
  const { readFileSync } = await import('node:fs')
  const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))

  it('시리즈 길이 일치 + 1900-01 시작 = 100 + 2023-06 이후 연장', () => {
    const s = h.series
    expect(s.dates[0]).toBe('1900-01')
    for (const k of ['stock', 'bond', 'gold', 'bill', 'stockNom', 'bondNom', 'goldNom', 'billNom']) {
      expect(s[k].length, k).toBe(s.dates.length)
    }
    expect(s.stock[0]).toBeCloseTo(100, 6)
    // FRED/^SP500TR 연장이 적용됐는지 (Shiller 미러 한계 2023-06 초과)
    expect(h.meta.dataEnd > '2024-01').toBe(true)
  })

  it('P/E 시리즈 — 트레일링 vs 실현 선행이 2008-09 위기에서 정반대로 갈라짐', () => {
    const { dates } = h.series
    const { peTrail, peFwdReal } = h.macro
    expect(peTrail.length).toBe(dates.length)
    expect(peFwdReal.length).toBe(dates.length)
    const at = (arr: (number | null)[], ym: string) => arr[dates.indexOf(ym)]
    // 2008-03: 트레일링은 평범(~22), 실현 선행은 이익 절벽으로 극단(~192)
    expect(at(peTrail, '2008-03')).toBeGreaterThan(18)
    expect(at(peTrail, '2008-03')).toBeLessThan(26)
    expect(at(peFwdReal, '2008-03')).toBeGreaterThan(150)
    // 2009-03: 트레일링은 착시로 극단(~110), 실현 선행은 헐값(~12)
    expect(at(peTrail, '2009-03')).toBeGreaterThan(60)
    expect(at(peFwdReal, '2009-03')).toBeLessThan(15)
    // 닷컴 고점 2000-08: 실현 선행 ~48 (트레일링 28보다 훨씬 비싸게 지불)
    expect(at(peFwdReal, '2000-08')).toBeGreaterThan(40)
    expect(at(peFwdReal, '2000-08')).toBeLessThan(55)
    // 사후 지표 경계: 이익 데이터 끝(2023-06)에서 12개월 전 이후는 정의상 null
    expect(at(peFwdReal, '2022-06')).not.toBeNull()
    expect(at(peFwdReal, '2022-07')).toBeNull()
    expect(at(peTrail, '2023-06')).not.toBeNull()
    expect(at(peTrail, '2023-07')).toBeNull()
  })

  it('현금(단기국채) 시리즈 — 1929 디플레 실질 플러스 / 1946 금융억압 실질 마이너스', () => {
    interface Ep { peak: string; assets: Record<string, { toTroughPct: number | null; toRecoveryPct: number | null } | null> }
    const ep = (p: string): Ep => h.episodes.find((e: Ep) => e.peak.startsWith(p))
    expect(ep('1929-09').assets.bill!.toTroughPct).toBeGreaterThan(20)
    expect(ep('1946-04').assets.bill!.toRecoveryPct).toBeLessThan(-15)
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
