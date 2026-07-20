/**
 * 나스닥 오버레이 파서(parseNasdaqDailyCsv) — 월평균 집계와 무결성 가드.
 * 가드가 느슨해지면 엉뚱한 시리즈가 차트에 그려지므로 실패 경로를 중점 검증.
 */

import { describe, it, expect } from 'vitest'
import { parseNasdaqDailyCsv } from '../src/ui/historyExtra'

/** 1971-02 ~ 2026-05, 월 앵커 로그-선형 보간 일별(월 2회 관측) 합성 CSV */
function syntheticCsv(anchors: [string, number][]): string {
  const mIdx = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return y * 12 + m
  }
  let out = 'observation_date,NASDAQCOM\n'
  for (let k = 0; k < anchors.length - 1; k++) {
    const [a, va] = anchors[k]
    const [b, vb] = anchors[k + 1]
    const ia = mIdx(a)
    const ib = mIdx(b)
    for (let i = ia; i < ib + (k === anchors.length - 2 ? 1 : 0); i++) {
      const y = Math.floor((i - 1) / 12)
      const m = i - y * 12
      const v = va * Math.exp(Math.log(vb / va) * ((i - ia) / (ib - ia)))
      // 한 달에 두 관측 — 월평균이 두 값의 평균이 되는지도 함께 검증됨
      out += `${y}-${String(m).padStart(2, '0')}-05,${(v * 0.99).toFixed(2)}\n`
      out += `${y}-${String(m).padStart(2, '0')}-20,${(v * 1.01).toFixed(2)}\n`
    }
  }
  return out
}

const VALID_ANCHORS: [string, number][] = [
  ['1971-02', 100.8],
  ['2000-03', 4800],
  ['2002-10', 1190],
  ['2026-05', 24000],
]

describe('나스닥 일별 CSV → 월평균 + 무결성 가드', () => {
  it('정상 시리즈: 월평균 집계·정렬·앵커 통과', () => {
    const s = parseNasdaqDailyCsv(syntheticCsv(VALID_ANCHORS))
    expect(s).not.toBeNull()
    expect(s!.ym[0]).toBe('1971-02')
    expect(s!.ym.length).toBeGreaterThan(600)
    // 월평균 = (v×0.99 + v×1.01)/2 = v
    expect(s!.value[0]).toBeCloseTo(100.8, 0)
    const at = (m: string) => s!.value[s!.ym.indexOf(m)]
    expect(at('2000-03')).toBeCloseTo(4800, -1)
    expect(at('2002-10') / at('2000-03')).toBeLessThan(0.4)
    // 정렬 보장
    expect([...s!.ym].sort().join()).toBe(s!.ym.join())
  })

  it('결측(.)·빈 값 행은 건너뛴다', () => {
    const csv = syntheticCsv(VALID_ANCHORS) + '2026-06-01,.\n2026-06-02,\n'
    const s = parseNasdaqDailyCsv(csv)
    expect(s).not.toBeNull()
    expect(s!.ym.includes('2026-06')).toBe(false)
  })

  it('가드: 시작월이 1971-02가 아니면 null', () => {
    const shifted = syntheticCsv([['1980-01', 150], ['2000-03', 4800], ['2002-10', 1190], ['2026-05', 24000]])
    expect(parseNasdaqDailyCsv(shifted)).toBeNull()
  })

  it('가드: 기준월 값이 100 부근이 아니면 null (엉뚱한 시리즈 차단)', () => {
    const wrongBase: [string, number][] = [['1971-02', 500], ['2000-03', 24000], ['2002-10', 5900], ['2026-05', 120000]]
    expect(parseNasdaqDailyCsv(syntheticCsv(wrongBase))).toBeNull()
  })

  it('가드: 닷컴 붕괴 앵커(2000-03 → 2002-10 −60%+)가 없으면 null', () => {
    const noCrash: [string, number][] = [['1971-02', 100.8], ['2000-03', 4800], ['2002-10', 4000], ['2026-05', 24000]]
    expect(parseNasdaqDailyCsv(syntheticCsv(noCrash))).toBeNull()
  })

  it('가드: 표본 부족(600개월 미만)이면 null', () => {
    const short = syntheticCsv([['1971-02', 100.8], ['2000-03', 4800]])
    expect(parseNasdaqDailyCsv(short)).toBeNull()
  })
})
