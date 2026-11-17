import { sim2, pct, allDates, scenFor, QQQ, athBefore, RULE } from './sim2.mjs'
import { SCEN } from './base.mjs'
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '1999-03-10' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const evs = (r, from = '') => r.events.filter((e) => e.d >= from).map((e) => `${e.d} ${e.type}${e.key ? ':' + e.key : ''}${e.kind ? ':' + e.kind : ''} ${pct(e.pct, 1)} 현금 ${pct(e.from ?? e.cashFrom, 1)}→${pct(e.to ?? e.cashTo, 1)} qdd ${pct(e.qdd, 0)}${e.parts ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, +(v * 100).toFixed(1)]))) : ''}`).join('\n    ')
const w = (x) => Object.entries(x).map(([k, v]) => k + ' ' + pct(v, 1)).join(' ')

console.log('## (e) 진짜 역대 최고가로 1번을 보면 (peak0 = 시작일까지의 최고 종가)')
for (const s of SCEN) { const a = sim2(s.dates, s.assets, s.base, {}), b = sim2(s.dates, s.assets, s.base, { peak0: athBefore(s.dates[0]) }); console.log(s.id, '시작일 낙폭(진짜 ATH 기준)', pct(QQQ.get(s.dates[0]) / athBefore(s.dates[0]) - 1), '| 보고서 방식 1번', a.stepDay, pct(a.cagr), pct(a.mdd), '| 진짜 ATH 1번', b.stepDay, pct(b.cagr), pct(b.mdd), '첫 매수', b.buys[0]?.d, pct(b.buys[0]?.pct)) }

console.log('\n## (a) 5번 규칙: 글대로(1번 전에도 현금 30% 기준, 기준 비중 QQQ 50) vs 코드(1번 전 현금 40% 기준)')
for (const s of SCEN) for (const c of [0.03, 0.06]) {
  const a = sim2(s.dates, s.assets, s.base, { contrib: c }), b = sim2(s.dates, s.assets, s.base, { contrib: c, contribText: true })
  const at = (r) => { const p = r.series.find((x) => x.d === r.stepDay); return p ? pct(p.w.cash) : 'na' }
  console.log(s.id, '연', pct(c, 0), '| 코드', pct(a.cagr), pct(a.mdd), '1번 날 현금', at(a), '1번 매수', pct(a.buys.find((e) => e.first)?.pct ?? 0), '| 글대로', pct(b.cagr), pct(b.mdd), '1번 날 현금', at(b), '1번 매수', pct(b.buys.find((e) => e.first)?.pct ?? 0))
}

console.log('\n## (b) 주문 크기를 판단일 종가로 정하면 (6번과 3번/2번이 같은 날 걸릴 때)')
let same = 0, sameEx = []
for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, {}); const byDay = new Map(); for (const e of r.events) { if (!byDay.has(e.d)) byDay.set(e.d, []); byDay.get(e.d).push(e.type) } for (const [d, t] of byDay) if (t.includes('trim') && (t.includes('sell') || t.includes('buy'))) { same++; if (sameEx.length < 5) sameEx.push(st + '→' + d + ':' + t.join('+')) } }
console.log('체결일이 같은 trim+buy/sell (V0, 시작일 전체 합):', same, sameEx.join(' '))
// 판단일에 trim과 하한이 같이 걸렸는데 체결일에 매도가 0이 된 경우 세기: sizeAtDecision으로 돌려 차이를 본다
let diffN = 0; const ex = []
for (const st of starts) { const { assets, base, dates } = scenFor(st); const a = sim2(dates, assets, base, {}), b = sim2(dates, assets, base, { sizeAtDecision: true }); const na = a.events.filter((e) => ['buy', 'sell'].includes(e.type)).length, nb = b.events.filter((e) => ['buy', 'sell'].includes(e.type)).length; if (nb > na + 1) { diffN++; if (ex.length < 3) ex.push({ st, na, nb, b }) } }
console.log('판단일 크기로 주문하면 매매 횟수가 2번 넘게 느는 시작일:', diffN, '/', starts.length)
for (const x of ex.slice(0, 1)) { console.log('  예 시작', x.st, '매매', x.na, '→', x.nb); }
for (const s of SCEN) { const a = sim2(s.dates, s.assets, s.base, {}), b = sim2(s.dates, s.assets, s.base, { sizeAtDecision: true }); console.log(s.id, '체결일 크기', pct(a.cagr), a.buys.length + '/' + a.sells.length, '| 판단일 크기', pct(b.cagr), b.buys.length + '/' + b.sells.length) }

