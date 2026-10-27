// 8단계: QQQ 보유 대비 우위가 유지되는가 (영상 범위 밖)
// 사용: node scripts/tripod/vsqqq.mjs > docs/research/tripod/vsqqq-output.txt
//
// A 실제 ETF 가격(2010-02~2026-10)  B 보유 기간별 승률과 시기별 추이  C 연 수익 구간별 승패
// D 샤프 차이 부트스트랩  E 파라미터 576개 세후  F 수익률·금리·변동성이 나빠지는 가정과 손익분기
// G 블록 부트스트랩 10년 가상 경로(+ 5년: 2배판·30% 넘는 손실 확률·QQQ MDD 포함)
// 비용 모델·체결(다음 날 종가)·수수료(편도 5bp)·세금 모델은 앞 단계와 같다.
import {
  loadMarket, buildProducts, holdCurve, computeSignals, simulate, COST_DEFAULT, RULE_DEFAULT,
  maxDD, years, idxOf, monthEnds, exitAfter, quantile, readBars,
} from './lib.mjs'
import { simTax, TAX, tripodPlan, holdPlan } from './aftertax.mjs'

const START = '1991-01-02', END = '2026-08-28'
const pct = (x, d = 1) => (x * 100).toFixed(d)
const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${pct(x, d)}`
const log = console.log
const NOTAX = { ...TAX, enabled: false }
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** 세전·세후 한 번에: CAGR, MDD(청산 전 평가액), 최종 배수 */
function both(m, p, plan, a, b) {
  const yrs = years(m, a, b)
  const out = {}
  for (const [k, tax] of [['pre', NOTAX], ['at', TAX]]) {
    const r = simTax(m, p, { startIdx: a, endIdx: b, plan, tax })
    out[k] = { cagr: (r.final / 1e8) ** (1 / yrs) - 1, mdd: maxDD(r.path), mult: r.final / 1e8, path: r.path }
  }
  return out
}
const cm = (r) => `${pct(r.cagr).padStart(5)} / ${pct(r.mdd).padStart(6)}`

const mkt = loadMarket({ end: END })
const prod = buildProducts(mkt, COST_DEFAULT)
const sig = computeSignals(mkt, RULE_DEFAULT)
const A = idxOf(mkt, START), B = mkt.dates.length - 1
const TRI = tripodPlan(sig), QQQ = holdPlan(0)

// ── A. 실제 ETF 가격 ──────────────────────────────────────────────────────
log('── A. 실제 ETF 수정종가로 다시 계산 (TQQQ 상장 2010-02-11 → 2026-10-20, 신호는 같은 나스닥100 규칙)')
{
  const m = loadMarket({ end: '2026-10-20' })
  const syn = buildProducts(m, COST_DEFAULT)
  const s = computeSignals(m, RULE_DEFAULT)
  const a = m.dates.indexOf('2010-02-11'), b = m.dates.length - 1
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(readBars(n).map((x) => [x.d, x.a])))
  // 실제 상품: 수정종가 비율(분배금 재투자 포함). 현금은 가상 계산과 같은 ^IRX
  const real = { full: syn.full.map((f, k) => (k === 3 ? f : Float64Array.from(f, (x, i) => (i > a ? adj[k].get(m.dates[i]) / adj[k].get(m.dates[i - 1]) : x)))) }
  const plan = tripodPlan(s)
  const rows = [
    ['트라이팟 (실제 ETF)', real, plan], ['트라이팟 (가상 상품)', syn, plan],
    ['QQQ 보유 (실제)', real, holdPlan(0)], ['QLD 보유 (실제)', real, holdPlan(1)], ['TQQQ 보유 (실제)', real, holdPlan(2)],
  ]
  log('전략                     세전 CAGR / MDD    세후 CAGR / MDD    세후 1억 →')
  const res = {}
  for (const [name, p, pl] of rows) {
    const r = both(m, p, pl, a, b)
    res[name] = r
    log(`${name.padEnd(20)}  ${cm(r.pre)}    ${cm(r.at)}    ${r.at.mult.toFixed(2)}억`)
  }
  // 연도별(세전)
  const ends = []
  for (let i = a; i <= b; i++) if (i === b || m.dates[i].slice(0, 4) !== m.dates[i + 1].slice(0, 4)) ends.push(i)
  const t = res['트라이팟 (실제 ETF)'].pre.path, q = res['QQQ 보유 (실제)'].pre.path
  let prev = a, wins = 0
  const ys = []
  for (const e of ends) {
    const rt = t[e - a] / t[prev - a] - 1, rq = q[e - a] / q[prev - a] - 1
    if (rt > rq) wins++
    ys.push(`${m.dates[e].slice(0, 4)} ${pct(rt, 0)}/${pct(rq, 0)}`)
    prev = e
  }
  log(`  연도별 세전 수익(트라이팟 / QQQ, %, 2010·2026은 일부): ${ys.join(' · ')}`)
  log(`  트라이팟이 이긴 해 ${wins}/${ends.length}`)
  // 실제 ETF 5년 보유 창(월말 진입), 세후
  const me = monthEnds(m, a, b)
  let n = 0, w = 0
  const ex = []
  for (const e of me) {
    const x = exitAfter(m, e, 5, b)
    if (x < 0) break
    const yrs = years(m, e, x)
    const ft = simTax(m, real, { startIdx: e, endIdx: x, plan, tax: TAX }).final / 1e8
    const fq = simTax(m, real, { startIdx: e, endIdx: x, plan: holdPlan(0), tax: TAX }).final / 1e8
    n++; if (ft > fq) w++
    ex.push(ft ** (1 / yrs) - fq ** (1 / yrs))
  }
  ex.sort((p, q2) => p - q2)
  log(`  실제 ETF 5년 보유 창 ${n}개(세후): 트라이팟 승 ${pct(w / n)}% · 연 초과 최악 ${sgn(ex[0])}%p · 중간 ${sgn(quantile(ex, 0.5))}%p · 최고 ${sgn(ex.at(-1))}%p`)
}

// ── B. 보유 기간별 승률과 시기별 추이 ────────────────────────────────────
log('\n── B. 보유 기간별 승률 (1991-01~2026-08, 월말 진입, 트라이팟 최종 금액 > QQQ 최종 금액)')
{
  const me = monthEnds(mkt, A, B)
  const H = [1, 3, 5, 10]
  log('보유 기간  창 개수   세전 승률   세후 승률   세후 연 초과(최악 / 25% / 중간)    진입 시기별 세후 승률 1991~99 / 2000~09 / 2010~')
  for (const h of H) {
    let n = 0, wp = 0, wa = 0
    const ex = []
    const byEra = { a: [0, 0], b: [0, 0], c: [0, 0] }
    for (const e of me) {
      const x = exitAfter(mkt, e, h, B)
      if (x < 0) break
      const yrs = years(mkt, e, x)
      const run = (plan, tax) => simTax(mkt, prod, { startIdx: e, endIdx: x, plan, tax }).final / 1e8
      const tp = run(TRI, NOTAX), qp = run(QQQ, NOTAX), ta = run(TRI, TAX), qa = run(QQQ, TAX)
      n++
      if (tp > qp) wp++
      if (ta > qa) wa++
      ex.push(ta ** (1 / yrs) - qa ** (1 / yrs))
      const y = mkt.dates[e].slice(0, 4)
      const era = y < '2000' ? 'a' : y < '2010' ? 'b' : 'c'
      byEra[era][0]++; if (ta > qa) byEra[era][1]++
    }
    ex.sort((p, q) => p - q)
    const er = (k) => (byEra[k][0] ? `${pct(byEra[k][1] / byEra[k][0], 0)}%(${byEra[k][0]})` : '—')
    log(`${String(h).padStart(4)}년    ${String(n).padStart(6)}    ${pct(wp / n).padStart(6)}%    ${pct(wa / n).padStart(6)}%    ${sgn(ex[0]).padStart(6)} / ${sgn(quantile(ex, 0.25)).padStart(6)} / ${sgn(quantile(ex, 0.5)).padStart(6)}%p      ${er('a')} / ${er('b')} / ${er('c')}`)
  }
}

// ── C. 연 수익 구간별 승패 ───────────────────────────────────────────────
log('\n── C. 어떤 해에 지나: QQQ 연수익 구간별 트라이팟 성적 (세전, 1991~2025 완전한 해)')
{
  const v = simulate(mkt, prod, sig, { startIdx: A, endIdx: B }).v, q = holdCurve(mkt, prod, 0, A, B)
  const ends = []
  for (let i = A; i <= B; i++) if (i === B || mkt.dates[i].slice(0, 4) !== mkt.dates[i + 1].slice(0, 4)) ends.push(i)
  const yrs = []
  let prev = A
  for (const e of ends) {
    const y = mkt.dates[e].slice(0, 4)
    if (y !== '2026') yrs.push({ y, t: v[e - A] / v[prev - A] - 1, q: q[e - A] / q[prev - A] - 1, trades: sig.target.slice(prev, e).filter((x, j, arr) => j && x !== arr[j - 1]).length })
    prev = e
  }
  const BK = [['QQQ -10% 미만', (r) => r.q < -0.1], ['-10~+10%', (r) => r.q >= -0.1 && r.q < 0.1], ['+10~+25%', (r) => r.q >= 0.1 && r.q < 0.25], ['+25% 이상', (r) => r.q >= 0.25]]
  for (const [name, f] of BK) {
    const g = yrs.filter(f)
    const rel = g.map((r) => (1 + r.t) / (1 + r.q) - 1).sort((p, q2) => p - q2)
    log(`  ${name.padEnd(13)} ${String(g.length).padStart(2)}해: 트라이팟 승 ${g.filter((r) => r.t > r.q).length} · 상대 성과 중간 ${sgn(quantile(rel, 0.5), 0)}% · 해당 해 ${g.map((r) => `${r.y}(${sgn((1 + r.t) / (1 + r.q) - 1, 0)})`).join(' ')}`)
  }
  const WB = [['신호 전환 0~3회', (r) => r.trades <= 3], ['4~9회', (r) => r.trades >= 4 && r.trades <= 9], ['10회 이상', (r) => r.trades >= 10]]
  for (const [name, f] of WB) {
    const g = yrs.filter(f)
    log(`  ${name.padEnd(13)} ${String(g.length).padStart(2)}해: 트라이팟 승 ${g.filter((r) => r.t > r.q).length} · 상대 성과 중간 ${sgn(quantile(g.map((r) => (1 + r.t) / (1 + r.q) - 1).sort((p, q2) => p - q2), 0.5), 0)}%`)
  }
}

// ── D. 샤프 차이 부트스트랩 ──────────────────────────────────────────────
log('\n── D. 위험 대비 수익(샤프) 우위의 신뢰구간: 같은 날을 묶어 뽑는 정상 블록 부트스트랩 2,000회')
function sharpeBoot(xt, xq, L, draws = 2000, seed = 11) {
  const n = xt.length
  const sh = (s, q, c) => { const mu = s / c; return (mu / Math.sqrt(q / c - mu * mu)) * Math.sqrt(252) }
  const sum = (x) => x.reduce((s, v) => s + v, 0), sq = (x) => x.reduce((s, v) => s + v * v, 0)
  const obs = sh(sum(xt), sq(xt), n) - sh(sum(xq), sq(xq), n)
  const rnd = rng(seed)
  const d = []
  for (let k = 0; k < draws; k++) {
    let st = 0, qt = 0, sq2 = 0, qq = 0, c = 0
    while (c < n) {
      let s = Math.floor(rnd() * n)
      const len = Math.min(n - c, Math.max(1, Math.ceil(Math.log(1 - rnd()) / Math.log(1 - 1 / L))))
      for (let j = 0; j < len; j++, s = (s + 1) % n) { st += xt[s]; qt += xt[s] * xt[s]; sq2 += xq[s]; qq += xq[s] * xq[s] }
      c += len
    }
    d.push(sh(st, qt, n) - sh(sq2, qq, n))
  }
  d.sort((p, q) => p - q)
  return { obs, lo: d[Math.floor(0.05 * draws)], hi: d[Math.floor(0.95 * draws)], pNeg: d.filter((x) => x <= 0).length / draws }
}
{
  const excess = (v, a) => Array.from({ length: v.length - 1 }, (_, j) => v[j + 1] / v[j] - prod.full[3][a + j + 1])
  const vt = simulate(mkt, prod, sig, { startIdx: A, endIdx: B }).v, vq = holdCurve(mkt, prod, 0, A, B)
  const xt = excess(vt, A), xq = excess(vq, A)
  for (const L of [63, 250]) {
    const r = sharpeBoot(xt, xq, L)
    log(`  1991~2026 평균 블록 ${String(L).padStart(3)}일: 샤프 차이 ${r.obs.toFixed(2)} (90% 구간 ${r.lo.toFixed(2)}~${r.hi.toFixed(2)}), 차이 ≤ 0 비율 ${pct(r.pNeg)}%`)
  }
  for (const [f, t] of [['1991-01-02', '2008-12-31'], ['2009-01-02', END]]) {
    const a = idxOf(mkt, f), b = mkt.dates.findIndex((d) => d > t) - 1
    const bb = b < 0 ? B : b
    const r = sharpeBoot(excess(simulate(mkt, prod, sig, { startIdx: a, endIdx: bb }).v, a), excess(holdCurve(mkt, prod, 0, a, bb), a), 250)
    log(`  ${f.slice(0, 4)}~${t.slice(0, 4)} 평균 블록 250일: 샤프 차이 ${r.obs.toFixed(2)} (90% 구간 ${r.lo.toFixed(2)}~${r.hi.toFixed(2)}), 차이 ≤ 0 비율 ${pct(r.pNeg)}%`)
  }
}

// ── E. 파라미터 576개 세후 ───────────────────────────────────────────────
log('\n── E. 파라미터를 어떻게 골라도 이기나: 576개 조합 세후 CAGR − QQQ 세후 CAGR')
{
  const GRID = []
  for (const maWin of [150, 200, 250, 300]) for (const vixUp of [22, 25, 28, 31, 35, 1e9]) for (const vixDown of [14, 18, 22, 1e9]) {
    for (const dd of [-0.05, -0.07, -0.09, -0.11, -0.13, null]) GRID.push({ maWin, vixUp, vixDown, ddLimit: dd ?? -1, useDD: dd !== null })
  }
  const plans = GRID.map((r) => tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, ...r })))
  for (const [f, label] of [[START, '1991-01~2026-08'], ['2000-01-03', '2000-01~2026-08 (닷컴 고점 직전 시작)'], ['2009-01-02', '2009-01~2026-08']]) {
    const a = idxOf(mkt, f)
    const yrs = years(mkt, a, B)
    const q = (simTax(mkt, prod, { startIdx: a, endIdx: B, plan: QQQ, tax: TAX }).final / 1e8) ** (1 / yrs) - 1
    const d = plans.map((plan) => (simTax(mkt, prod, { startIdx: a, endIdx: B, plan, tax: TAX }).final / 1e8) ** (1 / yrs) - 1 - q).sort((p, q2) => p - q2)
    log(`  ${label.padEnd(30)} QQQ 세후 ${pct(q)}% · 576개 중 QQQ보다 높은 조합 ${d.filter((x) => x > 0).length}개 · 차이 최저 ${sgn(d[0])} / 10% ${sgn(quantile(d, 0.1))} / 중간 ${sgn(quantile(d, 0.5))}%p`)
  }
}

// ── F. 앞으로 환경이 나빠진다면 ──────────────────────────────────────────
log('\n── F. 나스닥100 수익률이 낮아지거나 금리·변동성이 높아진다면 (1991~2026 경로를 변형, 신호도 변형된 지수로 다시 계산)')
/** haircut: 연 로그수익 차감, volK: 평균을 둔 채 일간 로그수익 편차와 VIX를 k배, rateAdd: ^IRX에 더할 %p */
function tweak(m, { haircut = 0, volK = 1, rateAdd = 0 }) {
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
  return { ...m, close, open: m.open.map((x, i) => x * f[i]), high: m.high.map((x, i) => x * f[i]), vix: m.vix.map((x) => x * volK), irx: m.irx.map((x) => x + rateAdd) }
}
function scenario(opts) {
  const m = tweak(mkt, opts), p = buildProducts(m, COST_DEFAULT)
  const s = computeSignals(m, RULE_DEFAULT)
  return { t: both(m, p, tripodPlan(s), A, B), q: both(m, p, QQQ, A, B) }
}
{
  log('가정                                   QQQ 세전  | 트라이팟 세전 CAGR / MDD | 세후 트라이팟 − QQQ')
  const SC = [
    ['실제 경로', {}],
    ['나스닥100 연 -2%p', { haircut: 0.02 }], ['연 -4%p', { haircut: 0.04 }], ['연 -6%p', { haircut: 0.06 }], ['연 -8%p', { haircut: 0.08 }],
    ['금리 +2%p', { rateAdd: 2 }], ['변동성 1.25배(VIX 포함)', { volK: 1.25 }],
    ['연 -4%p + 금리 +2%p', { haircut: 0.04, rateAdd: 2 }], ['연 -4%p + 변동성 1.25배', { haircut: 0.04, volK: 1.25 }],
  ]
  for (const [name, o] of SC) {
    const r = scenario(o)
    log(`  ${name.padEnd(34)} ${pct(r.q.pre.cagr).padStart(5)}%  | ${cm(r.t.pre)}       | ${sgn(r.t.at.cagr - r.q.at.cagr).padStart(6)}%p (트라이팟 ${pct(r.t.at.cagr)}% / QQQ ${pct(r.q.at.cagr)}%)`)
  }
  for (const [label, base] of [['', {}], [' (금리 +2%p일 때)', { rateAdd: 2 }]]) {
    let lo = 0, hi = 0.25
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2
      const r = scenario({ ...base, haircut: mid })
      if (r.t.at.cagr > r.q.at.cagr) lo = mid; else hi = mid
    }
    const r = scenario({ ...base, haircut: (lo + hi) / 2 })
    log(`  손익분기${label}: 나스닥100이 연 ${pct((lo + hi) / 2)}%p 낮았다면(QQQ 세전 ${pct(r.q.pre.cagr)}%, 세후 ${pct(r.q.at.cagr)}%) 세후 우위가 0`)
  }
}

// ── G. 블록 부트스트랩 10년 가상 경로 ────────────────────────────────────
log('\n── G. 앞으로 10년 가상 경로 1,000개 (1990~2026의 하루 묶음[수익률·VIX·금리]을 평균 L일 블록으로 이어 붙임, 앞 262일은 신호 준비용)')
log('   세후는 배당을 가격 수익에 넣어 양도세로 처리(배당 원천징수 대신). 추세가 이어지는 정도는 블록 길이 L로 가정한다(짧을수록 추세가 끊김)')
{
  const i0 = idxOf(mkt, '1990-01-02')
  const recs = []
  for (let i = i0 + 1; i <= B; i++) {
    const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365
    const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * dt
    recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
  }
  const WARM = 262
  // 2배판: 트라이팟 규칙, TQQQ 100% 자리에 QLD 100% (tripod-alternatives.md T2)
  const t2Plan = (sig) => (i) => { const t = sig.target[i - 1] ?? 'CASH'; return { key: t, w: t === 'T3' ? [0, 1, 0, 0] : t === 'B15' ? [0.5, 0.5, 0, 0] : [0, 0, 0, 1] } }
  const run = (L, haircut, horizon = 10, paths = 1000) => {
    const LEN = 252 * horizon + WARM
    const dates = mkt.dates.slice(i0, i0 + LEN + 1)
    const rnd = rng(L * 31 + Math.round(haircut * 1000))
    const out = []
    for (let k = 0; k < paths; k++) {
      const close = [1000], vix = [], irx = []
      vix.push(recs[0].vix)
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
      const s = computeSignals(m, RULE_DEFAULT)
      const yrs = years(m, WARM, LEN)
      const f = (plan, tax) => simTax(m, p, { startIdx: WARM, endIdx: LEN, plan, tax })
      const tA = f(tripodPlan(s), TAX), qA = f(holdPlan(0), TAX), tP = f(tripodPlan(s), NOTAX), qP = f(holdPlan(0), NOTAX)
      const row = { ex: (tA.final / 1e8) ** (1 / yrs) - (qA.final / 1e8) ** (1 / yrs), win: tA.final > qA.final, winP: tP.final > qP.final, tLoss: tA.final < 1e8, qLoss: qA.final < 1e8, tMdd: maxDD(tP.path), qC: (qP.final / 1e8) ** (1 / yrs) - 1 }
      if (horizon !== 10) {
        const wA = f(t2Plan(s), TAX), wP = f(t2Plan(s), NOTAX)
        Object.assign(row, { wEx: (wA.final / 1e8) ** (1 / yrs) - (qA.final / 1e8) ** (1 / yrs), wWin: wA.final > qA.final, wLoss: wA.final < 1e8,
          tBig: tA.final < 0.7e8, qBig: qA.final < 0.7e8, wBig: wA.final < 0.7e8, wMdd: maxDD(wP.path), qMdd: maxDD(qP.path) })
      }
      out.push(row)
    }
    const ex = out.map((o) => o.ex).sort((p, q) => p - q)
    const md = out.map((o) => o.tMdd).sort((p, q) => p - q), qc = out.map((o) => o.qC).sort((p, q) => p - q)
    const fr = (key) => pct(out.filter((o) => o[key]).length / out.length)
    const head = `  L=${String(L).padStart(3)}일${haircut ? `, 나스닥100 연 -${pct(haircut, 0)}%p` : '              '}`
    if (horizon === 10) {
      log(`${head}: QQQ 세전 10년 CAGR 중간 ${pct(quantile(qc, 0.5))}% | 트라이팟이 QQQ보다 많이 남긴 경로 세전 ${fr('winP')}% · 세후 ${fr('win')}% | 세후 연 초과 10% ${sgn(quantile(ex, 0.1))} / 중간 ${sgn(quantile(ex, 0.5))} / 90% ${sgn(quantile(ex, 0.9))}%p | 원금 손실 트라이팟 ${fr('tLoss')}% · QQQ ${fr('qLoss')}% | 트라이팟 MDD 중간 ${pct(quantile(md, 0.5), 0)}%`)
      return
    }
    const q = (key, p) => quantile(out.map((o) => o[key]).sort((a, b) => a - b), p)
    const row = (name, w, e, lo, big, mdd) =>
      `    ${name} ${w ? `QQQ보다 많이 남김(세후) ${fr(w)}% | 세후 연 초과 10% / 중간 / 90% ${sgn(q(e, 0.1))} / ${sgn(q(e, 0.5))} / ${sgn(q(e, 0.9))}%p | ` : ''}원금 손실 ${fr(lo)}% · 30% 넘는 손실 ${fr(big)}% | 세전 MDD 중간 ${pct(q(mdd, 0.5), 0)}%`
    log(`${head}: QQQ 세전 ${horizon}년 CAGR 중간 ${pct(quantile(qc, 0.5))}%`)
    log(row('트라이팟', 'win', 'ex', 'tLoss', 'tBig', 'tMdd'))
    log(row('2배판   ', 'wWin', 'wEx', 'wLoss', 'wBig', 'wMdd'))
    log(row('QQQ     ', null, null, 'qLoss', 'qBig', 'qMdd'))
  }
  for (const L of [21, 63, 126, 252]) run(L, 0)
  for (const L of [63, 252]) run(L, 0.04)
  log('\n── G2. 같은 방법의 5년 가상 경로 1,000개 (1억 원 목돈, 세후 청산 기준, 2배판과 QQQ의 손실 쪽 지표 포함)')
  for (const L of [21, 63, 126, 252]) run(L, 0, 5)
  for (const L of [63, 252]) run(L, 0.04, 5)
}
