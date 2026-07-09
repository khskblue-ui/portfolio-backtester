/**
 * "지금은?" 신호 판정 검증 — 규칙 경계 + 실제 번들 데이터에 대한 정합성
 */

import { describe, it, expect } from 'vitest'
import { assessNow } from '../src/ui/nowSignals'

function mkHistory(over: {
  stock?: number[]
  cpiYoY?: (number | null)[]
  gs10?: (number | null)[]
  cape?: (number | null)[]
  tbill3m?: (number | null)[]
}) {
  const n = over.stock?.length ?? 24
  const dates = Array.from({ length: n }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
  const stock = over.stock ?? Array.from({ length: n }, (_, i) => 100 + i)
  const cpiYoY = over.cpiYoY ?? Array(n).fill(2.0)
  const gs10 = over.gs10 ?? Array(n).fill(4.0)
  const cape = over.cape ?? Array(n).fill(20)
  const realRate10 = gs10.map((g, i) => (g != null && cpiYoY[i] != null ? (g as number) - (cpiYoY[i] as number) : null))
  return {
    series: { dates, stock },
    macro: { cpiYoY, gs10, realRate10, cape, capeProxy: cape, tbill3m: over.tbill3m ?? Array(n).fill(3.5) },
    meta: { dataEnd: dates[n - 1] },
  }
}

describe('신호 규칙 경계', () => {
  it('신고점 + 저밸류 + 저인플레 = 전부 양호', () => {
    const a = assessNow(mkHistory({}))
    expect(a.signals.find((s) => s.key === 'market')!.level).toBe('ok')
    expect(a.signals.find((s) => s.key === 'valuation')!.level).toBe('ok')
    expect(a.signals.find((s) => s.key === 'inflation')!.level).toBe('ok')
    expect(a.headline).toContain('뚜렷하지 않음')
  })

  it('실질 낙폭 −25% 초과 = 시장 경계 (구간 검출과 동일 잣대)', () => {
    const stock = [...Array(12).fill(100), ...Array(12).fill(70)] // −30%
    const a = assessNow(mkHistory({ stock }))
    expect(a.signals.find((s) => s.key === 'market')!.level).toBe('alert')
    expect(a.headline).toContain('한복판')
  })

  it('CAPE 32 이상 = 경계 (1929 시작 수준), 24 이상 = 주의 (1968 수준)', () => {
    expect(assessNow(mkHistory({ cape: Array(24).fill(33) })).signals.find((s) => s.key === 'valuation')!.level).toBe('alert')
    expect(assessNow(mkHistory({ cape: Array(24).fill(25) })).signals.find((s) => s.key === 'valuation')!.level).toBe('watch')
  })

  it('인플레 5% 이상 = 경계, 3%+상승 추세 = 주의 (1968년형 이륙)', () => {
    expect(assessNow(mkHistory({ cpiYoY: Array(24).fill(5.5) })).signals.find((s) => s.key === 'inflation')!.level).toBe('alert')
    const rising = [...Array(18).fill(2.2), 2.5, 2.8, 3.0, 3.2, 3.3, 3.4]
    const a = assessNow(mkHistory({ cpiYoY: rising }))
    expect(a.signals.find((s) => s.key === 'inflation')!.level).toBe('watch')
    expect(a.signals.find((s) => s.key === 'inflation')!.value).toContain('↑')
  })

  it('실질금리(사후적 폴백): 인플레 쇼크 표지판 = 경계, 완화발 마이너스 = 주의', () => {
    const infDriven = assessNow(mkHistory({ cpiYoY: Array(24).fill(6), gs10: Array(24).fill(4) }))
    expect(infDriven.signals.find((s) => s.key === 'realRate')!.level).toBe('alert')
    expect(infDriven.signals.find((s) => s.key === 'realRate')!.reason).toContain('표지판')
    const easing = assessNow(mkHistory({ cpiYoY: Array(24).fill(1.5), gs10: Array(24).fill(1.0) }))
    expect(easing.signals.find((s) => s.key === 'realRate')!.level).toBe('watch')
    expect(easing.signals.find((s) => s.key === 'realRate')!.reason).toContain('완화발')
  })

  it('실질금리(TIPS 사전적): 긴축적 수준·초완화·괴리 해석', () => {
    // TIPS 2.8% = 긴축적 할인율 → 주의 + 2022년형 채널 언급
    const tight = assessNow(mkHistory({}), { tips: { date: '2026-07-08', value: 2.8 } })
    const t = tight.signals.find((s) => s.key === 'realRate')!
    expect(t.level).toBe('watch')
    expect(t.reason).toContain('2022년형')
    expect(t.value).toBe('TIPS +2.80%') // 단일 지표 — 사후적 병기 없음
    expect(t.label).toContain('사전적 TIPS')
    // TIPS −1% = 초완화 → 주의
    const easy = assessNow(mkHistory({}), { tips: { date: '2026-07-08', value: -1.0 } })
    expect(easy.signals.find((s) => s.key === 'realRate')!.reason).toContain('초완화')
    // 사후 +0.3 vs TIPS +2.2 괴리 → '일시적으로 판단' 해석 노출 (2026년 현재 케이스)
    const div = assessNow(mkHistory({ cpiYoY: Array(24).fill(4.3), gs10: Array(24).fill(4.55) }), { tips: { date: '2026-07-08', value: 2.2 } })
    expect(div.signals.find((s) => s.key === 'realRate')!.reason).toContain('일시적으로 판단')
  })

  it('장단기 역전 = 경계', () => {
    const a = assessNow(mkHistory({ gs10: Array(24).fill(3.0), tbill3m: Array(24).fill(4.0) }))
    expect(a.signals.find((s) => s.key === 'curve')!.level).toBe('alert')
  })

  it('CAPE 판정 임계값 = 차트 기준선(32.6/44)과 정확히 일치', () => {
    const val = (c: number) => assessNow(mkHistory({ cape: Array(24).fill(c) })).signals.find((s) => s.key === 'valuation')!
    expect(val(32.3).level).toBe('watch') // 32.6 미만은 경계 아님 (기준선 아래인데 경계로 뜨던 버그)
    expect(val(32.7).level).toBe('alert')
    expect(val(43.5).reason).toContain('1929년 수준 초과') // 44 미만은 "2000년 수준" 아님
    expect(val(44.2).reason).toContain('2000년 닷컴 버블 수준')
  })

  it('고밸류 + 인플레 이륙 = 1968년형 아날로그', () => {
    const rising = [...Array(18).fill(2.2), 2.5, 2.8, 3.0, 3.4, 3.8, 4.3]
    const a = assessNow(mkHistory({ cape: Array(24).fill(42), cpiYoY: rising }))
    expect(a.analog).toContain('1968')
  })
})

describe('라이브 스냅샷 오버라이드', () => {
  it('라이브 값이 번들을 대체하고 기준일이 신호별로 표기됨', () => {
    const h = mkHistory({})
    ;(h.meta as { liveRefs?: object }).liveRefs = { ym: h.meta.dataEnd, cpi: 300, capeProxy: 20, stockRealLast: h.series.stock[h.series.stock.length - 1] }
    const a = assessNow(h as Parameters<typeof assessNow>[0], {
      stock: { date: '2026-07-08', trRatio: 0.7 }, // 급락 시나리오
      gs10: { date: '2026-07-07', value: 3.0 },
      tbill3m: { date: '2026-07-07', value: 3.5 }, // 역전
      cpi: { ym: '2026-06', value: 318, yoy: 6.0 }, // 새 발표월 + 고인플레
    })
    expect(a.live).toBe(true)
    const market = a.signals.find((s) => s.key === 'market')!
    expect(market.asOf).toBe('2026-07-08')
    expect(market.level).toBe('alert') // -30% 낙폭
    expect(a.signals.find((s) => s.key === 'inflation')!.asOf).toBe('2026-06')
    expect(a.signals.find((s) => s.key === 'inflation')!.level).toBe('alert') // 6%
    expect(a.signals.find((s) => s.key === 'realRate')!.level).toBe('alert') // 3.0-6.0 = 인플레발 마이너스
    expect(a.signals.find((s) => s.key === 'curve')!.level).toBe('alert') // 역전
    expect(a.headline).toContain('한복판')
  })

  it('라이브 없이 호출하면 번들 기준으로 동작 (폴백)', () => {
    const a = assessNow(mkHistory({}))
    expect(a.live).toBe(false)
    expect(a.signals.every((s) => s.asOf.length > 0)).toBe(true)
  })

  it('TIPS만 라이브 성공해도 live 플래그가 참 (폴백 배너 오표시 방지)', () => {
    const a = assessNow(mkHistory({}), { tips: { date: '2026-07-08', value: 1.0 } })
    expect(a.live).toBe(true)
  })

  it('라이브 CPI가 번들보다 2달 새 달이어도 "6개월 전" 비교가 실제 달 수 기준', () => {
    // 번들 끝 2025-12 (인덱스 23). 라이브 발표월 2026-02 → 6개월 전 = 2025-08 (인덱스 19)
    const cpiYoY = Array(24).fill(2.0)
    cpiYoY[19] = 1.0 // 2025-08만 낮게 — 여기와 비교해야 상승 추세(+0.6)가 잡힘
    const h = mkHistory({ cpiYoY })
    ;(h.meta as { liveRefs?: object }).liveRefs = { ym: '2025-12', cpi: 300, capeProxy: 20, stockRealLast: 123 }
    const a = assessNow(h as Parameters<typeof assessNow>[0], { cpi: { ym: '2026-02', value: 305, yoy: 1.6 } })
    const inf = a.signals.find((s) => s.key === 'inflation')!
    expect(inf.asOf).toBe('2026-02')
    expect(inf.value).toContain('↑') // 구버전(고정 -5 인덱스)이면 2025-07(2.0)과 비교돼 추세가 안 잡힘
  })

  it('한쪽 금리만 라이브면 다리별 기준일 표기 + 혼합 주의 문구', () => {
    const a = assessNow(mkHistory({}), { gs10: { date: '2026-07-08', value: 4.5 } })
    const c = a.signals.find((s) => s.key === 'curve')!
    expect(c.asOf).toContain('10y 2026-07-08')
    expect(c.asOf).toContain('3m')
    expect(c.reason).toContain('섞인')
  })
})

describe('실제 번들 데이터 정합성', async () => {
  const { readFileSync } = await import('node:fs')
  const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))

  it('기준월 = dataEnd, 신호 5종 모두 판정 존재', () => {
    const a = assessNow(h)
    expect(a.asOf).toBe(h.meta.dataEnd)
    expect(a.signals).toHaveLength(5)
    for (const s of a.signals) {
      expect(['ok', 'watch', 'alert']).toContain(s.level)
      expect(s.reason.length).toBeGreaterThan(20)
    }
  })

  it('CAPE 프록시가 딥리서치 검증 범위(2026 초 ~41)와 정합', () => {
    const i = h.series.dates.indexOf('2026-01')
    expect(h.macro.capeProxy[i]).toBeGreaterThan(37)
    expect(h.macro.capeProxy[i]).toBeLessThan(47)
  })
})
