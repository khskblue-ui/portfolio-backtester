/**
 * 역사 연구 보조 데이터 — 나스닥 종합지수 (FRED NASDAQCOM, 1971-02-05 = 100).
 *
 * 번들에 넣지 않고 브라우저에서 /fred 프록시로 직접 조회하는 이유:
 * 개요 차트의 "선택적 비교 오버레이"라 번들 무결성 검증 대상이 아니고, 일별
 * 종가를 월평균으로 집계하면 실러 관례(일별 종가의 월평균)와 정확히 일치해
 * 그대로 겹쳐 그릴 수 있다. 주의: 가격지수(배당 미포함) — S&P500 총수익과
 * 1:1 비교가 아니므로 라벨·각주에 반드시 명시.
 *
 * 신뢰성 가드(컨센서스 앵커): 시작월 1971-02, 기준월 평균 ≈ 100(90~120),
 * 표본 600개월 이상, 닷컴 붕괴(2000-03 → 2002-10 월평균 −60% 이상)를 전부
 * 통과한 데이터만 반환 — 하나라도 어긋나면 null (호출부는 오류 안내로 처리).
 */
import { fetchWithTimeout } from '../fetchUtil'

const CACHE_KEY = 'bt_nasdaq_v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 월간 해상도 데이터 — 하루 캐시면 충분

export interface NasdaqSeries {
  ym: string[]
  /** 해당 월의 일별 종가 평균 */
  value: number[]
}

/** FRED 일별 CSV(observation_date,NASDAQCOM) → 월평균 시계열 + 무결성 가드 */
export function parseNasdaqDailyCsv(csv: string): NasdaqSeries | null {
  const sum = new Map<string, { s: number; n: number }>()
  for (const line of csv.trim().split('\n').slice(1)) {
    const [d, v] = line.split(',')
    const num = Number(v)
    if (!d || v === '' || v === '.' || !Number.isFinite(num) || num <= 0) continue
    const ym = d.slice(0, 7)
    const acc = sum.get(ym)
    if (acc) {
      acc.s += num
      acc.n += 1
    } else sum.set(ym, { s: num, n: 1 })
  }
  const ym = [...sum.keys()].sort()
  const value = ym.map((m) => {
    const a = sum.get(m)!
    return a.s / a.n
  })
  // 무결성 가드 — 형식이 바뀌었거나 엉뚱한 시리즈면 그리지 않는 편이 낫다
  if (ym.length < 600) return null
  if (ym[0] !== '1971-02') return null
  if (!(value[0] > 90 && value[0] < 120)) return null
  const at = (m: string) => value[ym.indexOf(m)]
  const peak = at('2000-03')
  const trough = at('2002-10')
  if (!peak || !trough || trough / peak > 0.4) return null
  return { ym, value }
}

/** 나스닥 월평균 조회 (24시간 localStorage 캐시). 실패·가드 불통과 시 null */
export async function fetchNasdaqMonthly(): Promise<NasdaqSeries | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const c = JSON.parse(raw) as { fetchedAt: number; series: NasdaqSeries }
      if (Date.now() - c.fetchedAt < CACHE_TTL_MS && c.series?.ym?.length >= 600) return c.series
    }
  } catch {
    /* 캐시 손상 — 새로 조회 */
  }
  try {
    const res = await fetchWithTimeout('/fred/fredgraph.csv?id=NASDAQCOM', 20000)
    if (!res.ok) return null
    const series = parseNasdaqDailyCsv(await res.text())
    if (series) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), series }))
      } catch {
        /* 최선노력 */
      }
    }
    return series
  } catch {
    return null
  }
}
