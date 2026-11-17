// 양식화한 환율 시험(가정): 원/달러 = (QQQ / 역대 최고)^(-β). QQQ가 내릴 때 달러가 오르는 정도를 β로 둔다.
// 참고로 기억하는 실제 사례의 β(추정, 외부 자료 미사용): 2008년 약 0.6~0.7, 2022년 약 0.4, 2020년 3월 약 0.2, 2000~02년 약 0.1
import { SCEN, simG, pct, QQQ, ALLQ } from './lib.mjs'
const ath = new Map(); { let m = 0; for (const d of ALLQ) { m = Math.max(m, QQQ.get(d)); ath.set(d, m) } }
const krw = (a, beta) => ({ ...a, px: new Map([...a.px].filter(([d]) => QQQ.has(d)).map(([d, v]) => [d, v * (QQQ.get(d) / ath.get(d)) ** -beta])) })
for (const s of SCEN) {
  console.log(`\n${s.id}`)
  for (const beta of [0, 0.2, 0.4, 0.6]) {
    const as = s.assets.map((a) => krw(a, beta)), r = simG(s.dates, as, s.base, { peak: 'ath' }), h = simG(s.dates, as, s.base, { mode: 'hold' })
    const up = r.buys.filter((e) => !e.first)
    console.log(`  β=${beta}: 2번 규칙 매수 ${up.length}번 [${up.map((e) => `${e.d.slice(0, 7)} QQQ ${pct(e.qdd, 0).trim()}`).join(', ')}] 첫 매수 ${r.buys[0]?.d ?? '-'} | 판 ${r.sells.length}번 | 원화 기준 MDD 규칙 ${pct(r.mdd).trim()} 그냥둠 ${pct(h.mdd).trim()} | 현금 최고 ${pct(Math.max(...r.series.map((x) => x.w.cash)), 0).trim()}`)
  }
}
// QQQ가 얼마나 내려야 현금 30→40이 되나(금·코인 불변, QQQ 50/금 10/코인 10/현금 30): 달러 자산 전체가 환율로 불어난다
console.log('\n현금 30→40%가 되는 QQQ 달러 낙폭(금·코인 달러 가격 불변 가정)')
for (const beta of [0, 0.2, 0.4, 0.6]) { let lo = 0, hi = 0.999; for (let k = 0; k < 60; k++) { const x = (lo + hi) / 2, fx = (1 - x) ** -beta, risky = (0.5 * (1 - x) + 0.2) * fx; if (0.3 / (0.3 + risky) >= 0.4) hi = x; else lo = x } console.log(`  β=${beta}: QQQ ${pct(-hi, 0).trim()} (그때 환율 ${pct((1 - hi) ** -beta - 1, 0).trim()})`) }
