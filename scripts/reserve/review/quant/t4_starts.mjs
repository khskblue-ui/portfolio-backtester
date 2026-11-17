import { SCEN, simG, pct, datesFor, QQQ, ALLQ } from './lib.mjs'
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
const dist = (arr, d = 1) => `min ${pct(q(arr, 0), d)} p10 ${pct(q(arr, 0.1), d)} p25 ${pct(q(arr, 0.25), d)} med ${pct(q(arr, 0.5), d)} p75 ${pct(q(arr, 0.75), d)} p90 ${pct(q(arr, 0.9), d)} max ${pct(q(arr, 1), d)} | >0: ${arr.filter((x) => x > 0).length}/${arr.length}`
function sweep(s, { horizon = null, minYears = 5, peak = 'ath' } = {}) {
  const all = s.dates, starts = all.filter((d, i) => i === 0 || d.slice(0, 7) !== all[i - 1].slice(0, 7))
  const rows = []
  for (const st of starts) {
    let end = '9999'
    if (horizon) { end = `${+st.slice(0, 4) + horizon}${st.slice(4)}`; if (end > all.at(-1)) continue }
    const dates = all.filter((d) => d >= st && d <= end)
    const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
    if (yrs < minYears) continue
    const plan = simG(dates, s.assets, s.base, { peak }), hold = simG(dates, s.assets, s.base, { mode: 'hold' })
    const fix = simG(dates, s.assets, s.tgt, { mode: 'fixed', weights: s.tgt, freq: 'Y' }), now = simG(dates, s.assets, s.tgt, { stepped0: true })
    const fix40 = simG(dates, s.assets, s.base, { mode: 'fixed', weights: s.base, freq: 'Y' })
    rows.push({ st, plan, hold, fix, now, fix40 })
  }
  return rows
}
for (const [label, opt] of [['끝을 2026-10으로 고정(5년 이상)', {}], ['10년 창', { horizon: 10 }], ['5년 창', { horizon: 5 }]]) {
  console.log(`\n===== ${label} — 최고가는 자료상 역대 최고(1999-03 이후)`)
  for (const s of SCEN) {
    const rows = sweep(s, opt)
    if (!rows.length) { console.log(s.id, '표본 없음'); continue }
    console.log(`${s.id} 시작일 ${rows.length}개 (${rows[0].st}~${rows.at(-1).st})`)
    const d = (a, b, k) => rows.map((r) => r[a][k] - r[b][k])
    console.log('  규칙−그냥둠 CAGR  ', dist(d('plan', 'hold', 'cagr')))
    console.log('  규칙−그냥둠 Sharpe', dist(d('plan', 'hold', 'sharpe').map((x) => x / 100), 0).replaceAll('%', ''))
    console.log('  규칙−그냥둠 MDD   ', dist(d('plan', 'hold', 'mdd')), '(양수면 규칙이 얕음)')
    console.log('  규칙−연1회고정 CAGR ', dist(d('plan', 'fix', 'cagr')))
    console.log('  규칙−연1회고정 Sharpe', dist(d('plan', 'fix', 'sharpe').map((x) => x / 100), 0).replaceAll('%', ''))
    console.log('  규칙−연1회고정 MDD  ', dist(d('plan', 'fix', 'mdd')))
    console.log('  규칙−바로30(2~6만) CAGR', dist(d('plan', 'now', 'cagr')))
    console.log('  규칙−바로30(2~6만) MDD ', dist(d('plan', 'now', 'mdd')))
    console.log('  규칙−현금40고정 CAGR', dist(d('plan', 'fix40', 'cagr')), ' Sharpe차 med', q(d('plan', 'fix40', 'sharpe'), 0.5).toFixed(2))
    const nb = rows.map((r) => r.plan.buys.length), ns = rows.map((r) => r.plan.sells.length)
    console.log(`  산 횟수 med ${q(nb, 0.5)} (0번 ${nb.filter((x) => x === 0).length}개), 판 횟수 med ${q(ns, 0.5)}`)
  }
}
// 보고서 방식(시작 뒤 최고가)과의 차이: 세 구간
console.log('\n===== 최고가 기준: 시작 뒤 최고가(보고서) vs 역대 최고가(규칙 문구)')
for (const s of SCEN) {
  const a = simG(s.dates, s.assets, s.base, {}), b = simG(s.dates, s.assets, s.base, { peak: 'ath' })
  console.log(s.id, `보고서 ${pct(a.cagr)}/${pct(a.mdd)} 첫매수 ${a.buys[0]?.d} | 역대최고 ${pct(b.cagr)}/${pct(b.mdd)} 첫매수 ${b.buys[0]?.d} b${b.buys.length}s${b.sells.length}`)
}
