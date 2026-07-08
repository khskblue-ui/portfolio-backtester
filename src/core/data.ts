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
import { ASSET_CATALOG, isBundleTicker } from './catalog'
import { buildLeveragedSeries, RATE_TICKER } from './synthetic'

/** 크립토 티커 판별 (Yahoo -USD 표기) — 365일 거래 → 공통 캘린더 강제 대상 */
export function isCryptoTicker(ticker: string): boolean {
  return ticker.toUpperCase().endsWith('-USD')
}

// ─── Yahoo 조회 ───────────────────────────────────────────────────────────────

interface YahooChartResult {
  meta?: { gmtoffset?: number; dataGranularity?: string; firstTradeDate?: number | null }
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
 * 재시도 공통 fetch — 429(레이트리밋)·5xx는 지수 백오프, 그 외 4xx는 즉시 실패.
 * @param retryBaseMs 백오프 기본 간격 (테스트 주입용, 기본 1500ms)
 */
async function fetchWithRetry(url: string, ticker: string, retryBaseMs: number): Promise<Response> {
  const MAX_ATTEMPTS = 4
  let lastStatus = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(retryBaseMs * 2 ** (attempt - 1)) // 1.5s → 3s → 6s
    const res = await fetchWithTimeout(url, 20000)
    if (res.ok) return res
    lastStatus = res.status
    if (res.status !== 429 && res.status < 500) break
  }
  const hint =
    lastStatus === 429
      ? ' — 요청 과다. 잠시 후 다시 시도하세요'
      : lastStatus === 404
        ? ' — 존재하지 않는 티커입니다. 심볼을 확인하세요'
        : ''
  throw new Error(`${ticker} 데이터 조회 실패 (HTTP ${lastStatus}${hint})`)
}

/**
 * 단일 티커의 전 기간 일별 시계열 조회 (비조정 open/close + adjclose + 배당 이벤트)
 *
 * ⚠ Yahoo는 히스토리가 아주 긴 심볼(예: ^GSPC 1927~)에 interval=1d&range=max를
 * 요청하면 "조용히" 월/분기 해상도로 강등해 반환한다(meta.dataGranularity로만 확인
 * 가능). 이를 그대로 쓰면 캘린더가 오염돼 변동성·수면하 등 모든 지표가 왜곡되므로,
 * 강등 감지 시 20년 청크의 period1/period2 요청으로 일별 데이터를 강제 수집한다.
 */
export async function fetchDailySeries(
  ticker: string,
  opts?: { retryBaseMs?: number }
): Promise<DailySeries> {
  const base = `/yf/v8/finance/chart/${encodeURIComponent(ticker)}`
  const common = 'events=div&includeAdjustedClose=true'
  const retryBaseMs = opts?.retryBaseMs ?? 1500

  const res = await fetchWithRetry(`${base}?interval=1d&range=max&${common}`, ticker, retryBaseMs)
  const json: unknown = await res.json()
  const meta = (json as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0]?.meta
  const granularity = meta?.dataGranularity

  if (!granularity || granularity === '1d') {
    return parseYahooChart(json, ticker)
  }

  // ── 강등 감지 → 20년 청크 재조회 ──
  const CHUNK_SEC = Math.floor(20 * 365.25 * 86_400)
  const firstTrade = typeof meta?.firstTradeDate === 'number' ? meta.firstTradeDate : 0
  const nowSec = Math.ceil(Date.now() / 1000) + 86_400
  const chunks: DailySeries[] = []

  for (let start = firstTrade; start < nowSec; start += CHUNK_SEC) {
    const end = Math.min(start + CHUNK_SEC, nowSec)
    await sleep(INTER_FETCH_DELAY_MS)
    const r = await fetchWithRetry(
      `${base}?interval=1d&period1=${Math.floor(start)}&period2=${Math.ceil(end)}&${common}`,
      ticker,
      retryBaseMs
    )
    const cj: unknown = await r.json().catch(() => null)
    const chunkResult = (cj as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0]
    if (!chunkResult?.timestamp?.length) continue // 상장 전/데이터 없는 구간 — 스킵
    const cg = chunkResult.meta?.dataGranularity
    if (cg && cg !== '1d') {
      throw new Error(`${ticker} — Yahoo가 일별 데이터를 제공하지 않습니다 (수신 해상도: ${cg})`)
    }
    chunks.push(parseYahooChart(cj, ticker))
  }

  if (chunks.length === 0) throw new Error(`${ticker} 유효한 가격 데이터 없음`)
  return mergeDailySeries(chunks, ticker)
}

