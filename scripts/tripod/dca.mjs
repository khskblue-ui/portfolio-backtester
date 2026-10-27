// 10단계: 적립식(매월 일정 금액 추가)에서 트라이팟을 어떻게 적용하고, QQQ 적립과 어떻게 비교하나 (영상 범위 밖)
// 사용: node scripts/tripod/dca.mjs > docs/research/tripod/dca-output.txt
//
// 적립 규칙(모든 전략 공통): 매월 첫 거래일 종가에 적립금을 넣고, 그날 유효한 목표 비중에서 모자란 쪽부터 채운다
//   (파는 일 없음). QQQ 100%면 전액 QQQ, QQQ 60% + 현금 40%면 모자란 쪽을 채움(사용자 제시 규칙).
// 트라이팟: 목표가 바뀌는 날(신호 다음 거래일 종가)에는 계좌 전체를 새 목표로 맞추고, 적립일에는 위와 같이 채운다.
//   현금 국면의 적립금은 현금으로 기다렸다가 다음 전환 때 함께 들어간다. 비중 규칙이라 적립금을 따로 굴려도 결과가 같다.
// 세금: aftertax.mjs와 같은 한국 세금 모델(양도세 22%·연 250만 원 공제·손실 이월 없음, 배당 15%, 이자 15.4%,
//   금융소득 2천만 원 초과분 비교과세 근사, 환율 1,400원 고정), 이동평균 원가, 기간 끝 전량 매도 후 세후 금액.
import {
  loadMarket, buildProducts, computeSignals, COST_DEFAULT, RULE_DEFAULT, maxDD, idxOf, quantile, readBars,
} from './lib.mjs'
import { TAX, progressive } from './aftertax.mjs'
import { tripodExposure, weightsOf } from './strategies.mjs'

const END = '2026-08-28'
const C = 2000 // 월 적립액(달러)
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`
const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}`
const log = console.log
const NOTAX = { ...TAX, enabled: false }
const yrsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25

/**
 * 적립식 세후 시뮬레이터. plan(i) → {key, w}(그날 종가에 맞출 목표). key가 바뀌면 전체 리밸런싱,
 * contribDay(i)면 적립금을 목표의 모자란 쪽부터 채운다. 금액 단위는 달러, 세금은 원화 환산으로 계산.
 */
