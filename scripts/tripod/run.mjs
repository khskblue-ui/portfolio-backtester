// 4단계: 해석 변수 그리드 + 영상 목표값 대조
// 사용: node scripts/tripod/run.mjs            → 그리드 요약 + 기본 조합 상세
//       node scripts/tripod/run.mjs --json    → docs/research/tripod/results.json 갱신
import fs from 'node:fs'
import path from 'node:path'
import {
  loadMarket, buildProducts, holdCurve, computeSignals, simulate, COST_DEFAULT, RULE_DEFAULT,
  cagr, maxDD, ulcer, sortinoVariants, years, idxOf, monthEnds, exitAfter, quantile,
} from './lib.mjs'

export const START = '1991-01-02'
export const END = '2026-08-28' // 촬영일(2026-08-31, 월) 직전 거래일

// ── 영상 목표값 (명세 §4, 화면 캡처로 확인) ──
export const VIDEO = {
  perf: { TRIPOD: [32.9, -62.0, 1.08, 29.9], QQQ: [15.4, -82.8, 0.83, 37.8], QLD: [19.7, -98.9, 0.80, 67.6], TQQQ: [16.4, -100.0, 0.81, 83.9] },
  median: { 1: [29.7, 19.2, 32.2, 41.1], 3: [26.6, 15.5, 27.1, 35.0], 5: [30.0, 15.9, 24.7, 28.5], 10: [28.8, 12.3, 14.0, 11.3] },
  loss: { 1: [26.7, 15.9, 23.9, 27.2], 3: [7.2, 12.8, 19.7, 25.3], 5: [3.3, 13.1, 23.7, 33.8], 7: [0.0, 9.6, 25.1, 35.6], 10: [0.0, 8.8, 21.2, 40.1] },
  dist10: { TRIPOD: [1.56, 4.73, 12.52, 141], QQQ: [0.46, 2.44, 3.19, 11.7], QLD: [0.04, 1.37, 3.71, 31.6], TQQQ: [0.00, 0.22, 2.93, 99.7] },
  winVsQld: { 1: 59, 3: 62, 5: 76, 10: 78 },
  trades: { perYear: 8.1, zeroYears: 5, longestGap: '2년 7개월', maxPerYear: 21, gapMedian: 6, gapMean: 45 },
  periods: [
    { label: '2000.3 진입 후 3년', tripod: 6437, QQQ: 2400, QLD: 229, TQQQ: 10 },
    { label: '2000.4~2003.5', tripod: 9749, TQQQ: 22 },
    { label: '2008.6~2009.9', tripod: 10956, TQQQ: 3095 },
    { label: '2022.4~2023.4', tripod: 10137, TQQQ: 5188 },
  ],
  insurance: { events: 55, tqqqBetter: 40, cutRight: 15 },
  execCompare: { close0: 44.3, next: 24.7 },
}

const NAMES = ['QQQ', 'QLD', 'TQQQ']

export function setup({ end = END, cost = COST_DEFAULT, base = 'NDX' } = {}) {
  const mkt = loadMarket({ end, base })
  const prod = buildProducts(mkt, cost)
  const a = idxOf(mkt, START), b = mkt.dates.length - 1
  const rf = mkt.dates.slice(a, b + 1).map((d, j) => (j === 0 ? 0
    : (mkt.irx[a + j - 1] / 100) * ((Date.parse(d) - Date.parse(mkt.dates[a + j - 1])) / 864e5) / 365))
  const bench = NAMES.map((_, k) => holdCurve(mkt, prod, k, a, b))
  return { mkt, prod, a, b, rf, bench }
}

const perf = (ctx, v) => {
  const yrs = years(ctx.mkt, ctx.a, ctx.b)
  return { cagr: cagr(v, yrs) * 100, mdd: maxDD(v) * 100, sortino: sortinoVariants(v, ctx.rf, ctx.mkt.dates.slice(ctx.a, ctx.b + 1), yrs).dx, ulcer: ulcer(v) }
}

/** 월말 진입(또는 일별 진입) N년 보유 창의 배수 목록 */
function windows(ctx, v, n, entry = 'month') {
  const { mkt, a, b } = ctx
  const es = entry === 'month' ? monthEnds(mkt, a, b) : Array.from({ length: b - a + 1 }, (_, j) => a + j)
  const out = []
  for (const e of es) {
    const x = exitAfter(mkt, e, n, b)
    if (x < 0) break
    out.push({ e, mult: v[x - a] / v[e - a] })
  }
  return out
}

/** 달력 구간 [월 시작 전 종가 → 끝 월 마지막 종가] 배수 */
function periodMult(ctx, v, fromMonth, toMonth) {
  const { mkt, a } = ctx
  const i0 = mkt.dates.findIndex((d) => d >= `${fromMonth}-01`) - 1
  let i1 = mkt.dates.findIndex((d) => d > `${toMonth}-31`) - 1
  if (i1 < 0) i1 = mkt.dates.length - 1
  return v[i1 - a] / v[i0 - a]
}

