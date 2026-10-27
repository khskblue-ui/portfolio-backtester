// 11단계: 방어형 후보 평가 (명세: docs/research/tripod/defense-spec.md, 2026-10-27 사전 등록)
// 사용: node scripts/tripod/defense.mjs > docs/research/tripod/defense-output.txt (1차 후보)
//       node scripts/tripod/defense.mjs 2 > docs/research/tripod/defense-output-r2.txt (2차 후보, 명세 §6)
// 판정은 명세 §4의 기준을 코드로 그대로 옮겼다. 값은 결과를 보고 바꾸지 않는다.
// 비용 모델·체결(다음 날 종가)·수수료(편도 5bp)·세금 모델은 앞 단계와 같다.
import {
  loadMarket, buildProducts, COST_DEFAULT, maxDD, ulcer, years, idxOf, readBars, monthEnds, exitAfter, quantile,
} from './lib.mjs'
import { simTax, TAX } from './aftertax.mjs'
import { planOf, weightsOf, tripodExposure } from './strategies.mjs'
import { DEFENSE, DEFENSE2 } from './defense-strategies.mjs'
import { simDca } from './dca.mjs'

const START = '1991-01-02', END = '2026-08-28'
const pct = (x, d = 1) => (x * 100).toFixed(d)
const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${pct(x, d)}`
const log = console.log
const NOTAX = { ...TAX, enabled: false }
const QQQ_PLAN = () => ({ key: 'H', w: weightsOf(1) })
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }

const ROUND = process.argv[2] === '2' ? 2 : 1
const CANDS = ROUND === 2 ? DEFENSE2 : DEFENSE
const JUDGED = CANDS.map((s) => s.id)
const REF = [
  // 2차에서는 1차의 분산 조절(D3)·추세 국면(D4)을 함께 보여 준다(판정 없음)
  ...(ROUND === 2 ? DEFENSE.filter((s) => s.id === 'd3' || s.id === 'd4').map((s) => ({ ...s, name: `${s.name}(1차)` })) : []),
  { id: 'tripod', name: '트라이팟(참고)', exposure: (m) => tripodExposure(m, 3).L },
  { id: 't2', name: '트라이팟 2배판(참고)', exposure: (m) => tripodExposure(m, 2).L },
]
const ALL = [...CANDS, ...REF]
const NAME = { ...Object.fromEntries(ALL.map((s) => [s.id, s.name])), qqq: '단순 보유(1배)' }
const label = (id) => `${id.toUpperCase().padEnd(6)} ${NAME[id]}`.padEnd(34)

/** 세전·세후 성과 + 평균 노출·현금 비중(L이 있을 때) */
function evaluate(m, p, plan, a, b, { pre = true, L = null } = {}) {
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
    const sd = Math.sqrt(q / n - mu * mu) * Math.sqrt(252)
    Object.assign(out, { cagr: (r.final / 1e8) ** (1 / yrs) - 1, mdd: maxDD(r.path), ulcer: ulcer(r.path), sharpe: (mu * 252) / sd, vol: sd, tpy: sw / yrs })
  }
  if (L) {
    let e = 0, c = 0, k = 0
    for (let i = a; i < b; i++) { const x = L[i - 1] ?? 0; e += x; if (x === 0) c++; k++ }
    Object.assign(out, { avgL: e / k, cash: c / k })
  }
  return out
}
/** 판정 후보가 모두 준비된 다음 날(공통 시작 인덱스) */
function commonStart(m, exps, ids, from) {
  let a = idxOf(m, from)
  for (const id of ids) a = Math.max(a, exps[id].findIndex((x) => x !== null) + 1)
  return a
}
const exposures = (m, list = ALL) => Object.fromEntries(list.map((s) => [s.id, s.exposure(m)]))
const verdict = Object.fromEntries(JUDGED.map((id) => [id, {}]))

// ── 0. 나스닥100 1991~2026 (참고 + D-c 일부) ──────────────────────────────
const mkt = loadMarket({ end: END })
const prod = buildProducts(mkt, COST_DEFAULT)
const EXP = exposures(mkt)
const A = commonStart(mkt, EXP, JUDGED, START), B = mkt.dates.length - 1
const ref = {}
{
  log(`── 0. 나스닥100 ${mkt.dates[A]}~${mkt.dates[B]} (참고: 이미 여러 번 본 구간. 세후 MDD만 D-c 판정에 씀)`)
  log(`${'전략'.padEnd(34)} 세전 CAGR / MDD   울서  샤프  변동성 연매매 평균노출 현금비중 | 세후 CAGR / MDD  | 1991~2008 세후    2009~2026 세후`)
  const split = idxOf(mkt, '2009-01-02')
  for (const id of [...JUDGED, ...REF.map((s) => s.id), 'qqq']) {
    const plan = id === 'qqq' ? QQQ_PLAN : planOf(EXP[id])
    const r = evaluate(mkt, prod, plan, A, B, { L: id === 'qqq' ? null : EXP[id] })
    const s1 = evaluate(mkt, prod, plan, A, split - 1, { pre: false }), s2 = evaluate(mkt, prod, plan, split, B, { pre: false })
    ref[id] = r
    const ex = r.avgL == null ? '   1.00     0.0%' : `   ${r.avgL.toFixed(2)}   ${pct(r.cash).padStart(5)}%`
    log(`${label(id)} ${pct(r.cagr).padStart(5)} / ${pct(r.mdd).padStart(6)}  ${r.ulcer.toFixed(1).padStart(5)}  ${r.sharpe.toFixed(2)}  ${pct(r.vol).padStart(5)}% ${r.tpy.toFixed(1).padStart(5)} ${ex} | ${pct(r.at).padStart(5)} / ${pct(r.atMdd).padStart(6)} | ${pct(s1.at).padStart(5)} / ${pct(s1.atMdd).padStart(6)}   ${pct(s2.at).padStart(5)} / ${pct(s2.atMdd).padStart(6)}`)
  }
  for (const id of JUDGED) verdict[id].dcNdx = ref[id].atMdd > ref.qqq.atMdd
}

// ── 0b. 과거 5년 보유 창 (참고, 월말 진입, 세후) ─────────────────────────
{
  log('\n── 0b. 나스닥100 과거 5년 보유 창 (참고, 월말 진입, 1억 원, 세후 청산 기준)')
  const ends = monthEnds(mkt, A, B)
  const wins = Object.fromEntries([...JUDGED, ...REF.map((s) => s.id)].map((id) => [id, { win: 0, loss: 0, ex: [] }]))
  let n = 0, qLoss = 0
  for (const e of ends) {
    const x = exitAfter(mkt, e, 5, B)
    if (x < 0) break
    n++
    const q = simTax(mkt, prod, { startIdx: e, endIdx: x, plan: QQQ_PLAN, tax: TAX }).final
    if (q < 1e8) qLoss++
    const yrs = years(mkt, e, x)
    for (const id of Object.keys(wins)) {
      const f = simTax(mkt, prod, { startIdx: e, endIdx: x, plan: planOf(EXP[id]), tax: TAX }).final
      if (f > q) wins[id].win++
      if (f < 1e8) wins[id].loss++
      wins[id].ex.push((f / 1e8) ** (1 / yrs) - (q / 1e8) ** (1 / yrs))
    }
  }
  log(`창 ${n}개 · QQQ 원금 손실 창 ${pct(qLoss / n)}%`)
  for (const id of Object.keys(wins)) {
    const w = wins[id], ex = w.ex.slice().sort((a, b) => a - b)
    log(`  ${label(id)} QQQ보다 많이 남긴 창 ${pct(w.win / n).padStart(5)}% · 원금 손실 창 ${pct(w.loss / n).padStart(5)}% · 연 초과 최악 / 25% / 중간 ${sgn(ex[0])} / ${sgn(quantile(ex, 0.25))} / ${sgn(quantile(ex, 0.5))}%p`)
  }
}

// ── 1. 실제 ETF 2010-02-11~2026-10-20 (참고) ─────────────────────────────
{
  log('\n── 1. 실제 ETF 수정종가 2010-02-11~2026-10-20 (참고, 세후 CAGR / MDD, 신호는 나스닥100 지수)')
  const m = loadMarket({ end: '2026-10-20' })
  const syn = buildProducts(m, COST_DEFAULT)
  const a = m.dates.indexOf('2010-02-11'), b = m.dates.length - 1
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((x) => new Map(readBars(x).map((y) => [y.d, y.a])))
  const real = { full: syn.full.map((f, k) => (k === 3 ? f : Float64Array.from(f, (x, i) => (i > a ? adj[k].get(m.dates[i]) / adj[k].get(m.dates[i - 1]) : x)))) }
  const E = exposures(m)
  const q = evaluate(m, real, QQQ_PLAN, a, b, { pre: false })
  log(`  ${label('qqq')} ${pct(q.at)}% / ${pct(q.atMdd)}%`)
  for (const s of ALL) { const r = evaluate(m, real, planOf(E[s.id]), a, b, { pre: false }); log(`  ${label(s.id)} ${pct(r.at)}% / ${pct(r.atMdd)}%`) }
}

// ── 2. 다른 시장 8곳 (D-b, E-b) ──────────────────────────────────────────
log('\n── 2. 다른 시장 8곳 (세후 CAGR / 세후 MDD, 판정 후보가 모두 준비된 날부터, 금리 ^IRX, 트라이팟·2배판은 미국 밖에서 전 거래일 VIX)')
const MK = [
  ['GSPC', 'S&P500', { preDivYield: 3.0, etfFee: 0.09 }], ['IXIC', '나스닥 종합', {}], ['RUT', '러셀2000', {}], ['GDAXI', 'DAX', {}],
  ['FTSE', 'FTSE100', {}], ['N225', '닛케이225', {}], ['HSI', '항셍', {}], ['KS11', '코스피', {}],
]
{
  const tally = Object.fromEntries(ALL.map((s) => [s.id, { cagrWin: 0, mddWin: 0, ex: [], mdd: [] }]))
  log(`시장        기간              1배 보유       ${ALL.map((s) => s.id.toUpperCase().padEnd(13)).join('')}`)
  for (const [base, name, opt] of MK) {
    const m = loadMarket({ base, end: END })
    const p = buildProducts(m, { ...COST_DEFAULT, ...opt })
    const E = exposures(m)
    const a = commonStart(m, E, JUDGED, START), b = m.dates.length - 1
    const h = evaluate(m, p, QQQ_PLAN, a, b, { pre: false })
    const cells = ALL.map((s) => {
      if (E[s.id][a - 1] === null) return '   (준비 전)  '
      const r = evaluate(m, p, planOf(E[s.id]), a, b, { pre: false })
      const t = tally[s.id]
      if (r.at > h.at) t.cagrWin++
      if (r.atMdd > h.atMdd) t.mddWin++
      t.ex.push(r.at - h.at); t.mdd.push(r.atMdd)
      return `${pct(r.at).padStart(5)}/${pct(r.atMdd, 0).padStart(4)}   `
    })
    log(`${name.padEnd(10)} ${m.dates[a].slice(0, 7)}~${m.dates[b].slice(0, 7)}  ${pct(h.at).padStart(5)}/${pct(h.atMdd, 0).padStart(4)}    ${cells.join('')}`)
  }
  for (const s of ALL) {
    const t = tally[s.id]
    log(`  ${label(s.id)} 1배보다 CAGR 높은 시장 ${t.cagrWin}/8 · MDD 얕은 시장 ${t.mddWin}/8 · 1배 대비 CAGR 차이 중간 ${sgn(median(t.ex))}%p · MDD 중간 ${pct(median(t.mdd))}%`)
  }
  for (const id of JUDGED) { verdict[id].db = tally[id].mddWin >= 6; verdict[id].eb = tally[id].cagrWin >= 5 }
}

// ── 3. 나스닥 종합 1972~1990 (D-c 일부, VIX 없는 후보만) ─────────────────
{
  log('\n── 3. 나스닥 종합 1972~1990 (판정 후보가 모두 준비된 날부터, 금리 ^IRX 1971~, 세전 / 세후)')
  const m = loadMarket({ base: 'IXIC', end: '1990-12-31', irxName: 'IRX-1971' })
  const p = buildProducts(m, COST_DEFAULT)
  const E = exposures(m, CANDS)
  const a = commonStart(m, E, JUDGED, '1971-01-01'), b = m.dates.length - 1
  const h = evaluate(m, p, QQQ_PLAN, a, b)
  log(`  ${m.dates[a]}~${m.dates[b]}`)
  log(`  ${label('qqq')} 세전 ${pct(h.cagr)}% / ${pct(h.mdd)}% · 세후 ${pct(h.at)}% / ${pct(h.atMdd)}%`)
  for (const id of JUDGED) {
    const r = evaluate(m, p, planOf(E[id]), a, b, { L: E[id] })
    log(`  ${label(id)} 세전 ${pct(r.cagr)}% / ${pct(r.mdd)}% · 세후 ${pct(r.at)}% / ${pct(r.atMdd)}% · 평균 노출 ${r.avgL.toFixed(2)} · 현금 ${pct(r.cash)}% · 연 매매 ${r.tpy.toFixed(1)}`)
    verdict[id].dc7290 = r.atMdd > h.atMdd
  }
}

// ── 4. 나스닥100 가상 경로 (D-a, E-a + 참고) ─────────────────────────────
log('\n── 4. 나스닥100 가상 경로 1,000개 (vsqqq.mjs G절과 같은 생성기, 준비 구간 1,520거래일 뒤 5년·10년, 세후 청산 기준, 1억 원)')
{
  const i0 = idxOf(mkt, '1990-01-02')
  const recs = []
  for (let i = i0 + 1; i <= B; i++) {
    const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365
    const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * dt
    recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
  }
  const WARM = 1520
  const run = (L, horizon, haircut) => {
    const LEN = WARM + 252 * horizon
    const dates = mkt.dates.slice(i0, i0 + LEN + 1)
    const rnd = rng(L * 31 + horizon * 1009 + Math.round(haircut * 1000))
    const ids = [...ALL.map((s) => s.id), 'qqq']
    const res = Object.fromEntries(ids.map((id) => [id, { fin: [], pfin: [], mdd: [] }]))
    for (let k = 0; k < 1000; k++) {
      const close = [1000], vix = [recs[0].vix], irx = []
      let c = 0
      while (c < LEN) {
        let s = Math.floor(rnd() * recs.length)
        const len = Math.min(LEN - c, Math.max(1, Math.ceil(Math.log(1 - rnd()) / Math.log(1 - 1 / L))))
        for (let j = 0; j < len; j++, s = (s + 1) % recs.length) {
          const dt = (Date.parse(dates[c + 1]) - Date.parse(dates[c])) / 864e5 / 365
          close.push(close[c] * (1 + recs[s].r) * Math.exp(-haircut * dt)); vix.push(recs[s].vix); irx[c] = recs[s].irx
          c++
        }
      }
      irx[LEN] = irx[LEN - 1]
      const m = { dates, close, open: [close[0], ...close.slice(0, -1)], high: close, vix, irx, etfStart: '9999-12-31', divYield: new Map(), etfClose: new Map() }
      const p = buildProducts(m, { ...COST_DEFAULT, divs: false })
      const E = exposures(m)
      for (const s of ALL) if (E[s.id][WARM - 1] === null) throw new Error(`${s.id}: 준비 구간 안에 지표가 준비되지 않음`)
      for (const id of ids) {
        const plan = id === 'qqq' ? QQQ_PLAN : planOf(E[id])
        const at = simTax(m, p, { startIdx: WARM, endIdx: LEN, plan, tax: TAX })
        const pre = simTax(m, p, { startIdx: WARM, endIdx: LEN, plan, tax: NOTAX })
        res[id].fin.push(at.final / 1e8); res[id].pfin.push(pre.final / 1e8); res[id].mdd.push(maxDD(pre.path))
      }
    }
    const q = res.qqq
    const yrs = horizon
    const stat = (id) => {
      const r = res[id]
      const ex = r.fin.map((f, j) => f ** (1 / yrs) - q.fin[j] ** (1 / yrs))
      return {
        win: r.fin.filter((f, j) => f > q.fin[j]).length / 1000, loss: r.fin.filter((f) => f < 1).length / 1000,
        big: r.fin.filter((f) => f < 0.7).length / 1000, mdd: median(r.mdd), ex: median(ex), mult: median(r.fin),
        // 참고(명세에 없던 지표, 첫 실행 결과를 본 뒤 추가): 세금 없는 계좌를 가정한 세전 비교
        winPre: r.pfin.filter((f, j) => f > q.pfin[j]).length / 1000, lossPre: r.pfin.filter((f) => f < 1).length / 1000,
      }
    }
    const out = Object.fromEntries(ids.map((id) => [id, stat(id)]))
    log(`\n  ${horizon}년 · 블록 L=${L}일${haircut ? ` · 나스닥100 연 -${pct(haircut, 0)}%p` : ''}: QQQ 원금 손실 ${pct(out.qqq.loss)}% · 30% 넘는 손실 ${pct(out.qqq.big)}% · 세전 MDD 중간 ${pct(out.qqq.mdd, 0)}% · 배수 중간 ${out.qqq.mult.toFixed(2)} | 세전 원금 손실 ${pct(out.qqq.lossPre)}%`)
    for (const s of ALL) {
      const o = out[s.id]
      log(`    ${label(s.id)} QQQ보다 많이 남김 ${pct(o.win).padStart(5)}% · 연 초과 중간 ${sgn(o.ex).padStart(5)}%p · 원금 손실 ${pct(o.loss).padStart(5)}% · 30% 넘는 손실 ${pct(o.big).padStart(5)}% · 세전 MDD 중간 ${pct(o.mdd, 0).padStart(4)}% · 배수 중간 ${o.mult.toFixed(2)} | 세전 비교: 많이 남김 ${pct(o.winPre).padStart(5)}% · 원금 손실 ${pct(o.lossPre).padStart(5)}%`)
    }
    return out
  }
  const judged = []
  for (const horizon of [5, 10]) for (const L of [63, 252]) judged.push(run(L, horizon, 0))
  for (const id of JUDGED) {
    verdict[id].da = judged.every((o) => o[id].loss <= o.qqq.loss && o[id].mdd > o.qqq.mdd)
    verdict[id].ea = judged.every((o) => o[id].win > 0.5)
  }
  log('\n  (참고) 블록 21·126일과 나스닥100 연 -4%p')
  for (const horizon of [5, 10]) for (const L of [21, 126]) run(L, horizon, 0)
  for (const horizon of [5, 10]) for (const L of [63, 252]) run(L, horizon, 0.04)
}

// ── 5. 환경 악화 (E-c) ───────────────────────────────────────────────────
log('\n── 5. 환경 악화 (1991~2026 나스닥100 경로 변형, 대안 평가 ③과 같은 방식, 세후 CAGR − QQQ 세후 CAGR, 괄호는 세후 MDD)')
{
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
  for (const [key, lab, o] of [['h4', '나스닥100 연 -4%p', { haircut: 0.04 }], ['v125', '변동성 1.25배', { volK: 1.25 }]]) {
    const m = tweak(mkt, o), p = buildProducts(m, COST_DEFAULT), E = exposures(m)
    const q = evaluate(m, p, QQQ_PLAN, A, B, { pre: false })
    stress[key] = {}
    log(`  ${lab}: QQQ 세후 ${pct(q.at)}% (MDD ${pct(q.atMdd, 0)}%)`)
    for (const s of ALL) {
      const r = evaluate(m, p, planOf(E[s.id]), A, B, { pre: false })
      stress[key][s.id] = r.at - q.at
      log(`    ${label(s.id)} ${sgn(r.at - q.at)}%p (${pct(r.atMdd, 0)}%)`)
    }
  }
  for (const id of JUDGED) verdict[id].ec = stress.h4[id] >= 0 && stress.v125[id] >= 0
}

// ── 6. 적립식 10년 창 (참고, 매월 첫 거래일 $2,000) ──────────────────────
{
  log('\n── 6. 적립식 10년 창 (참고, 나스닥100, 매월 첫 거래일 종가에 $2,000, 목표 비중의 모자란 쪽부터 채움, 세후 청산)')
  const firsts = []
  for (let i = A; i <= B; i++) if (mkt.dates[i].slice(0, 7) !== mkt.dates[i - 1].slice(0, 7)) firsts.push(i)
  const isFirst = new Set(firsts)
  const contribDay = (i) => isFirst.has(i)
  const wins = []
  for (let j = 0; j + 120 < firsts.length; j++) wins.push([firsts[j], firsts[j + 120] - 1])
  const res = {}
  for (const id of ['qqq', ...JUDGED, ...REF.map((s) => s.id)]) {
    const plan = id === 'qqq' ? QQQ_PLAN : planOf(EXP[id])
    res[id] = wins.map(([a, b]) => simDca(mkt, prod, { startIdx: a, endIdx: b, plan, contribDay }))
  }
  log(`창 ${wins.length}개 (${mkt.dates[wins[0][0]].slice(0, 7)}~${mkt.dates[wins.at(-1)[0]].slice(0, 7)} 시작)`)
  for (const id of ['qqq', ...JUDGED, ...REF.map((s) => s.id)]) {
    const r = res[id]
    const beat = id === 'qqq' ? '—' : `${pct(r.filter((x, j) => x.final > res.qqq[j].final).length / r.length)}%`
    log(`  ${label(id)} 세후 배수 중간 ${median(r.map((x) => x.mult)).toFixed(2)} · IRR 중간 ${pct(median(r.map((x) => x.irr)))}% · 원금 대비 최악 중간 ${pct(median(r.map((x) => x.worstVsPaid)))}% · 원금 손실 창 ${pct(r.filter((x) => x.mult < 1).length / r.length)}% · QQQ보다 많이 남긴 창 ${beat}`)
  }
}

// ── 판정 (명세 §4) ───────────────────────────────────────────────────────
log(`\n── 판정 (${ROUND}차 후보, 명세 §4 기준 그대로)`)
log('후보                                D-a 경로  D-b 시장  D-c 역사 | 목표1 하락에 강함 | E-a 경로  E-b 시장  E-c 악화 | 목표2 확률적 우위 | 목표 달성')
const o = (x) => (x ? '충족' : '미충족').padEnd(8)
for (const id of JUDGED) {
  const v = verdict[id]
  v.dc = v.dcNdx && v.dc7290
  const g1 = v.da && v.db && v.dc, g2 = v.ea && v.eb && v.ec
  log(`${label(id)} ${o(v.da)}  ${o(v.db)}  ${o(v.dc)} | ${(g1 ? '예' : '아니오').padEnd(16)} | ${o(v.ea)}  ${o(v.eb)}  ${o(v.ec)} | ${(g2 ? '예' : '아니오').padEnd(16)} | ${g1 && g2 ? '예' : '아니오'}`)
}
log('(D-c 세부: 나스닥100 세후 MDD가 QQQ보다 얕음 · 1972~1990 세후 MDD가 1배보다 얕음)')
for (const id of JUDGED) log(`  ${label(id)} ${verdict[id].dcNdx ? '예' : '아니오'} · ${verdict[id].dc7290 ? '예' : '아니오'}`)
