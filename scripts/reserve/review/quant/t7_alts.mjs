import { SCEN, simG, pct } from './lib.mjs'
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
const TAX = 0.22
const alts = (s) => [
  ['P  규칙대로(현금 40 시작)', s.base, {}],
  ['A1 1번 없이 바로 30, 2~6번 그대로', s.tgt, { stepped0: true }],
  ['A2 1번에 기한 1년(−20% 또는 1년 뒤)', s.base, { firstBy: 365 }],
  ['A3 연 1회 기준 비중 복원(1월)+6번 상한', s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y', month: 1, capInFixed: true }],
  ['A3b 연 1회 복원(7월)+6번 상한', s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y', month: 7, capInFixed: true }],
  ['A4 현금 20/40 또는 금·코인 20 → 전체 복원', s.tgt, { mode: 'band', weights: s.tgt, band: 0.1, bandOn: 'cash+cap' }],
  ['A5 띠 25/35(2~6번, 바로 30)', s.tgt, { stepped0: true, upper: 0.35, lower: 0.25 }],
  ['A6 하한 없음(바로 30, 2·4·5·6번)', s.tgt, { stepped0: true, useLower: false }],
  ['A7 하한에서 넘치는 자산 비례 매도(바로 30)', s.tgt, { stepped0: true, sellAll: true }],
  ['H  그냥 둠(보고서 기준)', s.base, { mode: 'hold' }],
]
console.log('세 구간: CAGR / MDD / Sharpe / 연 회전율(자산 대비) / 과세 매도 횟수 || 세금 22%: 연수익률(기간 끝 전량 매도 가정) ')
for (const s of SCEN) {
  console.log(`\n${s.id}`)
  for (const [l, base, o] of alts(s)) {
    const r = simG(s.dates, s.assets, base, o), t = simG(s.dates, s.assets, base, { ...o, tax: TAX })
    console.log(`  ${l.padEnd(36)} ${pct(r.cagr)} ${pct(r.mdd)} Sh ${r.sharpe.toFixed(2)} vol ${pct(r.vol)} 회전 ${pct(r.turnRel)} 매도 ${String(r.taxSales).padStart(3)} 평균현금 ${pct(r.avgCash, 0)} || 세후(실현분만) ${pct(t.cagr)} 세후(전량 매도) ${pct(t.cagrLiq)} 미실현차익 ${pct(t.embFrac, 0)}`)
  }
}
// 시작일 분포: 대안 − 규칙
console.log('\n시작일을 달마다 바꿔(끝 2026-10, 5년 이상) 대안 − 규칙대로의 차이. 최고가는 역대 최고.')
for (const s of SCEN) {
  const all = s.dates, starts = all.filter((d, i) => (i === 0 || d.slice(0, 7) !== all[i - 1].slice(0, 7)) && d <= '2021-10-31')
  const res = starts.map((st) => { const dates = all.filter((d) => d >= st); return alts(s).map(([l, base, o]) => simG(dates, s.assets, base, { ...o, peak: 'ath' })) })
  console.log(`\n${s.id} 시작일 ${starts.length}개`)
  alts(s).forEach(([l], j) => {
    if (j === 0) return
    const dc = res.map((r) => r[j].cagr - r[0].cagr), ds = res.map((r) => r[j].sharpe - r[0].sharpe), dm = res.map((r) => r[j].mdd - r[0].mdd)
    console.log(`  ${l.padEnd(36)} CAGR차 med ${pct(q(dc, 0.5))} [p10 ${pct(q(dc, 0.1))}, p90 ${pct(q(dc, 0.9))}] | Sharpe차 med ${q(ds, 0.5).toFixed(2).padStart(5)} (대안 우위 ${pct(ds.filter((x) => x > 0).length / ds.length, 0)}) | MDD차 med ${pct(q(dm, 0.5))} (대안이 얕음 ${pct(dm.filter((x) => x > 0).length / dm.length, 0)})`)
  })
}
