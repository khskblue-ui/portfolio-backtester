import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer } from 'recharts'
import { NowPanel } from './NowPanel'
import { assessNow, type LiveSnapshot } from './nowSignals'
import { fetchLiveSnapshot } from './nowData'
import { cardCls } from './common'

/**
 * "현재 신호" 탭 — 최신 데이터(주가·금리 일별, CPI 최신 발표월)를 역사 선행조건과
 * 대조한 체크리스트 + 각 신호의 1900~현재 흐름 그래프 (임계선 = 역사 에피소드 실측값).
 */

interface HistoryData {
  meta: { dataEnd: string; liveRefs?: { ym: string; sp500trMonthlyAvg: number | null; cpi: number; capeProxy: number | null; stockRealLast: number } }
  series: { dates: string[]; stock: number[] }
  episodes: { peak: string; recovery: string | null }[]
  macro: {
    cpiYoY: (number | null)[]
    gs10: (number | null)[]
    realRate10: (number | null)[]
    cape: (number | null)[]
    capeProxy?: (number | null)[]
    tbill3m?: (number | null)[]
  }
}

interface ChartSpec {
  title: string
  sub: string
  color: string
  data: { ym: string; v: number | null }[]
  refs: { y: number; label: string; danger?: boolean }[]
  /** y 값 포맷 */
  fmt: (v: number) => string
  domain?: [number | 'auto', number | 'auto']
}