export function simDca(mkt, prod, { startIdx, endIdx, plan, contribDay, contrib = C, initialUsd = 0, costBps = 5, tax = TAX }) {
  const fx = tax.fx, tc = costBps / 1e4
  const V = [0, 0, 0, 0], B = [0, 0, 0]
  let realized = 0, finInc = 0, taxes = 0, paid = 0, key = null
  let worstVsPaid = 0, worstDate = '', peak = 0, peakDate = '', dollarDD = 0, ddPeakDate = '', ddTroughDate = ''
  const wSum = [0, 0, 0, 0]
  let wN = 0
  const flows = [] // [연, 금액] 투입은 음수
  const total = () => V[0] + V[1] + V[2] + V[3]
  const sellFrac = (k, f) => {
    const s = V[k] * f
    realized += s - B[k] * f - tc * s
    B[k] *= 1 - f; V[k] -= s; V[3] += s * (1 - tc)
  }
  const rebalanceTo = (w) => {
    const tot = total()
    if (tot <= 0) return
    const turn = w.reduce((s, x, k) => s + Math.abs(x - V[k] / tot), 0)
    const post = tot * (1 - tc * turn)
    for (let k = 0; k < 3; k++) {
      const goal = w[k] * post
      if (V[k] > goal) { const f = (V[k] - goal) / V[k]; realized += V[k] * f - B[k] * f; B[k] *= 1 - f }
      else B[k] += goal - V[k]
      V[k] = goal
    }
    realized -= tot - post
    V[3] = w[3] * post
  }
  /** 새 돈 amt를 목표 비중에서 모자란 쪽부터 채움(파는 일 없음) */
  const fill = (amt, w) => {
    const T = total() + amt
    const D = w.map((x, k) => Math.max(0, x * T - V[k]))
    const sD = D.reduce((s, x) => s + x, 0)
    V[3] += amt
    for (let k = 0; k < 3; k++) {
      const x = sD > 0 ? (amt * D[k]) / sD : amt * w[k]
      if (x <= 0) continue
      V[3] -= x; V[k] += x * (1 - tc); B[k] += x * (1 - tc); realized -= x * tc
    }
  }
  const payYearTax = (liquidate) => {
    if (liquidate) for (let k = 0; k < 3; k++) if (V[k] > 0) sellFrac(k, 1)
    if (!tax.enabled) { realized = 0; finInc = 0; return }
    let due = Math.max(0, realized * fx - tax.deductionKrw) * tax.cgRate / fx
    const finKrw = finInc * fx
    if (finKrw > tax.finThresholdKrw) { const ex = finKrw - tax.finThresholdKrw; due += Math.max(0, progressive(ex) - ex * tax.intWh) / fx }
    realized = 0; finInc = 0
    if (due <= 0) return
    taxes += due
    if (V[3] < due) {
      const need = (due - V[3]) / (1 - tc), risky = V[0] + V[1] + V[2]
      const f = Math.min(1, need / risky)
      for (let k = 0; k < 3; k++) if (V[k] > 0) sellFrac(k, f)
    }
    V[3] -= due
  }
  const d0 = mkt.dates[startIdx]
  const deposit = (i, amt, w) => { fill(amt, w); paid += amt; flows.push([yrsBetween(d0, mkt.dates[i]), -amt]) }
  const p0 = plan(startIdx)
  key = p0.key
  if (initialUsd > 0) deposit(startIdx, initialUsd, p0.w)
  if (contribDay(startIdx)) deposit(startIdx, contrib, p0.w)
  const path = [total()]
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const d = mkt.dates[i]
    const dist = d >= mkt.etfStart ? (mkt.divYield.get(d) ?? 0) * V[0] : 0
    V[0] *= prod.full[0][i]
    if (tax.enabled && dist > 0) { V[0] -= dist * tax.divWh; B[0] += dist * (1 - tax.divWh) } else B[0] += dist
    finInc += dist
    V[1] *= prod.full[1][i]; V[2] *= prod.full[2][i]
    const interest = V[3] * (prod.full[3][i] - 1)
    V[3] += interest * (1 - (tax.enabled ? tax.intWh : 0))
    finInc += interest
    const p = plan(i)
    if (p.key !== key) { rebalanceTo(p.w); key = p.key }
    if (contribDay(i)) deposit(i, contrib, p.w)
    const yearEnd = i === endIdx || d.slice(0, 4) !== mkt.dates[i + 1].slice(0, 4)
    // 연말 세금은 평가액에 반영하되, 마지막 날 청산 세금은 낙폭·손실 지표에서 뺀다(청산 전 평가액 기준)
    if (yearEnd && i !== endIdx) payYearTax(false)
    const v = total()
    path.push(v)
    if (v > 0) { for (let k = 0; k < 4; k++) wSum[k] += V[k] / v; wN++ }
    if (paid > 0 && v / paid - 1 < worstVsPaid) { worstVsPaid = v / paid - 1; worstDate = d }
    if (v > peak) { peak = v; peakDate = d }
    if (peak - v > dollarDD) { dollarDD = peak - v; ddPeakDate = peakDate; ddTroughDate = d }
    if (i === endIdx) payYearTax(true)
  }
  const final = total()
  flows.push([yrsBetween(d0, mkt.dates[endIdx]), final])
  return { final, paid, mult: final / paid, irr: irr(flows), worstVsPaid, worstDate, accountMdd: maxDD(path), dollarDD, ddPeakDate, ddTroughDate, taxes, avgW: wSum.map((x) => x / Math.max(1, wN)) }
}

/** 연 단위 내부수익률(이분법) */
function irr(flows) {
  const npv = (r) => flows.reduce((s, [t, cf]) => s + cf / (1 + r) ** t, 0)
  let lo = -0.99, hi = 3
  if (npv(lo) * npv(hi) > 0) return NaN
  for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid }
  return (lo + hi) / 2
}

// ── 시장·전략 ─────────────────────────────────────────────────────────────

