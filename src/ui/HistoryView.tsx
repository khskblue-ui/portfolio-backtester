import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Brush,
} from 'recharts'
import { FlaskConical, CalendarRange, BookOpen, Flame } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { EraStoryModal } from './EraStoryModal'
import { ERA_STORIES } from './eraStories'
import { ERA_TIMELINES, ERA_MARKERS } from './eraTimelines'
import { ManiaStoryModal } from './ManiaStoryModal'
import { MANIA_STORY } from './maniaStory'
import { cardCls, btnGhostCls, fmtSignedPct } from './common'
import { EPISODE_INFO } from './episodeInfo'
import { CURATED_ERAS, type CuratedEra } from './curatedEras'
import { fetchNasdaqMonthly, fetchNdx100Monthly, fetchGspcDailyWindow, type NasdaqSeries, type DailySlice } from './historyExtra'
import { histEraStrategies, type StrategyConfig } from '@/core'

/**
 * 역사 연구 뷰 — 1900년 이후 미국 주식 "실질 총수익" 기준 장기 음수 구간과
 * 그 구간에서의 자산군(주식·장기국채·금) 추이 + 매크로 배경(CPI·금리·CAPE).
 *
 * 데이터: public/data/history.json (Shiller 월간 미러 + 금 월간, 둘 다 ODC-PDDL;
 * scripts/build-history.mjs로 재현 가능 생성 — 구간 경계는 데이터에서 직접 검출,
 * 매크로는 앵커 어서션으로 신뢰도 검증). 상세 근거: docs/research/negative-real-return-eras.md
 */

interface EpisodeAssets {
  toTroughPct: number | null
  toRecoveryPct: number | null
}
interface Episode {
  peak: string
  trough: string
  recovery: string | null
  underwaterMonths: number
  depthPct: number
  assets: { stock: EpisodeAssets; bond: EpisodeAssets; gold: EpisodeAssets; bill?: EpisodeAssets }
}
interface HistoryData {
  meta: { sources: string[]; method: Record<string, string>; dataEnd: string }
  series: {
    dates: string[]
    stock: number[]
    bond: (number | null)[]
    gold: (number | null)[]
    bill: (number | null)[]
    stockNom: number[]
    bondNom: (number | null)[]
    goldNom: (number | null)[]
    billNom: (number | null)[]
  }
  macro: {
    cpiYoY: (number | null)[]
    gs10: (number | null)[]
    realRate10: (number | null)[]
    cape: (number | null)[]
    capeProxy?: (number | null)[]
    tbill3m?: (number | null)[]
  }
  episodes: Episode[]
}


const TYPE_LABEL = {
  A: { text: '인플레이션형', cls: 'text-amber-700 dark:text-amber-400' },
  B: { text: '밸류에이션 붕괴형', cls: 'text-red-700 dark:text-red-400' },
}

// 큐레이션 구간(금태환 이후 상승·이행기)의 유형 배지 — 검출 에피소드의 A/B와 별개
const KIND_LABEL = {
  bull: { text: '대세 상승', cls: 'text-emerald-700 dark:text-emerald-400' },
  cycle: { text: '붐-버스트', cls: 'text-sky-700 dark:text-sky-400' },
  bear: { text: '하락(미검출)', cls: 'text-amber-700 dark:text-amber-400' },
}

/**
 * 통합 시대 뷰모델 — 검출 에피소드(kind 'crash')와 큐레이션 구간을 한 배열로.
 * 큐레이션 구간은 에피소드와 동형으로 물질화한다(start가 peak 자리, end가 recovery
 * 자리): 상세 창 계산·정규화·연대기 키·백테스트 버튼 등 기존 파이프라인을 그대로
 * 재사용하기 위함. 수치는 번들 시리즈에서 런타임 실측.
 */
interface EraView extends Episode {
  kind: 'crash' | 'bull' | 'cycle' | 'bear'
  ongoing: boolean
  title: string
  cause: string
  /** 큐레이션 전용: 구간 실질 수익률·연율·구간 내 최대 조정(월간) */
  stockRetPct: number | null
  annualPct: number | null
  maxDipPct: number | null
}

const SERIES_COLORS = {
  stock: { light: '#2a78d6', dark: '#3987e5' },
  bond: { light: '#1baf7a', dark: '#199e70' },
  gold: { light: '#eda100', dark: '#c98500' },
  bill: { light: '#64748b', dark: '#94a3b8' },
  cpi: { light: '#c2410c', dark: '#f97316' },
  rate: { light: '#0f766e', dark: '#2dd4bf' },
  real: { light: '#7c3aed', dark: '#a78bfa' },
  cape: { light: '#525252', dark: '#a3a3a3' },
}

type Basis = 'real' | 'nominal'

