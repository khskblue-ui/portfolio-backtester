import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer } from 'recharts'
import { Radar, CircleCheck, CircleAlert, CircleX, CircleMinus, ExternalLink, History, FlaskConical, BellRing, BarChart3, type LucideIcon } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { tileCls, nbspShortParens, SERIES_COLORS_LIGHT, SERIES_COLORS_DARK } from './common'
import {
  loadTripodDashboard,
  withWeekday,
  fmtNum,
  fmtRate,
  fmtLev,
  kstStamp,
  exposureSpans,
  meterPos,
  conditionLevels,
  paperRows,
  PAPER_BENCH_IDS,
  PAPER_INFO,
  TRIPOD_FINDINGS,
  VIDEO_URL,
  type TripodDashboard,
  type TripodSource,
  type CondLevel,
} from './tripodData'

/**
 * 트라이팟 탭 — 매 거래일 판정 기록(signals/tripod/dashboard.json)을 대시보드로 보여 준다.
 * 판정 로직은 scripts/tripod/live.mjs에만 있고, 이 화면은 표시만 한다.
 */

type Theme = 'light' | 'dark'
const PERIODS = [
  { key: '6m', label: '6개월', days: 126 },
  { key: '1y', label: '1년', days: 252 },
  { key: '2y', label: '2년', days: 504 },
] as const

/** 보유 상품 색: QQQ·QLD·TQQQ·현금. 배수가 클수록 경고색에 가깝게 */
const holdColors = (theme: Theme) => {
  const p = theme === 'dark' ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT
  return [p[0], p[4], p[5], theme === 'dark' ? '#6b7280' : '#9ca3af']
}
const HOLD_NAMES = ['QQQ', 'QLD', 'TQQQ', '현금']
/** 차트 배경 음영: 3배 / 1.5배 / 현금 */
const spanFill = (L: number, theme: Theme) =>
  L >= 3 ? (theme === 'dark' ? 'rgba(230,103,103,0.10)' : 'rgba(227,73,72,0.08)')
    : L > 0 ? (theme === 'dark' ? 'rgba(144,133,233,0.12)' : 'rgba(74,58,167,0.07)')
      : 'rgba(128,128,128,0.10)'

const LEVEL: Record<CondLevel, { cls: string; Icon: LucideIcon }> = {
  ok: { cls: 'text-emerald-700 dark:text-emerald-400', Icon: CircleCheck },
  near: { cls: 'text-amber-700 dark:text-amber-400', Icon: CircleAlert },
  off: { cls: 'text-red-700 dark:text-red-400', Icon: CircleX },
  na: { cls: 'text-zinc-400 dark:text-zinc-500', Icon: CircleMinus },
}

/** 날짜·수치처럼 줄 끝에서 갈라지면 안 되는 토막 */
const Nw = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>
/** 판정 문장의 "× 1.01" 같은 토막을 한 덩어리로 */
const tidy = (x: string) => nbspShortParens(x.replace(/ × /g, '\u00A0×\u00A0').replace(/× (\d)/g, '×\u00A0$1'), 18)

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">{children}</span>
}

