// 7단계: 비판적 점검 (영상 범위 밖) — 과적합·데이터 스누핑·표본 선택·꼬리 위험·더 단순한 대안
// 사용: node scripts/tripod/critique.mjs > docs/research/tripod/critique-output.txt
//
// 모든 실행은 동결한 비용 모델, 다음 날 종가 체결, 편도 5bp를 쓴다(재현 기본 조합과 같음).
// A 기여 분해  B 워크포워드·CSCV 과적합 확률  C 데이터 스누핑(White Reality Check)
// D 다른 시장  E 연도 집중도  F 꼬리 위험  G 공개 규칙의 발표 후 성과  H 변동성 목표  I 영상 이후
import {
  loadMarket, buildProducts, holdCurve, computeSignals, simulate, COST_DEFAULT, RULE_DEFAULT,
  maxDD, ulcer, years, idxOf, sma, drawdown52, readBars,
} from './lib.mjs'
import { simTax, TAX } from './aftertax.mjs'

const START = '1991-01-02', END = '2026-08-28'
const pct = (x, d = 1) => (x * 100).toFixed(d)
const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${pct(x, d)}`
const log = console.log
const lastIdx = (m, to) => { const j = m.dates.findIndex((d) => d > to); return j < 0 ? m.dates.length - 1 : j - 1 }
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

const mkt = loadMarket({ end: END })
const prod = buildProducts(mkt, COST_DEFAULT)
const A = idxOf(mkt, START), B = mkt.dates.length - 1
const sigOf = (m, rule) => computeSignals(m, { ...RULE_DEFAULT, ...rule })
const run = (m, p, sig, a, b) => simulate(m, p, sig, { startIdx: a, endIdx: b, exec: 'close1', costBps: 5 })
const ONE = (k) => [0, 1, 2, 3].map((j) => (j === k ? 1 : 0))
const lrOf = (v) => { const o = new Float64Array(v.length - 1); for (let j = 1; j < v.length; j++) o[j - 1] = Math.log(v[j] / v[j - 1]); return o }

/** 이동평균 단독 신호(밴드 없음, 같으면 직전 유지). VIX가 필요 없어 1990년 이전에도 쓸 수 있다 */
function maSignal(m, w) {
  const ma = sma(m.close, w)
  const target = new Array(m.dates.length).fill(null)
  let t = 'CASH'
  for (let i = 0; i < m.dates.length; i++) {
    if (Number.isNaN(ma[i])) continue
    if (m.close[i] > ma[i]) t = 'T3'; else if (m.close[i] < ma[i]) t = 'CASH'
    target[i] = t
  }
  return { target }
}
/** 신호 → 세후 시뮬레이터 계획. T3 자리에 넣을 상품 k(0 QQQ, 1 QLD, 2 TQQQ) */
const sigPlan = (sig, k = 2) => (i) => {
  const t = sig.target[i - 1] ?? 'CASH'
  return { key: t, w: t === 'T3' ? ONE(k) : t === 'B15' ? [0.5, 0.5, 0, 0] : ONE(3) }
}
/** 샤프: 일간 단순수익 − 무위험(^IRX) 의 산술평균×252 / (표준편차×√252) */
function sharpe(v, p, a) {
  let s = 0, q = 0
  const n = v.length - 1
  for (let j = 1; j <= n; j++) { const x = v[j] / v[j - 1] - p.full[3][a + j]; s += x; q += x * x }
  const mu = s / n
  return (mu * 252) / (Math.sqrt(q / n - mu * mu) * Math.sqrt(252))
}
function evalPlan(m, p, plan, a, b, opts = {}) {
  const yrs = years(m, a, b)
  const pre = simTax(m, p, { startIdx: a, endIdx: b, plan, ...opts, tax: { ...TAX, enabled: false } })
  const post = simTax(m, p, { startIdx: a, endIdx: b, plan, ...opts })
  let sw = 0
  for (let i = a + 1; i <= b; i++) if (plan(i).key !== plan(i - 1).key) sw++
  return { cagr: (pre.final / 1e8) ** (1 / yrs) - 1, mdd: maxDD(pre.path), ulcer: ulcer(pre.path), sharpe: sharpe(pre.path, p, a), at: (post.final / 1e8) ** (1 / yrs) - 1, tpy: sw / yrs }
}
const cm = (r) => `${pct(r.cagr).padStart(5)} / ${pct(r.mdd).padStart(6)}`

// ── A. 기여 분해 ──────────────────────────────────────────────────────────
log('── A. 기여 분해: 단순한 규칙에서 한 층씩 더한다 (CAGR / MDD %, 세후는 한국 양도세 모델)')
const ABL = [
  ['QQQ 보유', () => ({ key: 'H', w: ONE(0) })],
  ['250일선 → QQQ / 현금', sigPlan(maSignal(mkt, 250), 0)],
  ['250일선 → QLD / 현금', sigPlan(maSignal(mkt, 250), 1)],
  ['250일선 → TQQQ / 현금', sigPlan(maSignal(mkt, 250), 2)],
  ['200일선 → TQQQ / 현금', sigPlan(maSignal(mkt, 200), 2)],
  ['밴드(+1%/-5%) → TQQQ / 현금', sigPlan(sigOf(mkt, { vixUp: 1e9, vixDown: 0, useDD: false }))],
  ['+ 상승 국면 VIX 28', sigPlan(sigOf(mkt, { vixDown: 0, useDD: false }))],
  ['+ 하락 국면 VIX 18', sigPlan(sigOf(mkt, { useDD: false }))],
  ['+ 낙폭 9% = 트라이팟', sigPlan(sigOf(mkt, {}))],
  ['트라이팟 − 하락 국면 VIX', sigPlan(sigOf(mkt, { vixDown: 0 }))],
  ['밴드 250일선 → QLD / 현금', sigPlan(sigOf(mkt, { vixUp: 1e9, vixDown: 0, useDD: false }), 1)],
  ['트라이팟, TQQQ 자리에 QLD', sigPlan(sigOf(mkt, {}), 1)],
]
const SUB = [['1991-01-02', '2008-12-31'], ['2009-01-02', END]]
const HEAD = '1991~2026 세전     울서  샤프  연매매  세후CAGR | 1991~2008      2009~2026'
const row = (name, r, s) => `${name.padEnd(26)} ${cm(r)}  ${r.ulcer.toFixed(1).padStart(5)}  ${r.sharpe.toFixed(2)}  ${r.tpy.toFixed(1).padStart(5)}  ${pct(r.at).padStart(6)}  | ${cm(s[0])}  ${cm(s[1])}`
log(`규칙                          ${HEAD}`)
for (const [name, plan] of ABL) {
  const r = evalPlan(mkt, prod, plan, A, B)
  const s = SUB.map(([f, t]) => evalPlan(mkt, prod, plan, idxOf(mkt, f), lastIdx(mkt, t)))
  log(row(name, r, s))
}

// ── B. 워크포워드 · CSCV ──────────────────────────────────────────────────
const GRID = []
for (const maWin of [150, 200, 250, 300]) for (const vixUp of [22, 25, 28, 31, 35, 1e9]) for (const vixDown of [14, 18, 22, 1e9]) {
  for (const dd of [-0.05, -0.07, -0.09, -0.11, -0.13, null]) GRID.push({ maWin, vixUp, vixDown, ddLimit: dd ?? -1, useDD: dd !== null })
}
const lab = (r) => `${r.maWin}일·VIX ${r.vixUp > 99 ? '없음' : r.vixUp}/${r.vixDown > 99 ? '없음' : r.vixDown}·낙폭 ${r.useDD ? `${Math.round(-r.ddLimit * 100)}%` : '없음'}`
const VID = GRID.findIndex((r) => r.maWin === 250 && r.vixUp === 28 && r.vixDown === 18 && r.ddLimit === -0.09)
const N = B - A // 일간 수익 개수. t번째 수익 = 날짜 A+1+t의 (A+t 종가 → A+1+t 종가)
const LR = GRID.map((r) => lrOf(run(mkt, prod, sigOf(mkt, r), A, B).v))
const QQQ_LR = lrOf(holdCurve(mkt, prod, 0, A, B))
const MA250_LR = lrOf(run(mkt, prod, maSignal(mkt, 250), A, B).v)
const MA200_LR = lrOf(run(mkt, prod, maSignal(mkt, 200), A, B).v)
const BAND_LR = lrOf(run(mkt, prod, sigOf(mkt, { vixUp: 1e9, vixDown: 0, useDD: false }), A, B).v)
const segYears = (t0, t1) => (Date.parse(mkt.dates[A + t1]) - Date.parse(mkt.dates[A + t0])) / 864e5 / 365.25
function seg(lr, t0, t1) {
  let s = 0, pk = 0, mdd = 0
  for (let t = t0; t < t1; t++) { s += lr[t]; if (s > pk) pk = s; const d = Math.exp(s - pk) - 1; if (d < mdd) mdd = d }
  const cagr = Math.exp(s / segYears(t0, t1)) - 1
  return { cagr, mdd, mar: cagr / Math.max(1e-9, -mdd) }
}
const rankDesc = (vals, k) => 1 + vals.filter((x) => x > vals[k]).length
function spearman(x, y) {
  const rk = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); o.forEach(([, i], j) => { r[i] = j }); return r }
  const rx = rk(x), ry = rk(y), n = x.length, mx = (n - 1) / 2
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2 }
  return sxy / sxx
}

log(`\n── B. 워크포워드 (그리드 ${GRID.length}개: 이동평균 4 × VIX 상한 6 × VIX 하한 4 × 낙폭 한도 6, 밴드·VIX 기간은 영상 값 고정)`)
const full = LR.map((lr) => seg(lr, 0, N))
log(`전 기간(1991~2026) 영상 조합 ${lab(GRID[VID])}: CAGR ${rankDesc(full.map((x) => x.cagr), VID)}위, CAGR/MDD ${rankDesc(full.map((x) => x.mar), VID)}위 / ${GRID.length}`)
const fc = full.map((x) => x.cagr).sort((p, q) => p - q)
log(`  그리드 CAGR 분포: 최저 ${pct(fc[0])} · 10% ${pct(fc[Math.floor(0.1 * fc.length)])} · 중간 ${pct(fc[fc.length >> 1])} · 90% ${pct(fc[Math.floor(0.9 * fc.length)])} · 최고 ${pct(fc.at(-1))}`)
const FOLD = ['2000-01-03', '2005-01-03', '2010-01-04', '2015-01-02', '2020-01-02'].map((d) => idxOf(mkt, d) - A - 1)
FOLD.push(N)
const POOLS = [
  ['그리드 전체', GRID.map((_, k) => k)],
  ['구조 고정(하락 국면 VIX 하한과 낙폭 한도는 반드시 둠, 값만 고름)', GRID.map((r, k) => (r.vixDown < 99 && r.useDD ? k : -1)).filter((k) => k >= 0)],
]
for (const [pname, pool] of POOLS) for (const obj of ['cagr', 'mar']) {
  log(`\n[${pname} ${pool.length}개 · 선택 기준: 직전까지 전 구간의 ${obj === 'cagr' ? 'CAGR' : 'CAGR/MDD'} 최대] 확장 창(1991~직전) 학습 → 다음 5년 적용`)
  log('검증 구간        고른 조합                         영상 조합 학습순위 | 검증 CAGR: 고른 조합 / 영상 조합 / 250일선 3배 / QQQ | 고른 조합 검증 백분위 · 학습-검증 순위상관')
  const chain = []
  for (let f = 0; f < 5; f++) {
    const t0 = FOLD[f], t1 = FOLD[f + 1]
    const is = LR.map((lr) => seg(lr, 0, t0)), os = LR.map((lr) => seg(lr, t0, t1))
    const isv = is.map((x, k) => (pool.includes(k) ? x[obj] : -Infinity))
    const best = isv.indexOf(Math.max(...isv))
    for (let t = t0; t < t1; t++) chain.push(LR[best][t])
    const osC = os.map((x) => x.cagr)
    const pctile = pool.filter((k) => osC[k] < osC[best]).length / (pool.length - 1)
    const rho = spearman(pool.map((k) => is[k].cagr), pool.map((k) => osC[k]))
    log(`${mkt.dates[A + t0 + 1].slice(0, 4)}~${mkt.dates[A + t1].slice(0, 4)}  ${lab(GRID[best]).padEnd(30)}  ${String(rankDesc(isv, VID)).padStart(4)}위       | ${pct(osC[best]).padStart(6)} / ${pct(osC[VID]).padStart(6)} / ${pct(seg(MA250_LR, t0, t1).cagr).padStart(6)} / ${pct(seg(QQQ_LR, t0, t1).cagr).padStart(5)} | ${pct(pctile, 0).padStart(3)}% · ${rho.toFixed(2)}`)
  }
  const ch = new Float64Array(chain)
  const r = (lr) => seg(lr, FOLD[0], N)
  const wf = seg(ch, 0, ch.length)
  log(`  2000~2026 이어 붙인 검증 성과: 워크포워드 ${cm(wf)} · 영상 조합 ${cm(r(LR[VID]))} · 250일선 3배 ${cm(r(MA250_LR))} · 200일선 3배 ${cm(r(MA200_LR))} · QQQ ${cm(r(QQQ_LR))}`)
}
{
  const oc = LR.map((lr) => seg(lr, FOLD[0], N).cagr).sort((p, q) => p - q)
  log(`  (참고) 2000~2026 고정 조합 ${GRID.length}개 CAGR: 10% ${pct(oc[Math.floor(0.1 * oc.length)])} · 중간 ${pct(oc[oc.length >> 1])} · 90% ${pct(oc[Math.floor(0.9 * oc.length)])}`)
}

// CSCV 과적합 확률(Bailey·Borwein·López de Prado·Zhu 2017): 16블록 중 8블록으로 고르고 나머지 8블록에서 순위 확인
{
  const S = 16, K = GRID.length
  const bnd = Array.from({ length: S + 1 }, (_, s) => Math.floor((s * N) / S))
  // sum·sq: 일간 로그수익(평균 기준용), xs·xq: 일간 단순 초과수익(샤프용)
  const blk = (lr) => {
    const sum = new Float64Array(S), sq = new Float64Array(S), xs = new Float64Array(S), xq = new Float64Array(S)
    for (let s = 0; s < S; s++) for (let t = bnd[s]; t < bnd[s + 1]; t++) {
      const x = Math.exp(lr[t]) - prod.full[3][A + 1 + t]
      sum[s] += lr[t]; sq[s] += lr[t] * lr[t]; xs[s] += x; xq[s] += x * x
    }
    return { sum, sq, xs, xq }
  }
  const BL = LR.map(blk), BQ = blk(QQQ_LR), BM = blk(MA250_LR)
  const len = Array.from({ length: S }, (_, s) => bnd[s + 1] - bnd[s])
  const metric = (b, mask, kind) => {
    let s = 0, q = 0, n = 0
    for (let j = 0; j < S; j++) if (mask & (1 << j)) { s += kind === 'mean' ? b.sum[j] : b.xs[j]; q += kind === 'mean' ? b.sq[j] : b.xq[j]; n += len[j] }
    const mu = s / n
    return kind === 'mean' ? mu : mu / Math.sqrt(q / n - mu * mu)
  }
  log('\n[CSCV] 1991~2026을 16블록으로 나눠 8블록에서 최고 조합을 고르고 나머지 8블록에서 확인(12,870가지 분할)')
  for (const kind of ['mean', 'sharpe']) {
    let splits = 0, below = 0, beatQ = 0, beatM = 0
    const pcts = []
    for (let mask = 0; mask < 1 << S; mask++) {
      let c = 0; for (let j = 0; j < S; j++) if (mask & (1 << j)) c++
      if (c !== S / 2) continue
      const inv = ((1 << S) - 1) ^ mask
      let best = 0, bv = -Infinity
      for (let k = 0; k < K; k++) { const v = metric(BL[k], mask, kind); if (v > bv) { bv = v; best = k } }
      const os = BL.map((b) => metric(b, inv, kind))
      const w = (os.filter((x) => x < os[best]).length + 1) / (K + 1)
      pcts.push(w)
      if (w <= 0.5) below++
      if (os[best] > metric(BQ, inv, kind)) beatQ++
      if (os[best] > metric(BM, inv, kind)) beatM++
      splits++
    }
    pcts.sort((p, q) => p - q)
    log(`  기준 ${kind === 'mean' ? '평균 로그수익(≈CAGR)' : '샤프'}: 과적합 확률(검증 순위가 중간 아래) ${pct(below / splits)}% · 고른 조합의 검증 백분위 중간 ${pct(pcts[pcts.length >> 1], 0)}% · 검증에서 QQQ보다 나은 비율 ${pct(beatQ / splits)}% · 250일선 3배보다 나은 비율 ${pct(beatM / splits)}%`)
  }
}

// ── C. 데이터 스누핑: White Reality Check ─────────────────────────────────
log(`\n── C. 데이터 스누핑 보정 (White 2000 Reality Check, 정상 블록 부트스트랩 1,000회)`)
log('   귀무가설: 그리드의 어떤 조합도 비교 대상보다 기대 로그수익이 높지 않다. 단일 p는 영상 조합 하나만 봤을 때, 보정 p는 576개 중 최고를 고른 효과를 반영')
function realityCheck(benchLr, L, draws = 1000, seed = 7) {
  const K = GRID.length
  const pre = (lr) => { const p = new Float64Array(N + 1); for (let t = 0; t < N; t++) p[t + 1] = p[t] + lr[t] - benchLr[t]; return p }
  const P = LR.map(pre)
  const PB = new Float64Array(N + 1)
  for (let t = 0; t < N; t++) PB[t + 1] = PB[t] + benchLr[t]
  const mean = P.map((p) => p[N] / N)
  const vObs = Math.sqrt(N) * Math.max(...mean)
  const rnd = rng(seed)
  const acc = new Float64Array(K)
  let cMax = 0, cVid = 0
  const diffs = []
  const yrs = segYears(0, N)
  for (let d = 0; d < draws; d++) {
    acc.fill(0)
    let filled = 0, accB = 0
    while (filled < N) {
      const s = Math.floor(rnd() * N)
      const len = Math.min(N - filled, Math.max(1, Math.ceil(Math.log(1 - rnd()) / Math.log(1 - 1 / L))))
      const e = s + len
      for (let k = 0; k < K; k++) { const p = P[k]; acc[k] += e <= N ? p[e] - p[s] : p[N] - p[s] + p[e - N] }
      accB += e <= N ? PB[e] - PB[s] : PB[N] - PB[s] + PB[e - N]
      filled += len
    }
    let vMax = -Infinity
    for (let k = 0; k < K; k++) { const z = Math.sqrt(N) * (acc[k] / N - mean[k]); if (z > vMax) vMax = z }
    if (vMax >= vObs) cMax++
    if (Math.sqrt(N) * (acc[VID] / N - mean[VID]) >= Math.sqrt(N) * mean[VID]) cVid++
    // 재표본 경로에서 영상 조합과 비교 대상의 CAGR 차이(%p)
    diffs.push(Math.exp((acc[VID] + accB) / yrs) - Math.exp(accB / yrs))
  }
  diffs.sort((p, q) => p - q)
  return { pSingle: cVid / draws, pAdj: cMax / draws, ci: [diffs[Math.floor(0.05 * draws)], diffs[Math.floor(0.5 * draws)], diffs[Math.floor(0.95 * draws)]], best: mean.indexOf(Math.max(...mean)) }
}
for (const [bname, blr] of [['QQQ 보유', QQQ_LR], ['250일선 → TQQQ / 현금', MA250_LR], ['밴드 250일선 → TQQQ / 현금', BAND_LR]]) {
  for (const L of [63, 250]) {
    const r = realityCheck(blr, L)
    log(`  비교 대상 ${bname.padEnd(22)} 평균 블록 ${String(L).padStart(3)}일: 영상 조합 단일 p ${r.pSingle.toFixed(3)} · 그리드 최고(${lab(GRID[r.best])}) 보정 p ${r.pAdj.toFixed(3)} · 영상 조합 CAGR 차이 90% 구간 ${sgn(r.ci[0])}~${sgn(r.ci[2])}%p (중간 ${sgn(r.ci[1])})`)
  }
}

// ── D. 다른 시장 ──────────────────────────────────────────────────────────
log('\n── D. 다른 시장에 같은 규칙 (파라미터 그대로, 가상 1·2·3배 상품, 금리는 미국 ^IRX, 미국 밖 지수는 전 거래일 VIX)')
log('   배당: S&P500은 SPY 분배금(1993 이전 연 3%), DAX는 총수익지수, 나머지는 가격지수(배당 제외 → 보유 쪽이 불리)')
const MK = [
  ['GSPC', 'S&P500', { preDivYield: 3.0, etfFee: 0.09 }],
  ['IXIC', '나스닥 종합', {}],
  ['RUT', '러셀2000', {}],
  ['GDAXI', 'DAX', {}],
  ['FTSE', 'FTSE100', {}],
  ['N225', '닛케이225', {}],
  ['HSI', '항셍', {}],
  ['KS11', '코스피', {}],
]
log('시장         기간          트라이팟         1배 보유         3배 보유        250일선 3배     연매매 | 트라이팟−1배 CAGR: 기본 · 금리 0 · 배당 2.5% | 트라이팟 MDD 금리 0')
for (const [base, name, opt] of MK) {
  const m = loadMarket({ base, end: END })
  const m0 = { ...m, irx: m.irx.map(() => 0) } // 현지 금리를 모르므로 금리 0 가정도 함께 본다
  const p = buildProducts(m, { ...COST_DEFAULT, ...opt })
  const sig = sigOf(m, {})
  const a = Math.max(idxOf(m, START), sig.target.findIndex((t) => t !== null) + 1)
  const b = m.dates.length - 1, yrs = years(m, a, b)
  const tri = run(m, p, sig, a, b)
  const res = (v) => ({ cagr: (v[v.length - 1] / v[0]) ** (1 / yrs) - 1, mdd: maxDD(v) })
  const h1 = res(holdCurve(m, p, 0, a, b)), h3 = res(holdCurve(m, p, 2, a, b))
  const ma = res(run(m, p, maSignal(m, 250), a, b).v), t = res(tri.v)
  const diff = (mm, pp) => { const x = res(run(mm, pp, sig, a, b).v); return { d: x.cagr - res(holdCurve(mm, pp, 0, a, b)).cagr, mdd: x.mdd } }
  const z = diff(m0, buildProducts(m0, { ...COST_DEFAULT, ...opt }))
  const dv = !opt.preDivYield && base !== 'GDAXI' ? sgn(diff(m, buildProducts(m, { ...COST_DEFAULT, preDivYield: 2.5 })).d) : '   —'
  log(`${name.padEnd(10)} ${m.dates[a].slice(0, 7)}~${m.dates[b].slice(0, 7)}  ${cm(t)}  ${cm(h1)}  ${cm(h3)}  ${cm(ma)}  ${(tri.trades.length / yrs).toFixed(1).padStart(5)} | ${sgn(t.cagr - h1.cagr).padStart(6)} · ${sgn(z.d).padStart(6)} · ${dv.padStart(6)} | ${pct(z.mdd)}`)
}
{
  // 1990년 이전: VIX가 없어 트라이팟은 못 돌리고, 이동평균 규칙만 나스닥 종합 1972~1990에 적용
  const m = loadMarket({ base: 'IXIC', end: '1990-12-31', irxName: 'IRX-1971' })
  const p = buildProducts(m, COST_DEFAULT)
  const a = idxOf(m, '1972-03-01'), b = m.dates.length - 1
  const e = (plan) => evalPlan(m, p, plan, a, b)
  const sig = maSignal(m, 250)
  log(`(VIX 이전) 나스닥 종합 ${m.dates[a].slice(0, 7)}~1990-12, 250일선 규칙만: 3배 ${cm(e(sigPlan(sig, 2)))} · 2배 ${cm(e(sigPlan(sig, 1)))} · 1배 보유 ${cm(e(() => ({ key: 'H', w: ONE(0) })))} · 3배 보유 ${cm(e(() => ({ key: 'H', w: ONE(2) })))}`)
}

// ── E. 연도 집중도 ────────────────────────────────────────────────────────
log('\n── E. 연도별 초과수익 집중도 (트라이팟 − QQQ 보유, 로그 기준)')
{
  const vt = run(mkt, prod, sigOf(mkt, {}), A, B).v, vq = holdCurve(mkt, prod, 0, A, B), vm = run(mkt, prod, maSignal(mkt, 250), A, B).v
  const ends = []
  for (let i = A; i <= B; i++) if (i === B || mkt.dates[i].slice(0, 4) !== mkt.dates[i + 1].slice(0, 4)) ends.push(i)
  const rows = []
  let prev = A
  for (const e of ends) {
    const r = (v) => v[e - A] / v[prev - A]
    rows.push({ y: mkt.dates[e].slice(0, 4), t: r(vt) - 1, q: r(vq) - 1, m: r(vm) - 1, x: Math.log(r(vt) / r(vq)), xm: Math.log(r(vt) / r(vm)) })
    prev = e
  }
  const tot = rows.reduce((s, r) => s + r.x, 0), yrs = years(mkt, A, B)
  const sorted = rows.slice().sort((p, q) => q.x - p.x)
  log(`  연도별(트라이팟 / QQQ / 250일선 3배, %): ${rows.map((r) => `${r.y} ${pct(r.t, 0)}/${pct(r.q, 0)}/${pct(r.m, 0)}`).join(' · ')}`)
  log(`  트라이팟이 QQQ를 이긴 해 ${rows.filter((r) => r.x > 0).length}/${rows.length}, 250일선 3배를 이긴 해 ${rows.filter((r) => r.xm > 0).length}/${rows.length}`)
  log(`  초과 상위 5개 해: ${sorted.slice(0, 5).map((r) => `${r.y}(${sgn(Math.exp(r.x) - 1, 0)}%)`).join(' ')} · 하위 5개 해: ${sorted.slice(-5).map((r) => `${r.y}(${sgn(Math.exp(r.x) - 1, 0)}%)`).join(' ')}`)
  for (const drop of [0, 1, 3, 5]) {
    const rest = tot - sorted.slice(0, drop).reduce((s, r) => s + r.x, 0)
    log(`  상위 ${drop}개 해를 뺀 연평균 초과(로그 → 배수): ${sgn(Math.exp(rest / (yrs - drop)) - 1)}%/년`)
  }
}

// ── F. 꼬리 위험 ─────────────────────────────────────────────────────────
log('\n── F. 꼬리 위험')
{
  const sig = sigOf(mkt, {})
  const v = run(mkt, prod, sig, A, B).v
  const days = []
  for (let i = A + 1; i <= B; i++) days.push({ i, r: v[i - A] / v[i - A - 1] - 1, held: sig.target[i - 2] ?? 'CASH', ndx: mkt.close[i] / mkt.close[i - 1] - 1 })
  days.sort((p, q) => p.r - q.r)
  log(`  트라이팟 최악의 하루 8개: ${days.slice(0, 8).map((d) => `${mkt.dates[d.i]} ${pct(d.r)}%(${d.held}, NDX ${pct(d.ndx)}%)`).join(' · ')}`)
  const big = days.filter((d) => d.ndx <= -0.05)
  const t3 = big.filter((d) => d.held === 'T3')
  log(`  나스닥100 -5% 이하인 날 ${big.length}일 중 TQQQ 보유 ${t3.length}일, 1.5배 ${big.filter((d) => d.held === 'B15').length}일, 현금 ${big.filter((d) => d.held === 'CASH').length}일. TQQQ 보유일: ${t3.map((d) => `${mkt.dates[d.i]} ${pct(d.r)}%`).join(' · ') || '없음'}`)
  const inT3 = days.filter((d) => d.held === 'T3')
  log(`  TQQQ 보유 중 나스닥100 최악의 하루 ${pct(Math.min(...inT3.map((d) => d.ndx)))}% · TQQQ 보유 비중 ${pct(inT3.length / days.length)}% (그 날들의 VIX10 상한 28 아래, 낙폭 9% 이내)`)
  // 1987-10-19: VIX가 없어 VIX 조건은 빼고 국면·낙폭만 본다
  const m = loadMarket({ base: 'NDX', end: '1987-12-31' })
  const ma = sma(m.close, 250), dd = drawdown52(m, 'c252')
  let reg = null
  for (let i = 0; i < m.dates.length; i++) {
    if (Number.isNaN(ma[i])) continue
    if (m.close[i] > 1.01 * ma[i]) reg = 'UP'; else if (m.close[i] < 0.95 * ma[i]) reg = 'DOWN'
    if (['1987-08-26', '1987-10-02', '1987-10-14', '1987-10-15', '1987-10-16'].includes(m.dates[i])) {
      const pos = reg === 'UP' ? (dd[i] >= -0.09 ? 'VIX10<28이면 TQQQ, 아니면 1.5배' : '1.5배(낙폭 조건)') : 'VIX10<18이면 1.5배, 아니면 현금'
      log(`  ${m.dates[i]} NDX ${m.close[i].toFixed(1)} · 250일선 대비 ${sgn(m.close[i] / ma[i] - 1)}% · 52주 고점 대비 ${pct(dd[i])}% · 국면 ${reg} → ${pos}`)
    }
  }
  const i19 = m.dates.indexOf('1987-10-19'), i20 = i19 + 1
  const r19 = m.close[i19] / m.close[i19 - 1] - 1, r20 = m.close[i20] / m.close[i20 - 1] - 1
  log(`  1987-10-19 NDX ${pct(r19)}%, 10-20 ${pct(r20)}% → 3배 상품이었다면 ${pct((1 + 3 * r19) * (1 + 3 * r20) - 1)}%, 1.5배 ${pct((1 + 1.5 * r19) * (1 + 1.5 * r20) - 1)}%`)
}

// ── G. 공개 규칙의 발표 후 성과 ──────────────────────────────────────────
log('\n── G. 미리 공개된 단순 규칙의 발표 전·후 성과 (발표 후 구간은 진짜 표본 외)')
function faberSignal(m) { // 월말 종가가 최근 10개 월말 종가 평균 위면 보유, 다음 월말까지 유지(Faber 2007)
  const target = new Array(m.dates.length).fill(null)
  const me = []
  let t = null
  for (let i = 0; i < m.dates.length; i++) {
    const last = i === m.dates.length - 1 || m.dates[i].slice(0, 7) !== m.dates[i + 1].slice(0, 7)
    if (last) {
      me.push(m.close[i])
      if (me.length >= 10) { const avg = me.slice(-10).reduce((s, x) => s + x, 0) / 10; t = m.close[i] > avg ? 'T3' : 'CASH' }
    }
    target[i] = t
  }
  return { target }
}
{
  const spx = loadMarket({ base: 'GSPC', end: END })
  const sp = buildProducts(spx, { ...COST_DEFAULT, preDivYield: 3.0, etfFee: 0.09 })
  const CASES = [
    ['Faber 10개월선(1배) · S&P500', spx, sp, faberSignal(spx), 0, '2007-06-01'],
    ['Faber 10개월선(1배) · 나스닥100', mkt, prod, faberSignal(mkt), 0, '2007-06-01'],
    ['Gayed·Bilello 200일선 2배 · S&P500', spx, sp, maSignal(spx, 200), 1, '2016-04-01'],
    ['Gayed·Bilello 200일선 3배 · S&P500', spx, sp, maSignal(spx, 200), 2, '2016-04-01'],
    ['같은 규칙 200일선 3배 · 나스닥100', mkt, prod, maSignal(mkt, 200), 2, '2016-04-01'],
  ]
  log('규칙 · 시장                           발표 전(1991~)                발표 후(~2026-08)')
  log('                                     규칙 / 1배 보유 / 같은 배수 보유  규칙 / 1배 보유 / 같은 배수 보유')
  for (const [name, m, p, sig, k, pub] of CASES) {
    const parts = [[START, pub], [pub, END]].map(([f, t]) => {
      const a = idxOf(m, f), b = t === END ? m.dates.length - 1 : idxOf(m, t) - 1
      const r = evalPlan(m, p, sigPlan(sig, k), a, b)
      const h1 = evalPlan(m, p, () => ({ key: 'H', w: ONE(0) }), a, b), hk = evalPlan(m, p, () => ({ key: 'H', w: ONE(k) }), a, b)
      return `${cm(r)} / ${cm(h1)} / ${k ? cm(hk) : '    —'}`
    })
    log(`${name.padEnd(34)} ${parts.join('   ')}`)
  }
  log('  (같은 기간 트라이팟·나스닥100: 2007-06~ 와 2016-04~ 를 아래에 둔다)')
  for (const pub of ['2007-06-01', '2016-04-01']) {
    const r = evalPlan(mkt, prod, sigPlan(sigOf(mkt, {})), idxOf(mkt, pub), B)
    log(`  트라이팟 ${pub.slice(0, 7)}~: ${cm(r)}`)
  }
}

// ── H. 변동성 목표 ───────────────────────────────────────────────────────
log('\n── H. 변동성 목표(Moreira·Muir 2017 방식 단순화): 매월 말 직전 21거래일 실현변동성으로 노출 L = 목표/실현(최대 3배), 0.5배 단위')
{
  const lr = mkt.close.map((c, i) => (i ? Math.log(c / mkt.close[i - 1]) : 0))
  const vol = new Float64Array(mkt.dates.length).fill(NaN)
  for (let i = 21; i < mkt.dates.length; i++) { let s = 0, q = 0; for (let j = i - 20; j <= i; j++) { s += lr[j]; q += lr[j] * lr[j] } const mu = s / 21; vol[i] = Math.sqrt((q / 21 - mu * mu) * 252) }
  const wOf = (L) => (L <= 1 ? [L, 0, 0, 1 - L] : L <= 2 ? [2 - L, L - 1, 0, 0] : [0, 3 - L, L - 2, 0])
  const regime = sigOf(mkt, {}).regime
  const vtPlan = (target, withMA) => {
    const Lm = new Float64Array(mkt.dates.length).fill(1)
    let cur = 1
    for (let i = 0; i < mkt.dates.length; i++) {
      const last = i === mkt.dates.length - 1 || mkt.dates[i].slice(0, 7) !== mkt.dates[i + 1].slice(0, 7)
      if (last && !Number.isNaN(vol[i])) cur = Math.min(3, Math.floor((target / vol[i]) * 2) / 2)
      Lm[i] = cur
    }
    return (i) => {
      const L = withMA && regime[i - 1] !== 'UP' ? 0 : Lm[i - 1]
      return { key: `L${L}`, w: wOf(L) }
    }
  }
  log(`변형                         ${HEAD}`)
  for (const withMA of [false, true]) for (const tg of [0.20, 0.25, 0.30]) {
    const plan = vtPlan(tg, withMA)
    const r = evalPlan(mkt, prod, plan, A, B)
    const s = SUB.map(([f, t]) => evalPlan(mkt, prod, plan, idxOf(mkt, f), lastIdx(mkt, t)))
    log(row(`목표 ${pct(tg, 0)}%${withMA ? ' + 250일선 국면' : ''}`, r, s))
  }
}

// ── I. 영상 이후 ─────────────────────────────────────────────────────────
log('\n── I. 영상 이후(2026-08-28 → 2026-10-20, 실제 ETF 수정종가 기준)')
{
  const m = loadMarket({ end: '2026-10-20' })
  const sig = sigOf(m, {})
  const a = m.dates.indexOf('2026-08-28'), b = m.dates.length - 1
  const adj = Object.fromEntries(['QQQ', 'QLD', 'TQQQ'].map((n) => [n, new Map(readBars(n).map((x) => [x.d, x.a]))]))
  const W = { T3: [0, 0, 1], B15: [0.5, 0.5, 0], CASH: [0, 0, 0] }
  let v = 1
  const changes = []
  for (let i = a + 1; i <= b; i++) {
    const held = sig.target[i - 2] ?? 'CASH'
    if (sig.target[i - 2] !== sig.target[i - 3]) changes.push(`${m.dates[i - 1]} 종가에 ${sig.target[i - 3]}→${held}`)
    const w = W[held]
    const rr = ['QQQ', 'QLD', 'TQQQ'].map((n) => adj[n].get(m.dates[i]) / adj[n].get(m.dates[i - 1]) - 1)
    const rf = (m.irx[i - 1] / 100) * ((Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5) / 365
    v *= 1 + w[0] * rr[0] + w[1] * rr[1] + w[2] * rr[2] + (1 - w[0] - w[1] - w[2]) * rf
  }
  const hold = (n) => adj[n].get(m.dates[b]) / adj[n].get(m.dates[a]) - 1
  log(`  2026-08-28 판정 ${sig.target[a]}(국면 ${sig.regime[a]}, VIX10 ${sig.vix10[a].toFixed(1)}, 낙폭 ${pct(sig.dd[a])}%) · 2026-10-20 판정 ${sig.target[b]}(국면 ${sig.regime[b]}, VIX10 ${sig.vix10[b].toFixed(1)}, 낙폭 ${pct(sig.dd[b])}%)`)
  log(`  기간 중 매매: ${changes.join(' · ') || '없음'}`)
  log(`  수익률: 트라이팟 ${sgn(v - 1)}% · QQQ ${sgn(hold('QQQ'))}% · QLD ${sgn(hold('QLD'))}% · TQQQ ${sgn(hold('TQQQ'))}% (${b - a}거래일 — 통계적 의미 없음)`)
}
