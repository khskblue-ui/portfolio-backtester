// 리뷰용 실험 라이브러리. 저장소의 sim()을 옮기고 환율, 원화 현금, 점검 주기, 원화 기준 차익을 덧붙였다.
import fs from 'node:fs'
import path from 'node:path'
const ROOT = '/home/user/portfolio-backtester'
const csv = (name) => new Map(fs.readFileSync(path.join(ROOT, 'data-src/reserve', `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
export const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
export const RULE = { startCash: 0.4, firstDd: -0.2, target: 0.3, upper: 0.4, lower: 0.2, lowerTo: 0.3, fillTo: 0.1, trimAt: 0.2, trimTo: 0.1, taxRate: 0.22 }

// 원/달러 환율 근사치(기억에 의존한 월말 부근 값, 일부는 월중 고점). 선형 보간. 정확한 자료가 아님.
const FXA = `1999-03-10 1227|1999-06-30 1157|1999-09-30 1215|1999-12-30 1138|2000-03-31 1107|2000-06-30 1115|2000-09-29 1115|2000-12-29 1265|2001-03-30 1328|2001-04-04 1365|2001-06-29 1300|2001-09-28 1310|2001-12-31 1314|2002-03-29 1326|2002-06-28 1203|2002-07-24 1170|2002-09-30 1225|2002-12-31 1186|2003-03-31 1255|2003-06-30 1195|2003-09-30 1150|2003-12-31 1192|2004-03-31 1147|2004-06-30 1155|2004-09-30 1152|2004-11-18 1065|2004-12-31 1035|2005-03-31 1016|2005-06-30 1035|2005-09-30 1042|2005-12-30 1010|2006-03-31 972|2006-06-30 949|2006-09-29 946|2006-12-29 930|2007-03-30 941|2007-06-29 924|2007-09-28 915|2007-10-31 901|2007-12-31 936|2008-02-29 939|2008-03-31 990|2008-06-30 1046|2008-08-29 1089|2008-09-30 1207|2008-10-28 1467|2008-10-31 1291|2008-11-24 1513|2008-12-30 1260|2009-01-30 1380|2009-02-27 1534|2009-03-02 1570|2009-03-31 1383|2009-06-30 1274|2009-09-30 1178|2009-12-30 1164|2010-03-31 1131|2010-04-26 1104|2010-05-25 1250|2010-06-30 1222|2010-09-30 1140|2010-10-29 1125|2010-12-30 1135|2011-03-31 1097|2011-06-30 1068|2011-07-29 1054|2011-09-30 1178|2011-12-29 1152|2012-03-30 1133|2012-06-29 1145|2012-09-28 1111|2012-12-28 1064|2013-03-29 1112|2013-06-28 1142|2013-09-30 1075|2013-10-31 1061|2013-12-30 1055|2014-03-31 1065|2014-06-30 1012|2014-07-31 1028|2014-09-30 1055|2014-12-30 1099|2015-03-31 1110|2015-06-30 1115|2015-09-30 1185|2015-12-30 1173|2016-02-26 1237|2016-03-31 1144|2016-06-30 1152|2016-09-30 1101|2016-12-29 1208|2017-01-31 1162|2017-03-31 1118|2017-06-30 1144|2017-09-29 1145|2017-11-30 1088|2017-12-28 1067|2018-01-31 1068|2018-03-30 1064|2018-06-29 1115|2018-09-28 1109|2018-12-28 1116|2019-03-29 1135|2019-06-28 1155|2019-08-30 1211|2019-09-30 1196|2019-12-30 1156|2020-02-28 1214|2020-03-19 1285|2020-03-31 1217|2020-06-30 1203|2020-08-31 1188|2020-09-29 1170|2020-12-30 1086|2021-01-29 1118|2021-03-31 1132|2021-06-30 1126|2021-09-30 1184|2021-12-30 1189|2022-03-31 1212|2022-06-30 1298|2022-09-30 1431|2022-10-25 1440|2022-11-30 1319|2022-12-29 1265|2023-01-31 1232|2023-03-31 1302|2023-06-30 1318|2023-09-27 1349|2023-12-28 1288|2024-03-29 1347|2024-06-28 1377|2024-09-30 1308|2024-12-30 1472|2025-03-31 1473|2025-04-09 1484|2025-04-30 1421|2025-06-30 1350|2025-07-31 1387|2025-09-30 1403|2025-10-31 1425|2025-12-30 1440|2026-10-30 1440`.split('|').map((s) => { const [d, v] = s.split(' '); return [Date.parse(d), +v] })
export const fx = (d) => { const t = Date.parse(d); if (t <= FXA[0][0]) return FXA[0][1]; for (let i = 1; i < FXA.length; i++) if (t <= FXA[i][0]) { const [t0, v0] = FXA[i - 1], [t1, v1] = FXA[i]; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) } return FXA.at(-1)[1] }
// 한국 단기 금리 근사(연 평균, CD 91일물 부근). 기억에 의존.
const KR = { 1999: 6.5, 2000: 7.0, 2001: 5.3, 2002: 4.8, 2003: 4.3, 2004: 3.8, 2005: 3.6, 2006: 4.5, 2007: 5.2, 2008: 5.5, 2009: 2.6, 2010: 2.7, 2011: 3.4, 2012: 3.3, 2013: 2.7, 2014: 2.5, 2015: 1.8, 2016: 1.5, 2017: 1.4, 2018: 1.7, 2019: 1.7, 2020: 0.9, 2021: 0.9, 2022: 2.5, 2023: 3.7, 2024: 3.5, 2025: 2.7, 2026: 2.6 }
export const krRate = (d) => KR[+d.slice(0, 4)]

/** opt 추가: ccy 'USD'|'KRWcash'(현금은 원화, 비중은 원화 환산), check 'daily'|'weekly'|'monthly', flow: [{d, amt(전체 대비, 음수는 인출)}] */
export function sim(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, lowerTo: RULE.lowerTo, upper: RULE.upper, fill: true, trim: true, contrib: 0, tax: 0, ccy: 'USD', check: 'daily', target: RULE.target, lowerAt: RULE.lower, preLower: false, ...opt }
  const krw = o.ccy === 'KRWcash'
  const px = (a, d) => a.px.get(d) * (krw ? fx(d) : 1)
  const hold = {}, cost = {}, costK = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key]; costK[a.key] = 100 * base[a.key] * (krw ? 1 : fx(dates[0])) }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const gains = []
  const sell = (a, amt, d, why) => {
    const frac = amt / (hold[a.key] * px(a, d)), gain = amt - cost[a.key] * frac, tax = Math.max(0, gain) * o.tax
    const amtK = amt * (krw ? 1 : fx(d)), gainK = amtK - costK[a.key] * frac
    gains.push({ d, key: a.key, why, pctOfTotal: amt / total(d), gainFrac: gain / amt, gainFracKRW: gainK / amtK })
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; costK[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; costK[a.key] += amt * (krw ? 1 : fx(d)); cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  let peakQ = o.peak0 ?? QQQ.get(dates[0]), irx = 0, stepped = !!o.stepped0, nav = 100, lastPost = 100
  let pendBuy = null, pendSell = false, pendTrim = [], stepDay = null
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  const isCheck = (i) => { if (o.check === 'daily') return true; const d = dates[i], n = dates[i + 1]; if (!n) return true; if (o.check === 'monthly') return d.slice(0, 7) !== n.slice(0, 7); const wd = new Date(d).getUTCDay(), wn = new Date(n).getUTCDay(); return wn < wd || (Date.parse(n) - Date.parse(d)) / 864e5 >= 7 }
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7)
    if (IRX.has(prev)) irx = IRX.get(prev)
    const r = krw ? krRate(prev) : irx
    cash *= 1 + (r / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d), s = cur - RULE.trimTo * T
      if (s > 0) { const cashFrom = cash / T; sell(a, s, d, 'trim'); events.push({ d, type: 'trim', key, from: cur / T, pct: s / T, cashFrom, cashTo: cash / total(d), qdd: QQQ.get(d) / peakQ - 1 }) }
    }
    pendTrim = []
    if (pendSell) {
      const T = total(d), from = cash / T, need = o.lowerTo * T - cash
      if (need > 0.005 * T && hold.qqq * px(qA, d) > need) { sell(qA, need, d, 'lower'); events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1, fx: fx(d) }) }
      pendSell = false
    }
    if (pendBuy) {
      const T = total(d), from = cash / T, buy = cash - o.target * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' || !o.fill ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d))
        events.push({ d, type: 'buy', first: pendBuy === 'first', pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1, fx: fx(d), parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      }
      pendBuy = null
    }
    nav *= total(d) / lastPost
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? o.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) {
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * RULE.fillTo : RULE.fillTo) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    for (const f of o.flow ?? []) if (f.d === d) { cash += f.amt * total(d) }
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.rule && isCheck(i)) {
      if (!stepped) { if (qdd <= RULE.firstDd) { stepped = true; stepDay = d; pendBuy = 'first' } else if (o.preLower && cw <= o.lowerAt) pendSell = true }
      else if (cw >= o.upper && (o.gate == null || qdd <= o.gate || cw >= (o.hardCap ?? 9))) pendBuy = 'upper'
      else if (o.lower && cw <= o.lowerAt) pendSell = true
    }
    if (o.trim && isCheck(i)) for (const a of others) if ((hold[a.key] * px(a, d)) / T >= RULE.trimAt) pendTrim.push(a.key)
    series.push({ d, V: nav, T, qdd, w: weights(d, T), stepped })
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, pk = 100
  for (const s of series) { if (s.V > pk) pk = s.V; if (s.V / pk - 1 < mdd) mdd = s.V / pk - 1 }
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell')
  return { series, events, buys, sells, trims: events.filter((e) => e.type === 'trim'), gains, cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, final: last, stepDay, yrs, taxPaid, avgCash: series.reduce((x, s) => x + s.w.cash, 0) / series.length }
}
export const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
export const SCEN = [
  { id: 's2014', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 } },
  { id: 's2004', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.5, gold: 0.1, cash: 0.4 } },
  { id: 's1999', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.6, cash: 0.4 } },
]
for (const s of SCEN) s.dates = [...QQQ.keys()].sort().filter((d) => d >= s.start && s.assets.every((a) => a.px.has(d)))
export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`
export const fmtEv = (e) => e.type === 'buy' ? `${e.d} 삼${e.first ? '(1번)' : '(2번)'} ${pct(e.pct, 0)} 현금 ${pct(e.from, 0)}→${pct(e.to, 0)} QQQ낙폭 ${pct(e.qdd, 0)} fx≈${Math.round(e.fx)}` : e.type === 'sell' ? `${e.d} 팖(3번) ${pct(e.pct, 0)} 현금 ${pct(e.from, 0)}→${pct(e.to, 0)} fx≈${Math.round(e.fx)}` : `${e.d} 줄임(6번 ${e.key}) ${pct(e.pct, 0)} 현금 ${pct(e.cashFrom, 0)}→${pct(e.cashTo, 0)}`
