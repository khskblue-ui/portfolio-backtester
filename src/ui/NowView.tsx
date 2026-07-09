import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer } from 'recharts'
import { Flame } from 'lucide-react'
import { NowPanel } from './NowPanel'
import { assessNow, type LiveSnapshot } from './nowSignals'
import { fetchLiveSnapshot } from './nowData'
import { ManiaStoryModal } from './ManiaStoryModal'
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
    tips10?: (number | null)[]
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
  /** 차트별 하락 구간 음영 (기본 = 전체 1900~ 밴드) */
  bands?: { x1: string; x2: string }[]
  /** 데이터 범위 표기 (기본 '1900 ~ 현재') */
  range?: string
}

export function NowView({ theme }: { theme: 'light' | 'dark' }) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [liveTried, setLiveTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maniaOpen, setManiaOpen] = useState(false)

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
    const round2 = (x: number | null | undefined) => (x != null ? Number(x.toFixed(2)) : null)
    const mk = (arr: (number | null)[], liveTail?: { label: string; v: number | null }) => {
      const rows: { ym: string; v: number | null }[] = []
      for (let i = 0; i < n; i += step) rows.push({ ym: dates[i], v: round2(arr[i]) })
      if ((n - 1) % step !== 0) rows.push({ ym: dates[n - 1], v: round2(arr[n - 1]) })
      if (liveTail && liveTail.v != null) rows.push({ ym: liveTail.label, v: round2(liveTail.v) })
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

    // 4) 실질금리 — 사전적 TIPS 단일 (1997 도입 · FRED 2003~). 월간 그대로 (~280포인트)
    const tipsStart = m.tips10 ? m.tips10.findIndex((v) => v != null) : -1
    const tipsRows: { ym: string; v: number | null }[] =
      tipsStart >= 0 ? dates.slice(tipsStart).map((ym, k) => ({ ym, v: round2(m.tips10![tipsStart + k]) })) : []
    if (live?.tips && tipsRows.length > 0) tipsRows.push({ ym: live.tips.date, v: round2(live.tips.value) })
    // TIPS 차트 전용 음영: 2003 이후와 겹치는 구간만, 시작점은 데이터 시작으로 클램프
    const tipsBands =
      tipsStart >= 0
        ? data.episodes
            .filter((e) => (e.recovery ?? dates[n - 1]) >= dates[tipsStart])
            .map((e) => ({
              x1: e.peak >= dates[tipsStart] ? e.peak : dates[tipsStart],
              x2: e.recovery ?? tipsRows[tipsRows.length - 1].ym,
            }))
        : []

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
        title: '실질 10년 금리 — 사전적 TIPS',
        sub: '시장의 실질 할인율 (TIPS는 1997 도입 · 데이터 2003~). 0% 미만 = 초완화(2020-21년형) · 2.5%+ = 긴축적(2022년형). 그 이전 시대의 실질금리(사후적)는 역사 연구 탭 참고',
        color: theme === 'dark' ? '#34d399' : '#059669',
        data: tipsRows,
        bands: tipsBands,
        range: '2003 ~ 현재',
        refs: [
          { y: 0, label: '0 초완화↓' },
          { y: 2.5, label: '2.5 긴축적', danger: true },
        ],
        fmt: (v) => `${v.toFixed(2)}%`,
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

      {/* 특집 연결 — 밸류에이션·집중도 문맥에서 역사 광기 사례와 비교 */}
      <button
        onClick={() => setManiaOpen(true)}
        className="w-full flex items-center justify-between gap-3 rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-white dark:bg-[#1e222d] hover:border-[#e34948]/60 px-4 py-2.5 text-left group"
      >
        <span className="flex items-center gap-2 text-[12.5px] text-zinc-600 dark:text-zinc-300 min-w-0">
          <Flame className="w-4 h-4 text-[#e34948] flex-shrink-0" />
          <span className="truncate">
            <b className="text-zinc-800 dark:text-zinc-100">특집: 광기의 해부</b> — 지금의 밸류에이션·집중도, 닷컴·서브프라임의 트리거와 비교해 읽기
          </span>
        </span>
        <span className="text-xs font-semibold text-[#e34948] group-hover:underline flex-shrink-0">읽기 →</span>
      </button>

      {maniaOpen && <ManiaStoryModal onClose={() => setManiaOpen(false)} />}

      {/* 신호별 흐름 그래프 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {charts.map((c) => (
          <div key={c.title} className={`${cardCls} p-4`}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.title}</h3>
            <p className="text-[11px] text-zinc-400 mb-2">{c.sub} · 음영 = 역사 하락 구간 · {c.range ?? '1900 ~ 현재'}</p>
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
                {(c.bands ?? bands).map((b) => (
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
                <Line type="monotone" dataKey="v" name={c.title} stroke={c.color} strokeWidth={1.6} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-zinc-400 leading-relaxed">
        소스·실시간성 — 주가: ^SP500TR 일별 종가(야후, 전일까지) · 금리: FRED DGS10·DTB3·DFII10(TIPS) 일별(전일까지) · CPI: FRED CPIAUCNS
        최신 발표월(통상 1~2개월 지연) · 과거 흐름: 검증된 번들 데이터(1900~{data.meta.dataEnd}, 월평균). 라이브 값은 번들
        기준값 대비 비율로 체인되며 3시간 캐시됩니다. CAPE는 2023-06 이후 프록시(근사) — 카드의 판정 이유 참조.
      </p>
    </div>
  )
}
