import { SCEN, simG, pct, QQQ, GLD, BTC, ALLQ, A_QQQ, A_GOLD, A_BTC } from './lib.mjs'
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
const slim = (r) => ({ cagr: r.cagr, sharpe: r.sharpe, mdd: r.mdd })
// (1) s1999 대안 분포 (메모리 절약)
{ const s = SCEN[2], all = s.dates, starts = all.filter((d, i) => (i === 0 || d.slice(0, 7) !== all[i - 1].slice(0, 7)) && d <= '2021-10-31')
  const alts = [['P', s.base, {}], ['A1 바로 30', s.tgt, { stepped0: true }], ['A3 연 1회(1월)', s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y', month: 1 }], ['A3b 연 1회(7월)', s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y', month: 7 }], ['A5 띠 25/35', s.tgt, { stepped0: true, upper: 0.35, lower: 0.25 }], ['A6 하한 없음', s.tgt, { stepped0: true, useLower: false }]]
  const res = starts.map((st) => { const dates = all.filter((d) => d >= st); return alts.map(([l, base, o]) => slim(simG(dates, s.assets, base, { ...o, peak: 'ath' }))) })
  console.log(`(1) s1999 시작일 ${starts.length}개, 대안 − 규칙`)
  alts.forEach(([l], j) => { if (!j) return; const dc = res.map((r) => r[j].cagr - r[0].cagr), ds = res.map((r) => r[j].sharpe - r[0].sharpe), dm = res.map((r) => r[j].mdd - r[0].mdd)
    console.log(`  ${l.padEnd(18)} CAGR차 med ${pct(q(dc, 0.5))} [${pct(q(dc, 0.1))}, ${pct(q(dc, 0.9))}] | Sharpe차 med ${q(ds, 0.5).toFixed(2)} (대안 우위 ${pct(ds.filter((x) => x > 0).length / ds.length, 0)}) | MDD차 med ${pct(q(dm, 0.5))} (대안이 얕음 ${pct(dm.filter((x) => x > 0).length / dm.length, 0)})`) }) }
// (2) 3년 뒤 수익률의 기저율: 2015~2023의 모든 날 vs -20% 사건일
{ const P = ALLQ.map((d) => QQQ.get(d)); const f3 = (i) => { const t = `${+ALLQ[i].slice(0, 4) + 3}${ALLQ[i].slice(4)}`; const j = ALLQ.findIndex((x) => x >= t); return j > 0 ? P[j] / P[i] - 1 : null }
  for (const [a, b] of [['2016-01-01', '2023-10-30'], ['1999-03-10', '2023-10-30'], ['2003-01-01', '2023-10-30']]) {
    const xs = []; ALLQ.forEach((d, i) => { if (d >= a && d <= b) { const v = f3(i); if (v != null) xs.push(v) } })
    console.log(`(2) ${a}~${b} 모든 거래일의 3년 뒤 QQQ: p10 ${pct(q(xs, 0.1))} p25 ${pct(q(xs, 0.25))} med ${pct(q(xs, 0.5))} p75 ${pct(q(xs, 0.75))} p90 ${pct(q(xs, 0.9))} | +54% 이상인 날 ${pct(xs.filter((x) => x >= 0.54).length / xs.length, 0)}`)
  }
  for (const d of ['2000-04-12', '2018-12-21', '2020-03-12', '2022-03-14']) { const i = ALLQ.indexOf(d); console.log(`    사건일 ${d}: 3년 뒤 ${pct(f3(i))}`) } }
// (3) 금, 암호화폐 실제 비중 분포
for (const s of SCEN.slice(0, 2)) { const r = simG(s.dates, s.assets, s.base, {}); for (const k of Object.keys(s.base).filter((k) => k !== 'cash' && k !== 'qqq')) { const w = r.series.map((x) => x.w[k]); console.log(`(3) ${s.id} ${k} 비중: 평균 ${pct(q(w, 0.5))}(중앙) min ${pct(q(w, 0))} p10 ${pct(q(w, 0.1))} p90 ${pct(q(w, 0.9))} max ${pct(q(w, 1))} | 7% 미만이던 날 ${pct(w.filter((x) => x < 0.07).length / w.length, 0)}, 5% 미만 ${pct(w.filter((x) => x < 0.05).length / w.length, 0)}`) }
  const wq = r.series.map((x) => x.w.qqq); console.log(`    QQQ 비중: 중앙 ${pct(q(wq, 0.5))} min ${pct(q(wq, 0))} max ${pct(q(wq, 1))}`) }
// (4) 첫 매수 전 현금이 40%를 넘은 채 머문 기간
for (const s of SCEN) { const r = simG(s.dates, s.assets, s.base, {}); const pre = r.series.filter((x) => !r.buys[0] || x.d < r.buys[0].d); const over = pre.filter((x) => x.w.cash > 0.41)
  console.log(`(4) ${s.id} 첫 매수 전 ${pre.length}일(${(pre.length / 252).toFixed(1)}년) 중 현금 41% 초과 ${over.length}일(${(over.length / 252).toFixed(1)}년), 최대 ${pct(Math.max(...pre.map((x) => x.w.cash)), 0)}, 45% 초과 ${(pre.filter((x) => x.w.cash > 0.45).length / 252).toFixed(1)}년, 50% 초과 ${(pre.filter((x) => x.w.cash > 0.5).length / 252).toFixed(1)}년`) }
// (5) 거래 비용
console.log('(5) 거래 비용(편도)')
for (const s of SCEN) console.log('  ', s.id, [[0, 0], [0.0025, 0.005], [0.005, 0.01], [0.01, 0.02]].map(([c, cb]) => { const r = simG(s.dates, s.assets, s.base, { cost: c, costBy: { btc: cb } }), f = simG(s.dates, s.assets, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y', cost: c, costBy: { btc: cb } }); return `주식·금 ${pct(c, 2).trim()}/코인 ${pct(cb, 1).trim()}: 규칙 ${pct(r.cagr, 2).trim()} 연1회 ${pct(f.cagr, 2).trim()}` }).join(' | '))
// (6) 새 돈: 자산의 일정 비율이 아니라 금액 고정(첫해 자산의 6%, 해마다 3% 증가)
console.log('(6) 새로 들어오는 돈의 모형')
for (const s of SCEN) { const a = simG(s.dates, s.assets, s.base, { contrib: 0.06 }), b = simG(s.dates, s.assets, s.base, { contribAbs: 0.06, contribGrow: 0.03 }), c = simG(s.dates, s.assets, s.base, { contribAbs: 0.12, contribGrow: 0.03 })
  const lastRate = (r, abs) => abs * 100 * 1.03 ** r.yrs / r.endTotal
  console.log(`   ${s.id} 자산의 6%(보고서): 판 ${a.sells.length}번 | 첫해 자산의 6% 금액 고정(+3%/년): 판 ${b.sells.length}번 (${b.sells.map((e) => e.d.slice(0, 4)).join(',')}), 마지막 해에는 자산의 ${pct(lastRate(b, 0.06), 1).trim()} | 첫해 12%: 판 ${c.sells.length}번, 마지막 해 ${pct(lastRate(c, 0.12), 1).trim()}`) }
