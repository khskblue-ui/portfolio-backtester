/**
 * 백테스터 데이터 레이어 (PRD §3)
 *
 * - Yahoo Finance v8 chart API (/yf/* 프록시)에서 일별 시계열 조회
 * - ⚠ 이중 스트림(3.2): 성과 복리는 "비조정 가격 + 주당 실배당 현금흐름"으로 자연 재현,
 *   adjClose는 검증용으로만 보유. adjusted close에 배당세를 매기면 이중계산.
 *   (Yahoo v8의 close는 스플릿만 반영, adjclose는 배당+스플릿 반영 — 배당 이벤트도
 *   스플릿 조정된 주당 금액이므로 보유 주식수 추적과 일관됨)
 * - 캘린더(3.3): 주식 티커들의 거래일 교집합 = 공통 캘린더(NYSE). 크립토(365일)는
 *   해당 거래일만 샘플링 — 주말 크립토 변동으로 밴드가 터지는 왜곡 방지.
 * - 스냅샷 해시(3.4): 정렬된 번들 전체의 해시 → 벤더 수정으로 결과가 조용히
 *   바뀌지 않았는지 재실행 시 비교 가능.
 */

import { fetchWithTimeout } from '../fetchUtil'
import type { DailySeries, AlignedDataBundle, AlignedSeries } from './types'
import { CASH_TICKER } from './types'

/** 크립토 티커 판별 (Yahoo -USD 표기) — 365일 거래 → 공통 캘린더 강제 대상 */
export function isCryptoTicker(ticker: string): boolean {
  return ticker.toUpperCase().endsWith('-USD')
}

// ─── Yahoo 조회 ───────────────────────────────────────────────────────────────

interface YahooChartResult {
  meta?: { gmtoffset?: number }
  timestamp?: number[]
  events?: { dividends?: Record<string, { amount: number; date: number }> }
  indicators?: {
    quote?: { open?: (number | null)[]; close?: (number | null)[] }[]
    adjclose?: { adjclose?: (number | null)[] }[]
  }
}

/** UTC 타임스탬프 + 거래소 오프셋 → 거래소 로컬 "YYYY-MM-DD" */
function toLocalDate(ts: number, gmtoffset: number): string {
  return new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 단일 티커의 전 기간 일별 시계열 조회 (비조정 open/close + adjclose + 배당 이벤트)
 *
 * Yahoo는 range=max 요청에 레이트리밋(429)을 자주 걸므로 지수 백오프로 재시도.
 * @param opts.retryBaseMs 백오프 기본 간격 (테스트 주입용, 기본 1500ms)
 */
export async function fetchDailySeries(
  ticker: string,
  opts?: { retryBaseMs?: number }
): Promise<DailySeries> {
  const url = `/yf/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=max&events=div&includeAdjustedClose=true`
  const retryBaseMs = opts?.retryBaseMs ?? 1500
  const MAX_ATTEMPTS = 4

  let lastStatus = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(retryBaseMs * 2 ** (attempt - 1)) // 1.5s → 3s → 6s
    const res = await fetchWithTimeout(url, 20000)
    if (res.ok) {
      const json = await res.json()
      return parseYahooChart(json, ticker)
    }
    lastStatus = res.status
    // 429(레이트리밋)·5xx만 재시도 가치가 있음 — 404 등은 즉시 실패
    if (res.status !== 429 && res.status < 500) break
  }
  throw new Error(
    `${ticker} 데이터 조회 실패 (HTTP ${lastStatus}${lastStatus === 429 ? ' — 요청 과다. 잠시 후 다시 시도하세요' : ''})`
  )
}

