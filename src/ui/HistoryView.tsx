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
  ResponsiveContainer,
} from 'recharts'
import { FlaskConical } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { cardCls, btnGhostCls, fmtSignedPct } from './common'

/**
 * 역사 연구 뷰 — 1900년 이후 미국 주식 "실질 총수익" 기준 장기 음수 구간과
 * 그 구간에서의 자산군(주식·장기국채·금) 실질 추이.
 *
 * 데이터: public/data/history.json (Shiller 월간 미러 + 금 월간, 둘 다 ODC-PDDL;
 * scripts/build-history.mjs로 재현 가능 생성 — 구간 경계는 데이터에서 직접 검출).
 * 상세 근거: docs/research/negative-real-return-eras.md
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
  assets: { stock: EpisodeAssets; bond: EpisodeAssets; gold: EpisodeAssets }
}
interface HistoryData {
  meta: { sources: string[]; method: Record<string, string>; dataEnd: string }
  series: { dates: string[]; stock: number[]; bond: (number | null)[]; gold: (number | null)[] }
  episodes: Episode[]
}

/** 구간별 구조적 원인 (리서치 문서 §2 — 검증 근거는 문서 참조) */
const EPISODE_INFO: Record<string, { title: string; type: 'A' | 'B'; cause: string }> = {
  '1916-11': {
    title: '1차대전 전시 인플레이션',
    type: 'A',
    cause: '전시 재정 팽창으로 물가가 ~2배로 뛰며 실질 가치를 잠식했고, 전후 1920-21년 디플레 불황이 마무리 타격. 명목 지수보다 실질 기준 고통이 훨씬 길었던 전형적 인플레형.',
  },
  '1929-09': {
    title: '대공황',
    type: 'B',
    cause: '1920년대 신용버블·마진 투기(CAPE ~32)에서 출발한 150년래 최악의 붕괴. 은행 시스템 연쇄 파산과 디플레이션, 통화·재정 정책 실패, 보호무역이 증폭. 디플레 덕에 국채는 실질 강세 — 밸류에이션 붕괴형의 원형.',
  },
  '1937-02': {
    title: '1937 재긴축 불황 · 2차대전',
    type: 'B',
    cause: '대공황 회복 중 성급한 통화·재정 긴축으로 재폭락(−48%), 이어 2차대전 발발. 1929 고점 기준으로 보면 이 구간까지 합쳐 실질 회복에 ~15.6년이 걸린 복합 에피소드의 후반부.',
  },
  '1946-04': {
    title: '전후 인플레이션 · 금융억압',
    type: 'A',
    cause: '전시 가격통제 해제로 CPI 연 8~18% 폭등. 정부부채 GDP 106% 처리를 위해 장기금리를 ~2.5%에 페그(금융억압) — 주식·채권·금이 모두 실질 마이너스였던, 숨을 곳이 없던 구간.',
  },
  '1968-12': {
    title: '스태그플레이션 서곡',
    type: 'A',
    cause: '인플레이션 상승 초입 + 고밸류에이션(CAPE ~24). 1966-82 장기 실질 횡보의 앞부분으로, 1973년 본편의 예고편.',
  },
  '1973-01': {
    title: '스태그플레이션 본편',
    type: 'A',
    cause: '니프티피프티 밸류에이션 과열과 인플레·긴축이 선행하고, 오일쇼크(1973-10, 고점 이후의 가속 요인)·베트남 후유증·워터게이트가 겹침. 채권도 실질 마이너스, 금만 +132% — 인플레형의 교과서.',
  },
  '2000-08': {
    title: '잃어버린 10년 (닷컴 + 금융위기)',
    type: 'B',
    cause: '사상 최고 밸류에이션(CAPE ~44)에서 출발 — 인플레가 아니라 밸류에이션 정상화가 주도. 닷컴 붕괴 후 회복 중 신용버블 → 2008 금융위기 이중 타격. 금리 하락으로 국채 +65%, 금 +282% — 150년래 최장(12.8년) 수면하.',
  },
}

const TYPE_LABEL = {
  A: { text: '인플레이션형', cls: 'text-amber-700 dark:text-amber-400' },
  B: { text: '밸류에이션 붕괴형', cls: 'text-red-700 dark:text-red-400' },
}

const SERIES_COLORS = {
  stock: { light: '#2a78d6', dark: '#3987e5' },
  bond: { light: '#1baf7a', dark: '#199e70' },
  gold: { light: '#eda100', dark: '#c98500' },
}

