import { sim2, pct, allDates, scenFor, QQQ, athBefore, RULE, A_QQQ } from './sim2.mjs'
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '1999-03-10' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

console.log('## (i) 3번으로 QQQ를 판 뒤 60거래일 안에 2번으로 다시 사는 왕복')
const s3 = starts.filter((x) => x >= '2014-09-17')
for (const [name, opt] of [['V0 QQQ만 판다', {}], ['A 기준 초과분 비례', { sellMode: 'over' }], ['B 금·암호화폐 15% 이상이면 먼저', { sellMode: 'trimfirst' }], ['B2 같은 것, 12% 이상', { sellMode: 'trimfirst', trimFirstAt: 0.12 }]]) {
  let rt = 0, rtStarts = 0, rtAmt = 0; const cg = [], cgT = [], md = [], to = [], hb = []; const uniq = new Set()
  for (const st of s3) {
    const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, opt), rt22 = sim2(dates, assets, base, { ...opt, tax: 0.22 })
    cg.push(r.cagr); cgT.push(rt22.cagr); md.push(r.mdd); to.push(r.turnover / r.yrs)
    let has = false
    for (const s of r.sells) { const i = dates.indexOf(s.d); const b = r.buys.find((e) => { const j = dates.indexOf(e.d); return j > i && j - i <= 60 }); if (b) { rt++; has = true; rtAmt += Math.min(s.pct, b.parts.qqq ?? 0); uniq.add(s.d + '→' + b.d) } }
    if (has) rtStarts++
    hb.push(r.buys.filter((e) => !e.first && e.qdd > -0.10).length)
  }
  console.log(name, '| 왕복이 있는 시작일', rtStarts + '/' + s3.length, '고유 왕복', [...uniq].join(', ') || '없음', '| 고점 근처(-10% 이내) 2번 매수가 있는 시작일', hb.filter((x) => x).length, '| 평균 연수익률', pct(mean(cg), 2), '세금 22%', pct(mean(cgT), 2), 'MDD', pct(mean(md), 1), '연 회전율', pct(mean(to), 2))
}
for (const st of ['2020-03-02', '2018-12-03']) for (const [name, opt] of [['V0', {}], ['B', { sellMode: 'trimfirst' }]]) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, opt), t = sim2(dates, assets, base, { ...opt, tax: 0.22 }); console.log('  시작', st, name, pct(r.cagr, 2), '세금', pct(t.cagr, 2), 'MDD', pct(r.mdd), '낸 세금(시작 100 기준)', t.taxPaid.toFixed(1), '\n    ' + r.events.filter((e) => e.d >= '2020-06').map((e) => `${e.d} ${e.type}${e.key ? ':' + e.key : ''} ${pct(e.pct)}${e.parts ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(e.parts).map(([k, v]) => [k, +(v * 100).toFixed(1)]))) : ''}`).join(' | ')) }

console.log('\n## (ii) 2번 매수 때 QQQ 낙폭 분포 (고유 날짜)')
const u = new Map(); let fails = 0
const trimW = []
const gaps = []
for (const st of starts) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, {}); for (const e of r.buys.filter((x) => !x.first)) u.set(e.d, e); fails += r.events.filter((e) => e.type === 'sellfail').length; for (const t of r.trims) trimW.push(t.from)
  const tr = r.events.filter((e) => e.type === 'buy' || e.type === 'sell'); for (let i = 1; i < tr.length; i++) gaps.push({ g: dates.indexOf(tr[i].d) - dates.indexOf(tr[i - 1].d), a: tr[i - 1].type, b: tr[i].type, st, d: tr[i].d }) }
const dd = [...u.values()].map((e) => e.qdd)
console.log('고유 2번 매수일', dd.length, '낙폭 최소(가장 깊음)', pct(Math.min(...dd)), '중앙', pct(q(dd, 0.5)), '가장 얕음', pct(Math.max(...dd)), '| -20%보다 얕은 것', dd.filter((x) => x > -0.2).length, '| -40%보다 얕은 것', dd.filter((x) => x > -0.4).length)
console.log([...u].sort().map(([d, e]) => d + ' ' + pct(e.qdd, 0)).join(', '))
console.log('3번 매도 실패(QQQ 부족):', fails)
console.log('6번 체결일의 실제 비중 범위', pct(Math.min(...trimW)), '~', pct(Math.max(...trimW)), '20% 미만으로 내려와 있었던 비율', pct(trimW.filter((x) => x < 0.2).length / trimW.length, 0))
console.log('연속 매매 간격(거래일) 최소', Math.min(...gaps.map((x) => x.g)), ' 60일 안 반대 방향', gaps.filter((x) => x.g <= 60 && x.a !== x.b).length, ' 60일 안 같은 방향', gaps.filter((x) => x.g <= 60 && x.a === x.b).length, '/', gaps.length)
const sg = gaps.filter((x) => x.g <= 20).slice(0, 8); for (const x of sg) console.log('   ', x.st, x.a, '→', x.b, x.d, x.g + '일')

console.log('\n## (iv) 1번 매수 크기: 닷컴 고점(2000-03-27)에서 현금 40/50/60으로 시작')
{ const dates = allDates.filter((d) => d >= '2000-03-27'); for (const c of [0.4, 0.5, 0.6, 0.65]) { const r = sim2(dates, [A_QQQ], { qqq: 1 - c, cash: c }, {}); const h = sim2(dates, [A_QQQ], { qqq: 1 - c, cash: c }, { rule: false }); const fb = r.buys.find((e) => e.first); console.log('시작 현금', pct(c, 0), '1번 매수', fb?.d, pct(fb?.pct), 'qdd', pct(fb?.qdd), '| 규칙 MDD', pct(r.mdd), '그냥 둠 MDD', pct(h.mdd), '| 2002-10-09까지 낙폭', pct(r.series.find((p) => p.d === '2002-10-09').V / 100 - 1), '그냥 둠', pct(h.series.find((p) => p.d === '2002-10-09').V / 100 - 1)) } }

console.log('\n## (v) 1번, 2번 매수에서 금과 암호화폐로 간 몫 (고유 날짜, 자산 2개 이상)')
{ const m = new Map(); for (const st of starts.filter((x) => x >= '2004-11-18')) { const { assets, base, dates } = scenFor(st); const r = sim2(dates, assets, base, {}); for (const e of r.buys) m.set(e.d + (e.first ? 'F' : ''), e) }
  const g = [...m.values()].map((e) => (e.parts.gold ?? 0) / e.pct), b = [...m.values()].filter((e) => 'btc' in e.parts).map((e) => e.parts.btc / e.pct)
  console.log('매수', m.size, '건: 금으로 간 몫 평균', pct(mean(g)), '0인 건', g.filter((x) => x < 0.005).length, '| btc로 간 몫 평균', pct(mean(b)), '(', b.length, '건)') }
