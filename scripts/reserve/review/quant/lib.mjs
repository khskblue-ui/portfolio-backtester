// 리뷰용 실험 라이브러리. 저장소의 build-report.mjs sim()을 그대로 옮긴 simRef와, 일반화한 simG.
import fs from 'node:fs'
const DATA = '/home/user/portfolio-backtester/data-src/reserve'
const csv = (name) => new Map(fs.readFileSync(`${DATA}/${name}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
export const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
export const RULE = { startCash: 0.4, firstDd: -0.2, target: 0.3, upper: 0.4, lower: 0.2, lowerTo: 0.3, fillTo: 0.1, trimAt: 0.2, trimTo: 0.1, taxRate: 0.22 }
export const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
export const ALLQ = [...QQQ.keys()].sort()
export const datesFor = (assets, start, end = '9999') => ALLQ.filter((d) => d >= start && d <= end && assets.every((a) => a.px.has(d)))
export const SCEN = [
  { id: 's2014', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, tgt: { qqq: 0.5, gold: 0.1, btc: 0.1, cash: 0.3 } },
  { id: 's2004', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.5, gold: 0.1, cash: 0.4 }, tgt: { qqq: 0.6, gold: 0.1, cash: 0.3 } },
  { id: 's1999', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.6, cash: 0.4 }, tgt: { qqq: 0.7, cash: 0.3 } },
]
for (const s of SCEN) s.dates = datesFor(s.assets, s.start)

// ── 원본 그대로 ──
export function simRef(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, lowerTo: RULE.lowerTo, upper: RULE.upper, fill: true, trim: true, contrib: 0, tax: 0, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => {
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  let peakQ = QQQ.get(dates[0]), irx = 0, stepped = false, nav = 100, lastPost = 100
  let pendBuy = null, pendSell = false, pendTrim = [], stepDay = null
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7)
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d), s = cur - RULE.trimTo * T
      if (s > 0) { const cashFrom = cash / T; sell(a, s, d); events.push({ d, type: 'trim', key, from: cur / T, pct: s / T, cashFrom, cashTo: cash / total(d) }) }
    }
    pendTrim = []
    if (pendSell) {
      const T = total(d), from = cash / T, need = o.lowerTo * T - cash
      if (need > 0.005 * T && hold.qqq * px(qA, d) > need) { sell(qA, need, d); events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d) }) }
      pendSell = false
    }
    if (pendBuy) {
      const T = total(d), from = cash / T, buy = cash - RULE.target * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' || !o.fill ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d))
        events.push({ d, type: 'buy', first: pendBuy === 'first', pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1 })
      }
      pendBuy = null
    }
    nav *= total(d) / lastPost
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? RULE.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) {
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * RULE.fillTo : RULE.fillTo) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.rule) {
      if (!stepped) { if (qdd <= RULE.firstDd) { stepped = true; stepDay = d; pendBuy = 'first' } }
      else if (cw >= o.upper) pendBuy = 'upper'
      else if (o.lower && cw <= RULE.lower) pendSell = true
    }
    if (o.trim) for (const a of others) if ((hold[a.key] * px(a, d)) / T >= RULE.trimAt) pendTrim.push(a.key)
    series.push({ d, V: nav, qdd, w: weights(d, T) })
  }
  return finish(dates, series, events)
}

// ── 일반화 ──
// mode: 'plan' | 'hold' | 'fixed'(freq 'Y'|'M'|'D'|'Q') | 'band'(weights 기준 절대 편차 band, bandOn 'any'|'cash')
export function simG(dates, assets, base, opt = {}) {
  const o = { mode: 'plan', ...RULE, useLower: true, fill: true, trim: true, lag: 1, cost: 0, costBy: {}, tax: 0, contrib: 0, peak: 'start', stepped0: false, preUpper: false, weights: null, freq: 'Y', band: 0.05, bandOn: 'any', sellAll: false, liquidate: false, capInFixed: false, firstBy: null, contribAbs: 0, contribGrow: 0, month: 1, ...opt }
  const px = (a, d) => a.px.get(d)
  const cst = (a) => o.costBy[a.key] ?? o.cost
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0, costPaid = 0, turnover = 0, turnRel = 0, gainRel = 0, taxSales = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => {
    if (amt <= 0) return
    { const T0 = total(d), g = Math.max(0, amt - cost[a.key] * (amt / (hold[a.key] * px(a, d)))); turnRel += amt / T0; gainRel += g / T0; if (g > 0) taxSales++ }
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax, c = amt * cst(a)
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax - c; taxPaid += tax; costPaid += c; turnover += amt
  }
  const buyA = (a, amt, d) => { if (amt > 0) { turnRel += amt / total(d); const c = amt * cst(a); hold[a.key] += (amt - c) / px(a, d); cost[a.key] += amt; cash -= amt; costPaid += c; turnover += amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  let peakQ = QQQ.get(dates[0])
  if (o.peak === 'ath') for (const d of ALLQ) { if (d > dates[0]) break; peakQ = Math.max(peakQ, QQQ.get(d)) }
  let irx = 0, stepped = o.stepped0, nav = 100, lastPost = 100, stepDay = null
  const pend = [] // { type, due, key }
  const has = (type, key) => pend.some((p) => p.type === type && p.key === key)
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  const rebalance = (d) => {
    const T = total(d), W = o.weights
    for (const a of assets) { const diff = hold[a.key] * px(a, d) - W[a.key] * T; if (diff > 0) sell(a, diff, d) }
    const T2 = total(d), needs = assets.map((a) => Math.max(0, W[a.key] * T2 - hold[a.key] * px(a, d))), sum = needs.reduce((x, y) => x + y, 0)
    const avail = Math.max(0, cash - W.cash * T2), k = sum > avail ? avail / sum : 1
    assets.forEach((a, j) => buyA(a, needs[j] * k, d))
    events.push({ d, type: 'rebal' })
  }
  const exec = (p, d) => {
    if (p.type === 'trim') {
      const a = assets.find((x) => x.key === p.key), T = total(d), cur = hold[p.key] * px(a, d), s = cur - o.trimTo * T
      if (s > 0) { const cashFrom = cash / T; sell(a, s, d); events.push({ d, type: 'trim', key: p.key, from: cur / T, pct: s / T, cashFrom, cashTo: cash / total(d) }) }
    } else if (p.type === 'sell') {
      const T = total(d), from = cash / T, need = o.lowerTo * T - cash
      if (need > 0.005 * T && hold.qqq * px(qA, d) > need) {
        if (o.sellAll) { // 기준 비중을 넘는 자산에서 넘는 만큼 비례해 판다
          const tg = (a) => (a.key === 'qqq' ? 1 - o.target - others.length * o.fillTo : o.fillTo)
          const ex = assets.map((a) => Math.max(0, hold[a.key] * px(a, d) - tg(a) * T)), sm = ex.reduce((x, y) => x + y, 0)
          assets.forEach((a, j) => sell(a, Math.min(ex[j], (need * ex[j]) / sm), d))
        } else sell(qA, need, d)
        events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d) })
      }
    } else if (p.type === 'buy') {
      const T = total(d), from = cash / T, buy = cash - (p.to ?? o.target) * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' || !o.fill ? 0 : Math.max(0, o.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d))
        events.push({ d, type: 'buy', first: p.first, pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1 })
      }
    } else if (p.type === 'rebal') rebalance(d)
  }
  const order = { trim: 0, sell: 1, buy: 2, rebal: 3 }
  const runDue = (i, d) => {
    const due = pend.filter((p) => p.due <= i).sort((a, b) => order[a.type] - order[b.type])
    for (const p of due) { exec(p, d); pend.splice(pend.indexOf(p), 1) }
  }
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7), newYear = d.slice(0, 4) !== prev.slice(0, 4)
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    runDue(i, d)
    nav *= total(d) / lastPost
    if ((o.contrib || o.contribAbs) && newMonth) {
      const T = total(d), amt = o.contribAbs ? (o.contribAbs * 100 / 12) * (1 + o.contribGrow) ** ((Date.parse(d) - Date.parse(dates[0])) / 864e5 / 365.25) : (o.contrib / 12) * T, tgtCash = stepped ? o.target : base.cash
      cash += amt
      if (o.mode === 'plan' && cash - amt >= tgtCash * T) {
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * o.fillTo : o.fillTo) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.mode === 'plan') {
      if (!stepped) {
        if (qdd <= o.firstDd || (o.firstBy != null && (Date.parse(d) - Date.parse(dates[0])) / 864e5 >= o.firstBy)) { stepped = true; stepDay = d; pend.push({ type: 'buy', due: i + o.lag, first: true }) }
        else if (o.preUpper && cw >= o.preUpper && !has('buy')) pend.push({ type: 'buy', due: i + o.lag, to: o.preTo ?? o.target })
      } else if (cw >= o.upper) { if (!has('buy')) pend.push({ type: 'buy', due: i + o.lag }) }
      else if (o.useLower && cw <= o.lower) { if (!has('sell')) pend.push({ type: 'sell', due: i + o.lag }) }
    } else if (o.mode === 'fixed') {
      const due = o.freq === 'D' || (o.freq === 'M' && newMonth) || (o.freq === 'Y' && newMonth && +d.slice(5, 7) === o.month) || (o.freq === 'Q' && newMonth && ['01', '04', '07', '10'].includes(d.slice(5, 7)))
      if (due) pend.push({ type: 'rebal', due: i + o.lag })
    } else if (o.mode === 'band') {
      const w = weights(d, T)
      const capHit = o.bandOn === 'cash+cap' && others.some((a) => w[a.key] >= o.trimAt)
      const dev = capHit ? 1 : o.bandOn !== 'any' ? Math.abs(w.cash - o.weights.cash) : Math.max(...Object.keys(o.weights).map((k) => Math.abs(w[k] - o.weights[k])))
      if (dev >= o.band - 1e-12 && !has('rebal')) pend.push({ type: 'rebal', due: i + o.lag })
    }
    if (o.trim && ((o.mode !== 'fixed' && o.mode !== 'band') || o.capInFixed)) for (const a of others) if ((hold[a.key] * px(a, d)) / T >= o.trimAt && !has('trim', a.key)) pend.push({ type: 'trim', due: i + o.lag, key: a.key })
    if (o.lag === 0) runDue(i, d)
    series.push({ d, V: nav, qdd, w: weights(d, total(d)) })
  }
  const r = finish(dates, series, events)
  r.taxPaid = taxPaid; r.costPaid = costPaid; r.turnover = turnover; r.stepDay = stepDay; r.turnRel = turnRel / r.yrs; r.gainRel = gainRel / r.yrs; r.taxSales = taxSales
  // 기간 끝에 전부 팔았다고 볼 때의 세금(미실현 차익 × 세율)
  const dl = dates.at(-1), Tl = total(dl)
  r.endTotal = Tl
  r.embedded = assets.reduce((s, a) => s + Math.max(0, hold[a.key] * px(a, dl) - cost[a.key]), 0)
  r.embFrac = r.embedded / Tl
  r.cagrLiq = ((r.final.V * (1 - (r.embedded * (o.liqTax ?? o.tax)) / Tl)) / 100) ** (1 / r.yrs) - 1
  return r
}

const cashIdx = (dates) => { let c = 1, irx = 0; const out = [1]; for (let i = 1; i < dates.length; i++) { if (IRX.has(dates[i - 1])) irx = IRX.get(dates[i - 1]); c *= 1 + (irx / 100) * ((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5 / 365); out.push(c) } return out }
export function finish(dates, series, events) {
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  let uwStart = dates[0], maxUw = 0, ulcer = 0
  for (const s of series) {
    if (s.V > pk) { pk = s.V; pkDay = s.d; uwStart = s.d }
    else maxUw = Math.max(maxUw, (Date.parse(s.d) - Date.parse(uwStart)) / 864e5 / 365.25)
    const dd = s.V / pk - 1; ulcer += dd * dd
    if (dd < mdd) { mdd = dd; mddDay = s.d; mddPeak = pkDay }
  }
  const ci = cashIdx(dates)
  const rets = [], ex = []
  for (let i = 1; i < series.length; i++) { const r = series[i].V / series[i - 1].V - 1; rets.push(r); ex.push(r - (ci[i] / ci[i - 1] - 1)) }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) }
  const ppy = rets.length / yrs
  const vol = sd(rets) * Math.sqrt(ppy), sharpe = (mean(ex) * ppy) / vol
  const downs = ex.filter((x) => x < 0), sortino = (mean(ex) * ppy) / (Math.sqrt(downs.reduce((x, y) => x + y * y, 0) / ex.length) * Math.sqrt(ppy))
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell'), trims = events.filter((e) => e.type === 'trim')
  const cagr = (last.V / 100) ** (1 / yrs) - 1
  const cashCagr = ci.at(-1) ** (1 / yrs) - 1
  return { series, events, buys, sells, trims, rebals: events.filter((e) => e.type === 'rebal'), cagr, mdd, mddDay, mddPeak, maxUw, ulcer: Math.sqrt(ulcer / series.length), vol, sharpe, sortino, calmar: cagr / -mdd, final: last, yrs, rets, cashCagr,
    avgCash: series.reduce((x, s) => x + s.w.cash, 0) / series.length, avgW: Object.fromEntries(Object.keys(last.w).map((k) => [k, series.reduce((x, s) => x + (s.w[k] ?? 0), 0) / series.length])) }
}
export const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '   n/a' : `${(x * 100).toFixed(d)}%`.padStart(7))
export const row = (label, r, extra = '') => `${label.padEnd(44)} CAGR ${pct(r.cagr)} vol ${pct(r.vol)} Sh ${r.sharpe.toFixed(2)} MDD ${pct(r.mdd)} UW ${r.maxUw.toFixed(1).padStart(4)}y ulcer ${pct(r.ulcer)} cash ${pct(r.avgCash, 0)} ${extra}`