function tradeStats(ctx, trades) {
  const { mkt } = ctx
  const yrs = years(ctx.mkt, ctx.a, ctx.b)
  const perYear = {}
  for (let y = 1991; y <= 2026; y++) perYear[y] = 0
  for (const t of trades) perYear[mkt.dates[t.i].slice(0, 4)]++
  const full = Object.entries(perYear).filter(([y]) => +y <= 2025)
  const gaps = []
  for (let j = 1; j < trades.length; j++) gaps.push((Date.parse(mkt.dates[trades[j].i]) - Date.parse(mkt.dates[trades[j - 1].i])) / 864e5)
  const sorted = gaps.slice().sort((x, y) => x - y)
  let longest = 0, longestAt = ''
  for (let j = 1; j < trades.length; j++) {
    if (gaps[j - 1] > longest) { longest = gaps[j - 1]; longestAt = `${mkt.dates[trades[j - 1].i]}~${mkt.dates[trades[j].i]}` }
  }
  return {
    count: trades.length,
    perYear: trades.length / yrs,
    orders: trades.reduce((s, t) => s + ({ 'T3>B15': 3, 'B15>T3': 3, 'T3>CASH': 1, 'CASH>T3': 1, 'B15>CASH': 2, 'CASH>B15': 2 })[`${t.from}>${t.to}`], 0) / yrs,
    zeroYears: full.filter(([, c]) => c === 0).map(([y]) => y),
    zeroYears2026: Object.entries(perYear).filter(([, c]) => c === 0).map(([y]) => y),
    maxPerYear: Math.max(...Object.values(perYear)),
    maxYear: Object.entries(perYear).sort((x, y) => y[1] - x[1])[0][0],
    gapMedian: quantile(sorted, 0.5), gapMean: gaps.reduce((s, x) => s + x, 0) / gaps.length,
    longestGapDays: longest, longestAt,
  }
}

/** 보험료 통계: TQQQ에서 내려온 뒤 다시 TQQQ로 돌아올 때까지(에피소드)의 성과를 TQQQ 계속 보유와 비교 */
function insurance(ctx, v, trades) {
  const { a } = ctx
  const tq = ctx.bench[2]
  const eps = []
  for (let j = 0; j < trades.length; j++) {
    if (trades[j].from !== 'T3') continue
    let k = j + 1
    while (k < trades.length && trades[k].to !== 'T3') k++
    const i0 = trades[j].i, i1 = k < trades.length ? trades[k].i : ctx.b
    eps.push({ i0, i1, strat: v[i1 - a] / v[i0 - a], tqqq: tq[i1 - a] / tq[i0 - a] })
  }
  // 변형: 위험을 낮춘 개별 전이(T3→B15, T3→CASH, B15→CASH)마다 다음 매매까지 "이전 보유 유지"와 비교
  const down = { T3: 3, B15: 1.5, CASH: 0 }
  let cuts = 0, holdBetter = 0
  for (let j = 0; j < trades.length; j++) {
    const t = trades[j]
    if (down[t.to] >= down[t.from]) continue
    const i1 = j + 1 < trades.length ? trades[j + 1].i : ctx.b
    const prevK = t.from === 'T3' ? [2] : [0, 1]
    const prevMult = prevK.reduce((s, kk) => s + ctx.bench[kk][i1 - a] / ctx.bench[kk][t.i - a], 0) / prevK.length
    cuts++
    if (prevMult > v[i1 - a] / v[t.i - a]) holdBetter++
  }
  return { episodes: eps.length, tqqqBetter: eps.filter((e) => e.tqqq > e.strat).length, cuts, holdBetter }
}

