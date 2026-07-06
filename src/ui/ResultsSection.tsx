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
import { cardCls, fmtUsd, fmtPct } from './common'

/**
 * 결과 섹션 (§7) — TWRR 기준 정렬 비교표 + growth-of-$1 오버레이 +
 * 세금 드래그(5.5 핵심 가치) + 연도별 서브기간(6.4)
 */
export function ResultsSection({
  runs,
  bundle,
  palette,
  taxEnabled,
}: {
  runs: StrategyRun[]
  bundle: AlignedDataBundle
  palette: string[]
  taxEnabled: boolean
}) {
  const [taxView, setTaxView] = useState<'postTax' | 'preTax'>('postTax')

  // 전략별 고정 색 (등수 아닌 엔티티 기준 — 정렬돼도 색 유지)
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(r.config.id, palette[i % palette.length]))
    return m
  }, [runs, palette])

  // §7: TWRR 기준 정렬
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b[taxView].metrics.twrrAnnualPct - a[taxView].metrics.twrrAnnualPct),
    [runs, taxView]
  )

  // growth-of-$1 오버레이 데이터 (다운샘플 ~500 포인트)
  const chartData = useMemo(() => {
    const n = runs[0][taxView].metrics.growthOf1.length
    const step = Math.max(1, Math.ceil(n / 500))
    const rows: Record<string, string | number>[] = []
    const pushRow = (i: number) => {
      const row: Record<string, string | number> = { date: runs[0][taxView].metrics.growthOf1[i].date }
      for (const r of runs) row[r.config.name] = Number(r[taxView].metrics.growthOf1[i].value.toFixed(4))
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          결과{' '}
          <span className="text-xs font-normal text-gray-400">
            {bundle.dates[0]} ~ {bundle.dates[bundle.dates.length - 1]} · {bundle.dates.length}거래일 · 스냅샷 {bundle.snapshotHash}
          </span>
        </h2>
        {taxEnabled && (
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-medium">
            {(
              [
                { key: 'postTax', label: '세후' },
                { key: 'preTax', label: '세전' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTaxView(key)}
                className={`px-3 py-1.5 ${taxView === key ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 데이터·엔진 경고 */}
      {(bundle.clipWarnings.length > 0 || engineWarnings.length > 0 || assetCautions.length > 0) && (
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
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

      {/* growth-of-$1 오버레이 (6.2: 낙폭·비교는 TWRR 기준) */}
      <div className={`${cardCls} p-5`}>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          $1 성장 곡선 (TWRR 기준{taxEnabled ? (taxView === 'postTax' ? ' · 세후' : ' · 세전') : ''})
        </h3>
        <p className="text-xs text-gray-400 mb-3">납입 타이밍 효과를 제거한 전략 자체 성과 — 공정 비교 잣대</p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={60} tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis tick={{ fontSize: 11 }} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => `${v}x`} />
            <Tooltip
              formatter={(v) => `${Number(v ?? 0).toFixed(3)}x`}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
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
        <table className="w-full text-xs min-w-[880px]">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
              <th className="text-left px-4 py-3 font-medium">전략</th>
              <th className="text-right px-3 py-3 font-medium">
                TWRR/년
                <HelpTip title="TWRR (시간가중수익률)" align="right">
                  납입 타이밍의 운(運)을 제거한 <b>전략 자체</b>의 연환산 성과.
                  적립 시점과 무관하므로 전략끼리 공정하게 비교하는 잣대입니다. 표는 이 값으로 정렬됩니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                MWRR/년
                <HelpTip title="MWRR (금액가중수익률·IRR)" align="right">
                  납입 타이밍까지 반영한 <b>내 돈의 실제 경험</b> 수익률.
                  상승 직전에 많이 넣었으면 TWRR보다 높고, 반대면 낮습니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                MDD
                <HelpTip title="MDD (최대 낙폭)" align="right">
                  고점 대비 최대 하락률. 적립이 포트 가치를 부풀려 낙폭을 가리는 것을 막기 위해
                  포트 가치가 아닌 <b>$1 성장 곡선(TWRR)</b> 기준으로 계산합니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                수면하(일)
                <HelpTip title="수면하 기간" align="right">
                  전고점을 깨고 내려가 회복하기까지 걸린 <b>최장 거래일 수</b>.
                  "얼마나 오래 물려있었나"의 지표입니다.
                </HelpTip>
              </th>
              <th className="text-right px-3 py-3 font-medium">
                변동성/년
                <HelpTip title="연환산 변동성" align="right">
                  일간 수익률 표준편차 × √252. 곡선이 얼마나 출렁였는지 — 낮을수록 순한 전략.
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
                <tr key={r.config.id} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-700 dark:text-gray-200">
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
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">세금 드래그 (세전 − 세후)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map((r) => {
              const drag = r.preTax.metrics.twrrAnnualPct - r.postTax.metrics.twrrAnnualPct
              const res = r.postTax.result
              return (
                <div key={r.config.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                    {r.config.name}
                  </div>
                  <div className="text-sm font-bold text-gray-800 dark:text-gray-100">−{drag.toFixed(2)}%p/년</div>
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
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            연도별 TWRR <span className="text-xs font-normal text-gray-400">— 한 경로 안의 서브기간 견고성 확인</span>
          </h3>
        </div>
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
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
              <tr key={y} className="border-b border-gray-50 dark:border-gray-700/50 text-gray-700 dark:text-gray-200">
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
