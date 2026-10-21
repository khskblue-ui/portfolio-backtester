// 발표 자료 빌드: 검증 결과 데이터를 계산해 슬라이드 템플릿에 넣는다
// 사용: node scripts/tripod/build-deck.mjs [--page-only <골격 없는 사본 경로>]
// 입력: docs/research/tripod/deck.template.html  →  출력: docs/research/tripod/tripod-deck.html
// 모든 수치는 다른 스크립트와 같은 모듈에서 다시 계산한다(문서에 손으로 옮긴 값이 아님).
import fs from 'node:fs'
import path from 'node:path'
import {
  loadMarket, buildProducts, holdCurve, computeSignals, simulate, COST_DEFAULT, RULE_DEFAULT,
  cagr, years, idxOf, monthEnds, exitAfter, quantile, readBars, maxDD, ulcer, sortinoVariants,
} from './lib.mjs'
import { setup, evaluate, VIDEO, START, END } from './run.mjs'
import { runRule, NEIGHBORS, HEAT_DD, HEAT_VIX, SPLITS, shuffleTest } from './robust.mjs'
import { simTax, TAX, tripodPlan, mixPlan, holdPlan, yearlyRebal } from './aftertax.mjs'

const DIR = path.resolve(import.meta.dirname, '../../docs/research/tripod')
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toPrecision(5))
const p2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 100) // 비율 → % 소수 2자리

const ctx = setup()
const { mkt, prod, a, b } = ctx
const base = evaluate(ctx)
const D = { meta: { start: mkt.dates[a], end: mkt.dates[b], built: new Date().toISOString().slice(0, 10), cost: COST_DEFAULT }, video: VIDEO }

// ── 곡선(월말)·낙폭(월 최저) ──
const me = monthEnds(mkt, a, b)
const curves = { tripod: base.v, qqq: ctx.bench[0], qld: ctx.bench[1], tqqq: ctx.bench[2] }
D.curves = { dates: me.map((i) => mkt.dates[i].slice(0, 7)) }
for (const [k, v] of Object.entries(curves)) D.curves[k] = me.map((i) => r4(v[i - a]))
const ddMonthly = (v) => {
  let pk = v[0]; const out = []; let cur = 0, mon = mkt.dates[a].slice(0, 7)
  for (let j = 0; j < v.length; j++) {
    const d = mkt.dates[a + j].slice(0, 7)
    if (d !== mon) { out.push(Math.round(cur * 1000) / 10); cur = 0; mon = d }
    pk = Math.max(pk, v[j]); cur = Math.min(cur, v[j] / pk - 1)
  }
  out.push(Math.round(cur * 1000) / 10)
  return out
}
D.dd = { tripod: ddMonthly(base.v), qqq: ddMonthly(ctx.bench[0]), tqqq: ddMonthly(ctx.bench[2]) }

// ── 보유 구간 ──
const segs = []
let held = base.sig.target[a - 1] ?? 'CASH', from = a
for (const t of base.tradeList) { segs.push([mkt.dates[from], mkt.dates[t.i], held]); held = t.to; from = t.i }
segs.push([mkt.dates[from], mkt.dates[b], held])
D.segments = segs
const share = { T3: 0, B15: 0, CASH: 0 }
for (const [s, e, h] of segs) share[h] += (Date.parse(e) - Date.parse(s)) / 864e5
const tot = Object.values(share).reduce((x, y) => x + y, 0)
D.holdShare = Object.fromEntries(Object.entries(share).map(([k, v]) => [k, p2(v / tot)]))
const tpy = {}
for (let y = 1991; y <= 2026; y++) tpy[y] = 0
for (const t of base.tradeList) tpy[mkt.dates[t.i].slice(0, 4)]++
D.tradesPerYear = tpy
D.tradeStats = { ...base.trades, zeroYears: base.trades.zeroYears }

