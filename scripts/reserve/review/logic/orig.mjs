import fs from 'node:fs'; import path from 'node:path'
const ROOT='/home/user/portfolio-backtester'
const csv = (name) => new Map(fs.readFileSync(path.join(ROOT, 'data-src/reserve', `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
const RULE = {
  startCash: 0.4, // 지금의 현금 비중
  firstDd: -0.2, // 첫 투입: QQQ가 최고가에서 이만큼 내리면
  target: 0.3, // 기준 현금 비중
  upper: 0.4, // 현금 상한: 닿으면 기준까지 써서 산다
  lower: 0.2, lowerTo: 0.3, // 현금 하한: 닿으면 QQQ를 팔아 lowerTo(기준)까지 채운다
  fillTo: 0.1, // 살 때 금과 암호화폐를 채우는 비중
  trimAt: 0.2, trimTo: 0.1, // 금, 암호화폐 상한과 줄인 뒤 비중
  taxRate: 0.22, // 세금 반영 계산에 쓰는 매도 차익 세율
}
function sim(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, lowerTo: RULE.lowerTo, upper: RULE.upper, fill: true, trim: true, contrib: 0, tax: 0, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => { // 평균 단가 기준 차익에 과세(공제와 손익 합산 없음)
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
        events.push({ d, type: 'buy', first: pendBuy === 'first', pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      }
      pendBuy = null
    }
    nav *= total(d) / lastPost // 새 돈이 들어오기 전 값으로 하루 수익을 잰다
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? RULE.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) { // 현금이 기준 이상이면 기준보다 가장 모자란 자산을 산다
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
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  for (const s of series) { if (s.V > pk) { pk = s.V; pkDay = s.d } if (s.V / pk - 1 < mdd) { mdd = s.V / pk - 1; mddDay = s.d; mddPeak = pkDay } }
  const rec = series.find((s) => s.d > mddDay && s.V >= series.find((x) => x.d === mddPeak).V)?.d ?? null
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell')
  const firstDay = buys[0]?.d ?? null, after = firstDay ? series.filter((s) => s.d > firstDay) : []
  return { series, events, buys, sells, trims: events.filter((e) => e.type === 'trim'), cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, mddDay, rec, final: last, firstBuy: firstDay, stepDay, yrs, taxPaid, avgCash: series.reduce((x, s) => x + s.w.cash, 0) / series.length, minCashAfter: after.length ? Math.min(...after.map((s) => s.w.cash)) : null }
}
const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
export { sim, RULE, QQQ, GLD, BTC, IRX, A_QQQ, A_GOLD, A_BTC }
