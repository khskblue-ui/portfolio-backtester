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
} from 'recharts'
import { FlaskConical, CalendarRange, BookOpen, Flame } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { EraStoryModal } from './EraStoryModal'
import { ERA_STORIES } from './eraStories'
import { ERA_TIMELINES } from './eraTimelines'
import { ManiaStoryModal } from './ManiaStoryModal'
import { MANIA_STORY } from './maniaStory'
import { cardCls, btnGhostCls, fmtSignedPct } from './common'
import { EPISODE_INFO } from './episodeInfo'
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
    peTrail?: (number | null)[]
    peFwdReal?: (number | null)[]
  }
  episodes: Episode[]
}


const TYPE_LABEL = {
  A: { text: '인플레이션형', cls: 'text-amber-700 dark:text-amber-400' },
  B: { text: '밸류에이션 붕괴형', cls: 'text-red-700 dark:text-red-400' },
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
  peFwd: { light: '#2962ff', dark: '#5b8aff' },
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
  const { overviewData, snapYm } = useMemo(() => {
    if (!data || !pick) return { overviewData: [], snapYm: (ym: string) => ym }
    const { dates } = data.series
    const n = dates.length
    const step = Math.max(1, Math.floor(n / 800))
    const rows = []
    for (let i = 0; i < n; i += step) rows.push({ ym: dates[i], stock: pick.stock[i] })
    if ((n - 1) % step !== 0) rows.push({ ym: dates[n - 1], stock: pick.stock[n - 1] })
    const sampled = rows.map((r) => r.ym)
    const snapYm = (ym: string) => sampled.find((d) => d >= ym) ?? sampled[sampled.length - 1]
    return { overviewData: rows, snapYm }
  }, [data, pick])

  const selectedEp = data?.episodes.find((e) => e.peak === selected) ?? null
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
        '트레일링 P/E': data.macro.peTrail?.[i] ?? null,
        '실현 선행 P/E': data.macro.peFwdReal?.[i] ?? null,
      })
    }
    return rows
  }, [data, pick, selectedEp])

  // 선택 국면을 상세 차트 범위로 클램프한 음영 구간
  const phaseBand = useMemo(() => {
    const ph = phaseIdx != null ? timeline[phaseIdx] : null
    if (!ph || detailData.length === 0) return null
    const first = detailData[0].ym as string
    const last = detailData[detailData.length - 1].ym as string
    const x1 = ph.from < first ? first : ph.from
    const x2 = ph.to > last ? last : ph.to
    return x1 <= x2 ? { x1, x2 } : null
  }, [phaseIdx, timeline, detailData])

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
    <div className="space-y-5">
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
              실질로는 깊고 깁니다 — 두 기준을 전환하며 비교해 보세요. 음영 구간·구간 카드
              수치는 <b>실질 기준으로 고정</b>입니다(구매력이 투자자의 실제 손익이므로).
              로그 스케일, 1900년 = 100. 데이터: 노벨상 수상자 로버트 실러(예일대)가 공개한
              월간 데이터 — 1957년 이전은 S&P500의 전신 지수를 소급 연결한 것이고, 가격이
              일별 종가의 월평균이라 일별 그래프보다 낙폭이 완만하게 보입니다.
            </HelpTip>
          </h2>
          {/* 실질/명목 토글 */}
          <div className="flex rounded border border-[#d3d8e3] dark:border-[#363a45] overflow-hidden text-xs font-mono">
            {(['real', 'nominal'] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBasis(b)}
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
        <p className="text-xs text-zinc-400 mb-3">
          붉은 음영 = 실질 가치가 25% 이상 떨어지고 회복까지 3년 넘게 걸린 구간입니다. 음영이나 아래 카드를 클릭하면 상세가 열립니다.
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={overviewData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
            <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={60} tickFormatter={(d: string) => d.slice(0, 4)} />
            <YAxis
              scale="log"
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: axisTickColor }}
              stroke={axisTickColor}
              width={52}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v)))}
            />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(0)} (1900=100)`, `${basisLabel} 총수익`]}
              labelStyle={tooltipLabelStyle}
              contentStyle={tooltipContentStyle}
            />
            {data.episodes.map((e) => (
              <ReferenceArea
                key={e.peak}
                x1={snapYm(e.peak)}
                x2={snapYm(e.recovery ?? data.meta.dataEnd)}
                fill={selected === e.peak ? 'rgba(227,73,72,0.28)' : 'rgba(227,73,72,0.12)'}
                stroke="none"
                onClick={() => { setSelected(selected === e.peak ? null : e.peak); setPhaseIdx(null) }}
                style={{ cursor: 'pointer' }}
              />
            ))}
            <Line type="monotone" dataKey="stock" stroke={c('stock')} strokeWidth={1.8} dot={false} name={`${basisLabel} 총수익`} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 구간 카드 */}
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        카드의 수치는 모두 물가를 반영한 실질 기준입니다. <b>주식은 고점→저점 최대 하락률</b>, <b>채권·금은 고점→회복까지 전체 기간의 누적 수익률</b> —
        재는 구간이 서로 다르니 그대로 비교하지는 마세요.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.episodes.map((e) => {
          const info = EPISODE_INFO[e.peak]
          const t = info ? TYPE_LABEL[info.type] : null
          return (
            <button
              key={e.peak}
              onClick={() => setSelected(selected === e.peak ? null : e.peak)}
              className={`${cardCls} p-4 text-left transition-colors ${selected === e.peak ? 'ring-2 ring-zinc-500 dark:ring-zinc-400' : 'hover:border-zinc-400 dark:hover:border-zinc-500'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{info?.title ?? e.peak}</span>
                {t && <span className={`text-[10px] font-mono ${t.cls}`}>{t.text}</span>}
              </div>
              <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-1">
                {e.peak} → {e.recovery ?? '미회복'} · {(e.underwaterMonths / 12).toFixed(1)}년
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] font-mono">
                <span className="text-red-600 dark:text-red-400">주식 {e.depthPct.toFixed(0)}%</span>
                <span className={e.assets.bond.toRecoveryPct != null && e.assets.bond.toRecoveryPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  채권 {e.assets.bond.toRecoveryPct != null ? fmtSignedPct(e.assets.bond.toRecoveryPct) : '—'}
                </span>
                <span className={e.assets.gold.toRecoveryPct != null && e.assets.gold.toRecoveryPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  금 {e.assets.gold.toRecoveryPct != null ? fmtSignedPct(e.assets.gold.toRecoveryPct) : '—'}
                </span>
              </div>
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
              도취는 어디까지 갔고 무엇이 방아쇠였나 — 두 사례의 트리거 타임라인을 복원하고, 지금의 AI·반도체 랠리와
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
              {EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak}
              <span className="ml-2 text-[11px] font-mono font-normal text-zinc-400">
                고점 {selectedEp.peak} · 저점 {selectedEp.trough} ({selectedEp.depthPct.toFixed(1)}%) · 회복 {selectedEp.recovery ?? '미회복'}
              </span>
            </h3>
            <div className="flex gap-1.5 flex-wrap">
              {ERA_STORIES[selectedEp.peak] && (
                <button
                  onClick={() => setStoryOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#2962ff] text-white hover:bg-[#1e53e5]"
                  title="이 구간에서 각 자산이 왜 그렇게 움직였는지 — 통념 vs 실제 스토리"
                >
                  <BookOpen className="w-3.5 h-3.5" /> 왜 이렇게 움직였나
                </button>
              )}
              <button
                onClick={() => {
                  const end = selectedEp.recovery ?? data.meta.dataEnd
                  const title = EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak
                  onExplore(
                    `${selectedEp.peak}-01`,
                    `${end}-01`,
                    `역사 구간 프리셋: ${title} (${selectedEp.peak} ~ ${end}) — 전략을 "역사 월간" 자산 3종(주식100 / 60·40 / 주식·채권·금)으로 교체했습니다. 백테스트 실행을 누르세요. 결과는 명목 기준이며, 월 단위 데이터로 계산됩니다.`,
                    histEraStrategies(),
                  )
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${btnGhostCls}`}
                title="전략 목록을 역사 자산(SPX-HIST 등) 프리셋으로 교체하고 이 구간을 백테스트"
              >
                <FlaskConical className="w-3.5 h-3.5" /> 이 구간을 백테스트
              </button>
              <button
                onClick={() => {
                  const end = selectedEp.recovery ?? data.meta.dataEnd
                  const title = EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak
                  onExplore(
                    `${selectedEp.peak}-01`,
                    `${end}-01`,
                    `역사 구간 프리셋: ${title} (${selectedEp.peak} ~ ${end}) — 기간만 적용했습니다. ` +
                      (selectedEp.peak >= '1993'
                        ? '현재 전략의 ETF로 실행 가능합니다.'
                        : '이 시대는 일반 ETF 데이터가 없습니다 — 자산을 "역사 월간" 그룹(SPX-HIST·UST10-HIST·GOLD-HIST)으로 바꾸면 실행됩니다.'),
                  )
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${btnGhostCls}`}
                title="전략은 그대로 두고 시작/종료일만 이 구간으로"
              >
                <CalendarRange className="w-3.5 h-3.5" /> 기간만 적용
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{EPISODE_INFO[selectedEp.peak]?.cause}</p>

          {/* 자산 추이 (고점=100) */}
          <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
            <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">ASSETS · PEAK = 100</span>
            자산별 추이 — 주식이 무너질 때 무엇이 버텼나 ({basisLabel} 기준, 고점=100)
            <HelpTip title="각 자산을 어떻게 계산했나">
              위의 실질/명목 토글이 이 차트에도 적용됩니다. <b>주식</b> = S&P500 배당 재투자
              총수익(1957년 이전은 전신 지수를 소급 연결). <b>국채</b> = 미 10년물 금리로 계산한
              총수익 근사치 — 실제 채권지수는 아닙니다. <b>현금</b> = 3개월 만기 단기국채 이자를
              복리로 쌓은 값(1934년 이전은 단기 상업어음 금리로 연결). <b>금</b> = 현물 가격 —
              1933~1974년은 미국에서 민간 금 보유가 금지돼 정부 고시가격 시대였고, 1950년 이전
              자료는 연 단위라 계단 모양으로 표시됩니다(월별 움직임으로 읽지 마세요).
            </HelpTip>
          </h4>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={detailData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId="era-detail">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
              <YAxis tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => String(Math.round(v))} />
              <Tooltip
                formatter={(v) => `${Number(v).toFixed(1)} (고점=100)`}
                labelStyle={tooltipLabelStyle}
                contentStyle={tooltipContentStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {phaseBand && <ReferenceArea x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="rgba(41,98,255,0.35)" strokeDasharray="4 3" />}
              <Line type="monotone" dataKey="S&P500 총수익" stroke={c('stock')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="미 10년 국채" stroke={c('bond')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="금 현물" stroke={c('gold')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="현금(3개월물)" stroke={c('bill')} strokeWidth={1.6} strokeDasharray="5 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {selectedEp.peak < '1950' && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              이 시대의 금 가격은 연 단위 자료라 계단 모양으로 표시됩니다 — 월별 움직임으로 읽지 마세요 (1949년의 하락 표시도 실제 시세가 아닌 자료상의 흔적입니다).
            </p>
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
              실질금리(TIPS)는 1997년에야 도입되어 20세기 구간에는 존재하지 않습니다 — 시대
              비교가 가능한 유일한 실질금리가 사후적입니다(현재의 TIPS는 "현재 신호" 탭).
              수치는 널리 검증된 역사 기준값(1929년 CAPE 32.6, 2000년 CAPE ~44, 1981년 금리
              15.32% 등)과 자동 대조를 통과한 것만 싣습니다. 연준 기준금리·통화량·회사채
              스프레드는 1900년대 전반을 커버하지 못해 제외했습니다. 1913년 이전 CPI는 재구성
              물가지수입니다. 출처: 실러(예일대) 공개 데이터셋과 미 연준 경제 데이터(FRED).
            </HelpTip>
          </h4>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={detailData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId="era-detail">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
              <YAxis
                yAxisId="pct"
                tick={{ fontSize: 11, fill: axisTickColor }}
                stroke={axisTickColor}
                width={44}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis
                yAxisId="cape"
                orientation="right"
                tick={{ fontSize: 11, fill: c('cape') }}
                stroke={c('cape')}
                width={40}
                domain={[0, 'auto']}
              />
              <Tooltip
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
              <Line yAxisId="cape" type="monotone" dataKey="CAPE" stroke={c('cape')} strokeWidth={1.8} strokeDasharray="6 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            왼쪽 축 = %(인플레이션·금리), 오른쪽 점선 = CAPE(주가가 최근 10년 평균 이익의 몇 배인가).
            인플레이션형 구간은 실질금리가 마이너스로 가라앉고, 밸류에이션 붕괴형은 CAPE가 극단인 상태에서 하락이 시작되는 패턴을 확인해 보세요.
          </p>

          {/* 밸류에이션의 착시 — 트레일링 vs 실현 선행 P/E */}
          {detailData.some((r) => r['실현 선행 P/E'] != null) && (
            <>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 pt-1">
                <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">VALUATION · HINDSIGHT P/E</span>
                그때 시장은 "미래 이익"의 몇 배를 지불했나 — 트레일링 vs 실현 선행 P/E
                <HelpTip title="실현 선행 P/E 읽는 법">
                  <b>트레일링 P/E</b> = 그 달의 주가 ÷ 직전 12개월 확정 이익 — 당시 투자자가 실제로
                  알던 숫자입니다. <b>실현 선행 P/E</b> = 그 달의 주가 ÷ <b>그 뒤 12개월</b>의 실제
                  확정 이익 — 예: 2008년 3월 값은 2008-03 주가를 2008-04~2009-03에 실현된 이익으로
                  나눈 것입니다. 애널리스트의 당시 예측이 아니라 사후에 확정된 이익이므로 추정
                  편향이 없습니다. 두 선의 <b>간극이 곧 "시장이 미래를 얼마나 잘못 샀는가"</b>입니다:
                  2008-03 트레일링은 22배로 평범했지만 실현 선행은 192배 — 이익 절벽을 몰랐던
                  시장은 실제로는 다음 1년 이익의 192배를 지불하고 있었습니다. 반대로 2009-03엔
                  트레일링 110배(이익 붕괴가 만든 착시)로 비싸 보였지만 실현 선행은 12배 — 실제로는
                  헐값이었습니다. 주의: 실현 선행 P/E는 미래 정보를 당겨온 사후 지표라 그 당시엔
                  계산 자체가 불가능했습니다 — 실시간 신호가 될 수 없고 역사 해석 전용입니다.
                  위기 구간의 극단값은 회계상 대규모 손실 처리가 이익을 붕괴시킨 결과라 영업이익
                  기준으로는 덜 극단적입니다. 두 지표 모두 실러 월간 이익 데이터에서 직접 계산했고
                  (추정치 미사용), 세로축은 로그 눈금입니다. 실시간 선행 P/E(애널리스트 추정)를
                  신호로 쓰지 않는 이유는 가이드북의 CAPE 절에 있습니다.
                </HelpTip>
              </h4>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={detailData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId="era-detail">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                  <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
                  <YAxis
                    scale="log"
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 11, fill: axisTickColor }}
                    stroke={axisTickColor}
                    width={44}
                    tickFormatter={(v: number) => `${Math.round(v)}배`}
                  />
                  <Tooltip
                    formatter={(v, name) => [`${Number(v).toFixed(1)}배`, name]}
                    labelStyle={tooltipLabelStyle}
                    contentStyle={tooltipContentStyle}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine
                    y={15}
                    stroke={axisTickColor}
                    strokeDasharray="4 3"
                    strokeOpacity={0.5}
                    label={{ value: '장기 평균대 ~15배', fontSize: 10, fill: axisTickColor, position: 'insideBottomLeft' }}
                  />
                  {phaseBand && <ReferenceArea x1={phaseBand.x1} x2={phaseBand.x2} fill="rgba(41,98,255,0.12)" stroke="rgba(41,98,255,0.35)" strokeDasharray="4 3" />}
                  <Line type="monotone" dataKey="트레일링 P/E" stroke={c('cape')} strokeWidth={1.6} strokeDasharray="6 3" dot={false} />
                  <Line type="monotone" dataKey="실현 선행 P/E" stroke={c('peFwd')} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                점선 = 당시 투자자가 실제로 알던 값(직전 1년 이익 기준), 파란 선 = 나중에 확정된 "다음 1년" 실제 이익으로 다시 계산한 값.
                두 선의 간극이 클수록 시장이 미래 이익을 잘못 산 것입니다. 미래를 알아야 계산되는 지표라 역사 공부 전용이며, 최근 12개월은 계산할 수 없습니다.
              </p>
            </>
          )}

          {/* 연대기 — 흐름 따라가기 */}
          {timeline.length > 0 && (
            <div className="pt-2">
              <div className="flex items-end justify-between flex-wrap gap-2">
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="block text-[8px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">TIMELINE · FOLLOW THE FLOW</span>
                  흐름 따라가기 — 시간 순서로 읽는 이 구간
                  <HelpTip title="연대기 읽는 법">
                    이 구간을 시간 순서의 국면으로 쪼갠 연대기입니다. 국면을 클릭하면 <b>위의
                    차트들에 해당 기간이 파란 음영</b>으로 표시되어, 데이터의 꺾임과 그 이유를 짝지어 읽을 수
                    있습니다. 각 국면의 수치는 이 앱에 내장된 검증 데이터에서 추출한 실측값이고,
                    서사는 학계·시장의 표준 해석만 담았습니다(해석이 갈리는 지점은 본문에 명시).
                  </HelpTip>
                </h4>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    onClick={() => setPhaseIdx((i) => (i == null ? 0 : Math.max(0, i - 1)))}
                    disabled={phaseIdx === 0}
                    className={`px-2.5 py-1 rounded ${btnGhostCls} disabled:opacity-40`}
                  >
                    ← 이전 국면
                  </button>
                  <span className="font-mono text-zinc-400 min-w-[52px] text-center">
                    {phaseIdx != null ? `${phaseIdx + 1} / ${timeline.length}` : `${timeline.length}개 국면`}
                  </span>
                  <button
                    onClick={() => setPhaseIdx((i) => (i == null ? 0 : Math.min(timeline.length - 1, i + 1)))}
                    disabled={phaseIdx === timeline.length - 1}
                    className={`px-2.5 py-1 rounded ${btnGhostCls} disabled:opacity-40`}
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
                        onClick={() => setPhaseIdx(active ? null : i)}
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
                            <p className="text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-200">{ph.story}</p>
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ol>
              <p className="mt-2 text-[11px] text-zinc-400">
                국면을 선택하면 위 차트들에 해당 기간이 파란 음영으로 표시됩니다. "왜 이렇게 움직였나" 버튼의 자산별 스토리와 함께 읽으면 좋습니다.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 구간 스토리 팝업 */}
      {storyOpen && selectedEp && ERA_STORIES[selectedEp.peak] && (
        <EraStoryModal
          title={EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak}
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
