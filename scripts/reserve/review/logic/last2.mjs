import { sim2, pct, allDates, scenFor } from './sim2.mjs'
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '2014-09-17' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
for (const [n, o] of [['V0', {}], ['2번은 QQQ -10% 이하일 때만', { upperNeedsDd: -0.1 }], ['F2', { sellMode: 'trimfirst' }], ['F1+F2+F3', { preLower: true, sellMode: 'trimfirst', refillOnSell: true }]]) {
  const c = [], t = [], m = [], hb = [], mx = [], ac = []
  for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, o), rt = sim2(dates, assets, base, { ...o, tax: 0.22 }); c.push(r.cagr); t.push(rt.cagr); m.push(r.mdd); hb.push(r.buys.filter((e) => !e.first && e.qdd > -0.1).length); mx.push(Math.max(...r.series.filter((p) => p.stepped).map((p) => p.w.cash), 0)); ac.push(r.avgCash) }
  console.log(n, '| 연수익률', pct(mean(c), 2), '세금', pct(mean(t), 2), 'MDD', pct(mean(m), 1), '| 고점 근처 2번 매수 시작일', hb.filter((x) => x).length, '| 1번 뒤 현금 최고', pct(Math.max(...mx)), '평균 현금', pct(mean(ac)))
}
