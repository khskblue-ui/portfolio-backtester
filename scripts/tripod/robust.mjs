// 5단계: 강건성 점검 (영상 범위 밖 — 과적합 여부 판단용)
// 사용: node scripts/tripod/robust.mjs
// 모든 실행은 동결한 비용 모델과 재현 기본 조합(다음 날 종가 체결 · 종가 252일 고점 · 국면만 유지)을 쓴다.
import {
  loadMarket, buildProducts, holdCurve, computeSignals, simulate, COST_DEFAULT, RULE_DEFAULT,
  cagr, maxDD, years, idxOf,
} from './lib.mjs'

const END = '2026-08-28'
const pct = (x) => (x * 100).toFixed(1)

export function runRule(mkt, prod, rule, from, to = END) {
  const a = idxOf(mkt, from)
  let b = mkt.dates.findIndex((d) => d > to) - 1
  if (b < 0) b = mkt.dates.length - 1
  const sig = computeSignals(mkt, { ...RULE_DEFAULT, ...rule })
  const { v, trades } = simulate(mkt, prod, sig, { startIdx: a, endIdx: b, exec: 'close1', costBps: 5 })
  const yrs = years(mkt, a, b)
  const bench = [0, 1, 2].map((k) => holdCurve(mkt, prod, k, a, b))
  return { cagr: cagr(v, yrs), mdd: maxDD(v), trades: trades.length / yrs, bench: bench.map((c) => ({ cagr: cagr(c, yrs), mdd: maxDD(c) })) }
}