/** 청크 병합 — 날짜 오름차순, 경계 중복 제거, 배당 통합 */
export function mergeDailySeries(chunks: DailySeries[], ticker: string): DailySeries {
  const sorted = [...chunks].sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1))
  const dates: string[] = []
  const open: number[] = []
  const close: number[] = []
  const adjClose: number[] = []
  const dividends: Record<string, number> = {}
  for (const c of sorted) {
    for (let i = 0; i < c.dates.length; i++) {
      if (dates.length > 0 && c.dates[i] <= dates[dates.length - 1]) continue
      dates.push(c.dates[i])
      open.push(c.open[i])
      close.push(c.close[i])
      adjClose.push(c.adjClose[i])
    }
    for (const [d, amt] of Object.entries(c.dividends)) dividends[d] = amt
  }
  if (dates.length === 0) throw new Error(`${ticker} 유효한 가격 데이터 없음`)
  return { ticker, dates, open, close, adjClose, dividends }
}

// ─── Stooq 소스 (장기 히스토리 — 금 현물 등, §3 유니버스 확장) ─────────────────

/**
 * Stooq 일별 CSV 조회 — Yahoo에 없는 장기 히스토리(XAUUSD 금 현물 1968~ 등).
 * 배당 이벤트 없음(현물·지수 전용). 카탈로그에서 source='stooq'로 지정된 티커에 사용.
 */
export async function fetchStooqSeries(
  ticker: string,
  opts?: { retryBaseMs?: number }
): Promise<DailySeries> {
  const url = `/stooq/q/d/l/?s=${encodeURIComponent(ticker.toLowerCase())}&i=d`
  const res = await fetchWithRetry(url, ticker, opts?.retryBaseMs ?? 1500)
  return parseStooqCsv(await res.text(), ticker)
}

/** Stooq CSV(Date,Open,High,Low,Close[,Volume]) → DailySeries (순수 함수) */
export function parseStooqCsv(csv: string, ticker: string): DailySeries {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2 || !lines[0].startsWith('Date')) {
    // Stooq는 실패해도 HTTP 200으로 안내 페이지를 주므로 본문을 보고 원인 분류
    if (/przekroczony|limit/i.test(csv)) {
      throw new Error(`${ticker} — Stooq 일일 다운로드 한도 초과. 잠시 후(또는 내일) 재시도하거나 GC=F(금 선물, 2000~)로 대체하세요`)
    }
    if (/no data|brak danych/i.test(csv)) {
      throw new Error(`${ticker} — Stooq에 해당 심볼 데이터 없음. GC=F(금 선물, 2000~)로 대체하세요`)
    }
    const head = csv.trim().slice(0, 80).replace(/\s+/g, ' ')
    throw new Error(`${ticker} — Stooq 응답이 CSV가 아닙니다 (수신: "${head}"). 재시도하거나 GC=F로 대체하세요`)
  }
  const dates: string[] = []
  const open: number[] = []
  const close: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const d = cols[0]
    const o = Number(cols[1])
    const c = Number(cols[4])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(o > 0) || !(c > 0)) continue
    dates.push(d)
    open.push(o)
    close.push(c)
  }
  if (dates.length === 0) throw new Error(`${ticker} 유효한 가격 데이터 없음 (Stooq)`)
  return { ticker, dates, open, close, adjClose: [...close], dividends: {} }
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

