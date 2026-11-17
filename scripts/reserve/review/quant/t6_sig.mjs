import { SCEN, simG, pct, QQQ, GLD, BTC, ALLQ, A_QQQ, A_GOLD, A_BTC, datesFor, row } from './lib.mjs'
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) }
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
// (a) 일별 수익률 차이의 t값 + 블록 부트스트랩(블록 63일) 신뢰구간
function tstat(a, b, yrs) {
  const d = a.rets.map((x, i) => Math.log(1 + x) - Math.log(1 + b.rets[i])), ppy = d.length / yrs
  const m = mean(d) * ppy, te = sd(d) * Math.sqrt(ppy)
  // 블록 부트스트랩
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const B = 63, nb = Math.ceil(d.length / B), sims = []
  for (let k = 0; k < 2000; k++) { let s = 0, n = 0; for (let j = 0; j < nb; j++) { const st = Math.floor(rnd() * (d.length - B)); for (let t = 0; t < B && n < d.length; t++, n++) s += d[st + t] } sims.push((s / d.length) * ppy) }
  return { m, te, t: m / (te / Math.sqrt(yrs)), lo: q(sims, 0.025), hi: q(sims, 0.975) }
}
console.log('(a) 연 로그수익률 차이, 추적오차, t값, 블록 부트스트랩 95% 구간')
for (const s of SCEN) {
  const plan = simG(s.dates, s.assets, s.base, {}), hold = simG(s.dates, s.assets, s.base, { mode: 'hold' }), fix = simG(s.dates, s.assets, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y' }), fixM = simG(s.dates, s.assets, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'M' })
  for (const [l, b] of [['그냥 둠', hold], ['기준 비중 연1회', fix], ['기준 비중 매달', fixM]]) { const r = tstat(plan, b, plan.yrs); console.log(`${s.id} 규칙 − ${l.padEnd(10)}: 차이 ${pct(r.m, 2)} TE ${pct(r.te)} t=${r.t.toFixed(2)} 95% [${pct(r.lo, 1).trim()}, ${pct(r.hi, 1).trim()}]`) }
}
// (b) 겹치지 않는 구간으로 쪼갠 규칙−그냥둠: 각 시나리오의 가치 계열에서 구간 수익률
console.log('\n(b) 구간 분해: 각 시나리오 계열 안에서의 구간 연수익률(규칙 / 그냥 둠 / 차이)')
const seg = [['1999-03-10', '2004-11-18'], ['2004-11-18', '2014-09-17'], ['2014-09-17', '2026-10-30']]
for (const s of SCEN) {
  const plan = simG(s.dates, s.assets, s.base, {}), hold = simG(s.dates, s.assets, s.base, { mode: 'hold' })
  const at = (r, d) => r.series.find((x) => x.d >= d)
  console.log(s.id, seg.filter(([a]) => a >= s.dates[0]).map(([a, b]) => { const y = (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25; const c = (r) => (at(r, b).V / at(r, a).V) ** (1 / y) - 1; return `${a.slice(0, 4)}~${b.slice(0, 4)}: ${pct(c(plan)).trim()} / ${pct(c(hold)).trim()} / ${pct(c(plan) - c(hold)).trim()} (QQQ비중 규칙 ${pct(at(plan, a).w.qqq, 0).trim()}→${pct(at(plan, b).w.qqq, 0).trim()}, 방치 ${pct(at(hold, a).w.qqq, 0).trim()}→${pct(at(hold, b).w.qqq, 0).trim()})` }).join(' | '))
}
// (c) 같은 자산(QQQ+현금)으로 세 구간을 따로 시작: 겹치지 않는 독립 표본 3개
console.log('\n(c) QQQ+현금만, 겹치지 않는 세 구간을 각각 새로 시작(현금 40 시작, 역대 최고가 기준)')
for (const [a, b] of seg) {
  const dates = datesFor([A_QQQ], a, b), base = { qqq: 0.6, cash: 0.4 }, tgt = { qqq: 0.7, cash: 0.3 }
  const plan = simG(dates, [A_QQQ], base, { peak: 'ath' }), hold = simG(dates, [A_QQQ], base, { mode: 'hold' }), fix = simG(dates, [A_QQQ], tgt, { mode: 'fixed', weights: tgt, freq: 'Y' })
  console.log(`${a}~${b}`); console.log(row('  규칙', plan, `b${plan.buys.length}s${plan.sells.length}`)); console.log(row('  그냥 둠', hold)); console.log(row('  70/30 연1회', fix))
}
// (d) 비트코인 의존도 (2014 구간)
console.log('\n(d) 2014~2026 구간에서 비트코인을 바꿔 보면')
const s = SCEN[0]
const mk = (name, f) => { const m = new Map(); let p = 100, prev = null; for (const d of s.dates) { if (prev) p *= f(BTC.get(d) / BTC.get(prev), d); m.set(d, p); prev = d } return { key: 'btc', name, px: m } }
const yrs = (Date.parse(s.dates.at(-1)) - Date.parse(s.dates[0])) / 864e5 / 365.25, n = s.dates.length - 1
const btcC = (BTC.get(s.dates.at(-1)) / BTC.get(s.dates[0])) ** (1 / yrs) - 1, qC = (QQQ.get(s.dates.at(-1)) / QQQ.get(s.dates[0])) ** (1 / yrs) - 1
console.log(`  BTC ${BTC.get(s.dates[0]).toFixed(0)} → ${BTC.get(s.dates.at(-1)).toFixed(0)} (연 ${pct(btcC).trim()}), QQQ 연 ${pct(qC).trim()}, GLD 연 ${pct((GLD.get(s.dates.at(-1)) / GLD.get(s.dates[0])) ** (1 / yrs) - 1).trim()}`)
const adj = (target) => { const k = Math.exp((Math.log(1 + target) * yrs - Math.log(BTC.get(s.dates.at(-1)) / BTC.get(s.dates[0]))) / n); return (r) => r * k }
const variants = [['실제 비트코인', A_BTC], ['변동성 그대로, 연수익률을 QQQ와 같게', mk('b', adj(qC))], ['변동성 그대로, 연수익률 0%', mk('b', adj(0))], ['로그수익률 절반(변동성 절반)', mk('b', (r) => Math.sqrt(r))]]
for (const [l, a] of variants) {
  const as = [A_QQQ, A_GOLD, a], plan = simG(s.dates, as, s.base, {}), hold = simG(s.dates, as, s.base, { mode: 'hold' }), fix = simG(s.dates, as, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y' }), raw = simG(s.dates, as, s.base, { mode: 'hold', trim: false })
  console.log(`  ${l}: 규칙 ${pct(plan.cagr).trim()}/${pct(plan.mdd).trim()}/Sh${plan.sharpe.toFixed(2)} (b${plan.buys.length}s${plan.sells.length}t${plan.trims.length}, 첫 매수 ${plan.buys[0]?.d ?? '-'} 현금 ${plan.buys[0] ? pct(plan.buys[0].from, 0).trim() : ''}) | 그냥둠 ${pct(hold.cagr).trim()}/${pct(hold.mdd).trim()}/Sh${hold.sharpe.toFixed(2)} | 연1회 ${pct(fix.cagr).trim()}/${pct(fix.mdd).trim()}/Sh${fix.sharpe.toFixed(2)} | 완전 방치 ${pct(raw.cagr).trim()}/${pct(raw.mdd).trim()}`)
}
{ const as = [A_QQQ, A_GOLD], base = { qqq: 0.5, gold: 0.1, cash: 0.4 }, tgt = { qqq: 0.6, gold: 0.1, cash: 0.3 }
  const plan = simG(s.dates, as, base, {}), hold = simG(s.dates, as, base, { mode: 'hold' }), fix = simG(s.dates, as, tgt, { mode: 'fixed', weights: tgt, freq: 'Y' })
  console.log(`  비트코인 없이(QQQ 50, 금 10, 현금 40): 규칙 ${pct(plan.cagr).trim()}/${pct(plan.mdd).trim()}/Sh${plan.sharpe.toFixed(2)} (b${plan.buys.length}s${plan.sells.length}) | 그냥둠 ${pct(hold.cagr).trim()}/${pct(hold.mdd).trim()}/Sh${hold.sharpe.toFixed(2)} | 연1회 ${pct(fix.cagr).trim()}/Sh${fix.sharpe.toFixed(2)}`) }
// 비트코인 구간을 늦게 시작
console.log('\n  비트코인 포함, 시작 시점별(끝 2026-10, 역대 최고가 기준): 규칙 / 그냥 둠 / 기준 비중 연1회')
for (const st of ['2014-09-17', '2016-01-04', '2018-01-02', '2019-01-02', '2020-01-02', '2021-01-04', '2021-11-08', '2022-01-03', '2023-01-03']) {
  const dates = s.dates.filter((d) => d >= st), plan = simG(dates, s.assets, s.base, { peak: 'ath' }), hold = simG(dates, s.assets, s.base, { mode: 'hold' }), fix = simG(dates, s.assets, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y' })
  console.log(`   ${st}: ${pct(plan.cagr).trim()}/${pct(plan.mdd).trim()}/Sh${plan.sharpe.toFixed(2)} b${plan.buys.length}s${plan.sells.length}t${plan.trims.length} | ${pct(hold.cagr).trim()}/${pct(hold.mdd).trim()}/Sh${hold.sharpe.toFixed(2)} | ${pct(fix.cagr).trim()}/${pct(fix.mdd).trim()}/Sh${fix.sharpe.toFixed(2)}`)
}
