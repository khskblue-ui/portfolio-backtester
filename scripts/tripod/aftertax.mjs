// 6단계: 세후 비교 — 한국 거주자가 미국 상장 ETF를 직접 매매한다고 가정
// 사용: node scripts/tripod/aftertax.mjs
//
// 세금 모델은 앱(src/core/tax.ts defaultTaxConfig)과 같은 근사를 따른다.
// - 양도세: 연간 실현손익 통산 − 250만 원 공제 → 22%(지방세 포함). 손실 이월 없음. 이동평균 원가.
//   연말에 납부(실제는 다음 해 5월)하고, 현금이 모자라면 보유 비율대로 팔아서 낸다.
// - 배당: 미국 원천 15%(QQQ 분배금만. 레버리지 ETF 분배금은 작아 생략).
// - 현금 이자: 15.4% 원천징수(앱 엔진은 이자에 과세하지 않지만 여기서는 실제에 맞춰 넣는다).
// - 금융소득(배당+이자) 연 2천만 원 초과분: 다른 소득이 없다고 보고 누진세율(지방세 포함)로
//   다시 계산해 원천징수분을 넘는 만큼 추가 납부(비교과세 근사).
// - 환율은 1,400원 고정(앱 가정과 같음). 환차손익·건강보험료·환전 수수료는 넣지 않는다.
// - 기간 끝에 전부 팔아 그해 양도세까지 낸 "청산 후" 금액으로 비교한다.
import {
  loadMarket, buildProducts, computeSignals, COST_DEFAULT, RULE_DEFAULT, TARGETS,
  maxDD, ulcer, idxOf, monthEnds, exitAfter, quantile,
} from './lib.mjs'

export const TAX = {
  enabled: true, fx: 1400, cgRate: 0.22, deductionKrw: 2_500_000,
  divWh: 0.15, intWh: 0.154, finThresholdKrw: 20_000_000,
}
const BRACKETS = [ // 종합소득세 과세표준 구간(원)과 세율 — 지방세 10%는 아래에서 곱한다
  [14e6, 0.06], [50e6, 0.15], [88e6, 0.24], [150e6, 0.35], [300e6, 0.38], [500e6, 0.40], [1e9, 0.42], [Infinity, 0.45],
]
function progressive(krw) {
  let tax = 0, lo = 0
  for (const [hi, r] of BRACKETS) { if (krw <= lo) break; tax += (Math.min(krw, hi) - lo) * r; lo = hi }
  return tax * 1.1
}

/**
 * 세후 시뮬레이터. plan(i) → 그날 종가에 맞출 목표 비중 키(문자열)와 비중 배열.
 * 키가 바뀌거나 rebalance(i)가 참이면 목표 비중으로 맞춘다.
 * 반환: path(청산 전 평가액, 원화), final(청산 후 원화), taxes(누적 납부 원화)
 */
