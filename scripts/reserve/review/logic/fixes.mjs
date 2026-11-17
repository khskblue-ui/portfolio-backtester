import { sim2, pct, allDates, scenFor, QQQ, athBefore } from './sim2.mjs'
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '1999-03-10' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
// 0) 지금 상태
const last = allDates.at(-1), ath = athBefore(last)
console.log('자료 끝', last, 'QQQ', QQQ.get(last), '역대 최고 종가(수정주가)', ath, '낙폭', pct(QQQ.get(last) / ath - 1))
// 1) 변형 비교 (시작일 전체, 그리고 1번 전 현금이 20% 이하로 간 시작일만)
const V = { V0: {}, 'V1 하한을 1번 전에도': { preLower: true }, 'V2 낙폭 -10% 이하면 3번 미룸': { lowerPauseDd: -0.10 }, 'V3 = V1+V2': { preLower: true, lowerPauseDd: -0.10 }, 'V4 1번 전 띠 30~50(기준40)': { preBand: { upper: 0.5, target: 0.4, lower: 0.3 } }, 'V5 1번 전 하한20→30, 상한50→40': { preLower: true, preBand: { upper: 0.5, target: 0.4, lower: -1 } } }
const res = {}
for (const [name, opt] of Object.entries(V)) res[name] = starts.map((st) => { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, opt); const pre = r.stepDay ? r.series.filter((p) => p.d <= r.stepDay) : r.series; const fb = r.buys.find((e) => e.first); return { st, cagr: r.cagr, mdd: r.mdd, dip: r.sells.filter((e) => e.qdd <= -0.15 && e.qdd > -0.30).length, dip18: r.sells.filter((e) => e.d.startsWith('2018-12')).length, sells: r.sells.length, buys: r.buys.length, preMin: Math.min(...pre.map((p) => p.w.cash)), preMax: Math.max(...pre.map((p) => p.w.cash)), firstPct: fb?.pct ?? 0, turnover: r.turnover, yrs: r.yrs } })
const bad = new Set(res.V0.filter((x) => x.preMin <= 0.2).map((x) => x.st))
console.log('\n변형 | 전체 평균 연수익률 차(V0 대비) | 평균 MDD 차 | [문제 시작일 40개] 수익률 차 | MDD 차 | 2018-12 매도가 있는 시작일 | 1번 전 현금 최저 | 1번 전 현금 최고 | 1번 매수 최대 | 연 회전율 평균')
for (const [name, rows] of Object.entries(res)) {
  const d = rows.map((x, i) => x.cagr - res.V0[i].cagr), m = rows.map((x, i) => x.mdd - res.V0[i].mdd)
  const bi = rows.map((x, i) => i).filter((i) => bad.has(rows[i].st))
  console.log(name, '|', pct(mean(d), 2), '|', pct(mean(m), 2), '|', pct(mean(bi.map((i) => d[i])), 2), '|', pct(mean(bi.map((i) => m[i])), 2), '|', rows.filter((x) => x.dip18).length, '|', pct(Math.min(...rows.map((x) => x.preMin))), '|', pct(Math.max(...rows.map((x) => x.preMax))), '|', pct(Math.max(...rows.map((x) => x.firstPct))), '|', pct(mean(rows.map((x) => x.turnover / x.yrs)), 2))
}
// 구체 사례 2009-04-01
for (const [name, opt] of Object.entries(V)) { const { assets, base, dates } = scenFor('2009-04-01'); const r = sim2(dates, assets, base, opt); console.log('2009-04 시작', name, pct(r.cagr), pct(r.mdd), '매도', r.sells.map((e) => e.d + '(' + pct(e.pct, 0) + ',qdd' + pct(e.qdd, 0) + ')').join(' '), '| 매수', r.buys.map((e) => e.d + '(' + pct(e.pct, 0) + ')').join(' ')) }