/** Yahoo v8 chart 응답 → DailySeries (순수 함수 — 테스트/스모크 재사용) */
export function parseYahooChart(json: unknown, ticker: string): DailySeries {
  const result: YahooChartResult | undefined =
    (json as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0]
  if (!result?.timestamp?.length) throw new Error(`${ticker} 데이터 없음`)

  const gmtoffset = result.meta?.gmtoffset ?? 0
  const timestamps = result.timestamp
  const opens = result.indicators?.quote?.[0]?.open ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const adjCloses = result.indicators?.adjclose?.[0]?.adjclose ?? []

  const dates: string[] = []
  const open: number[] = []
  const close: number[] = []
  const adjClose: number[] = []

  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i]
    const c = closes[i]
    // 결측/이상치 행은 제외 (PRD 3.4) — open·close 둘 다 유효해야 체결·평가 가능
    if (o == null || c == null || !(o > 0) || !(c > 0)) continue
    const d = toLocalDate(timestamps[i], gmtoffset)
    // 동일 날짜 중복 행이면 마지막 값으로 덮어씀
    if (dates.length > 0 && dates[dates.length - 1] === d) {
      open[open.length - 1] = o
      close[close.length - 1] = c
      adjClose[adjClose.length - 1] = adjCloses[i] ?? c
      continue
    }
    dates.push(d)
    open.push(o)
    close.push(c)
    adjClose.push(adjCloses[i] ?? c)
  }

  const dividends: Record<string, number> = {}
  const divEvents = result.events?.dividends ?? {}
  for (const key of Object.keys(divEvents)) {
    const ev = divEvents[key]
    if (!ev || !(ev.amount > 0)) continue
    dividends[toLocalDate(ev.date, gmtoffset)] = (dividends[toLocalDate(ev.date, gmtoffset)] ?? 0) + ev.amount
  }

  if (dates.length === 0) throw new Error(`${ticker} 유효한 가격 데이터 없음`)
  return { ticker, dates, open, close, adjClose, dividends }
}

// ─── 캘린더 정렬 (3.3) ────────────────────────────────────────────────────────

/**
 * 여러 시계열을 공통 거래 캘린더로 정렬.
 *
 * - 캘린더 = 비크립토(주식/ETF) 티커들의 거래일 교집합. 전부 크립토면 첫 티커 캘린더.
 * - 시작일 = 모든 자산의 최늦 시작일로 클립 (+경고 목록 생성)
 * - 크립토는 캘린더 날짜만 샘플링. 캘린더 날짜에 가격이 없으면 직전 값 forward-fill
 *   (배당은 ex-date가 캘린더에 없으면 다음 캘린더 날짜로 이월 — 현금흐름 유실 방지)
 */
export function alignToCommonCalendar(
  seriesList: DailySeries[],
  options?: { startDate?: string; endDate?: string }
): AlignedDataBundle {
  if (seriesList.length === 0) throw new Error('정렬할 시계열이 없습니다')

  const equities = seriesList.filter((s) => !isCryptoTicker(s.ticker))
  const calendarSources = equities.length > 0 ? equities : [seriesList[0]]

  // 거래일 교집합
  let calendar = new Set(calendarSources[0].dates)
  for (let i = 1; i < calendarSources.length; i++) {
    const next = new Set(calendarSources[i].dates)
    calendar = new Set([...calendar].filter((d) => next.has(d)))
  }

  // 최늦 시작일 클립 (3.3)
  const firstDates: Record<string, string> = {}
  let latestStart = ''
  for (const s of seriesList) {
    firstDates[s.ticker] = s.dates[0]
    if (s.dates[0] > latestStart) latestStart = s.dates[0]
  }
  const clipWarnings: string[] = []
  for (const s of seriesList) {
    if (s.dates[0] < latestStart) {
      clipWarnings.push(
        `${s.ticker}는 ${s.dates[0]}부터 데이터가 있으나, 최늦 시작 자산에 맞춰 ${latestStart}부터로 클립됩니다`
      )
    }
  }

  const startDate = options?.startDate && options.startDate > latestStart ? options.startDate : latestStart
  const endDate = options?.endDate ?? '9999-12-31'
  const dates = [...calendar].filter((d) => d >= startDate && d <= endDate).sort()
  if (dates.length < 2) throw new Error('공통 거래일이 부족합니다 (자산 시작일이 겹치지 않음)')

  const series: Record<string, AlignedSeries> = {}
  for (const s of seriesList) {
    const idx = new Map<string, number>()
    s.dates.forEach((d, i) => idx.set(d, i))

    const open: number[] = []
    const close: number[] = []
    const adjClose: number[] = []
    const divPerShare: number[] = new Array<number>(dates.length).fill(0)

    let lastI = -1
    for (let k = 0; k < dates.length; k++) {
      const i = idx.get(dates[k])
      if (i != null) {
        lastI = i
        open.push(s.open[i])
        close.push(s.close[i])
        adjClose.push(s.adjClose[i])
      } else if (lastI >= 0) {
        // 캘린더 날짜에 해당 자산 데이터 없음(휴장 등) → forward-fill
        open.push(s.close[lastI])
        close.push(s.close[lastI])
        adjClose.push(s.adjClose[lastI])
      } else {
        // 시작일 클립으로 발생하지 않아야 하는 케이스 — 방어적으로 첫 값 사용
        open.push(s.open[0])
        close.push(s.close[0])
        adjClose.push(s.adjClose[0])
      }
    }

    // 배당 ex-date를 캘린더 날짜로 매핑 (캘린더에 없으면 다음 캘린더 날짜로 이월)
    for (const [d, amt] of Object.entries(s.dividends)) {
      if (d < dates[0] || d > dates[dates.length - 1]) continue
      let k = lowerBound(dates, d)
      if (k >= dates.length) k = dates.length - 1
      divPerShare[k] += amt
    }

    series[s.ticker] = { ticker: s.ticker, open, close, adjClose, divPerShare }
  }

  const bundle: AlignedDataBundle = {
    dates,
    series,
    snapshotHash: '',
    firstDates,
    clipWarnings,
  }
  bundle.snapshotHash = hashBundle(bundle)
  return bundle
}

