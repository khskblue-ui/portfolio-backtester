// QQQ 상한 실험: QQQ가 전체의 at 이상이면 to로 줄여 현금으로. 그 뒤 현금을 다시 단계로 나눠 쓸지(reset) 한 번에 쓸지(excess).
// 기본 규칙은 scripts/reserve/build-report.mjs와 같다. 세율 옵션은 평균 단가 기준 매도 차익에 부과(공제 없음).
// 사용: node scripts/reserve/qqq-cap.mjs [세율]   예) node scripts/reserve/qqq-cap.mjs 0.22
import fs from 'node:fs'
const ROOT = new URL('../../data-src/reserve', import.meta.url).pathname
const csv = (n) => new Map(fs.readFileSync(`${ROOT}/${n}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
const FLOOR = 0.1, FILL = 0.1, TRIM_AT = 0.2, TRIM_TO = 0.1, DD = [-0.15, -0.25, -0.35]
const pc = (x, d = 1) => `${(x * 100).toFixed(d)}%`

function sim(dates, assets, base, opt = {}) {
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => { // 평균 단가 기준 차익 과세
    const val = hold[a.key] * px(a, d), frac = amt / val, gain = amt - cost[a.key] * frac
    const tax = opt.tax ? Math.max(0, gain) * opt.tax : 0
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt }
  let peakV = 100, irx = 0, cashTarget = base.cash, lvCash = [0.3, 0.2, 0.1], used = 0, epLevel = 0
  let pendBuy = false, pendTrim = [], pendQ = false
  const V = [100], ev = [], cashW = [base.cash]
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), s = hold[key] * px(a, d) - TRIM_TO * T
      if (s > 0) { sell(a, s, d); ev.push({ d, type: 'trim', key }) }
    }
    pendTrim = []
    if (pendQ) {
      const a = assets.find((x) => x.key === 'qqq'), T = total(d), s = hold.qqq * px(a, d) - opt.qCap.to * T
      if (s > 0) {
        sell(a, s, d)
        if (opt.qCap.refill) for (const o of assets) if (o.key !== 'qqq') { const need = FILL * total(d) - hold[o.key] * px(o, d); if (need > 0) buyA(o, Math.min(need, cash - FLOOR * total(d)), d) }
        const T2 = total(d), c0 = cash / T2
        if (opt.qCap.mode === 'reset' && c0 > FLOOR + 0.03) { cashTarget = c0; lvCash = [FLOOR + ((c0 - FLOOR) * 2) / 3, FLOOR + (c0 - FLOOR) / 3, FLOOR]; used = 0 }
        ev.push({ d, type: 'qtrim', pct: s / T, cashAfter: c0 })
      }
      pendQ = false
    }
    if (pendBuy) {
      const T = total(d), buy = cash - cashTarget * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, FILL * T - hold[a.key] * px(a, d))))
        const others = sf.reduce((x, y) => x + y, 0), k = others > buy ? buy / others : 1
        const q = buy - Math.min(others, buy)
        assets.forEach((a, j) => buyA(a, a.key === 'qqq' ? q : sf[j] * k, d))
        ev.push({ d, type: 'buy', pct: buy / T })
      }
      pendBuy = false
    }
    if (opt.goldRefill && d.slice(0, 4) !== prev.slice(0, 4)) for (const o of assets) if (o.key !== 'qqq') { const T = total(d), need = FILL * T - hold[o.key] * px(o, d); if (need > 0.005 * T) buyA(o, Math.max(0, Math.min(need, cash - FLOOR * T)), d) }
    const T = total(d)
    if (T > peakV) { peakV = T; epLevel = 0 }
    const dd = T / peakV - 1
    if (!opt.noBuy) {
      let lv = 0
      while (lv < 3 && dd <= DD[lv]) lv++
      if (lv > epLevel) {
        epLevel = lv
        const tgt = Math.max(used, lv)
        if (tgt > used) { used = tgt; cashTarget = Math.min(cashTarget, lvCash[tgt - 1]) }
        pendBuy = true
      }
    }
    for (const a of assets) if (a.key !== 'qqq' && (hold[a.key] * px(a, d)) / T >= TRIM_AT) pendTrim.push(a.key)
    if (opt.qCap && (hold.qqq * QQQ.get(d)) / T >= opt.qCap.at) pendQ = true
    V.push(T); cashW.push(cash / T)
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  let pk = 0, mdd = 0
  const win = {}
  for (const [name, a, b] of opt.windows ?? []) { let p = 0, m = 0; dates.forEach((d, i) => { if (d >= a && d <= b) { p = Math.max(p, V[i]); m = Math.min(m, V[i] / p - 1) } }); win[name] = m }
  for (const v of V) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1) }
  const T = total(dates.at(-1)), d = dates.at(-1)
  return { cagr: (T / 100) ** (1 / yrs) - 1, mdd, win, ev, avgCash: cashW.reduce((x, y) => x + y, 0) / cashW.length, taxPaid, w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T } }
}

const A = { qqq: { key: 'qqq', px: QQQ }, gold: { key: 'gold', px: GLD }, btc: { key: 'btc', px: BTC } }
const SCEN = [
  ['2014~ QQQ40·금10·BTC10·현금40', '2014-09-17', [A.qqq, A.gold, A.btc], { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, [['2020', '2020-01-01', '2020-12-31'], ['2022', '2021-11-01', '2022-12-31'], ['2025', '2025-01-01', '2025-12-31']]],
  ['2004~ QQQ45·금10·현금45', '2004-11-18', [A.qqq, A.gold], { qqq: 0.45, gold: 0.1, cash: 0.45 }, [['2008', '2007-10-01', '2009-12-31'], ['2020', '2020-01-01', '2020-12-31'], ['2022', '2021-11-01', '2022-12-31']]],
  ['1999~ QQQ50·현금50', '1999-03-10', [A.qqq], { qqq: 0.5, cash: 0.5 }, [['닷컴', '1999-03-10', '2003-12-31'], ['2008', '2007-10-01', '2009-12-31'], ['2022', '2021-11-01', '2022-12-31']]],
]
const CASES = [
  ['지금 규칙(상한 없음)', {}],
  ['QQQ 70→60 · 다시 3단계', { qCap: { at: 0.7, to: 0.6, mode: 'reset' } }],
  ['QQQ 75→65 · 다시 3단계', { qCap: { at: 0.75, to: 0.65, mode: 'reset' } }],
  ['QQQ 80→70 · 다시 3단계', { qCap: { at: 0.8, to: 0.7, mode: 'reset' } }],
  ['QQQ 80→60 · 다시 3단계', { qCap: { at: 0.8, to: 0.6, mode: 'reset' } }],
  ['QQQ 85→70 · 다시 3단계', { qCap: { at: 0.85, to: 0.7, mode: 'reset' } }],
  ['QQQ 80→60 · 한 번에(-15%)', { qCap: { at: 0.8, to: 0.6, mode: 'excess' } }],
  ['QQQ 80→60 · 3단계 · 금 보충', { qCap: { at: 0.8, to: 0.6, mode: 'reset', refill: true } }],
  ['상한 없음 · 매년 금·코인 10% 보충', { goldRefill: true }],
]
const taxArg = process.argv[2] ? +process.argv[2] : 0
for (const [title, start, assets, base, windows] of SCEN) {
  const dates = [...QQQ.keys()].sort().filter((d) => d >= start && assets.every((a) => a.px.has(d)))
  console.log(`\n=== ${title} (${dates[0]}~${dates.at(-1)})${taxArg ? ` · 매도 차익 세율 ${pc(taxArg, 0)}` : ''}`)
  for (const [label, opt] of CASES) {
    const r = sim(dates, assets, base, { ...opt, windows, tax: taxArg })
    const qt = r.ev.filter((e) => e.type === 'qtrim'), b = r.ev.filter((e) => e.type === 'buy')
    console.log(`${label.padEnd(26)} 연 ${pc(r.cagr)} · MDD ${pc(r.mdd)} · ${Object.entries(r.win).map(([k, v]) => `${k} ${pc(v, 0)}`).join(' ')} · QQQ줄이기 ${qt.length}회${qt.length ? `(${qt.map((e) => e.d.slice(0, 7)).join(',')})` : ''} · 투입 ${b.length}회 · 평균현금 ${pc(r.avgCash, 0)} · 끝 ${Object.entries(r.w).map(([k, v]) => `${k} ${pc(v, 0)}`).join(' ')}${taxArg ? ` · 세금 ${r.taxPaid.toFixed(0)}` : ''}`)
  }
}