// ── 성과·롤링 ──
const perfOf = (v) => {
  const yrs = years(mkt, a, b)
  return { cagr: p2(cagr(v, yrs)), mdd: p2(maxDD(v)), ulcer: r4(ulcer(v)) }
}
D.perf = { tripod: { ...base.perf }, qqq: perfOf(ctx.bench[0]), qld: perfOf(ctx.bench[1]), tqqq: perfOf(ctx.bench[2]) }
// 소르티노는 evaluate와 같은 정의(일간 초과수익)로 벤치마크도 계산
{
  const yrs = years(mkt, a, b), dts = mkt.dates.slice(a, b + 1)
  for (const [k, kk] of [['qqq', 0], ['qld', 1], ['tqqq', 2]]) D.perf[k].sortino = r4(sortinoVariants(ctx.bench[kk], ctx.rf, dts, yrs).dx)
  D.perf.tripod = { cagr: r4(base.perf.cagr), mdd: r4(base.perf.mdd), sortino: r4(base.perf.sortino), ulcer: r4(base.perf.ulcer) }
}
D.median = base.median; D.loss = base.loss; D.winVsQld = base.winVsQld
D.periods = base.periods.map((c) => c.map((x) => Math.round(x * 1e4)))
const win = (v, n) => { const out = []; for (const e of me) { const x = exitAfter(mkt, e, n, b); if (x < 0) break; out.push({ d: mkt.dates[e].slice(0, 7), m: v[x - a] / v[e - a] }) } return out }
D.dist10 = {}
for (const [k, v] of Object.entries(curves)) D.dist10[k] = win(v, 10).map((x) => r4(x.m))
D.dist10dates = win(base.v, 10).map((x) => x.d)
D.worst10Start = base.worst10Start

// ── 해석 변수 그리드·체결 시차 ──
D.grid = []
for (const exec of ['close0', 'open1', 'close1']) for (const ddDef of ['c252', 'h252', 'c250', 'c365']) for (const hold of ['A', 'B']) {
  const r = evaluate(ctx, { ddDef, hold }, { exec })
  D.grid.push({ exec, ddDef, hold, cagr: r4(r.perf.cagr), mdd: r4(r.perf.mdd), sortino: r4(r.perf.sortino), tpy: r4(r.trades.perYear) })
}
const lagFrom = (from, to = END) => {
  const i0 = idxOf(mkt, from); let i1 = mkt.dates.findIndex((d) => d > to) - 1; if (i1 < 0) i1 = b
  return Object.fromEntries(['peek', 'close0', 'open1', 'close1', 'close2'].map((e) => {
    const { v } = simulate(mkt, prod, base.sig, { startIdx: i0, endIdx: i1, exec: e })
    return [e, { cagr: p2(cagr(v, years(mkt, i0, i1))), mdd: p2(maxDD(v)) }]
  }))
}
D.lag = { full: lagFrom('1991-01-02'), since2000: lagFrom('2000-01-03') }
D.lagDecades = [['1991-01-02', '1999-12-31'], ['2000-01-03', '2009-12-31'], ['2010-01-04', '2019-12-31'], ['2020-01-02', END]].map(([s, e]) => ({ label: `${s.slice(0, 4)}~${e.slice(0, 4)}`, ...lagFrom(s, e) }))

// ── 일별 확대 구간 ──
const daily = (s, e, keys) => {
  const out = { d: [] }
  keys.forEach((k) => { out[k] = [] })
  for (let i = 0; i < mkt.dates.length; i++) {
    const d = mkt.dates[i]
    if (d < s || d > e) continue
    out.d.push(d)
    for (const k of keys) {
      if (k === 'close') out.close.push(r4(mkt.close[i]))
      if (k === 'ma') out.ma.push(r4(base.sig.ma[i]))
      if (k === 'dd') out.dd.push(Math.round(base.sig.dd[i] * 10000) / 100)
      if (k === 'vix10') out.vix10.push(Math.round(base.sig.vix10[i] * 10) / 10)
      if (k === 'target') out.target.push(base.sig.target[i])
      if (k === 'regime') out.regime.push(base.sig.regime[i])
    }
  }
  return out
}
D.cp2026 = daily('2026-01-02', END, ['close', 'ma', 'dd', 'vix10', 'target'])
D.cp2026.trades = base.tradeList.filter((t) => mkt.dates[t.i] >= '2026-01-01').map((t) => [mkt.dates[t.i], t.from, t.to])
D.path2000 = daily('1999-07-01', '2001-06-29', ['close', 'ma', 'target', 'regime'])
D.band2018 = daily('2018-01-02', '2020-12-31', ['close', 'ma', 'target', 'regime'])

