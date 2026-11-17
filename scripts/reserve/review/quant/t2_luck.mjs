import { SCEN, simG, pct, row, QQQ } from './lib.mjs'
// (a) 연 1회 리밸런싱을 어느 달에 하느냐에 따른 차이: freq를 '그 달의 첫 거래일'로 일반화
function fixedMonth(s, m, weights, base) {
  // simG의 fixed 모드는 연초만 지원하므로 날짜를 m개월 밀어 같은 효과를 낸다: 별도 구현
  const dates = s.dates
  // 간단히: 커스텀 플래그를 위해 simG를 감싸지 않고 직접 구현
  let cash = 100 * base.cash, irx = 0
  const hold = {}; for (const a of s.assets) hold[a.key] = (100 * base[a.key]) / a.px.get(dates[0])
  return null
}
import { IRX, finish } from './lib.mjs'
function annualAt(s, month, W, lag = 1) {
  const dates = s.dates, assets = s.assets
  const hold = {}; for (const a of assets) hold[a.key] = (100 * W[a.key]) / a.px.get(dates[0])
  let cash = 100 * W.cash, irx = 0, pend = -1
  const total = (d) => cash + assets.reduce((x, a) => x + hold[a.key] * a.px.get(d), 0)
  const series = [{ d: dates[0], V: 100, w: { ...W } }], events = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    if (pend === i) { const T = total(d); for (const a of assets) hold[a.key] = (W[a.key] * T) / a.px.get(d); cash = W.cash * T; events.push({ d, type: 'rebal' }) }
    if (d.slice(0, 7) !== prev.slice(0, 7) && +d.slice(5, 7) === month) pend = i + lag
    const T = total(d)
    series.push({ d, V: T, w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * a.px.get(d)) / T])), cash: cash / T } })
  }
  return finish(dates, series, events)
}
for (const s of SCEN) {
  const rs = Array.from({ length: 12 }, (_, m) => annualAt(s, m + 1, s.tgt))
  const c = rs.map((r) => r.cagr), sh = rs.map((r) => r.sharpe), md = rs.map((r) => r.mdd)
  const plan = simG(s.dates, s.assets, s.base, {})
  console.log(`${s.id} 기준 비중 연 1회(달별 12가지): CAGR ${pct(Math.min(...c))}~${pct(Math.max(...c))} 중앙 ${pct([...c].sort()[6])} | Sharpe ${Math.min(...sh).toFixed(2)}~${Math.max(...sh).toFixed(2)} | MDD ${pct(Math.min(...md))}~${pct(Math.max(...md))}  || 규칙 ${pct(plan.cagr)} Sh ${plan.sharpe.toFixed(2)} MDD ${pct(plan.mdd)}`)
  console.log('   달별 CAGR:', c.map((x) => (x * 100).toFixed(1)).join(' '))
}
// (b) 체결 지연에 따른 규칙 결과
console.log('\n체결 지연(거래일)별 규칙 결과')
for (const s of SCEN) {
  console.log(s.id, [0, 1, 2, 3, 5, 10, 21].map((lag) => { const r = simG(s.dates, s.assets, s.base, { lag }); return `lag${lag}: ${pct(r.cagr).trim()}/${pct(r.mdd).trim()} b${r.buys.length}s${r.sells.length}t${r.trims.length}` }).join(' | '))
  console.log(s.id, 'hold', [0, 1, 2, 3, 5, 10, 21].map((lag) => { const r = simG(s.dates, s.assets, s.base, { lag, mode: 'hold' }); return `lag${lag}: ${pct(r.cagr).trim()}` }).join(' | '))
}
// (c) 2018-12 근처 QQQ 종가
console.log('\n2018-12 QQQ 종가')
const ds = [...QQQ.keys()].sort().filter((d) => d >= '2018-12-14' && d <= '2019-01-10')
let pk = 0; for (const d of [...QQQ.keys()].sort()) { if (d > '2019-01-10') break; pk = Math.max(pk, QQQ.get(d)); if (d >= '2018-12-14') console.log(d, QQQ.get(d).toFixed(2), pct(QQQ.get(d) / pk - 1)) }
