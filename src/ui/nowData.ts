/**
 * "현재 신호" 라이브 데이터 수집 — 신호별로 가장 실시간에 가까운 소스를 조회.
 *
 * - 주가: ^SP500TR 일별 종가 (Yahoo /yf 프록시) — 전일까지
 * - 금리: FRED DGS10(10년)·DTB3(3개월) 일별 (/fred 프록시) — 전일까지
 * - CPI: FRED CPIAUCNS 월간 — 최신 발표월 (번들보다 새 달이면 갱신)
 *
 * 부분 실패 허용: 소스별 독립 try/catch — 실패한 필드만 번들 폴백.
 * localStorage 3시간 캐시 (일별 데이터라 그 이상 자주 볼 이유 없음).
 */

import { fetchWithTimeout } from '../fetchUtil'
import type { LiveSnapshot } from './nowSignals'

interface LiveRefs {
  ym: string
  sp500trMonthlyAvg: number | null
  cpi: number
}

const CACHE_KEY = 'bt_now_live_v1'
const CACHE_TTL_MS = 3 * 60 * 60 * 1000

interface CacheEntry {
  fetchedAt: number
  refYm: string
  snapshot: LiveSnapshot
}

function readCache(refYm: string): LiveSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CacheEntry
    if (c.refYm !== refYm || Date.now() - c.fetchedAt > CACHE_TTL_MS) return null
    return c.snapshot
  } catch {
    return null
  }
}

function writeCache(refYm: string, snapshot: LiveSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), refYm, snapshot } satisfies CacheEntry))
  } catch {
    // 최선노력
  }
}

/** FRED CSV → [date, value] 유효 행 (뒤에서부터 최신) */
function parseFredCsv(csv: string): [string, number][] {
  const rows: [string, number][] = []
  for (const line of csv.trim().split('\n').slice(1)) {
    const [d, v] = line.split(',')
    const num = Number(v)
    if (d && Number.isFinite(num) && v !== '') rows.push([d, num])
  }
  return rows
}

async function fetchFred(id: string, cosd: string): Promise<[string, number][]> {
  const res = await fetchWithTimeout(`/fred/fredgraph.csv?id=${id}&cosd=${cosd}`, 15000)
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`)
  return parseFredCsv(await res.text())
}

/**
 * 라이브 스냅샷 수집. refs = history.json meta.liveRefs (체인 기준값).
 * 어떤 소스도 성공하지 못하면 null (호출부는 번들 폴백).
 */
export async function fetchLiveSnapshot(refs: LiveRefs): Promise<LiveSnapshot | null> {
  const cached = readCache(refs.ym)
  if (cached) return cached

  const snap: LiveSnapshot = {}
  const monthStart = `${refs.ym}-01`

  await Promise.all([
    // ^SP500TR 일별 — 번들 기준월 월평균 대비 비율로 체인
    (async () => {
      try {
        if (!refs.sp500trMonthlyAvg) return
        const res = await fetchWithTimeout(`/yf/v8/finance/chart/%5ESP500TR?interval=1d&range=6mo`, 15000)
        if (!res.ok) return
        const j = (await res.json()) as {
          chart?: { result?: { meta?: { gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] }
        }
        const r = j.chart?.result?.[0]
        const ts = r?.timestamp ?? []
        const closes = r?.indicators?.quote?.[0]?.close ?? []
        const off = r?.meta?.gmtoffset ?? 0
        for (let i = ts.length - 1; i >= 0; i--) {
          const c = closes[i]
          if (c != null && c > 0) {
            snap.stock = {
              date: new Date((ts[i] + off) * 1000).toISOString().slice(0, 10),
              trRatio: c / refs.sp500trMonthlyAvg,
            }
            break
          }
        }
      } catch { /* 폴백 */ }
    })(),
    // DGS10 일별
    (async () => {
      try {
        const rows = await fetchFred('DGS10', monthStart)
        const last = rows[rows.length - 1]
        if (last) snap.gs10 = { date: last[0], value: last[1] }
      } catch { /* 폴백 */ }
    })(),
    // DTB3 일별
    (async () => {
      try {
        const rows = await fetchFred('DTB3', monthStart)
        const last = rows[rows.length - 1]
        if (last) snap.tbill3m = { date: last[0], value: last[1] }
      } catch { /* 폴백 */ }
    })(),
    // CPIAUCNS 월간 — YoY 계산 위해 14개월 조회
    (async () => {
      try {
        const [y, m] = refs.ym.split('-').map(Number)
        const cosd = `${y - 2}-${String(m).padStart(2, '0')}-01`
        const rows = await fetchFred('CPIAUCNS', cosd)
        const last = rows[rows.length - 1]
        if (!last) return
        const ym = last[0].slice(0, 7)
        const prevYm = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`
        const prev = rows.find(([d]) => d.slice(0, 7) === prevYm)
        if (prev) snap.cpi = { ym, value: last[1], yoy: (last[1] / prev[1] - 1) * 100 }
      } catch { /* 폴백 */ }
    })(),
  ])

  if (!snap.stock && !snap.gs10 && !snap.tbill3m && !snap.cpi) return null
  writeCache(refs.ym, snap)
  return snap
}