export function simTax(mkt, prod, { startIdx, endIdx, plan, rebalance = () => false, costBps = 5, tax = TAX, initialKrw = 1e8 }) {
  const fx = tax.fx
  const tc = costBps / 1e4
  const V = [0, 0, 0, 0], B = [0, 0, 0]
  let realized = 0, finInc = 0, taxes = 0, key = null
  const total = () => V[0] + V[1] + V[2] + V[3]
  const sellFrac = (k, f) => { // 보유 k의 비율 f 매도 → 현금
    const s = V[k] * f
    realized += s - B[k] * f - tc * s
    B[k] *= 1 - f; V[k] -= s; V[3] += s * (1 - tc)
  }
  const rebalanceTo = (w) => {
    const tot = total()
    const turn = w.reduce((s, x, k) => s + Math.abs(x - V[k] / tot), 0)
    const post = tot * (1 - tc * turn)
    for (let k = 0; k < 3; k++) {
      const goal = w[k] * post
      if (V[k] > goal) { const f = (V[k] - goal) / V[k]; realized += V[k] * f - B[k] * f; B[k] *= 1 - f }
      else B[k] += goal - V[k]
      V[k] = goal
    }
    realized -= tot - post // 수수료는 필요경비
    V[3] = w[3] * post
  }
  const payYearTax = (liquidate) => {
    if (liquidate) for (let k = 0; k < 3; k++) if (V[k] > 0) sellFrac(k, 1)
    if (!tax.enabled) { realized = 0; finInc = 0; return }
    let due = Math.max(0, realized * fx - tax.deductionKrw) * tax.cgRate / fx
    const finKrw = finInc * fx
    if (finKrw > tax.finThresholdKrw) {
      const ex = finKrw - tax.finThresholdKrw
      due += Math.max(0, progressive(ex) - ex * tax.intWh) / fx
    }
    realized = 0; finInc = 0
    if (due <= 0) return
    taxes += due * fx
    if (V[3] < due) { // 현금 부족분은 보유 비율대로 매도(그 매도 손익은 다음 해로)
      const need = (due - V[3]) / (1 - tc)
      const risky = V[0] + V[1] + V[2]
      const f = Math.min(1, need / risky)
      for (let k = 0; k < 3; k++) if (V[k] > 0) sellFrac(k, f)
    }
    V[3] -= due
  }

  // 시작: 원화 → 달러, 첫 목표 비중으로 매수(매수 수수료 포함)
  V[3] = initialKrw / fx
  const p0 = plan(startIdx)
  key = p0.key
  rebalanceTo(p0.w)
  const path = new Float64Array(endIdx - startIdx + 1)
  path[0] = total() * fx
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const d = mkt.dates[i]
    // 수익 반영
    const dist = d >= mkt.etfStart ? (mkt.divYield.get(d) ?? 0) * V[0] : 0
    V[0] *= prod.full[0][i]
    if (tax.enabled && dist > 0) { V[0] -= dist * tax.divWh; B[0] += dist * (1 - tax.divWh) } else B[0] += dist
    finInc += dist
    V[1] *= prod.full[1][i]; V[2] *= prod.full[2][i]
    const interest = V[3] * (prod.full[3][i] - 1)
    V[3] += interest * (1 - (tax.enabled ? tax.intWh : 0))
    finInc += interest
    // 매매
    const p = plan(i)
    if (p.key !== key || rebalance(i)) { rebalanceTo(p.w); key = p.key }
    // 연말 세금 · 마지막 날 청산
    const yearEnd = i === endIdx || d.slice(0, 4) !== mkt.dates[i + 1].slice(0, 4)
    if (yearEnd) payYearTax(i === endIdx)
    path[i - startIdx] = total() * fx
  }
  return { path, final: total() * fx, taxes }
}

// ── 전략 정의 ──
export function tripodPlan(sig) {
  return (i) => { const t = sig.target[i - 1] ?? 'CASH'; return { key: t, w: TARGETS[t] } } // 다음 날 종가 체결
}
export const mixPlan = (n) => () => ({ key: `QQQ${n}`, w: [n, 0, 0, 1 - n] })
export const holdPlan = (k) => () => ({ key: `H${k}`, w: [0, 1, 2, 3].map((j) => (j === k ? 1 : 0)) })
export const yearlyRebal = (mkt) => (i) => mkt.dates[i].slice(0, 4) !== mkt.dates[i - 1].slice(0, 4)

