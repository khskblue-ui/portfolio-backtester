import { SCEN, simG, pct, QQQ, ALLQ } from './lib.mjs'
const fwd = (d, y) => { const t = `${+d.slice(0, 4) + y}${d.slice(4)}`; const j = ALLQ.findIndex((x) => x >= t); return j > 0 ? QQQ.get(ALLQ[j]) / QQQ.get(d) - 1 : null }
for (const s of SCEN) {
  const r = simG(s.dates, s.assets, s.base, {})
  console.log(s.id)
  for (const e of r.sells) { const later = ALLQ.filter((d) => d > e.d); const minLater = Math.min(...later.map((d) => QQQ.get(d))); const nextBuy = r.buys.find((b) => b.d > e.d)
    console.log(`  판 날 ${e.d}: QQQ 1년 뒤 ${pct(fwd(e.d, 1))} 3년 뒤 ${pct(fwd(e.d, 3))} | 그 뒤 최저가 ${pct(minLater / QQQ.get(e.d) - 1)} | 다음 매수 ${nextBuy ? `${nextBuy.d} (판 값 대비 ${pct(QQQ.get(nextBuy.d) / QQQ.get(e.d) - 1).trim()})` : '없음'} | 자료 끝까지 ${pct(QQQ.get(ALLQ.at(-1)) / QQQ.get(e.d) - 1)}`) }
  for (const e of r.buys) console.log(`  산 날 ${e.d}${e.first ? '(1번)' : '(2번)'} ${pct(e.pct, 0).trim()}: QQQ 1년 뒤 ${pct(fwd(e.d, 1))} 3년 뒤 ${pct(fwd(e.d, 3))} | 그 뒤 최저가 ${pct(Math.min(...ALLQ.filter((d) => d > e.d).map((d) => QQQ.get(d))) / QQQ.get(e.d) - 1)}`)
}
// 마지막 rule-2 매수 이후 경과
const s = SCEN[2], r = simG(s.dates, s.assets, s.base, {})
console.log('s1999 마지막 2번 규칙 매수:', r.buys.at(-1).d, '→ 그 뒤', ((Date.parse(s.dates.at(-1)) - Date.parse(r.buys.at(-1).d)) / 864e5 / 365.25).toFixed(1), '년 동안 매수 0번, 매도', r.sells.filter((e) => e.d > r.buys.at(-1).d).length, '번')
// 2009년 이후 현금 비중 최고
for (const sc of SCEN) { const rr = simG(sc.dates, sc.assets, sc.base, {}); const after = rr.series.filter((x) => x.d >= '2010-01-01' && (!rr.buys[0] || x.d > rr.buys[0].d)); const mx = after.reduce((m, x) => (x.w.cash > m.w.cash ? x : m)); console.log(`${sc.id} 2010년 이후(첫 매수 뒤) 현금 비중 최고 ${pct(mx.w.cash)} (${mx.d}), 2020-03 최고 ${pct(Math.max(...rr.series.filter((x) => x.d >= '2020-02-01' && x.d <= '2020-04-30').map((x) => x.w.cash)))}, 2022 최고 ${pct(Math.max(...rr.series.filter((x) => x.d >= '2022-01-01' && x.d <= '2022-12-31').map((x) => x.w.cash)))}`) }
