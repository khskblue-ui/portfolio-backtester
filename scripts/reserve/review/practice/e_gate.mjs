import { SCEN, sim, pct, fmtEv, QQQ, GLD, BTC, A_QQQ, A_GOLD, A_BTC } from './lib.mjs'
const all = [...QQQ.keys()].sort(); const ath = new Map(); { let pk = 0; for (const d of all) { pk = Math.max(pk, QQQ.get(d)); ath.set(d, pk) } }
const dates = all.filter((d) => d >= '2014-09-17' && GLD.has(d) && BTC.has(d)); const assets = [A_QQQ, A_GOLD, A_BTC]
console.log('[11] 예시: 기준 비중 50/10/10/30으로 2016-06-01, 2020-10-01, 2023-01-03에 시작')
for (const st of ['2016-06-01', '2020-10-01', '2023-01-03']) { const ds = dates.filter((d) => d >= st); const r = sim(ds, assets, { qqq: 0.5, gold: 0.1, btc: 0.1, cash: 0.3 }, { peak0: ath.get(st), stepped0: true }); console.log(` 시작 ${st}: 연 ${pct(r.cagr)} MDD ${pct(r.mdd)}`); for (const e of r.events.slice(0, 9)) console.log('   ' + fmtEv(e)) }
console.log('\n[12] 2번 규칙에 조건 추가(QQQ가 역대 최고 종가보다 10% 이상 낮을 때만, 단 현금 50% 이상이면 조건 없이): 시작 월 반복 평균')
const starts = []; let pm = ''; for (const d of dates) { if (d.slice(0, 7) !== pm && d <= '2021-10-31') { starts.push(d); pm = d.slice(0, 7) } }
for (const [nm, opt] of [['지금 규칙', {}], ['낙폭 -10% 조건, 현금 50% 예외', { gate: -0.1, hardCap: 0.5 }], ['낙폭 -15% 조건, 현금 50% 예외', { gate: -0.15, hardCap: 0.5 }]]) {
  const rs = starts.map((st) => sim(dates.filter((d) => d >= st), assets, { qqq: 0.5, gold: 0.1, btc: 0.1, cash: 0.3 }, { peak0: ath.get(st), stepped0: true, ...opt }))
  const avg = (f) => rs.reduce((s, x) => s + f(x), 0) / rs.length
  console.log(`  ${nm}: 평균 연 ${pct(avg((r) => r.cagr))} 평균 MDD ${pct(avg((r) => r.mdd))} 평균 현금 ${pct(avg((r) => r.avgCash), 0)} 평균 매수 ${avg((r) => r.buys.length).toFixed(1)}회`) }
console.log('  세 구간(40% 현금 시작, 구간 내 최고가 기준):')
for (const s of SCEN) for (const [nm, opt] of [['지금 규칙', {}], ['-10% 조건', { gate: -0.1, hardCap: 0.5 }]]) { const r = sim(s.dates, s.assets, s.base, opt); console.log(`   ${s.id} ${nm}: ${pct(r.cagr)} / ${pct(r.mdd)} 산 ${r.buys.length} 판 ${r.sells.length}`) }
