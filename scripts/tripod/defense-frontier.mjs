// 11단계 보충: 사후 탐색(사전 등록 아님, 판정 없음) — 노출만 바꾼 단순 혼합과 시점 규칙을 같은 가상 경로에서 비교한다.
// 질문: "하락에 강하면서 QQQ를 이길 확률이 50%를 넘는 점"이 있는가, 시점 규칙은 노출만 바꾼 것보다 나은가.
// 사용: node scripts/tripod/defense-frontier.mjs > docs/research/tripod/defense-frontier-output.txt
import { loadMarket, buildProducts, COST_DEFAULT, maxDD, idxOf, quantile } from './lib.mjs'
import { simTax, TAX, yearlyRebal } from './aftertax.mjs'
import { planOf, weightsOf, tripodExposure } from './strategies.mjs'
import { varianceExposure, bandRegime, defenseExposure } from './defense-strategies.mjs'

const pct = (x, d = 1) => (x * 100).toFixed(d)
const log = console.log
const NOTAX = { ...TAX, enabled: false }
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return quantile(s, 0.5) }
const round = (x) => Math.round(x * 2) / 2

/** 전략 목록: 정적 혼합(연 1회 비중 되돌림)과 시점 규칙(배율 k) */
const STATIC = [0.5, 0.75, 1.25, 1.5, 2]
const RULES = [
  { id: 'd3x1', name: '분산 조절 ×1 (D3)', L: (m) => varianceExposure(m).map((v) => (v === null ? null : round(Math.min(2, v)))) },
  { id: 'd3x125', name: '분산 조절 ×1.25', L: (m) => varianceExposure(m).map((v) => (v === null ? null : round(Math.min(2, 1.25 * v)))) },
  { id: 'd3x15', name: '분산 조절 ×1.5', L: (m) => varianceExposure(m).map((v) => (v === null ? null : round(Math.min(2, 1.5 * v)))) },
  { id: 'd4x1', name: '추세 국면 1배 (D4)', L: (m) => defenseExposure(m, 'd4') },
  { id: 'd4x15', name: '추세 국면 1.5배', L: (m) => bandRegime(m.close).map((r) => (r === null ? null : r === 'UP' ? 1.5 : 0)) },
  { id: 'd4x2', name: '추세 국면 2배', L: (m) => bandRegime(m.close).map((r) => (r === null ? null : r === 'UP' ? 2 : 0)) },
  { id: 'd1', name: '추세 + 분산 조절 (D1)', L: (m) => defenseExposure(m, 'd1') },
  { id: 'd2', name: '+ 낙폭 예산 (D2)', L: (m) => defenseExposure(m, 'd2') },
  { id: 't2', name: '트라이팟 2배판', L: (m) => tripodExposure(m, 2).L },
  { id: 'tripod', name: '트라이팟', L: (m) => tripodExposure(m, 3).L },
]

const mkt = loadMarket({ end: '2026-08-28' })
const B = mkt.dates.length - 1
const i0 = idxOf(mkt, '1990-01-02')
const recs = []
for (let i = i0 + 1; i <= B; i++) {
  const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365
  const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * dt
  recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
}
const WARM = 1520

log('사후 탐색(사전 등록 아님, 판정 없음). defense.mjs §4와 같은 생성기·준비 구간·씨앗으로 같은 경로를 만든다.')
log('정적 혼합 k배: 1배 이하는 QQQ k + 현금, 1배 넘으면 QQQ·QLD 조합, 매년 첫 거래일에 비중을 되돌림(실현이익 과세). 시점 규칙 ×k는 노출에 k를 곱해 2배 상한·0.5배 단위.')
for (const horizon of [5, 10]) for (const L of [63, 252]) {
  const LEN = WARM + 252 * horizon
  const dates = mkt.dates.slice(i0, i0 + LEN + 1)
  const rnd = rng(L * 31 + horizon * 1009) // defense.mjs와 같은 씨앗 → 같은 경로
  const ids = ['qqq', ...STATIC.map((k) => `s${k}`), ...RULES.map((r) => r.id)]
  const res = Object.fromEntries(ids.map((id) => [id, { at: [], pre: [], mdd: [], expo: [] }]))
  for (let k = 0; k < 1000; k++) {
    const close = [1000], vix = [recs[0].vix], irx = []
    let c = 0
    while (c < LEN) {
      let s = Math.floor(rnd() * recs.length)
      const len = Math.min(LEN - c, Math.max(1, Math.ceil(Math.log(1 - rnd()) / Math.log(1 - 1 / L))))
      for (let j = 0; j < len; j++, s = (s + 1) % recs.length) {
        close.push(close[c] * (1 + recs[s].r)); vix.push(recs[s].vix); irx[c] = recs[s].irx
        c++
      }
    }
    irx[LEN] = irx[LEN - 1]
    const m = { dates, close, open: [close[0], ...close.slice(0, -1)], high: close, vix, irx, etfStart: '9999-12-31', divYield: new Map(), etfClose: new Map() }
    const p = buildProducts(m, { ...COST_DEFAULT, divs: false })
    const yr = yearlyRebal(m)
    const run = (id, plan, rebalance, Lx) => {
      const a = simTax(m, p, { startIdx: WARM, endIdx: LEN, plan, rebalance, tax: TAX })
      const b = simTax(m, p, { startIdx: WARM, endIdx: LEN, plan, rebalance, tax: NOTAX })
      res[id].at.push(a.final / 1e8); res[id].pre.push(b.final / 1e8); res[id].mdd.push(maxDD(b.path))
      if (Lx) { let e = 0; for (let i = WARM; i < LEN; i++) e += Lx[i - 1] ?? 0; res[id].expo.push(e / (LEN - WARM)) }
    }
    run('qqq', () => ({ key: 'H', w: weightsOf(1) }), undefined)
    for (const kx of STATIC) run(`s${kx}`, () => ({ key: `S${kx}`, w: weightsOf(kx) }), yr)
    for (const r of RULES) { const Lx = r.L(m); if (Lx[WARM - 1] === null) throw new Error(`${r.id}: 준비 전`); run(r.id, planOf(Lx), undefined, Lx) }
  }
  const q = res.qqq
  const row = (id, name, expo) => {
    const r = res[id]
    const win = r.at.filter((f, j) => f > q.at[j]).length / 1000, winP = r.pre.filter((f, j) => f > q.pre[j]).length / 1000
    const loss = r.at.filter((f) => f < 1).length / 1000, big = r.at.filter((f) => f < 0.7).length / 1000
    return `  ${name.padEnd(22)} ${expo.padStart(5)}  ${id === 'qqq' ? '   —     —  ' : `${pct(win).padStart(5)}% ${pct(winP).padStart(5)}%`}  ${pct(loss).padStart(5)}%  ${pct(big).padStart(5)}%   ${pct(median(r.mdd), 0).padStart(4)}%   ${median(r.at).toFixed(2)}`
  }
  log(`\n── ${horizon}년 · 블록 L=${L}일 (1,000경로)`)
  log('  전략                    평균노출  QQQ보다 많이 남김(세후 · 세전)  원금 손실(세후)  30% 넘는 손실  세전 MDD 중간  세후 배수 중간')
  log(row('qqq', 'QQQ 보유(기준)', '1.00'))
  for (const kx of STATIC) log(row(`s${kx}`, `정적 ${kx}배`, kx.toFixed(2)))
  for (const r of RULES) log(row(r.id, r.name, median(res[r.id].expo).toFixed(2)))
}
