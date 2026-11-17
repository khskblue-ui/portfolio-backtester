import { sim2, pct, allDates } from './sim2.mjs'
import { SCEN } from './base.mjs'
// 세금 넣은 s2014에서 V0와 F2가 왜 다른지
{ const s = SCEN[0]; for (const [n, o] of [['V0', { tax: 0.22 }], ['F2', { tax: 0.22, sellMode: 'trimfirst' }]]) { const r = sim2(s.dates, s.assets, s.base, o); console.log(n, pct(r.cagr, 2), '세금', r.taxPaid.toFixed(1), r.events.filter((e) => e.d > '2019').map((e) => `${e.d} ${e.type}${e.key ? ':' + e.key : ''} ${pct(e.pct)}${e.parts ? JSON.stringify(Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, +(v * 100).toFixed(1)]))) : ''}`).join(' | ')) } }
// 무작위 극단 경로로 상태 기계 불변식 점검
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const norm = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const dates = allDates.slice(-2520)
const mk = (mu, vol, jumpP, jumpSz) => { const m = new Map(); let p = 100; for (const d of dates) { m.set(d, p); let r = mu / 252 + vol * norm(); if (rnd() < jumpP) r += jumpSz * (rnd() < 0.6 ? -1 : 1) * (0.5 + rnd()); p *= Math.exp(r) } return m }
const stat = { paths: 0, sellfail: 0, negCash: 0, minCashPost: 1, maxCashPost: 0, minCashPre: 1, maxCashPre: 0, maxTradesYr: 0, minGapOpp: 1e9, oppWithin20: 0, sameDayMulti: 0, trimThenBuy3: 0, sellThenBuy60: 0, noStep: 0, firstNoBuy: 0, sellAfterFirstNoBuy10: 0, maxOther: 0, minOtherPost: 1, maxQqq: 0 }
for (let k = 0; k < 600; k++) {
  const regime = k % 3 // 0: 보통, 1: 암호화폐 급등락 심함, 2: QQQ 긴 하락
  const assets = [{ key: 'qqq', px: mk(regime === 2 ? -0.08 : 0.12, 0.016, 0.004, 0.08) }, { key: 'gold', px: mk(0.05, 0.01, 0.001, 0.05) }, { key: 'btc', px: mk(regime === 1 ? 0.6 : 0.25, regime === 1 ? 0.07 : 0.045, 0.01, 0.25) }]
  const r = sim2(dates, assets, { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, { irxConst: 3 })
  stat.paths++
  stat.sellfail += r.events.filter((e) => e.type === 'sellfail').length
  if (!r.stepDay) stat.noStep++
  for (const p of r.series) { const c = p.w.cash; if (!(c >= 0)) stat.negCash++; if (p.stepped) { stat.minCashPost = Math.min(stat.minCashPost, c); stat.maxCashPost = Math.max(stat.maxCashPost, c); stat.minOtherPost = Math.min(stat.minOtherPost, p.w.btc, p.w.gold) } else { stat.minCashPre = Math.min(stat.minCashPre, c); stat.maxCashPre = Math.max(stat.maxCashPre, c) } stat.maxOther = Math.max(stat.maxOther, p.w.btc, p.w.gold); stat.maxQqq = Math.max(stat.maxQqq, p.w.qqq) }
  const tr = r.events.filter((e) => ['buy', 'sell', 'trim'].includes(e.type))
  stat.maxTradesYr = Math.max(stat.maxTradesYr, tr.length / 10)
  const bs = tr.filter((e) => e.type !== 'trim')
  for (let i = 1; i < bs.length; i++) { const g = dates.indexOf(bs[i].d) - dates.indexOf(bs[i - 1].d); if (bs[i].type !== bs[i - 1].type) { stat.minGapOpp = Math.min(stat.minGapOpp, g); if (g <= 20) stat.oppWithin20++; if (bs[i - 1].type === 'sell' && g <= 60) stat.sellThenBuy60++ } }
  for (let i = 1; i < tr.length; i++) { if (tr[i].d === tr[i - 1].d) stat.sameDayMulti++; if (tr[i].type === 'buy' && tr[i - 1].type === 'trim' && dates.indexOf(tr[i].d) - dates.indexOf(tr[i - 1].d) <= 3) stat.trimThenBuy3++ }
  const fn = r.events.find((e) => e.type === 'firstnobuy'); if (fn) { stat.firstNoBuy++; const s = r.sells[0]; if (s && dates.indexOf(s.d) - dates.indexOf(fn.d) <= 10 && s.d > fn.d) stat.sellAfterFirstNoBuy10++ }
}
for (const [k, v] of Object.entries(stat)) console.log(k, typeof v === 'number' && v < 1.5 && !Number.isInteger(v) ? pct(v) : v)
