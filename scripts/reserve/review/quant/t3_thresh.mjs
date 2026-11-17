import { SCEN, simG, pct } from './lib.mjs'
const f = (r) => `${pct(r.cagr).trim()}/${pct(r.mdd, 0).trim()}/Sh${r.sharpe.toFixed(2)}/b${r.buys.length}s${r.sells.length}${r.buys[0] ? '/' + r.buys[0].d.slice(0, 7) : ''}`
const sweep = (name, key, vals, extra = () => ({})) => {
  console.log(`\n-- ${name}`)
  for (const s of SCEN) console.log(s.id, vals.map((v) => `${v}: ${f(simG(s.dates, s.assets, s.base, { [key]: v, ...extra(v) }))}`).join(' | '))
}
sweep('첫 투입 낙폭 firstDd', 'firstDd', [-0.1, -0.15, -0.18, -0.2, -0.22, -0.23, -0.25, -0.3, -0.35])
sweep('현금 상한 upper', 'upper', [0.33, 0.35, 0.37, 0.4, 0.43, 0.45, 0.5])
sweep('현금 하한 lower', 'lower', [0.1, 0.15, 0.18, 0.2, 0.22, 0.25])
sweep('기준 target(=lowerTo), 상한 +10 하한 -10', 'target', [0.1, 0.2, 0.25, 0.3, 0.35, 0.4], (v) => ({ lowerTo: v, upper: v + 0.1, lower: v - 0.1, useLower: v > 0.1 }))
sweep('금·암호화폐 상한 trimAt (10으로)', 'trimAt', [0.13, 0.15, 0.18, 0.2, 0.22, 0.25, 0.3, 0.4])
sweep('줄인 뒤 비중 trimTo (상한 20)', 'trimTo', [0.05, 0.1, 0.15])
// 격자 전체 분포
console.log('\n-- 격자 전체(firstDd × upper × lower × trimAt) 분포')
for (const s of SCEN) {
  const out = []
  for (const firstDd of [-0.15, -0.2, -0.25, -0.3]) for (const upper of [0.35, 0.4, 0.45]) for (const lower of [0.15, 0.2, 0.25]) for (const trimAt of [0.15, 0.2, 0.25]) out.push(simG(s.dates, s.assets, s.base, { firstDd, upper, lower, trimAt }))
  const q = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))]
  const c = out.map((r) => r.cagr), m = out.map((r) => r.mdd), sh = out.map((r) => r.sharpe)
  const base = simG(s.dates, s.assets, s.base, {}), hold = simG(s.dates, s.assets, s.base, { mode: 'hold' })
  console.log(s.id, `n=${out.length} CAGR min ${pct(q(c, 0))} p25 ${pct(q(c, 0.25))} med ${pct(q(c, 0.5))} p75 ${pct(q(c, 0.75))} max ${pct(q(c, 1))} | 선택한 값 ${pct(base.cagr)} (순위 ${c.filter((x) => x > base.cagr).length + 1}/${c.length}) | Sharpe ${q(sh, 0).toFixed(2)}~${q(sh, 1).toFixed(2)} 선택 ${base.sharpe.toFixed(2)} | MDD ${pct(q(m, 0))}~${pct(q(m, 1))} | hold보다 CAGR 높은 조합 ${c.filter((x) => x > hold.cagr).length}/${c.length}`)
}