console.log('\n## (c) 3번에서 팔 때: QQQ만 / 기준 초과분 비례 / QQQ 팔면서 금, 암호화폐 10%까지 채움')
for (const s of SCEN) for (const [n, o] of [['QQQ만', {}], ['초과분 비례', { sellMode: 'over' }], ['팔 때 채움', { refillOnSell: true }]]) { const r = sim2(s.dates, s.assets, s.base, o); const minW = (k) => (k in s.base ? pct(Math.min(...r.series.filter((p) => p.d > (r.stepDay ?? '')).map((p) => p.w[k]))) : '-'); console.log(s.id, n, pct(r.cagr), pct(r.mdd), '매수/매도', r.buys.length + '/' + r.sells.length, '마지막', w(r.final.w), '| 1번 뒤 최저 금', minW('gold'), 'btc', minW('btc'), 'QQQ 최고', pct(Math.max(...r.series.map((p) => p.w.qqq)))) }
// 시작일 전체: 마지막 금 비중 분포
for (const [n, o] of [['QQQ만', {}], ['팔 때 채움', { refillOnSell: true }]]) { const g = [], b = [], dc = []; for (const st of starts.filter((x) => x >= '2004-11-18' && x <= '2020-01-01')) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, o); g.push(r.final.w.gold); if (r.final.w.btc != null) b.push(Math.min(...r.series.map((p) => p.w.btc))); dc.push(r.cagr) } console.log(n, '2004-11~2019-12 시작일: 마지막 금 비중 평균', pct(mean(g)), '최저', pct(Math.min(...g)), '5% 미만인 시작일', g.filter((x) => x < 0.05).length + '/' + g.length, '| btc 구간 최저 비중 평균', pct(mean(b)), '| 평균 연수익률', pct(mean(dc), 2)) }

console.log('\n## (d) 6번으로 생긴 현금이 2번을 건드리는 경로')
{ const { assets, base, dates } = scenFor('2018-12-03'); const r = sim2(dates, assets, base, {}); console.log('  시작 2018-12-03:\n    ' + evs(r)) }
{ const { assets, base, dates } = scenFor('2020-03-02'); const r = sim2(dates, assets, base, {}); console.log('  시작 2020-03-02:\n    ' + evs(r)) }
// 전체 시작일에서 2번 매수 분류: 직전 20거래일 안에 trim이 있었나
let all2 = new Map()
for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, {}); for (const e of r.buys.filter((x) => !x.first)) { const i = dates.indexOf(e.d); const tr = r.trims.find((t) => { const j = dates.indexOf(t.d); return j <= i && i - j <= 5 }); const k = e.d; if (!all2.has(k)) all2.set(k, { qdd: e.qdd, trim: tr ? tr.key + ' ' + pct(tr.pct) : '', n: 0, parts: e.parts }); all2.get(k).n++ } }
console.log('  2번 매수 날짜(고유)', all2.size, '가운데 5거래일 안에 6번 매도가 있었던 것', [...all2.values()].filter((x) => x.trim).length)
for (const [d, v] of [...all2].sort()) if (v.trim) console.log('   ', d, 'qdd', pct(v.qdd), 'trim', v.trim, '시작일 수', v.n, JSON.stringify(Object.fromEntries(Object.entries(v.parts).map(([k, x]) => [k, +(x * 100).toFixed(2)]))))
