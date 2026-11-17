import { SCEN, simG, pct, row } from './lib.mjs'
for (const s of SCEN) {
  const run = (o, base = s.base) => simG(s.dates, s.assets, base, o)
  const plan = run({})
  console.log(`\n=== ${s.id} ${s.dates[0]} ~ ${s.dates.at(-1)} (${plan.yrs.toFixed(1)}y) cash CAGR ${pct(plan.cashCagr)}`)
  const ev = (r) => `buy ${r.buys.length} sell ${r.sells.length} trim ${r.trims.length} reb ${r.rebals.length} turn ${(r.turnover / 100).toFixed(1)}`
  const scaleCash = (c) => { const k = (1 - c) / (1 - s.tgt.cash); return { ...Object.fromEntries(s.assets.map((a) => [a.key, s.tgt[a.key] * k])), cash: c } }
  const list = [
    ['규칙대로 (보고서)', plan],
    ['그냥 둔 경우 (보고서: 상한만 적용)', run({ mode: 'hold' })],
    ['진짜 방치 (상한도 없음)', run({ mode: 'hold', trim: false })],
    ['기준 비중 고정, 연 1회', run({ mode: 'fixed', weights: s.tgt, freq: 'Y' }, s.tgt)],
    ['기준 비중 고정, 분기', run({ mode: 'fixed', weights: s.tgt, freq: 'Q' }, s.tgt)],
    ['기준 비중 고정, 매달', run({ mode: 'fixed', weights: s.tgt, freq: 'M' }, s.tgt)],
    ['시작 비중(현금 40) 고정, 연 1회', run({ mode: 'fixed', weights: s.base, freq: 'Y' })],
    [`평균 현금 ${pct(plan.avgCash, 0).trim()} 고정, 연 1회`, run({ mode: 'fixed', weights: scaleCash(plan.avgCash), freq: 'Y' }, scaleCash(plan.avgCash))],
    ['기준 비중, 띠 ±5%p(어느 자산이든)', run({ mode: 'band', weights: s.tgt, band: 0.05 }, s.tgt)],
    ['기준 비중, 띠 ±10%p(어느 자산이든)', run({ mode: 'band', weights: s.tgt, band: 0.10 }, s.tgt)],
    ['기준 비중, 현금 띠 ±10%p 전체 리밸런싱', run({ mode: 'band', weights: s.tgt, band: 0.10, bandOn: 'cash' }, s.tgt)],
    ['규칙 2~6만, 현금 30으로 바로 시작', run({ stepped0: true }, s.tgt)],
    ['규칙대로, 하한 없음', run({ useLower: false })],
  ]
  if (s.id !== 's1999') list.push(['QQQ 70 / 현금 30, 연 1회', simG(s.dates, [s.assets[0]], { qqq: 0.7, cash: 0.3 }, { mode: 'fixed', weights: { qqq: 0.7, cash: 0.3 }, freq: 'Y' })])
  for (const [l, r] of list) console.log(row(l, r, ev(r)))
}
