/**
 * 나스닥 오버레이 파서(parseNasdaqDailyCsv) — 월평균 집계와 무결성 가드.
 * 가드가 느슨해지면 엉뚱한 시리즈가 차트에 그려지므로 실패 경로를 중점 검증.
 */

import { describe, it, expect } from 'vitest'
import { parseNasdaqDailyCsv, parseQqqChart } from '../src/ui/historyExtra'

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

/** 야후 차트 JSON 합성 — 월 앵커 로그-선형 보간, 월 1포인트 */
function syntheticChart(anchors: [string, number][], prepend?: { ym: string; v: number }[]): unknown {
  const mIdx = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return y * 12 + m
  }
  const ts: number[] = []
  const close: number[] = []
  for (const p of prepend ?? []) {
    const [y, m] = p.ym.split('-').map(Number)
    ts.push(Date.UTC(y, m - 1, 15) / 1000)
    close.push(p.v)
  }
  for (let k = 0; k < anchors.length - 1; k++) {
    const [a, va] = anchors[k]
    const [b, vb] = anchors[k + 1]
    const ia = mIdx(a)
    const ib = mIdx(b)
    for (let i = ia; i < ib + (k === anchors.length - 2 ? 1 : 0); i++) {
      const y = Math.floor((i - 1) / 12)
      const m = i - y * 12
      ts.push(Date.UTC(y, m - 1, 15) / 1000)
      close.push(va * Math.exp(Math.log(vb / va) * ((i - ia) / (ib - ia))))
    }
  }
  return { chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: ts, indicators: { quote: [{ close }] } }] } }
}

describe('나스닥100 총수익 (QQQ 월봉 · 조정 종가 = 배당 포함)', () => {
  /** quote.close를 adjclose로 옮긴 차트 — QQQ 응답 형태 */
  function toAdjChart(chart: unknown): unknown {
    const j = structuredClone(chart) as {
      chart: { result: { indicators: { quote?: { close: (number | null)[] }[]; adjclose?: { adjclose: (number | null)[] }[] } }[] }
    }
    const ind = j.chart.result[0].indicators
    ind.adjclose = [{ adjclose: ind.quote![0].close }]
    delete ind.quote
    return j
  }

  // 실측 앵커(2026-07 프로덕션 QQQ 조정 종가): 2000-03 92.27 → 2002-10 17.46
  const QQQ_ANCHORS: [string, number][] = [
    ['1999-04', 45.3],
    ['2000-03', 92.27],
    ['2002-10', 17.46],
    ['2026-05', 620],
  ]

  it('정상 시리즈: 1999-04 시작(월봉 첫 완전월) 허용·붕괴 앵커 통과·src=qqq', () => {
    const s = parseQqqChart(toAdjChart(syntheticChart(QQQ_ANCHORS)))
    expect(s).not.toBeNull()
    expect(s!.src).toBe('qqq')
    expect(s!.ym[0]).toBe('1999-04')
    expect(s!.ym.length).toBeGreaterThan(300)
    const at = (m: string) => s!.value[s!.ym.indexOf(m)]
    expect(at('2002-10') / at('2000-03')).toBeLessThan(0.35)
  })

  it('1999-03 시작도 허용, 그 이전 소급치는 잘라낸다', () => {
    const withMarch: [string, number][] = [['1999-03', 44], ...QQQ_ANCHORS]
    const s = parseQqqChart(toAdjChart(syntheticChart(withMarch)))
    expect(s).not.toBeNull()
    expect(s!.ym[0]).toBe('1999-03')
  })

  it('가드: 시작월이 1999-05 이후면 null', () => {
    const late: [string, number][] = [['2005-01', 30], ['2026-05', 400]]
    expect(parseQqqChart(toAdjChart(syntheticChart(late)))).toBeNull()
  })

  it('가드: 닷컴 붕괴가 없으면 null', () => {
    const noCrash: [string, number][] = [['1999-04', 45], ['2000-03', 92], ['2002-10', 80], ['2026-05', 620]]
    expect(parseQqqChart(toAdjChart(syntheticChart(noCrash)))).toBeNull()
  })

  it('가드: 형식 불량(빈 결과)이면 null', () => {
    expect(parseQqqChart({})).toBeNull()
    expect(parseQqqChart({ chart: { result: [] } })).toBeNull()
  })
})