export function NowView({ theme }: { theme: 'light' | 'dark' }) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [liveTried, setLiveTried] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/data/history.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HistoryData) => {
        setData(d)
        if (d.meta.liveRefs) {
          fetchLiveSnapshot(d.meta.liveRefs)
            .then(setLive)
            .finally(() => setLiveTried(true))
        } else setLiveTried(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '로드 실패'))
  }, [])

  const assessment = useMemo(() => (data ? assessNow(data, live ?? undefined) : null), [data, live])

  const axisTickColor = theme === 'dark' ? '#9ca3af' : '#6b7280'
  const tooltipContentStyle = {
    fontSize: 12,
    borderRadius: 8,
    background: theme === 'dark' ? '#1e222d' : '#ffffff',
    border: `1px solid ${theme === 'dark' ? '#363a45' : '#e0e3eb'}`,
  }
  const tooltipLabelStyle = { fontSize: 12, fontWeight: 600, color: theme === 'dark' ? '#e4e4e7' : '#18181b' }

  // ── 신호별 흐름 시리즈 (번들 월간 + 라이브 최신점 1개 부착) ──
  const { charts, bands } = useMemo<{ charts: ChartSpec[]; bands: { x1: string; x2: string }[] }>(() => {
    if (!data) return { charts: [], bands: [] }
    const { dates, stock } = data.series
    const m = data.macro
    const refs = data.meta.liveRefs
    const n = dates.length

    // 다운샘플 (차트당 ~500포인트) — 마지막 포인트는 항상 유지
    const step = Math.max(1, Math.floor(n / 500))
    const mk = (arr: (number | null)[], liveTail?: { label: string; v: number | null }) => {
      const rows: { ym: string; v: number | null }[] = []
      for (let i = 0; i < n; i += step) rows.push({ ym: dates[i], v: arr[i] != null ? Number((arr[i] as number).toFixed(2)) : null })
      if ((n - 1) % step !== 0) rows.push({ ym: dates[n - 1], v: arr[n - 1] != null ? Number((arr[n - 1] as number).toFixed(2)) : null })
      if (liveTail && liveTail.v != null) rows.push({ ym: liveTail.label, v: Number(liveTail.v.toFixed(2)) })
      return rows
    }

    // 1) 실질 낙폭 (%)
    const dd: (number | null)[] = []
    let peak = -Infinity
    for (let i = 0; i < n; i++) {
      peak = Math.max(peak, stock[i])
      dd.push((stock[i] / peak - 1) * 100)
    }
    const cpiAdj = live?.cpi && refs && live.cpi.ym > refs.ym ? live.cpi.value / refs.cpi : 1
    const stockRealLive = live?.stock && refs ? refs.stockRealLast * (live.stock.trRatio / cpiAdj) : null
    const ddLive = stockRealLive != null ? (stockRealLive / Math.max(peak, stockRealLive) - 1) * 100 : null

    // 2) CAPE (실측 + 프록시 + 라이브)
    const capeArr = m.capeProxy ?? m.cape
    const capeLive = stockRealLive != null && refs?.capeProxy != null ? refs.capeProxy * (stockRealLive / refs.stockRealLast) : null

    // 3) CPI YoY (+ 라이브 새 발표월)
    const cpiLive = live?.cpi && refs && live.cpi.ym > refs.ym ? live.cpi.yoy : null

    // 4) 실질금리
    const lastYoY = cpiLive ?? lastOf(m.cpiYoY)
    const rrLive = live?.gs10 && lastYoY != null ? live.gs10.value - lastYoY : null

    // 5) 장단기 금리차
    const spreadArr = dates.map((_, i) => (m.gs10[i] != null && m.tbill3m?.[i] != null ? (m.gs10[i] as number) - (m.tbill3m[i] as number) : null))
    const spreadLive = live?.gs10 && live?.tbill3m ? live.gs10.value - live.tbill3m.value : null

    // 역사 하락 구간 음영 — 카테고리 축이라 다운샘플된 라벨로 스냅
    const sampled: string[] = []
    for (let i = 0; i < n; i += step) sampled.push(dates[i])
    if ((n - 1) % step !== 0) sampled.push(dates[n - 1])
    const snap = (ym: string) => sampled.find((d) => d >= ym) ?? sampled[sampled.length - 1]
    const bands = data.episodes.map((e) => ({ x1: snap(e.peak), x2: snap(e.recovery ?? dates[n - 1]) }))

    const liveLabel = live?.stock?.date ?? live?.gs10?.date ?? '라이브'
    const charts: ChartSpec[] = [
      {
        title: '실질 전고점 대비 낙폭',
        sub: '음수 구간 진입선 = −25% (역사 7개 구간의 검출 기준)',
        color: theme === 'dark' ? '#3987e5' : '#2a78d6',
        data: mk(dd, { label: liveLabel, v: ddLive }),
        refs: [{ y: -25, label: '−25% 구간 기준', danger: true }],
        fmt: (v) => `${v.toFixed(1)}%`,
        domain: ['auto', 0],
      },
      {
        title: 'CAPE (실측 1881~2023 + 프록시)',
        sub: '기준선 = 역사 하락 시작점: 1968년 24 · 1929년 32.6 · 2000년 44',
        color: theme === 'dark' ? '#a3a3a3' : '#525252',
        data: mk(capeArr, { label: liveLabel, v: capeLive }),
        refs: [
          { y: 24, label: '1968' },
          { y: 32.6, label: '1929', danger: true },
          { y: 44, label: '2000', danger: true },
        ],
        fmt: (v) => v.toFixed(1),
      },
      {
        title: 'CPI 인플레이션 (전년동월비)',
        sub: '기준선 = 주의 3% · A형 본격화 5%',
        color: theme === 'dark' ? '#f97316' : '#c2410c',
        data: mk(m.cpiYoY, live?.cpi && refs && live.cpi.ym > refs.ym ? { label: live.cpi.ym, v: cpiLive } : undefined),
        refs: [
          { y: 3, label: '3%' },
          { y: 5, label: '5% A형', danger: true },
        ],
        fmt: (v) => `${v.toFixed(1)}%`,
      },
      {
        title: '실질 10년 금리 (명목 − 인플레)',
        sub: '0 아래 = 실질 마이너스 (원인이 인플레발이면 A형 신호)',
        color: theme === 'dark' ? '#a78bfa' : '#7c3aed',
        data: mk(m.realRate10, { label: liveLabel, v: rrLive }),
        refs: [{ y: 0, label: '0', danger: true }],
        fmt: (v) => `${v.toFixed(1)}%p`,
      },
      {
        title: '장단기 금리차 (10년 − 3개월)',
        sub: '0 아래 = 역전 (1969·1973·1980·2000·2007·2019 침체 선행)',
        color: theme === 'dark' ? '#2dd4bf' : '#0f766e',
        data: mk(spreadArr, { label: liveLabel, v: spreadLive }),
        refs: [{ y: 0, label: '역전', danger: true }],
        fmt: (v) => `${v.toFixed(2)}%p`,
      },
    ]
    return { charts, bands }

    function lastOf(arr: (number | null)[]): number | null {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]
      return null
    }
  }, [data, live, theme])

  if (error) {
    return <div className={`${cardCls} p-6 text-sm text-red-700 dark:text-red-300`}>데이터 로드 실패: {error}</div>
  }
  if (!data || !assessment || !liveTried) {
    return <div className={`${cardCls} p-6 text-sm text-zinc-500`}>최신 데이터 조회 중… (주가·금리 일별 + CPI 최신 발표월)</div>
  }

  return (
    <div className="space-y-5">
      {!assessment.live && (
        <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg px-4 py-3 text-xs text-amber-900 dark:text-amber-200/90">
          라이브 조회(야후·FRED)에 실패해 번들 데이터({data.meta.dataEnd}) 기준으로 표시 중입니다 — 네트워크 상태를 확인하거나 잠시 후 새로고침하세요.
        </div>
      )}

      <NowPanel assessment={assessment} />

      {/* 신호별 흐름 그래프 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {charts.map((c) => (
          <div key={c.title} className={`${cardCls} p-4`}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.title}</h3>
            <p className="text-[11px] text-zinc-400 mb-2">{c.sub} · 음영 = 역사 하락 구간 · 1900 ~ 현재</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={c.data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} minTickGap={55} tickFormatter={(d: string) => d.slice(0, 4)} />
                <YAxis tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} width={42} domain={c.domain ?? ['auto', 'auto']} />
                <Tooltip
                  formatter={(v) => [c.fmt(Number(v)), c.title]}
                  labelStyle={tooltipLabelStyle}
                  contentStyle={tooltipContentStyle}
                />
                {bands.map((b) => (
                  <ReferenceArea key={`${b.x1}-${b.x2}`} x1={b.x1} x2={b.x2} fill="rgba(227,73,72,0.10)" stroke="none" />
                ))}
                {c.refs.map((r) => (
                  <ReferenceLine
                    key={r.label}
                    y={r.y}
                    stroke={r.danger ? '#dc2626' : axisTickColor}
                    strokeDasharray="4 3"
                    strokeOpacity={0.6}
                    label={{ value: r.label, position: 'insideTopRight', fontSize: 10, fill: r.danger ? '#dc2626' : axisTickColor }}
                  />
                ))}
                <Line type="monotone" dataKey="v" stroke={c.color} strokeWidth={1.6} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-zinc-400 leading-relaxed">
        소스·실시간성 — 주가: ^SP500TR 일별 종가(야후, 전일까지) · 금리: FRED DGS10·DTB3 일별(전일까지) · CPI: FRED CPIAUCNS
        최신 발표월(통상 1~2개월 지연) · 과거 흐름: 검증된 번들 데이터(1900~{data.meta.dataEnd}, 월평균). 라이브 값은 번들
        기준값 대비 비율로 체인되며 3시간 캐시됩니다. CAPE는 2023-06 이후 프록시(근사) — 카드의 판정 이유 참조.
      </p>
    </div>
  )
}
