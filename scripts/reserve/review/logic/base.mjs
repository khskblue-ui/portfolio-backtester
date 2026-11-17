import { sim, QQQ, A_QQQ, A_GOLD, A_BTC } from './orig.mjs'
const pct = (x) => (x * 100).toFixed(1) + '%'
export const SCEN = [
  { id: 's2014', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 } },
  { id: 's2004', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.5, gold: 0.1, cash: 0.4 } },
  { id: 's1999', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.6, cash: 0.4 } },
]
for (const s of SCEN) s.dates = [...QQQ.keys()].sort().filter((d) => d >= s.start && s.assets.every((a) => a.px.has(d)))
if (import.meta.url === `file://${process.argv[1]}`) for (const s of SCEN) {
  const r = sim(s.dates, s.assets, s.base, {}), h = sim(s.dates, s.assets, s.base, { rule: false })
  console.log(`\n== ${s.id} plan ${pct(r.cagr)} / ${pct(r.mdd)}  hold ${pct(h.cagr)} / ${pct(h.mdd)} stepDay ${r.stepDay} firstBuy ${r.firstBuy} avgCash ${pct(r.avgCash)} final`, Object.entries(r.final.w).map(([k, v]) => k + ' ' + pct(v)).join(' '))
  for (const e of r.events) console.log(e.d, e.type, e.key ?? (e.first ? 'first' : ''), 'pct', pct(e.pct), 'cash', pct(e.from ?? e.cashFrom), '->', pct(e.to ?? e.cashTo), e.qdd != null ? 'qdd ' + pct(e.qdd) : '', e.parts ? JSON.stringify(Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, +(v * 100).toFixed(1)]))) : e.type === 'trim' ? 'from ' + pct(e.from) : '')
  // 처음 사기 전 현금 범위
  const pre = r.series.filter((p) => !r.stepDay || p.d <= r.stepDay)
  console.log('pre-step cash min/max', pct(Math.min(...pre.map((p) => p.w.cash))), pct(Math.max(...pre.map((p) => p.w.cash))), 'days', pre.length)
}