/** dates에서 d 이상인 첫 인덱스 (이진 탐색) */
function lowerBound(dates: string[], d: string): number {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] < d) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ─── 스냅샷 해시 (3.4) ────────────────────────────────────────────────────────

/** FNV-1a 32bit — 데이터셋 버전 지문. 암호학적 용도 아님(변경 감지 전용) */
export function hashBundle(bundle: AlignedDataBundle): string {
  let h = 0x811c9dc5
  const mix = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  mix(bundle.dates[0] + bundle.dates[bundle.dates.length - 1] + bundle.dates.length)
  for (const t of Object.keys(bundle.series).sort()) {
    const s = bundle.series[t]
    mix(t)
    // 전체 순회 대신 표본(각 시계열의 규칙적 표본 + 배당 합)으로도 벤더 수정 감지에 충분
    const step = Math.max(1, Math.floor(s.close.length / 256))
    for (let i = 0; i < s.close.length; i += step) mix(s.close[i].toFixed(6) + s.open[i].toFixed(6))
    mix(s.divPerShare.reduce((a, b) => a + b, 0).toFixed(8))
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ─── 캐시 + 번들 로드 ─────────────────────────────────────────────────────────

const CACHE_PREFIX = 'bt_series_v1_'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CachedSeries {
  fetchedAt: number
  data: DailySeries
}

function readCache(ticker: string): DailySeries | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + ticker)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedSeries
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null
    return cached.data
  } catch {
    return null
  }
}

function writeCache(ticker: string, data: DailySeries): void {
  try {
    localStorage.setItem(CACHE_PREFIX + ticker, JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    // localStorage 용량 초과 등 — 캐시는 최선노력
  }
}

/** 네트워크 조회 간 간격 — Yahoo 레이트리밋(429) 회피. 캐시 히트엔 미적용 */
const INTER_FETCH_DELAY_MS = 400

/**
 * 전략들이 참조하는 모든 티커(CASH 제외)를 조회·정렬한 번들 반환.
 * forceRefresh=false면 24시간 localStorage 캐시 사용.
 *
 * ⚠ 병렬 조회 금지 — Yahoo는 동시 range=max 요청에 429를 던짐.
 * 순차 조회 + 요청 간 딜레이 + fetchDailySeries의 백오프 재시도 조합.
 */
export async function loadDataBundle(
  tickers: string[],
  options?: { startDate?: string; endDate?: string; forceRefresh?: boolean }
): Promise<AlignedDataBundle> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))].filter((t) => t !== CASH_TICKER)
  if (unique.length === 0) throw new Error('시장 자산이 없습니다 (CASH만으로는 백테스트 불가)')

  const seriesList: DailySeries[] = []
  let fetchedFromNetwork = false
  for (const t of unique) {
    if (!options?.forceRefresh) {
      const cached = readCache(t)
      if (cached) {
        seriesList.push(cached)
        continue
      }
    }
    if (fetchedFromNetwork) await sleep(INTER_FETCH_DELAY_MS)
    const fetched = await fetchDailySeries(t)
    fetchedFromNetwork = true
    writeCache(t, fetched)
    seriesList.push(fetched)
  }

  return alignToCommonCalendar(seriesList, options)
}