export function evaluate(ctx, rule = {}, sim = {}) {
  const sig = computeSignals(ctx.mkt, { ...RULE_DEFAULT, ...rule })
  const { v, trades } = simulate(ctx.mkt, ctx.prod, sig, { startIdx: ctx.a, endIdx: ctx.b, exec: 'close1', costBps: 5, ...sim })
  const curves = [v, ...ctx.bench]
  const res = { perf: perf(ctx, v), median: {}, loss: {}, winVsQld: {} }
  for (const n of [1, 3, 5, 7, 10]) {
    const ws = curves.map((c) => windows(ctx, c, n))
    res.loss[n] = ws.map((w) => (w.filter((x) => x.mult < 1).length / w.length) * 100)
    res.median[n] = ws.map((w) => (quantile(w.map((x) => x.mult).sort((p, q) => p - q), 0.5) ** (1 / n) - 1) * 100)
    res.winVsQld[n] = (ws[0].filter((x, j) => x.mult > ws[2][j].mult).length / ws[0].length) * 100
    if (n === 10) {
      res.count10 = ws[0].length
      res.dist10 = ws.map((w) => { const s = w.map((x) => x.mult).sort((p, q) => p - q); return [s[0], quantile(s, 0.25), quantile(s, 0.5), s.at(-1)] })
      const worst = ws[0].reduce((m, x) => (x.mult < m.mult ? x : m))
      res.worst10Start = ctx.mkt.dates[worst.e]
      const wd = windows(ctx, v, 10, 'day')
      const sd = wd.map((x) => x.mult).sort((p, q) => p - q)
      res.dist10daily = { count: wd.length, q: [sd[0], quantile(sd, 0.25), quantile(sd, 0.5), sd.at(-1)] }
      ctx.qldDaily10 ??= windows(ctx, ctx.bench[1], 10, 'day')
      res.winVsQldDaily10 = (wd.filter((x, j) => x.mult > ctx.qldDaily10[j].mult).length / wd.length) * 100
    }
  }
  res.trades = tradeStats(ctx, trades)
  res.insurance = insurance(ctx, v, trades)
  const pm = (c) => [
    periodMult(ctx, c, '2000-03', '2003-02'), periodMult(ctx, c, '2000-04', '2003-05'),
    periodMult(ctx, c, '2008-06', '2009-09'), periodMult(ctx, c, '2022-04', '2023-04'),
  ]
  res.periods = curves.map(pm)
  res.trades2026 = trades.filter((t) => ctx.mkt.dates[t.i] >= '2026-01-01').map((t) => `${ctx.mkt.dates[t.i]} ${t.from}→${t.to}`)
  res.sig = sig
  res.v = v
  res.tradeList = trades
  return res
}

const p1 = (x) => x.toFixed(1)
export function summaryRow(label, r) {
  const d = r.dist10[0]
  return `${label.padEnd(26)} CAGR ${p1(r.perf.cagr).padStart(5)}  MDD ${p1(r.perf.mdd).padStart(6)}  So ${r.perf.sortino.toFixed(2)}  Ul ${p1(r.perf.ulcer).padStart(5)}  ` +
    `10y[${d.map((x) => p1(x)).join('/')}]  매매 ${r.trades.perYear.toFixed(1)}/년`
}

function main() {
  const ctx = setup()
  const out = { config: { START, END, COST_DEFAULT, RULE_DEFAULT }, grid: [], oat: [] }
  console.log(`기간 ${ctx.mkt.dates[ctx.a]}~${ctx.mkt.dates[ctx.b]}  비용 ${JSON.stringify(COST_DEFAULT)}`)
  console.log(`영상 목표                  CAGR  32.9  MDD  -62.0  So 1.08  Ul  29.9  10y[1.6/4.7/12.5/141.0]  매매 8.1/년\n`)
  console.log('── V1(체결) × V2(52주 고점) × V3(중간 구간)')
  for (const exec of ['close0', 'open1', 'close1']) {
    for (const ddDef of ['c252', 'h252', 'c250', 'c365']) {
      for (const hold of ['A', 'B']) {
        const r = evaluate(ctx, { ddDef, hold }, { exec })
        const label = `${exec} ${ddDef} ${hold}`
        console.log(summaryRow(label, r))
        out.grid.push({ exec, ddDef, hold, perf: r.perf, dist10: r.dist10[0], tradesPerYear: r.trades.perYear })
      }
    }
  }
  console.log('\n── 기본 조합(close1 c252 A)에서 한 변수씩')
  const OAT = [
    ['기본', {}, {}],
    ['V4 첫날 MA 기준 국면', { init: 'ma' }, {}],
    ['신호 시작 1990-12-26', { signalFrom: '1990-12-26' }, {}],
    ['V5 EMA', { maType: 'ema' }, {}],
    ['V10 매일 리밸런싱', {}, { rebal: 'daily' }],
    ['V10 월초 리밸런싱', {}, { rebal: 'monthly' }],
    ['V12 거래비용 0', {}, { costBps: 0 }],
    ['V12 거래비용 10bp', {}, { costBps: 10 }],
    ['낙폭 조건 제거', { useDD: false }, {}],
    ['낙폭 조건 제거(close0)', { useDD: false }, { exec: 'close0' }],
    ['VIX 상한 32', { vixUp: 32 }, {}],
  ]
  for (const [label, rule, sim] of OAT) {
    const r = evaluate(ctx, rule, sim)
    console.log(summaryRow(label, r))
    out.oat.push({ label, rule, sim, perf: r.perf, dist10: r.dist10[0], tradesPerYear: r.trades.perYear })
  }
  if (process.argv.includes('--json')) {
    const f = path.resolve(import.meta.dirname, '../../docs/research/tripod/results.json')
    fs.writeFileSync(f, JSON.stringify(out, (k, x) => (typeof x === 'number' ? +x.toFixed(4) : x), 1) + '\n')
    console.log('\n저장:', f)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
