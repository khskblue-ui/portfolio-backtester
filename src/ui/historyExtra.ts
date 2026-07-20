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
  /** 나스닥100 총수익의 실제 소스 — xndx = 지수(^XNDX), qqq = 추종 ETF 배당 포함 폴백 */
  src?: 'xndx' | 'qqq'
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

// ─── 나스닥100 총수익 (^XNDX — 배당 재투자 포함, 산출 시작 1999-03-04 = 1000) ───

const NDX100_CACHE_KEY = 'bt_ndx100_v1'

interface YahooChartJson {
  chart?: {
    result?: {
      timestamp?: number[]
      meta?: { gmtoffset?: number }
      indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] }
    }[]
  }
}

/** 야후 차트 JSON(일별) → 1999-03 이후 월평균 (지수 산출 이전 소급치 배제) */
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
 * 나스닥100 총수익 무결성 가드: 시작 1999-03, 표본 300개월 이상,
 * 닷컴 붕괴(2000-03 → 2002-10 −65% 이상) 재현. checkBase가 켜지면 ^XNDX의
 * 산출 기준값(1999-03-04 = 1000) 부근인지도 검사 (QQQ 폴백은 조정 종가라
 * 절대 눈금이 다르므로 비율 가드만 적용 — 이어붙임은 비율만 사용).
 */
function guardNdx100(s: { ym: string[]; value: number[] }, checkBase: boolean): boolean {
  if (s.ym.length < 300) return false
  if (s.ym[0] !== '1999-03') return false
  if (checkBase && !(s.value[0] > 800 && s.value[0] < 1200)) return false
  const at = (m: string) => s.value[s.ym.indexOf(m)]
  const peak = at('2000-03')
  const trough = at('2002-10')
  return Boolean(peak && trough && trough / peak <= 0.35)
}

/** ^XNDX(나스닥100 총수익 지수) 일별 차트 → 월평균 + 가드 */
export function parseNdx100Chart(json: unknown): NasdaqSeries | null {
  const s = yahooMonthlyAvg(json, false)
  return guardNdx100(s, true) ? { ...s, src: 'xndx' } : null
}

/** QQQ(나스닥100 추종 ETF) 조정 종가(배당 포함) 차트 → 월평균 + 가드 — ^XNDX 폴백 */
export function parseQqqChart(json: unknown): NasdaqSeries | null {
  const s = yahooMonthlyAvg(json, true)
  return guardNdx100(s, false) ? { ...s, src: 'qqq' } : null
}

/**
 * 나스닥100 총수익 월평균 조회 (24시간 캐시).
 * 1차 ^XNDX(지수) → 실패 시 QQQ 조정 종가(배당 포함) 폴백 — 야후가 지수 히스토리를
 * 안 주는 환경이 있어 이중화. 둘 다 실패·가드 불통과면 null.
 */
export async function fetchNdx100Monthly(): Promise<NasdaqSeries | null> {
  const cached = readCache(NDX100_CACHE_KEY, 300)
  if (cached) return cached
  const attempt = async (url: string, parse: (j: unknown) => NasdaqSeries | null): Promise<NasdaqSeries | null> => {
    try {
      const res = await fetchWithTimeout(url, 20000)
      if (!res.ok) return null
      return parse(await res.json())
    } catch {
      return null
    }
  }
  const series =
    (await attempt('/yf/v8/finance/chart/%5EXNDX?interval=1d&range=max', parseNdx100Chart)) ??
    (await attempt('/yf/v8/finance/chart/QQQ?interval=1d&range=max', parseQqqChart))
  if (series) writeCache(NDX100_CACHE_KEY, series)
  return series
}
