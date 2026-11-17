import { SCEN, sim, pct, fmtEv, fx, QQQ, GLD, BTC, RULE, A_QQQ, A_GOLD, A_BTC } from './lib.mjs'
const all = [...QQQ.keys()].sort()
const ath = new Map(); { let pk = 0; for (const d of all) { pk = Math.max(pk, QQQ.get(d)); ath.set(d, pk) } }
// 5. 1번 규칙 신호(QQQ 종가가 역대 최고 종가보다 20% 이상 낮음)가 살아 있던 거래일 수
console.log('[5] QQQ 종가 낙폭 ≤ -20%인 구간(수정주가 기준 역대 최고가 대비), 첫 진입 뒤 연속/누적 일수')
{ let inEp = false, start = null, n = 0, lastBelow = null, prevPeakDay = null
  const eps = []
  for (const d of all) { const dd = QQQ.get(d) / ath.get(d) - 1
    if (dd <= -0.2) { if (!inEp && (!eps.length || eps.at(-1).newHigh)) { eps.push({ start: d, days: 0, firstRun: 0, runOpen: true, newHigh: false }) } inEp = true; const e = eps.at(-1); e.days++; if (e.runOpen) e.firstRun++; e.last = d }
    else { if (eps.length && !eps.at(-1).newHigh) eps.at(-1).runOpen = false; inEp = false }
    if (QQQ.get(d) >= ath.get(d) && eps.length) eps.at(-1).newHigh = true }
  for (const e of eps) console.log(`  진입 ${e.start}: 첫 연속 ${e.firstRun}거래일, 다음 신고가 전까지 누적 ${e.days}거래일, 마지막 ${e.last}`) }
// 6. 1번 신호를 놓쳤을 때(2018-12 신호를 놓쳐 2019-01-01 이후에만 판단)
console.log('\n[6] s2014에서 2018년 12월 신호를 놓친 경우')
{ const s = SCEN[0]
  // blockUntil 구현: 날짜 이전에는 판단하지 않도록 check 함수를 감싼다 → 간단히 두 구간으로 나눠 흉내 내지 않고 sim에 옵션이 없으므로 peak를 조작하지 않는 방식으로 근사: 월 1회 점검 결과 참조
  const m = sim(s.dates, s.assets, s.base, { check: 'monthly' }); console.log(`  월 1회 점검: 연 ${pct(m.cagr)} (매일 18.5%), 처음 산 날 ${m.buys[0].d}`); for (const e of m.events) console.log('   ' + fmtEv(e)) }
// 7. 시작 시점을 바꿔 가며: 2번 규칙 매수가 QQQ 최고가 근처(-10% 이내)에서 일어난 횟수
console.log('\n[7] 시작 월을 바꾼 반복(QQQ40/금10/BTC10/현금40, 역대 최고가 기준). 2번 규칙 매수 중 QQQ 낙폭이 -10%보다 얕은 경우')
{ const dates = all.filter((d) => d >= '2014-09-17' && GLD.has(d) && BTC.has(d)); const assets = [A_QQQ, A_GOLD, A_BTC]; const base = { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }
  let runs = 0, shallow = 0, total2 = 0; const ex = []
  const starts = []; let pm = ''; for (const d of dates) { if (d.slice(0, 7) !== pm && d <= '2023-01-31') { starts.push(d); pm = d.slice(0, 7) } }
  for (const st of starts) { const ds = dates.filter((d) => d >= st); const r = sim(ds, assets, base, { peak0: ath.get(st) }); runs++
    for (const e of r.buys) if (!e.first) { total2++; const dd = QQQ.get(e.d) / ath.get(e.d) - 1; if (dd > -0.1) { shallow++; ex.push(`${st}시작 ${e.d} 현금 ${pct(e.from, 0)}→${pct(e.to, 0)} QQQ ${pct(dd, 0)}`) } } }
  console.log(`  시작 ${runs}가지, 2번 매수 합계 ${total2}건, 그중 QQQ 낙폭 -10% 이내 ${shallow}건`); const uniq = [...new Set(ex.map((x) => x.split(' ').slice(1).join(' ')))]; console.log('  서로 다른 사례: ' + uniq.slice(0, 12).join(' | ')) }
// 같은 반복을 이미 처음 산 상태(50/10/10/30, stepped)로
{ const dates = all.filter((d) => d >= '2014-09-17' && GLD.has(d) && BTC.has(d)); const assets = [A_QQQ, A_GOLD, A_BTC]; const base = { qqq: 0.5, gold: 0.1, btc: 0.1, cash: 0.3 }
  let runs = 0, shallow = 0, total2 = 0; const ex = new Map()
  const starts = []; let pm = ''; for (const d of dates) { if (d.slice(0, 7) !== pm && d <= '2023-01-31') { starts.push(d); pm = d.slice(0, 7) } }
  for (const st of starts) { const ds = dates.filter((d) => d >= st); const r = sim(ds, assets, base, { peak0: ath.get(st), stepped0: true }); runs++
    for (const e of r.buys) { total2++; const dd = QQQ.get(e.d) / ath.get(e.d) - 1; if (dd > -0.1) { shallow++; ex.set(e.d, `${e.d} 현금 ${pct(e.from, 0)} QQQ ${pct(dd, 0)}`) } } }
  console.log(`  [기준 비중 50/10/10/30에서 시작] 시작 ${runs}가지, 2번 매수 합계 ${total2}건, 그중 QQQ 낙폭 -10% 이내 ${shallow}건`); console.log('  사례 날짜: ' + [...ex.values()].slice(0, 15).join(' | ')) }
// 8. 큰 돈이 한 번에 들어오거나 나갈 때(2004 구간, 처음 산 뒤 2013-01-02에 전체의 +20%, -20%)
console.log('\n[8] 큰 돈 유출입(2004 구간)')
{ const s = SCEN[1]
  for (const [nm, d, amt] of [['유입 +20% (2021-11-19, QQQ 최고가 부근)', '2021-11-19', 0.2], ['유입 +15% (2015-07-20)', '2015-07-20', 0.15], ['인출 -15% (2022-10-14, QQQ -34%)', '2022-10-14', -0.15], ['인출 -20% (2019-07-01)', '2019-07-01', -0.2]]) {
    const r = sim(s.dates, s.assets, s.base, { flow: [{ d, amt }] }); const near = r.events.filter((e) => e.d >= d).slice(0, 2)
    const i = r.series.findIndex((p) => p.d === d); console.log(`  ${nm}: 당일 현금 ${pct(r.series[i].w.cash, 0)}, QQQ낙폭(구간 내) ${pct(r.series[i].qdd, 0)} → 이후 ${near.map(fmtEv).join(' / ')}`) } }
