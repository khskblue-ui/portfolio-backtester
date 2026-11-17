import { SCEN, simG, pct, QQQ, ALLQ, A_QQQ, datesFor } from './lib.mjs'
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
const f = (r) => `${pct(r.cagr).trim()}/${pct(r.mdd).trim()}/Sh${r.sharpe.toFixed(2)} b${r.buys.length}s${r.sells.length}t${r.trims.length} 평균현금 ${pct(r.avgCash, 0).trim()}`
console.log('(1) 첫 매수 전에도 현금 상한을 두면 (현금 50% 이상 → 40%까지, 1번 규칙용 10%p는 남김)')
for (const s of SCEN) console.log(`  ${s.id}: 규칙 ${f(simG(s.dates, s.assets, s.base, {}))} | 첫 매수 전 상한 50→40: ${f(simG(s.dates, s.assets, s.base, { preUpper: 0.5, preTo: 0.4 }))} | 45→40: ${f(simG(s.dates, s.assets, s.base, { preUpper: 0.45, preTo: 0.4 }))}`)
// (2) 역대 최고 근처(10% 이내)에서 시작하는 경우만: 규칙(기다림) − 바로 30
console.log('\n(2) QQQ+현금, 역대 최고 10% 이내인 달초에 시작: 기다림(규칙) − 바로 30')
const ath = new Map(); { let m = 0; for (const d of ALLQ) { m = Math.max(m, QQQ.get(d)); ath.set(d, m) } }
const all = datesFor([A_QQQ], '1999-03-10')
for (const hz of [3, 5, 10, null]) {
  const rows = []
  all.forEach((st, i) => {
    if (i && st.slice(0, 7) === all[i - 1].slice(0, 7)) return
    if (QQQ.get(st) / ath.get(st) - 1 < -0.1) return
    const end = hz ? `${+st.slice(0, 4) + hz}${st.slice(4)}` : '9999'
    if (hz && end > all.at(-1)) return
    const dates = all.filter((d) => d >= st && d <= end)
    if (dates.length < 252 * 3) return
    const w = simG(dates, [A_QQQ], { qqq: 0.6, cash: 0.4 }, { peak: 'ath' }), n = simG(dates, [A_QQQ], { qqq: 0.7, cash: 0.3 }, { stepped0: true }), y1 = simG(dates, [A_QQQ], { qqq: 0.6, cash: 0.4 }, { peak: 'ath', firstBy: 365 })
    rows.push({ st, dc: w.cagr - n.cagr, dm: w.mdd - n.mdd, dv: w.final.V / n.final.V - 1, dy: y1.cagr - n.cagr, nb: w.buys.length })
  })
  const dc = rows.map((r) => r.dc), dm = rows.map((r) => r.dm), dv = rows.map((r) => r.dv)
  const pre = rows.filter((r) => r.st < '2003'), post = rows.filter((r) => r.st >= '2003')
  console.log(`  ${hz ?? '끝까지'}${hz ? '년' : ''}: 시작일 ${rows.length}개(1999~2000년 ${pre.length}개, 2015년 이후 ${post.length}개) | 최종 가치 차이 med ${pct(q(dv, 0.5))} [p10 ${pct(q(dv, 0.1))}, p90 ${pct(q(dv, 0.9))}] 기다림 우위 ${pct(dv.filter((x) => x > 0).length / dv.length, 0)} | 2015년 이후 시작만: med ${post.length ? pct(q(post.map((r) => r.dv), 0.5)) : 'n/a'} 우위 ${post.length ? pct(post.filter((r) => r.dv > 0).length / post.length, 0) : 'n/a'} | 1999~2000 시작만: med ${pre.length ? pct(q(pre.map((r) => r.dv), 0.5)) : 'n/a'} | MDD차 med ${pct(q(dm, 0.5))} (기다림이 얕음 ${pct(dm.filter((x) => x > 0).length / dm.length, 0)})`)
}
