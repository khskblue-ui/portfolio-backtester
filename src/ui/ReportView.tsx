import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { Printer, X } from 'lucide-react'
import type { StrategyRun, AlignedDataBundle, StrategyConfig } from '@/core'
import { assetCautionFor } from '@/core'
import { SERIES_COLORS_LIGHT, fmtUsd, fmtSignedUsd, fmtPct, type SharedSettings } from './common'

/**
 * 백테스트 결과 보고서 — 브라우저 인쇄(⌘/Ctrl+P → PDF 저장)로 생성.
 * 화면에선 오버레이로 미리보기, 인쇄 시엔 보고서만 출력(@media print — index.css).
 * 보고서는 항상 라이트 스타일 (인쇄 표준).
 */
export function ReportView({
  runs,
  bundle,
  shared,
  onClose,
}: {
  runs: StrategyRun[]
  bundle: AlignedDataBundle
  shared: SharedSettings
  onClose: () => void
}) {
  const sorted = useMemo(
    () => [...runs].sort((a, b) => b.postTax.metrics.twrrAnnualPct - a.postTax.metrics.twrrAnnualPct),
    [runs]
  )
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    runs.forEach((r, i) => m.set(r.config.id, SERIES_COLORS_LIGHT[i % SERIES_COLORS_LIGHT.length]))
    return m
  }, [runs])

  const chartData = useMemo(() => {
    const n = runs[0].postTax.metrics.growthOf1.length
    const step = Math.max(1, Math.ceil(n / 400))
    const rows: Record<string, string | number>[] = []
    for (let i = 0; i < n; i += step) {
      const row: Record<string, string | number> = { date: runs[0].postTax.metrics.growthOf1[i].date }
      for (const r of runs) row[r.config.name] = Number(r.postTax.metrics.growthOf1[i].value.toFixed(4))
      rows.push(row)
    }
    return rows
  }, [runs])

  const period = `${bundle.dates[0]} ~ ${bundle.dates[bundle.dates.length - 1]}`
  const generatedAt = new Date().toISOString().slice(0, 10)

  const thCls = 'text-left px-2 py-1.5 font-semibold text-gray-500 border-b border-gray-300'
  const tdCls = 'px-2 py-1.5 border-b border-gray-100'

  return (
    <div className="print-report fixed inset-0 z-50 bg-white text-gray-900 overflow-y-auto">
      {/* 화면 전용 툴바 */}
      <div className="no-print sticky top-0 bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          보고서 미리보기 — "인쇄 / PDF 저장"을 누르고 대상에서 <b>PDF로 저장</b>을 선택하세요
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
          >
            <Printer className="w-4 h-4" /> 인쇄 / PDF 저장
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-100"
          >
            <X className="w-4 h-4" /> 닫기
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8 text-[13px] leading-relaxed">
        {/* 표지 헤더 */}
        <h1 className="text-2xl font-bold mb-1">포트폴리오 백테스트 보고서</h1>
        <p className="text-gray-500 mb-4">
          기간 {period} · {bundle.dates.length}거래일 · 데이터 스냅샷 {bundle.snapshotHash} · 생성일 {generatedAt}
        </p>

        {/* 공통 가정 */}
        <div className="border border-gray-200 rounded-xl p-4 mb-4">
          <h2 className="font-bold mb-2">공통 가정 (모든 전략 동일 적용)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-gray-700">
            <span>초기 투자금 {fmtUsd(shared.initialUsd)}</span>
            <span>월 적립 {fmtUsd(shared.monthlyUsd)}</span>
            <span>수수료 {shared.feeBps}bps</span>
            <span>슬리피지 {shared.spreadBps}bps</span>
            <span>유휴현금 금리 {shared.cashYieldPct}%/년</span>
            <span>가정 환율 ₩{shared.assumedUsdKrw.toLocaleString()}/$</span>
            <span>한국 세금 {shared.taxEnabled ? '반영' : '미반영'}</span>
            <span>분수주 {shared.fractionalShares ? '허용' : '불가(정수주)'}</span>
          </div>
        </div>

        {/* 에피스테믹 고지 (§11 — 보고서에도 필수) */}
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 mb-6 text-amber-900">
          <b>이 보고서는 예측이 아닙니다.</b> 과거 한 번의 경로에 대한 시뮬레이션이며, 모든 금액은
          USD로 원화 실현손익과 다릅니다(환율 미반영). 세금은 가정 환율·단일 한계세율 기반 근사입니다.
          파라미터를 결과가 좋아질 때까지 튜닝하면 그 결과는 의미를 잃습니다.
        </div>

        {/* 비교 요약 */}
        <h2 className="text-lg font-bold mb-2">전략 비교 요약 {shared.taxEnabled && '(세후)'}</h2>
        <table className="w-full mb-6 text-xs">
          <thead>
            <tr>
              <th className={thCls}>전략</th>
              <th className={`${thCls} text-right`}>TWRR/년</th>
              <th className={`${thCls} text-right`}>MWRR/년</th>
              <th className={`${thCls} text-right`}>MDD</th>
              <th className={`${thCls} text-right`}>수면하(일)</th>
              <th className={`${thCls} text-right`}>변동성/년</th>
              <th className={`${thCls} text-right`}>최종 가치</th>
              <th className={`${thCls} text-right`}>총 수익금</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const m = r.postTax.metrics
              return (
                <tr key={r.config.id}>
                  <td className={`${tdCls} font-medium`}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf.get(r.config.id) }} />
                    {r.config.name}
                  </td>
                  <td className={`${tdCls} text-right font-semibold`}>{fmtPct(m.twrrAnnualPct)}</td>
                  <td className={`${tdCls} text-right`}>{fmtPct(m.mwrrAnnualPct)}</td>
                  <td className={`${tdCls} text-right`}>{fmtPct(m.maxDrawdownPct)}</td>
                  <td className={`${tdCls} text-right`}>{m.maxUnderwaterDays}</td>
                  <td className={`${tdCls} text-right`}>{fmtPct(m.volAnnualPct)}</td>
                  <td className={`${tdCls} text-right font-semibold`}>{fmtUsd(m.finalValue)}</td>
                  <td className={`${tdCls} text-right`}>{fmtSignedUsd(m.finalValue - m.totalContributions)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 누적 수익률 차트 (라이트 고정) */}
        <h2 className="text-lg font-bold mb-2">누적 수익률 (TWRR{shared.taxEnabled ? ' · 세후' : ''})</h2>
        <div className="mb-6 overflow-hidden">
          <LineChart data={chartData} width={860} height={300} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} stroke="#6b7280" minTickGap={60} tickFormatter={(d: string) => d.slice(0, 7)} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} stroke="#6b7280" width={48} domain={['auto', 'auto']} tickFormatter={(g: number) => `${g >= 1 ? '+' : ''}${((g - 1) * 100).toFixed(0)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {runs.map((r) => (
              <Line key={r.config.id} type="monotone" dataKey={r.config.name} stroke={colorOf.get(r.config.id)} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </div>

        {/* 데이터·자산 주의 */}
        {(bundle.clipWarnings.length > 0 || runs.some((r) => r.config.sleeves.some((s) => assetCautionFor(s.ticker)))) && (
          <div className="border border-gray-200 rounded-xl p-3 mb-6 text-xs text-gray-600 space-y-0.5">
            {bundle.clipWarnings.map((w, i) => (
              <p key={i}>⚠ {w}</p>
            ))}
            {[...new Set(runs.flatMap((r) => r.config.sleeves.map((s) => s.ticker)))]
              .map((t) => ({ t, c: assetCautionFor(t) }))
              .filter((x) => x.c)
              .map((x) => (
                <p key={x.t}>⚠ [{x.t}] {x.c}</p>
              ))}
          </div>
        )}

        {/* 전략별 상세 */}
        {sorted.map((r) => (
          <StrategyDetail key={r.config.id} run={r} color={colorOf.get(r.config.id)!} taxEnabled={shared.taxEnabled} />
        ))}

        <p className="text-xs text-gray-400 mt-8">
          데이터: Yahoo Finance / Stooq (일별 EOD) · 엔진 규약: t 종가 결정 → t+1 시가 체결, 이동평균 원가,
          양도세 연 손익통산(250만 공제·22%), 배당 원천 15% · 이 문서는 투자 권유가 아닙니다.
        </p>
      </div>
    </div>
  )
}

function StrategyDetail({ run, color, taxEnabled }: { run: StrategyRun; color: string; taxEnabled: boolean }) {
  const cfg: StrategyConfig = run.config
  const post = run.postTax
  const pre = run.preTax
  const drag = pre.metrics.twrrAnnualPct - post.metrics.twrrAnnualPct

  const triggerLabel = { none: '없음', periodic: '주기', bands: '밴드', band_or_periodic: '밴드 + 주기' }[cfg.rebalance.trigger]
  const modeLabel = {
    sell_to_target: '매도 허용',
    no_sell: '무매도',
    no_sell_except_periodic: '무매도 + 주기 매도만',
  }[cfg.rebalance.mode]
  const allocLabel = { to_underweight: '미달 슬리브 우선', pro_rata: '목표비중 비례', fixed_split: '고정 분할' }[cfg.contribution.allocation]

  const rows: { label: string; post: string; pre: string }[] = [
    { label: 'TWRR/년 (전략 자체)', post: fmtPct(post.metrics.twrrAnnualPct), pre: fmtPct(pre.metrics.twrrAnnualPct) },
    { label: 'MWRR/년 (실제 경험)', post: fmtPct(post.metrics.mwrrAnnualPct), pre: fmtPct(pre.metrics.mwrrAnnualPct) },
    { label: 'MDD (최대 낙폭)', post: fmtPct(post.metrics.maxDrawdownPct), pre: fmtPct(pre.metrics.maxDrawdownPct) },
    { label: '수면하 (최장 거래일)', post: String(post.metrics.maxUnderwaterDays), pre: String(pre.metrics.maxUnderwaterDays) },
    { label: '변동성/년', post: fmtPct(post.metrics.volAnnualPct), pre: fmtPct(pre.metrics.volAnnualPct) },
    { label: '최종 가치', post: fmtUsd(post.metrics.finalValue), pre: fmtUsd(pre.metrics.finalValue) },
    { label: '총 납입', post: fmtUsd(post.metrics.totalContributions), pre: fmtUsd(pre.metrics.totalContributions) },
    { label: '총 수익금', post: fmtSignedUsd(post.metrics.finalValue - post.metrics.totalContributions), pre: fmtSignedUsd(pre.metrics.finalValue - pre.metrics.totalContributions) },
    { label: '배당 (총 / 원천징수)', post: `${fmtUsd(post.result.dividendsGrossUsd)} / ${fmtUsd(post.result.dividendsWithheldUsd)}`, pre: `${fmtUsd(pre.result.dividendsGrossUsd)} / $0` },
    { label: '세금 (양도세 + 원천)', post: fmtUsd(post.result.totalTaxesUsd + post.result.dividendsWithheldUsd), pre: '$0' },
    { label: '거래 비용', post: fmtUsd(post.result.totalFeesUsd), pre: fmtUsd(pre.result.totalFeesUsd) },
    { label: '거래 횟수', post: String(post.result.trades.length), pre: String(pre.result.trades.length) },
  ]

  const thCls = 'text-left px-2 py-1 font-semibold text-gray-500 border-b border-gray-300'
  const tdCls = 'px-2 py-1 border-b border-gray-100'

  return (
    <div className="page-break border-t border-gray-300 pt-5 mt-6">
      <h2 className="text-lg font-bold mb-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: color }} />
        {cfg.name}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-gray-600 mb-1">자산 구성</h3>
          <table className="w-full text-xs">
            <tbody>
              {cfg.sleeves.map((s, i) => (
                <tr key={i}>
                  <td className={`${tdCls} font-mono`}>{s.ticker}</td>
                  <td className={`${tdCls} text-right`}>{(s.targetWeight * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="font-semibold text-gray-600 mb-1">규칙</h3>
          <table className="w-full text-xs">
            <tbody>
              <tr><td className={tdCls}>적립 배분</td><td className={`${tdCls} text-right`}>{allocLabel}</td></tr>
              <tr><td className={tdCls}>리밸런싱 트리거</td><td className={`${tdCls} text-right`}>{triggerLabel}</td></tr>
              <tr><td className={tdCls}>매도 정책</td><td className={`${tdCls} text-right`}>{modeLabel}</td></tr>
              {cfg.rebalance.periodMonths != null && (
                <tr><td className={tdCls}>주기</td><td className={`${tdCls} text-right`}>{cfg.rebalance.periodMonths}개월</td></tr>
              )}
              {cfg.rebalance.bandAbsPct != null && (
                <tr><td className={tdCls}>밴드 폭</td><td className={`${tdCls} text-right`}>{cfg.rebalance.bandAbsPct}%p</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h3 className="font-semibold text-gray-600 mb-1">핵심 지표 {taxEnabled && <span className="font-normal text-gray-400">— 세후 vs 세전 (세금 드래그 −{drag.toFixed(2)}%p/년)</span>}</h3>
      <table className="w-full text-xs mb-4">
        <thead>
          <tr>
            <th className={thCls}>지표</th>
            <th className={`${thCls} text-right`}>{taxEnabled ? '세후' : '결과'}</th>
            {taxEnabled && <th className={`${thCls} text-right`}>세전</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={tdCls}>{row.label}</td>
              <td className={`${tdCls} text-right font-medium`}>{row.post}</td>
              {taxEnabled && <td className={`${tdCls} text-right text-gray-500`}>{row.pre}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="font-semibold text-gray-600 mb-1">연도별 수익률 (TWRR{taxEnabled ? ' · 세후' : ''})</h3>
      <table className="w-full text-xs mb-3">
        <tbody>
          <tr>
            {post.metrics.annualReturns.map((a) => (
              <td key={a.year} className={`${tdCls} text-center`}>
                <div className="text-gray-400">{a.year}</div>
                <div className={`font-medium ${a.returnPct < 0 ? 'text-red-600' : ''}`}>{fmtPct(a.returnPct)}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {post.result.warnings.length > 0 && (
        <p className="text-xs text-gray-500">
          ⚠ 엔진 경고 {post.result.warnings.length}건 — 첫 건: {post.result.warnings[0].message}
        </p>
      )}
    </div>
  )
}
