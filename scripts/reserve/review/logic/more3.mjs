import { sim2, pct, allDates, scenFor, QQQ, athBefore, RULE, A_QQQ } from './sim2.mjs'
import { SCEN } from './base.mjs'
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '1999-03-10' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const VAR = { 'V0 지금 규칙': {}, 'F1 하한을 1번 전에도': { preLower: true }, 'F2 3번에서 금·암호화폐 15%↑ 먼저': { sellMode: 'trimfirst' }, 'F3 3번에서 팔 때 금·암호화폐 10% 채움': { refillOnSell: true }, 'F1+F2': { preLower: true, sellMode: 'trimfirst' }, 'F1+F3': { preLower: true, refillOnSell: true } }
console.log('## 세 구간')
for (const s of SCEN) for (const [n, o] of Object.entries(VAR)) { const r = sim2(s.dates, s.assets, s.base, o), t = sim2(s.dates, s.assets, s.base, { ...o, tax: 0.22 }); console.log(s.id, n, '|', pct(r.cagr, 2), pct(r.mdd), '| 세금 22%', pct(t.cagr, 2), '| 산/판', r.buys.length + '/' + r.sells.length, '| 끝', Object.entries(r.final.w).map(([k, v]) => k + pct(v, 0)).join(' ')) }
console.log('\n## 시작일 320개 평균')
for (const [n, o] of Object.entries(VAR)) { const c = [], ct = [], m = [], g = [], dip = []; for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, o), t = sim2(dates, assets, base, { ...o, tax: 0.22 }); c.push(r.cagr); ct.push(t.cagr); m.push(r.mdd); if (r.final.w.gold != null && st <= '2020-01-01') g.push(r.final.w.gold); dip.push(r.sells.filter((e) => e.d.startsWith('2018-12')).length) } console.log(n, '| 연수익률', pct(mean(c), 2), '세금 22%', pct(mean(ct), 2), 'MDD', pct(mean(m), 1), '가장 깊은 MDD', pct(Math.min(...m)), '| 끝 금 비중 평균', pct(mean(g)), '| 2018-12 급락 중 매도 시작일', dip.filter((x) => x).length) }

console.log('\n## 체결일에 본 값의 범위 (V0, 시작일 전체)')
{ const up = [], fq = [], sf = [], bk = { '<20': 0, '20-25': 0, '25-30': 0, '30-35': 0, '35-40': 0, '>=40': 0 }, pre = { '<20': 0, '20-30': 0, '30-40': 0, '40-50': 0, '>=50': 0 }; let nPost = 0, nPre = 0, longest = 0
  for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, {}); for (const e of r.buys) (e.first ? fq : up).push(e.first ? e.qdd : e.from); for (const e of r.sells) sf.push(e.from)
    let run = 0
    for (const p of r.series.slice(1)) { const c = p.w.cash; if (p.stepped) { nPost++; bk[c < 0.2 ? '<20' : c < 0.25 ? '20-25' : c < 0.3 ? '25-30' : c < 0.35 ? '30-35' : c < 0.4 ? '35-40' : '>=40']++; if (c >= 0.35 && c < 0.4) { run++; longest = Math.max(longest, run) } else run = 0 } else { nPre++; pre[c < 0.2 ? '<20' : c < 0.3 ? '20-30' : c < 0.4 ? '30-40' : c < 0.5 ? '40-50' : '>=50']++ } } }
  console.log('2번 체결일의 현금 비중(사기 직전)', pct(Math.min(...up)), '~', pct(Math.max(...up)), ' 40% 미만이었던 비율', pct(up.filter((x) => x < 0.4).length / up.length, 0))
  console.log('1번 체결일의 QQQ 낙폭', pct(Math.min(...fq)), '~', pct(Math.max(...fq)), ' -20%보다 얕았던 비율', pct(fq.filter((x) => x > -0.2).length / fq.length, 0))
  console.log('3번 체결일의 현금 비중(팔기 직전)', pct(Math.min(...sf)), '~', pct(Math.max(...sf)))
  console.log('1번 뒤 현금 비중 분포(일수 비율)', Object.entries(bk).map(([k, v]) => k + ': ' + pct(v / nPost, 0)).join(', '), '| 35~40%에 연속으로 머문 최장', (longest / 252).toFixed(1) + '년')
  console.log('1번 전 현금 비중 분포(일수 비율)', Object.entries(pre).map(([k, v]) => k + ': ' + pct(v / nPre, 0)).join(', '), '| 1번 전 일수 비율', pct(nPre / (nPre + nPost), 0)) }
