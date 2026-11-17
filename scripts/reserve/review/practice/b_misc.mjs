import { SCEN, sim, pct, fmtEv, fx, QQQ, GLD, BTC } from './lib.mjs'
const all = [...QQQ.keys()].sort()
// 0. 지금 상태
{ let pk = 0, pkd; for (const d of all) if (QQQ.get(d) > pk) { pk = QQQ.get(d); pkd = d }
  const last = all.at(-1); console.log(`QQQ 마지막 ${last} ${QQQ.get(last).toFixed(1)} 최고 ${pkd} ${pk.toFixed(1)} 낙폭 ${pct(QQQ.get(last) / pk - 1)}`) }
// 1. QQQ 낙폭: 달러 vs 원화 환산 (수정주가, 환율 근사)
console.log('\n[1] 하락기 QQQ 최대 낙폭: 달러 기준과 원화 환산(환율 근사)')
for (const [a, b, nm] of [['2000-01-01', '2003-06-30', '닷컴'], ['2007-06-01', '2009-12-31', '2008'], ['2018-06-01', '2019-06-30', '2018'], ['2020-01-01', '2020-12-31', '2020'], ['2021-06-01', '2023-12-31', '2022'], ['2024-12-01', '2025-12-31', '2025']]) {
  let pu = 0, pk = 0, mu = 0, mk = 0, du, dk
  for (const d of all) { if (d < a || d > b) continue; const u = QQQ.get(d), k = u * fx(d); pu = Math.max(pu, u); pk = Math.max(pk, k); if (u / pu - 1 < mu) { mu = u / pu - 1; du = d } if (k / pk - 1 < mk) { mk = k / pk - 1; dk = d } }
  console.log(`  ${nm}: 달러 ${pct(mu, 0)} (${du}), 원화 ${pct(mk, 0)} (${dk})`)
}
// 달러 기준 매수일의 원화 환산 QQQ 낙폭
console.log('\n[1b] 보고서 매수일(달러 기준)의 QQQ 낙폭을 원화로 환산')
{ let pu = 0, pk = 0; const ddU = new Map(), ddK = new Map(); for (const d of all) { const u = QQQ.get(d), k = u * fx(d); pu = Math.max(pu, u); pk = Math.max(pk, k); ddU.set(d, u / pu - 1); ddK.set(d, k / pk - 1) }
  for (const d of ['2000-12-21', '2001-04-04', '2002-07-24', '2008-02-06', '2008-10-27', '2009-02-03', '2018-12-24', '2020-03-16', '2022-06-16', '2022-12-28', '2025-04-08']) if (ddU.has(d)) console.log(`  ${d}: 달러 ${pct(ddU.get(d), 0)}, 원화 ${pct(ddK.get(d), 0)}, fx≈${Math.round(fx(d))}`) }
// 2. 점검 주기
console.log('\n[2] 점검 주기(매일/주 1회/월 1회)')
for (const s of SCEN) for (const check of ['daily', 'weekly', 'monthly']) { const r = sim(s.dates, s.assets, s.base, { check }); console.log(`  ${s.id} ${check}: 연 ${pct(r.cagr)} MDD ${pct(r.mdd)} 산 ${r.buys.length} 판 ${r.sells.length} 줄임 ${r.trims.length} | 매수 ${r.buys.map((e) => `${e.d}(${pct(e.qdd, 0)})`).join(' ')} | 줄임때 최고비중 ${r.trims.length ? pct(Math.max(...r.trims.map((e) => e.from)), 0) : '-'}`) }
// 2b. 신호가 유지된 날 수: 상한 이상인 날이 며칠이었나(달러 기준, 사지 않았다면 대신 실제 경로에서 '결정일 다음 날 비중')
console.log('\n[2b] 결정일 종가 비중과 체결일 비중(문턱을 다시 넘어간 경우)')
for (const s of SCEN) { const r = sim(s.dates, s.assets, s.base, {}); for (const e of r.events) { const i = r.series.findIndex((p) => p.d === e.d); const prev = r.series[i - 1]; if (e.type === 'buy' && !e.first) console.log(`  ${s.id} 2번 결정 ${prev.d} 현금 ${pct(prev.w.cash)} → 체결일 ${e.d} 직전 ${pct(e.from)}`); if (e.type === 'trim') console.log(`  ${s.id} 6번 결정 ${prev.d} ${e.key} ${pct(prev.w[e.key])} → 체결일 ${pct(e.from)}`) } }
// 3. 매도 차익 비율과 세금 (달러 차익 vs 원화 차익)
console.log('\n[3] 매도별 차익 비율(판 금액 대비): 달러 기준 / 원화 기준(환차익 포함), 세금 22%가 전체 자산에서 차지하는 몫')
for (const s of SCEN) { const r = sim(s.dates, s.assets, s.base, {}); for (const g of r.gains) console.log(`  ${s.id} ${g.d} ${g.key} ${g.why} 크기 ${pct(g.pctOfTotal, 0)} 차익비율 달러 ${pct(g.gainFrac, 0)} 원화 ${pct(g.gainFracKRW, 0)} → 세금(원화 차익×22%) 전체의 ${pct(g.pctOfTotal * Math.max(0, g.gainFracKRW) * 0.22, 2)}`) }
// 4. 처음 사기 전 구간: 현금 최저, 기간
console.log('\n[4] 처음 사기 전(1번 규칙 대기) 구간')
for (const s of SCEN) { const r = sim(s.dates, s.assets, s.base, {}); const pre = r.series.filter((p) => !p.stepped); const mn = pre.reduce((m, p) => (p.w.cash < m.w.cash ? p : m)); const mx = pre.reduce((m, p) => (p.w.cash > m.w.cash ? p : m)); console.log(`  ${s.id}: 대기 ${pre.length}거래일(${(pre.length / 252).toFixed(1)}년), 1번 발동 ${r.stepDay}, 대기 중 현금 최저 ${pct(mn.w.cash)}(${mn.d}) 최고 ${pct(mx.w.cash)}(${mx.d})`) }