// ─── 리포 번들 월간 합성 자산 (-HIST, 1871~) ─────────────────────────────────

interface HistAssetsFile {
  meta: { note: string; dataEnd: string }
  assets: Record<string, { dates: string[]; close: number[] }>
}

let histAssetsPromise: Promise<HistAssetsFile> | null = null

/** 테스트 전용 — 모듈 캐시 초기화 (fetch 스텁 교체 시) */
export function resetHistAssetsCache(): void {
  histAssetsPromise = null
}

/** /data/history-assets.json 로드 (모듈 캐시 — 정적 번들이라 세션 내 1회) */
function loadHistAssetsFile(): Promise<HistAssetsFile> {
  if (!histAssetsPromise) {
    histAssetsPromise = fetch('/data/history-assets.json').then((r) => {
      if (!r.ok) throw new Error(`역사 자산 번들 로드 실패 (HTTP ${r.status})`)
      return r.json() as Promise<HistAssetsFile>
    })
    // 실패 시 다음 호출에서 재시도 가능하도록 캐시 무효화
    histAssetsPromise.catch(() => {
      histAssetsPromise = null
    })
  }
  return histAssetsPromise
}

/** 번들 월간 자산 → DailySeries (시가=종가: 월평균 가격 1개 관측치, 배당 내재라 이벤트 없음) */
export async function fetchBundleSeries(ticker: string): Promise<DailySeries> {
  const file = await loadHistAssetsFile()
  const a = file.assets[ticker]
  if (!a) throw new Error(`${ticker} — 역사 자산 번들에 없는 티커`)
  return { ticker, dates: a.dates, open: [...a.close], close: a.close, adjClose: [...a.close], dividends: {} }
}

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
  options?: { startDate?: string; endDate?: string; monthlyExpected?: boolean }
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
  const startDate = options?.startDate && options.startDate > latestStart ? options.startDate : latestStart
  const endDate = options?.endDate ?? '9999-12-31'
  const dates = [...calendar].filter((d) => d >= startDate && d <= endDate).sort()
  if (dates.length < 2) throw new Error('공통 거래일이 부족합니다 (자산 시작일·종료일 범위를 확인하세요)')

  // 히스토리가 가장 짧은 자산이 비교 시작일을 결정 — 원인 자산을 지목해 설명 (§3.3)
  const clipWarnings: string[] = []

  // 방어선: 캘린더가 일별이 아니면(평균 간격 > 5일) 지표 왜곡 경고.
  // 역사 월간 자산(-HIST)만으로 구성된 실행은 월간이 의도된 해상도 — 정보성 안내로 대체
  const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000
  const avgGap = spanDays / (dates.length - 1)
  if (avgGap > 5 && !options?.monthlyExpected) {
    clipWarnings.push(
      `데이터 해상도 경고: 거래일 간격이 평균 ${avgGap.toFixed(1)}일 — 일별 데이터가 아닌 자산이 섞여 ` +
        `변동성·수면하·MDD 등 지표가 심하게 왜곡됩니다. 데이터 새로고침을 시도하거나 해당 자산을 교체하세요`
    )
  }
  if (options?.monthlyExpected) {
    clipWarnings.push(
      '역사 월간 모드: 모든 자산이 월간 해상도(-HIST)로 실행됩니다 — 평가·리밸런싱·적립이 월 1회이고, ' +
        '변동성·MDD는 월간 데이터 기준(일간 낙폭보다 완만하게 표기)입니다. 수치는 명목(인플레이션 미반영)'
    )
  }
  const bindingTickers = seriesList.filter((s) => s.dates[0] === latestStart).map((s) => s.ticker)
  const someClipped = seriesList.some((s) => s.dates[0] < latestStart)
  if (someClipped && !(options?.startDate && options.startDate >= latestStart)) {
    const head = options?.startDate
      ? `지정한 시작일(${options.startDate})보다 늦은 ${dates[0]}부터 비교합니다`
      : `비교 기간은 ${dates[0]}부터입니다`
    clipWarnings.push(
      `${head} — ${bindingTickers.join(', ')}의 데이터가 이때부터 존재하기 때문입니다. ` +
        `모든 전략을 같은 기간·같은 데이터로 비교해야 공정하므로, 히스토리가 가장 짧은 자산에 기간을 맞춥니다. ` +
        `더 긴 과거가 필요하면 해당 자산을 장기 히스토리 대체 티커(입력창 자동완성 참고)로 바꾸세요`
    )
  }

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

