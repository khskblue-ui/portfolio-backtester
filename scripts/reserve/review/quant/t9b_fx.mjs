// 양식화한 환율 시험 2(가정): 원/달러 = (QQQ / 최근 1년 최고)^(-β). 급락 때 달러가 오르고 1년 안에 되돌아오는 모양.
import { SCEN, simG, pct, QQQ, ALLQ } from './lib.mjs'
const hi = new Map(); ALLQ.forEach((d, i) => { let m = 0; for (let j = Math.max(0, i - 252); j <= i; j++) m = Math.max(m, QQQ.get(ALLQ[j])); hi.set(d, m) })
const fx = (d, beta) => (QQQ.get(d) / hi.get(d)) ** -beta
const krw = (a, beta) => ({ ...a, px: new Map([...a.px].filter(([d]) => QQQ.has(d)).map(([d, v]) => [d, v * fx(d, beta)])) })
for (const beta of [0.2, 0.4, 0.6]) console.log(`β=${beta}: 환율 최고 상승 ${pct(Math.max(...ALLQ.map((d) => fx(d, beta))) - 1, 0).trim()}, 2008-11-20 ${pct(fx('2008-11-20', beta) - 1, 0).trim()}, 2020-03-16 ${pct(fx('2020-03-16', beta) - 1, 0).trim()}, 2022-10-14 ${pct(fx('2022-10-14', beta) - 1, 0).trim()}`)
for (const s of SCEN) {
  console.log(`\n${s.id}`)
  for (const beta of [0, 0.2, 0.4, 0.6]) {
    const as = s.assets.map((a) => krw(a, beta)), r = simG(s.dates, as, s.base, {}), up = r.buys.filter((e) => !e.first)
    console.log(`  β=${beta}: 산 ${r.buys.length}번(2번 규칙 ${up.length}번) [${r.buys.map((e) => `${e.d.slice(0, 7)}${e.first ? '(1번)' : ''} ${pct(e.pct, 0).trim()}`).join(', ')}] | 판 ${r.sells.length}번 | 현금 비중 최고 ${pct(Math.max(...r.series.filter((x) => r.buys[0] && x.d > r.buys[0].d).map((x) => x.w.cash)), 0).trim()}`)
  }
}
console.log('\n현금 30→40%가 되는 데 필요한 QQQ 달러 낙폭 (QQQ 50/금 10/코인 10/현금 30, 현금은 원화)')
for (const [f, b] of [[1, 0], [1.1, 0], [1.2, 0], [1.3, 0], [1.5, 0], [1, 0.6], [1.2, 0.6], [1.5, 0.6]]) { const x = 1 - (0.45 / f - 0.1 - 0.1 * (1 - b)) / 0.5; console.log(`  환율 +${Math.round((f - 1) * 100)}%, 코인 −${b * 100}%: QQQ ${x >= 1 ? '닿지 않음' : pct(-x, 0).trim()}`) }
