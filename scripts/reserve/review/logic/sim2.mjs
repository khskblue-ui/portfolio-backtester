// 원본 sim을 옮기고 실험용 스위치를 붙인 판. 스위치를 모두 끄면 원본과 같은 결과가 나와야 한다(verify.mjs).
import { RULE, QQQ, GLD, BTC, IRX, A_QQQ, A_GOLD, A_BTC } from './orig.mjs'
export { RULE, QQQ, GLD, BTC, IRX, A_QQQ, A_GOLD, A_BTC }
export function sim2(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, lowerTo: RULE.lowerTo, upper: RULE.upper, fill: true, trim: true, contrib: 0, tax: 0,
    preLower: false,      // 1번 전에도 현금 하한 적용
    preBand: null,        // 1번 전 { upper, target, lower } 띠
    peak0: null,          // 시작 시점의 역대 최고가(없으면 시작일 종가)
    sellMode: 'qqq',      // 'qqq' | 'over'(기준 초과분 비례)
    refillOnSell: false,  // 3번으로 팔 때 금, 암호화폐도 10%까지 채움
    contribText: false,   // 5번을 글대로(항상 30%, 기준 비중)
    sizeAtDecision: false,// 주문 크기를 판단일 종가 비중으로 정함
    upperNeedsDd: null,   // 2번은 QQQ 낙폭이 이 값 이하일 때만
    lowerPauseDd: null,   // QQQ 낙폭이 이 값 이하면 3번을 미룸
    irxConst: null, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => { const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax; hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  const baseW = (a, tgtCash) => (a.key === 'qqq' ? 1 - tgtCash - others.length * RULE.fillTo : RULE.fillTo)
  let peakQ = o.peak0 ?? px(qA, dates[0]), irx = 0, stepped = false, nav = 100, lastPost = 100
  let pendBuy = null, pendSell = null, pendTrim = [], stepDay = null
  const series = [{ d: dates[0], V: 100, qdd: px(qA, dates[0]) / peakQ - 1, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  let turnover = 0
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7)
    if (o.irxConst != null) irx = o.irxConst; else if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const pt of pendTrim) {
      const key = pt.key, a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d)
      const s = o.sizeAtDecision ? Math.min(cur, pt.frac * T) : cur - RULE.trimTo * T
      if (s > 0) { const cashFrom = cash / T; sell(a, s, d); turnover += s / T; events.push({ d, type: 'trim', key, from: cur / T, pct: s / T, cashFrom, cashTo: cash / total(d), qdd: px(qA, d) / peakQ - 1, stepped }) }
    }
    pendTrim = []
    if (pendSell) {
      const T = total(d), from = cash / T, to = pendSell.to
      let need = o.sizeAtDecision ? pendSell.frac * T : to * T - cash
      if (need > 0.005 * T) {
        let extra = 0, sf = []
        if (o.refillOnSell) { sf = others.map((a) => Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))); extra = sf.reduce((x, y) => x + y, 0) }
        if (o.sellMode === 'qqq') {
          if (hold.qqq * px(qA, d) > need + extra) {
            sell(qA, need + extra, d); others.forEach((a, j) => buyA(a, sf[j] ?? 0, d)); turnover += (need + extra * 2) / T
            events.push({ d, type: 'sell', pct: need / T, extra: extra / T, from, to: cash / total(d), qdd: px(qA, d) / peakQ - 1, w: weights(d, total(d)), pre: pendSell.pre })
          } else events.push({ d, type: 'sellfail', pct: need / T, from })
        } else if (o.sellMode === 'trimfirst') { // 금, 암호화폐가 trimFirstAt 이상이면 그것부터 10%까지, 모자라면 QQQ
          let left = need; const parts = {}
          for (const a of others) { const cur = hold[a.key] * px(a, d); if (cur / T >= (o.trimFirstAt ?? 0.15) && left > 0) { const s = Math.min(left, cur - RULE.trimTo * T); sell(a, s, d); parts[a.key] = s / T; left -= s } }
          if (left > 0.0001 * T && hold.qqq * px(qA, d) > left) { sell(qA, left, d); parts.qqq = left / T }
          turnover += need / T; events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d), qdd: px(qA, d) / peakQ - 1, parts })
        } else { // 기준 초과분 비례
          const tc = to, ex = assets.map((a) => Math.max(0, hold[a.key] * px(a, d) - baseW(a, tc) * T)), sum = ex.reduce((x, y) => x + y, 0)
          if (sum > 0) { const k = Math.min(1, need / sum); assets.forEach((a, j) => { if (ex[j] > 0) sell(a, ex[j] * k, d) }); turnover += need / T; events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d), qdd: px(qA, d) / peakQ - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, ex[j] * k / T])) }) }
        }
      }
      pendSell = null
    }
    if (pendBuy) {
      const T = total(d), from = cash / T, tgt = pendBuy.to
      const buy = o.sizeAtDecision ? Math.min(cash, pendBuy.frac * T) : cash - tgt * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' || !o.fill ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d)); turnover += buy / T
        events.push({ d, type: 'buy', kind: pendBuy.kind, first: pendBuy.kind === 'first', pct: buy / T, from, to: cash / total(d), qdd: px(qA, d) / peakQ - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      } else if (pendBuy.kind === 'first') events.push({ d, type: 'firstnobuy', from, qdd: px(qA, d) / peakQ - 1 })
      pendBuy = null
    }
    nav *= total(d) / lastPost
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = o.contribText || stepped ? RULE.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) {
        const gap = (a) => baseW(a, tgtCash) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    const T = total(d), q = px(qA, d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.rule) {
      const lowerOk = o.lowerPauseDd == null || qdd > o.lowerPauseDd
      if (!stepped) {
        if (qdd <= RULE.firstDd) { stepped = true; stepDay = d; pendBuy = { kind: 'first', to: RULE.target, frac: cw - RULE.target } }
        else if (o.preBand && cw >= o.preBand.upper) pendBuy = { kind: 'preupper', to: o.preBand.target, frac: cw - o.preBand.target }
        else if (o.preBand && cw <= o.preBand.lower) pendSell = { to: o.preBand.target, frac: o.preBand.target - cw, pre: true }
        else if (o.preLower && o.lower && cw <= RULE.lower && lowerOk) pendSell = { to: o.lowerTo, frac: o.lowerTo - cw, pre: true }
      } else if (cw >= o.upper && (o.upperNeedsDd == null || qdd <= o.upperNeedsDd)) pendBuy = { kind: 'upper', to: RULE.target, frac: cw - RULE.target }
      else if (o.lower && cw <= RULE.lower && lowerOk) pendSell = { to: o.lowerTo, frac: o.lowerTo - cw }
    }
    if (o.trim) for (const a of others) { const w = (hold[a.key] * px(a, d)) / T; if (w >= RULE.trimAt) pendTrim.push({ key: a.key, frac: w - RULE.trimTo }) }
    series.push({ d, V: nav, qdd, w: weights(d, T), stepped })
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, pk = 100
  for (const s of series) { if (s.V > pk) pk = s.V; if (s.V / pk - 1 < mdd) mdd = s.V / pk - 1 }
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell')
  return { series, events, buys, sells, trims: events.filter((e) => e.type === 'trim'), cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, final: last, stepDay, yrs, taxPaid, turnover, avgCash: series.reduce((x, s) => x + s.w.cash, 0) / series.length }
}
export const pct = (x, n = 1) => (x == null ? 'na' : (x * 100).toFixed(n) + '%')
export const allDates = [...QQQ.keys()].sort()
export const scenFor = (start) => {
  const three = start >= '2014-09-17', two = start >= '2004-11-18'
  const assets = three ? [A_QQQ, A_GOLD, A_BTC] : two ? [A_QQQ, A_GOLD] : [A_QQQ]
  const base = three ? { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 } : two ? { qqq: 0.5, gold: 0.1, cash: 0.4 } : { qqq: 0.6, cash: 0.4 }
  const dates = allDates.filter((d) => d >= start && assets.every((a) => a.px.has(d)))
  return { assets, base, dates }
}
export const athBefore = (d) => { let m = 0; for (const x of allDates) { if (x > d) break; m = Math.max(m, QQQ.get(x)) } return m }
