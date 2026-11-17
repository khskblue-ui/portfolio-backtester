import { sim2, pct, allDates, scenFor, QQQ, athBefore } from './sim2.mjs'
// 매달 첫 거래일을 시작일로
const starts = []; let pm = ''
for (const d of allDates) { if (d.slice(0, 7) !== pm && d >= '1999-03-10' && d <= '2025-10-31') starts.push(d); pm = d.slice(0, 7) }
const yrs = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25
const rows = []
for (const st of starts) {
  const { assets, base, dates } = scenFor(st)
  const r = sim2(dates, assets, base, {})
  const stepIdx = r.stepDay ? r.series.findIndex((p) => p.d === r.stepDay) : -1
  const pre = stepIdx >= 0 ? r.series.slice(0, stepIdx + 1) : r.series
  const cashAtStep = stepIdx >= 0 ? r.series[stepIdx].w.cash : null
  const ev = r.events
  const first = ev.find((e) => e.type === 'buy' && e.first)
  const afterStep = ev.filter((e) => r.stepDay && e.d > r.stepDay && e.type !== 'trim' && e.type !== 'firstnobuy')
  const dipSell = r.sells.filter((e) => e.qdd <= -0.15)
  const highBuy = r.buys.filter((e) => !e.first && e.qdd > -0.10)
  rows.push({ st, n: assets.length, wait: r.stepDay ? yrs(st, r.stepDay) : null, noStepYrs: r.stepDay ? null : yrs(st, dates.at(-1)), cashAtStep, preMin: Math.min(...pre.map((p) => p.w.cash)), preMax: Math.max(...pre.map((p) => p.w.cash)), firstPct: first?.pct ?? 0, firstNoBuy: !!ev.find((e) => e.type === 'firstnobuy'), dipSell, highBuy, r, firstAfter: afterStep[0] })
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const stepped = rows.filter((x) => x.wait != null)
console.log('시작일 수', rows.length, '1번이 걸린 시작일', stepped.length, '끝까지 안 걸림', rows.length - stepped.length)
console.log('1번까지 기다린 햇수 중앙/75%/90%/최대', [0.5, 0.75, 0.9, 0.999].map((p) => q(stepped.map((x) => x.wait), p).toFixed(1)).join(' / '))
console.log('1번이 걸린 날 현금 비중 10%/중앙/90%/최소/최대', [0.1, 0.5, 0.9].map((p) => pct(q(stepped.map((x) => x.cashAtStep), p))).join(' / '), pct(Math.min(...stepped.map((x) => x.cashAtStep))), pct(Math.max(...stepped.map((x) => x.cashAtStep))))
console.log('1번이 걸렸지만 아무것도 사지 않음(현금<=30.5%):', stepped.filter((x) => x.firstNoBuy).length, '/', stepped.length)
console.log('  그 가운데 1번이 걸린 날 현금 20% 이하:', stepped.filter((x) => x.cashAtStep <= 0.2).length)
console.log('1번 전 현금 최저가 20% 이하였던 시작일:', rows.filter((x) => x.preMin <= 0.2).length, ' 15% 이하:', rows.filter((x) => x.preMin <= 0.15).length, ' 최저', pct(Math.min(...rows.map((x) => x.preMin))))
console.log('1번 전 현금 최고가 50% 이상이었던 시작일:', rows.filter((x) => x.preMax >= 0.5).length, ' 최고', pct(Math.max(...rows.map((x) => x.preMax))))
console.log('1번 매수 크기(전체 대비) 10%p 초과:', stepped.filter((x) => x.firstPct > 0.105).length, ' 20%p 초과:', stepped.filter((x) => x.firstPct > 0.2).length, ' 최대', pct(Math.max(...stepped.map((x) => x.firstPct))))
const ds = rows.filter((x) => x.dipSell.length)
console.log('QQQ 낙폭 -15% 이하에서 3번으로 QQQ를 판 시작일:', ds.length)
const firstSell = stepped.filter((x) => x.firstAfter?.type === 'sell' && x.firstNoBuy)
console.log('1번이 걸린 뒤 첫 행동이 QQQ 매도(매수 없이):', firstSell.length, ' 그 매도가 1번 걸린 뒤 10거래일 안:', firstSell.filter((x) => { const i = x.r.series.findIndex((p) => p.d === x.r.stepDay), j = x.r.series.findIndex((p) => p.d === x.firstAfter.d); return j - i <= 10 }).length)
const uniq = new Map(); for (const x of ds) for (const e of x.dipSell) { const k = e.d; if (!uniq.has(k)) uniq.set(k, { e, n: 0, ex: x.st }); uniq.get(k).n++ }
console.log('  낙폭 중 매도 날짜(고유):'); for (const [d, v] of [...uniq].sort()) console.log('   ', d, 'qdd', pct(v.e.qdd), '판 크기', pct(v.e.pct), '현금', pct(v.e.from), '시작일 수', v.n, '예', v.ex)
const hb = rows.filter((x) => x.highBuy.length)
console.log('2번 매수인데 QQQ 낙폭이 -10%보다 얕은 경우가 있는 시작일:', hb.length)
const u2 = new Map(); for (const x of hb) for (const e of x.highBuy) { if (!u2.has(e.d)) u2.set(e.d, { e, n: 0, ex: x.st }); u2.get(e.d).n++ }
for (const [d, v] of [...u2].sort()) console.log('   ', d, 'qdd', pct(v.e.qdd), '산 크기', pct(v.e.pct), '현금', pct(v.e.from), JSON.stringify(Object.fromEntries(Object.entries(v.e.parts).map(([k, w]) => [k, +(w * 100).toFixed(1)]))), '시작일 수', v.n, '예', v.ex)
// 끝까지 1번이 안 걸린 시작일
const ns = rows.filter((x) => x.wait == null)
console.log('끝까지 1번 안 걸린 시작일 범위', ns[0]?.st, '~', ns.at(-1)?.st, '수', ns.length)
// 구체 사례
for (const st of ['2009-04-01', '2010-01-04', '2012-01-03', '2003-04-01', '2016-01-04', '2023-01-03']) {
  const x = rows.find((y) => y.st.slice(0, 7) === st.slice(0, 7)); if (!x) continue
  console.log(`\n-- 시작 ${x.st} 자산 ${x.n}개: 1번 ${x.r.stepDay} (기다림 ${x.wait?.toFixed(1)}년), 그날 현금 ${pct(x.cashAtStep)}, 1번 전 현금 ${pct(x.preMin)}~${pct(x.preMax)}`)
  for (const e of x.r.events.filter((e) => !x.r.stepDay || e.d >= x.r.stepDay).slice(0, 5)) console.log('   ', e.d, e.type, e.kind ?? e.key ?? '', 'pct', pct(e.pct), 'cash', pct(e.from ?? e.cashFrom), '->', pct(e.to ?? e.cashTo), 'qdd', pct(e.qdd))
}