// ── 데이터 품질: 시가가 전일 종가와 같은 날의 비율 ──
const ndx = readBars('NDX')
const dq = {}
for (let i = 1; i < ndx.length; i++) {
  const y = ndx[i].d.slice(0, 4); if (y < '1986' || y > '2025') continue
  dq[y] ??= [0, 0]; dq[y][1]++
  if (Math.abs(ndx[i].o / ndx[i - 1].c - 1) < 1e-5) dq[y][0]++
}
D.openCopy = Object.entries(dq).map(([y, [c, n]]) => [+y, Math.round((c / n) * 1000) / 10])

// ── 비용 보정 ──
D.calib = []
for (const spread of [0, 0.25, 0.5, 0.75, 1.0, 1.25]) {
  const pr = buildProducts(mkt, { ...COST_DEFAULT, spread })
  const row = { spread }
  for (const [name, k] of [['QLD', 1], ['TQQQ', 2]]) {
    const real = new Map(readBars(name).map((x) => [x.d, x.a]))
    const i0 = idxOf(mkt, readBars(name)[1].d)
    const yrs = years(mkt, i0, b)
    const realC = (real.get(mkt.dates[b]) / real.get(mkt.dates[i0])) ** (1 / yrs) - 1
    row[`${name}track`] = p2(cagr(holdCurve(mkt, pr, k, i0, b), yrs) - realC)
    row[`${name}cagr`] = p2(cagr(holdCurve(mkt, pr, k, a, b), years(mkt, a, b)))
  }
  D.calib.push(row)
}

// ── 강건성 ──
D.neighbors = NEIGHBORS.map(([key, vals]) => ({ key, vals: vals.map((x) => { const r = runRule(mkt, prod, { [key]: x }, START); return [x, p2(r.cagr), p2(r.mdd)] }) }))
D.heat = { dd: HEAT_DD, vix: HEAT_VIX, cagr: HEAT_DD.map((dd) => HEAT_VIX.map((vu) => p2(runRule(mkt, prod, { ddLimit: dd, vixUp: vu }, START).cagr))) }
D.split = SPLITS.map(([s, e]) => { const r = runRule(mkt, prod, {}, s, e); return { label: `${s.slice(0, 4)}~${e.slice(0, 4)}`, tripod: [p2(r.cagr), p2(r.mdd)], bench: r.bench.map((x) => [p2(x.cagr), p2(x.mdd)]) } })
const spx = loadMarket({ base: 'GSPC', end: END })
const spxProd = buildProducts(spx, { ...COST_DEFAULT, preDivYield: 3.0, etfFee: 0.09 })
{ const r = runRule(spx, spxProd, {}, START); D.spx = { tripod: [p2(r.cagr), p2(r.mdd)], bench: r.bench.map((x) => [p2(x.cagr), p2(x.mdd)]), tpy: r4(r.trades) } }
D.shuffle = {}
for (const B of [1, 21, 252]) { const { diffs, wins } = shuffleTest(mkt, B); D.shuffle[B] = { qld: diffs[1].map(p2), qqq: diffs[0].map(p2), tqqq: diffs[2].map(p2), winShare: p2(wins.filter(Boolean).length / wins.length) } }
{ const r = runRule(mkt, prod, {}, START); D.shuffle.real = { qqq: p2(r.cagr - r.bench[0].cagr), qld: p2(r.cagr - r.bench[1].cagr), tqqq: p2(r.cagr - r.bench[2].cagr) } }