function StatusChip({ level, text }: { level: CondLevel; text: string }) {
  const { cls, Icon } = LEVEL[level]
  return (
    <span className={`flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {text}
    </span>
  )
}

/** 가로 게이지: 기준선 표식 + 현재값 점. 구간(band)이 있으면 옅게 칠한다 */
type Mark = { pos: number; text: string; danger?: boolean; align?: 'left' | 'right' }
function Meter({ pos, marks, band, label }: { pos: number; marks: Mark[]; band?: [number, number]; label: string }) {
  return (
    <div className="mt-3" role="img" aria-label={label}>
      <div className="relative h-2 rounded-full bg-[#e8ecf3] dark:bg-[#2a2e39]">
        {band && <div className="absolute inset-y-0 bg-zinc-300/70 dark:bg-zinc-600/60" style={{ left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }} />}
        {marks.map((m) => (
          <div key={m.text} className={`absolute -top-1 -bottom-1 w-0.5 ${m.danger ? 'bg-red-500/80' : 'bg-zinc-400'}`} style={{ left: `calc(${m.pos * 100}% - 1px)` }} />
        ))}
        <div className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full bg-[#2962ff] ring-2 ring-white dark:ring-[#1e222d]" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="relative h-4 mt-1">
        {marks.map((m) => (
          <span
            key={m.text}
            className={`absolute text-[10px] font-mono whitespace-nowrap ${m.danger ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}`}
            style={{ left: `${m.pos * 100}%`, transform: m.align === 'right' || m.pos > 0.85 ? 'translateX(-100%)' : m.align === 'left' || m.pos < 0.15 ? 'none' : 'translateX(-50%)' }}
          >
            {m.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function AllocationBar({ weights, theme }: { weights: number[]; theme: Theme }) {
  const colors = holdColors(theme)
  const parts = weights.map((w, k) => ({ w, k })).filter((x) => x.w > 1e-9)
  return (
    <div className="mt-4">
      <div className="flex h-3 rounded-full overflow-hidden" role="img" aria-label={parts.map((p) => `${HOLD_NAMES[p.k]} ${Math.round(p.w * 100)}%`).join(', ')}>
        {parts.map((p) => (
          <div key={p.k} style={{ width: `${p.w * 100}%`, background: colors[p.k] }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.k} className="flex items-center gap-1.5 text-[11.5px] text-zinc-600 dark:text-zinc-300">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[p.k] }} />
            {HOLD_NAMES[p.k]} {Math.round(p.w * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

type Leaf = 'up3' | 'up15' | 'down15' | 'cash' | null

function Branch({ title, on, leaf, rows }: { title: string; on: boolean; leaf: Leaf; rows: { key: Leaf; cond: string; out: string }[] }) {
  return (
    <div className={`rounded-xl p-3 ${on ? 'bg-[#eef4ff] dark:bg-[#16223c]' : 'bg-[#f5f7fa] dark:bg-white/[0.03]'}`}>
      <div className={`text-[12.5px] font-bold ${on ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-500 dark:text-zinc-400'}`}>{title}{on && ' · 지금'}</div>
      <ul className="mt-2 space-y-1.5">
        {rows.map((x) => {
          const active = leaf === x.key
          return (
            <li key={x.key} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-snug ${active ? 'bg-white dark:bg-[#1e222d] shadow-[0_1px_3px_rgba(19,23,34,0.08)]' : ''}`}>
              <span className={`mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-[#2962ff]' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
              <span className={`min-w-0 ${active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {x.cond} <span className="text-zinc-400">→</span> <b className={`whitespace-nowrap ${active ? 'text-zinc-900 dark:text-zinc-100' : ''}`}>{x.out}</b>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 판정 흐름: 지금 해당하는 갈래를 강조 */
function DecisionFlow({ d }: { d: TripodDashboard }) {
  const { checks } = d.tripod, r = d.rule
  const leaf: Leaf = checks.regime === 'UP' ? (checks.vixOk && checks.ddOk ? 'up3' : 'up15') : checks.regime === 'DOWN' ? (checks.vixOk ? 'down15' : 'cash') : null
  const ddPct = `${Math.round(-r.ddLimit * 100)}%`
  return (
    <div className={`${tileCls} p-4 sm:p-5`}>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        <Eyebrow>DECISION</Eyebrow>
        판정 흐름
      </h3>
      <div className="mt-3 space-y-2.5">
        <Branch
          title="상승 국면"
          on={checks.regime === 'UP'}
          leaf={leaf}
          rows={[
            { key: 'up3', cond: `VIX 10일 평균 ${r.vixUp} 미만이고 52주 낙폭 ${ddPct} 이내`, out: 'TQQQ 100%' },
            { key: 'up15', cond: '둘 중 하나라도 아니면', out: 'QQQ 50% + QLD 50%' },
          ]}
        />
        <Branch
          title="하락 국면"
          on={checks.regime === 'DOWN'}
          leaf={leaf}
          rows={[
            { key: 'down15', cond: `VIX 10일 평균 ${r.vixDown} 미만`, out: 'QQQ 50% + QLD 50%' },
            { key: 'cash', cond: '아니면', out: '현금 100%' },
          ]}
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        국면은 나스닥100 종가가 {r.maWin}일 이동평균 <Nw>× {r.upBand.toFixed(2)}</Nw> 위로 마감하면 상승, <Nw>× {r.downBand.toFixed(2)}</Nw> 아래로 마감하면 하락으로 바뀝니다. 그 사이에서는 직전 국면을 유지합니다.
      </p>
    </div>
  )
}

export function TripodView({ theme, onBacktest }: { theme: Theme; onBacktest?: () => void }) {
  const [state, setState] = useState<{ data: TripodDashboard; source: TripodSource } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('1y')

  useEffect(() => {
    loadTripodDashboard()
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'))
  }, [])

  const axis = theme === 'dark' ? '#9ca3af' : '#6b7280'
  const lineColor = theme === 'dark' ? SERIES_COLORS_DARK[0] : SERIES_COLORS_LIGHT[0]
  const tooltipContentStyle = { fontSize: 12, borderRadius: 8, background: theme === 'dark' ? '#1e222d' : '#ffffff', border: `1px solid ${theme === 'dark' ? '#363a45' : '#e0e3eb'}` }
  const tooltipLabelStyle = { fontSize: 12, fontWeight: 600, color: theme === 'dark' ? '#e4e4e7' : '#18181b' }

  const chart = useMemo(() => {
    if (!state) return null
    const h = state.data.history, r = state.data.rule
    const days = PERIODS.find((p) => p.key === period)!.days
    const from = Math.max(0, h.dates.length - days)
    const rows = h.dates.slice(from).map((d, j) => {
      const i = from + j
      return { d, close: h.close[i], ma: h.ma250[i], up: +(h.ma250[i] * r.upBand).toFixed(2), down: +(h.ma250[i] * r.downBand).toFixed(2), vix10: h.vix10[i], dd: +(h.dd[i] * 100).toFixed(2) }
    })
    return { rows, spans: exposureSpans(h.dates.slice(from), h.exposure.slice(from)) }
  }, [state, period])

  if (error) return <div className={`${tileCls} p-6 text-sm text-red-700 dark:text-red-300`}>트라이팟 기록을 불러오지 못했습니다: {error}</div>
  if (!state || !chart) return <div className={`${tileCls} p-6 text-sm text-zinc-500`}>트라이팟 판정 기록을 불러오는 중…</div>

  const { data, source } = state
  const t = data.tripod, r = data.rule
  const lv = conditionLevels(t, r)
  const up = t.regime === 'UP'
  const colors = holdColors(theme)
  const hardVix = (v: number) => v > 80 || v < 9
  const rows = paperRows(data)

  return (
    <div className="space-y-5">
      {source === 'snapshot' && (
        <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg px-4 py-3 text-xs text-amber-900 dark:text-amber-200/90">
          실시간 기록을 불러오지 못해 배포 시점의 저장본({withWeekday(data.asOf)} 판정)을 보여 줍니다. 잠시 후 새로고침하세요.
        </div>
      )}

      {/* 머리말 */}
      <div className={`${tileCls} p-4 sm:p-5`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          <Eyebrow>
            TRIPOD · 기준 {withWeekday(data.asOf)} 미국 종가 · {source === 'live' ? '실시간 기록' : '저장본'}
            {data.generatedAt && ` · 갱신 ${kstStamp(data.generatedAt)} KST`}
          </Eyebrow>
          <span className="flex items-center gap-1.5">
            <Radar className="w-4 h-4 text-[#2962ff]" />
            트라이팟 국면 현황
            <HelpTip title="트라이팟이란">
              <a href={VIDEO_URL} target="_blank" rel="noopener noreferrer" className="underline">송팀장 영상(2026-09-01 공개)</a>에서 소개된
              나스닥100 레버리지 매매 규칙입니다. 나스닥100의 {r.maWin}일 이동평균으로 상승·하락 국면을 나누고, VIX {r.vixWin}일 평균과
              52주 고점 대비 낙폭으로 TQQQ(3배) 100%, QQQ·QLD 반반(1.5배), 현금 중 하나를 고릅니다. 이 사이트가 공개된 규칙을 독립적으로
              재현·검증했고, 같은 코드로 매 거래일 판정해 기록합니다. 판정을 보여 줄 뿐 매매를 권유하지 않습니다.
            </HelpTip>
          </span>
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          매 거래일 미국 장 마감 뒤 규칙대로 판정한 결과입니다. 신호가 바뀌면 다음 거래일 종가에 체결하는 것이 검증에서 영상 수치를 재현한 해석입니다.
        </p>
        {onBacktest && (
          <button
            onClick={onBacktest}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#2962ff] dark:text-[#5b8aff] hover:underline"
          >
            <BarChart3 className="w-3.5 h-3.5" /> 이 규칙을 백테스트에서 직접 비교하기
          </button>
        )}
        {data.warnings.filter((w) => !w.startsWith('오프라인')).length > 0 && (
          <ul className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
            {data.warnings.filter((w) => !w.startsWith('오프라인')).map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </div>

      {/* 지금 비중 + 판정 흐름 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className={`${tileCls} p-4 sm:p-5 lg:col-span-3`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Eyebrow>NOW HOLDING</Eyebrow>
            지금 들고 있어야 할 비중
          </h3>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <span className="text-[28px] sm:text-[32px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t.holding}</span>
            <span className="ink-chip rounded-md px-2 py-0.5 text-[12px] font-bold font-mono">{fmtLev(t.exposure)}</span>
          </div>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            <Nw>{withWeekday(t.since)}</Nw> 판정, <Nw>{withWeekday(t.sinceExec)}</Nw> 종가 체결부터 유지
          </p>
          <AllocationBar weights={t.weights} theme={theme} />

          {t.changed ? (
            <div className="mt-4 rounded-xl border-l-4 border-[#2962ff] bg-[#eef4ff] dark:bg-[#16223c] px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#2962ff] dark:text-[#5b8aff]">
                <BellRing className="w-4 h-4" /> 신호 변경
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">
                {t.prevHolding} → <b>{t.holding}</b>. <Nw>{withWeekday(data.nextTradingDay)}</Nw> 미국 종가 무렵 체결합니다(한국 시간 <Nw>{data.nextCloseKst}</Nw> 마감).
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                {t.reasons.map((x) => <li key={x}>{tidy(x)}</li>)}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-[#f5f7fa] dark:bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              다음 매매 없음. 신호가 바뀌면 다음 거래일인 <Nw>{withWeekday(data.nextTradingDay)}</Nw> 종가에 체결합니다.
            </p>
          )}

          <h4 className="mt-4 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">판정 근거</h4>
          <ul className="mt-1.5 space-y-1">
            {t.why.map((x) => (
              <li key={x} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                <CircleCheck className="w-3.5 h-3.5 mt-[3px] text-zinc-400 flex-shrink-0" />
                <span className="min-w-0">{tidy(x)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-2">
          <DecisionFlow d={data} />
        </div>
      </div>

      {/* 조건 세 가지 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${tileCls} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400">추세 국면 ({r.maWin}일선)</span>
            <StatusChip level={lv.trend} text={up ? (lv.trend === 'near' ? '상승 · 전환선 근접' : '상승 국면') : t.regime === 'DOWN' ? '하락 국면' : '판정 전'} />
          </div>
          <div className="mt-1 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">× {t.ratio.toFixed(3)}</div>
          <div className="text-[11px] font-mono text-zinc-400">
            <Nw>나스닥100 {fmtNum(t.close)}</Nw> / <Nw>{r.maWin}일선 {fmtNum(t.ma250)}</Nw>
          </div>
          <Meter
            label={`250일선 대비 비율 ${t.ratio.toFixed(3)}, 하락 전환 ${r.downBand}, 상승 전환 ${r.upBand}`}
            pos={meterPos(t.ratio, 0.85, 1.25)}
            band={[meterPos(r.downBand, 0.85, 1.25), meterPos(r.upBand, 0.85, 1.25)]}
            marks={[
              { pos: meterPos(r.downBand, 0.85, 1.25), text: `×${r.downBand}`, danger: true, align: 'right' },
              { pos: meterPos(r.upBand, 0.85, 1.25), text: `×${r.upBand}`, align: 'left' },
            ]}
          />
          <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {up
              ? <>나스닥100이 <b className="font-mono">{fmtNum(t.downPx)}</b> 아래로 마감하면 하락 국면({fmtRate(t.downPx / t.close - 1)})</>
              : <>나스닥100이 <b className="font-mono">{fmtNum(t.upPx)}</b> 위로 마감하면 상승 국면({fmtRate(t.upPx / t.close - 1)})</>}
            . <Nw>{withWeekday(t.regimeSince)}</Nw>부터 {up ? '상승' : '하락'} 국면.
          </p>
        </div>

        <div className={`${tileCls} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400">VIX {r.vixWin}일 평균</span>
            <StatusChip level={lv.vix} text={lv.vix === 'ok' ? '기준 아래' : lv.vix === 'near' ? '기준 근접' : '기준 이상'} />
          </div>
          <div className="mt-1 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{t.vix10.toFixed(2)}</div>
          <div className="text-[11px] font-mono text-zinc-400"><Nw>당일 VIX {t.vix.toFixed(2)}</Nw> · <Nw>{up ? `상승 국면 기준 ${r.vixUp}` : `하락 국면 기준 ${r.vixDown}`}</Nw></div>
          <Meter
            label={`VIX 10일 평균 ${t.vix10.toFixed(2)}, 기준 ${r.vixDown}과 ${r.vixUp}`}
            pos={meterPos(t.vix10, 10, 40)}
            marks={[
              { pos: meterPos(r.vixDown, 10, 40), text: String(r.vixDown), danger: !up },
              { pos: meterPos(r.vixUp, 10, 40), text: String(r.vixUp), danger: up },
            ]}
          />
          <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {up ? (
              <>다음 거래일 VIX가 <b className="font-mono">{t.vixNeed28.toFixed(2)}</b> 이상으로 마감하면 평균이 {r.vixUp} 이상이 되어 1.5배로{hardVix(t.vixNeed28) && '(하루 만에는 어려운 수준)'}.</>
            ) : t.vix10 < r.vixDown ? (
              <>다음 거래일 VIX가 <b className="font-mono">{t.vixNeed18.toFixed(2)}</b> 이상으로 마감하면 평균이 {r.vixDown} 이상이 되어 현금으로.</>
            ) : (
              <>다음 거래일 VIX가 <b className="font-mono">{t.vixNeed18.toFixed(2)}</b> 미만으로 마감하면 평균이 {r.vixDown} 미만이 되어 1.5배로{hardVix(t.vixNeed18) && '(하루 만에는 어려운 수준)'}.</>
            )}
          </p>
        </div>

        <div className={`${tileCls} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-zinc-500 dark:text-zinc-400">52주 고점 대비 낙폭</span>
            <StatusChip level={lv.dd} text={lv.dd === 'ok' ? '한도 이내' : lv.dd === 'near' ? '한도 근접' : lv.dd === 'off' ? '한도 초과' : '하락 국면엔 안 봄'} />
          </div>
          <div className="mt-1 text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{fmtRate(t.dd)}</div>
          <div className="text-[11px] font-mono text-zinc-400"><Nw>52주 최고 종가 {fmtNum(t.high52)}</Nw> · <Nw>한도 {fmtRate(r.ddLimit, 0)}</Nw></div>
          <Meter
            label={`52주 고점 대비 ${fmtRate(t.dd)}, 한도 ${fmtRate(r.ddLimit, 0)}`}
            pos={meterPos(t.dd, -0.25, 0)}
            marks={[{ pos: meterPos(r.ddLimit, -0.25, 0), text: fmtRate(r.ddLimit, 0), danger: up }]}
          />
          <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {up
              ? <>나스닥100이 <b className="font-mono">{fmtNum(t.ddPx)}</b> 아래로 마감하면 한도를 넘어 1.5배로({fmtRate(t.ddPx / t.close - 1)}).</>
              : <>하락 국면에서는 낙폭 조건 없이 VIX만으로 1.5배와 현금을 고릅니다.</>}
          </p>
        </div>
      </div>
      <p className="-mt-2 text-[10.5px] text-zinc-400 leading-relaxed">
        경계값은 다음 거래일 종가 기준입니다. 이동평균과 52주 고점은 오늘 값으로 근사했고, VIX 경계는 10일 평균 계산식으로 정확히 구했습니다. "근접"은 화면 안내용 표시이며 규칙의 일부가 아닙니다.
      </p>

      {/* 흐름 그래프 */}
      <div className={`${tileCls} p-4 sm:p-5`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Eyebrow>HISTORY</Eyebrow>
            최근 흐름과 보유 상태
          </h3>
          <div className="flex rounded border border-[#d3d8e3] dark:border-[#363a45] overflow-hidden text-xs font-mono">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 transition-colors ${period === p.key ? 'ink-chip font-semibold' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: lineColor }} />나스닥100</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-zinc-400" />{r.maWin}일선</span>
          <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-red-500" />× {r.downBand} 하락 전환</span>
          <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-emerald-600" />× {r.upBand} 상승 전환</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: spanFill(3, theme) }} />TQQQ 보유</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: spanFill(1.5, theme) }} />1.5배 보유</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: spanFill(0, theme) }} />현금</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chart.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: axis }} stroke={axis} minTickGap={50} tickFormatter={(d: string) => d.slice(2, 7)} />
            <YAxis tick={{ fontSize: 10, fill: axis }} stroke={axis} width={52} domain={['auto', 'auto']} tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'} />
            <Tooltip
              labelStyle={tooltipLabelStyle}
              contentStyle={tooltipContentStyle}
              formatter={(v, name) => [fmtNum(Number(v)), String(name)]}
            />
            {chart.spans.map((s) => (
              <ReferenceArea key={`${s.x1}-${s.L}`} x1={s.x1} x2={s.x2} fill={spanFill(s.L, theme)} stroke="none" ifOverflow="hidden" />
            ))}
            <Line type="monotone" dataKey="down" name={`× ${r.downBand}`} stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.7} strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="up" name={`× ${r.upBand}`} stroke="#059669" strokeDasharray="4 3" strokeOpacity={0.7} strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="ma" name={`${r.maWin}일선`} stroke={axis} strokeWidth={1.2} dot={false} />
            <Line type="monotone" dataKey="close" name="나스닥100" stroke={lineColor} strokeWidth={1.8} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">VIX {r.vixWin}일 평균</h4>
            <p className="text-[10.5px] text-zinc-400">빨간 점선 {r.vixUp} = 상승 국면 기준 · 회색 점선 {r.vixDown} = 하락 국면 기준</p>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={chart.rows} margin={{ top: 8, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: axis }} stroke={axis} minTickGap={50} tickFormatter={(d: string) => d.slice(2, 7)} />
                <YAxis tick={{ fontSize: 10, fill: axis }} stroke={axis} width={36} domain={[0, 'auto']} />
                <Tooltip labelStyle={tooltipLabelStyle} contentStyle={tooltipContentStyle} formatter={(v) => [Number(v).toFixed(2), 'VIX 10일 평균']} />
                <ReferenceLine y={r.vixUp} ifOverflow="extendDomain" stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: String(r.vixUp), position: 'right', fontSize: 10, fill: '#dc2626' }} />
                <ReferenceLine y={r.vixDown} ifOverflow="extendDomain" stroke={axis} strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: String(r.vixDown), position: 'right', fontSize: 10, fill: axis }} />
                <Line type="monotone" dataKey="vix10" stroke={theme === 'dark' ? '#f97316' : '#c2410c'} strokeWidth={1.6} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">52주 고점 대비 낙폭 (%)</h4>
            <p className="text-[10.5px] text-zinc-400">빨간 점선 = 상승 국면의 낙폭 한도 {r.ddLimit * 100}%</p>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={chart.rows} margin={{ top: 8, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: axis }} stroke={axis} minTickGap={50} tickFormatter={(d: string) => d.slice(2, 7)} />
                <YAxis tick={{ fontSize: 10, fill: axis }} stroke={axis} width={36} domain={['auto', 0]} />
                <Tooltip labelStyle={tooltipLabelStyle} contentStyle={tooltipContentStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, '52주 고점 대비']} />
                <ReferenceLine y={r.ddLimit * 100} ifOverflow="extendDomain" stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: `${r.ddLimit * 100}%`, position: 'right', fontSize: 10, fill: '#dc2626' }} />
                <Line type="monotone" dataKey="dd" stroke={lineColor} strokeWidth={1.6} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 신호 이력 + 후보 가상 추적 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${tileCls} p-4 sm:p-5`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Eyebrow>SIGNALS</Eyebrow>
            <span className="flex items-center gap-1.5"><History className="w-4 h-4 text-zinc-400" />최근 신호</span>
          </h3>
          <ul className="mt-3 divide-y divide-[#e0e3eb] dark:divide-[#2a2e39]">
            {data.changes.map((c) => (
              <li key={c.d} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[12px] font-mono text-zinc-500 dark:text-zinc-400">{withWeekday(c.d)}</span>
                <span className="text-[12.5px] text-zinc-800 dark:text-zinc-100">
                  <Nw>{c.fromLabel}</Nw> <span className="text-zinc-400">→</span> <b className="whitespace-nowrap">{c.toLabel}</b>
                </span>
                <span className="w-full text-[11px] text-zinc-400"><Nw>{withWeekday(c.exec)}</Nw> 종가 체결</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${tileCls} p-4 sm:p-5 min-w-0`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Eyebrow>PAPER TRACKING</Eyebrow>
            <span className="flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-zinc-400" />
              후보 전략 가상 추적
              <HelpTip title="가상 추적과 매매법" align="right">
                <span className="block">
                  {data.paper?.start ?? '2026-10-23'} 종가에 {((data.paper?.initialKrw ?? 1e8) / 1e8).toFixed(0)}억 원으로 시작해 실제 ETF 수정종가로 매일 계산합니다.
                  오늘 전부 판다고 보고 매매 비용(편도 0.05%)을 뺀 값입니다. 세후는 한국 거주자 기준 양도세 22%(연 250만 원 공제, 손실 이월 없음,
                  해마다 연말에 낸다고 봄), 배당 원천징수 15%, 현금 이자 15.4%, 환율 1,400원 고정을 넣었습니다. 결과를 보기 전에 기준을 고정한
                  후보 4개를 몇 년 기록해 판단하려는 표입니다.
                </span>
                {rows.map((x) => (
                  <span key={x.id} className="block mt-2">
                    <b className="text-zinc-900 dark:text-zinc-100">{x.name}</b>: {tidy(PAPER_INFO[x.id] ?? '')}
                  </span>
                ))}
              </HelpTip>
            </span>
          </h3>
          <div className="mt-3 flex items-center justify-end gap-3 text-[10px] text-zinc-400 border-b border-[#e0e3eb] dark:border-[#2a2e39] pb-1">
            <span className="w-14 text-right">세전</span>
            <span className="w-14 text-right">세후</span>
          </div>
          {[rows.filter((x) => !PAPER_BENCH_IDS.includes(x.id)), rows.filter((x) => PAPER_BENCH_IDS.includes(x.id))].map((group, gi) => (
            <div key={gi}>
              {gi === 1 && <div className="mt-2 pt-2 text-[10px] font-mono tracking-[0.18em] text-zinc-400">단순 보유 비교</div>}
              <ul className="divide-y divide-[#e0e3eb] dark:divide-[#2a2e39]">
                {group.map((x) => (
                  <li key={x.id} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-zinc-800 dark:text-zinc-100">{x.name}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                        {x.weights.map((w, k) => (w > 1e-9 ? <span key={k} className="w-1.5 h-3 rounded-sm flex-shrink-0" style={{ background: colors[k], opacity: 0.35 + 0.65 * w }} /> : null))}
                        <span className="ml-1">{x.holding} · {fmtLev(x.exposure)}</span>
                      </div>
                    </div>
                    <div className="flex gap-3 flex-shrink-0 text-[12.5px] font-mono">
                      <span className="w-14 text-right text-zinc-600 dark:text-zinc-300">{Number.isFinite(x.pre) ? fmtRate(x.pre) : '—'}</span>
                      <span className="w-14 text-right font-semibold text-zinc-900 dark:text-zinc-100">{x.post == null ? '—' : fmtRate(x.post)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-zinc-400">
            {data.paper ? `${withWeekday(data.paper.start)} 종가 시작 · 기록 ${data.paper.dates.length}거래일 · 오늘 전부 판다고 본 시작 이후 수익률` : '가상 추적 기록 없음'}
          </p>
        </div>
      </div>

      {/* 검증 요약 */}
      <div className={`${tileCls} p-4 sm:p-5`}>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Eyebrow>VERIFICATION</Eyebrow>
          이 규칙을 검증해 보니
        </h3>
        <ul className="mt-2 space-y-1.5">
          {TRIPOD_FINDINGS.map((f) => (
            <li key={f.text} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#2962ff] flex-shrink-0" />
              <span className="min-w-0">{nbspShortParens(f.text, 18)}</span>
            </li>
          ))}
        </ul>
        <a href={VIDEO_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-[#2962ff] dark:text-[#5b8aff] hover:underline">
          원본 영상 <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* 백테스트 연결 — 같은 규칙을 원하는 기간·적립·자산 조합으로 직접 돌려 보기 */}
      {onBacktest && (
        <div className={`${tileCls} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3`}>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Eyebrow>BACKTEST</Eyebrow>
              직접 백테스트해 보기
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              같은 판정 규칙을 백테스트 탭에서 원하는 기간·거치식이나 적립식·세금 조건으로 돌릴 수 있습니다. 트라이팟 비중을 정하고
              현금이나 비트코인 같은 다른 자산을 섞어 QQQ 보유와 나란히 비교해 보세요. 신호가 바뀔 때의 교체 매매는 실제 매도로 계산해
              양도세까지 반영합니다.
            </p>
          </div>
          <button
            onClick={onBacktest}
            className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold btn-primary"
          >
            <BarChart3 className="w-4 h-4" /> 백테스트에서 비교하기
          </button>
        </div>
      )}

      <p className="text-[11px] text-zinc-400 leading-relaxed">
        매 거래일 미국 장 마감 뒤(한국 시간 07:20 무렵) 야후 파이낸스 일봉으로 판정해 기록합니다. 이 화면은 공개된 규칙의 판정을 보여 줄 뿐 매매를 권유하지 않습니다.
        레버리지 ETF(QLD·TQQQ)는 하루 등락이 지수의 2·3배라 원금 대부분을 잃을 수 있습니다.
      </p>
    </div>
  )
}

