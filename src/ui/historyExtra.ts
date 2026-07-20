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
  /** 나스닥100 총수익의 소스 표기 — qqq = 추종 ETF(배당 포함 조정 종가) */
  src?: 'qqq'
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

function readCache(key: string, minLen: number): NasdaqSeries | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const c = JSON.parse(raw) as { fetchedAt: number; series: NasdaqSeries }
    if (Date.now() - c.fetchedAt < CACHE_TTL_MS && c.series?.ym?.length >= minLen) return c.series
  } catch {
    /* 캐시 손상 — 새로 조회 */
  }
  return null
}

function writeCache(key: string, series: NasdaqSeries): void {
  try {
    localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), series }))
  } catch {
    /* 최선노력 */
  }
}

/** 나스닥 종합(가격지수) 월평균 조회 (24시간 localStorage 캐시). 실패·가드 불통과 시 null */
export async function fetchNasdaqMonthly(): Promise<NasdaqSeries | null> {
  const cached = readCache(CACHE_KEY, 600)
  if (cached) return cached
  try {
    const res = await fetchWithTimeout('/fred/fredgraph.csv?id=NASDAQCOM', 20000)
    if (!res.ok) return null
    const series = parseNasdaqDailyCsv(await res.text())
    if (series) writeCache(CACHE_KEY, series)
    return series
  } catch {
    return null
  }
}

// ─── 나스닥100 총수익 — QQQ(추종 ETF) 배당 포함 조정 종가 ─────────────────────
// 지수 자체(^XNDX)는 야후가 히스토리를 제공하지 않아(validRanges: 1d·5d뿐) ETF로 계산.
// range=max는 야후가 월봉으로 강등해 반환하므로 처음부터 interval=1mo로 명시 요청.

const NDX100_CACHE_KEY = 'bt_ndx100_v2'

interface YahooChartJson {
  chart?: {
    result?: {
      timestamp?: number[]
      meta?: { gmtoffset?: number }
      indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] }
    }[]
  }
}

/** 야후 차트 JSON(일별/월봉) → 1999-03 이후 월별 값 (월봉이면 그 값, 일별이면 월평균) */
function yahooMonthlyAvg(json: unknown, useAdjclose: boolean): { ym: string[]; value: number[] } {
  const j = json as YahooChartJson
  const r = j.chart?.result?.[0]
  const ts = r?.timestamp ?? []
  const closes = (useAdjclose ? r?.indicators?.adjclose?.[0]?.adjclose : r?.indicators?.quote?.[0]?.close) ?? []
  const off = r?.meta?.gmtoffset ?? 0
  const sum = new Map<string, { s: number; n: number }>()
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || !(c > 0)) continue
    const ym = new Date((ts[i] + off) * 1000).toISOString().slice(0, 7)
    if (ym < '1999-03') continue
    const acc = sum.get(ym)
    if (acc) {
      acc.s += c
      acc.n += 1
    } else sum.set(ym, { s: c, n: 1 })
  }
  const ym = [...sum.keys()].sort()
  const value = ym.map((m) => {
    const a = sum.get(m)!
    return a.s / a.n
  })
  return { ym, value }
}

/**
 * 나스닥100 총수익(QQQ) 무결성 가드: 시작 1999-03 또는 1999-04(QQQ 상장 1999-03-10 —
 * 야후 월봉은 첫 완전월인 4월부터 시작), 표본 300개월 이상, 닷컴 붕괴
 * (2000-03 → 2002-10 −65% 이상) 재현. 조정 종가는 절대 눈금이 계속 변하므로
 * 비율 가드만 사용 (이어붙임도 비율만 쓴다). 실측 검증: 2026-07 프로덕션 응답에서
 * 2000-03 92.27 → 2002-10 17.46 (비율 0.19).
 */
function guardNdx100(s: { ym: string[]; value: number[] }): boolean {
  if (s.ym.length < 300) return false
  if (s.ym[0] !== '1999-03' && s.ym[0] !== '1999-04') return false
  const at = (m: string) => s.value[s.ym.indexOf(m)]
  const peak = at('2000-03')
  const trough = at('2002-10')
  return Boolean(peak && trough && trough / peak <= 0.35)
}

/** QQQ 월봉 차트(조정 종가 = 배당 포함) → 월별 시계열 + 가드 */
export function parseQqqChart(json: unknown): NasdaqSeries | null {
  const s = yahooMonthlyAvg(json, true)
  return guardNdx100(s) ? { ...s, src: 'qqq' } : null
}

/** 나스닥100 총수익(QQQ 배당 포함) 월별 조회 (24시간 캐시). 실패·가드 불통과 시 null */
export async function fetchNdx100Monthly(): Promise<NasdaqSeries | null> {
  const cached = readCache(NDX100_CACHE_KEY, 300)
  if (cached) return cached
  try {
    const res = await fetchWithTimeout('/yf/v8/finance/chart/QQQ?interval=1mo&range=max', 20000)
    if (!res.ok) return null
    const series = parseQqqChart(await res.json())
    if (series) writeCache(NDX100_CACHE_KEY, series)
    return series
  } catch {
    return null
  }
}