// ── 세후 ──
const yrs = years(mkt, a, b)
const sig = base.sig
const runT = (plan, opts = {}) => simTax(mkt, prod, { startIdx: a, endIdx: b, plan, ...opts })
const sumT = (r) => ({ cagr: p2((r.final / 1e8) ** (1 / yrs) - 1), mdd: p2(maxDD(r.path)), ulcer: r4(ulcer(r.path)), final: r4(r.final / 1e8), taxes: r4(r.taxes / 1e8) })
const NOTAX = { ...TAX, enabled: false }
const AT = [['tripod', '트라이팟', tripodPlan(sig), {}], ['qqq', 'QQQ 100%', holdPlan(0), {}], ['qld', 'QLD 100%', holdPlan(1), {}], ['tqqq', 'TQQQ 100%', holdPlan(2), {}]]
for (let n = 9; n >= 5; n--) AT.push([`mix${n * 10}`, `QQQ ${n * 10}% + 현금`, mixPlan(n / 10), { rebalance: yearlyRebal(mkt) }])
D.aftertax = { rows: AT.map(([id, name, plan, opts]) => ({ id, name, pre: sumT(runT(plan, { ...opts, tax: NOTAX })), post: sumT(runT(plan, opts)) })) }
// 세금 항목별 분해: 양도세만 → +배당 → +이자 → +종합과세
const steps = [
  ['양도세 22%', { ...TAX, divWh: 0, intWh: 0, finThresholdKrw: Infinity }],
  ['배당 원천 15%', { ...TAX, intWh: 0, finThresholdKrw: Infinity }],
  ['이자 15.4%', { ...TAX, finThresholdKrw: Infinity }],
  ['금융소득 종합과세', TAX],
]
D.aftertax.waterfall = [['세전', sumT(runT(tripodPlan(sig), { tax: NOTAX })).cagr], ...steps.map(([n, t]) => [n, sumT(runT(tripodPlan(sig), { tax: t })).cagr])]
D.aftertax.waterfallQqq = [['세전', sumT(runT(holdPlan(0), { tax: NOTAX })).cagr], ...steps.map(([n, t]) => [n, sumT(runT(holdPlan(0), { tax: t })).cagr])]
const triPost = sumT(runT(tripodPlan(sig)))
const solve = (metric) => {
  let lo = 0, hi = 1
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2
    const m = sumT(runT(mixPlan(mid), { rebalance: yearlyRebal(mkt) }))[metric]
    if ((metric === 'mdd' ? -m : m) > (metric === 'mdd' ? -triPost[metric] : triPost[metric])) hi = mid; else lo = mid
  }
  const n = (lo + hi) / 2
  return { n: p2(n), ...sumT(runT(mixPlan(n), { rebalance: yearlyRebal(mkt) })) }
}
D.aftertax.matched = { mdd: solve('mdd'), ulcer: solve('ulcer') }
D.aftertax.frontier = Array.from({ length: 21 }, (_, j) => j / 20).map((n) => { const s = sumT(runT(mixPlan(n), { rebalance: yearlyRebal(mkt) })); return [Math.round(n * 100), s.cagr, s.mdd] })
const win10T = (plan, opts = {}) => {
  const out = []
  for (const e of me) { const x = exitAfter(mkt, e, 10, b); if (x < 0) break; out.push(r4(simTax(mkt, prod, { startIdx: e, endIdx: x, plan, ...opts }).final / 1e8)) }
  return out
}
D.aftertax.win10 = {
  tripodPre: win10T(tripodPlan(sig), { tax: NOTAX }), tripod: win10T(tripodPlan(sig)),
  qqq: win10T(holdPlan(0)), mix70: win10T(mixPlan(0.7), { rebalance: yearlyRebal(mkt) }),
  qld: win10T(holdPlan(1)), tqqq: win10T(holdPlan(2)),
}
const sameClose = (s) => (i) => { const t = s.target[i] ?? 'CASH'; return { key: t, w: [['T3', [0, 0, 1, 0]], ['B15', [0.5, 0.5, 0, 0]], ['CASH', [0, 0, 0, 1]]].find(([k]) => k === t)[1] } }
const sigOf = (rule) => computeSignals(mkt, { ...RULE_DEFAULT, ...rule })
const med10 = (plan, opts) => { const w = win10T(plan, opts).slice().sort((p, q) => p - q); return p2(quantile(w, 0.5) ** 0.1 - 1) }
const SC = [
  ['기본(다음 날 종가, 5bp)', tripodPlan(sig), {}, 'base'],
  ['수수료 편도 25bp', tripodPlan(sig), { costBps: 25 }, 'risk'],
  ['당일 종가 체결', sameClose(sig), {}, 'risk'],
  ['VIX 상한 25', tripodPlan(sigOf({ vixUp: 25 })), {}, 'risk'],
  ['VIX 상한 31', tripodPlan(sigOf({ vixUp: 31 })), {}, 'risk'],
  ['낙폭 한도 8%', tripodPlan(sigOf({ ddLimit: -0.08 })), {}, 'risk'],
  ['낙폭 한도 7%', tripodPlan(sigOf({ ddLimit: -0.07 })), {}, 'risk'],
  ['나쁜 쪽 겹침(당일 종가+25bp+VIX 25)', sameClose(sigOf({ vixUp: 25 })), { costBps: 25 }, 'worst'],
  ['250일선 규칙만(상승 TQQQ, 하락 현금)', tripodPlan(sigOf({ vixUp: 999, vixDown: -1, useDD: false })), {}, 'ref'],
  ['QQQ 100%', holdPlan(0), {}, 'qqq'],
  ['QQQ 70% + 현금', mixPlan(0.7), { rebalance: yearlyRebal(mkt) }, 'mix'],
]
D.aftertax.scenarios = SC.map(([name, plan, opts, kind]) => { const s = sumT(runT(plan, opts)); return { name, kind, cagr: s.cagr, mdd: s.mdd, med10: med10(plan, opts) } })
{
  const a2 = idxOf(mkt, '2000-01-03'), y2 = years(mkt, a2, b)
  D.aftertax.start2000 = [['트라이팟', tripodPlan(sig), {}], ['QQQ 100%', holdPlan(0), {}], ['QQQ 70% + 현금', mixPlan(0.7), { rebalance: yearlyRebal(mkt) }], ['TQQQ 100%', holdPlan(2), {}]]
    .map(([name, plan, opts]) => { const r = simTax(mkt, prod, { startIdx: a2, endIdx: b, plan, ...opts }); return { name, cagr: p2((r.final / 1e8) ** (1 / y2) - 1), mdd: p2(maxDD(r.path)) } })
  const sa = idxOf(spx, START), sb = spx.dates.length - 1, sy = years(spx, sa, sb)
  const spxSig = computeSignals(spx, RULE_DEFAULT)
  D.aftertax.spx = [['트라이팟(S&P)', tripodPlan(spxSig)], ['SPY 100%', holdPlan(0)], ['SSO 100%', holdPlan(1)], ['UPRO 100%', holdPlan(2)]]
    .map(([name, plan]) => { const r = simTax(spx, spxProd, { startIdx: sa, endIdx: sb, plan }); return { name, cagr: p2((r.final / 1e8) ** (1 / sy) - 1), mdd: p2(maxDD(r.path)) } })
}
{ // 세후 자산 경로(월말, 억 원)
  const paths = { tripod: runT(tripodPlan(sig)).path, qqq: runT(holdPlan(0)).path, mix70: runT(mixPlan(0.7), { rebalance: yearlyRebal(mkt) }).path, tripodPre: runT(tripodPlan(sig), { tax: NOTAX }).path }
  D.aftertax.paths = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, me.map((i) => r4(p[i - a] / 1e8))]))
}

// ── 템플릿 주입 ──
const tpl = fs.readFileSync(path.join(DIR, 'deck.template.html'), 'utf8')
const json = JSON.stringify(D)
if (!tpl.includes('/*__DECK_DATA__*/null')) throw new Error('템플릿에 데이터 자리표시자가 없습니다')
const page = tpl.replace('/*__DECK_DATA__*/null', json.replace(/</g, '\\u003c'))
// 저장소 사본은 브라우저에서 바로 열 수 있게 문서 골격을 붙인다(아티팩트 게시용은 골격 없이 --page-only)
const standalone = '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + page + '\n</body>\n</html>\n'
fs.writeFileSync(path.join(DIR, 'tripod-deck.html'), standalone)
const pageOnly = process.argv.indexOf('--page-only')
if (pageOnly > 0 && process.argv[pageOnly + 1]) fs.writeFileSync(process.argv[pageOnly + 1], page)
console.log(`데이터 ${(json.length / 1024).toFixed(0)}KB → tripod-deck.html ${(standalone.length / 1024).toFixed(0)}KB`)