function main() {
  const mkt = loadMarket({ end: '2026-08-28' })
  const prod = buildProducts(mkt, COST_DEFAULT)
  const sig = computeSignals(mkt, RULE_DEFAULT)
  const a = idxOf(mkt, '1991-01-02'), b = mkt.dates.length - 1
  const yrs = (Date.parse(mkt.dates[b]) - Date.parse(mkt.dates[a])) / 864e5 / 365.25
  const pct = (x) => (x * 100).toFixed(1)
  const run = (plan, opts = {}) => simTax(mkt, prod, { startIdx: a, endIdx: b, plan, ...opts })
  const summarize = (r) => ({ cagr: (r.final / 1e8) ** (1 / yrs) - 1, mdd: maxDD(r.path), ulcer: ulcer(r.path), final: r.final, taxes: r.taxes })

  // (0) 교차 확인: 세금을 끄면 run.mjs의 세전 결과(32.6%)와 같아야 한다
  const pre = summarize(run(tripodPlan(sig), { tax: { ...TAX, enabled: false } }))
  console.log(`세전 교차 확인: 트라이팟 ${pct(pre.cagr)}% / ${pct(pre.mdd)}% (run.mjs 32.6% / -61.4%)`)

  const STRATS = [
    ['트라이팟', tripodPlan(sig), {}],
    ['QQQ 100%', holdPlan(0), {}],
    ['QLD 100%', holdPlan(1), {}],
    ['TQQQ 100%', holdPlan(2), {}],
  ]
  for (let n = 9; n >= 5; n--) STRATS.push([`QQQ ${n * 10}% + 현금`, mixPlan(n / 10), { rebalance: yearlyRebal(mkt) }])

  // (1) 35년 전 구간, 1억 원 시작
  console.log(`\n── (1) 1991-01~2026-08, 1억 원 시작, 수수료 편도 5bp. 세전 → 세후(청산 후)`)
  console.log('전략               세전 CAGR  세후 CAGR   세후 MDD  울서   청산 후 금액      누적 세금')
  for (const [name, plan, opts] of STRATS) {
    const p = summarize(run(plan, { ...opts, tax: { ...TAX, enabled: false } }))
    const t = summarize(run(plan, opts))
    console.log(`${name.padEnd(16)} ${pct(p.cagr).padStart(7)}%  ${pct(t.cagr).padStart(7)}%  ${pct(t.mdd).padStart(8)}%  ${t.ulcer.toFixed(1).padStart(5)}  ${(t.final / 1e8).toExponential(3).padStart(11)}억  ${(t.taxes / 1e8).toExponential(2).padStart(9)}억`)
  }

  // (2) 위험을 맞춘 QQQ+현금: 세후 MDD가 트라이팟과 같아지는 n
  const tri = summarize(run(tripodPlan(sig)))
  const solve = (metric, targetVal) => {
    let lo = 0, hi = 1
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2
      const m = summarize(run(mixPlan(mid), { rebalance: yearlyRebal(mkt) }))[metric]
      if ((metric === 'mdd' ? -m : m) > (metric === 'mdd' ? -targetVal : targetVal)) hi = mid; else lo = mid
    }
    return (lo + hi) / 2
  }
  console.log('\n── (2) 위험을 맞춘 QQQ n% + 현금 (매년 첫 거래일 리밸런싱, 세후)')
  for (const metric of ['mdd', 'ulcer']) {
    const n = solve(metric, tri[metric])
    const m = summarize(run(mixPlan(n), { rebalance: yearlyRebal(mkt) }))
    console.log(`  ${metric === 'mdd' ? 'MDD' : '울서'} 일치 n=${pct(n)}%: 세후 CAGR ${pct(m.cagr)}%, MDD ${pct(m.mdd)}%, 울서 ${m.ulcer.toFixed(1)}   | 트라이팟 세후 ${pct(tri.cagr)}%, ${pct(tri.mdd)}%, ${tri.ulcer.toFixed(1)}`)
  }

  // (3) 10년 보유 창(월말 진입 307개) — 1억 원 새로 시작, 청산 후
  console.log('\n── (3) 10년 보유, 월말 진입 307개, 1억 원 → 청산 후 금액(억)  최악 / 25% / 중간 / 최고 · 연환산 중간 · 원금 손실')
  const me = monthEnds(mkt, a, b)
  const WIN = [
    ['트라이팟', tripodPlan(sig), {}],
    ['QQQ 100%', holdPlan(0), {}],
    ['QQQ 70% + 현금', mixPlan(0.7), { rebalance: yearlyRebal(mkt) }],
    ['QLD 100%', holdPlan(1), {}],
    ['TQQQ 100%', holdPlan(2), {}],
  ]
  const winRes = {}
  for (const [name, plan, opts] of WIN) {
    for (const taxOn of [false, true]) {
      const finals = []
      for (const e of me) {
        const x = exitAfter(mkt, e, 10, b)
        if (x < 0) break
        finals.push(simTax(mkt, prod, { startIdx: e, endIdx: x, plan, ...opts, tax: { ...TAX, enabled: taxOn } }).final / 1e8)
      }
      winRes[`${name}|${taxOn}`] = finals
      const s = finals.slice().sort((p, q) => p - q)
      const q = [s[0], quantile(s, 0.25), quantile(s, 0.5), s.at(-1)]
      console.log(`  ${(name + (taxOn ? ' 세후' : ' 세전')).padEnd(18)} ${q.map((v) => v.toFixed(2).padStart(7)).join('')}   중간 ${pct(q[2] ** 0.1 - 1)}%/년  손실 ${pct(finals.filter((v) => v < 1).length / finals.length)}%`)
    }
  }
  const t = winRes['트라이팟|true'], qq = winRes['QQQ 100%|true'], mx = winRes['QQQ 70% + 현금|true']
  console.log(`  세후 트라이팟이 QQQ 100%보다 많았던 창 ${pct(t.filter((v, j) => v > qq[j]).length / t.length)}%, QQQ 70%+현금보다 많았던 창 ${pct(t.filter((v, j) => v > mx[j]).length / t.length)}%`)

  // (4) 수수료 민감도(세후, 35년)
  console.log('\n── (4) 수수료 민감도 — 트라이팟 세후 CAGR / MDD')
  for (const bps of [5, 10, 25]) {
    const r = summarize(run(tripodPlan(sig), { costBps: bps }))
    console.log(`  편도 ${String(bps).padStart(2)}bp: ${pct(r.cagr)}% / ${pct(r.mdd)}%`)
  }

  // (5) 보수적 시나리오: 실전에서 성과를 깎을 수 있는 요인을 하나씩(세후, 35년 · 10년 창 중간값)
  console.log('\n── (5) 보수적 시나리오 — 세후 35년 CAGR / MDD · 10년 창 중간값(연환산)')
  const win10 = (plan, opts = {}) => {
    const out = []
    for (const e of me) { const x = exitAfter(mkt, e, 10, b); if (x < 0) break; out.push(simTax(mkt, prod, { startIdx: e, endIdx: x, plan, ...opts }).final / 1e8) }
    return quantile(out.sort((p, q) => p - q), 0.5) ** 0.1 - 1
  }
  const sameClose = (s) => (i) => { const t = s.target[i] ?? 'CASH'; return { key: t, w: TARGETS[t] } }
  const SC = [
    ['기본(다음 날 종가, 5bp)', tripodPlan(sig), {}],
    ['수수료 편도 25bp', tripodPlan(sig), { costBps: 25 }],
    ['당일 종가 체결', sameClose(sig), {}],
    ['VIX 상한 25', tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, vixUp: 25 })), {}],
    ['VIX 상한 31', tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, vixUp: 31 })), {}],
    ['낙폭 한도 8%', tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, ddLimit: -0.08 })), {}],
    ['낙폭 한도 7%(절벽 아래)', tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, ddLimit: -0.07 })), {}],
    ['당일 종가 + 25bp + VIX 25', sameClose(computeSignals(mkt, { ...RULE_DEFAULT, vixUp: 25 })), { costBps: 25 }],
    ['(참고) 250일선 국면만(밴드 포함): 상승 TQQQ, 하락 현금', tripodPlan(computeSignals(mkt, { ...RULE_DEFAULT, vixUp: 999, vixDown: -1, useDD: false })), {}],
    ['(비교) QQQ 100%', holdPlan(0), {}],
    ['(비교) QQQ 70% + 현금', mixPlan(0.7), { rebalance: yearlyRebal(mkt) }],
  ]
  for (const [name, plan, opts] of SC) {
    const r = summarize(run(plan, opts))
    console.log(`  ${name.padEnd(30)} ${pct(r.cagr).padStart(5)}% / ${pct(r.mdd).padStart(6)}%   10년 중간 ${pct(win10(plan, opts)).padStart(5)}%`)
  }

  // (6) 시작 시점이 나쁜 경우: 닷컴 고점 직전(2000-01) 시작, 세후
  console.log('\n── (6) 2000-01-03 시작 ~ 2026-08, 1억 원, 세후 CAGR / MDD')
  const a2 = idxOf(mkt, '2000-01-03'), y2 = (Date.parse(mkt.dates[b]) - Date.parse(mkt.dates[a2])) / 864e5 / 365.25
  for (const [name, plan, opts] of [['트라이팟', tripodPlan(sig), {}], ['QQQ 100%', holdPlan(0), {}], ['QQQ 70% + 현금', mixPlan(0.7), { rebalance: yearlyRebal(mkt) }], ['TQQQ 100%', holdPlan(2), {}]]) {
    const r = simTax(mkt, prod, { startIdx: a2, endIdx: b, plan, ...opts })
    console.log(`  ${name.padEnd(16)} ${pct((r.final / 1e8) ** (1 / y2) - 1).padStart(5)}% / ${pct(maxDD(r.path)).padStart(6)}%`)
  }

  // (7) S&P500에 같은 규칙(표본 외), 세후. 1993 이전 배당 연 3%, SPY 보수 0.09%
  console.log('\n── (7) S&P500 같은 규칙, 1991~2026 세후 CAGR / MDD')
  const spx = loadMarket({ base: 'GSPC', end: '2026-08-28' })
  const spxProd = buildProducts(spx, { ...COST_DEFAULT, preDivYield: 3.0, etfFee: 0.09 })
  const spxSig = computeSignals(spx, RULE_DEFAULT)
  const sa = idxOf(spx, '1991-01-02'), sb = spx.dates.length - 1
  const sy = (Date.parse(spx.dates[sb]) - Date.parse(spx.dates[sa])) / 864e5 / 365.25
  const spxRun = (plan, opts = {}) => { const r = simTax(spx, spxProd, { startIdx: sa, endIdx: sb, plan, ...opts }); return { cagr: (r.final / 1e8) ** (1 / sy) - 1, mdd: maxDD(r.path) } }
  const st = spxRun(tripodPlan(spxSig))
  console.log(`  트라이팟(S&P)    ${pct(st.cagr)}% / ${pct(st.mdd)}%`)
  for (const [name, plan, opts] of [['SPY 100%', holdPlan(0), {}], ['SSO 100%', holdPlan(1), {}], ['UPRO 100%', holdPlan(2), {}]]) {
    const r = spxRun(plan, opts)
    console.log(`  ${name.padEnd(15)} ${pct(r.cagr)}% / ${pct(r.mdd)}%`)
  }
  let lo = 0, hi = 1
  for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (-spxRun(mixPlan(mid), { rebalance: yearlyRebal(spx) }).mdd > -st.mdd) hi = mid; else lo = mid }
  if (lo > 0.999) console.log('  SPY n% + 현금: 트라이팟 MDD가 SPY 100%보다 깊어 MDD를 맞출 n이 없음')
  else { const sm = spxRun(mixPlan(lo), { rebalance: yearlyRebal(spx) }); console.log(`  SPY ${pct(lo)}% + 현금(MDD 일치) ${pct(sm.cagr)}% / ${pct(sm.mdd)}%`) }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