export function HistoryView({
  theme,
  onExplore,
}: {
  theme: 'light' | 'dark'
  onExplore: (startDate: string, endDate: string, note: string) => void
}) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch('/data/history.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '로드 실패'))
  }, [])

  const axisTickColor = theme === 'dark' ? '#9ca3af' : '#6b7280'
  const c = (k: keyof typeof SERIES_COLORS) => SERIES_COLORS[k][theme]

  // 전체 차트 데이터 (주식 실질 총수익, 로그 스케일)
  const overviewData = useMemo(() => {
    if (!data) return []
    const { dates, stock } = data.series
    const step = Math.max(1, Math.floor(dates.length / 800))
    const rows = []
    for (let i = 0; i < dates.length; i += step) rows.push({ ym: dates[i], stock: stock[i] })
    return rows
  }, [data])

  const selectedEp = data?.episodes.find((e) => e.peak === selected) ?? null

  // 상세 차트: 고점 12개월 전 ~ 회복 12개월 후, 고점 = 100 정규화
  const detailData = useMemo(() => {
    if (!data || !selectedEp) return []
    const { dates, stock, bond, gold } = data.series
    const peakI = dates.indexOf(selectedEp.peak)
    const recI = selectedEp.recovery ? dates.indexOf(selectedEp.recovery) : dates.length - 1
    const from = Math.max(0, peakI - 12)
    const to = Math.min(dates.length - 1, recI + 12)
    const normAt = (arr: (number | null)[], i: number) =>
      arr[i] != null && arr[peakI] != null ? Number((((arr[i] as number) / (arr[peakI] as number)) * 100).toFixed(2)) : null
    const rows = []
    for (let i = from; i <= to; i++) {
      rows.push({ ym: dates[i], 주식: normAt(stock, i), 장기국채: normAt(bond, i), 금: normAt(gold, i) })
    }
    return rows
  }, [data, selectedEp])

  if (error) {
    return <div className={`${cardCls} p-6 text-sm text-red-700 dark:text-red-300`}>역사 데이터 로드 실패: {error}</div>
  }
  if (!data) {
    return <div className={`${cardCls} p-6 text-sm text-zinc-500`}>역사 데이터 로딩 중…</div>
  }

  return (
    <div className="space-y-5">
      {/* 전체 실질 총수익 + 음수 구간 밴드 */}
      <div className={`${cardCls} p-4 sm:p-5`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">HISTORY · REAL TOTAL RETURN</span>
          미국 주식 실질 총수익 (1900 ~ {data.meta.dataEnd})
          <HelpTip title="이 차트의 기준">
            <b>실질(인플레이션 조정) 총수익</b> — 배당을 재투자하고 CPI로 구매력을 보정한
            지수(로그 스케일, 1900년 = 100). 명목 주가지수와 전혀 다릅니다: 명목으론 신고가여도
            실질로는 물려있을 수 있습니다. 음영 = 전고점 회복까지 3년 이상 걸린 실질 낙폭
            −25% 이하 구간(데이터에서 직접 검출). 데이터: Shiller 월간(가격은 일별 종가의
            월평균 — 일별 시리즈보다 낙폭이 완만하게 표기됨).
          </HelpTip>
        </h2>
        <p className="text-xs text-zinc-400 mb-3">음영 구간 = 실질 기준 −25% 이상 낙폭 + 3년 이상 수면하 · 클릭해 상세 보기</p>
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
              formatter={(v) => [`${Number(v).toFixed(0)} (1900=100)`, '실질 총수익']}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            {data.episodes.map((e) => (
              <ReferenceArea
                key={e.peak}
                x1={e.peak}
                x2={e.recovery ?? data.meta.dataEnd}
                fill={selected === e.peak ? 'rgba(227,73,72,0.28)' : 'rgba(227,73,72,0.12)'}
                stroke="none"
                onClick={() => setSelected(e.peak)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            <Line type="monotone" dataKey="stock" stroke={c('stock')} strokeWidth={1.8} dot={false} name="실질 총수익" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 구간 카드 */}
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

      {/* 선택 구간 상세 */}
      {selectedEp && (
        <div className={`${cardCls} p-4 sm:p-5 space-y-3`}>
          <div className="flex items-start justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak}
              <span className="ml-2 text-[11px] font-mono font-normal text-zinc-400">
                고점 {selectedEp.peak} · 저점 {selectedEp.trough} ({selectedEp.depthPct.toFixed(1)}%) · 회복 {selectedEp.recovery ?? '미회복'}
              </span>
            </h3>
            <button
              onClick={() => {
                const end = selectedEp.recovery ?? data.meta.dataEnd
                onExplore(
                  `${selectedEp.peak}-01`,
                  `${end}-01`,
                  `역사 구간 프리셋: ${EPISODE_INFO[selectedEp.peak]?.title ?? selectedEp.peak} (${selectedEp.peak} ~ ${end}). ` +
                    (selectedEp.peak >= '1993'
                      ? '전체 자산군 백테스트 가능 (SPY·QQQ 등).'
                      : selectedEp.peak >= '1986'
                        ? '주식은 ^GSPC, 채권은 VUSTX, 금은 CEF 사용 가능.'
                        : '이 시대는 ^GSPC(1928~ 일별)로 주식만 백테스트 가능 — 채권·금 ETF 데이터 없음.'),
                )
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${btnGhostCls}`}
            >
              <FlaskConical className="w-3.5 h-3.5" /> 백테스터에서 돌려보기
            </button>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{EPISODE_INFO[selectedEp.peak]?.cause}</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={detailData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} minTickGap={50} />
              <YAxis tick={{ fontSize: 11, fill: axisTickColor }} stroke={axisTickColor} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => String(Math.round(v))} />
              <Tooltip
                formatter={(v) => `${Number(v).toFixed(1)} (고점=100)`}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="주식" stroke={c('stock')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="장기국채" stroke={c('bond')} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="금" stroke={c('gold')} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            전 시리즈 실질(CPI 조정)·고점=100. 장기국채는 GS10 수익률 파생 만기고정 근사(실제 지수 아님) ·
            금은 1933-1974 미국 민간보유 금지·공정가 시대 주의 · 출처: Shiller(Yale) 미러 + datasets/gold-prices (ODC-PDDL) ·
            방법론 상세: docs/research/negative-real-return-eras.md
          </p>
        </div>
      )}

      {/* 에피스테믹 각주 */}
      <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-sm p-3 text-[11px] text-amber-900 dark:text-amber-200/90 leading-relaxed">
        <b>읽는 법 주의</b> — 이 차트는 "명목 주가"가 아니라 <b>배당 재투자 + 인플레이션 보정</b> 기준입니다.
        흔히 인용되는 "대공황 −84%, 1954년 회복"은 명목 가격 기준이고, 실질 총수익 기준은 −77%, 1936/1945년 회복입니다.
        가격이 일별 종가의 월평균이라 일별 시리즈보다 낙폭이 완만하게 보입니다. 과거 한 경로의 기록이지 예측이 아닙니다.
      </div>
    </div>
  )
}