const mkt = loadMarket({ end: END })
const prod = buildProducts(mkt, COST_DEFAULT)
const LT = tripodExposure(mkt, 3).L, L2 = tripodExposure(mkt, 2).L
const regime = computeSignals(mkt, { ...RULE_DEFAULT, vixUp: 1e9, vixDown: 0, useDD: false }).target
const fixed = (w, k) => () => ({ key: k, w })
const fromL = (L, prefix) => (i) => { const x = L[i - 1] ?? 0; return { key: `${prefix}${x}`, w: weightsOf(x) } }
export const DCA_STRATS = [
  ['qqq', 'QQQ 100%', fixed([1, 0, 0, 0], 'Q')],
  ['qqq60', 'QQQ 60% + 현금 40%', fixed([0.6, 0, 0, 0.4], 'Q60')],
  ['tripod', '트라이팟', fromL(LT, 'T')],
  ['t2', '트라이팟 2배판', fromL(L2, 'T2')],
  ['tri60', '트라이팟 60% + 현금 40%', (i) => { const x = LT[i - 1] ?? 0; const w = weightsOf(x).map((v) => 0.6 * v); w[3] += 0.4; return { key: `T60${x}`, w } }],
  ['reg1', '국면 필터 1배(상승 QQQ, 하락 현금)', (i) => { const t = regime[i - 1] === 'T3' ? 1 : 0; return { key: `R${t}`, w: weightsOf(t) } }],
  ['qld', 'QLD 100%', fixed([0, 1, 0, 0], 'L2')],
  ['tqqq', 'TQQQ 100%', fixed([0, 0, 1, 0], 'L3')],
]
const NAME = Object.fromEntries(DCA_STRATS.map(([id, n]) => [id, n]))
const isFirst = (m) => (i) => i > 0 && m.dates[i].slice(0, 7) !== m.dates[i - 1].slice(0, 7)
const firstDays = (m) => m.dates.map((_, i) => i).filter((i) => isFirst(m)(i))

/** 월초 시작 n년 적립 창: [시작, 끝] 인덱스. 끝은 n년 뒤 첫 거래일의 전날 */
function windows(m, nYears, from = '1991-01-01') {
  const fd = firstDays(m).filter((i) => m.dates[i] >= from)
  const out = []
  for (let j = 0; j + nYears * 12 < fd.length; j++) out.push([fd[j], fd[j + nYears * 12] - 1])
  const lastEnd = m.dates.length - 1
  // 데이터 끝에서 끝나는 마지막 창(다음 월초가 아직 없음)
  if (fd.length >= nYears * 12) { const j = fd.length - nYears * 12; if (!out.some(([a]) => a === fd[j])) out.push([fd[j], lastEnd]) }
  return out
}

function summarize(rows) {
  const s = (arr) => arr.slice().sort((a, b) => a - b)
  const m = s(rows.map((r) => r.mult)), irrs = s(rows.map((r) => r.irr)), w = s(rows.map((r) => r.worstVsPaid))
  return { n: rows.length, min: m[0], q25: quantile(m, 0.25), med: quantile(m, 0.5), max: m.at(-1), irrMed: quantile(irrs, 0.5), irrMin: irrs[0], worstMed: quantile(w, 0.5), worstMin: w[0], belowPaid: rows.filter((r) => r.mult < 1).length / rows.length }
}

