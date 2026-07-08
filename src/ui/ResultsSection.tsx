import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { assetCautionFor, type StrategyRun, type AlignedDataBundle } from '@/core'
import { HelpTip } from './HelpTip'
import { cardCls, fmtUsd, fmtSignedUsd, fmtPct, fmtSignedPct } from './common'

/**
 * 결과 섹션 (§7) — TWRR 기준 정렬 비교표 + growth-of-$1 오버레이 +
 * 세금 드래그(5.5 핵심 가치) + 연도별 서브기간(6.4)
 */
export function ResultsSection({
  runs,
  bundle,
  palette,
  theme,
  taxEnabled,
}: {
  runs: StrategyRun[]
  bundle: AlignedDataBundle
  palette: string[]
  theme: 'light' | 'dark'
  taxEnabled: boolean
}) {
  const [taxView, setTaxView] = useState<'postTax' | 'preTax'>('postTax')

  // 전략별 고정 색 (등수 아닌 엔티티 기준 — 정렬돼도 색 유지)
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(r.config.id, palette[i % palette.length]))
    return m
  }, [runs, palette])

  const colorByName = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(r.config.name, palette[i % palette.length]))
    return m
  }, [runs, palette])

  // §7: TWRR 기준 정렬
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b[taxView].metrics.twrrAnnualPct - a[taxView].metrics.twrrAnnualPct),
    [runs, taxView]
  )

  // 누적 수익률 오버레이 데이터 (다운샘플 ~500 포인트)
  // 각 포인트에 평가액·투입원금을 동봉 — 커서 툴팁에서 원금/수익금/수익률 표시용
  const chartData = useMemo(() => {
    const n = runs[0][taxView].metrics.growthOf1.length
    const step = Math.max(1, Math.ceil(n / 500))
    const rows: Record<string, string | number>[] = []
    const pushRow = (i: number) => {
      const row: Record<string, string | number> = {
        date: runs[0][taxView].metrics.growthOf1[i].date,
        __contrib: runs[0][taxView].result.daily[i].cumContributions,
      }
      for (const r of runs) {
        row[r.config.name] = Number(r[taxView].metrics.growthOf1[i].value.toFixed(4))
        row[`${r.config.name}__value`] = r[taxView].result.daily[i].value
      }
      rows.push(row)
    }
    for (let i = 0; i < n; i += step) pushRow(i)
    if ((n - 1) % step !== 0) pushRow(n - 1)
    return rows
  }, [runs, taxView])

  const engineWarnings = useMemo(() => {
    const agg: { name: string; code: string; count: number; first: string }[] = []
    for (const r of runs) {
      const byCode = new Map<string, { count: number; first: string }>()
      for (const w of r.postTax.result.warnings) {
        const e = byCode.get(w.code)
        if (e) e.count++
        else byCode.set(w.code, { count: 1, first: w.message })
      }
      for (const [code, v] of byCode) agg.push({ name: r.config.name, code, count: v.count, first: v.first })
    }
    return agg
  }, [runs])

  // 지수/선물 등 "실매매 불가 자산" 가정 경고 (카탈로그 note + ^/=F 패턴)
  const assetCautions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of runs) {
      for (const s of r.config.sleeves) {
        const caution = assetCautionFor(s.ticker)
        if (caution && !seen.has(s.ticker)) seen.set(s.ticker, caution)
      }
    }
    return [...seen.entries()]
  }, [runs])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const r of runs) for (const a of r[taxView].metrics.annualReturns) set.add(a.year)
    return [...set].sort()
  }, [runs, taxView])

  const gridColor = 'rgba(128,128,128,0.15)'
  // (가시성) 축 라벨은 배경과 대비되는 회색 — 다크에서 기본값(#666)이 묻히는 문제 수정
  const axisTickColor = theme === 'dark' ? '#9ca3af' : '#6b7280'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">RESULTS</span>
          결과{' '}
          <span className="text-xs font-normal text-gray-400">
            {bundle.dates[0]} ~ {bundle.dates[bundle.dates.length - 1]} · {bundle.dates.length}거래일 · 스냅샷 {bundle.snapshotHash}
          </span>
        </h2>
        {taxEnabled && (
          <div className="flex rounded border border-[#cfd5e1] dark:border-[#363a45] overflow-hidden text-xs font-medium">
            {(
              [
                { key: 'postTax', label: '세후' },
                { key: 'preTax', label: '세전' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTaxView(key)}
                className={`px-3 py-1.5 font-mono tracking-wider ${taxView === key ? 'ink-chip' : 'text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 데이터·엔진 경고 */}
      {(bundle.clipWarnings.length > 0 || engineWarnings.length > 0 || assetCautions.length > 0) && (
        <div className="bg-[#f3f5f9] dark:bg-[#171c28] border-l-4 border-zinc-400 dark:border-zinc-600 rounded-lg p-3 text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
          {assetCautions.map(([ticker, caution]) => (
            <p key={`caution-${ticker}`}>⚠ [{ticker}] {caution}</p>
          ))}
          {bundle.clipWarnings.map((w, i) => (
            <p key={`clip-${i}`}>⚠ {w}</p>
          ))}
          {engineWarnings.map((w, i) => (
            <p key={`eng-${i}`}>
              ⚠ [{w.name}] {w.first}
              {w.count > 1 && ` (외 ${w.count - 1}건)`}
            </p>
          ))}
        </div>
      )}

      {/* 누적 수익률 오버레이 (6.2: 낙폭·비교는 TWRR 기준) */}
      <div className={`${cardCls} p-5`}>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          누적 수익률 (TWRR 기준{taxEnabled ? (taxView === 'postTax' ? ' · 세후' : ' · 세전') : ''})
          <HelpTip title="누적 수익률 곡선">
            납입 타이밍 효과를 제거한 전략 자체의 누적 수익률(시간가중)입니다.
            곡선 위에 커서를 올리면 그 시점의 투입 원금·평가액·수익금을 보여줍니다 —
            평가액 기준 수익률은 납입 타이밍이 섞여 곡선(TWRR)과 다를 수 있습니다.
          </HelpTip>
        </h3>
        <p className="text-xs text-gray-400 mb-3">납입 타이밍 효과를 제거한 전략 자체 성과 — 공정 비교 잣대</p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: axisTickColor }}
              stroke={axisTickColor}
              minTickGap={60}
              tickFormatter={(d: string) => d.slice(0, 7)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: axisTickColor }}
              stroke={axisTickColor}
              width={48}
              domain={['auto', 'auto']}
              tickFormatter={(g: number) => `${g >= 1 ? '+' : ''}${((g - 1) * 100).toFixed(0)}%`}
            />
            <Tooltip content={<MoneyTooltip colorByName={colorByName} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {runs.map((r) => (
              <Line
                key={r.config.id}
                type="monotone"
                dataKey={r.config.name}
                stroke={colorOf.get(r.config.id)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 비교 테이블 (§7 TWRR 정렬) */}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="ledger-table w-full text-xs min-w-[880px]">
          <thead>
            <tr className="text-zinc-500 dark:text-zinc-500 border-b border-[#d3d8e3] dark:border-[#363a45]">
              <th className="text-left px-4 py-3 font-medium">전략</th>
              <th className="text-right px-3 py-3 font-medium">
                TWRR/년
                <HelpTip title="TWRR/년 — 전략 자체의 연평균 수익률" align="right">
                  이 <b>규칙(전략) 자체</b>가 1년에 평균 몇 %씩 불렸는지입니다.
                  돈을 언제 넣었는지의 "운"은 제거합니다.
                  <br />예: TWRR 8%/년 = 처음부터 목돈을 넣고 이 규칙대로만 굴렸다면
                  매년 평균 8%씩 복리로 늘었다는 뜻.
                  <br />적립 시점과 무관해서 <b>전략끼리 비교할 때 공정한 기준</b>이고,
                  이 표도 이 값으로 정렬돼 있습니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                MWRR/년
                <HelpTip title="MWRR/년 — 내 돈의 실제 연평균 수익률" align="right">
                  <b>내 계좌의 돈</b>이 실제로 1년에 몇 %씩 불었는지입니다.
                  적립을 언제 얼마나 넣었는지(타이밍)까지 반영합니다.
                  <br />예: 폭등 <b>직전</b>에 큰돈을 넣었다면 MWRR이 TWRR보다 높고,
                  고점에서 몰아 넣었다면 낮습니다.
                  <br />TWRR과 차이가 크다 = 전략보다 <b>납입 타이밍</b>이 내 결과를
                  좌우했다는 신호입니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                MDD
                <HelpTip title="MDD — 최악의 순간 하락폭" align="right">
                  기간 중 <b>최고점 대비 가장 깊게 빠졌던 비율</b>입니다.
                  <br />예: MDD −40% = 한때 자산이 고점의 60%까지 녹는 구간을
                  버텨야 했다는 뜻 — "이 전략을 유지하려면 이만큼의 하락을 견딜 수
                  있어야 한다"는 멘탈 시험지입니다.
                  <br />매달 적립하면 계좌 잔액은 계속 커져 하락이 안 보이므로,
                  적립 효과를 제거한 수익률 곡선(TWRR)에서 계산합니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                수면하(일)
                <HelpTip title="수면하(일) — 본전 이하로 지낸 최장 기간" align="right">
                  이전 최고 기록(전고점)을 되찾지 못한 채 <b>그 아래에 머문 가장 긴
                  기간(달력일)</b>입니다. 기간 끝까지 회복 못 한 구간도 포함합니다.
                  <br />예: 수면하 365일 = 1년 내내 "계좌가 최고점보다 낮은 상태".
                  <br />숫자가 클수록 <b>오래 물려있는 고통</b>이 긴 전략입니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                변동성/년
                <HelpTip title="변동성/년 — 출렁임의 크기 (손실 크기 아님!)" align="right">
                  수익률이 얼마나 <b>출렁이는지</b>를 1년 단위로 환산한
                  값입니다. 손실률이 아니라 <b>흔들림의 폭</b>입니다.
                  <br />감 잡기: 미국 주식 지수 15~20%, 채권 5~10%, 비트코인 60~80%+.
                  <br /><b>100%를 넘을 수도 있나?</b> 네 — 하루 ±6% 이상 출렁이는
                  자산은 연환산(×√252)하면 100%를 넘습니다. "1년에 100% 잃는다"는
                  뜻이 아니라 결과의 불확실성이 그만큼 크다는 뜻입니다.
                  <br />연환산 계수는 데이터 해상도를 따릅니다 — 일별 √252, 역사
                  월간(-HIST) 자산은 √12. 월간 데이터는 일중 출렁임이 뭉개져 같은
                  자산이라도 일별보다 낮게 나옵니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">최종 가치</th>
              <th className="text-right px-3 py-3 font-medium">총 납입</th>
              <th className="text-right px-3 py-3 font-medium">세금</th>
              <th className="text-right px-3 py-3 font-medium">비용</th>
              <th className="text-right px-3 py-3 font-medium">거래</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const m = r[taxView].metrics
              const res = r[taxView].result
              return (
                <tr key={r.config.id} className="border-b border-[#e9edf4] dark:border-[#262b38] text-zinc-800 dark:text-zinc-200">
                  <td className="px-4 py-2.5 font-medium">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                    {r.config.name}
                  </td>
                  <td className="text-right px-3 py-2.5 font-semibold">{fmtPct(m.twrrAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5">{fmtPct(m.mwrrAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5 text-red-500">{fmtPct(m.maxDrawdownPct)}</td>
                  <td className="text-right px-3 py-2.5">{m.maxUnderwaterDays}</td>
                  <td className="text-right px-3 py-2.5">{fmtPct(m.volAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5 font-semibold">{fmtUsd(m.finalValue)}</td>
                  <td className="text-right px-3 py-2.5">{fmtUsd(m.totalContributions)}</td>
                  {/* 세금 = 연말 정산분 + 배당 원천징수 (원천도 실제 납부 세금) */}
                  <td className="text-right px-3 py-2.5">
                    {fmtUsd(r.postTax.result.totalTaxesUsd + r.postTax.result.dividendsWithheldUsd)}
                  </td>
                  <td className="text-right px-3 py-2.5">{fmtUsd(res.totalFeesUsd)}</td>
                  <td className="text-right px-3 py-2.5">{res.trades.length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 세금 드래그 요약 (5.5 — 이 툴의 핵심 가치) */}
      {taxEnabled && (
        <div className={`${cardCls} p-5`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            세금 드래그 (세전 − 세후)
            <HelpTip title="세금 드래그 — 세금이 깎아먹는 연 수익률">
              <b>같은 전략을 세금 없이 돌렸을 때</b>와 실제 세금(양도세 + 배당
              원천징수 15%)을 내면서 돌렸을 때의 연 수익률 차이입니다.
              <br />예: −0.50%p/년 = 세금 때문에 매년 수익률이 0.5%포인트씩
              깎였다는 뜻. 복리로 쌓이면 장기에선 큰 금액입니다.
              <br />리밸런싱 매도가 잦을수록 이익 실현 → 과세가 앞당겨져 드래그가
              커집니다. <b>무매도 전략과 비교</b>해보면 세금 이연의 가치가 보입니다.
            </HelpTip>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map((r) => {
              const drag = r.preTax.metrics.twrrAnnualPct - r.postTax.metrics.twrrAnnualPct
              const res = r.postTax.result
              return (
                <div key={r.config.id} className="border border-[#dfe3ec] dark:border-[#2a2e39] rounded p-3">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                    {r.config.name}
                  </div>
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">−{drag.toFixed(2)}%p/년</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    양도세 {fmtUsd(res.totalTaxesUsd)} + 배당 원천 {fmtUsd(res.dividendsWithheldUsd)} — 실현익 과세와 원천징수가 만드는 복리 드래그
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 연도별 수익률 (6.4 서브기간 견고성) */}
      <div className={`${cardCls} overflow-x-auto`}>
        <div className="px-4 pt-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            연도별 TWRR <span className="text-xs font-normal text-gray-400">— 한 경로 안의 서브기간 견고성 확인</span>
          </h3>
        </div>
        <table className="ledger-table w-full text-xs min-w-[560px]">
          <thead>
            <tr className="text-zinc-500 dark:text-zinc-500 border-b border-[#d3d8e3] dark:border-[#363a45]">
              <th className="text-left px-4 py-3 font-medium">연도</th>
              {sorted.map((r) => (
                <th key={r.config.id} className="text-right px-3 py-3 font-medium">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                  {r.config.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y} className="border-b border-[#e9edf4] dark:border-[#262b38] text-zinc-800 dark:text-zinc-200">
                <td className="px-4 py-2">{y}</td>
                {sorted.map((r) => {
                  const a = r[taxView].metrics.annualReturns.find((x) => x.year === y)
                  return (
                    <td key={r.config.id} className={`text-right px-3 py-2 ${a && a.returnPct < 0 ? 'text-red-500' : ''}`}>
                      {a ? fmtPct(a.returnPct) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 차트 커서 툴팁 — 그 시점의 투입 원금·평가액·수익금(률) ────────────────────

interface TooltipEntry {
  dataKey?: string | number
  payload?: Record<string, string | number>
}

function MoneyTooltip({
  active,
  payload,
  label,
  colorByName,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  colorByName: Map<string, string>
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload ?? {}
  const contrib = Number(row['__contrib'] ?? 0)

  // 평가액 큰 순으로 정렬
  const entries = payload
    .map((p) => {
      const name = String(p.dataKey ?? '')
      const value = Number(row[`${name}__value`] ?? 0)
      return { name, value, profit: value - contrib }
    })
    .sort((a, b) => b.value - a.value)

  return (
    <div className="rounded border border-[#d3d8e3] dark:border-[#363a45] bg-[#ffffff] dark:bg-[#1e222d] shadow-lg p-3 text-xs space-y-1.5 max-w-xs">
      <div className="font-semibold text-zinc-900 dark:text-zinc-100">{label}</div>
      <div className="text-zinc-500 dark:text-zinc-400 pb-1 border-b border-[#d3d8e3] dark:border-[#363a45]">
        투입 원금 {fmtUsd(contrib)}
      </div>
      {entries.map((e) => (
        <div key={e.name} className="flex items-baseline gap-1.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0 self-center"
            style={{ backgroundColor: colorByName.get(e.name) }}
          />
          <span className="text-zinc-600 dark:text-zinc-300 truncate">{e.name}</span>
          <span className="ml-auto text-right whitespace-nowrap">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{fmtUsd(e.value)}</span>
            <span className={e.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
              {' '}{fmtSignedUsd(e.profit)} ({fmtSignedPct(contrib > 0 ? (e.profit / contrib) * 100 : 0)})
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
