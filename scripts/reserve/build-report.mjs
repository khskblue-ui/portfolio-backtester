// 현금 비중으로 사고파는 규칙 — 규칙 도해와 과거 데이터 점검 보고서 (HTML → PDF)
// 사용: node scripts/reserve/build-report.mjs   → docs/research/reserve-plan/reserve-plan.html · .pdf
// 자료: data-src/reserve/*.csv (야후 수정주가 일별 스냅숏). 달러 기준(환율 제외). 세금은 비교표의 세금 줄에만 넣는다.
// 1번 규칙(QQQ가 최고가보다 20% 내리면 현금 40 → 30)은 2026년 11월에 썼다. 그래서 본문 계산은 기준 비중(현금 30%)에서 시작하고, 기다린 경우는 비교용(wait)으로만 둔다.
// 결정은 그날 종가, 체결은 다음 거래일 종가. 수치는 전부 이 스크립트의 계산 결과를 그대로 넣고, 본문 서술은 check()로 계산과 맞춘다.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'docs/research/reserve-plan')
const csv = (name) => new Map(fs.readFileSync(path.join(ROOT, 'data-src/reserve', `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX'), ETH = csv('ETH-USD')

// ── 규칙 (문서와 계산이 같은 값을 쓴다) ──────────────────────────────────────
const RULE = {
  startCash: 0.4, // 지금의 현금 비중
  firstDd: -0.2, // 1번: QQQ가 최고가에서 이만큼 내리면
  target: 0.3, // 기준 현금 비중
  upper: 0.4, // 현금 상한: 이상이면 기준까지 써서 산다
  lower: 0.2, lowerTo: 0.3, // 현금 하한: 이하면 팔아서 lowerTo(기준)까지 채운다
  sellFirstAt: 0.15, // 3번으로 팔 때 금이나 암호화폐가 이 비중 이상이면 그 자산부터 판다
  fillTo: 0.1, // 살 때(2번)와 팔 때(3번) 금과 암호화폐를 채우는 비중
  trimAt: 0.2, trimTo: 0.1, // 금, 암호화폐 상한과 줄인 뒤 비중
  minTrade: 0.005, // 전체의 이 비중보다 작은 매매는 하지 않는다
  taxRate: 0.22, // 세금 반영 계산에 쓰는 매도 차익 세율
}

/**
 * opt: { partial(true면 전부 되돌리지 않고 필요한 만큼만 사고파는 이전 규칙), rule(false면 금, 암호화폐 상한만 적용), lower(현금 하한), lowerTo(하한에서 채우는 선), upper(현금 상한), fill(살 때 금과 암호화폐 먼저),
 *        trim(금, 암호화폐 상한), sellOthersFirst(3번에서 비중 큰 금, 암호화폐부터 팔기), fillOnSell(3번에서 금, 암호화폐도 채우기),
 *        contrib(새로 들어오는 돈: 연간, 전체 자산 대비), tax(매도 차익 세율) }
 * 그날 종가로 판단하고, 다음 거래일 종가에 조건을 다시 보지 않고 체결한다. 크기는 체결하는 날 종가의 비중으로 맞춘다.
 * 같은 날 여러 규칙이 걸리면 6번, 3번(또는 1, 2번) 순서로 보고, 뒤 규칙은 앞 규칙을 반영한 현금으로 계산한다.
 * 3번(현금 하한)은 첫날부터, 2번(현금 상한)은 1번 조건이 한 번 된 뒤부터 본다. 낙폭의 기준 최고가는 계산 시작일 뒤의 최고 종가.
 * 수익률은 새로 들어오는 돈의 영향을 뺀 시간가중 수익률(V).
 */
function sim(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, lowerTo: RULE.lowerTo, upper: RULE.upper, fill: true, trim: true, sellOthersFirst: true, fillOnSell: true, partial: false, contrib: 0, tax: 0, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]))
  const sell = (key, amt, d) => { // 평균 단가 기준 차익에 과세(공제와 손익 합산 없음)
    const a = byKey[key], val = hold[key] * px(a, d), x = Math.min(amt, val * 0.9999), frac = x / val, tax = Math.max(0, x - cost[key] * frac) * o.tax
    hold[key] -= x / px(a, d); cost[key] *= 1 - frac; cash += x - tax; taxPaid += tax
  }
  const buyA = (key, amt, d) => { const x = Math.min(amt, cash); if (x > 0) { hold[key] += x / px(byKey[key], d); cost[key] += x; cash -= x } }
  const others = assets.filter((a) => a.key !== 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  let peakQ = QQQ.get(dates[0]), irx = 0, stepped = !!o.startStepped, stepDay = null, nav = 100, lastPost = 100, pending = { trims: [], act: null }
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = [], rets = [], rfs = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7)
    if (IRX.has(prev)) irx = IRX.get(prev)
    const rf = (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    cash *= 1 + rf
    // 전날 판단한 것을 오늘 종가로 체결한다. 조건을 다시 보지 않고, 크기는 오늘 종가의 비중으로 맞춘다. 순서는 6번, 3번, 1번과 2번.
    for (const key of pending.trims) {
      const T = total(d), cur = hold[key] * px(byKey[key], d), amt = cur - RULE.trimTo * T
      if (amt > 0) { const cashFrom = cash / T; sell(key, amt, d); events.push({ d, type: 'trim', key, from: cur / T, pct: amt / T, cashFrom, cashTo: cash / total(d) }) }
    }
    if (pending.act && !o.partial) {
      // 전부 기준 비중으로 되돌린다. 1번과 현금 상한은 현금이 기준보다 많을 때만, 현금 하한은 언제나.
      const T = total(d), from = cash / T
      if (pending.act === 'sell' || cash > (RULE.target + RULE.minTrade) * T) {
        const tgt = (k) => (k === 'qqq' ? 1 - RULE.target - others.length * RULE.fillTo : RULE.fillTo) * T, val = (k) => hold[k] * px(byKey[k], d)
        const sells = {}, parts = {}
        for (const a of assets) { const x = val(a.key) - tgt(a.key); if (x > 0) { sells[a.key] = x; sell(a.key, x, d) } }
        const want = assets.map((a) => Math.max(0, tgt(a.key) - val(a.key))), sum = want.reduce((x, y) => x + y, 0), k = sum > 0 ? Math.min(1, Math.max(0, cash - RULE.target * total(d)) / sum) : 0
        assets.forEach((a, n) => { if (want[n] * k > 0) { parts[a.key] = want[n] * k; buyA(a.key, want[n] * k, d) } })
        const to = cash / total(d), up = to > from, share = (obj) => Object.fromEntries(Object.entries(obj).map(([key, v]) => [key, v / T]))
        events.push({ d, type: up ? 'sell' : 'buy', first: pending.act === 'first', pct: Object.values(up ? sells : parts).reduce((x, y) => x + y, 0) / T, from, to, qdd: QQQ.get(d) / peakQ - 1, parts: share(parts), sells: share(sells), fills: share(up ? parts : {}) })
      }
    } else {
      if (pending.act === 'sell') {
        const T = total(d), from = cash / T, sells = {}, fills = {}
        const val = (k) => hold[k] * px(byKey[k], d)
        if (o.sellOthersFirst) for (const a of others) if (val(a.key) / T >= RULE.sellFirstAt) { const amt = val(a.key) - RULE.fillTo * T; sells[a.key] = amt; sell(a.key, amt, d) }
        if (o.fillOnSell) for (const a of others) { const need = RULE.fillTo * T - val(a.key); if (need > RULE.minTrade * T) fills[a.key] = need }
        const qSell = Math.max(0, o.lowerTo * T - cash) + Object.values(fills).reduce((x, y) => x + y, 0)
        if (qSell > RULE.minTrade * T && val('qqq') > qSell) { sells.qqq = qSell; sell('qqq', qSell, d); for (const [k, amt] of Object.entries(fills)) buyA(k, amt, d) }
        else for (const k of Object.keys(fills)) delete fills[k]
        const sold = Object.values(sells).reduce((x, y) => x + y, 0)
        if (sold > 0) events.push({ d, type: 'sell', pct: sold / T, from, to: cash / total(d), sells: Object.fromEntries(Object.entries(sells).map(([k, v]) => [k, v / T])), fills: Object.fromEntries(Object.entries(fills).map(([k, v]) => [k, v / T])) })
      } else if (pending.act) {
        const T = total(d), from = cash / T, buy = cash - RULE.target * T
        if (buy > RULE.minTrade * T) {
          const need = others.map((a) => (o.fill ? Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d)) : 0)), sum = need.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
          const parts = { qqq: buy - Math.min(sum, buy) }
          others.forEach((a, j) => { parts[a.key] = need[j] * k })
          for (const [key, amt] of Object.entries(parts)) buyA(key, amt, d)
          events.push({ d, type: 'buy', first: pending.act === 'first', pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1, parts: Object.fromEntries(Object.entries(parts).map(([key, v]) => [key, v / T])) })
        }
      }
    }
    pending = { trims: [], act: null }
    const pre = total(d)
    nav *= pre / lastPost // 새 돈이 들어오기 전 값으로 하루 수익을 잰다
    rets.push(pre / lastPost - 1); rfs.push(rf)
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? RULE.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) { // 현금이 기준 이상이면 기준보다 가장 모자란 자산을 산다
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * RULE.fillTo : RULE.fillTo) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)).key, amt, d)
      }
    }
    // 오늘 종가로 판단한다. 뒤 규칙은 앞 규칙(6번)을 반영한 현금으로 본다
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1
    let pc = cash
    if (o.trim) for (const a of others) { const v = hold[a.key] * px(a, d); if (v / T >= RULE.trimAt) { pending.trims.push(a.key); pc += v - RULE.trimTo * T } }
    if (o.rule) {
      if (!stepped && qdd <= RULE.firstDd) { stepped = true; stepDay = d; pending.act = 'first' } // 살 것이 없어도 1번을 쓴 것으로 친다
      else if (stepped && pc / T >= o.upper) pending.act = 'upper'
      else if (o.lower && pc / T <= RULE.lower) pending.act = 'sell'
    }
    series.push({ d, V: nav, qdd, w: weights(d, T) })
  }
  return summarize(dates, series, events, rets, rfs, { stepDay, taxPaid })
}

/** 견줄 기준: 기준 비중을 매달 첫 거래일에 되돌린다(세금 없음) */
function simFixed(dates, assets, w) {
  const px = (a, d) => a.px.get(d)
  const hold = Object.fromEntries(assets.map((a) => [a.key, (100 * w[a.key]) / px(a, dates[0])]))
  let cash = 100 * w.cash, irx = 0, last = 100
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...w } }], rets = [], rfs = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    const rf = (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    cash *= 1 + rf
    const T = total(d)
    rets.push(T / last - 1); rfs.push(rf); last = T
    series.push({ d, V: T, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T } })
    if (d.slice(0, 7) !== prev.slice(0, 7)) { for (const a of assets) hold[a.key] = (T * w[a.key]) / px(a, d); cash = T * w.cash }
  }
  return summarize(dates, series, [], rets, rfs, { stepDay: null, taxPaid: 0 })
}

function summarize(dates, series, events, rets, rfs, extra) {
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  for (const s of series) { if (s.V > pk) { pk = s.V; pkDay = s.d } if (s.V / pk - 1 < mdd) { mdd = s.V / pk - 1; mddDay = s.d; mddPeak = pkDay } }
  const rec = series.find((s) => s.d > mddDay && s.V >= series.find((x) => x.d === mddPeak).V)?.d ?? null
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const m = mean(rets), vol = Math.sqrt(mean(rets.map((r) => (r - m) ** 2)) * 252), sharpe = ((m - mean(rfs)) * 252) / vol
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell')
  const firstDay = buys[0]?.d ?? null, after = firstDay ? series.filter((s) => s.d > firstDay) : []
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  return { series, events, buys, sells, trims: events.filter((e) => e.type === 'trim'), cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, mddDay, rec, vol, sharpe, final: last, firstBuy: firstDay, yrs, ...extra,
    avgCash: mean(series.map((s) => s.w.cash)), minCash: Math.min(...series.map((s) => s.w.cash)), maxCash: Math.max(...series.map((s) => s.w.cash)), minCashAfter: after.length ? Math.min(...after.map((s) => s.w.cash)) : null,
    medW: (k) => med(series.map((s) => s.w[k] ?? 0)) }
}

const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
const SCEN = [
  { id: 's2014', title: '2014~2026년', sub: 'QQQ 50, 금 10, 비트코인 10, 현금 30으로 시작', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base0: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, note: '지금 구성과 같은 비중입니다. 비트코인 자료가 2014년 9월부터라 이때 시작합니다.' },
  { id: 's2004', title: '2004~2026년 (2008년 포함)', sub: 'QQQ 60, 금 10, 현금 30으로 시작', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base0: { qqq: 0.5, gold: 0.1, cash: 0.4 }, note: '비트코인이 없던 시기라 그 몫을 QQQ에 더했습니다. 금 ETF(GLD) 상장일부터입니다.' },
  { id: 's1999', title: '1999~2026년 (닷컴 버블 포함)', sub: 'QQQ 70, 현금 30으로 시작', start: '1999-03-10', assets: [A_QQQ], base0: { qqq: 0.6, cash: 0.4 }, note: '금 ETF도 없던 시기라 금과 비트코인 몫을 QQQ에 더했습니다. 가장 나쁜 경우를 보려는 구간입니다.' },
]
const datesFor = (start, assets) => [...QQQ.keys()].sort().filter((d) => d >= start && assets.every((a) => a.px.has(d)))
const baseline = (base) => ({ ...base, cash: RULE.target, qqq: base.qqq + (base.cash - RULE.target) })
// 1번 규칙은 2026년 11월에 이미 썼다. 그래서 모든 계산은 기준 비중에서 시작하고 현금 상한과 하한을 첫날부터 본다
for (const s of SCEN) {
  s.dates = datesFor(s.start, s.assets)
  s.base = baseline(s.base0)
  const run = (opt) => sim(s.dates, s.assets, s.base, { startStepped: true, ...opt })
  s.plan = run({})
  s.hold = run({ rule: false })
  s.fixed = simFixed(s.dates, s.assets, s.base)
  s.nolower = run({ lower: false })
  s.partial = run({ partial: true })
  s.up35 = run({ upper: 0.35 })
  s.notrim = run({ trim: false })
  s.wait = sim(s.dates, s.assets, s.base0, {}) // 현금 40%에서 시작해 1번 규칙을 기다린 경우(이전 계획)
  s.c3 = run({ contrib: 0.03 })
  s.c6 = run({ contrib: 0.06 })
  s.tax = run({ tax: RULE.taxRate })
  s.holdTax = run({ rule: false, tax: RULE.taxRate })
}
// 2014년 구간에서 비트코인을 뺀 경우(그 몫은 QQQ에)
const NOBTC = (() => { const assets = [A_QQQ, A_GOLD], base = { qqq: 0.6, gold: 0.1, cash: RULE.target }, dates = datesFor(SCEN[0].start, assets); return { plan: sim(dates, assets, base, { startStepped: true }), hold: sim(dates, assets, base, { rule: false }), fixed: simFixed(dates, assets, base) } })()

// 최근 5년(비트코인이 처음 크게 오른 때가 빠진 구간)과, 끝은 같고 시작한 달만 바꾼 경우. 비중과 규칙은 2014년 구간과 같다
const CRYPTO = { btc: 0.8, eth: 0.2 } // 암호화폐 몫 안의 구성(사용자 결정)
const annual = (px, dates) => (px.get(dates.at(-1)) / px.get(dates[0])) ** ((365.25 * 864e5) / (Date.parse(dates.at(-1)) - Date.parse(dates[0]))) - 1
const RECENT = (() => {
  const { assets, base } = SCEN[0], end = SCEN[0].dates.at(-1)
  const mk = (back) => {
    const dates = datesFor(`${+end.slice(0, 4) - back}${end.slice(4)}`, assets), run = (opt) => sim(dates, assets, base, { startStepped: true, ...opt })
    return { back, dates, assets, base, plan: run({}), hold: run({ rule: false }), fixed: simFixed(dates, assets, base), ann: { qqq: annual(QQQ, dates), btc: annual(BTC, dates), gold: annual(GLD, dates) } }
  }
  const five = mk(5), run = (opt) => sim(five.dates, assets, base, { startStepped: true, ...opt })
  // 암호화폐 몫을 비트코인 80, 이더리움 20으로 둔 경우. 둘의 비율을 매일 맞춘 값을 암호화폐 한 자산으로 넣는다(실제로는 규칙이 걸릴 때만 맞추므로 근사)
  const mixDays = [...BTC.keys()].sort().filter((d) => ETH.has(d)), MIX = new Map([[mixDays[0], 100]])
  for (let i = 1; i < mixDays.length; i++) MIX.set(mixDays[i], MIX.get(mixDays[i - 1]) * ((CRYPTO.btc * BTC.get(mixDays[i])) / BTC.get(mixDays[i - 1]) + (CRYPTO.eth * ETH.get(mixDays[i])) / ETH.get(mixDays[i - 1])))
  const mixAssets = [A_QQQ, A_GOLD, { key: 'btc', name: '암호화폐', px: MIX }]
  const mixRun = (r) => { const dates = r.dates.filter((d) => MIX.has(d)); return { dates, plan: sim(dates, mixAssets, base, { startStepped: true }), hold: sim(dates, mixAssets, base, { rule: false }), btcOnly: sim(dates, assets, base, { startStepped: true }), annEth: annual(ETH, dates), annMix: annual(MIX, dates) } }
  Object.assign(five, { id: 's5y', title: `최근 5년 (${five.dates[0].slice(0, 4)}년 ${+five.dates[0].slice(5, 7)}월~)`, sub: SCEN[0].sub, nolower: run({ lower: false }), nobtc: sim(five.dates, [A_QQQ, A_GOLD], { qqq: 0.6, gold: 0.1, cash: RULE.target }, { startStepped: true }), wait: sim(five.dates, assets, SCEN[0].base0, {}), tax: run({ tax: RULE.taxRate }), holdTax: run({ rule: false, tax: RULE.taxRate }) })
  five.lowQdd = Math.min(...five.plan.series.map((q) => q.qdd)); five.maxCash = five.plan.maxCash
  five.mix = mixRun(five)
  return { five, mixLong: mixRun(mk(9)), byStart: [9, 8, 7, 6, 5, 4, 3].map((b) => (b === 5 ? five : mk(b))), ann14: { qqq: annual(QQQ, SCEN[0].dates), btc: annual(BTC, SCEN[0].dates), gold: annual(GLD, SCEN[0].dates) } }
})()

// ── 표기 ────────────────────────────────────────────────────────────────────
const pct = (x, d = 1) => `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`
const p0 = (x) => pct(x, 0)
const ymd = (d) => d.replaceAll('-', '.')
const ymK = (d) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월`
const ymdK = (d) => `${ymK(d)} ${+d.slice(8, 10)}일`
const C = { cash: '#1baf7a', gold: '#eda100', qqq: '#2a78d6', btc: '#eb6834', plan: '#2a78d6', base: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', ink3: '#8a8984', grid: '#e6e5e1', surface: '#ffffff' }
const NAME = { cash: '현금', gold: '금', qqq: 'QQQ', btc: '비트코인' }
const STACK = ['cash', 'gold', 'qqq', 'btc'] // 색 인접 검사를 통과한 순서(aqua, yellow, blue, orange)

// ── 차트 (인라인 SVG, 인쇄용 정적 도표) ─────────────────────────────────────
const W = 688, ML = 46, MR = 92
const xScale = (dates) => { const t0 = Date.parse(dates[0]), t1 = Date.parse(dates.at(-1)); return (d) => ML + ((Date.parse(d) - t0) / (t1 - t0)) * (W - ML - MR) }
const sample = (series, keep) => series.filter((s, i) => i % 4 === 0 || i === series.length - 1 || keep.has(s.d))
const yearTicks = (dates) => { const y0 = +dates[0].slice(0, 4) + 1, y1 = +dates.at(-1).slice(0, 4); const step = y1 - y0 > 20 ? 4 : y1 - y0 > 10 ? 2 : 1; const out = []; for (let y = y0; y <= y1; y += step) out.push(`${y}-01-01`); return out }
const xAxis = (dates, x, y) => yearTicks(dates).map((d) => `<line x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${y}" y2="${y + 4}" stroke="${C.ink3}"/><text x="${x(d).toFixed(1)}" y="${y + 15}" text-anchor="middle" class="tick">${d.slice(0, 4)}</text>`).join('')
const pathOf = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')

/** 현금 비중 선 아래에 사고판 기록을 줄로 붙인다. 세로 점선이 기록과 현금 비중이 바뀐 자리를 잇는다 */
function cashChart(s, { PH = 116, LH = 30 } = {}) {
  const r = s.plan, x = xScale(s.dates)
  const rows = [
    { label: '산 날', note: '현금이 줄어듦', ev: r.buys, mark: (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/>` },
    { label: '팔아서 채운 날', note: '현금이 늘어남', ev: r.sells, mark: (cx, cy) => `<path d="M${cx},${cy - 5.5}l5.5,5.5l-5.5,5.5l-5.5,-5.5z" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/>` },
    { label: `${[...new Set(r.trims.map((e) => NAME[e.key]))].join(', ')}을 줄인 날`, note: '현금이 늘어남', ev: r.trims, mark: (cx, cy, e) => `<path d="M${cx},${cy - 5.5}l6,10.5h-12z" fill="${C[e.key]}" stroke="#fff" stroke-width="1.2"/>` },
  ].filter((row) => row.ev.length)
  const T = 10, GAP = 10, B = 20, H = T + PH + GAP + rows.length * LH + B
  const laneY = (i) => T + PH + GAP + i * LH + LH / 2 + 3
  const delta = (e) => (e.type === 'trim' ? e.cashTo - e.cashFrom : e.to - e.from) // 그날 현금 비중이 바뀐 폭
  const signed = (v) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}`
  const all = rows.flatMap((row) => row.ev), keep = new Set(all.map((e) => e.d))
  const a = sample(r.series, keep), byDay = new Map(r.series.map((p) => [p.d, p]))
  const hi = Math.max(0.5, Math.ceil(Math.max(...a.map((p) => p.w.cash), ...r.buys.map((e) => e.from)) * 10) / 10)
  const y = (v) => T + (1 - v / hi) * PH
  const ticks = []; for (let v = 0; v <= hi + 1e-9; v += 0.1) ticks.push(v)
  const lines = [[RULE.upper, `현금 상한 ${p0(RULE.upper)}`, C.ink2, ''], [RULE.target, `기준 ${p0(RULE.target)}`, C.ink3, ' stroke-dasharray="3 3"'], [RULE.lower, `현금 하한 ${p0(RULE.lower)}`, C.ink2, '']]
  const lane = (row, i) => {
    let lastX = -99, below = false
    return `<rect x="${ML}" y="${laneY(i) - LH / 2 + 1}" width="${W - MR - ML}" height="${LH - 2}" fill="#f4f6f9"/>
      <text x="${W - MR + 6}" y="${laneY(i) - 1.5}" class="lbl">${row.label}</text><text x="${W - MR + 6}" y="${laneY(i) + 10}" class="lbl2">${row.note}</text>
      ${row.ev.map((e) => { const cx = x(e.d); below = cx - lastX < 19 ? !below : false; lastX = cx; return `<text x="${cx.toFixed(1)}" y="${(laneY(i) + (below ? 15 : -8)).toFixed(1)}" text-anchor="middle" class="lbl">${signed(delta(e))}</text>${row.mark(cx.toFixed(1), laneY(i), e)}` }).join('')}`
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="현금 비중과 사고판 기록">
    ${ticks.map((v) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <rect x="${ML}" y="${y(RULE.upper).toFixed(1)}" width="${W - MR - ML}" height="${(y(RULE.lower) - y(RULE.upper)).toFixed(1)}" fill="${C.cash}" opacity="0.1"/>
    ${lines.map(([v, label, color, dash]) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="1"${dash}/><text x="${W - MR + 6}" y="${(y(v) + 3.5).toFixed(1)}" class="lbl2">${label}</text>`).join('')}
    ${rows.map(lane).join('')}
    ${rows.flatMap((row, i) => row.ev.map((e) => `<line x1="${x(e.d).toFixed(1)}" x2="${x(e.d).toFixed(1)}" y1="${y(Math.max(byDay.get(e.d).w.cash, e.from ?? 0, e.cashFrom ?? 0)).toFixed(1)}" y2="${(laneY(i) - 7).toFixed(1)}" stroke="${C.ink3}" stroke-width="0.8" stroke-dasharray="2 2"/>`)).join('')}
    <path d="${pathOf(a.map((p) => [x(p.d), y(p.w.cash)]))}" fill="none" stroke="${C.cash}" stroke-width="2" stroke-linejoin="round"/>
    ${rows.map((row, i) => row.ev.map((e) => row.mark(x(e.d).toFixed(1), laneY(i), e)).join('')).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

const legend = (items) => `<div class="legend">${items.map(([kind, color, label]) => `<span class="lg"><span class="${kind}" style="--c:${color}"></span>${label}</span>`).join('')}</div>`

// ── 본문 조각 ───────────────────────────────────────────────────────────────
/** 본문에 적은 서술이 계산 결과와 어긋나면 만들지 않는다 */
const check = (cond, msg) => { if (cond) return; if (process.env.SOFT) console.log(`[어긋남] ${msg}`); else throw new Error(`본문 서술과 계산이 어긋남: ${msg}`) }
const winMdd = (r, from, to) => { let pk = 0, m = 0; for (const p of r.series) if (p.d >= from && p.d <= to) { pk = Math.max(pk, p.V); m = Math.min(m, p.V / pk - 1) } return m }
const short = (s) => s.title.replace(/ \(.*\)/, '').replace('년', '')

/** 가로 막대 도표. rows: [{ label, v, text, color }], v가 null이면 글만 적는다 */
const hbars = (rows, { Wd = 392, L = 118, R = 70, rh = 21, min = 0, max } = {}) => {
  const vals = rows.filter((r) => r.v != null).map((r) => r.v), hi = max ?? Math.max(...vals, 0), lo = Math.min(min, ...vals)
  const x = (v) => L + ((v - lo) / (hi - lo)) * (Wd - L - R), H = rows.length * rh + 4
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img">
    ${lo < 0 ? `<line x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="0" y2="${H}" stroke="${C.ink3}"/>` : ''}
    ${rows.map((r, i) => { const y = i * rh + 3, x0 = x(0), x1 = r.v == null ? x0 : x(r.v); return `<text x="${L - 8}" y="${y + 11}" text-anchor="end" class="lbl2">${r.label}</text>
      ${r.v == null ? '' : `<rect x="${Math.min(x0, x1).toFixed(1)}" y="${y}" width="${Math.max(1.5, Math.abs(x1 - x0)).toFixed(1)}" height="${rh - 8}" rx="2.5" fill="${r.color ?? C.plan}"/>`}
      <text x="${(Math.max(x0, x1) + 5).toFixed(1)}" y="${y + 11}" class="lbl">${r.text}</text>` }).join('')}
  </svg>`
}
/** 선 두 개를 겹쳐 그리는 작은 도표 (금, 암호화폐 상한 설명용) */
const twoLines = (dates, a, b, { Wd = 392, H = 132, L = 34, R = 108, T = 8, B = 20, labelA, labelB, rule, ruleLabel = '상한', colorA = C.btc, mark = 'max', dyA = 14 } = {}) => {
  const t0 = Date.parse(dates[0]), t1 = Date.parse(dates.at(-1)), x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0)) * (Wd - L - R)
  const hi = Math.ceil(Math.max(...a.map((p) => p.v), ...b.map((p) => p.v)) * 10) / 10, y = (v) => T + (1 - v / hi) * (H - T - B)
  const ticks = []; for (let v = 0; v <= hi + 1e-9; v += hi > 0.5 ? 0.2 : 0.1) ticks.push(v)
  const pick = (s) => s.filter((_, i) => i % 6 === 0 || i === s.length - 1)
  const maxB = b.reduce((m, p) => ((mark === 'max' ? p.v > m.v : p.v < m.v) ? p : m))
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img">
    ${ticks.map((v) => `<line x1="${L}" x2="${Wd - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${L - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <line x1="${L}" x2="${Wd - R}" y1="${y(rule).toFixed(1)}" y2="${y(rule).toFixed(1)}" stroke="${C.ink2}" stroke-dasharray="3 3"/><text x="${Wd - R + 5}" y="${(y(rule) + 3).toFixed(1)}" class="lbl2">${ruleLabel} ${p0(rule)}</text>
    <path d="${pathOf(pick(b).map((p) => [x(p.d), y(p.v)]))}" fill="none" stroke="${C.base}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${pathOf(pick(a).map((p) => [x(p.d), y(p.v)]))}" fill="none" stroke="${colorA}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(maxB.d).toFixed(1)}" cy="${y(maxB.v).toFixed(1)}" r="3.5" fill="${C.base}" stroke="#fff" stroke-width="1.5"/>
    <text x="${Wd - R + 5}" y="${(y(maxB.v) + 3).toFixed(1)}" class="lbl2">${labelB} ${p0(maxB.v)}</text>
    <text x="${Wd - R + 5}" y="${(y(a.at(-1).v) + dyA).toFixed(1)}" class="lbl">${labelA}</text>
    ${[dates[0], dates.at(-1)].map((d, i) => `<text x="${x(d).toFixed(1)}" y="${H - 5}" text-anchor="${i ? 'end' : 'start'}" class="tick">${d.slice(0, 4)}</text>`).join('')}
  </svg>`
}
const partsText = (s, parts) => s.assets.filter((a) => Math.round((parts[a.key] ?? 0) * 100) >= 1).map((a) => `${a.name} ${p0(parts[a.key])}`).join(', ')
const eventTable = (s) => {
  const rows = s.plan.events.map((e) => (e.type === 'trim'
    ? `<tr><td>${ymd(e.d)}</td><td>줄임</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.cashFrom)} → ${p0(e.cashTo)}</td><td class="n"></td><td>4번 규칙: ${NAME[e.key]} ${p0(e.from)} → ${p0(RULE.trimTo)}</td></tr>`
    : e.type === 'buy'
    ? `<tr><td>${ymd(e.d)}</td><td>삼</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.from)} → ${p0(e.to)}</td><td class="n">${p0(Math.min(0, e.qdd))}</td><td>${e.first ? '1번 규칙' : `2번 규칙(현금 ${p0(RULE.upper)} 이상)`}: ${partsText(s, e.parts)} 삼${partsText(s, e.sells) ? `, ${partsText(s, e.sells)} 팖` : ''}</td></tr>`
    : `<tr><td>${ymd(e.d)}</td><td>팖</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.from)} → ${p0(e.to)}</td><td class="n"></td><td>2번 규칙(현금 ${p0(RULE.lower)} 이하): ${partsText(s, e.sells)} 팖${partsText(s, e.fills) ? `, ${partsText(s, e.fills)} 삼` : ''}</td></tr>`))
  return `<table class="t dense"><thead><tr><th style="width:13%">날짜</th><th style="width:8%">한 일</th><th class="n" style="width:14%">크기 (전체 대비)</th><th class="n" style="width:15%">현금 비중</th><th class="n" style="width:11%">QQQ 낙폭</th><th>규칙과 산 것, 판 것</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6">없음</td></tr>'}</tbody></table>`
}
const recordsPage = () => `<section class="page">
  <div class="kicker">기록</div>
  <h2>사고판 기록</h2>
  <p class="sub">세 구간에서 규칙에 따라 사고판 날입니다. 크기는 그날 전체 평가액에서 차지하는 비율입니다.</p>
  ${SCEN.map((s) => `<h3>${s.title} <span class="hint">${s.sub}</span></h3>${eventTable(s)}`).join('')}
  <p class="foot">현금 비중과 낙폭은 사고판 날의 종가로 계산했습니다. 사고팔지는 그 전 거래일 종가를 보고 정했습니다.</p>
</section>`

// ── 규칙 도해 ───────────────────────────────────────────────────────────────
const NOW = SCEN[0].base
const BASELINE = { cash: RULE.target, gold: NOW.gold, qqq: NOW.qqq + (NOW.cash - RULE.target), btc: NOW.btc }
const mixText = (m) => `QQQ ${Math.round(m.qqq * 100)}, 암호화폐 ${Math.round(m.btc * 100)}, 금 ${Math.round(m.gold * 100)}, 현금 ${Math.round(m.cash * 100)}`
const mixBar = (m) => `<div class="bar">${STACK.map((k) => `<span class="seg" style="width:${m[k] * 100}%;background:${C[k]}"></span>`).join('')}</div>`
const REST = 1 - RULE.target // 현금을 뺀 나머지 자산
const FALL = 1 - (RULE.target / RULE.upper - RULE.target) / REST // 나머지 자산이 이만큼 내리면 현금이 상한
const RISE = (RULE.target / RULE.lower - RULE.target) / REST - 1 // 나머지 자산이 이만큼 오르면 현금이 하한
// ── 설계 배경에 쓰는 값 ─────────────────────────────────────────────────────
const s14 = SCEN[0], s04 = SCEN[1], s99 = SCEN[2]
/** QQQ가 역대 최고 종가에서 firstDd만큼 내린 날과 그 뒤 (자료 시작 1999년 3월부터) */
const HITS = (() => {
  const dates = [...QQQ.keys()].sort(), out = []
  let peak = 0, hit = false
  dates.forEach((d, i) => {
    const q = QQQ.get(d)
    if (q > peak) { peak = q; hit = false } else if (!hit && q / peak - 1 <= RULE.firstDd) {
      hit = true
      let lo = q
      for (let j = i; j < dates.length && QQQ.get(dates[j]) <= peak; j++) lo = Math.min(lo, QQQ.get(dates[j]))
      const j3 = dates.findIndex((x) => x >= `${+d.slice(0, 4) + 3}${d.slice(4)}`)
      out.push({ d, more: lo / q - 1, after3: j3 > 0 ? QQQ.get(dates[j3]) / q - 1 : null })
    }
  })
  return out
})()
const upperBuys = SCEN.flatMap((s) => s.plan.buys.map((e) => ({ ...e, s })))
const HITS_PAST = HITS.filter((h) => h.d < '2026-01-01') // 이번 하락 전에 QQQ가 최고가보다 20% 내렸던 때
const up35calm = SCEN.flatMap((s) => s.up35.buys.filter((e) => !e.first && e.qdd > -0.1))
/** 기준 비중에서 자산이 m만큼 움직인 뒤의 비중 */
const moved = (m) => { const v = { cash: BASELINE.cash, qqq: BASELINE.qqq * (1 + (m.qqq ?? 0)), gold: BASELINE.gold * (1 + (m.gold ?? 0)), btc: BASELINE.btc * (1 + (m.btc ?? 0)) }, T = v.cash + v.qqq + v.gold + v.btc; return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / T])) }
/** 금과 암호화폐가 g, b만큼 움직일 때, 현금이 c가 되려면 QQQ가 움직여야 하는 폭 */
const qqqMoveFor = (c, g = 0, b = 0) => (BASELINE.cash / c - BASELINE.cash - BASELINE.gold * (1 + g) - BASELINE.btc * (1 + b)) / BASELINE.qqq - 1
const mvp = (x) => (x == null || Math.abs(x) < 0.005 ? '그대로' : `${x > 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`)
const UP_CASES = [
  ['QQQ만 내릴 때', { qqq: qqqMoveFor(RULE.upper) }],
  ['QQQ와 암호화폐가 함께 내릴 때', { qqq: qqqMoveFor(RULE.upper, 0, -0.6), btc: -0.6 }],
  ['금은 오르고 나머지가 내릴 때', { qqq: qqqMoveFor(RULE.upper, 0.2, -0.6), gold: 0.2, btc: -0.6 }],
  ['셋이 같은 폭으로 내릴 때', { qqq: -FALL, gold: -FALL, btc: -FALL }],
  ['QQQ가 20%, 암호화폐가 50% 내릴 때', { qqq: -0.2, btc: -0.5 }],
  ['암호화폐만 80% 내릴 때', { btc: -0.8 }],
]
const DOWN_CASES = [
  ['QQQ만 오를 때', { qqq: qqqMoveFor(RULE.lower) }],
  ['셋이 같은 폭으로 오를 때', { qqq: RISE, gold: RISE, btc: RISE }],
  ['금과 암호화폐가 50% 오를 때', { qqq: qqqMoveFor(RULE.lower, 0.5, 0.5), gold: 0.5, btc: 0.5 }],
  ['QQQ가 50%, 금이 20% 오를 때', { qqq: 0.5, gold: 0.2 }],
  ['암호화폐만 오를 때', { btc: 1.25 }],
]
/** 과거 하락: QQQ가 고점에서 저점까지 간 기간에 각 자산이 움직인 폭을 기준 비중에 넣는다 */
const PAST = [['2000~2002년', '2000-01-01', '2002-12-31'], ['2007~2008년', '2007-06-01', '2009-06-30'], ['2020년 2~3월', '2020-01-01', '2020-04-30'], ['2021~2022년', '2021-10-01', '2023-01-31'], ['2025년 2~4월', '2025-01-01', '2025-05-31']].map(([label, a, b]) => {
  const dates = [...QQQ.keys()].sort().filter((d) => d >= a && d <= b)
  const hi = dates.reduce((m, d) => (QQQ.get(d) > QQQ.get(m) ? d : m)), lo = dates.filter((d) => d > hi).reduce((m, d) => (QQQ.get(d) < QQQ.get(m) ? d : m))
  const chg = (M) => (M.has(hi) && M.has(lo) ? M.get(lo) / M.get(hi) - 1 : null)
  const m = { qqq: chg(QQQ), gold: chg(GLD), btc: chg(BTC) }
  return { label, hi, lo, m, w: moved({ qqq: m.qqq, gold: m.gold ?? 0, btc: m.btc ?? 0 }) }
})
const fallFor = (c) => 1 - (c / RULE.upper - c) / (1 - c) // 현금 c에서 상한이 되려면 나머지 자산이 내려야 하는 폭
const usd = (x) => `${x.toFixed(2)}달러`
/** 자료 마지막 날 기준 QQQ 최고 종가와 1번 규칙의 기준가 */
const QNOW = (() => { const dates = [...QQQ.keys()].sort(); let pk = 0, pd = ''; for (const d of dates) if (QQQ.get(d) > pk) { pk = QQQ.get(d); pd = d } const last = dates.at(-1); const after = dates.filter((d) => d >= pd), lowDay = after.reduce((m, d) => (QQQ.get(d) < QQQ.get(m) ? d : m)); return { peak: pk, peakDay: pd, trigger: pk * (1 + RULE.firstDd), last: QQQ.get(last), lastDay: last, dd: QQQ.get(last) / pk - 1, lowDay, lowDd: QQQ.get(lowDay) / pk - 1 } })()
/** 견줄 기저율: 같은 시기의 아무 날에 샀을 때 3년 뒤 QQQ 수익률의 중앙값 */
const BASE3Y = (() => {
  const dates = [...QQQ.keys()].sort(), from = `${+HITS_PAST[1].d.slice(0, 4) - 2}-01-01`, out = []
  let j = 0
  dates.forEach((d) => { if (d < from) return; const t = `${+d.slice(0, 4) + 3}${d.slice(4)}`; while (j < dates.length && dates[j] < t) j++; if (j < dates.length) out.push(QQQ.get(dates[j]) / QQQ.get(d) - 1) })
  out.sort((a, b) => a - b)
  return { from, med: out[Math.floor(out.length / 2)] }
})()
const btcW = (r) => r.series.map((p) => ({ d: p.d, v: p.w.btc }))
const maxOf = (r, k) => Math.max(...r.series.map((p) => p.w[k] ?? 0))
const BEAR22 = ['2021-11-01', '2022-12-31']
const dd22 = { plan: winMdd(s04.plan, ...BEAR22), hold: winMdd(s04.hold, ...BEAR22) }
const cmpRow = (label, key, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${SCEN.map((s) => `<td class="n">${pct(s[key].cagr)}</td><td class="n">${pct(s[key].mdd)}</td>`).join('')}</tr>`

// 본문 서술을 계산이 뒷받침하는지 확인
check(HITS_PAST.length === 5 && HITS_PAST[0].d.startsWith('2000') && HITS_PAST[0].after3 < -0.5 && HITS_PAST.slice(1, 4).every((h) => h.after3 > 0.3) && QNOW.lowDd < -0.19, 'QQQ -20%는 이번 전에 5번, 2000년만 3년 뒤 크게 낮고 그 뒤 세 번은 30% 넘게 높음. 이번 하락은 19% 넘게 내림')
check(upperBuys.length >= 6 && [s04, s99].every((s) => s.plan.buys.every((e) => e.qdd <= -0.4)) && s14.plan.buys.every((e) => e.qdd > -0.2 && s14.plan.trims.filter((t) => t.d <= e.d).length >= 3), '현금 40%로 산 날: 2004~와 1999~에서는 모두 QQQ가 40% 넘게 낮았고, 2014~의 두 번은 비트코인을 세 번 넘게 줄인 뒤라 20%보다 덜 내렸을 때')
check(up35calm.length >= 1, '상한 35%면 QQQ가 최고가 근처일 때 산 날이 있음')
check(s14.plan.cagr - s14.hold.cagr > 0.015, '2014~: 규칙이 그냥 둔 경우보다 1.5%p 넘게 높음')
for (const s of [s04, s99]) check(s.plan.cagr <= s.hold.cagr + 0.001 && s.tax.cagr < s.holdTax.cagr, `${s.id}: 그냥 둔 경우가 규칙과 같거나 높고, 세금을 넣으면 규칙이 낮음`)
check(dd22.plan > dd22.hold + 0.03 && s04.hold.final.w.qqq > 0.85, '2004~: 2022년 낙폭은 규칙이 3%p 넘게 얕고 그냥 둔 경우는 QQQ 85% 초과')
for (const s of [s04, s99]) check(s.nolower.cagr > s.plan.cagr + 0.01 && s.nolower.minCash < 0.05, `${s.id}: 하한을 빼면 수익률은 1%p 넘게 높고 현금은 5% 아래까지`)
check([s04, s99].every((s) => s.c6.sells.length < s.c3.sells.length && s.c3.sells.length < s.plan.sells.length) && [s14.plan, s14.c3, s14.c6].every((r) => r.sells.length <= 1), '돈이 들어올수록 판 횟수가 줄어듦(2004~, 1999~). 2014~는 어느 쪽이든 1번 이하')
check(s14.plan.buys.every((e) => e.d < '2020-01-01'), '2014~: 2020년과 2022년에는 사지 않음')
check(s99.plan.mdd < -0.6 && s99.plan.buys.length >= 3, '1999~: 최대 낙폭이 60%보다 깊고 내리는 동안 세 번 넘게 삼')
check(maxOf(s14.notrim, 'btc') > maxOf(s14.plan, 'btc') + 0.05 && s14.notrim.vol > s14.plan.vol + 0.01, '2014~: 상한이 없으면 비트코인 비중과 변동성이 더 큼')
check(Math.abs(s14.plan.cagr - s14.fixed.cagr) < 0.005 && Math.abs(s14.plan.sharpe - s14.fixed.sharpe) < 0.05, '2014~: 매달 되돌린 경우와 연수익률 0.5%p, 샤프 0.05 안')
check(s14.hold.avgCash - s14.plan.avgCash > 0.05 && NOBTC.plan.cagr < NOBTC.hold.cagr, '2014~: 그냥 둔 경우가 현금을 5%p 넘게 더 들었고, 비트코인을 빼면 규칙이 낮음')
check([...SCEN, RECENT.five].every((s) => Math.abs(s.wait.cagr - s.plan.cagr) < 0.006), '현금 40%에서 1번 규칙을 기다린 경우와 기준 비중으로 시작한 경우의 연수익률 차이는 0.6%p 안')
check(SCEN.every((s) => s.plan.minCash > 0.19 && s.plan.maxCash < 0.45), '규칙대로면 현금이 19% 아래로도, 45% 위로도 가지 않음')
check(RECENT.five.ann.btc < 0.05 && RECENT.ann14.btc > 0.3, '최근 5년 비트코인 연수익률은 5% 아래, 2014년부터는 30% 위')
check(RECENT.byStart.every((r) => r.plan.cagr > r.hold.cagr - 0.001), '시작한 달 일곱 가지 모두 규칙대로가 그냥 둔 경우보다 낮지 않음')
check(RECENT.byStart.every((r) => r.plan.cagr >= RECENT.five.plan.cagr), '최근 5년이 일곱 가지 시작점 중 가장 낮음')
check(RECENT.byStart.every((r) => Math.abs(r.plan.cagr - r.fixed.cagr) < 0.011) && RECENT.byStart.some((r) => r.plan.cagr < r.fixed.cagr), '시작한 달 일곱 가지에서 규칙대로와 매달 되돌림은 1.1%p 안, 시작점에 따라 매달 되돌림이 더 높기도 함')
check(RECENT.five.plan.buys.length === 1 && RECENT.five.plan.buys[0].qdd < -0.3 && RECENT.five.plan.sells.length === 0 && RECENT.five.plan.cagr - RECENT.five.hold.cagr > 0.01, '최근 5년: QQQ가 30% 넘게 내렸을 때 한 번 샀고 판 날은 없으며, 그냥 둔 경우보다 1%p 넘게 높음')
check(SCEN[0].plan.cagr - NOBTC.plan.cagr > 0.04 && RECENT.five.plan.cagr - RECENT.five.nobtc.cagr < 0.02, '비트코인이 더한 연수익률: 2014년부터는 4%p 넘고 최근 5년은 2%p 아래')
check([RECENT.five.mix, RECENT.mixLong].every((m) => Math.abs(m.plan.cagr - m.btcOnly.cagr) < 0.01 && Math.abs(m.plan.mdd - m.btcOnly.mdd) < 0.03), '암호화폐 몫에 이더리움 20%를 섞어도 연수익률 차이는 1%p 안, 최대 낙폭 차이는 3%p 안')
check(SCEN[0].plan.cagr - RECENT.five.plan.cagr > 0.05, '2014년부터와 최근 5년의 연수익률 차이는 5%p 넘음')
check(SCEN.every((s) => Math.abs(s.plan.cagr - s.partial.cagr) < 0.004), '전부 되돌리는 경우와 필요한 만큼만 사고파는 경우의 연수익률 차이는 0.4%p 안')
check(s04.plan.medW('gold') > 0.085, '2004~: 금 비중의 중앙값이 8.5% 넘음')
check(UP_CASES.slice(0, 4).every(([, m]) => Math.abs(moved(m).cash - RULE.upper) < 0.003) && UP_CASES.slice(4).every(([, m]) => moved(m).cash < RULE.upper - 0.01), '현금 40%가 되는 경우 표')
check(DOWN_CASES.slice(0, 3).every(([, m]) => Math.abs(moved(m).cash - RULE.lower) < 0.003) && DOWN_CASES.slice(3).every(([, m]) => moved(m).cash > RULE.lower + 0.01), '현금 20%가 되는 경우 표')
check(Math.abs(s04.nolower.sharpe - s04.plan.sharpe) < 0.04, '2004~: 하한을 빼도 샤프는 비슷함')

// ── 그림 위주 도해 ──────────────────────────────────────────────────────────
const TINT = { buy: '#dfe9fb', sell: '#fde6da', hold: '#e6f6ef', off: '#eceef2' }
const arrowHead = (x, y, dir, color) => `<path d="M${x},${y}l${-dir * 9},-5v10z" fill="${color}"/>`

/** 현금 비중 눈금: 세 구역과 기준으로 돌아오는 화살표 */
const heroGauge = () => {
  const Wd = 688, H = 176, L = 20, R = 20, Y = 78, BH = 46, max = 0.6
  const x = (c) => L + (c / max) * (Wd - L - R)
  const zone = (a, b, fill, title, sub) => `<rect x="${x(a)}" y="${Y}" width="${x(b) - x(a)}" height="${BH}" fill="${fill}"/><text x="${(x(a) + x(b)) / 2}" y="${Y + 20}" text-anchor="middle" class="zt">${title}</text><text x="${(x(a) + x(b)) / 2}" y="${Y + 36}" text-anchor="middle" class="lbl2">${sub}</text>`
  const arc = (from, to, color) => { const x0 = x(from), x1 = x(to), dir = to > from ? 1 : -1; return `<path d="M${x0},${Y - 6}Q${(x0 + x1) / 2},${Y - 54} ${x1 - dir * 6},${Y - 10}" fill="none" stroke="${color}" stroke-width="2.5"/><path d="M${x1},${Y - 4}l${-dir * 11},-3l${dir * 4},-9z" fill="${color}"/>` }
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="현금 비중 눈금">
    <clipPath id="hg"><rect x="${x(0)}" y="${Y}" width="${x(max) - x(0)}" height="${BH}" rx="8"/></clipPath>
    <g clip-path="url(#hg)">
      ${zone(0, RULE.lower, TINT.sell, '팔아서 되돌림', `현금 ${p0(RULE.lower)} 이하`)}
      ${zone(RULE.lower, RULE.upper, TINT.hold, '그대로 둠', `${p0(RULE.lower)}와 ${p0(RULE.upper)} 사이`)}
      ${zone(RULE.upper, max, TINT.buy, '사서 되돌림', `현금 ${p0(RULE.upper)} 이상`)}
    </g>
    ${arc(RULE.lower / 2, RULE.target - 0.012, C.btc)}${arc((RULE.upper + max) / 2, RULE.target + 0.012, C.qqq)}
    <path d="M${x(RULE.target)},${Y + 1}l-6,-9h12z" fill="${C.ink}"/>
    <text x="${x(RULE.target)}" y="${Y - 62}" text-anchor="middle" class="zt">기준 ${p0(RULE.target)}</text>
    <text x="${x(RULE.target)}" y="${Y - 48}" text-anchor="middle" class="lbl2">${mixText(BASELINE)}</text>
    ${[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((c) => `<line x1="${x(c)}" x2="${x(c)}" y1="${Y + BH}" y2="${Y + BH + 5}" stroke="${C.ink3}"/><text x="${x(c)}" y="${Y + BH + 17}" text-anchor="middle" class="tick">${p0(c)}</text>`).join('')}
    <path d="M${x(RULE.target)},${Y + BH + 24}l-6,10h12z" fill="${C.ink}"/><text x="${x(RULE.target) + 10}" y="${Y + BH + 35}" class="lbl">지금은 기준 비중 근처 (1번 규칙은 2026년 11월 하락에서 씀)</text>
    <text x="${x(0)}" y="${H - 2}" class="axis">전체 자산에서 현금이 차지하는 비중</text>
  </svg>`
}

/** 현금은 그대로인데 비중이 달라지는 모습: 기준 → 움직인 뒤 → 되돌린 뒤 */
const triptych = () => {
  const Wd = 688, H = 236, base = 204, unit = 1.02, cw = 62
  const col = (cx, total, m, top, bottom) => {
    let y = base
    const segs = STACK.map((k) => { const h = m[k] * total * unit; y -= h; return `<rect x="${cx - cw / 2}" y="${y.toFixed(1)}" width="${cw}" height="${Math.max(0, h - 1.5).toFixed(1)}" rx="3" fill="${C[k]}"/>` }).join('')
    return `${segs}<text x="${cx}" y="${(base - total * unit - 20).toFixed(1)}" text-anchor="middle" class="zt">현금 ${p0(m.cash)}</text><text x="${cx}" y="${(base - total * unit - 7).toFixed(1)}" text-anchor="middle" class="lbl2">${top}</text><text x="${cx}" y="${base + 14}" text-anchor="middle" class="lbl2">${bottom}</text>`
  }
  const panel = (x0, title, mv, word, color) => {
    const m = moved(mv), total = 1 / (1 + 0) * (BASELINE.cash + BASELINE.qqq * (1 + (mv.qqq ?? 0)) + BASELINE.gold + BASELINE.btc) * 100
    const c1 = x0 + 50, c2 = x0 + 165, c3 = x0 + 280, ay = base - 40
    return `<text x="${x0 + 10}" y="14" class="zt">${title}</text>
      ${col(c1, 100, BASELINE, '전체 100', '기준 비중')}${col(c2, total, m, `전체 ${Math.round(total)}`, `QQQ ${mvp(mv.qqq)}`)}${col(c3, total, BASELINE, `전체 ${Math.round(total)}`, '되돌린 뒤')}
      <line x1="${c1 + cw / 2 + 8}" x2="${c2 - cw / 2 - 12}" y1="${ay}" y2="${ay}" stroke="${C.ink3}" stroke-width="1.5"/>${arrowHead(c2 - cw / 2 - 6, ay, 1, C.ink3)}
      <line x1="${c2 + cw / 2 + 8}" x2="${c3 - cw / 2 - 12}" y1="${ay}" y2="${ay}" stroke="${color}" stroke-width="2.5"/>${arrowHead(c3 - cw / 2 - 6, ay, 1, color)}
      <text x="${(c2 + c3) / 2}" y="${ay - 8}" text-anchor="middle" class="lbl">${word}</text>`
  }
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="현금 비중이 달라지는 모습">
    ${panel(0, 'QQQ가 반으로 내리면', { qqq: qqqMoveFor(RULE.upper) }, '삼', C.qqq)}
    <line x1="344" x2="344" y1="6" y2="${H - 8}" stroke="${C.grid}"/>
    ${panel(352, 'QQQ가 두 배로 오르면', { qqq: qqqMoveFor(RULE.lower) }, '팖', C.btc)}
  </svg>`
}

/** 규칙 카드에 넣는 작은 그림 */
const icon = (n) => {
  const g = { 1: `<polyline points="6,10 26,8 40,14 58,30 72,34" fill="none" stroke="${C.qqq}" stroke-width="2.5" stroke-linejoin="round"/><line x1="6" x2="86" y1="9" y2="9" stroke="${C.ink3}" stroke-dasharray="3 3"/><line x1="6" x2="86" y1="33" y2="33" stroke="${C.ink}" stroke-dasharray="3 3"/><text x="88" y="12" class="tick">최고가</text><text x="88" y="36" class="tick">−20%</text>`,
    2: `<rect x="6" y="14" width="100" height="16" rx="4" fill="${TINT.off}"/><rect x="39" y="14" width="34" height="16" fill="${TINT.hold}"/><rect x="6" y="14" width="33" height="16" rx="4" fill="${TINT.sell}"/><rect x="73" y="14" width="33" height="16" rx="4" fill="${TINT.buy}"/><line x1="56" x2="56" y1="10" y2="34" stroke="${C.ink}" stroke-width="2"/><line x1="22" x2="46" y1="8" y2="8" stroke="${C.btc}" stroke-width="2"/>${arrowHead(52, 8, 1, C.btc)}<line x1="90" x2="66" y1="8" y2="8" stroke="${C.qqq}" stroke-width="2"/>${arrowHead(60, 8, -1, C.qqq)}`,
    3: `<circle cx="16" cy="22" r="10" fill="none" stroke="${C.ink}" stroke-width="2"/><text x="16" y="26" text-anchor="middle" class="lbl">+</text><line x1="30" x2="48" y1="22" y2="22" stroke="${C.ink}" stroke-width="2"/>${arrowHead(54, 22, 1, C.ink)}${STACK.map((k, i) => `<rect x="${60 + [0, 15, 21, 46][i]}" y="14" width="${[14, 5, 24, 5][i]}" height="16" rx="2" fill="${C[k]}"/>`).join('')}`,
    4: `<rect x="6" y="6" width="22" height="30" rx="3" fill="${C.btc}"/><line x1="2" x2="50" y1="12" y2="12" stroke="${C.ink}" stroke-dasharray="3 3"/><text x="52" y="15" class="tick">20%</text><line x1="36" x2="64" y1="28" y2="28" stroke="${C.ink3}" stroke-width="1.5"/>${arrowHead(70, 28, 1, C.ink3)}<rect x="76" y="21" width="22" height="15" rx="3" fill="${C.btc}"/><text x="102" y="33" class="tick">10%</text>` }
  return `<svg viewBox="0 0 126 40" class="ic" role="img">${g[n]}</svg>`
}

/** 설명용 한 사이클: 만든 가격 길에 규칙을 그대로 적용한다(QQQ와 현금만) */
const CYCLE = (() => {
  const nodes = [[0, 100], [8, 104], [15, 82], [21, 96], [52, 168], [60, 150], [84, 225], [97, 84], [110, 128], [130, 152]]
  const pts = []
  for (let k = 1; k < nodes.length; k++) { const [t0, p0_] = nodes[k - 1], [t1, p1] = nodes[k]; for (let t = t0; t < t1; t += 0.25) pts.push([t, p0_ + ((p1 - p0_) * (t - t0)) / (t1 - t0)]) }
  pts.push(nodes.at(-1))
  let cash = RULE.target * 100, sh = ((1 - RULE.target) * 100) / pts[0][1], peak = 0, stepped = true // 1번 규칙은 이미 썼다
  const out = [], ev = []
  for (const [t, p] of pts) {
    peak = Math.max(peak, p)
    let T = cash + sh * p, cw = cash / T
    const reset = (kind) => { ev.push({ t, p, kind, from: cw }); cash = RULE.target * T; sh = ((1 - RULE.target) * T) / p; cw = RULE.target }
    if (!stepped && p / peak - 1 <= RULE.firstDd) { stepped = true; reset('first') } else if (stepped && cw >= RULE.upper) { reset('buy') } else if (cw <= RULE.lower) { reset('sell') }
    T = cash + sh * p
    out.push({ t, p, cw: cash / T, pre: ev.at(-1)?.t === t ? ev.at(-1).from : cash / T })
  }
  const before = out.filter((o) => o.t < ev[0].t), calm = before.reduce((m, o) => (o.p < m.p ? o : m)), top = Math.max(...before.filter((o) => o.t <= calm.t).map((o) => o.p))
  return { out, ev, tMax: nodes.at(-1)[0], calm: { ...calm, dd: calm.p / top - 1 } }
})()
const cycleChart = () => {
  const Wd = 688, L = 54, R = 20, T1 = 24, H1 = 112, G = 34, H2 = 112, H = T1 + H1 + G + H2 + 26
  const x = (t) => L + (t / CYCLE.tMax) * (Wd - L - R)
  const pmax = Math.max(...CYCLE.out.map((o) => o.p)) * 1.06, y1 = (p) => T1 + (1 - p / pmax) * H1
  const top2 = T1 + H1 + G, y2 = (c) => top2 + (1 - (c - 0.1) / 0.4) * H2
  const cashPath = []
  CYCLE.out.forEach((o) => { if (o.pre !== o.cw) cashPath.push([x(o.t), y2(o.pre)]); cashPath.push([x(o.t), y2(o.cw)]) })
  const names = { first: ['1번 규칙', 'QQQ가 최고가보다 20% 하락', '사서 현금 30%로'], sell: ['2번 규칙', '오래 올라 현금 20%', '팔아서 현금 30%로'], buy: ['2번 규칙', '크게 내려 현금 40%', '사서 현금 30%로'] }
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="한 번의 흐름을 그린 설명용 그림">
    <text x="${L - 8}" y="${T1 + 10}" text-anchor="end" class="lbl">QQQ</text><text x="${L - 8}" y="${T1 + 22}" text-anchor="end" class="lbl2">값</text>
    <text x="${L - 8}" y="${top2 - 12}" text-anchor="end" class="lbl">현금</text><text x="${L - 8}" y="${top2 - 1}" text-anchor="end" class="lbl2">비중</text>
    <rect x="${L}" y="${y2(RULE.upper)}" width="${Wd - L - R}" height="${y2(RULE.lower) - y2(RULE.upper)}" fill="${TINT.hold}"/>
    ${[RULE.lower, RULE.target, RULE.upper].map((c) => `<line x1="${L}" x2="${Wd - R}" y1="${y2(c)}" y2="${y2(c)}" stroke="${c === RULE.target ? C.ink3 : C.ink2}"${c === RULE.target ? ' stroke-dasharray="3 3"' : ''}/><text x="${L - 8}" y="${y2(c) + 3.5}" text-anchor="end" class="tick">${p0(c)}</text>`).join('')}
    ${CYCLE.ev.map((e) => `<line x1="${x(e.t)}" x2="${x(e.t)}" y1="${y1(e.p)}" y2="${y2(RULE.target)}" stroke="${C.ink3}" stroke-dasharray="2 3"/>`).join('')}
    <path d="${pathOf(CYCLE.out.map((o) => [x(o.t), y1(o.p)]))}" fill="none" stroke="${C.qqq}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${pathOf(cashPath)}" fill="none" stroke="${C.cash}" stroke-width="2.5" stroke-linejoin="round"/>
    ${CYCLE.ev.map((e, i) => { const n = names[e.kind], cx = x(e.t), right = cx + 150 > Wd - R, tx = right ? cx - 16 : cx + 16, an = right ? 'end' : 'start'
      return `<circle cx="${cx}" cy="${y1(e.p)}" r="9" fill="${C.ink}"/><text x="${cx}" y="${y1(e.p) + 3.5}" text-anchor="middle" class="num">${i + 1}</text>
      <circle cx="${cx}" cy="${y2(e.from)}" r="4" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/>
      <text x="${tx}" y="${y1(e.p) - (e.kind === 'sell' ? 14 : -18)}" text-anchor="${an}" class="lbl">${n[1]}</text>
      <text x="${tx}" y="${y2(e.from) + (e.kind === 'sell' ? 16 : -8)}" text-anchor="${an}" class="lbl">${n[2]}</text>` }).join('')}
    <circle cx="${x(CYCLE.calm.t)}" cy="${y1(CYCLE.calm.p)}" r="5" fill="#fff" stroke="${C.ink}" stroke-width="2"/><circle cx="${x(CYCLE.calm.t)}" cy="${y2(CYCLE.calm.cw)}" r="4" fill="#fff" stroke="${C.ink}" stroke-width="1.5"/>
    <text x="${x(CYCLE.calm.t) + 12}" y="${y1(CYCLE.calm.p) + 16}" class="lbl2">QQQ ${pct(CYCLE.calm.dd, 0)}: 현금 ${p0(CYCLE.calm.cw)}, 그대로 둠</text>
    <text x="${Wd - R}" y="${H - 6}" text-anchor="end" class="axis">시간 →</text>
  </svg>`
}

/** 확인 순서를 한 줄로 */
const rail = () => {
  const steps = [
    ['금이나 암호화폐가<br>20% 이상인가', '10%로 줄이고<br>판 돈은 현금에', '4번 규칙'],
    ['현금이<br>20% 이하인가', '전부 기준 비중으로<br>(팔아서 채움)', '2번 규칙'],
    ['현금이<br>40% 이상인가', '전부 기준 비중으로<br>(현금으로 삼)', '2번 규칙'],
    ['새로 들어온<br>돈이 있나', '현금이 기준보다 적으면<br>현금에, 아니면 모자란 자산', '3번 규칙'],
  ]
  return `<div class="rail">${steps.map(([q, a, r], i) => `<div class="rs"><div class="rq">${q}</div><div class="rn"><span>${i + 1}</span></div><div class="ra"><div class="rr">${r}</div>${a}</div></div>`).join('')}</div>`
}

/** QQQ와 암호화폐가 움직인 폭에 따라 무슨 일이 일어나는지 그린 지도 (금은 그대로) */
const phaseMap = () => {
  const Wd = 688, H = 440, L = 64, R = 18, T = 14, B = 46, Q0 = -0.9, Q1 = 1.5, B0 = -1, B1 = 2
  const x = (q) => L + ((q - Q0) / (Q1 - Q0)) * (Wd - L - R), y = (b) => T + (1 - (b - B0) / (B1 - B0)) * (H - T - B)
  const poly = (pts, fill, extra = '') => `<polygon points="${pts.map(([q, b]) => `${x(q).toFixed(1)},${y(b).toFixed(1)}`).join(' ')}" fill="${fill}"${extra}/>`
  const g = BASELINE, upB = (q) => (g.cash / RULE.upper - g.cash - g.gold - g.btc - g.qqq * (1 + q)) / g.btc // 현금 상한이 되는 암호화폐 폭
  const loB = (q) => (g.cash / RULE.lower - g.cash - g.gold - g.btc - g.qqq * (1 + q)) / g.btc
  const capB = (q) => (RULE.trimAt * (g.cash + g.gold + g.qqq * (1 + q)) - g.btc * (1 - RULE.trimAt)) / (g.btc * (1 - RULE.trimAt)) // 암호화폐가 상한이 되는 폭
  const inv = (f, b) => { let a = Q0 - 2, c = Q1 + 2; for (let k = 0; k < 60; k++) { const m = (a + c) / 2; if ((f(m) - b) * (f(a) - b) > 0) a = m; else c = m } return (a + c) / 2 }
  const qUpBot = inv(upB, B0), qUpTop = Math.max(Q0, inv(upB, B1)), qLoTop = inv(loB, B1), qLoBot = Math.min(Q1, inv(loB, B0)), qCapTop = Math.min(inv(capB, B1), qLoTop)
  const dots = PAST.map((e) => ({ label: e.label, q: e.m.qqq, b: e.m.btc, has: e.m.btc != null }))
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="QQQ와 암호화폐가 움직인 폭에 따른 결과">
    <defs><pattern id="hat" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f3f1ea"/><line x1="0" y1="0" x2="0" y2="7" stroke="#c9c6ba" stroke-width="2.5"/></pattern></defs>
    <rect x="${x(Q0)}" y="${y(B1)}" width="${x(Q1) - x(Q0)}" height="${y(B0) - y(B1)}" fill="${TINT.hold}"/>
    ${poly([[Q0, B0], [qUpBot, B0], [qUpTop, Math.min(B1, upB(qUpTop))], [Q0, Math.min(B1, upB(Q0))]], TINT.buy)}
    ${poly([[qLoTop, B1], [Q1, B1], [Q1, B0], [qLoBot, B0]], TINT.sell)}
    ${poly([[Q0, capB(Q0)], [qCapTop, B1], [Q0, B1]], 'url(#hat)')}
    ${[-0.8, -0.6, -0.4, -0.2, 0, 0.5, 1, 1.5].map((q) => `<line x1="${x(q)}" x2="${x(q)}" y1="${y(B0)}" y2="${y(B0) + 5}" stroke="${C.ink3}"/><text x="${x(q)}" y="${y(B0) + 17}" text-anchor="middle" class="tick">${q === 0 ? '그대로' : `${q > 0 ? '+' : '−'}${Math.abs(q * 100)}%`}</text>`).join('')}
    ${[-1, -0.5, 0, 0.5, 1, 1.5, 2].map((b) => `<line x1="${x(Q0) - 5}" x2="${x(Q0)}" y1="${y(b)}" y2="${y(b)}" stroke="${C.ink3}"/><text x="${x(Q0) - 8}" y="${y(b) + 3.5}" text-anchor="end" class="tick">${b === 0 ? '그대로' : `${b > 0 ? '+' : '−'}${Math.abs(b * 100)}%`}</text>`).join('')}
    <line x1="${x(0)}" x2="${x(0)}" y1="${y(B1)}" y2="${y(B0)}" stroke="#fff" stroke-width="1.5"/><line x1="${x(Q0)}" x2="${x(Q1)}" y1="${y(0)}" y2="${y(0)}" stroke="#fff" stroke-width="1.5"/>
    <text x="${x(-0.74)}" y="${y(-0.52)}" text-anchor="middle" class="zt">사서 되돌림</text><text x="${x(-0.74)}" y="${y(-0.52) + 14}" text-anchor="middle" class="lbl2">현금 ${p0(RULE.upper)} 이상</text>
    <text x="${x(1.22)}" y="${y(0.9)}" text-anchor="middle" class="zt">팔아서 되돌림</text><text x="${x(1.22)}" y="${y(0.9) + 14}" text-anchor="middle" class="lbl2">현금 ${p0(RULE.lower)} 이하</text>
    <text x="${x(0.42)}" y="${y(-0.55)}" text-anchor="middle" class="zt">그대로 둠</text><text x="${x(0.42)}" y="${y(-0.55) + 14}" text-anchor="middle" class="lbl2">현금 ${p0(RULE.lower)}와 ${p0(RULE.upper)} 사이</text>
    <text x="${x(-0.52)}" y="${y(1.72)}" text-anchor="middle" class="zt">암호화폐를 먼저 줄임</text><text x="${x(-0.52)}" y="${y(1.72) + 14}" text-anchor="middle" class="lbl2">암호화폐 ${p0(RULE.trimAt)} 이상 (4번 규칙)</text>
    <circle cx="${x(0)}" cy="${y(0)}" r="5" fill="#fff" stroke="${C.ink}" stroke-width="2"/><text x="${x(0) + 9}" y="${y(0) - 8}" class="lbl">기준 비중</text>
    ${dots.map((d, k) => `<circle cx="${x(d.q).toFixed(1)}" cy="${y(d.has ? d.b : 0).toFixed(1)}" r="5" fill="${d.has ? C.ink : '#fff'}" stroke="${C.ink}" stroke-width="2"/><text x="${(x(d.q) + (d.has ? 9 : 0)).toFixed(1)}" y="${(y(d.has ? d.b : 0) + (d.has ? 4 : k % 2 ? 19 : -11)).toFixed(1)}"${d.has ? '' : ' text-anchor="middle"'} class="lbl">${d.label}</text>`).join('')}
    <text x="${(x(Q0) + x(Q1)) / 2}" y="${H - 6}" text-anchor="middle" class="axis">QQQ가 움직인 폭 →</text>
    <text x="14" y="${(y(B0) + y(B1)) / 2}" text-anchor="middle" class="axis" transform="rotate(-90 14 ${(y(B0) + y(B1)) / 2})">암호화폐가 움직인 폭 →</text>
  </svg>`
}
/** 움직임 예시를 작은 카드로 */
const caseCards = (cases) => `<div class="cc">${cases.map(([label, m]) => { const w = moved(m); const hit = w.cash >= RULE.upper - 0.002 || w.cash <= RULE.lower + 0.002
  return `<div class="cci${hit ? '' : ' no'}"><div class="ccl">${[['QQQ', m.qqq], ['금', m.gold], ['암호화폐', m.btc]].filter(([, v]) => v != null && Math.abs(v) >= 0.005).map(([n, v]) => `${n} ${mvp(v)}`).join(', ')}</div>${mixBar(w)}<div class="ccv">현금 <b>${p0(w.cash)}</b></div></div>` }).join('')}</div>`

/** 작은 자산 가치 그림 (로그 눈금) */
const miniValue = (s) => {
  const Wd = 222, H = 104, L = 6, R = 6, T = 8, B = 16
  const t0 = Date.parse(s.dates[0]), t1 = Date.parse(s.dates.at(-1)), x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0)) * (Wd - L - R)
  const pick = (r) => r.series.filter((_, i) => i % 12 === 0 || i === r.series.length - 1)
  const all = [s.plan, s.hold].flatMap((r) => pick(r).map((p) => p.V)), l0 = Math.log(Math.min(...all) * 0.92), l1 = Math.log(Math.max(...all) * 1.08), y = (v) => T + (1 - (Math.log(v) - l0) / (l1 - l0)) * (H - T - B)
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img"><line x1="${L}" x2="${Wd - R}" y1="${y(100)}" y2="${y(100)}" stroke="${C.grid}"/>
    <path d="${pathOf(pick(s.hold).map((p) => [x(p.d), y(p.V)]))}" fill="none" stroke="${C.base}" stroke-width="1.8"/><path d="${pathOf(pick(s.plan).map((p) => [x(p.d), y(p.V)]))}" fill="none" stroke="${C.plan}" stroke-width="2"/>
    <text x="${L}" y="${H - 3}" class="tick">${s.dates[0].slice(0, 4)}</text><text x="${Wd - R}" y="${H - 3}" text-anchor="end" class="tick">${s.dates.at(-1).slice(0, 4)}</text></svg>`
}
/** 평균 현금 비중과 연수익률: 방식마다 점 하나 */
const cashVsReturn = (s) => {
  const Wd = 222, H = 168, L = 30, R = 88, T = 12, B = 30
  const pts = [['그냥 둠', s.hold, C.base, 0], ['매달 되돌림', s.fixed, C.ink, 1], ['규칙대로', s.plan, C.plan, 2], ['하한 없음', s.nolower, C.base, 3]]
  const xs = pts.map(([, r]) => r.avgCash), ys = pts.map(([, r]) => r.cagr)
  const x0 = Math.floor(Math.min(...xs) * 20) / 20 - 0.05, x1 = Math.ceil(Math.max(...xs) * 20) / 20 + 0.05, y0 = Math.floor(Math.min(...ys) * 100) / 100 - 0.01, y1 = Math.ceil(Math.max(...ys) * 100) / 100 + 0.01
  const x = (v) => L + ((v - x0) / (x1 - x0)) * (Wd - L - R), y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)
  const lab = pts.map(([n, r, color, k]) => ({ n, r, color, k, cy: y(r.cagr), ly: y(r.cagr) })).sort((a, b) => a.cy - b.cy)
  for (let k = 1; k < lab.length; k++) lab[k].ly = Math.max(lab[k].ly, lab[k - 1].ly + 12)
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img">
    ${[y0, (y0 + y1) / 2, y1].map((v) => `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end" class="tick">${pct(v, 0)}</text>`).join('')}
    ${[x0, x1].map((v) => `<text x="${x(v)}" y="${H - B + 12}" text-anchor="middle" class="tick">${p0(v)}</text>`).join('')}
    <text x="${(L + Wd - R) / 2}" y="${H - 4}" text-anchor="middle" class="axis">평균 현금 비중</text>
    ${lab.map((o) => `<line x1="${x(o.r.avgCash).toFixed(1)}" x2="${Wd - R + 2}" y1="${o.cy.toFixed(1)}" y2="${(o.ly - 3).toFixed(1)}" stroke="${C.grid}"/><text x="${Wd - R + 5}" y="${o.ly.toFixed(1)}" class="${o.k === 2 ? 'lbl' : 'lbl2'}">${o.n} ${pct(o.r.cagr)}</text>`).join('')}
    ${pts.map(([, r, color, k]) => `<circle cx="${x(r.avgCash).toFixed(1)}" cy="${y(r.cagr).toFixed(1)}" r="${k === 2 ? 5.5 : 4.5}" fill="${k === 1 ? '#fff' : color}" stroke="${color}" stroke-width="2"/>`).join('')}
  </svg>`
}
/** QQQ가 최고가에서 내린 폭과 20% 선에 닿은 날 */
const qqqDrawdown = () => {
  const Wd = 688, H = 150, L = 46, R = 16, T = 10, B = 22
  const dates = [...QQQ.keys()].sort(), t0 = Date.parse(dates[0]), t1 = Date.parse(dates.at(-1)), x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0)) * (Wd - L - R), y = (v) => T + (v / -0.9) * (H - T - B)
  let pk = 0
  const dd = dates.map((d) => { pk = Math.max(pk, QQQ.get(d)); return [d, QQQ.get(d) / pk - 1] }), keep = new Set(HITS_PAST.map((h) => h.d)), pts = dd.filter(([d], i) => i % 5 === 0 || keep.has(d))
  const line = pathOf(pts.map(([d, v]) => [x(d), y(v)]))
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="QQQ가 최고가에서 내린 폭">
    ${[0, -0.2, -0.4, -0.6, -0.8].map((v) => `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === RULE.firstDd ? C.ink : C.grid}"${v === RULE.firstDd ? ' stroke-dasharray="4 3"' : ''}/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <path d="${line}L${x(dates.at(-1))},${y(0)}L${x(dates[0])},${y(0)}Z" fill="${C.qqq}" opacity="0.12"/><path d="${line}" fill="none" stroke="${C.qqq}" stroke-width="1.5"/>
    ${HITS_PAST.map((h) => `<circle cx="${x(h.d).toFixed(1)}" cy="${y(RULE.firstDd)}" r="5" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/><text x="${x(h.d).toFixed(1)}" y="${y(RULE.firstDd) - 9}" text-anchor="middle" class="lbl">${h.d.slice(0, 4)}</text>`).join('')}
    ${[2000, 2005, 2010, 2015, 2020, 2025].map((yr) => `<text x="${x(`${yr}-01-01`)}" y="${H - 6}" text-anchor="middle" class="tick">${yr}</text>`).join('')}
  </svg>`
}
/** 계좌마다 무엇을 두는지 */
const accounts = () => {
  const seg = [['qqq', 'QQQ'], ['cash', '달러 단기 국채 ETF'], ['gold', '금'], ['btc', '암호화폐']]
  const card = (title, keys, note) => `<div class="acct"><div class="acct-t">${title}</div><div class="acct-k">${keys.map((k) => `<span class="lg"><span class="sw" style="--c:${C[k]}"></span>${seg.find(([key]) => key === k)[1]}</span>`).join('')}</div><div class="acct-n">${note}</div></div>`
  return `<div class="pbar">${seg.map(([k, label]) => `<div class="blk" style="flex:${BASELINE[k]};background-color:${C[k]}">${label}<small>${Math.round(BASELINE[k] * 100)}%</small></div>`).join('')}</div>
  <div class="accts">${card('증권사 계좌', ['qqq', 'cash'], '사고파는 일은 대부분 여기서 합니다. 살 때는 단기 국채 ETF를 팔아 삽니다.')}${card('KRX 금현물 계좌와 실물', ['gold'], '사고파는 것은 KRX 계좌에서만 합니다. 실물은 비중 계산에만 넣습니다.')}${card('거래소 계좌', ['btc'], `비트코인 ${CRYPTO.btc * 10}, 이더리움 ${CRYPTO.eth * 10}로 맞춥니다. 상한 ${p0(RULE.trimAt)}는 둘을 합친 비중으로 봅니다.`)}</div>`
}
/** 지금 확인할 숫자 세 가지를 계기판처럼 */
const dials = () => {
  const Wd = 688, H = 118, colW = 216, gap = 20
  const track = (x0, title, lo, hi, zones, pins, fmt, note) => {
    const L = x0 + 6, Wt = colW - 12, x = (v) => L + ((v - lo) / (hi - lo)) * Wt, Y = 44
    return `<text x="${x0}" y="14" class="zt">${title}</text>
      <rect x="${L}" y="${Y}" width="${Wt}" height="16" rx="4" fill="${TINT.off}"/>
      ${zones.map(([a, b, fill]) => `<rect x="${x(a)}" y="${Y}" width="${x(b) - x(a)}" height="16" fill="${fill}"/>`).join('')}
      ${pins.map(([v, label, color, below]) => `<line x1="${x(v)}" x2="${x(v)}" y1="${Y - 5}" y2="${Y + 21}" stroke="${color}" stroke-width="2.5"/><text x="${x(v)}" y="${below ? Y + 34 : Y - 9}" text-anchor="${v > lo + (hi - lo) * 0.8 ? 'end' : v < lo + (hi - lo) * 0.2 ? 'start' : 'middle'}" class="${below ? 'lbl2' : 'lbl'}">${label} ${fmt(v)}</text>`).join('')}
      <text x="${x0}" y="${H - 6}" class="lbl2">${note}</text>`
  }
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="지금 확인할 숫자">
    ${track(0, 'QQQ 종가', QNOW.last * 0.42, QNOW.peak, [[QNOW.last * 0.42, QNOW.last * (1 + qqqMoveFor(RULE.upper)), TINT.buy]], [[QNOW.last * (1 + qqqMoveFor(RULE.upper)), '현금 40% 근처', C.ink, true], [QNOW.last, '자료 마지막 날', C.qqq, false], [QNOW.peak, '최고가', C.ink3, true]], (v) => v.toFixed(0), `지금이 기준 비중이면 QQQ만 ${p0(-qqqMoveFor(RULE.upper))} 더 내려야 현금 ${p0(RULE.upper)}`)}
    ${track(colW + gap, '현금 비중', 0, 0.6, [[0, RULE.lower, TINT.sell], [RULE.lower, RULE.upper, TINT.hold], [RULE.upper, 0.6, TINT.buy]], [[RULE.target, '지금 약', C.ink, false], [RULE.lower, '', C.ink3, true], [RULE.upper, '', C.ink3, true]], p0, `${p0(RULE.lower)} 이하면 팔아서, ${p0(RULE.upper)} 이상이면 사서 되돌림`)}
    ${track(2 * (colW + gap), '금, 암호화폐 비중', 0, 0.25, [[0, RULE.trimAt, TINT.hold], [RULE.trimAt, 0.25, TINT.sell]], [[NOW.gold, '지금 각각', C.ink, false], [RULE.trimAt, '상한', C.ink3, true]], p0, `${p0(RULE.trimAt)} 이상이면 ${p0(RULE.trimTo)}로 줄임`)}
  </svg>`
}
const toggle = (on, title, note) => `<div class="tg"><span class="sw2${on ? ' on' : ''}"><i></i></span><div><b>${title}</b><span>${note}</span></div></div>`
const stat = (big, cap) => `<div class="stat"><div class="sb">${big}</div><div class="sc">${cap}</div></div>`
const taxCard = (asset, badge, note, color) => `<div class="tax"><div class="tb2" style="background-color:${color}">${badge}</div><div><b>${asset}</b><span>${note}</span></div></div>`
const evid = (title, body, cap = '') => `<div class="ev"><div class="evt">${title}</div>${body}${cap ? `<div class="evc">${cap}</div>` : ''}</div>`
const cashW = (r) => r.series.map((p) => ({ d: p.d, v: p.w.cash }))

const css = `
@page { size: A4; margin: 14mm 13mm 14mm 13mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'IBM Plex Sans KR', sans-serif; color: ${C.ink}; font-size: 10.5pt; line-height: 1.6; word-break: keep-all; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
h1 { font-size: 24pt; line-height: 1.25; margin: 0 0 6pt; letter-spacing: -0.01em; }
h2 { font-size: 15pt; margin: 2pt 0 4pt; }
h3 { font-size: 10.5pt; margin: 12pt 0 2pt; }
.hint { font-weight: 400; color: ${C.ink3}; font-size: 8.5pt; margin-left: 6pt; }
.kicker { font-size: 8.5pt; color: #2962ff; font-weight: 700; letter-spacing: 0.04em; }
.sub { color: ${C.ink2}; margin: 0 0 8pt; font-size: 9.5pt; }
.lead { font-size: 11.5pt; margin: 0 0 12pt; }
svg { width: 100%; height: auto; display: block; }
svg text { font-family: 'IBM Plex Sans KR', sans-serif; }
.tick { font-size: 8px; fill: ${C.ink3}; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; }
.lbl { font-size: 9.5px; fill: ${C.ink}; font-weight: 500; }
.big { font-size: 11px; fill: ${C.ink}; font-weight: 500; }
.lbl2 { font-size: 9px; fill: ${C.ink2}; }
.axis { font-size: 9px; fill: ${C.ink2}; }
.legend { display: flex; flex-wrap: wrap; gap: 4pt 14pt; font-size: 8.5pt; color: ${C.ink2}; margin: 2pt 0 2pt; }
.lg { display: inline-flex; align-items: center; gap: 5pt; }
.ln { width: 16pt; height: 0; border-top: 2px solid var(--c); }
.rule { width: 16pt; height: 0; border-top: 1.5px solid var(--c); }
.sw { width: 9pt; height: 9pt; border-radius: 2px; background: var(--c); }
.dot { width: 8pt; height: 8pt; border-radius: 50%; background: var(--c); }
.dia { width: 6pt; height: 6pt; background: #fff; border: 1.5px solid var(--c); transform: rotate(45deg); }
.rules { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin: 10pt 0; }
.rulecard { border: 1px solid #e0e3eb; border-radius: 8px; padding: 9pt 11pt; break-inside: avoid; }
.rulecard b { display: block; font-size: 10.5pt; margin-bottom: 2pt; }
.rulecard .no { display: inline-block; width: 16pt; height: 16pt; line-height: 16pt; text-align: center; border-radius: 50%; background: #2962ff; color: #fff; font-size: 8.5pt; font-weight: 700; margin-right: 6pt; }
.rulecard p { margin: 0; color: ${C.ink2}; font-size: 9.5pt; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 6pt 0 4pt; }
.tile { border: 1px solid #e0e3eb; border-radius: 8px; padding: 7pt 9pt; }
.tl { font-size: 8.5pt; color: ${C.ink2}; }
.tv { font-size: 16pt; font-weight: 700; line-height: 1.3; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; }
.tb { font-size: 8.5pt; color: ${C.ink3}; }
.take { margin: 8pt 0 0; padding-left: 14pt; font-size: 9.5pt; }
.take li { margin-bottom: 2pt; }
table.t { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 6pt 0; }
table.t th { text-align: left; font-weight: 600; color: ${C.ink2}; border-bottom: 1px solid #c9ccd4; padding: 4pt 6pt; vertical-align: bottom; }
table.t td { border-bottom: 1px solid #eceef2; padding: 4pt 6pt; vertical-align: top; }
table.t .n { text-align: right; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; white-space: nowrap; }
table.t th.n { font-family: inherit; }
table.t.dense td { padding: 2pt 6pt; font-size: 8.6pt; }
table.t.mv td { vertical-align: middle; padding: 2.5pt 6pt; }
table.t.mv .bar { height: 11pt; }
table.t.dense { margin: 3pt 0; }
table.t tr.sep td { border-top: 1.5px solid #c9ccd4; }
table.t tr.pick td { background: #f4f7ff; font-weight: 600; }
.foot { font-size: 8.5pt; color: ${C.ink3}; margin: 4pt 0 0; }
.flow { display: grid; gap: 6pt; margin: 8pt 0; }
.step { display: grid; grid-template-columns: 22pt 1fr 1fr; gap: 8pt; align-items: stretch; break-inside: avoid; }
.step .no { width: 20pt; height: 20pt; line-height: 20pt; text-align: center; border-radius: 50%; background: ${C.ink}; color: #fff; font-size: 9pt; font-weight: 700; margin-top: 6pt; }
.q, .a { border: 1px solid #e0e3eb; border-radius: 8px; padding: 7pt 10pt; font-size: 9.5pt; }
.q b { display: block; }
.a { background: #f6f8fb; }
.a .yes { font-weight: 700; color: #2962ff; margin-right: 4pt; }
.bars { display: grid; gap: 6pt; margin: 8pt 0; }
.bar-row { display: grid; grid-template-columns: 96pt 1fr 190pt; gap: 10pt; align-items: center; font-size: 9.5pt; }
.bar { display: flex; gap: 2px; height: 14pt; }
.seg { display: block; height: 100%; border-radius: 3px; }
.bar-v { color: ${C.ink2}; font-size: 9pt; }
.take b { font-weight: 700; }
.chips { display: grid; grid-template-columns: auto auto 1fr; gap: 3pt 5pt; align-items: center; justify-items: start; margin: 4pt 0 3pt; font-size: 9pt; }
.chip { border-radius: 5px; padding: 1.5pt 6pt; line-height: 1.4; white-space: nowrap; }
.chip.cond { border: 1px solid #c9ccd4; background: #fff; }
.chip.act { background: #e6edff; font-weight: 600; }
.arr { color: ${C.ink3}; }
.why { display: grid; grid-template-columns: 45% 1fr; gap: 16pt; padding: 9pt 0 7pt; border-top: 1px solid #e0e3eb; break-inside: avoid; }
.whyt { font-weight: 700; font-size: 10.5pt; margin-bottom: 4pt; }
.whyt .no { display: inline-block; width: 16pt; height: 16pt; line-height: 16pt; text-align: center; border-radius: 50%; background: #2962ff; color: #fff; font-size: 8.5pt; font-weight: 700; margin-right: 6pt; }
.why ul { margin: 0; padding-left: 13pt; font-size: 9.3pt; line-height: 1.55; }
.why li { margin-bottom: 2.5pt; }
.cap { font-size: 8.5pt; color: ${C.ink2}; font-weight: 600; margin-bottom: 4pt; }
.tri { width: 0; height: 0; border-left: 4.5pt solid transparent; border-right: 4.5pt solid transparent; border-bottom: 8pt solid var(--c); }
.band { width: 13pt; height: 8pt; background: color-mix(in srgb, var(--c) 18%, #fff); border-top: 1px solid #52514e; border-bottom: 1px solid #52514e; }
.zt { font-size: 11.5px; font-weight: 700; fill: ${C.ink}; }
.num { font-size: 10px; font-weight: 700; fill: #fff; }
.rt { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; }
.rti { border: 1px solid #e0e3eb; border-radius: 8px; padding: 8pt 9pt; font-size: 8.8pt; line-height: 1.45; }
.rti .no, .evt .no { display: inline-block; width: 15pt; height: 15pt; line-height: 15pt; text-align: center; border-radius: 50%; background: #2962ff; color: #fff; font-size: 8pt; font-weight: 700; margin-right: 5pt; }
.rti b { font-size: 9.8pt; }
.rti.done { background: #f4f6f9; } .rti.done .no { background: ${C.ink3}; } .rti.done svg { opacity: 0.45; } .rti em { font-style: normal; font-size: 8pt; font-weight: 700; color: ${C.ink2}; border: 1px solid ${C.ink3}; border-radius: 9px; padding: 0 5pt; margin-left: 5pt; }
.rti p { margin: 2pt 0 0; color: ${C.ink2}; }
.ic { width: 100%; height: auto; margin: 6pt 0 2pt; }
.rail { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 6pt 0 8pt; }
.rs { display: grid; grid-template-rows: 42pt 22pt auto; text-align: center; font-size: 8.8pt; line-height: 1.4; position: relative; }
.rq { font-weight: 600; align-self: end; padding: 0 4pt 4pt; }
.rn { position: relative; }
.rn::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 2px solid #c9ccd4; }
.rs:first-child .rn::before { left: 50%; } .rs:last-child .rn::before { right: 50%; }
.rn span { position: relative; display: inline-block; width: 20pt; height: 20pt; line-height: 20pt; border-radius: 50%; background: ${C.ink}; color: #fff; font-weight: 700; font-size: 9pt; }
.ra { background: #f4f6f9; border-radius: 8px; margin: 4pt 3pt 0; padding: 5pt 4pt 6pt; color: ${C.ink}; }
.rr { font-size: 7.8pt; color: #2962ff; font-weight: 700; }
.pipe { display: grid; grid-template-columns: 1fr auto 1.5fr auto 1.3fr; gap: 6pt; align-items: stretch; margin: 6pt 0; }
.pipe.three { grid-template-columns: 1fr 1fr 1.3fr; gap: 8pt; }
.pipe > div { border: 1px solid #e0e3eb; border-radius: 8px; padding: 6pt 9pt; font-size: 8.8pt; line-height: 1.45; }
.pipe b { display: block; font-size: 9.5pt; } .pipe span { color: ${C.ink2}; }
.pipe > i { align-self: center; font-style: normal; color: ${C.ink3}; font-size: 12pt; }
.cc { display: grid; gap: 5pt; }
.cci { display: grid; grid-template-columns: 44% 1fr 52pt; gap: 8pt; align-items: center; font-size: 8.8pt; }
.cci .bar { height: 12pt; } .ccv { text-align: right; white-space: nowrap; } .ccv b { font-family: 'IBM Plex Mono', monospace; }
.strip { border-top: 1px solid #e0e3eb; padding: 7pt 0 2pt; break-inside: avoid; }
.sh b { font-size: 11pt; }
.kp { display: flex; flex-wrap: wrap; gap: 3pt 16pt; font-size: 9pt; margin: 2pt 0 2pt; }
.kp b { font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; font-size: 10.5pt; } .kp i, .kv i { font-style: normal; color: ${C.ink3}; }
.trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14pt; }
.kv { font-size: 9pt; line-height: 1.5; margin-top: 2pt; } .kv b { font-family: 'IBM Plex Mono', monospace; font-size: 12pt; color: ${C.ink}; }
.evg { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18pt; }
.ev { border-top: 1px solid #e0e3eb; padding: 7pt 0 5pt; break-inside: avoid; }
.evt { font-weight: 700; font-size: 10pt; margin-bottom: 4pt; }
.evc { font-size: 8.5pt; color: ${C.ink2}; margin-top: 3pt; line-height: 1.5; }
.pbar { display: flex; gap: 3px; height: 34pt; margin: 4pt 0 6pt; }
.accts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin: 4pt 0; }
.acct-k { display: flex; flex-wrap: wrap; gap: 2pt 10pt; font-size: 8.6pt; margin-bottom: 3pt; }
.acct { border: 1px solid #e0e3eb; border-radius: 8px; padding: 7pt 8pt; font-size: 8.6pt; line-height: 1.45; }
.acct-t { font-weight: 700; font-size: 9.5pt; margin-bottom: 4pt; }
.blk { border-radius: 5px; padding: 4pt 6pt; color: #0b0b0b; font-weight: 600; font-size: 8.6pt; overflow: hidden; background-image: linear-gradient(rgba(255,255,255,.55), rgba(255,255,255,.55)); }
.blk small { display: block; font-family: 'IBM Plex Mono', monospace; font-weight: 500; }
.acct-n { color: ${C.ink2}; }
.tgs { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 14pt; margin: 4pt 0; }
.tg { display: flex; gap: 8pt; align-items: center; font-size: 8.8pt; line-height: 1.4; }
.tg b { display: block; font-size: 9.5pt; } .tg span { color: ${C.ink2}; }
.sw2 { flex: none; width: 30pt; height: 16pt; border-radius: 8pt; background: #c9ccd4; position: relative; }
.sw2 i { position: absolute; top: 2pt; left: 2pt; width: 12pt; height: 12pt; border-radius: 50%; background: #fff; }
.sw2.on { background: #1baf7a; } .sw2.on i { left: 16pt; }
.taxes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6pt; margin: 4pt 0; }
.tax { display: flex; gap: 7pt; align-items: flex-start; border: 1px solid #e0e3eb; border-radius: 8px; padding: 6pt 8pt; font-size: 8.4pt; line-height: 1.4; }
.tax b { display: block; font-size: 9.2pt; } .tax span { color: ${C.ink2}; }
.tb2 { flex: none; min-width: 34pt; text-align: center; border-radius: 6px; padding: 3pt 4pt; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; font-weight: 700; font-size: 9.5pt; color: #0b0b0b; background-image: linear-gradient(rgba(255,255,255,.6), rgba(255,255,255,.6)); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin: 6pt 0; }
.stat { border: 1px solid #e0e3eb; border-radius: 8px; padding: 8pt 10pt; }
.sb { font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; font-weight: 700; font-size: 17pt; line-height: 1.2; }
.sc { font-size: 8.8pt; color: ${C.ink2}; line-height: 1.45; margin-top: 2pt; }
.note { border-left: 3px solid #2962ff; background: #f4f7ff; padding: 7pt 11pt; font-size: 9.5pt; margin: 10pt 0; border-radius: 0 6px 6px 0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
`

const strip = (s) => `<div class="strip">
  <div class="sh"><b>${s.title}</b><span class="hint">${s.sub}</span></div>
  <div class="kp"><span>연수익률 <b>${pct(s.plan.cagr)}</b> <i>그냥 두면 ${pct(s.hold.cagr)}</i></span><span>최대 낙폭 <b>${pct(s.plan.mdd)}</b> <i>그냥 두면 ${pct(s.hold.mdd)}</i></span><span>산 날 <b>${s.plan.buys.length}번</b></span><span>팔아서 채운 날 <b>${s.plan.sells.length}번</b></span></div>
  ${cashChart(s, { PH: 92, LH: 25 })}
</div>`
const trio = (f) => `<div class="trio">${SCEN.map((s) => `<div><div class="cap">${s.title.replace(/ \(.*\)/, '')}</div>${f(s)}</div>`).join('')}</div>`

/** 시작한 달만 바꾼 결과: 시작점마다 규칙대로 한 점과 그냥 둔 점 */
const startChart = () => {
  const rs = RECENT.byStart, Wd = W, H = 208, L = 46, R = 14, T = 16, PB = 132, n = rs.length
  const vals = rs.flatMap((r) => [r.plan.cagr, r.hold.cagr]), y0 = Math.floor(Math.min(...vals) * 50) / 50 - 0.02, y1 = Math.ceil(Math.max(...vals) * 50) / 50 + 0.02
  const cw = (Wd - L - R) / n, cx = (i) => L + cw * (i + 0.5), y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (PB - T)
  const ticks = []; for (let v = Math.ceil(y0 * 20) / 20; v <= y1 + 1e-9; v += 0.05) ticks.push(v)
  const rowY = [PB + 20, PB + 38, PB + 53, PB + 68]
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="시작한 달에 따른 연수익률">
    ${rs.map((r, i) => (r.back === 5 ? `<rect x="${(L + cw * i + 4).toFixed(1)}" y="${T - 12}" width="${(cw - 8).toFixed(1)}" height="${H - T + 10}" rx="6" fill="#f4f6f9"/>` : '')).join('')}
    ${ticks.map((v) => `<line x1="${L}" x2="${Wd - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    ${rs.map((r, i) => `<line x1="${cx(i).toFixed(1)}" x2="${cx(i).toFixed(1)}" y1="${y(r.plan.cagr).toFixed(1)}" y2="${y(r.hold.cagr).toFixed(1)}" stroke="${C.ink3}" stroke-width="1.5"/>
      <circle cx="${cx(i).toFixed(1)}" cy="${y(r.hold.cagr).toFixed(1)}" r="4.5" fill="${C.base}" stroke="#fff" stroke-width="1.5"/><circle cx="${cx(i).toFixed(1)}" cy="${y(r.plan.cagr).toFixed(1)}" r="5.5" fill="${C.plan}" stroke="#fff" stroke-width="1.5"/>
      <text x="${(cx(i) + 9).toFixed(1)}" y="${(y(r.plan.cagr) + 3.5).toFixed(1)}" class="lbl">${pct(r.plan.cagr)}</text><text x="${(cx(i) + 9).toFixed(1)}" y="${Math.max(y(r.hold.cagr) + 3.5, y(r.plan.cagr) + 14.5).toFixed(1)}" class="lbl2">${pct(r.hold.cagr)}</text>
      <text x="${cx(i).toFixed(1)}" y="${rowY[0]}" text-anchor="middle" class="lbl">${ymK(r.dates[0])}</text>
      <text x="${cx(i).toFixed(1)}" y="${rowY[1]}" text-anchor="middle" class="lbl2">${pct(r.ann.qqq, 0)}</text><text x="${cx(i).toFixed(1)}" y="${rowY[2]}" text-anchor="middle" class="lbl2" style="${r.ann.btc < 0.05 ? `fill:${C.btc};font-weight:700` : ''}">${pct(r.ann.btc, 0)}</text><text x="${cx(i).toFixed(1)}" y="${rowY[3]}" text-anchor="middle" class="lbl2">${pct(r.ann.gold, 0)}</text>`).join('')}
    ${[['시작', 0], ['QQQ', 1], ['비트코인', 2], ['금', 3]].map(([t, k]) => `<text x="${L - 6}" y="${rowY[k]}" text-anchor="end" class="tick">${t}</text>`).join('')}
  </svg>`
}
const pp = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(1)}%p`
const recentPage = () => { const f = RECENT.five, a5 = f.ann, a14 = RECENT.ann14, gap = RECENT.byStart.map((r) => r.plan.cagr - r.fixed.cagr); return `<section class="page">
  <div class="kicker">최근 5년</div>
  <h2>비트코인이 오르지 않은 5년으로 좁히면</h2>
  <p class="sub">${ymK(f.dates[0])}은 QQQ와 비트코인이 함께 고점이던 때입니다. 같은 규칙의 연수익률이 2014년부터는 ${pct(SCEN[0].plan.cagr)}, 이때부터 5년은 ${pct(f.plan.cagr)}입니다.</p>
  <div class="cols">
    <div><div class="cap">자산별 연수익률 <span class="hint">옅은 색이 2014년부터, 진한 색이 최근 5년</span></div>
      ${hbars([['QQQ', 'qqq'], ['비트코인', 'btc'], ['금', 'gold']].flatMap(([nm, k]) => [{ label: `${nm} 2014년부터`, v: a14[k], text: pct(a14[k]), color: `${C[k]}66` }, { label: `${nm} 최근 5년`, v: a5[k], text: pct(a5[k]), color: C[k] }]), { Wd: 330, L: 112, R: 48, rh: 17 })}</div>
    <div><div class="cap">최근 5년의 결과 <span class="hint">연수익률, 괄호는 최대 낙폭</span></div>
      ${hbars([['규칙대로', f.plan, C.plan], ['매달 되돌림', f.fixed, C.ink2], ['현금 40%에서 기다림', f.wait, C.ink3], ['그냥 둠', f.hold, C.base]].map(([l, r, color]) => ({ label: l, v: r.cagr, text: `${pct(r.cagr)} (${pct(r.mdd)})`, color })), { Wd: 330, L: 112, R: 96, rh: 17 })}
      <p class="foot">세금 ${p0(RULE.taxRate)}를 넣으면 규칙대로 ${pct(f.tax.cagr)}, 그냥 둠 ${pct(f.holdTax.cagr)}입니다.</p></div>
  </div>
  ${strip(f)}
  <p class="foot" style="margin-bottom:4pt">${ymK(f.plan.buys[0].d)}에 현금이 ${p0(RULE.upper)}가 되어 한 번 샀습니다. 그때 QQQ는 최고가보다 ${p0(-f.plan.buys[0].qdd)} 낮았습니다. 현금이 ${p0(RULE.lower)}가 되어 판 날은 없습니다.</p>
  <h3>시작한 달만 바꾸면 <span class="hint">끝은 모두 ${ymK(f.dates.at(-1))}. 아래 세 줄은 그 기간 자산별 연수익률</span></h3>
  ${legend([['dot', C.plan, '규칙대로'], ['dot', C.base, '그냥 둠']])}
  ${startChart()}
  <div class="stats">
    ${stat(`${pp(SCEN[0].plan.cagr - NOBTC.plan.cagr).replace('%p', '')} → ${pp(f.plan.cagr - f.nobtc.cagr)}`, '비트코인이 연수익률에 더한 폭(2014년부터 → 최근 5년). 비트코인 몫을 QQQ에 넣은 경우와 비교')}
    ${stat(pp(f.plan.cagr - f.hold.cagr), `그냥 둔 경우보다 높은 폭. ${ymK(f.plan.buys[0].d)}에 현금 ${p0(RULE.upper)}가 되어 한 번 산 덕입니다`)}
    ${stat(`${pp(Math.min(...gap)).replace('%p', '')}~${pp(Math.max(...gap))}`, '시작한 달 일곱 가지에서 매달 되돌린 경우와의 차이. 규칙이 더 버는 것은 아닙니다')}
  </div>
  <p class="foot">최근 5년은 일곱 가지 시작점 중 가장 나쁜 경우입니다. 앞으로를 낮춰 잡는 기준으로는 쓸 만하지만, 한 구간의 결과입니다.</p>
  <p class="foot">암호화폐 몫을 비트코인 ${CRYPTO.btc * 10}, 이더리움 ${CRYPTO.eth * 10}로 두면 최근 5년 ${pct(f.mix.plan.cagr)} / ${pct(f.mix.plan.mdd)}, ${ymK(RECENT.mixLong.dates[0])}부터는 ${pct(RECENT.mixLong.plan.cagr)} / ${pct(RECENT.mixLong.plan.mdd)}입니다(비트코인만이면 ${pct(RECENT.mixLong.btcOnly.cagr)} / ${pct(RECENT.mixLong.btcOnly.mdd)}). 위 그림은 비트코인만으로 계산했습니다.</p>
</section>` }

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>현금 비중으로 사고파는 규칙</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>

<section class="page">
  <div class="kicker">운용 규칙, 2026.11.21 고침, 자료는 ${ymd(QNOW.lastDay)}까지</div>
  <h1>현금 비중으로 사고파는 규칙</h1>
  <p class="lead">현금이 ${p0(RULE.lower)} 이하나 ${p0(RULE.upper)} 이상이 되면 전부 기준 비중으로 되돌립니다.</p>
  ${heroGauge()}

  <h3>현금은 그대로인데 비중이 달라집니다 <span class="hint">막대 높이가 전체 자산의 크기입니다</span></h3>
  ${triptych()}
  ${legend([['sw', C.cash, '현금 (달러 단기 국채 ETF)'], ['sw', C.gold, '금'], ['sw', C.qqq, 'QQQ'], ['sw', C.btc, '암호화폐']])}

  <h3>규칙 네 가지 <span class="hint">1번은 이미 썼습니다. 지금부터는 2, 3, 4번만 봅니다</span></h3>
  <div class="rt">
    <div class="rti done"><span class="no">1</span><b>처음 한 번</b><em>완료</em>${icon(1)}<p>2026년 11월, QQQ가 최고가보다 ${p0(-RULE.firstDd)} 가까이 내렸을 때 썼습니다. 현금 ${p0(RULE.startCash)} → ${p0(RULE.target)}</p></div>
    <div class="rti"><span class="no">2</span><b>현금 ${p0(RULE.lower)}와 ${p0(RULE.upper)}</b>${icon(2)}<p>${p0(RULE.lower)} 이하나 ${p0(RULE.upper)} 이상이면 전부 기준 비중으로</p></div>
    <div class="rti"><span class="no">3</span><b>새로 들어오는 돈</b>${icon(3)}<p>현금이 기준보다 적으면 현금에, 아니면 모자란 자산에</p></div>
    <div class="rti"><span class="no">4</span><b>금, 암호화폐 상한</b>${icon(4)}<p>${p0(RULE.trimAt)} 이상이면 ${p0(RULE.trimTo)}로 줄이고 현금에</p></div>
  </div>
</section>

<section class="page">
  <div class="kicker">규칙이 움직이는 모습</div>
  <h2>오르내리는 동안 일어나는 일</h2>
  <p class="sub">설명하려고 만든 그림입니다(실제 자료 아님). 위는 QQQ 값, 아래는 그때의 현금 비중입니다.</p>
  ${cycleChart()}

  <h3>확인하는 순서 <span class="hint">위 질문에 해당하면 아래대로 합니다. 왼쪽부터 차례로 봅니다</span></h3>
  ${rail()}
  <div class="pipe">
    <div><b>직접 확인</b><span>그날 종가로 봅니다</span></div><i>→</i>
    <div><b>다음 거래일 종가에 사고팖</b><span>그사이 조건이 풀렸어도, 늦게 알았어도 그대로</span></div><i>→</i>
    <div><b>크기는 그날 비중으로</b><span>전체의 ${(RULE.minTrade * 100).toFixed(1)}%보다 작으면 하지 않음</span></div>
  </div>

  <h3>지금 확인할 숫자 <span class="hint">자료의 수정주가 기준입니다. 증권사 화면의 종가로 다시 확인해야 합니다</span></h3>
  ${dials()}
  <p class="foot">QQQ 역대 최고 종가 ${usd(QNOW.peak)}(${ymdK(QNOW.peakDay)}), 자료 마지막 날 ${usd(QNOW.last)}(최고 종가보다 ${pct(-QNOW.dd)} 낮음). 1번 규칙은 이 하락에서 썼고, 다음에 사는 때는 현금이 ${p0(RULE.upper)}가 되는 날입니다.</p>
</section>

<section class="page">
  <div class="kicker">얼마나 움직여야 하나</div>
  <h2>QQQ와 암호화폐가 이만큼 움직이면</h2>
  <p class="sub">기준 비중에서 출발해 금은 그대로라고 보고 그렸습니다. 검은 점은 과거 하락 때 실제로 움직인 폭이고, 흰 점은 비트코인 자료가 없던 때입니다.</p>
  ${phaseMap()}

  <div class="cols" style="margin-top:6pt">
    <div><h3 style="margin-top:4pt">현금이 ${p0(RULE.upper)}가 되는 예</h3>${caseCards(UP_CASES.slice(0, 4))}</div>
    <div><h3 style="margin-top:4pt">현금이 ${p0(RULE.lower)}가 되는 예</h3>${caseCards(DOWN_CASES.slice(0, 3))}
      <div class="cap" style="margin-top:8pt">현금이 ${p0(RULE.target)}가 아닐 때, ${p0(RULE.upper)}가 되는 데 필요한 하락</div>
      ${hbars([0.2, 0.25, 0.3, 0.35, 0.39].map((c) => ({ label: `현금 ${p0(c)}에서`, v: fallFor(c), text: p0(fallFor(c)) })), { Wd: 330, L: 84, R: 40, rh: 16, max: 0.7 })}
    </div>
  </div>
</section>

<section class="page">
  <div class="kicker">과거 자료</div>
  <h2>과거에 이 규칙대로 했다면</h2>
  <p class="sub">지금처럼 기준 비중에서 시작해 현금 ${p0(RULE.lower)}와 ${p0(RULE.upper)}, 금과 암호화폐 상한만으로 움직인 기록입니다.</p>
  ${legend([['ln', C.cash, '현금 비중'], ['band', C.cash, '사고팔지 않는 범위'], ['dot', C.ink, '산 날'], ['dia', C.ink, '팔아서 현금을 채운 날'], ['tri', C.btc, '비트코인을 줄인 날'], ['tri', C.gold, '금을 줄인 날']])}
  <p class="foot" style="margin:2pt 0 6pt">아래 줄의 숫자는 그날 현금 비중이 바뀐 폭(%p)입니다. 세로 점선을 따라 올라가면 그 자리입니다.</p>
  ${SCEN.map(strip).join('')}
</section>

<section class="page">
  <div class="kicker">결과</div>
  <h2>규칙이 주는 것은 수익률이 아니라 현금 비중입니다</h2>
  <p class="sub">파란 선과 점이 규칙대로 한 경우, 회색이 그냥 둔 경우입니다.</p>
  <h3>자산 가치 <span class="hint">시작 = 100, 로그 눈금</span></h3>
  ${trio((s) => `${miniValue(s)}<div class="kv"><b>${pct(s.plan.cagr)}</b> 규칙대로<br><i>${pct(s.hold.cagr)} 그냥 둠</i></div>`)}

  <h3>현금을 적게 들수록 수익률이 높습니다 <span class="hint">방식마다 점 하나. 규칙대로 한 점은 매달 되돌린 점 옆에 있습니다</span></h3>
  ${trio((s) => cashVsReturn(s))}

  <div class="cols" style="margin-top:8pt">
    <div><div class="cap">최대 낙폭</div>${hbars(SCEN.flatMap((s) => [['규칙대로', s.plan, C.plan], ['매달 되돌림', s.fixed, C.ink2], ['그냥 둠', s.hold, C.base]].map(([l, r, color]) => ({ label: `${short(s).slice(0, 4)}~ ${l}`, v: -r.mdd, text: pct(r.mdd), color }))), { Wd: 330, L: 112, R: 48, rh: 15, max: 0.8 })}</div>
    <div><div class="cap">세금 ${p0(RULE.taxRate)}를 넣은 연수익률</div>${hbars(SCEN.flatMap((s) => [['규칙대로', s.tax, C.plan], ['그냥 둠', s.holdTax, C.base]].map(([l, r, color]) => ({ label: `${short(s).slice(0, 4)}~ ${l}`, v: r.cagr, text: pct(r.cagr), color }))), { Wd: 330, L: 112, R: 48, rh: 15, max: 0.2 })}
      <p class="foot">2014년 구간의 차이는 현금을 덜 들었기 때문입니다. 비트코인을 빼면 규칙대로 ${pct(NOBTC.plan.cagr)}, 그냥 둠 ${pct(NOBTC.hold.cagr)}입니다.</p></div>
  </div>
</section>

${recentPage()}

<section class="page">
  <div class="kicker">근거</div>
  <h2>규칙마다 그렇게 정한 이유</h2>
  ${evid(`<span class="no">1</span>이미 쓴 규칙: QQQ가 최고가에서 ${p0(-RULE.firstDd)} 내린 것은 이번 전에 ${HITS_PAST.length}번`, qqqDrawdown(), `이번 하락에서는 최고 종가보다 ${pct(-QNOW.lowDd)} 낮은 값까지 왔고, 이때 1번 규칙을 썼습니다. ${HITS_PAST[0].d.slice(0, 4)}년에는 ${p0(-RULE.firstDd)} 내린 뒤로 ${p0(-HITS_PAST[0].more)} 더 내렸습니다. 그래서 10%p만 썼고, 나머지는 현금이 ${p0(RULE.upper)}가 될 때 씁니다. 현금 ${p0(RULE.startCash)}에서 기다렸다 산 경우의 연수익률은 ${SCEN.map((s) => pct(s.wait.cagr)).join(', ')}로, 기준 비중에서 시작한 경우(${SCEN.map((s) => pct(s.plan.cagr)).join(', ')})와 거의 같았습니다.`)}
  <div class="evg">
    ${evid(`<span class="no">2</span>현금 ${p0(RULE.upper)}로 산 날은 대부분 QQQ가 크게 내린 때`, hbars([...upperBuys].sort((a, b) => (a.d < b.d ? -1 : 1)).map((e) => ({ label: ymK(e.d), v: Math.max(0, -e.qdd), text: e.qdd > -0.005 ? '최고가 근처' : `−${p0(-e.qdd)}`, color: e.s === s14 ? C.btc : C.plan })), { Wd: 330, L: 84, R: 60, rh: 15, max: 1 }), '주황색 두 번은 비트코인을 줄인 돈이 현금에 쌓인 뒤라 덜 내렸을 때 샀습니다.')}
    ${evid(`<span class="no">2</span>하한이 없으면 현금이 ${p0(Math.min(s04.nolower.minCash, s99.nolower.minCash))}까지 줄어든다`, twoLines(s04.dates, cashW(s04.plan), cashW(s04.nolower), { Wd: 330, H: 118, R: 84, labelA: '하한 있음', labelB: '하한 없음, 최저', rule: RULE.lower, ruleLabel: '하한', colorA: C.cash, mark: 'min', dyA: -7 }), '2004년 시작 구간의 현금 비중입니다.')}
    ${evid(`<span class="no">2</span>필요한 만큼만 사고팔아도 결과는 같다`, hbars(SCEN.flatMap((s) => [{ label: `${short(s).slice(0, 4)}~ 전부 되돌림`, v: s.plan.cagr, text: pct(s.plan.cagr) }, { label: `${short(s).slice(0, 4)}~ 필요한 만큼만`, v: s.partial.cagr, text: pct(s.partial.cagr), color: C.base }]), { Wd: 330, L: 126, R: 44, rh: 16, max: 0.2 }), '그래서 규칙이 짧은 쪽을 골랐습니다.')}
    ${evid(`<span class="no">3</span>돈이 새로 들어오면 팔 일이 줄어든다`, hbars(SCEN.flatMap((s) => [['없음', s.plan, C.base], ['해마다 3%', s.c3, C.plan], ['해마다 6%', s.c6, C.plan]].map(([l, r, color]) => ({ label: `${short(s).slice(0, 4)}~ ${l}`, v: r.sells.length, text: `${r.sells.length}번`, color }))), { Wd: 330, L: 110, R: 40, rh: 13.5, max: 8 }), `현금 ${p0(RULE.lower)} 이하가 되어 판 횟수입니다.`)}
    ${evid(`<span class="no">4</span>상한이 없으면 비트코인이 ${p0(maxOf(s14.notrim, 'btc'))}까지 커진다`, twoLines(s14.dates, btcW(s14.plan), btcW(s14.notrim), { Wd: 330, H: 118, R: 84, labelA: '상한 있음', labelB: '상한 없음, 최고', rule: RULE.trimAt }), `전체의 변동성이 ${pct(s14.plan.vol)}에서 ${pct(s14.notrim.vol)}로 커졌습니다.`)}
    ${evid(`<span class="no">1</span>${p0(-RULE.firstDd)} 하락 뒤 3년, 좋았지만 특별하지는 않다`, hbars(HITS_PAST.map((h) => ({ label: ymK(h.d), v: h.after3, text: h.after3 == null ? '3년이 안 됨' : `${h.after3 > 0 ? '+' : '−'}${p0(Math.abs(h.after3))}`, color: h.after3 < 0 ? C.btc : C.plan })), { Wd: 330, L: 84, R: 50, rh: 17 }), `${BASE3Y.from.slice(0, 4)}년 이후에는 아무 날에 사도 3년 뒤 중앙값이 +${p0(BASE3Y.med)}였습니다.`)}
  </div>
</section>

<section class="page">
  <div class="kicker">운용</div>
  <h2>무엇을 어디에 두고, 지금 무엇이 켜져 있나</h2>
  <h3>어디에 두나 <span class="hint">칸의 너비가 기준 비중입니다</span></h3>
  ${accounts()}

  <h3>지금 켜져 있는 것 <span class="hint">1번 규칙을 쓴 뒤라 전부 켜져 있습니다</span></h3>
  <div class="tgs">
    ${toggle(true, `현금 ${p0(RULE.lower)} 이하면 되돌림`, '팔아서 현금을 채웁니다')}
    ${toggle(true, `현금 ${p0(RULE.upper)} 이상이면 되돌림`, '현금으로 삽니다. 1번 규칙을 써서 켜졌습니다')}
    ${toggle(true, '새로 들어오는 돈', `현금 기준을 ${p0(RULE.target)}로 봅니다`)}
    ${toggle(true, `금, 암호화폐 상한 ${p0(RULE.trimAt)}`, '금과 암호화폐를 따로 봅니다')}
  </div>

  <h3>그 밖에 정해 둔 것</h3>
  <div class="pipe three">
    <div><b>돈을 뺄 때는 현금에서</b><span>그래서 현금이 ${p0(RULE.lower)} 이하가 되면 2번 규칙대로 되돌립니다</span></div>
    <div><b>규칙에 없는 주식</b><span>일반 주식은 QQQ 몫에, 암호화폐 관련 주식은 암호화폐 몫에 넣어 셉니다</span></div>
    <div><b>전부 일반 계좌에서</b><span>언제 현금이 필요할지 모르기 때문입니다</span></div>
  </div>

  <h3>비중을 재는 법</h3>
  <div class="pipe three">
    <div><b>같은 날 환율로 한 통화로</b><span>원화로 재든 달러로 재든 비중은 같습니다</span></div>
    <div><b>현금이 달러</b><span>환율이 움직여도 QQQ와 현금 사이의 비중은 그대로입니다</span></div>
    <div><b>금과 암호화폐는 팔 수 있는 값으로</b><span>KRX 금값, 거래소 원화 시세. 국내 값이 비쌀 때는 비중도 높게 나옵니다</span></div>
  </div>

  <h3>팔 때의 세금 <span class="hint">일반 규정입니다. 세법은 자주 바뀌니 팔기 전에 확인해야 합니다</span></h3>
  <div class="taxes">
    ${taxCard('미국 상장 QQQ', '22%', '한 해 250만 원 공제. 환율이 오른 만큼도 차익. 다음 해 5월 신고', C.qqq)}
    ${taxCard('달러 단기 국채 ETF', '22%', '산 뒤 환율이 올랐으면 그만큼이 차익. 분배금은 배당소득', C.cash)}
    ${taxCard('KRX 금현물', '0%', '매매 차익에 세금 없음. 실물로 찾으면 부가가치세 10%', C.gold)}
    ${taxCard('실물 금', '확인', '값 차이가 커서 규칙에 따른 매매에는 쓰지 않음', C.gold)}
    ${taxCard('암호화폐', '2027~', '과세 예정. 여러 번 미뤄져 확인 필요', C.btc)}
    ${taxCard('암호화폐 관련 주식', '22%', '미국 상장이면 QQQ와 이익, 손실을 합침', C.btc)}
  </div>
  <p class="foot">세금은 다음 해에 냅니다. 판 해에는 낼 세금만큼을 현금 비중 계산에서 빼 둡니다. 현금 ${p0(RULE.lower)} 이하가 되어 QQQ를 팔면 한 번에 전체 자산의 0.7~2.1%가 세금이었습니다(독립 검토).</p>
</section>

<section class="page">
  <div class="kicker">받아들일 것과 남은 결정</div>
  <h2>이 규칙으로 치르는 것</h2>
  <div class="stats">
    ${stat(pct(s99.plan.mdd), '닷컴 구간의 전체 낙폭 (QQQ 70, 현금 30으로 시작)')}
    ${stat(p0(FALL), `현금 ${p0(RULE.upper)}가 되려면 현금 외 자산이 내려야 하는 폭. 그 전까지는 내려도 지켜봅니다`)}
    ${stat(SCEN.map((s) => `${s.plan.buys.length}번`).join(' '), `세 구간에서 현금 ${p0(RULE.upper)}가 되어 산 횟수. 살 기회는 드뭅니다`)}
    ${stat(SCEN.map((s) => `${s.plan.sells.length}번`).join(' '), `세 구간에서 현금 ${p0(RULE.lower)}가 되어 판 횟수. 팔 때마다 세금이 나갑니다`)}
    ${stat(`${SCEN.map((s) => p0(s.plan.avgCash)).join(' ')}`, '세 구간의 평균 현금 비중. 오르는 장에서는 그만큼 덜 법니다')}
    ${stat('없음', '환율과 국내 가격(KRX 금값, 거래소 원화 시세)은 계산에 없습니다')}
  </div>

  <h2 style="margin-top:16pt">아직 정하지 않은 것</h2>
  <table class="t"><thead><tr><th style="width:26%">항목</th><th style="width:34%">지금</th><th>고를 수 있는 것</th></tr></thead><tbody>
    <tr><td>새로 들어온 돈을 나누는 방법</td><td>가장 모자란 자산 하나를 삽니다.</td><td>그대로 두기 / 모자란 만큼 비례해서 나누기</td></tr>
    <tr><td>국내 값이 국제 값보다 비쌀 때</td><td>정하지 않았습니다.</td><td>차이가 3%를 넘으면 매수를 미루기 / 그대로 사기</td></tr>
  </tbody></table>

  <h2 style="margin-top:16pt">부록 1. 숫자로 보기</h2>
  <p class="sub">칸마다 연수익률과 최대 낙폭입니다.</p>
  <table class="t dense"><thead><tr><th>방식</th>${SCEN.map((s) => `<th class="n" colspan="2">${s.title.replace(/ \(.*\)/, '')}</th>`).join('')}</tr></thead><tbody>
    ${cmpRow('그냥 둔 경우 (금, 암호화폐 상한만 적용)', 'hold')}
    ${cmpRow('기준 비중으로 시작해 매달 되돌린 경우', 'fixed')}
    ${cmpRow('규칙대로 한 경우', 'plan', 'pick')}
    ${cmpRow('필요한 만큼만 사고파는 경우', 'partial')}
    ${cmpRow(`현금 ${p0(RULE.startCash)}에서 시작해 1번 규칙을 기다린 경우`, 'wait')}
    ${cmpRow('현금 하한을 뺀 경우', 'nolower')}
    ${cmpRow('현금 상한이 35%인 경우', 'up35')}
    ${cmpRow('해마다 자산의 3%만큼 돈이 새로 들어오는 경우', 'c3')}
    ${cmpRow('해마다 자산의 6%만큼 돈이 새로 들어오는 경우', 'c6')}
    ${cmpRow(`규칙대로 한 경우, 매도 차익 세금 ${p0(RULE.taxRate)}`, 'tax', 'sep')}
    ${cmpRow(`그냥 둔 경우, 매도 차익 세금 ${p0(RULE.taxRate)}`, 'holdTax')}
  </tbody></table>
  <p class="foot">변동성과 샤프: 규칙대로 ${SCEN.map((s) => `${pct(s.plan.vol)} / ${s.plan.sharpe.toFixed(2)}`).join(', ')}. 매달 되돌린 경우 ${SCEN.map((s) => `${pct(s.fixed.vol)} / ${s.fixed.sharpe.toFixed(2)}`).join(', ')}. 그냥 둔 경우 ${SCEN.map((s) => `${pct(s.hold.vol)} / ${s.hold.sharpe.toFixed(2)}`).join(', ')}.</p>
</section>

${recordsPage()}
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'reserve-plan.html'), html)
console.log(`${RECENT.five.title}: 규칙 ${pct(RECENT.five.plan.cagr)} / ${pct(RECENT.five.plan.mdd)}, 매달 되돌림 ${pct(RECENT.five.fixed.cagr)} / ${pct(RECENT.five.fixed.mdd)}, 그냥 둔 경우 ${pct(RECENT.five.hold.cagr)} / ${pct(RECENT.five.hold.mdd)}`)
for (const [t, m] of [['최근 5년', RECENT.five.mix], ['2017년 11월부터', RECENT.mixLong]]) console.log(`암호화폐 비트코인 80 + 이더리움 20, ${t} (${m.dates[0]}~${m.dates.at(-1)}): 규칙 ${pct(m.plan.cagr)} / ${pct(m.plan.mdd)} (비트코인만 ${pct(m.btcOnly.cagr)} / ${pct(m.btcOnly.mdd)}), 줄인 날 ${m.plan.trims.length} (비트코인만 ${m.btcOnly.trims.length}), 이더리움 연 ${pct(m.annEth)}, 섞은 값 연 ${pct(m.annMix)}`)
for (const s of SCEN) console.log(`${s.title}: 규칙 ${pct(s.plan.cagr)} / ${pct(s.plan.mdd)}, 그냥 둔 경우 ${pct(s.hold.cagr)} / ${pct(s.hold.mdd)}, 산 횟수 ${s.plan.buys.length}, 판 횟수 ${s.plan.sells.length}, 세금 반영 ${pct(s.tax.cagr)} (그냥 둔 경우 ${pct(s.holdTax.cagr)})`)

const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(OUT, 'reserve-plan.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const fontOk = await page.evaluate(() => document.fonts.check('12px "IBM Plex Sans KR"', '한글'))
await page.pdf({ path: path.join(OUT, 'reserve-plan.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`PDF 저장: ${path.join(OUT, 'reserve-plan.pdf')} (한글 글꼴 ${fontOk ? '적용' : '미적용'})`)
