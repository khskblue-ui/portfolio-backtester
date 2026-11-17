import { SCEN, sim, pct, fmtEv, fx } from './lib.mjs'
for (const s of SCEN) {
  const usd = sim(s.dates, s.assets, s.base, {})
  const krw = sim(s.dates, s.assets, s.base, { ccy: 'KRWcash' })
  const f0 = fx(s.dates[0]), f1 = fx(s.dates.at(-1))
  const usdInKrw = (usd.final.V / 100 * f1 / f0) ** (1 / usd.yrs) - 1
  // 달러 현금 전략을 원화로 본 MDD
  let pk = 0, mddK = 0; for (const p of usd.series) { const v = p.V * fx(p.d); pk = Math.max(pk, v); mddK = Math.min(mddK, v / pk - 1) }
  console.log(`\n=== ${s.id} ===`)
  console.log(`[달러 기준, 보고서 재현] 연 ${pct(usd.cagr)} MDD ${pct(usd.mdd)} 산 ${usd.buys.length} 판 ${usd.sells.length} 줄임 ${usd.trims.length} 평균현금 ${pct(usd.avgCash, 0)}`)
  console.log(`  같은 전략(현금도 달러)을 원화로 환산: 연 ${pct(usdInKrw)} MDD ${pct(mddK)}`)
  for (const e of usd.events) console.log('   ' + fmtEv(e))
  console.log(`[원화 현금, 원화 환산 비중] 연(원화) ${pct(krw.cagr)} MDD(원화) ${pct(krw.mdd)} 산 ${krw.buys.length} 판 ${krw.sells.length} 줄임 ${krw.trims.length} 평균현금 ${pct(krw.avgCash, 0)}`)
  for (const e of krw.events) console.log('   ' + fmtEv(e))
  const mx = krw.series.filter((p) => p.stepped).reduce((m, p) => (p.w.cash > m.w.cash ? p : m), { w: { cash: 0 } })
  console.log(`  원화 현금: 처음 산 뒤 현금 비중 최고 ${pct(mx.w.cash)} (${mx.d})`)
}