// v2: Yahoo 해상도 강등(분기봉) 데이터가 v1 캐시에 남아있을 수 있어 버전 범프
const CACHE_PREFIX = 'bt_series_v2_'
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
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()))].filter(
    (t) => t !== '' && t !== CASH_TICKER
  )
  if (unique.length === 0) throw new Error('시장 자산이 없습니다 (CASH만으로는 백테스트 불가)')

  // 역사 월간(-HIST) 자산은 일별 자산과 혼합 불가 — 캘린더 교집합(월초 vs 거래일)이
  // 사실상 공집합이 되어 조용히 왜곡되므로 명시적으로 차단하고 대체 티커를 안내
  const bundleTickers = unique.filter((t) => isBundleTicker(t))
  const dailyTickers = unique.filter((t) => !isBundleTicker(t) && !isCryptoTicker(t))
  if (bundleTickers.length > 0 && dailyTickers.length > 0) {
    throw new Error(
      `역사 월간 자산(${bundleTickers.join(', ')})은 일별 자산(${dailyTickers.join(', ')})과 함께 실행할 수 없습니다 ` +
        '— 해상도가 달라 공통 캘린더가 성립하지 않습니다. 전 전략의 주식을 SPX-HIST, 채권을 UST10-HIST, ' +
        '금을 GOLD-HIST로 바꾸거나, 역사 자산을 빼세요'
    )
  }
  const monthlyExpected = bundleTickers.length > 0

  // 합성 레버리지(-SIM) 해석: 실제 조회 대상 = 비합성 티커 + 합성의 기초 + 금리(^IRX)
  const entryOf = (t: string) => ASSET_CATALOG.find((e) => e.ticker === t)
  const toFetch = new Set<string>()
  let anySynthetic = false
  for (const t of unique) {
    const syn = entryOf(t)?.synthetic
    if (syn) {
      anySynthetic = true
      toFetch.add(syn.base.toUpperCase())
    } else {
      toFetch.add(t)
    }
  }
  if (anySynthetic) toFetch.add(RATE_TICKER)

  const raw = new Map<string, DailySeries>()
  let fetchedFromNetwork = false
  for (const t of toFetch) {
    if (isBundleTicker(t)) {
      // 리포 번들 정적 파일 — 배포 버전이 곧 캐시 버전이라 localStorage 캐시 불필요
      raw.set(t, await fetchBundleSeries(t))
      continue
    }
    if (!options?.forceRefresh) {
      const cached = readCache(t)
      if (cached) {
        raw.set(t, cached)
        continue
      }
    }
    if (fetchedFromNetwork) await sleep(INTER_FETCH_DELAY_MS)
    const source = entryOf(t)?.source
    const fetched = source === 'stooq' ? await fetchStooqSeries(t) : await fetchDailySeries(t)
    fetchedFromNetwork = true
    writeCache(t, fetched)
    raw.set(t, fetched)
  }

  const seriesList: DailySeries[] = unique.map((t) => {
    const syn = entryOf(t)?.synthetic
    if (!syn) return raw.get(t)!
    return buildLeveragedSeries(t, raw.get(syn.base.toUpperCase())!, raw.get(RATE_TICKER)!, syn)
  })

  return alignToCommonCalendar(seriesList, { ...options, monthlyExpected })
}