export const NEIGHBORS = [
  ['maWin', [150, 200, 225, 250, 275, 300]],
  ['upBand', [1.0, 1.01, 1.02, 1.03, 1.05]],
  ['downBand', [0.9, 0.93, 0.95, 0.97, 0.99]],
  ['vixWin', [1, 5, 10, 15, 20]],
  ['vixUp', [22, 25, 28, 31, 35, 99]],
  ['vixDown', [14, 16, 18, 20, 22, 99]],
  ['ddLimit', [-0.05, -0.07, -0.08, -0.09, -0.10, -0.11, -0.13, -0.15]],
]
export const HEAT_DD = [-0.06, -0.07, -0.08, -0.09, -0.10, -0.11, -0.12]
export const HEAT_VIX = [22, 25, 28, 31, 34]
export const SPLITS = [['1991-01-02', '2008-12-31'], ['2009-01-02', END], ['2000-01-03', '2012-12-31'], ['2013-01-02', END]]

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** 하루(수익률·VIX·금리) 묶음을 B일 블록 단위로 섞은 가상 경로 n개에 고정 규칙 적용 → 트라이팟 − 보유 CAGR 차이 */
export function shuffleTest(mkt, B, n = 200) {
  const i0 = idxOf(mkt, '1990-01-02'), iN = mkt.dates.length - 1
  const recs = []
  for (let i = i0 + 1; i <= iN; i++) {
    const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * ((Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365)
    recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
  }
  const synth = (order) => {
    const len = order.length + 1
    const close = new Array(len), vix = new Array(len), irx = new Array(len)
    close[0] = 1000; vix[0] = recs[order[0]].vix; irx[len - 1] = recs[order.at(-1)].irx
    order.forEach((o, j) => { close[j + 1] = close[j] * (1 + recs[o].r); vix[j + 1] = recs[o].vix; irx[j] = recs[o].irx })
    return { dates: mkt.dates.slice(i0, i0 + len), close, open: [close[0], ...close.slice(0, -1)], high: close, vix, irx, etfStart: '2999-01-01', divYield: new Map() }
  }
  const rand = rng(B * 7919)
  const diffs = [[], [], []], wins = []
  for (let k = 0; k < n; k++) {
    const blocks = []
    for (let s = 0; s < recs.length; s += B) blocks.push(Array.from({ length: Math.min(B, recs.length - s) }, (_, j) => s + j))
    for (let j = blocks.length - 1; j > 0; j--) { const x = Math.floor(rand() * (j + 1)); [blocks[j], blocks[x]] = [blocks[x], blocks[j]] }
    const m = synth(blocks.flat())
    const p = buildProducts(m, { ...COST_DEFAULT, divs: false })
    const sig = computeSignals(m, RULE_DEFAULT)
    const a = 260, b = m.dates.length - 1, yrs = years(m, a, b)
    const { v } = simulate(m, p, sig, { startIdx: a, endIdx: b, exec: 'close1', costBps: 5 })
    const c = cagr(v, yrs)
    const hold = [0, 1, 2].map((kk) => cagr(holdCurve(m, p, kk, a, b), yrs))
    hold.forEach((h, j) => diffs[j].push(c - h))
    wins.push(c > hold[1] && c > hold[2])
  }
  return { diffs, wins }
}

function main() {
  const mkt = loadMarket({ end: END })
  const prod = buildProducts(mkt, COST_DEFAULT)
  const base = runRule(mkt, prod, {}, '1991-01-02')
  console.log(`기준: CAGR ${pct(base.cagr)}%  MDD ${pct(base.mdd)}%  매매 ${base.trades.toFixed(1)}회/년`)

  // (1) 파라미터 이웃 — 한 번에 하나씩
  console.log('\n── (1) 파라미터 이웃 (CAGR / MDD)')
  for (const [key, vals] of NEIGHBORS) {
    console.log(`  ${key.padEnd(8)} ` + vals.map((x) => { const r = runRule(mkt, prod, { [key]: x }, '1991-01-02'); return `${x}: ${pct(r.cagr)}/${pct(r.mdd)}` }).join('  '))
  }

  // (2) 2차원: 낙폭 한도 × VIX 상한 (CAGR)
  console.log('\n── (2) 낙폭 한도 × VIX 상한 — CAGR %')
  console.log('  dd\\vix ' + HEAT_VIX.map((x) => String(x).padStart(6)).join(''))
  for (const dd of HEAT_DD) console.log(`  ${String(dd).padEnd(6)} ` + HEAT_VIX.map((vu) => pct(runRule(mkt, prod, { ddLimit: dd, vixUp: vu }, '1991-01-02').cagr).padStart(6)).join(''))

  // (3) 기간 분할
  console.log('\n── (3) 기간 분할 (트라이팟 | QQQ · QLD · TQQQ 보유) CAGR/MDD')
  for (const [s, e] of SPLITS) {
    const r = runRule(mkt, prod, {}, s, e)
    console.log(`  ${s.slice(0, 7)}~${e.slice(0, 7)}  ${pct(r.cagr)}/${pct(r.mdd)}  |  ${r.bench.map((x) => `${pct(x.cagr)}/${pct(x.mdd)}`).join('  ')}`)
  }

  // (4) 다른 지수: S&P500 (^GSPC + SPY 배당, 1993 이전 배당 연 3% 가정, SPY 보수 0.09%)
  console.log('\n── (4) S&P500에 같은 규칙 (트라이팟 | 1·2·3배 보유)')
  const spx = loadMarket({ base: 'GSPC', end: END })
  const spxProd = buildProducts(spx, { ...COST_DEFAULT, preDivYield: 3.0, etfFee: 0.09 })
  const rs = runRule(spx, spxProd, {}, '1991-01-02')
  console.log(`  1991~2026  ${pct(rs.cagr)}/${pct(rs.mdd)}  |  ${rs.bench.map((x) => `${pct(x.cagr)}/${pct(x.mdd)}`).join('  ')}  매매 ${rs.trades.toFixed(1)}회/년`)

  // (5) 셔플 검정
  console.log('\n── (5) 셔플 검정 (블록 단위 순열, 각 200회) — 트라이팟 CAGR − 보유 CAGR 중앙값과 트라이팟이 QLD·TQQQ 보유를 모두 이긴 비율')
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] }
  for (const B of [1, 21, 252]) {
    const { diffs, wins } = shuffleTest(mkt, B)
    console.log(`  블록 ${String(B).padStart(3)}일: 차이 중앙값 QQQ ${pct(med(diffs[0]))} · QLD ${pct(med(diffs[1]))} · TQQQ ${pct(med(diffs[2]))}%p, 레버리지 보유 둘 다 이긴 비율 ${pct(wins.filter(Boolean).length / wins.length)}%`)
  }
  const real = runRule(mkt, prod, {}, '1991-01-02')
  console.log(`  실제 경로: 차이 QQQ ${pct(real.cagr - real.bench[0].cagr)} · QLD ${pct(real.cagr - real.bench[1].cagr)} · TQQQ ${pct(real.cagr - real.bench[2].cagr)}%p`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
