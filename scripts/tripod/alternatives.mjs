// 9단계: 사전 등록한 대안 전략 평가 (명세: docs/research/tripod/candidates-spec.md)
// 사용: node scripts/tripod/alternatives.mjs > docs/research/tripod/alternatives-output.txt
// 판정은 명세 §3의 기준을 코드로 그대로 옮겼다. 값은 결과를 보고 바꾸지 않는다.
import {
  loadMarket, buildProducts, COST_DEFAULT, maxDD, ulcer, years, idxOf, readBars,
} from './lib.mjs'
import { simTax, TAX } from './aftertax.mjs'
import { STRATEGIES, planOf, weightsOf } from './strategies.mjs'

const START = '1991-01-02', END = '2026-08-28'
const pct = (x, d = 1) => (x * 100).toFixed(d)
const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${pct(x, d)}`
const log = console.log
const NOTAX = { ...TAX, enabled: false }
const QQQ_PLAN = () => ({ key: 'H', w: weightsOf(1) })
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const IDS = STRATEGIES.map((s) => s.id)
const NAME = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.name]))

/** 세전·세후 성과 */
function evaluate(m, p, plan, a, b, { pre = true } = {}) {
  const yrs = years(m, a, b)
  const at = simTax(m, p, { startIdx: a, endIdx: b, plan, tax: TAX })
  const out = { at: (at.final / 1e8) ** (1 / yrs) - 1, atMdd: maxDD(at.path), atFinal: at.final / 1e8 }
  if (pre) {
    const r = simTax(m, p, { startIdx: a, endIdx: b, plan, tax: NOTAX })
    let s = 0, q = 0
    const n = r.path.length - 1
    for (let j = 1; j <= n; j++) { const x = r.path[j] / r.path[j - 1] - p.full[3][a + j]; s += x; q += x * x }
    const mu = s / n
    let sw = 0
    for (let i = a + 1; i <= b; i++) if (plan(i).key !== plan(i - 1).key) sw++
    Object.assign(out, { cagr: (r.final / 1e8) ** (1 / yrs) - 1, mdd: maxDD(r.path), ulcer: ulcer(r.path), sharpe: (mu * 252) / (Math.sqrt(q / n - mu * mu) * Math.sqrt(252)), tpy: sw / yrs })
  }
  return out
}
/** 모든 전략이 준비된 다음 날(공통 시작 인덱스) */
function commonStart(m, exps, from) {
  let a = idxOf(m, from)
  for (const L of Object.values(exps)) a = Math.max(a, L.findIndex((x) => x !== null) + 1)
  return a
}
const exposures = (m) => Object.fromEntries(STRATEGIES.map((s) => [s.id, s.exposure(m)]))

const mkt = loadMarket({ end: END })
const prod = buildProducts(mkt, COST_DEFAULT)
const EXP = exposures(mkt)
const A = commonStart(mkt, EXP, START), B = mkt.dates.length - 1
const verdict = Object.fromEntries(IDS.map((id) => [id, {}]))

// ── 0. 나스닥100 1991~2026 (참고, 판정에 쓰지 않음) ────────────────────────
log(`── 0. 나스닥100 ${mkt.dates[A]}~${mkt.dates[B]} (참고: 이미 여러 번 본 구간)`)
log('전략                              세전 CAGR / MDD   울서  샤프  연매매 | 세후 CAGR / MDD  | 1991~2008 세후   2009~2026 세후')
const ref = {}
for (const id of [...IDS, 'qqq']) {
  const plan = id === 'qqq' ? QQQ_PLAN : planOf(EXP[id])
  const r = evaluate(mkt, prod, plan, A, B)
  const s1 = evaluate(mkt, prod, plan, A, idxOf(mkt, '2009-01-02') - 1, { pre: false }), s2 = evaluate(mkt, prod, plan, idxOf(mkt, '2009-01-02'), B, { pre: false })
  ref[id] = r
  log(`${(id === 'qqq' ? 'QQQ 보유' : NAME[id]).padEnd(28)} ${pct(r.cagr).padStart(5)} / ${pct(r.mdd).padStart(6)}  ${r.ulcer.toFixed(1).padStart(5)}  ${r.sharpe.toFixed(2)}  ${r.tpy.toFixed(1).padStart(5)} | ${pct(r.at).padStart(5)} / ${pct(r.atMdd).padStart(6)} | ${pct(s1.at).padStart(5)} / ${pct(s1.atMdd).padStart(6)}  ${pct(s2.at).padStart(5)} / ${pct(s2.atMdd).padStart(6)}`)
}
for (const id of IDS) verdict[id].ndxBeatsQqq = ref[id].at > ref.qqq.at

// ── ① 다른 시장 ──────────────────────────────────────────────────────────
log('\n── ① 다른 시장 (세후 CAGR / 세후 MDD, 모든 전략이 준비된 날부터, 금리 ^IRX, 미국 밖은 전 거래일 VIX)')
const MK = [
  ['GSPC', 'S&P500', { preDivYield: 3.0, etfFee: 0.09 }], ['IXIC', '나스닥 종합', {}], ['RUT', '러셀2000', {}], ['GDAXI', 'DAX', {}],
  ['FTSE', 'FTSE100', {}], ['N225', '닛케이225', {}], ['HSI', '항셍', {}], ['KS11', '코스피', {}],
]
const mk = Object.fromEntries(IDS.map((id) => [id, { win: 0, mdd: [], ex: [] }]))
log(`시장        기간              1배 보유        ${IDS.map((id) => id.padEnd(15)).join('')}`)
for (const [base, name, opt] of MK) {
  const m = loadMarket({ base, end: END })
  const p = buildProducts(m, { ...COST_DEFAULT, ...opt })
  const E = exposures(m)
  const a = commonStart(m, E, START), b = m.dates.length - 1
  const h = evaluate(m, p, QQQ_PLAN, a, b, { pre: false })
  const cells = IDS.map((id) => {
    const r = evaluate(m, p, planOf(E[id]), a, b, { pre: false })
    if (r.at > h.at) mk[id].win++
    mk[id].mdd.push(r.atMdd); mk[id].ex.push(r.at - h.at)
    return `${pct(r.at).padStart(5)}/${pct(r.atMdd, 0).padStart(4)}    `
  })
  log(`${name.padEnd(10)} ${m.dates[a].slice(0, 7)}~${m.dates[b].slice(0, 7)}  ${pct(h.at).padStart(5)}/${pct(h.atMdd, 0).padStart(4)}     ${cells.join('')}`)
}
for (const id of IDS) log(`  ${NAME[id].padEnd(26)} 1배 보유를 이긴 시장 ${mk[id].win}/8 · MDD 중간 ${pct(median(mk[id].mdd))}% · 1배 대비 차이 중간 ${sgn(median(mk[id].ex))}%p`)
for (const id of IDS) verdict[id].c1 = mk[id].win >= mk.tripod.win && median(mk[id].mdd) > median(mk.tripod.mdd)

// ── ② 10년 가상 경로 ─────────────────────────────────────────────────────
log('\n── ② 10년 가상 경로 1,000개 (§10.7과 같은 생성기, 세후). 추세 앙상블은 300일선이 필요해 준비 기간을 262일에서 330일로 늘렸다(모든 전략 공통)')
const i0 = idxOf(mkt, '1990-01-02')
const recs = []
for (let i = i0 + 1; i <= B; i++) {
  const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365
  const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * dt
  recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
}
const WARM = 330, LEN = 2520 + WARM
const bdates = mkt.dates.slice(i0, i0 + LEN + 1)
const boot = {}
for (const L of [63, 252]) {
  const rnd = rng(L * 31)
  const res = Object.fromEntries([...IDS, 'qqq'].map((id) => [id, { fin: [], mdd: [] }]))
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
    const m = { dates: bdates, close, open: [close[0], ...close.slice(0, -1)], high: close, vix, irx, etfStart: '9999-12-31', divYield: new Map(), etfClose: new Map() }
    const p = buildProducts(m, { ...COST_DEFAULT, divs: false })
    const E = exposures(m)
    for (const id of IDS) if (E[id][WARM - 1] === null) throw new Error(`${id}: 준비 기간 안에 지표가 준비되지 않음`)
    for (const id of [...IDS, 'qqq']) {
      const r = simTax(m, p, { startIdx: WARM, endIdx: LEN, plan: id === 'qqq' ? QQQ_PLAN : planOf(E[id]), tax: TAX })
      res[id].fin.push(r.final / 1e8); res[id].mdd.push(maxDD(r.path))
    }
  }
  boot[L] = {}
  for (const id of IDS) {
    const win = res[id].fin.filter((f, j) => f > res.qqq.fin[j]).length / 1000
    boot[L][id] = win
    log(`  L=${String(L).padStart(3)}일 ${NAME[id].padEnd(26)} QQQ보다 많이 남김 ${pct(win).padStart(5)}% · 원금 손실 ${pct(res[id].fin.filter((f) => f < 1).length / 1000).padStart(5)}% · 10년 배수 중간 ${median(res[id].fin).toFixed(2)} · MDD 중간 ${pct(median(res[id].mdd), 0)}%`)
  }
  log(`  L=${String(L).padStart(3)}일 ${'QQQ 보유'.padEnd(26)} 원금 손실 ${pct(res.qqq.fin.filter((f) => f < 1).length / 1000)}% · 10년 배수 중간 ${median(res.qqq.fin).toFixed(2)} · MDD 중간 ${pct(median(res.qqq.mdd), 0)}%`)
}
for (const id of IDS) verdict[id].c2 = boot[63][id] > boot[63].tripod && boot[252][id] > boot[252].tripod
for (const id of IDS) verdict[id].bootQqq = boot[63][id] > 0.5

// ── ③ 환경 악화 ──────────────────────────────────────────────────────────
log('\n── ③ 환경 악화 (1991~2026 나스닥100 경로 변형, 세후 CAGR − QQQ 세후 CAGR)')
function tweak(m, { haircut = 0, volK = 1 }) {
  const n = m.dates.length
  let mu = 0
  for (let i = 1; i < n; i++) mu += Math.log(m.close[i] / m.close[i - 1])
  mu /= n - 1
  const close = new Array(n)
  close[0] = m.close[0]
  for (let i = 1; i < n; i++) {
    const dt = (Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5 / 365
    close[i] = close[i - 1] * Math.exp(mu + volK * (Math.log(m.close[i] / m.close[i - 1]) - mu) - haircut * dt)
  }
  const f = close.map((c, i) => c / m.close[i])
  return { ...m, close, open: m.open.map((x, i) => x * f[i]), high: m.high.map((x, i) => x * f[i]), vix: m.vix.map((x) => x * volK) }
}
const stress = {}
for (const [key, label, o] of [['h4', '나스닥100 연 -4%p', { haircut: 0.04 }], ['v125', '변동성 1.25배', { volK: 1.25 }]]) {
  const m = tweak(mkt, o), p = buildProducts(m, COST_DEFAULT), E = exposures(m)
  const q = evaluate(m, p, QQQ_PLAN, A, B, { pre: false })
  stress[key] = {}
  const cells = IDS.map((id) => {
    const r = evaluate(m, p, planOf(E[id]), A, B, { pre: false })
    stress[key][id] = r.at - q.at
    return `${NAME[id]} ${sgn(r.at - q.at)}%p(${pct(r.atMdd, 0)}%)`
  })
  log(`  ${label.padEnd(16)} QQQ 세후 ${pct(q.at)}% | ${cells.join(' · ')}`)
}
for (const id of IDS) verdict[id].c3 = stress.h4[id] > stress.h4.tripod && stress.v125[id] > stress.v125.tripod

// ── ④ 실제 ETF (참고) ────────────────────────────────────────────────────
log('\n── ④ 실제 ETF 수정종가 2010-02-11~2026-10-20 (참고, 세후 CAGR / MDD)')
{
  const m = loadMarket({ end: '2026-10-20' })
  const syn = buildProducts(m, COST_DEFAULT)
  const a = m.dates.indexOf('2010-02-11'), b = m.dates.length - 1
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(readBars(n).map((x) => [x.d, x.a])))
  const real = { full: syn.full.map((f, k) => (k === 3 ? f : Float64Array.from(f, (x, i) => (i > a ? adj[k].get(m.dates[i]) / adj[k].get(m.dates[i - 1]) : x)))) }
  const E = exposures(m)
  const q = evaluate(m, real, QQQ_PLAN, a, b, { pre: false })
  log(`  QQQ 보유 ${pct(q.at)}% / ${pct(q.atMdd)}% | ${IDS.map((id) => { const r = evaluate(m, real, planOf(E[id]), a, b, { pre: false }); return `${NAME[id]} ${pct(r.at)}% / ${pct(r.atMdd)}%` }).join(' · ')}`)
}

// ── ⑤ 나스닥 종합 1972~1990 (참고, VIX 없음) ─────────────────────────────
log('\n── ⑤ 나스닥 종합 1972~1990 (참고, VIX가 없어 트라이팟·2배판 제외, 세후 CAGR / MDD)')
{
  const m = loadMarket({ base: 'IXIC', end: '1990-12-31', irxName: 'IRX-1971' })
  const p = buildProducts(m, COST_DEFAULT)
  const ids = ['te3', 'tev3', 'tev2']
  const E = Object.fromEntries(STRATEGIES.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.exposure(m)]))
  const a = commonStart(m, E, '1971-01-01'), b = m.dates.length - 1
  const h1 = evaluate(m, p, QQQ_PLAN, a, b, { pre: false }), h3 = evaluate(m, p, () => ({ key: 'H', w: weightsOf(3) }), a, b, { pre: false })
  log(`  ${m.dates[a]}~${m.dates[b]}: 1배 보유 ${pct(h1.at)}% / ${pct(h1.atMdd)}% · 3배 보유 ${pct(h3.at)}% / ${pct(h3.atMdd)}% | ${ids.map((id) => { const r = evaluate(m, p, planOf(E[id]), a, b, { pre: false }); return `${NAME[id]} ${pct(r.at)}% / ${pct(r.atMdd)}%` }).join(' · ')}`)
}

// ── 판정 (명세 §3) ───────────────────────────────────────────────────────
log('\n── 판정 (명세 §3 기준 그대로)')
log('후보                          ①다른 시장  ②10년 경로  ③환경 악화 | 트라이팟보다 낫다 | QQQ보다 낫다(세후 CAGR · 블록63 승률>50%)')
for (const id of IDS.filter((x) => x !== 'tripod')) {
  const v = verdict[id], n = [v.c1, v.c2, v.c3].filter(Boolean).length
  const o = (x) => (x ? '충족' : '미충족').padEnd(9)
  log(`${NAME[id].padEnd(26)} ${o(v.c1)}  ${o(v.c2)}  ${o(v.c3)} | ${n >= 2 ? '예' : '아니오'} (${n}/3)         | ${v.ndxBeatsQqq && v.bootQqq ? '예' : '아니오'} (${v.ndxBeatsQqq ? '충족' : '미충족'} · ${v.bootQqq ? '충족' : '미충족'})`)
}
log(`(트라이팟 자신: QQQ보다 낫다 ${verdict.tripod.ndxBeatsQqq && verdict.tripod.bootQqq ? '예' : '아니오'})`)
