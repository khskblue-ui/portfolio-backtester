import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { NumberInput } from './NumberInput'
import { assetCautionList, executionTiming, TRIPOD_SLEEVES, type StrategyRun, type AlignedDataBundle, type TripodState } from '@/core'
import { HelpTip } from './HelpTip'
import { cardCls, fmtUsd, fmtSignedUsd, fmtPct, fmtSignedPct , uniqueRunLabels, SERIES_COLORS_LIGHT, SERIES_COLORS_DARK } from './common'

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
  onAddOverride,
}: {
  runs: StrategyRun[]
  bundle: AlignedDataBundle
  palette: string[]
  theme: 'light' | 'dark'
  taxEnabled: boolean
  /** 차트에서 드래그로 고른 기간에 월 적립 조정을 추가 (고급) */
  onAddOverride?: (from: string, to: string, monthlyUsd: number) => void
}) {
  const [taxView, setTaxView] = useState<'postTax' | 'preTax'>('postTax')
  // 차트 브러시 선택 구간 (기간별 적립 조정용)
  const [sel, setSel] = useState<{ s: number; e: number } | null>(null)
  const [ovAmount, setOvAmount] = useState(2000)

  // 전략별 고정 색 (등수 아닌 엔티티 기준 — 정렬돼도 색 유지)
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(r.config.id, palette[i % palette.length]))
    return m
  }, [runs, palette])

  // 중복 이름 구분 라벨 — dataKey 충돌 방지 (id → 라벨)
  const labelOf = useMemo(() => uniqueRunLabels(runs), [runs])
  const colorByName = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(labelOf.get(r.config.id)!, palette[i % palette.length]))
    return m
  }, [runs, palette, labelOf])

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
        row[labelOf.get(r.config.id)!] = Number(r[taxView].metrics.growthOf1[i].value.toFixed(4))
        row[`${labelOf.get(r.config.id)!}__value`] = r[taxView].result.daily[i].value
      }
      rows.push(row)
    }
    for (let i = 0; i < n; i += step) pushRow(i)
    if ((n - 1) % step !== 0) pushRow(n - 1)
    return rows
  }, [runs, taxView, labelOf])

  // 세로축 폭: 레버리지 전략은 누적 수익률이 수만 %가 되므로 가장 긴 눈금 글자 수에 맞춘다(잘림 방지)
  const yTick = (g: number) => `${g >= 1 ? '+' : ''}${((g - 1) * 100).toFixed(0)}%`
  const yAxisWidth = useMemo(() => {
    let lo = 1
    let hi = 1
    for (const row of chartData)
      for (const r of runs) {
        const v = Number(row[labelOf.get(r.config.id)!])
        if (Number.isFinite(v)) {
          if (v > hi) hi = v
          if (v < lo) lo = v
        }
      }
    const chars = Math.max(yTick(hi).length, yTick(lo).length)
    return Math.min(96, Math.max(48, 10 + chars * 7))
  }, [chartData, runs, labelOf])

  const engineWarnings = useMemo(() => {
    const agg: { name: string; code: string; count: number; first: string }[] = []
    for (const r of runs) {
      const byCode = new Map<string, { count: number; first: string }>()
      for (const w of r.postTax.result.warnings) {
        const e = byCode.get(w.code)
        if (e) e.count++
        else byCode.set(w.code, { count: 1, first: w.message })
      }
      for (const [code, v] of byCode) agg.push({ name: labelOf.get(r.config.id)!, code, count: v.count, first: v.first })
    }
    return agg
  }, [runs, labelOf])

  // 지수/선물 등 "실매매 불가 자산" 가정 경고 (카탈로그 note + ^/=F 패턴)
  const assetCautions = useMemo(() => assetCautionList(runs.flatMap((r) => r.config.sleeves.map((s) => s.ticker))), [runs])

  // 트라이팟 슬리브가 있는 전략 (신호 요약 카드)
  const tripodRuns = useMemo(() => runs.filter((r) => r.postTax.result.tripod), [runs])
  const stateColors = useMemo(() => {
    const p = theme === 'dark' ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT
    return { T3: p[5], B15: p[4], CASH: theme === 'dark' ? '#6b7280' : '#9ca3af' } as Record<TripodState, string>
  }, [theme])

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
            곡선 위에 커서를 올리면 그 시점의 투입 원금·평가액·수익금을 보여줍니다.
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
              width={yAxisWidth}
              domain={['auto', 'auto']}
              tickFormatter={yTick}
            />
            <Tooltip content={<MoneyTooltip colorByName={colorByName} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {runs.flatMap((r) => {
              const eps = r[taxView].result.ruleEpisodes
              if (!eps.length) return []
              const snap = (d: string | null) => {
                if (d == null) return String(chartData[chartData.length - 1].date)
                const row = chartData.find((c) => String(c.date) >= d)
                return String((row ?? chartData[chartData.length - 1]).date)
              }
              return eps.map((ep, k) => (
                <ReferenceArea
                  key={`${r.config.id}-ep${k}`}
                  x1={snap(ep.from)}
                  x2={snap(ep.to)}
                  fill={colorOf.get(r.config.id)}
                  fillOpacity={0.08}
                  strokeOpacity={0}
                />
              ))
            })}
            {runs.map((r) => (
              <Line
                key={r.config.id}
                type="monotone"
                dataKey={labelOf.get(r.config.id)!}
                stroke={colorOf.get(r.config.id)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
            {onAddOverride && (
              <Brush
                dataKey="date"
                height={26}
                travellerWidth={8}
                stroke={axisTickColor}
                fill="transparent"
                tickFormatter={(d: string) => d.slice(0, 7)}
                onChange={(r) => {
                  const si = r?.startIndex ?? 0
                  const ei = r?.endIndex ?? chartData.length - 1
                  setSel(si === 0 && ei === chartData.length - 1 ? null : { s: si, e: ei })
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        {runs.some((r) => r[taxView].result.ruleEpisodes.length > 0) && (
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            색 음영 = 해당 전략의 낙폭 대응 규칙이 발동돼 있던 구간 (적립 배수·현금 목표 변경 적용 중)
          </p>
        )}
        {onAddOverride && (
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            아래 손잡이를 끌어 구간을 고르면 그 기간의 월 적립금을 바꿀 수 있습니다 (고급)
          </p>
        )}
        {onAddOverride && sel && chartData[sel.s] && chartData[sel.e] && (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-zinc-600 dark:text-zinc-300 rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] px-3 py-2">
            <span>
              선택 구간 <b>{String(chartData[sel.s].date).slice(0, 7)} ~ {String(chartData[sel.e].date).slice(0, 7)}</b>의 월 적립을
            </span>
            <NumberInput value={ovAmount} onChange={setOvAmount} className="w-24 bg-white dark:bg-[#171c28] border border-[#d3d8e3] dark:border-[#363a45] rounded-md px-2 py-1 text-right" />
            <span>달러로</span>
            <button
              onClick={() => {
                onAddOverride(String(chartData[sel.s].date).slice(0, 7), String(chartData[sel.e].date).slice(0, 7), ovAmount)
                setSel(null)
              }}
              className="px-2.5 py-1 rounded-md bg-[#2962ff] text-white font-medium hover:bg-[#1e4fd6]"
            >
              기간 조정 추가
            </button>
            <span className="text-zinc-400">추가 후 "백테스트 실행"을 눌러야 반영됩니다</span>
          </div>
        )}
      </div>

      {/* 비교 테이블 (§7 TWRR 정렬) */}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="ledger-table w-full text-xs min-w-[1040px]">
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
                  버텨야 했다는 뜻. "이 전략을 유지하려면 이만큼의 하락을 견딜 수
                  있어야 한다"는 멘탈 시험지입니다.
                  <br />매달 적립하면 계좌 잔액은 계속 커져 하락이 안 보이므로,
                  적립 효과를 제거한 수익률 곡선(TWRR)에서 계산합니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                최장 회복기간(일)
                <HelpTip title="최장 회복기간(일) — 전고점 아래에 머문 최장 기간" align="right">
                  이전 최고 기록(전고점)을 되찾지 못한 채 <b>그 아래에 머문 가장 긴
                  기간(달력일)</b>입니다. 기간 끝까지 회복 못 한 구간도 포함합니다.
                  <br />예: 365일 = 1년 내내 "계좌가 최고점보다 낮은 상태".
                  <br />숫자가 클수록 <b>오래 물려있는 고통</b>이 긴 전략입니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                변동성/년
                <HelpTip title="변동성/년 — 출렁임의 크기 (손실 크기 아님!)" align="right">
                  수익률이 얼마나 <b>출렁이는지</b>를 1년 단위로 환산한
                  값입니다. 손실률이 아니라 <b>흔들림의 폭</b>입니다.
                  <br />감 잡기: 미국 주식 지수 15~20%, 채권 5~10%, 비트코인 60~80%+.
                  <br /><b>100%를 넘을 수도 있나?</b> 네. 하루 ±6% 이상 출렁이는
                  자산은 연환산(×√252)하면 100%를 넘습니다. "1년에 100% 잃는다"는
                  뜻이 아니라 결과의 불확실성이 그만큼 크다는 뜻입니다.
                  <br />연환산 계수는 데이터 해상도를 따릅니다. 일별 √252, 역사
                  월간(-HIST) 자산은 √12. 월간 데이터는 일중 출렁임이 뭉개져 같은
                  자산이라도 일별보다 낮게 나옵니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">최종 가치</th>
              <th className="text-right px-3 py-3 font-medium">
                청산 후 가치
                <HelpTip title="청산 후 가치 — 마지막 날 전부 판다면" align="right">
                  기간 마지막 날 종가에 <b>모든 자산을 판다고 가정</b>했을 때 손에 남는 금액입니다. 매도 비용과, 아직 팔지 않은
                  평가이익에 붙는 양도세(그해 실현손익과 합쳐 연 250만 원 공제 후 22%)를 뺍니다.
                  <br />오래 들고만 있는 전략은 세금이 뒤로 미뤄져 있어 "최종 가치"가 실제보다 좋아 보입니다. 신호 전환으로 자주
                  파는 전략(트라이팟 등)과 <b>세후를 공정하게 비교하려면 이 값</b>을 보세요. 세전 보기에서는 매도 비용만 뺍니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                청산 MWRR/년
                <HelpTip title="청산 기준 MWRR/년" align="right">
                  MWRR(내 돈의 실제 연평균 수익률)을 계산할 때 마지막 금액을 "청산 후 가치"로 바꾼 값입니다. 거치식이면 청산 기준
                  연복리 수익률과 같습니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">총 납입</th>
              <th className="text-right px-3 py-3 font-medium">
                세금
                <HelpTip title="세금 — 기간 중 실제로 낸 세금" align="right">
                  기간 동안 낸 양도세(연말 정산)와 배당 원천징수 합계입니다. 기간 끝까지 팔지 않은 평가이익의 세금은 들어 있지
                  않고, "청산 후 가치"에서 따로 뺍니다.
                </HelpTip>
              </th>
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
                    {labelOf.get(r.config.id)!}
                  </td>
                  <td className="text-right px-3 py-2.5 font-semibold">{fmtPct(m.twrrAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5">{fmtPct(m.mwrrAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5 text-red-500">{fmtPct(m.maxDrawdownPct)}</td>
                  <td className="text-right px-3 py-2.5">{m.maxUnderwaterDays}</td>
                  <td className="text-right px-3 py-2.5">{fmtPct(m.volAnnualPct)}</td>
                  <td className="text-right px-3 py-2.5 font-semibold">{fmtUsd(m.finalValue)}</td>
                  <td className="text-right px-3 py-2.5 font-semibold">{fmtUsd(m.liquidatedValue)}</td>
                  <td className="text-right px-3 py-2.5">{fmtPct(m.liquidatedMwrrAnnualPct)}</td>
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

      {/* 트라이팟 신호 요약 — 전환 횟수·상태별 보유 기간·마지막 판정 */}
      {tripodRuns.length > 0 && (
        <div className={`${cardCls} p-5`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            트라이팟 신호 요약
            <HelpTip title="트라이팟 신호 요약">
              트라이팟 슬리브가 이 기간에 신호를 몇 번 바꿨고, 어떤 상태로 얼마나 오래 있었는지입니다. 신호 전환은 슬리브 전체를
              사고파는 거래라 비용과 양도세가 생깁니다. 보유 기간은 첫 진입 이후 거래일 기준이고, 마지막 판정은 기간 마지막 날
              종가로 정한 상태(다음 거래일에 체결될 상태)입니다.
            </HelpTip>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tripodRuns.map((r) => {
              const t = r[taxView].result.tripod!
              const top = TRIPOD_SLEEVES[t.sleeve.trim().toUpperCase()]?.top ?? 3
              const total = t.daysByState.T3 + t.daysByState.B15 + t.daysByState.CASH
              const n = t.switches.filter((x) => x.from !== null).length
              const lastDate = bundle.dates[bundle.dates.length - 1]
              const first = t.switches[0]?.date
              const yrs = first ? (Date.parse(lastDate) - Date.parse(first)) / (365.25 * 86_400_000) : 0
              const name: Record<TripodState, string> = { T3: top === 3 ? '3배 TQQQ' : '2배 QLD', B15: '1.5배 QQQ+QLD', CASH: '현금' }
              const share = (k: TripodState) => (total > 0 ? (t.daysByState[k] / total) * 100 : 0)
              return (
                <div key={r.config.id} className="border border-[#dfe3ec] dark:border-[#2a2e39] rounded p-3 space-y-2 text-xs">
                  <div className="text-zinc-500 dark:text-zinc-400">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                    {labelOf.get(r.config.id)!}
                  </div>
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    신호 전환 {n}회{' '}
                    <span className="text-xs font-normal text-gray-400">(연 {yrs > 0 ? (n / yrs).toFixed(1) : '—'}회)</span>
                  </div>
                  <div className="flex h-2 rounded overflow-hidden bg-[#eef1f5] dark:bg-[#2a2e39]" aria-hidden="true">
                    {(['T3', 'B15', 'CASH'] as const).map((k) => (
                      <div key={k} style={{ width: `${share(k)}%`, backgroundColor: stateColors[k] }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    {(['T3', 'B15', 'CASH'] as const).map((k) => (
                      <span key={k} className="whitespace-nowrap">
                        <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ backgroundColor: stateColors[k] }} />
                        {name[k]} {share(k).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-gray-400 leading-relaxed">
                    체결 {executionTiming(r.config) === 'next_close' ? '다음 거래일 종가' : '다음 거래일 시가'} · 마지막 판정{' '}
                    <span className="whitespace-nowrap">({lastDate} 종가)</span> {t.lastTarget ? name[t.lastTarget] : '판정 없음'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 세금 드래그 요약 (5.5 — 이 툴의 핵심 가치) */}
      {taxEnabled && (
        <div className={`${cardCls} p-5`}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            세금 드래그 (세전 − 세후)
            <HelpTip title="세금 드래그 — 세금이 깎아먹는 연 수익률">
              <b>같은 전략을 세금 없이 돌렸을 때</b>와 실제 세금(양도세 + 배당
              원천징수 15%)을 내면서 돌렸을 때의 연 수익률 차이입니다. 기간 끝까지 팔지 않은 평가이익의 세금은 이 차이에
              들어 있지 않아, 그 몫은 카드 아래 줄(기간 끝에 모두 팔면)에 따로 보여 줍니다.
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
                    {labelOf.get(r.config.id)!}
                  </div>
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">−{drag.toFixed(2)}%p/년</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    양도세 {fmtUsd(res.totalTaxesUsd)} + 배당 원천 {fmtUsd(res.dividendsWithheldUsd)} — 실현익 과세와 원천징수가 만드는 복리 드래그
                  </div>
                  {res.liquidation && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      기간 끝에 모두 팔면 추가 양도세 {fmtUsd(res.liquidation.taxUsd)} → 청산 기준 MWRR{' '}
                      <span className="whitespace-nowrap">
                        {fmtPct(r.postTax.metrics.liquidatedMwrrAnnualPct)} (세전 {fmtPct(r.preTax.metrics.liquidatedMwrrAnnualPct)})
                      </span>
                    </div>
                  )}
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
                  {labelOf.get(r.config.id)!}
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
