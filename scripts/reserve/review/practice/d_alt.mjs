import { SCEN, sim, pct, fmtEv, fx, QQQ, GLD, BTC, IRX, RULE, A_QQQ, A_GOLD, A_BTC } from './lib.mjs'
// 고정 비중 리밸런싱(연 1회 또는 월 점검 + 밴드). 세금: 평균 단가 차익 22%(공제 없음), 보고서 세금 줄과 같은 가정.
function fixed(dates, assets, tgt, { every = 'year', band = null, tax = 0, start = null } = {}) {
  const hold = {}, cost = {}; const b0 = start ?? tgt
  for (const a of assets) { hold[a.key] = (100 * b0[a.key]) / a.px.get(dates[0]); cost[a.key] = 100 * b0[a.key] }
  let cash = 100 * b0.cash, irx = 0, n = 0, sold = 0, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * a.px.get(d), 0)
  const ser = [100]; let pend = false; let turnover = 0
  for (let i = 1; i < dates.length; i++) { const d = dates[i], p = dates[i - 1]
    if (IRX.has(p)) irx = IRX.get(p); cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(p)) / 864e5 / 365)
    if (pend) { let T = total(d); n++
      for (const a of assets) { const cur = hold[a.key] * a.px.get(d), want = tgt[a.key] * T; if (cur > want) { const amt = cur - want, frac = amt / cur, tx = Math.max(0, amt - cost[a.key] * frac) * tax; hold[a.key] -= amt / a.px.get(d); cost[a.key] *= 1 - frac; cash += amt - tx; taxPaid += tx; sold += amt / T; turnover += amt / T } }
      T = total(d)
      for (const a of assets) { const cur = hold[a.key] * a.px.get(d), want = tgt[a.key] * T; if (cur < want) { const amt = Math.min(want - cur, Math.max(0, cash - tgt.cash * T)); hold[a.key] += amt / a.px.get(d); cost[a.key] += amt; cash -= amt } }
      pend = false }
    const T = total(d); ser.push(T)
    const boundary = every === 'year' ? d.slice(0, 4) !== (dates[i + 1] ?? d).slice(0, 4) : d.slice(0, 7) !== (dates[i + 1] ?? d).slice(0, 7)
    if (boundary) { if (!band) pend = true; else { const cw = cash / T; if (Math.abs(cw - tgt.cash) >= band || assets.some((a) => a.key !== 'qqq' && (hold[a.key] * a.px.get(d)) / T >= 0.2)) pend = true } } }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25; let pk = 0, mdd = 0; for (const v of ser) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1) }
  return { cagr: (ser.at(-1) / 100) ** (1 / yrs) - 1, mdd, n, sold, taxPaid }
}
console.log('[9] 단순한 대안과 비교(달러 기준, 세금 없음 / 세금 22%)')
for (const s of SCEN) {
  const tgt = { cash: 0.3, ...Object.fromEntries(s.assets.map((a) => [a.key, a.key === 'qqq' ? 0.7 - 0.1 * (s.assets.length - 1) : 0.1])) }
  const plan = sim(s.dates, s.assets, s.base, {}), planT = sim(s.dates, s.assets, s.base, { tax: 0.22 })
  const yr = fixed(s.dates, s.assets, tgt, {}), yrT = fixed(s.dates, s.assets, tgt, { tax: 0.22 })
  const bd = fixed(s.dates, s.assets, tgt, { every: 'month', band: 0.1 }), bdT = fixed(s.dates, s.assets, tgt, { every: 'month', band: 0.1, tax: 0.22 })
  const planStepped = sim(s.dates, s.assets, tgt, { stepped0: true }), planSteppedT = sim(s.dates, s.assets, tgt, { stepped0: true, tax: 0.22 })
  console.log(`  ${s.id}`)
  console.log(`    규칙대로(40% 현금 시작): ${pct(plan.cagr)} / ${pct(plan.mdd)}  세후 ${pct(planT.cagr)}  거래 ${plan.events.length}회`)
  console.log(`    규칙대로(처음부터 기준 비중, 1번 규칙 없음): ${pct(planStepped.cagr)} / ${pct(planStepped.mdd)}  세후 ${pct(planSteppedT.cagr)}  거래 ${planStepped.events.length}회 (산 ${planStepped.buys.length} 판 ${planStepped.sells.length} 줄임 ${planStepped.trims.length})`)
  console.log(`    연 1회 기준 비중으로 되돌리기: ${pct(yr.cagr)} / ${pct(yr.mdd)}  세후 ${pct(yrT.cagr)}  ${yr.n}회, 누적 매도 ${pct(yr.sold, 0)}`)
  console.log(`    월 1회 점검, 현금이 20/40%에 닿거나 금·암호화폐 20%면 전부 기준으로: ${pct(bd.cagr)} / ${pct(bd.mdd)}  세후 ${pct(bdT.cagr)}  ${bd.n}회, 누적 매도 ${pct(bd.sold, 0)}`)
}
// 10. 2번 규칙에 QQQ 낙폭 조건을 붙이면(역대 최고가 대비 -15% 이하일 때만 QQQ 매수): 시작 월 반복
console.log('\n[10] 처음부터 기준 비중(50/10/10/30) 시작, 시작 월 반복 평균')
{ const all = [...QQQ.keys()].sort(); const ath = new Map(); { let pk = 0; for (const d of all) { pk = Math.max(pk, QQQ.get(d)); ath.set(d, pk) } }
  const dates = all.filter((d) => d >= '2014-09-17' && GLD.has(d) && BTC.has(d)); const assets = [A_QQQ, A_GOLD, A_BTC]; const base = { qqq: 0.5, gold: 0.1, btc: 0.1, cash: 0.3 }
  const starts = []; let pm = ''; for (const d of dates) { if (d.slice(0, 7) !== pm && d <= '2021-10-31') { starts.push(d); pm = d.slice(0, 7) } }
  const acc = { plan: [], yr: [], bd: [] }
  for (const st of starts) { const ds = dates.filter((d) => d >= st); const r = sim(ds, assets, base, { peak0: ath.get(st), stepped0: true }); acc.plan.push(r); acc.yr.push(fixed(ds, assets, base, {})); acc.bd.push(fixed(ds, assets, base, { every: 'month', band: 0.1 })) }
  const avg = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / xs.length
  for (const k of Object.keys(acc)) console.log(`  ${k}: 평균 연 ${pct(avg(acc[k], (r) => r.cagr))}, 평균 MDD ${pct(avg(acc[k], (r) => r.mdd))}, 최악 MDD ${pct(Math.min(...acc[k].map((r) => r.mdd)))}`) }