export function HistoryView({
  theme,
  onExplore,
}: {
  theme: 'light' | 'dark'
  onExplore: (startDate: string, endDate: string, note: string, presetStrategies?: StrategyConfig[]) => void
}) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [basis, setBasis] = useState<Basis>('real')
  const [storyOpen, setStoryOpen] = useState(false)
  const [maniaOpen, setManiaOpen] = useState(false)
  // 연대기("흐름 따라가기")에서 선택된 국면 — 위 상세 차트 2개에 음영으로 반영.
  // 구간 변경 시 선택 지점(setSelected 호출부)에서 함께 리셋한다
  const [phaseIdx, setPhaseIdx] = useState<number | null>(null)
  // 국면 선택 시 상세 차트를 해당 국면 ±6개월로 확대(자산은 국면 시작=100 재정규화).
  // false로 두면 전체 구간(고점−12 ~ 회복+12) 눈금을 유지한다
  const [phaseZoom, setPhaseZoom] = useState(true)
  // 국면 확대 중 "일별 확대" 스트립(^GSPC 일별, 1927-12~) — 국면이 바뀌면 끔(캐시는 유지)
  const [daily, setDaily] = useState<{ status: 'off' | 'loading' | 'on' | 'fail'; slice?: DailySlice | null }>({ status: 'off' })
  // 개요 차트 기간 확대(브러시) — 인덱스는 overviewData 기준. 밴드 클램프·축 라벨에 사용.
  // 브러시 자체는 비제어로 두고, 리셋은 key 재마운트(brushEpoch)로 처리한다.
  // 주의: recharts는 data 배열의 "참조"가 바뀌면 브러시 내부 창을 onChange 호출 없이
  // 전체 범위로 되돌린다 — 그래서 데이터 정체성이 바뀌는 모든 조작(실질/명목 전환,
  // 나스닥 토글·도착)에서 resetZoom()을 함께 호출해 zoomRange가 어긋나지 않게 한다
  const [zoomRange, setZoomRange] = useState<{ s: number; e: number } | null>(null)
  const [brushEpoch, setBrushEpoch] = useState(0)
  const resetZoom = () => {
    setZoomRange(null)
    setPresetKey('전체')
    setBrushEpoch((k) => k + 1)
  }
  // 시대 프리셋 칩 — 9px 브러시 손잡이의 터치 조작 한계 보완 (워크벤치 기간 칩 패턴 재사용).
  // 비제어 브러시와의 동기화: zoomRange 변경 + epoch 재마운트 시 Brush에 start/endIndex를 넘겨 창을 맞춘다
  const [presetKey, setPresetKey] = useState<string>('전체')
  // 터치 기기(coarse pointer): 툴팁은 탭한 지점에서만 표시하고(hover 잔상 방지),
  // 차트 간 툴팁 동기화도 끈다
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])
  const tooltipTrigger = coarse ? ('click' as const) : ('hover' as const)
  const detailSyncId = coarse ? undefined : 'era-detail'
  // 모바일 폭(<lg): 매크로 차트의 CAPE를 별도 스트립으로 분리해 이중 축의 폭 잠식을 줄임
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // 유령 툴팁 소거 — recharts v3는 창 좌표 기반으로 툴팁을 켜서 pointer-events 차단이
  // 안 통함(실측). 차트 재마운트로 지우는 방식은 touchstart~click 사이에 DOM이 바뀌어
  // 주변 버튼의 첫 탭이 무시되는 부작용이 있었으므로(모바일 실사용 보고), 재마운트
  // 없이 CSS로만 숨긴다: 차트 밖 터치 = 숨김, 차트 위 터치 = 다시 표시.
  // 같은 값 setState는 리렌더를 만들지 않아 일반 탭 비용이 0에 수렴한다.
  const [tipDismissed, setTipDismissed] = useState(false)
  useEffect(() => {
    if (!coarse) return
    const onTouch = (ev: TouchEvent) => {
      const t = ev.target as Element | null
      setTipDismissed(!(t && t.closest('.recharts-responsive-container')))
    }
    document.addEventListener('touchstart', onTouch, { passive: true })
    return () => document.removeEventListener('touchstart', onTouch)
  }, [coarse])
  // 나스닥 비교 오버레이 — 종합(가격, 1971~, FRED) / 나스닥100 총수익(배당 포함, 1999~, 야후)
  // 선택 시 처음 한 번 조회. overlaySeries: undefined = 미조회(로딩), null = 실패
  const [overlay, setOverlay] = useState<'off' | 'comp' | 'ndx100'>('off')
  const [overlaySeries, setOverlaySeries] = useState<{ comp?: NasdaqSeries | null; ndx100?: NasdaqSeries | null }>({})
  const overlayData: NasdaqSeries | null | undefined = overlay === 'off' ? undefined : overlaySeries[overlay]
  const overlayOn = overlay !== 'off' && overlayData != null
  const overlayLoading = overlay !== 'off' && overlayData === undefined
  const overlayFail = overlay !== 'off' && overlayData === null
  const selectOverlay = (m: 'off' | 'comp' | 'ndx100') => {
    if (m === overlay && !overlayFail) return
    resetZoom()
    setOverlay(m)
    if (m !== 'off' && overlaySeries[m] == null) {
      // 미조회이거나 직전에 실패한 경우 — 재조회 (undefined로 되돌려 로딩 표시)
      setOverlaySeries((cur) => ({ ...cur, [m]: undefined }))
      const fetcher = m === 'comp' ? fetchNasdaqMonthly : fetchNdx100Monthly
      void fetcher().then((s) => setOverlaySeries((cur) => ({ ...cur, [m]: s })))
    }
  }

  const [retryTick, setRetryTick] = useState(0)
  useEffect(() => {
    fetch('/data/history.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '로드 실패'))
  }, [retryTick])

  // 구간 선택 시 상세 카드로 스크롤 — 상세가 카드 그리드 아래에 있어 선택해도
  // 화면 변화가 안 보이던 문제 (차트 밴드 클릭 안내 "클릭해 상세 보기"의 실효성)
  useEffect(() => {
    if (selected) {
      const t = window.setTimeout(() => document.getElementById('era-detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      return () => window.clearTimeout(t)
    }
  }, [selected])

  // 국면 이동(및 해제)의 단일 통로 — 확대는 기본값(켜짐)으로 되돌리고 일별 스트립은 끈다
  const changePhase = (next: number | null) => {
    setPhaseIdx(next)
    setPhaseZoom(true)
    setDaily({ status: 'off' })
  }

  const axisTickColor = theme === 'dark' ? '#9ca3af' : '#6b7280'
  const c = (k: keyof typeof SERIES_COLORS) => SERIES_COLORS[k][theme]

  // recharts 기본 툴팁은 흰 배경에 글자색을 부모에서 상속 — 다크에서 날짜 라벨이
  // 밝은 글자색을 물려받아 안 보이므로 배경·글자색을 테마에 맞게 명시
  const tooltipContentStyle = {
    fontSize: 12,
    borderRadius: 8,
    background: theme === 'dark' ? '#1e222d' : '#ffffff',
    border: `1px solid ${theme === 'dark' ? '#363a45' : '#e0e3eb'}`,
  }
  const tooltipLabelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: theme === 'dark' ? '#e4e4e7' : '#18181b',
  }

  // 기준(실질/명목)에 따른 시리즈 선택
  const pick = useMemo(() => {
    if (!data) return null
    const s = data.series
    return basis === 'real'
      ? { stock: s.stock, bond: s.bond, gold: s.gold, bill: s.bill }
      : { stock: s.stockNom, bond: s.bondNom, gold: s.goldNom, bill: s.billNom }
  }, [data, basis])

  // 전체 차트 데이터 (주식 총수익, 로그 스케일) — 마지막 포인트는 항상 유지하고,
  // 밴드 경계(ym)는 다운샘플된 라벨로 스냅 (카테고리 축에서 라벨이 사라지면 밴드도 사라짐)
  const { fullRows, snapYm } = useMemo(() => {
    const empty = { fullRows: [] as { ym: string; stock: number | null; nasdaq: number | null }[], snapYm: (ym: string) => ym }
    if (!data || !pick) return empty
    const { dates } = data.series
    const n = dates.length
    const step = Math.max(1, Math.floor(n / 800))
    // 나스닥 오버레이 — 해당 지수의 시작월(종합 1971-02 / 나스닥100 1999-03)의
    // S&P500 값에 이어붙임(co-basing). 실질 모드의 CPI 디플레이터는 번들의
    // 명목/실질 비에서 복원: CPI(t)/CPI(b) = (stockNom(t)/stock(t)) ÷ (stockNom(b)/stock(b))
    let nasdaqAt: (i: number) => number | null = () => null
    if (overlayOn && overlayData) {
      const nmap = new Map(overlayData.ym.map((m, k) => [m, overlayData.value[k]]))
      const baseYm = overlayData.ym[0]
      const b = dates.indexOf(baseYm)
      const baseVal = nmap.get(baseYm)
      const sBase = b >= 0 ? pick.stock[b] : null
      if (b >= 0 && baseVal && sBase != null) {
        const cpiF = (i: number) => {
          const nom = data.series.stockNom[i]
          const real = data.series.stock[i]
          return nom != null && real != null && real > 0 ? nom / real : null
        }
        const fb = cpiF(b)
        nasdaqAt = (i) => {
          if (i < b) return null
          const v = nmap.get(dates[i])
          if (v == null) return null
          if (basis === 'nominal') return (v / baseVal) * sBase
          const ft = cpiF(i)
          return ft != null && fb != null ? (v / baseVal) * (fb / ft) * sBase : null
        }
      }
    }
    const rows: { ym: string; stock: number | null; nasdaq: number | null }[] = []
    for (let i = 0; i < n; i += step) rows.push({ ym: dates[i], stock: pick.stock[i], nasdaq: nasdaqAt(i) })
    if ((n - 1) % step !== 0) rows.push({ ym: dates[n - 1], stock: pick.stock[n - 1], nasdaq: nasdaqAt(n - 1) })
    const sampled = rows.map((r) => r.ym)
    const snapYm = (ym: string) => sampled.find((d) => d >= ym) ?? sampled[sampled.length - 1]
    return { fullRows: rows, snapYm }
  }, [data, pick, basis, overlayData, overlayOn])

  // 시대 프리셋 적용 — fullRows(다운샘플) 인덱스로 변환해 zoomRange 설정
  const applyPreset = (key: string, start: string | null, end: string | null) => {
    if (!start || !end) {
      resetZoom()
      return
    }
    if (fullRows.length === 0) return
    let s = fullRows.findIndex((r) => r.ym >= start)
    if (s < 0) s = 0
    let e = fullRows.length - 1
    for (let i = fullRows.length - 1; i >= 0; i--) {
      if (fullRows[i].ym <= end) {
        e = i
        break
      }
    }
    if (e <= s) return
    setZoomRange({ s, e })
    setPresetKey(key)
    setBrushEpoch((k) => k + 1)
  }
  const periodChips: { key: string; start: string | null; end: string | null }[] = [
    { key: '전체', start: null, end: null },
    { key: '대공황', start: '1928-01', end: '1937-12' },
    { key: '스태그플레이션', start: '1968-01', end: '1985-12' },
    { key: '닷컴·금융위기', start: '1999-01', end: '2013-12' },
    {
      key: '최근 20년',
      start: data ? `${Number(data.meta.dataEnd.slice(0, 4)) - 20}${data.meta.dataEnd.slice(4)}` : null,
      end: data?.meta.dataEnd ?? null,
    },
  ]

  // 보이는 창(확대) 데이터 — 비교 오버레이가 켜진 채 확대하면 "구간 시작 = 100"으로
  // 재정규화해 두 선이 같은 출발선에서 시작하게 한다 (나스닥은 구간 내 첫 겹침 달에
  // S&P500 값으로 이어붙임). 비교가 꺼져 있으면 절대 눈금(1900=100)을 유지한다.
  // 브러시는 아래 별도 미니 차트에 있어(fullRows 고정) 이 데이터 교체에 영향받지 않는다.
  const rebased = overlayOn && zoomRange != null
  const viewRows = useMemo(() => {
    if (!zoomRange || fullRows.length === 0) return fullRows
    const s = Math.max(0, Math.min(zoomRange.s, fullRows.length - 1))
    const e = Math.max(s, Math.min(zoomRange.e, fullRows.length - 1))
    const rows = fullRows.slice(s, e + 1)
    if (!overlayOn) return rows
    const s0 = rows[0]?.stock
    if (s0 == null || !(s0 > 0)) return rows
    const join = rows.find((r) => r.nasdaq != null)
    const nJoin = join?.nasdaq ?? null
    const jStockRel = join?.stock != null ? join.stock / s0 : null
    return rows.map((r) => ({
      ym: r.ym,
      stock: r.stock != null ? (r.stock / s0) * 100 : null,
      nasdaq: r.nasdaq != null && nJoin != null && jStockRel != null ? (r.nasdaq / nJoin) * jStockRel * 100 : null,
    }))
  }, [fullRows, zoomRange, overlayOn])

  // 검출 에피소드 + 콘텐츠(서사·연대기)가 준비된 큐레이션 구간의 통합 목록 (시간순).
  // 콘텐츠 게이팅: 서사와 연대기가 둘 다 등록된 구간만 노출 — 집필이 끝나는 대로
  // curatedEras.ts의 항목이 한 구간씩 화면에 켜진다
  const eras: EraView[] = useMemo(() => {
    if (!data) return []
    const { dates, stock } = data.series
    const fromEpisode = (e: Episode): EraView => ({
      ...e,
      kind: 'crash',
      ongoing: false,
      title: EPISODE_INFO[e.peak]?.title ?? e.peak,
      cause: EPISODE_INFO[e.peak]?.cause ?? '',
      stockRetPct: null,
      annualPct: null,
      maxDipPct: null,
    })
    const fromCurated = (c: CuratedEra): EraView | null => {
      const i = dates.indexOf(c.start)
      const endYm = c.end ?? data.meta.dataEnd
      const j = dates.indexOf(endYm)
      if (i < 0 || j <= i) return null
      const months = j - i
      const ret = (v0: number | null, v1: number | null) => (v0 != null && v1 != null && v0 > 0 ? (v1 / v0 - 1) * 100 : null)
      let dip = 0
      let pk = i
      let troughI = i
      for (let k = i; k <= j; k++) {
        if (stock[k] > stock[pk]) pk = k
        const dd = stock[k] / stock[pk] - 1
        if (dd < dip) {
          dip = dd
          troughI = k
        }
      }
      const stockRet = ret(stock[i], stock[j])
      const seg = (arr: (number | null)[]): EpisodeAssets => ({ toTroughPct: null, toRecoveryPct: ret(arr[i], arr[j]) })
      return {
        peak: c.start,
        trough: dates[troughI],
        recovery: c.end,
        underwaterMonths: months,
        depthPct: dip * 100,
        assets: { stock: seg(data.series.stock), bond: seg(data.series.bond), gold: seg(data.series.gold), bill: seg(data.series.bill) },
        kind: c.kind,
        ongoing: c.end == null,
        title: c.title,
        cause: c.cause,
        stockRetPct: stockRet,
        annualPct: stockRet != null ? (Math.pow(1 + stockRet / 100, 12 / months) - 1) * 100 : null,
        maxDipPct: dip * 100,
      }
    }
    const curated = CURATED_ERAS.filter((c) => ERA_TIMELINES[c.start] && ERA_STORIES[c.start])
      .map(fromCurated)
      .filter((v): v is EraView => v != null)
    return [...data.episodes.map(fromEpisode), ...curated].sort((a, b) => (a.peak < b.peak ? -1 : 1))
  }, [data])

  const selectedEp = eras.find((e) => e.peak === selected) ?? null
  const timeline = useMemo(() => (selectedEp ? ERA_TIMELINES[selectedEp.peak] ?? [] : []), [selectedEp])

  // 상세 차트: 고점 12개월 전 ~ 회복 12개월 후, 고점 = 100 정규화 + 매크로
  const detailData = useMemo(() => {
    if (!data || !pick || !selectedEp) return []
    const { dates } = data.series
    const peakI = dates.indexOf(selectedEp.peak)
    const recI = selectedEp.recovery ? dates.indexOf(selectedEp.recovery) : dates.length - 1
    const from = Math.max(0, peakI - 12)
    const to = Math.min(dates.length - 1, recI + 12)
    const normAt = (arr: (number | null)[], i: number) =>
      arr[i] != null && arr[peakI] != null ? Number((((arr[i] as number) / (arr[peakI] as number)) * 100).toFixed(2)) : null
    const rows = []
    for (let i = from; i <= to; i++) {
      rows.push({
        ym: dates[i],
        'S&P500 총수익': normAt(pick.stock, i),
        '미 10년 국채': normAt(pick.bond, i),
        '금 현물': normAt(pick.gold, i),
        '현금(3개월물)': normAt(pick.bill, i),
        'CPI 인플레': data.macro.cpiYoY[i],
        '10년물 금리': data.macro.gs10[i],
        실질금리: data.macro.realRate10[i],
        CAPE: data.macro.cape[i],
      })
    }
    return rows
  }, [data, pick, selectedEp])

  // 국면 확대 데이터 — 선택 국면 ±6개월 창, 자산은 "국면 시작 = 100" 재정규화.
  // 진단(2026-08-25): 전체 창(십수 년) 위의 얇은 음영만으로는 국면 내 움직임이
  // 재생되지 않아, 확대·재정규화를 기본 동작으로 한다 (전체 보기 토글 제공)
  const zoomData = useMemo(() => {
    if (!data || !pick || !selectedEp || phaseIdx == null) return null
    const ph = timeline[phaseIdx]
    if (!ph) return null
    const { dates } = data.series
    const baseI = dates.indexOf(ph.from)
    const toI = dates.indexOf(ph.to)
    if (baseI < 0 || toI < 0) return null
    const from = Math.max(0, baseI - 6)
    const to = Math.min(dates.length - 1, toI + 6)
    const normAt = (arr: (number | null)[], i: number) =>
      arr[i] != null && arr[baseI] != null && (arr[baseI] as number) > 0
        ? Number((((arr[i] as number) / (arr[baseI] as number)) * 100).toFixed(2))
        : null
    const rows = []
    for (let i = from; i <= to; i++) {
      rows.push({
        ym: dates[i],
        'S&P500 총수익': normAt(pick.stock, i),
        '미 10년 국채': normAt(pick.bond, i),
        '금 현물': normAt(pick.gold, i),
        '현금(3개월물)': normAt(pick.bill, i),
        'CPI 인플레': data.macro.cpiYoY[i],
        '10년물 금리': data.macro.gs10[i],
        실질금리: data.macro.realRate10[i],
        CAPE: data.macro.cape[i],
      })
    }
    return rows
  }, [data, pick, selectedEp, phaseIdx, timeline])

  const zoomed = phaseIdx != null && phaseZoom && zoomData != null && zoomData.length > 0
  const chartData = zoomed && zoomData ? zoomData : detailData

  // 선택 국면을 현재 차트 범위로 클램프한 음영 구간
  const phaseBand = useMemo(() => {
    const ph = phaseIdx != null ? timeline[phaseIdx] : null
    if (!ph || chartData.length === 0) return null
    const first = chartData[0].ym as string
    const last = chartData[chartData.length - 1].ym as string
    const x1 = ph.from < first ? first : ph.from
    const x2 = ph.to > last ? last : ph.to
    return x1 <= x2 ? { x1, x2 } : null
  }, [phaseIdx, timeline, chartData])

  // 이벤트 마커 — 확대 모드에서만 (전체 창에서는 라벨이 겹쳐 소음이 됨)
  const markersInView = useMemo(() => {
    if (!zoomed || !selectedEp || chartData.length === 0) return []
    const first = chartData[0].ym as string
    const last = chartData[chartData.length - 1].ym as string
    return (ERA_MARKERS[selectedEp.peak] ?? []).filter((m) => m.ym >= first && m.ym <= last)
  }, [zoomed, selectedEp, chartData])

  // 선택 국면의 자동 실측 스탯 — 국면 시작→끝의 자산 변화율과 매크로 이동
  // (연대기 카드의 수기 '데이터:' 요약과 상호 검증되는 번들 직접 계산값)
  const phaseStats = useMemo(() => {
    if (!data || !pick || phaseIdx == null) return null
    const ph = timeline[phaseIdx]
    if (!ph) return null
    const { dates } = data.series
    const a = dates.indexOf(ph.from)
    const b = dates.indexOf(ph.to)
    if (a < 0 || b < 0) return null
    const chg = (arr: (number | null)[]) =>
      arr[a] != null && arr[b] != null && (arr[a] as number) > 0 ? ((arr[b] as number) / (arr[a] as number) - 1) * 100 : null
    const pair = (arr: (number | null)[]) => (arr[a] != null && arr[b] != null ? { a: arr[a] as number, b: arr[b] as number } : null)
    return {
      stock: chg(pick.stock),
      bond: chg(pick.bond),
      gold: chg(pick.gold),
      bill: chg(pick.bill),
      cpi: pair(data.macro.cpiYoY),
      gs10: pair(data.macro.gs10),
      cape: pair(data.macro.cape),
    }
  }, [data, pick, phaseIdx, timeline])

  // 일별 확대 가능 여부(^GSPC 일별은 1927-12~) 및 현재 확대 창
  const zoomWindow = useMemo(() => {
    if (!zoomed || !zoomData || zoomData.length === 0) return null
    return { from: zoomData[0].ym as string, to: zoomData[zoomData.length - 1].ym as string }
  }, [zoomed, zoomData])
  const dailyAvailable = zoomWindow != null && zoomWindow.from >= '1928-01'
  const toggleDaily = () => {
    if (!zoomWindow) return
    if (daily.status === 'on' || daily.status === 'loading') {
      setDaily({ status: 'off' })
      return
    }
    setDaily({ status: 'loading' })
    void fetchGspcDailyWindow(zoomWindow.from, zoomWindow.to).then((slice) =>
      setDaily(slice ? { status: 'on', slice } : { status: 'fail' })
    )
  }
  const dailyRows = useMemo(() => {
    if (daily.status !== 'on' || !daily.slice) return null
    const base = daily.slice.close[0]
    if (!(base > 0)) return null
    return daily.slice.dates.map((d, i) => ({ d, v: Number(((daily.slice!.close[i] / base) * 100).toFixed(2)) }))
  }, [daily])
  const dailyBand = useMemo(() => {
    const ph = phaseIdx != null ? timeline[phaseIdx] : null
    if (!ph || !dailyRows || dailyRows.length === 0) return null
    const x1 = dailyRows.find((r) => r.d >= `${ph.from}-01`)?.d
    const x2 = [...dailyRows].reverse().find((r) => r.d <= `${ph.to}-31`)?.d
    return x1 && x2 && x1 <= x2 ? { x1, x2 } : null
  }, [phaseIdx, timeline, dailyRows])

  if (error) {
    return (
      <div className={`${cardCls} p-6 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3 flex-wrap`}>
        <span>역사 데이터 로드 실패: {error}</span>
        <button onClick={() => { setError(null); setRetryTick((t) => t + 1) }} className={`px-3 py-1.5 rounded text-xs font-medium ${btnGhostCls}`}>
          다시 시도
        </button>
      </div>
    )
  }
  if (!data) {
    return <div className={`${cardCls} p-6 text-sm text-zinc-500`}>역사 데이터 로딩 중…</div>
  }

  const basisLabel = basis === 'real' ? '실질' : '명목'

  return (
    <div className={`space-y-5 ${tipDismissed ? '[&_.recharts-tooltip-wrapper]:hidden' : ''}`}>
      {/* 전체 총수익 + 음수 구간 밴드 */}
      <div className={`${cardCls} p-4 sm:p-5`}>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
              HISTORY · {basis === 'real' ? 'REAL' : 'NOMINAL'} TOTAL RETURN
            </span>
            미국 주식 {basisLabel} 총수익 (1900 ~ {data.meta.dataEnd})
            <HelpTip title="실질 vs 명목">
              <b>실질</b> = 배당 재투자 + CPI로 구매력 보정(인플레이션 제거), <b>명목</b> = 배당
              재투자만(우리가 계좌에서 보는 숫자). 인플레형 약세장은 명목으론 완만해 보여도
              실질로는 깊고 깁니다. 두 기준을 전환하며 비교해 보세요. 음영 구간·구간 카드
              수치는 <b>실질 기준으로 고정</b>입니다(구매력이 투자자의 실제 손익이므로).
              로그 스케일, 1900년 = 100. 데이터: 노벨상 수상자 로버트 실러(예일대)가 공개한
              월간 데이터입니다. 1957년 이전은 S&P500의 전신 지수를 소급 연결한 것이고, 가격이
              일별 종가의 월평균이라 일별 그래프보다 낙폭이 완만하게 보입니다.
              나스닥 비교: <b>종합(1971~)</b>은 배당 없는 가격지수(일별 종가의 월평균),
              <b>나스닥100(1999~)</b>은 추종 ETF QQQ의 배당 포함 월별 수익률이라 S&P500과
              같은 기준입니다. 실질 모드에서는 같은 CPI로 보정합니다. 기간을 확대하면
              두 선을 확대 구간 시작 = 100으로 다시 맞춰 비교합니다.
            </HelpTip>
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 기간 확대 리셋 — 브러시로 확대 중일 때만 표시 */}
            {zoomRange && (
              <button onClick={resetZoom} className={`px-3 py-1.5 rounded text-xs font-medium ${btnGhostCls}`}>
                전체 기간으로
              </button>
            )}
            {/* 나스닥 비교 선택 — 드롭다운 (없음 / 종합 1971~ 가격 / 나스닥100 1999~ 배당 포함) */}
            <select
              value={overlay}
              onChange={(e) => selectOverlay(e.target.value as 'off' | 'comp' | 'ndx100')}
              className={`text-xs rounded border px-2 py-1.5 bg-white dark:bg-[#1e222d] border-[#d3d8e3] dark:border-[#363a45] ${
                overlay === 'off' ? 'text-zinc-500 dark:text-zinc-400' : 'text-[#2962ff] dark:text-[#5b8aff] font-semibold'
              }`}
              aria-label="나스닥 비교 지수 선택"
            >
              <option value="off">나스닥 비교 안 함</option>
              <option value="comp">나스닥 종합과 비교 (1971~ · 배당 제외)</option>
              <option value="ndx100">나스닥100과 비교 (1999~ · 배당 포함)</option>
            </select>
            {/* 실질/명목 토글 */}
            <div className="flex rounded border border-[#d3d8e3] dark:border-[#363a45] overflow-hidden text-xs font-mono">
              {(['real', 'nominal'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => { if (b !== basis) resetZoom(); setBasis(b) }}
                  className={`px-3 py-1.5 transition-colors ${
                    basis === b
                      ? 'ink-chip font-semibold'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {b === 'real' ? '실질' : '명목'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-zinc-400 mb-2">
          붉은 음영 = 실질 가치가 25% 이상 떨어지고 회복까지 3년 넘게 걸린 구간(기계 검출), 파란 음영 = 금태환 폐지(1971) 이후의 상승·이행 구간(시대 구분)입니다. 아래 카드(또는 음영)를 클릭하면 상세가 열립니다.
        </p>
        {/* 시대 프리셋 칩 — 브러시 손잡이가 어려운 터치 환경의 기간 확대 대안 */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {periodChips.map((p) => {
            const active = p.start == null ? zoomRange == null : presetKey === p.key && zoomRange != null
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key, p.start, p.end)}
                className={`px-3 py-2 rounded-full text-[11px] font-medium border transition-colors ${
                  active
                    ? 'bg-[#2962ff] border-[#2962ff] text-white'
                    : 'border-[#d3d8e3] dark:border-[#363a45] text-zinc-600 dark:text-zinc-300 hover:border-[#2962ff] hover:text-[#2962ff]'
                }`}
              >
                {p.key}
              </button>
            )
          })}
        </div>
        {(() => {
          // 본 차트 — 확대 시 viewRows(슬라이스·재정규화)를 그림. 밴드는 창과 겹치는
          // 부분만 클램프해 표시(카테고리 축은 창 밖 좌표를 그릴 수 없음), 축 라벨은
          // 20년 이하 창에서 월 단위로 전환
          const visFirst = viewRows[0]?.ym ?? ''
          const visLast = viewRows[viewRows.length - 1]?.ym ?? ''
          const winMonths = viewRows.length
          const unit = rebased ? '확대 시작=100' : '1900=100'
          const overlayName = overlay === 'ndx100' ? '나스닥100 (배당 포함 · 1999~)' : '나스닥 종합 (가격지수 · 1971~)'
          return (
            <ResponsiveContainer width="100%" height={330}>
              <LineChart data={viewRows} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                <XAxis
                  dataKey="ym"
                  tick={{ fontSize: 11, fill: axisTickColor }}
                  stroke={axisTickColor}
                  minTickGap={60}
                  tickFormatter={(d: string) => (winMonths <= 240 ? d.slice(0, 7) : d.slice(0, 4))}
                />
                <YAxis
                  scale="log"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11, fill: axisTickColor }}
                  stroke={axisTickColor}
                  width={52}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v)))}
                />
                <Tooltip
                  trigger={tooltipTrigger}
                  formatter={(v, name) => [Number(v).toFixed(0), name]}
                  labelFormatter={(l) => `${l} · ${unit}`}
                  labelStyle={tooltipLabelStyle}
                  contentStyle={tooltipContentStyle}
                />
                {overlayOn && <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />}
                {eras.map((e) => {
                  const x1 = snapYm(e.peak)
                  const x2 = snapYm(e.recovery ?? data.meta.dataEnd)
                  const cx1 = x1 < visFirst ? visFirst : x1
                  const cx2 = x2 > visLast ? visLast : x2
                  if (cx1 > cx2) return null
                  const crash = e.kind === 'crash'
                  const fill = crash
                    ? selected === e.peak ? 'rgba(227,73,72,0.28)' : 'rgba(227,73,72,0.12)'
                    : selected === e.peak ? 'rgba(41,98,255,0.24)' : 'rgba(41,98,255,0.09)'
                  return (
                    <ReferenceArea
                      key={e.peak}
                      x1={cx1}
                      x2={cx2}
                      fill={fill}
                      stroke="none"
                      onClick={() => { setSelected(selected === e.peak ? null : e.peak); changePhase(null) }}
                      style={{ cursor: 'pointer' }}
                    />
                  )
                })}
                <Line type="monotone" dataKey="stock" stroke={c('stock')} strokeWidth={1.8} dot={false} isAnimationActive={!zoomRange} name={`S&P500 ${basisLabel} 총수익`} />
                {overlayOn && (
                  <Line type="monotone" dataKey="nasdaq" stroke={c('real')} strokeWidth={1.6} dot={false} isAnimationActive={!zoomRange} name={overlayName} />
                )}
              </LineChart>
            </ResponsiveContainer>
          )
        })()}
        {/* 기간 선택 슬라이더 — 별도 차트에 브러시만 두고(전체 흐름 실루엣은 트랙 안에),
            데이터(fullRows)가 확대와 무관하게 고정이라 위 본 차트가 확대마다 다시
            그려져도 브러시 창이 리셋되지 않는다 */}
        <ResponsiveContainer width="100%" height={44}>
          <LineChart data={fullRows} margin={{ top: 4, right: 8, left: 52, bottom: 0 }}>
            <XAxis dataKey="ym" hide />
            <YAxis hide />
            <Line dataKey="stock" hide />
            <Brush
              key={brushEpoch}
              dataKey="ym"
              height={44}
              travellerWidth={14}
              startIndex={zoomRange?.s}
              endIndex={zoomRange?.e}
              stroke={theme === 'dark' ? '#5b8aff' : '#2962ff'}
              fill={theme === 'dark' ? '#131722' : '#f8fafc'}
              tickFormatter={(d: string) => d.slice(0, 4)}
              onChange={(r) => {
                const rr = r as { startIndex?: number; endIndex?: number }
                if (rr?.startIndex == null || rr?.endIndex == null) return
                // 재마운트 직후 동일 창 통지는 무시 (프리셋 칩 활성 표시 보존)
                if (zoomRange && rr.startIndex === zoomRange.s && rr.endIndex === zoomRange.e) return
                setPresetKey('')
                if (rr.startIndex <= 0 && rr.endIndex >= fullRows.length - 1) setZoomRange(null)
                else setZoomRange({ s: rr.startIndex, e: rr.endIndex })
              }}
            >
              <LineChart data={fullRows}>
                <YAxis hide scale="log" domain={['auto', 'auto']} />
                <Line type="monotone" dataKey="stock" stroke={c('stock')} strokeWidth={1} strokeOpacity={0.55} dot={false} isAnimationActive={false} />
              </LineChart>
            </Brush>
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-zinc-400 mt-0.5 ml-[52px]">기간 선택 — 손잡이를 끌어 원하는 구간만 확대</p>
        {rebased && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1.5">
            확대 중에는 두 선을 <b>확대 구간 시작 = 100</b>으로 다시 맞춰, 그 구간에서의 상대 성과를 같은 출발선에서 비교합니다.
          </p>
        )}
        {overlayOn && overlay === 'comp' && (
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-1.5">
            나스닥 종합 선은 1971년 2월(지수 시작)의 S&P500 값에 이어붙여 이후의 상대 성과를 보여줍니다.
            다만 배당이 빠진 가격지수라 총수익인 S&P500 선보다 불리하게 표시됩니다. 연 1% 안팎의 배당도 50년 넘게 쌓이면
            약 2배 차이가 되므로, 두 선의 간격을 그대로 우열로 읽지 마세요. 같은 기준(배당 포함)의 비교는 "나스닥100과 비교"를 선택하세요.
            붉은 음영 구간은 계속 S&P500 기준입니다.
          </p>
        )}
        {overlayOn && overlay === 'ndx100' && (
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-1.5">
            나스닥100 선은 추종 ETF인 QQQ(1999년 3월 상장)의 배당 포함 수익률을 시작 시점의 S&P500 값에 이어붙인 것입니다.
            두 선 모두 배당 재투자 기준이라 같은 조건으로 비교할 수 있습니다(QQQ의 연 0.2% 보수만큼 지수보다 약간 낮게 표시).
            다만 나스닥100은 나스닥 상장 비금융 대형주 100종목이라 나스닥 전체보다 좁습니다. 붉은 음영 구간은 계속 S&P500 기준입니다.
          </p>
        )}
        {overlayLoading && (
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-1.5">나스닥 데이터를 불러오는 중…</p>
        )}
        {overlayFail && (
          <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed mt-1.5">
            나스닥 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.
            <button onClick={() => selectOverlay(overlay)} className="ml-2 underline font-semibold">
              다시 시도
            </button>
          </p>
        )}
      </div>

      {/* 구간 카드 */}
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        카드의 수치는 모두 물가를 반영한 실질 기준입니다. 하락 구간 카드는 <b>주식 고점→저점 최대 하락률</b>과 <b>채권·금의 고점→회복 누적 수익률</b>,
        상승·이행 구간 카드는 <b>구간 시작→끝의 주식 수익률과 연율, 구간 내 최대 조정</b>입니다. 재는 구간이 서로 다르니 그대로 비교하지는 마세요.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {eras.map((e) => {
          const crash = e.kind === 'crash'
          const info = crash ? EPISODE_INFO[e.peak] : null
          const t = e.kind === 'crash' ? (info ? TYPE_LABEL[info.type] : null) : KIND_LABEL[e.kind]
          return (
            <button
              key={e.peak}
              onClick={() => { setSelected(selected === e.peak ? null : e.peak); changePhase(null) }}
              className={`${cardCls} p-4 text-left transition-colors ${selected === e.peak ? 'ring-2 ring-zinc-500 dark:ring-zinc-400' : 'hover:border-zinc-400 dark:hover:border-zinc-500'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{e.title}</span>
                {t && (
                  <span className={`text-[10px] font-mono ${t.cls}`}>
                    {t.text}
                    {e.ongoing ? ' · 진행 중' : ''}
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-1">
                {e.peak} → {e.recovery ?? (e.ongoing ? '진행 중' : '미회복')} · {(e.underwaterMonths / 12).toFixed(1)}년
              </div>
              {crash ? (
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] font-mono">
                  <span className="text-red-600 dark:text-red-400">주식 {e.depthPct.toFixed(0)}%</span>
                  <span className={e.assets.bond.toRecoveryPct != null && e.assets.bond.toRecoveryPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    채권 {e.assets.bond.toRecoveryPct != null ? fmtSignedPct(e.assets.bond.toRecoveryPct) : '—'}
                  </span>
                  <span className={e.assets.gold.toRecoveryPct != null && e.assets.gold.toRecoveryPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    금 {e.assets.gold.toRecoveryPct != null ? fmtSignedPct(e.assets.gold.toRecoveryPct) : '—'}
                  </span>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] font-mono">
                  <span className={e.stockRetPct != null && e.stockRetPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    주식 {e.stockRetPct != null ? fmtSignedPct(e.stockRetPct) : '—'}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-300">연 {e.annualPct != null ? fmtSignedPct(e.annualPct) : '—'}</span>
                  <span className="text-zinc-600 dark:text-zinc-300">조정 {e.maxDipPct != null ? `${e.maxDipPct.toFixed(0)}%` : '—'}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 특집 — 광기의 해부 (닷컴·서브프라임은 둘 다 2000-08 "잃어버린 10년" 구간 안의 사건) */}
      <button
        onClick={() => setManiaOpen(true)}
        className={`${cardCls} w-full p-4 text-left hover:border-[#e34948]/60 transition-colors group`}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className="block text-[9px] font-mono tracking-[0.22em] text-[#e34948]">FEATURE · MANIA & TRIGGERS</span>
            <span className="flex items-center gap-1.5 font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              <Flame className="w-4 h-4 text-[#e34948]" /> 특집: 광기의 해부 — 닷컴 · 서브프라임, 그리고 2026년 AI
            </span>
            <span className="block mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              도취는 어디까지 갔고 무엇이 방아쇠였나. 두 사례의 트리거 타임라인을 복원하고, 지금의 AI·반도체 랠리와
              같은 문법으로 비교합니다 (데이터 기준 {MANIA_STORY.dataAsOf})
            </span>
          </div>
          <span className="text-xs font-semibold text-[#e34948] group-hover:underline flex-shrink-0">읽기 →</span>
        </div>
      </button>

      {/* 선택 구간 상세 */}
      {selectedEp && (
        <div id="era-detail-card" className={`${cardCls} p-4 sm:p-5 space-y-3 scroll-mt-20`}>
          <div className="flex items-start justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {selectedEp.title}
              {selectedEp.kind === 'crash' ? (
                <span className="ml-2 text-[11px] font-mono font-normal text-zinc-400">
                  고점 {selectedEp.peak} · 저점 {selectedEp.trough} ({selectedEp.depthPct.toFixed(1)}%) · 회복 {selectedEp.recovery ?? '미회복'}
                </span>
              ) : (
                <span className="ml-2 text-[11px] font-mono font-normal text-zinc-400">
                  {selectedEp.peak} ~ {selectedEp.recovery ?? `${data.meta.dataEnd} (진행 중)`} · 주식{' '}
                  {selectedEp.stockRetPct != null ? fmtSignedPct(selectedEp.stockRetPct) : '—'} (연{' '}
                  {selectedEp.annualPct != null ? fmtSignedPct(selectedEp.annualPct) : '—'}) · 최대 조정{' '}
                  {selectedEp.maxDipPct != null ? `${selectedEp.maxDipPct.toFixed(1)}%` : '—'}
                </span>
              )}
            </h3>
            <div className="flex gap-1.5 flex-wrap">
              {ERA_STORIES[selectedEp.peak] && (
                <button
                  onClick={() => setStoryOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-[#2962ff] text-white hover:bg-[#1e53e5]"
                  title="이 구간에서 각 자산이 왜 그렇게 움직였는지 — 통념 vs 실제 스토리"
                >
                  <BookOpen className="w-3.5 h-3.5" /> 왜 이렇게 움직였나
                </button>
              )}
              <button
                onClick={() => {
                  const end = selectedEp.recovery ?? data.meta.dataEnd
                  const title = selectedEp.title
                  onExplore(
                    `${selectedEp.peak}-01`,
                    `${end}-01`,
                    `역사 구간 프리셋: ${title} (${selectedEp.peak} ~ ${end}). 전략을 "역사 월간" 자산 3종(주식100 / 60·40 / 주식·채권·금)으로 교체했습니다. 백테스트 실행을 누르세요. 결과는 명목 기준이며, 월 단위 데이터로 계산됩니다.`,
                    histEraStrategies(),
                  )
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium ${btnGhostCls}`}
                title="전략 목록을 역사 자산(SPX-HIST 등) 프리셋으로 교체하고 이 구간을 백테스트"
              >
                <FlaskConical className="w-3.5 h-3.5" /> 이 구간을 백테스트
              </button>
              <button
                onClick={() => {
                  const end = selectedEp.recovery ?? data.meta.dataEnd
                  const title = selectedEp.title
                  onExplore(
                    `${selectedEp.peak}-01`,
                    `${end}-01`,
                    `역사 구간 프리셋: ${title} (${selectedEp.peak} ~ ${end}). 기간만 적용했습니다. ` +
                      (selectedEp.peak >= '1993'
                        ? '현재 전략의 ETF로 실행 가능합니다.'
                        : '이 시대는 일반 ETF 데이터가 없습니다. 자산을 "역사 월간" 그룹(SPX-HIST·UST10-HIST·GOLD-HIST)으로 바꾸면 실행됩니다.'),
                  )
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium ${btnGhostCls}`}
                title="전략은 그대로 두고 시작/종료일만 이 구간으로"
              >
                <CalendarRange className="w-3.5 h-3.5" /> 기간만 적용
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{selectedEp.cause}</p>

          <div className="lg:grid lg:grid-cols-2 lg:gap-x-6 lg:items-start">
          <div id="era-charts" className="space-y-3 min-w-0 lg:order-2 lg:sticky lg:top-20 scroll-mt-20">
          {phaseIdx != null && timeline[phaseIdx] && (
            <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg bg-[#eef4ff] dark:bg-[#16223c] px-3 py-1.5">
              <span className="text-[11px] font-mono text-[#2962ff] dark:text-[#5b8aff]">
                {zoomed
                  ? `국면 확대 ${timeline[phaseIdx].from} ~ ${timeline[phaseIdx].to} · ±6개월 · 국면 시작=100`
                  : '전체 구간 눈금 표시 중'}
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {zoomed && dailyAvailable && (
                  <button onClick={toggleDaily} className={`px-2.5 py-2 rounded text-[11px] font-medium ${btnGhostCls}`}>
                    {daily.status === 'on' ? '일별 확대 끄기' : daily.status === 'loading' ? '일별 조회 중…' : '일별 확대 보기'}
                  </button>
                )}
                <button onClick={() => setPhaseZoom((z) => !z)} className={`px-2.5 py-2 rounded text-[11px] font-medium ${btnGhostCls}`}>
                  {zoomed ? '전체 구간 보기' : '국면 확대'}
                </button>
                <button
                  onClick={() => document.getElementById('era-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`px-2.5 py-2 rounded text-[11px] font-medium ${btnGhostCls} lg:hidden`}
                >
                  연대기로 ↓
                </button>
              </div>
            </div>
          )}

          {/* 자산 추이 (고점=100 / 확대 시 국면 시작=100) */}
          <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
            <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">ASSETS · {zoomed ? 'PHASE START = 100' : 'PEAK = 100'}</span>
            자산별 추이 — 주식이 무너질 때 무엇이 버텼나 ({basisLabel} 기준, {zoomed ? '국면 시작=100' : '고점=100'})
            <HelpTip title="각 자산을 어떻게 계산했나">
              위의 실질/명목 토글이 이 차트에도 적용됩니다. <b>주식</b> = S&P500 배당 재투자
              총수익(1957년 이전은 전신 지수를 소급 연결). <b>국채</b> = 미 10년물 금리로 계산한
              총수익 근사치(실제 채권지수는 아님). <b>현금</b> = 3개월 만기 단기국채 이자를
              복리로 쌓은 값(1934년 이전은 단기 상업어음 금리로 연결). <b>금</b> = 현물 가격.
              1933~1974년은 미국에서 민간 금 보유가 금지돼 정부 고시가격 시대였고, 1950년 이전
              자료는 연 단위라 계단 모양으로 표시됩니다(월별 움직임으로 읽지 마세요).
            </HelpTip>
          </h4>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart key={`assets-${selected}-${zoomed ? phaseIdx : 'full'}`} data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId={detailSyncId}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
              {/* 전체 구간은 로그 눈금 — 금 급등이 축을 지배해 주식·채권이 눌리는 왜곡 방지
                  (개요 차트와 같은 관례). 국면 확대는 짧은 창이라 선형 유지 */}
              <YAxis
                scale={zoomed ? 'auto' : 'log'}
                tick={{ fontSize: 11, fill: axisTickColor }}
                stroke={axisTickColor}
                width={44}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => String(Math.round(v))}
              />
              <Tooltip
                trigger={tooltipTrigger}
                formatter={(v) => Number(v).toFixed(1)}
                labelFormatter={(l) => `${l} · ${zoomed ? '국면 시작' : '고점'}=100`}
                labelStyle={tooltipLabelStyle}
                contentStyle={tooltipContentStyle}
              />
              {!zoomed && (
                <ReferenceLine
                  y={100}
                  stroke={axisTickColor}
                  strokeDasharray="4 3"
                  strokeOpacity={0.55}
                  label={{ value: '고점=100', fontSize: 9.5, fill: axisTickColor, position: 'insideBottomLeft' }}
                />
              )}
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {phaseBand && <ReferenceArea x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="rgba(41,98,255,0.35)" strokeDasharray="4 3" />}
              {markersInView.map((m) => (
                <ReferenceLine
                  key={m.ym}
                  x={m.ym}
                  stroke={axisTickColor}
                  strokeDasharray="3 3"
                  strokeOpacity={0.6}
                  label={{ value: m.label, fontSize: 9.5, fill: axisTickColor, position: 'insideTopRight', angle: 0 }}
                />
              ))}
              <Line type="monotone" dataKey="S&P500 총수익" stroke={c('stock')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="미 10년 국채" stroke={c('bond')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="금 현물" stroke={c('gold')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="현금(3개월물)" stroke={c('bill')} strokeWidth={1.6} strokeDasharray="5 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {!zoomed && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              세로축은 로그 눈금이라 같은 간격이 같은 비율 변화를 뜻합니다. 점선 100 아래가 고점 대비 손실 구간입니다. 국면을 확대하면 선형 눈금으로 바뀝니다.
            </p>
          )}
          {selectedEp.peak < '1950' && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              이 시대의 금 가격은 연 단위 자료라 계단 모양으로 표시됩니다. 월별 움직임으로 읽지 마세요 (1949년의 하락 표시도 실제 시세가 아닌 자료상의 흔적입니다).
            </p>
          )}

          {/* 일별 확대 스트립 — 확대 모드 전용(^GSPC 일별, 명목 가격) */}
          {zoomed && daily.status === 'fail' && (
            <p className="text-[11px] text-red-600 dark:text-red-400">일별 데이터 조회에 실패했습니다. 네트워크 상태를 확인한 뒤 "일별 확대 보기"를 다시 눌러 주세요.</p>
          )}
          {zoomed && dailyRows && (
            <>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={dailyRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} minTickGap={70} />
                  <YAxis tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => String(Math.round(v))} />
                  <Tooltip trigger={tooltipTrigger} formatter={(v) => Number(v).toFixed(1)} labelFormatter={(l) => `${l} · 창 시작=100`} labelStyle={tooltipLabelStyle} contentStyle={tooltipContentStyle} />
                  {dailyBand && <ReferenceArea x1={dailyBand.x1} x2={dailyBand.x2} fill="rgba(41,98,255,0.12)" stroke="none" />}
                  <Line type="monotone" dataKey="v" name="^GSPC 일별" stroke={c('stock')} strokeWidth={1.3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                일별 확대 = ^GSPC 가격지수(명목·배당 제외), 창 시작=100. 위의 월평균 선이 뭉개는 일간 급등락의 모양을 보는 용도라, 실질 총수익 눈금과 수치를 직접 비교하면 안 됩니다.
              </p>
            </>
          )}

          {/* 매크로 배경 */}
          <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
            <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">MACRO BACKDROP</span>
            매크로 배경 — 인플레이션 · 금리 · 밸류에이션
            <HelpTip title="매크로 지표 선정과 신뢰도">
              1900년 이후 전체를 커버하는 신뢰 가능한 월간 자료는 실러(예일대) 데이터가 사실상
              유일해 이 4종을 채택했습니다: <b>CPI 인플레이션(전년동월비)</b> · <b>10년물 국채
              명목 금리</b> · <b>실질금리(명목 금리 − 인플레이션, 사후적 근사)</b> · <b>CAPE(주가
              ÷ 10년 평균 실질 이익)</b>. 실질금리가 사후적 기준인 이유: 시장이 매기는 사전적
              실질금리(TIPS)는 1997년에야 도입되어 20세기 구간에는 존재하지 않습니다. 시대
              비교가 가능한 유일한 실질금리가 사후적입니다(현재의 TIPS는 "현재 신호" 탭).
              수치는 널리 검증된 역사 기준값(1929년 CAPE 32.6, 2000년 CAPE ~44, 1981년 금리
              15.32% 등)과 자동 대조를 통과한 것만 싣습니다. 연준 기준금리·통화량·회사채
              스프레드는 1900년대 전반을 커버하지 못해 제외했습니다. 1913년 이전 CPI는 재구성
              물가지수입니다. 출처: 실러(예일대) 공개 데이터셋과 미 연준 경제 데이터(FRED).
            </HelpTip>
          </h4>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart key={`macro-${selected}-${zoomed ? phaseIdx : 'full'}`} data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId={detailSyncId}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
              <YAxis
                yAxisId="pct"
                tick={{ fontSize: 10, fill: axisTickColor }}
                stroke={axisTickColor}
                width={36}
                tickFormatter={(v: number) => `${v}%`}
              />
              {!narrow && (
                <YAxis
                  yAxisId="cape"
                  orientation="right"
                  tick={{ fontSize: 10, fill: c('cape') }}
                  stroke={c('cape')}
                  width={30}
                  domain={[0, 'auto']}
                  label={{ value: 'CAPE', angle: 0, position: 'insideTopRight', fontSize: 9.5, fill: c('cape') }}
                />
              )}
              <Tooltip
                trigger={tooltipTrigger}
                formatter={(v, name) => [name === 'CAPE' ? Number(v).toFixed(1) : `${Number(v).toFixed(1)}%`, name]}
                labelStyle={tooltipLabelStyle}
                contentStyle={tooltipContentStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="pct" y={0} stroke={axisTickColor} strokeDasharray="4 3" strokeOpacity={0.5} />
              {phaseBand && <ReferenceArea yAxisId="pct" x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="rgba(41,98,255,0.35)" strokeDasharray="4 3" />}
              <Line yAxisId="pct" type="monotone" dataKey="CPI 인플레" stroke={c('cpi')} strokeWidth={1.8} dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="10년물 금리" stroke={c('rate')} strokeWidth={1.8} dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="실질금리" stroke={c('real')} strokeWidth={1.8} dot={false} />
              {!narrow && <Line yAxisId="cape" type="monotone" dataKey="CAPE" stroke={c('cape')} strokeWidth={1.8} strokeDasharray="6 3" dot={false} />}
            </LineChart>
          </ResponsiveContainer>
          {narrow && (
            <>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart key={`cape-${selected}-${zoomed ? phaseIdx : 'full'}`} data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" vertical={false} />
                  <XAxis dataKey="ym" tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} minTickGap={60} />
                  <YAxis tick={{ fontSize: 10, fill: axisTickColor }} stroke={axisTickColor} width={36} domain={[0, 'auto']} />
                  <Tooltip trigger={tooltipTrigger} formatter={(v) => Number(v).toFixed(1)} labelStyle={tooltipLabelStyle} contentStyle={tooltipContentStyle} />
                  {phaseBand && <ReferenceArea x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="none" />}
                  <Line type="monotone" dataKey="CAPE" stroke={c('cape')} strokeWidth={1.6} strokeDasharray="6 3" dot={false} name="CAPE (밸류에이션)" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            {narrow
              ? '위 = %(인플레이션·금리), 아래 = CAPE입니다. CAPE는 주가가 최근 10년 평균 이익의 몇 배인가를 잽니다. '
              : '왼쪽 축 = %(인플레이션·금리), 오른쪽 점선 = CAPE(주가가 최근 10년 평균 이익의 몇 배인가). '}
            인플레이션형 구간은 실질금리가 마이너스로 가라앉고, 밸류에이션 붕괴형은 CAPE가 극단인 상태에서 하락이 시작되는 패턴을 확인해 보세요.
          </p>
          </div>

          {/* 연대기 — 흐름 따라가기 */}
          {timeline.length > 0 && (
            <div id="era-timeline" className="pt-2 min-w-0 lg:order-1 lg:pt-0 scroll-mt-20">
              <div className="flex items-end justify-between flex-wrap gap-2">
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">TIMELINE · FOLLOW THE FLOW</span>
                  흐름 따라가기 — 시간 순서로 읽는 이 구간
                  <HelpTip title="연대기 읽는 법">
                    이 구간을 시간 순서의 국면으로 쪼갠 연대기입니다. 국면을 클릭하면 <b>차트가
                    해당 국면 ±6개월로 확대</b>되고(자산은 국면 시작=100으로 다시 매겨짐) 파란
                    음영과 이벤트 마커가 표시되어, 데이터의 꺾임과 그 이유를 짝지어 읽을 수
                    있습니다. 전체 구간 눈금이 필요하면 차트 위의 "전체 구간 보기"를 누르세요.
                    1928년 이후 국면에서는 "일별 확대 보기"로 월평균이 뭉개는 일간 급등락도 겹쳐
                    볼 수 있습니다. 각 국면의 수치는 이 앱에 내장된 검증 데이터에서 추출한
                    실측값이고, 카드의 "자동 실측" 줄은 같은 번들에서 즉석 계산한 값입니다.
                    서사는 학계·시장의 표준 해석만 담았습니다(해석이 갈리는 지점은 본문에 명시).
                  </HelpTip>
                </h4>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    onClick={() => changePhase(phaseIdx == null ? 0 : Math.max(0, phaseIdx - 1))}
                    disabled={phaseIdx === 0}
                    className={`px-3 py-2 rounded ${btnGhostCls} disabled:opacity-40`}
                  >
                    ← 이전 국면
                  </button>
                  <span className="font-mono text-zinc-400 min-w-[52px] text-center">
                    {phaseIdx != null ? `${phaseIdx + 1} / ${timeline.length}` : `${timeline.length}개 국면`}
                  </span>
                  <button
                    onClick={() => changePhase(phaseIdx == null ? 0 : Math.min(timeline.length - 1, phaseIdx + 1))}
                    disabled={phaseIdx === timeline.length - 1}
                    className={`px-3 py-2 rounded ${btnGhostCls} disabled:opacity-40`}
                  >
                    다음 국면 →
                  </button>
                </div>
              </div>

              <ol className="mt-3 relative border-l-2 border-[#e0e3eb] dark:border-[#2a2e39] ml-1.5 space-y-1">
                {timeline.map((ph, i) => {
                  const active = phaseIdx === i
                  return (
                    <li key={ph.from + ph.title} className="relative pl-4">
                      <span
                        className={`absolute -left-[7px] top-2.5 w-3 h-3 rounded-full border-2 ${
                          active ? 'bg-[#2962ff] border-[#2962ff]' : 'bg-white dark:bg-[#1e222d] border-zinc-300 dark:border-zinc-600'
                        }`}
                      />
                      <button
                        onClick={() => changePhase(active ? null : i)}
                        className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                          active ? 'bg-[#eef4ff] dark:bg-[#16223c]' : 'hover:bg-[#f3f5f9] dark:hover:bg-[#171c28]'
                        }`}
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className={`text-[11px] font-mono ${active ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-400'}`}>
                            {ph.from === ph.to ? ph.from : `${ph.from} ~ ${ph.to}`}
                          </span>
                          <span className={`text-[13px] font-semibold ${active ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-700 dark:text-zinc-300'}`}>
                            {ph.title}
                          </span>
                        </div>
                        {active && (
                          <div className="mt-2 space-y-1.5">
                            <p className="text-[12px] font-mono leading-relaxed text-zinc-500 dark:text-zinc-400 bg-white/60 dark:bg-black/20 rounded px-2 py-1.5">
                              데이터: {ph.data}
                            </p>
                            {phaseStats && (
                              <p className="text-[11px] font-mono leading-relaxed text-zinc-400 dark:text-zinc-500">
                                자동 실측·{basisLabel} 주식 {phaseStats.stock == null ? '—' : fmtSignedPct(phaseStats.stock)} · 채권{' '}
                                {phaseStats.bond == null ? '—' : fmtSignedPct(phaseStats.bond)} · 금 {phaseStats.gold == null ? '—' : fmtSignedPct(phaseStats.gold)} · 현금{' '}
                                {phaseStats.bill == null ? '—' : fmtSignedPct(phaseStats.bill)}
                                {phaseStats.cpi ? ` | CPI ${phaseStats.cpi.a.toFixed(1)}→${phaseStats.cpi.b.toFixed(1)}%` : ''}
                                {phaseStats.gs10 ? ` · 금리 ${phaseStats.gs10.a.toFixed(1)}→${phaseStats.gs10.b.toFixed(1)}%` : ''}
                                {phaseStats.cape ? ` · CAPE ${phaseStats.cape.a.toFixed(1)}→${phaseStats.cape.b.toFixed(1)}` : ''}
                              </p>
                            )}
                            <p className="text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-200">{ph.story}</p>
                            {zoomed && zoomData && (
                              <div className="lg:hidden pt-1">
                                <ResponsiveContainer width="100%" height={110}>
                                  <LineChart data={zoomData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                                    <XAxis dataKey="ym" tick={{ fontSize: 9.5, fill: axisTickColor }} stroke={axisTickColor} minTickGap={55} />
                                    <YAxis tick={{ fontSize: 9.5, fill: axisTickColor }} stroke={axisTickColor} width={36} domain={['auto', 'auto']} tickFormatter={(v: number) => String(Math.round(v))} />
                                    {phaseBand && <ReferenceArea x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="none" />}
                                    <Line type="monotone" dataKey="S&P500 총수익" stroke={c('stock')} strokeWidth={1.6} dot={false} />
                                    <Line type="monotone" dataKey="미 10년 국채" stroke={c('bond')} strokeWidth={1.2} dot={false} />
                                    <Line type="monotone" dataKey="금 현물" stroke={c('gold')} strokeWidth={1.2} dot={false} />
                                  </LineChart>
                                </ResponsiveContainer>
                                <p className="text-[10px] text-zinc-400">
                                  국면 확대 미니 차트 — <span style={{ color: c('stock') }}>주식</span>·<span style={{ color: c('bond') }}>채권</span>·<span style={{ color: c('gold') }}>금</span> ({basisLabel}, 국면 시작=100)
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                      {active && (
                        <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2 pt-1 text-[11px]">
                          <button
                            onClick={() => changePhase(Math.max(0, i - 1))}
                            disabled={i === 0}
                            className={`px-3 py-2 rounded ${btnGhostCls} disabled:opacity-40`}
                          >
                            ← 이전 국면
                          </button>
                          <button
                            onClick={() => changePhase(Math.min(timeline.length - 1, i + 1))}
                            disabled={i === timeline.length - 1}
                            className={`px-3 py-2 rounded ${btnGhostCls} disabled:opacity-40`}
                          >
                            다음 국면 →
                          </button>
                          <button
                            onClick={() => document.getElementById('era-charts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className={`px-3 py-2 rounded ${btnGhostCls} lg:hidden`}
                          >
                            큰 차트 보기 ↑
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              <p className="mt-2 text-[11px] text-zinc-400">
                국면을 선택하면 차트가 해당 국면으로 확대되고 파란 음영과 이벤트 마커가 표시됩니다. "왜 이렇게 움직였나" 버튼의 자산별 스토리와 함께 읽으면 좋습니다.
              </p>
            </div>
          )}
          </div>
        </div>
      )}

      {/* 구간 스토리 팝업 */}
      {storyOpen && selectedEp && ERA_STORIES[selectedEp.peak] && (
        <EraStoryModal
          title={selectedEp.title}
          period={`${selectedEp.peak} ~ ${selectedEp.recovery ?? '미회복'}`}
          story={ERA_STORIES[selectedEp.peak]}
          onClose={() => setStoryOpen(false)}
        />
      )}

      {/* 특집 팝업 */}
      {maniaOpen && <ManiaStoryModal onClose={() => setManiaOpen(false)} />}

      {/* 에피스테믹 각주 */}
      <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg p-3 text-[11px] text-amber-900 dark:text-amber-200/90 leading-relaxed">
        <b>읽는 법 주의</b> — 기본 화면은 "명목 주가"가 아니라 <b>배당 재투자 + 인플레이션 보정(실질)</b> 기준입니다
        (우상단 토글로 명목 전환). 흔히 인용되는 "대공황 −84%, 1954년 회복"은 명목 가격 기준이고, 실질 총수익 기준은
        −77%, 1936/1945년 회복입니다. 가격이 일별 종가의 월평균이라 일별 시리즈보다 낙폭이 완만하게 보입니다.
        과거 한 경로의 기록이지 예측이 아닙니다.
      </div>
    </div>
  )
}