function main() {
  // ── A. 전 기간 ────────────────────────────────────────────────────────────
  log(`── A. 1991-01~2026-08 매월 $${C.toLocaleString()} 적립 (첫 거래일 종가 투입, 편도 5bp)`)
  const A0 = idxOf(mkt, '1991-01-02'), B0 = mkt.dates.length - 1
  log('전략                                  원금        세전 최종      세후 최종      세후 배수  세후 IRR  원금 대비 최악  계좌 최대 낙폭(달러)')
  const fullRes = {}
  for (const [id, name, plan] of DCA_STRATS) {
    const pre = simDca(mkt, prod, { startIdx: A0, endIdx: B0, plan, contribDay: isFirst(mkt), tax: NOTAX })
    const post = simDca(mkt, prod, { startIdx: A0, endIdx: B0, plan, contribDay: isFirst(mkt) })
    fullRes[id] = { pre, post }
    const aw = post.avgW, expo = aw[0] + 2 * aw[1] + 3 * aw[2]
    log(`${name.padEnd(30)} $${(post.paid / 1e3).toFixed(0)}k  $${(pre.final / 1e6).toFixed(2).padStart(7)}M   $${(post.final / 1e6).toFixed(2).padStart(7)}M   ${post.mult.toFixed(1).padStart(6)}배  ${pct(post.irr).padStart(6)}  ${pct(post.worstVsPaid).padStart(8)}   -$${(post.dollarDD / 1e6).toFixed(2)}M (${post.ddPeakDate}→${post.ddTroughDate}, 비율 최대 ${pct(post.accountMdd)}) · 평균 노출 ${expo.toFixed(2)}배(현금 ${pct(aw[3], 0)})`)
  }

  // ── B. 10년·20년 적립 창 ──────────────────────────────────────────────────
  const winRes = {}
  for (const nY of [10, 20]) {
    const W = windows(mkt, nY)
    log(`\n── B. ${nY}년 적립 창 ${W.length}개 (월초 시작 ${mkt.dates[W[0][0]].slice(0, 7)}~${mkt.dates[W.at(-1)[0]].slice(0, 7)}, 세후 청산 금액 ÷ 원금)`)
    log('전략                                  최악    25%    중간    최고  | IRR 중간 · 최악 | 원금 대비 최악(중간 · 최악) | 원금 손실 창 | QQQ 100%보다 많이 남긴 창 · 중간 배수비')
    const res = {}
    for (const [id, , plan] of DCA_STRATS) res[id] = W.map(([a, b]) => simDca(mkt, prod, { startIdx: a, endIdx: b, plan, contribDay: isFirst(mkt) }))
    winRes[nY] = { W, res }
    for (const [id, name] of DCA_STRATS) {
      const s = summarize(res[id])
      const win = res[id].filter((r, j) => r.final > res.qqq[j].final).length / W.length
      const ratio = quantile(res[id].map((r, j) => r.final / res.qqq[j].final).sort((x, y) => x - y), 0.5)
      log(`${name.padEnd(30)} ${s.min.toFixed(2).padStart(6)} ${s.q25.toFixed(2).padStart(6)} ${s.med.toFixed(2).padStart(6)} ${s.max.toFixed(2).padStart(7)} | ${pct(s.irrMed).padStart(6)} · ${pct(s.irrMin).padStart(6)} | ${pct(s.worstMed).padStart(7)} · ${pct(s.worstMin).padStart(7)} | ${pct(s.belowPaid).padStart(6)} | ${id === 'qqq' ? '     —' : pct(win).padStart(6)} · ${ratio.toFixed(2)}`)
    }
    // 시작 시기별 트라이팟 승률
    const eras = [['1991~1999', '1991', '2000'], ['2000~2009', '2000', '2010'], ['2010~', '2010', '9999']]
    log(`  시작 시기별 트라이팟 승률(세후, QQQ 100% 대비): ${eras.map(([lab, a, b]) => { const idx = W.map(([s], j) => [mkt.dates[s].slice(0, 4), j]).filter(([y]) => y >= a && y < b).map(([, j]) => j); return idx.length ? `${lab} ${pct(idx.filter((j) => res.tripod[j].final > res.qqq[j].final).length / idx.length, 0)}(${idx.length})` : '' }).filter(Boolean).join(' · ')}`)
  }

  // ── C. 대표 창: 폭락 직전 시작과 최근 ─────────────────────────────────────
  log('\n── C. 대표 10년 창 (세후 배수, 괄호는 IRR)')
  {
    const { W, res } = winRes[10]
    for (const ym of ['1991-01', '1995-01', '1999-12', '2000-03', '2002-10', '2007-10', '2009-03', '2012-01', '2016-08']) {
      const j = W.findIndex(([a]) => mkt.dates[a].slice(0, 7) === ym)
      if (j < 0) continue
      log(`  ${ym} 시작: ${DCA_STRATS.map(([id]) => `${NAME[id]} ${res[id][j].mult.toFixed(2)}(${pct(res[id][j].irr, 0)})`).join(' · ')}`)
    }
  }

  // ── D. 현금 대기의 비용: 하락 국면 적립금이 언제 들어가나 ────────────────
  log('\n── D. 트라이팟의 현금 대기(하락 국면 + VIX10 ≥ 18) 동안의 적립')
  {
    const fd = firstDays(mkt).filter((i) => i >= A0)
    const cashDays = fd.filter((i) => (LT[i - 1] ?? 0) === 0)
    log(`  1991~2026 적립일 ${fd.length}번 중 현금 국면 ${cashDays.length}번(${pct(cashDays.length / fd.length)})`)
    // 현금으로 기다린 적립금이 다시 들어갈 때 나스닥100이 얼마나 올라 있었나
    const waits = []
    for (const i of cashDays) {
      let j = i
      while (j <= B0 && (LT[j - 1] ?? 0) === 0) j++
      if (j > B0) continue
      waits.push({ d: mkt.dates[i], days: j - i, move: mkt.close[j] / mkt.close[i] - 1 })
    }
    const mv = waits.map((w) => w.move).sort((a, b) => a - b), dy = waits.map((w) => w.days).sort((a, b) => a - b)
    log(`  기다린 적립금이 투입될 때까지: 거래일 중간 ${quantile(dy, 0.5)}일(최장 ${dy.at(-1)}일), 그 사이 나스닥100 변화 중간 ${sgn(quantile(mv, 0.5))}% (범위 ${sgn(mv[0])}~${sgn(mv.at(-1))}%)`)
    log(`  QQQ 적립이라면 그 돈은 그날 바로 QQQ를 샀다. 위 변화가 +면 트라이팟이 더 비싸게 산 것, -면 싸게 산 것`)
  }

  // ── E. 적립액 규모와 세금 ────────────────────────────────────────────────
  log('\n── E. 적립액에 따라 달라지는 세금 효과 (10년 창, 세후 트라이팟 ÷ QQQ 100% 최종 금액의 중간값, 괄호는 세전)')
  {
    const W = winRes[10].W
    const cells = []
    for (const amt of [500, 2000, 10000]) {
      const r = (plan, tax) => W.map(([a, b]) => simDca(mkt, prod, { startIdx: a, endIdx: b, plan, contribDay: isFirst(mkt), contrib: amt, tax }).final)
      const q = r(DCA_STRATS[0][2], TAX), t = r(DCA_STRATS[2][2], TAX), qp = r(DCA_STRATS[0][2], NOTAX), tp = r(DCA_STRATS[2][2], NOTAX)
      const med = (x, y) => quantile(x.map((v, j) => v / y[j]).sort((p, s) => p - s), 0.5)
      cells.push(`월 $${amt.toLocaleString()}: ${med(t, q).toFixed(2)}(${med(tp, qp).toFixed(2)})`)
    }
    log(`  ${cells.join(' · ')}`)
    log('  연 250만 원 공제와 금융소득 2천만 원 기준이 금액과 무관한 고정값이라, 계좌가 클수록 세금 비중이 커진다')
  }

  // ── F. 목돈 + 적립 ───────────────────────────────────────────────────────
  log('\n── F. 초기 $100,000 + 매월 $2,000 (10년 창, 세후 청산 금액 ÷ 원금)')
  {
    const W = winRes[10].W
    for (const id of ['qqq', 'qqq60', 'tripod', 't2', 'tri60']) {
      const plan = DCA_STRATS.find(([x]) => x === id)[2]
      const rows = W.map(([a, b]) => simDca(mkt, prod, { startIdx: a, endIdx: b, plan, contribDay: isFirst(mkt), initialUsd: 100000 }))
      const s = summarize(rows)
      log(`  ${NAME[id].padEnd(28)} 최악 ${s.min.toFixed(2)} · 중간 ${s.med.toFixed(2)} · 최고 ${s.max.toFixed(2)} · IRR 중간 ${pct(s.irrMed)} · 원금 대비 최악 ${pct(s.worstMin)}`)
    }
  }

  // ── G. 실제 ETF(2010~2026) 적립 ──────────────────────────────────────────
  log('\n── G. 실제 ETF 수정종가로 2010-03~2026-10 매월 적립 (세후)')
  {
    const m = loadMarket({ end: '2026-10-20' })
    const syn = buildProducts(m, COST_DEFAULT)
    const a = m.dates.indexOf('2010-02-11')
    const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(readBars(n).map((x) => [x.d, x.a])))
    const real = { full: syn.full.map((f, k) => (k === 3 ? f : Float64Array.from(f, (x, i) => (i > a ? adj[k].get(m.dates[i]) / adj[k].get(m.dates[i - 1]) : x)))) }
    const Lm = tripodExposure(m, 3).L, L2m = tripodExposure(m, 2).L
    const s0 = idxOf(m, '2010-03-01'), e0 = m.dates.length - 1
    const plans = [['QQQ 100%', fixed([1, 0, 0, 0], 'Q')], ['QQQ 60% + 현금 40%', fixed([0.6, 0, 0, 0.4], 'Q60')], ['트라이팟', fromL(Lm, 'T')], ['트라이팟 2배판', fromL(L2m, 'T2')], ['QLD 100%', fixed([0, 1, 0, 0], 'L2')], ['TQQQ 100%', fixed([0, 0, 1, 0], 'L3')]]
    for (const [name, plan] of plans) {
      const r = simDca(m, real, { startIdx: s0, endIdx: e0, plan, contribDay: isFirst(m) })
      log(`  ${name.padEnd(18)} 원금 $${(r.paid / 1e3).toFixed(0)}k → 세후 $${(r.final / 1e3).toFixed(0)}k (${r.mult.toFixed(2)}배, IRR ${pct(r.irr)}) · 원금 대비 최악 ${pct(r.worstVsPaid)} · 계좌 최대 낙폭 -$${(r.dollarDD / 1e3).toFixed(0)}k (${r.ddPeakDate}→${r.ddTroughDate})`)
    }
  }

  // ── H. 10년 가상 적립 경로 (블록 부트스트랩, vsqqq.mjs §10.7과 같은 생성기) ─────────
  log('\n── H. 10년 가상 적립 경로 500개 (1990~2026 하루 묶음을 평균 L일 블록으로 이어 붙임, 앞 262일은 신호 준비용, 세후)')
  {
    const i0 = idxOf(mkt, '1990-01-02')
    const recs = []
    for (let i = i0 + 1; i <= B0; i++) {
      const dt = (Date.parse(mkt.dates[i]) - Date.parse(mkt.dates[i - 1])) / 864e5 / 365
      const div = mkt.dates[i] < mkt.etfStart ? 0 : (mkt.divYield.get(mkt.dates[i]) ?? 0) + (COST_DEFAULT.etfFee / 100) * dt
      recs.push({ r: mkt.close[i] / mkt.close[i - 1] - 1 + div, vix: mkt.vix[i], irx: mkt.irx[i - 1] })
    }
    const WARM = 262, LEN = 2520 + WARM
    const dates = mkt.dates.slice(i0, i0 + LEN + 1)
    for (const L of [63, 252]) {
      const rnd = (() => { let seed = L * 31; return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })()
      const ids = ['qqq', 'qqq60', 'tripod', 't2', 'tri60']
      const fin = Object.fromEntries(ids.map((id) => [id, []]))
      const worst = Object.fromEntries(ids.map((id) => [id, []]))
      for (let k = 0; k < 500; k++) {
        const close = [1000], vix = [recs[0].vix], irx = []
        let c = 0
        while (c < LEN) {
          let st = Math.floor(rnd() * recs.length)
          const len = Math.min(LEN - c, Math.max(1, Math.ceil(Math.log(1 - rnd()) / Math.log(1 - 1 / L))))
          for (let j = 0; j < len; j++, st = (st + 1) % recs.length) { close.push(close[c] * (1 + recs[st].r)); vix.push(recs[st].vix); irx[c] = recs[st].irx; c++ }
        }
        irx[LEN] = irx[LEN - 1]
        const m = { dates, close, open: [close[0], ...close.slice(0, -1)], high: close, vix, irx, etfStart: '9999-12-31', divYield: new Map(), etfClose: new Map() }
        const p = buildProducts(m, { ...COST_DEFAULT, divs: false })
        const Lt = tripodExposure(m, 3).L, Lt2 = tripodExposure(m, 2).L
        const plans = {
          qqq: fixed([1, 0, 0, 0], 'Q'), qqq60: fixed([0.6, 0, 0, 0.4], 'Q60'), tripod: fromL(Lt, 'T'), t2: fromL(Lt2, 'T2'),
          tri60: (i) => { const x = Lt[i - 1] ?? 0; const w = weightsOf(x).map((v) => 0.6 * v); w[3] += 0.4; return { key: `T60${x}`, w } },
        }
        for (const id of ids) {
          const r = simDca(m, p, { startIdx: WARM, endIdx: LEN, plan: plans[id], contribDay: isFirst(m) })
          fin[id].push(r.final / r.paid); worst[id].push(r.worstVsPaid)
        }
      }
      for (const id of ids) {
        const f = fin[id].slice().sort((a, b) => a - b), w = worst[id].slice().sort((a, b) => a - b)
        const win = id === 'qqq' ? '     —' : pct(fin[id].filter((x, j) => x > fin.qqq[j]).length / 500).padStart(6)
        log(`  L=${String(L).padStart(3)}일 ${NAME[id].padEnd(24)} QQQ 100%보다 많이 남김 ${win} · 원금 손실 ${pct(fin[id].filter((x) => x < 1).length / 500).padStart(5)} · 배수 10% ${quantile(f, 0.1).toFixed(2)} / 중간 ${quantile(f, 0.5).toFixed(2)} / 90% ${quantile(f, 0.9).toFixed(2)} · 원금 대비 최악 중간 ${pct(quantile(w, 0.5))}`)
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
