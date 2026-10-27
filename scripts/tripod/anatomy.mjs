// 트라이팟이 대세 하락장을 피하는데도 QQQ보다 위험하게 나오는 이유 — 낙폭 해부
// 사용: node scripts/tripod/anatomy.mjs > docs/research/tripod/anatomy-output.txt
// 세전, 다음 날 종가 체결, 편도 5bp(앞선 검증과 같은 비용 모델). 세금은 낙폭 구조를 흐리지 않도록 뺐다.
import {
  loadMarket, buildProducts, computeSignals, simulate, holdCurve, COST_DEFAULT, RULE_DEFAULT, idxOf, readBars, years,
} from './lib.mjs'

const pct = (x, d = 1) => (x * 100).toFixed(d)
const log = console.log
const DAY = 86_400_000

/** 낙폭 구간: 고점 → 바닥 → 고점 회복(없으면 진행 중). depth ≤ th인 것만 */
function episodes(v, dates, th) {
  const out = []
  let pk = 0, tr = 0
  for (let i = 1; i <= v.length; i++) {
    const end = i === v.length
    if (end || v[i] >= v[pk]) {
      const depth = v[tr] / v[pk] - 1
      if (tr > pk && depth <= th) out.push({ pk, tr, rec: end ? -1 : i, depth })
      if (!end) { pk = i; tr = i }
    } else if (v[i] < v[tr]) tr = i
  }
  return out.map((e) => ({ ...e, pkD: dates[e.pk], trD: dates[e.tr], recD: e.rec < 0 ? '진행 중' : dates[e.rec] }))
}

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/** 일별 보유 상태 복원: held[j] = j일 종가 이후 보유(다음 날 수익을 결정) */
function heldStates(sig, trades, a, b) {
  const held = new Array(b - a + 1)
  held[0] = sig.target[a - 1] ?? 'CASH'
  const at = new Map(trades.map((t) => [t.i, t.to]))
  for (let i = a + 1; i <= b; i++) held[i - a] = at.get(i) ?? held[i - a - 1]
  return held
}

/** 구간 [p, q] 손실을 그날 수익을 낸 보유 상태별로 나눈다(로그수익 합 → 배수) */
function byState(v, held, p, q) {
  const s = { T3: 0, B15: 0, CASH: 0 }
  const n = { T3: 0, B15: 0, CASH: 0 }
  for (let j = p + 1; j <= q; j++) { const k = held[j - 1]; s[k] += Math.log(v[j] / v[j - 1]); n[k]++ }
  return Object.fromEntries(Object.keys(s).map((k) => [k, { r: Math.exp(s[k]) - 1, n: n[k] }]))
}

function annVol(v) {
  let s = 0, q = 0
  for (let i = 1; i < v.length; i++) { const r = Math.log(v[i] / v[i - 1]); s += r; q += r * r }
  const n = v.length - 1, mu = s / n
  return Math.sqrt((q / n - mu * mu) * 252)
}

const underFrac = (v, th) => {
  let pk = v[0], c = 0
  for (const x of v) { if (x > pk) pk = x; if (x / pk - 1 <= th) c++ }
  return c / v.length
}

function report(label, mkt, prod, a, b) {
  const sig = computeSignals(mkt, RULE_DEFAULT)
  const tri = simulate(mkt, prod, sig, { startIdx: a, endIdx: b, exec: 'close1', costBps: 5 })
  const qqq = holdCurve(mkt, prod, 0, a, b)
  const dates = mkt.dates.slice(a, b + 1)
  const held = heldStates(sig, tri.trades, a, b)
  const yrs = years(mkt, a, b)
  const cg = (v) => (v[v.length - 1] / v[0]) ** (1 / yrs) - 1

  log(`\n════ ${label}: ${dates[0]} ~ ${dates[dates.length - 1]} (${yrs.toFixed(1)}년, 세전)`)
  log(`CAGR 트라이팟 ${pct(cg(tri.v))}% · QQQ ${pct(cg(qqq))}% | 연 변동성 트라이팟 ${pct(annVol(tri.v))}% · QQQ ${pct(annVol(qqq))}%`)
  const heldDays = { T3: 0, B15: 0, CASH: 0 }
  for (let j = 0; j < held.length - 1; j++) heldDays[held[j]]++
  const tot = held.length - 1
  log(`보유 비중(거래일): 3배 ${pct(heldDays.T3 / tot)}% · 1.5배 ${pct(heldDays.B15 / tot)}% · 현금 ${pct(heldDays.CASH / tot)}%`)
  log(`낙폭 구간 수(고점 회복 전까지 한 구간)      -20% 이하   -30% 이하   -40% 이하   -50% 이하`)
  for (const [name, v] of [['트라이팟', tri.v], ['QQQ', qqq]]) {
    const c = [-0.2, -0.3, -0.4, -0.5].map((th) => String(episodes(v, dates, th).length).padStart(9)).join('   ')
    log(`  ${name.padEnd(8)}                                ${c}`)
  }
  log(`고점 대비 -20% 이하에 머문 날 비율: 트라이팟 ${pct(underFrac(tri.v, -0.2))}% · QQQ ${pct(underFrac(qqq, -0.2))}% | -40% 이하: 트라이팟 ${pct(underFrac(tri.v, -0.4))}% · QQQ ${pct(underFrac(qqq, -0.4))}%`)

  log(`\n── 트라이팟 낙폭 -30% 이하 구간 (같은 고점→바닥 기간의 QQQ, 손실을 그날 보유 상태별로 나눔)`)
  log('고점        바닥        회복        깊이     고점→바닥  바닥→회복 | 같은 기간 QQQ | 3배로 맞은 손실(일수) · 1.5배 · 현금')
  for (const e of episodes(tri.v, dates, -0.3)) {
    const q = qqq[e.tr] / qqq[e.pk] - 1
    const st = byState(tri.v, held, e.pk, e.tr)
    log(`${e.pkD}  ${e.trD}  ${e.recD.padEnd(10)}  ${pct(e.depth).padStart(6)}%  ${String(days(e.pkD, e.trD)).padStart(6)}일  ${e.rec < 0 ? '    —   ' : `${String(days(e.trD, e.recD)).padStart(6)}일`} | ${pct(q).padStart(6)}%      | ${pct(st.T3.r).padStart(6)}%(${st.T3.n}) · ${pct(st.B15.r).padStart(6)}%(${st.B15.n}) · ${pct(st.CASH.r).padStart(5)}%(${st.CASH.n})`)
  }

  log(`\n── QQQ 낙폭 -25% 이하 구간 (같은 기간 트라이팟)`)
  log('고점        바닥        회복        QQQ 깊이  고점→회복 | 고점→바닥 트라이팟 | 고점→QQQ 회복일 트라이팟 | 그 기간 트라이팟 최대 낙폭')
  for (const e of episodes(qqq, dates, -0.25)) {
    const t1 = tri.v[e.tr] / tri.v[e.pk] - 1
    const endI = e.rec < 0 ? dates.length - 1 : e.rec
    const t2 = tri.v[endI] / tri.v[e.pk] - 1
    let pk = tri.v[e.pk], m = 0
    for (let j = e.pk; j <= endI; j++) { if (tri.v[j] > pk) pk = tri.v[j]; m = Math.min(m, tri.v[j] / pk - 1) }
    log(`${e.pkD}  ${e.trD}  ${e.recD.padEnd(10)}  ${pct(e.depth).padStart(6)}%  ${e.rec < 0 ? '  진행 중' : `${(days(e.pkD, e.recD) / 365.25).toFixed(1).padStart(5)}년`}   | ${pct(t1).padStart(7)}%           | ${pct(t2).padStart(8)}%                | ${pct(m).padStart(6)}%`)
  }
  return { tri, qqq, dates, held, sig }
}

// 1) 나스닥100 가상 상품 1991~2026
const mkt = loadMarket({ end: '2026-08-28' })
const prod = buildProducts(mkt, COST_DEFAULT)
const A = idxOf(mkt, '1991-01-02'), B = mkt.dates.length - 1
const r1 = report('나스닥100 가상 상품', mkt, prod, A, B)

// 2) 실제 ETF 수정종가 2010-02-11~2026-10-20 (신호는 같은 나스닥100 규칙)
{
  const m = loadMarket({ end: '2026-10-20' })
  const syn = buildProducts(m, COST_DEFAULT)
  const a = m.dates.indexOf('2010-02-11'), b = m.dates.length - 1
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(readBars(n).map((x) => [x.d, x.a])))
  const real = { full: syn.full.map((f, k) => (k === 3 ? f : Float64Array.from(f, (x, i) => (i > a ? adj[k].get(m.dates[i]) / adj[k].get(m.dates[i - 1]) : x)))), night: syn.night }
  report('실제 ETF 수정종가', m, real, a, b)
}

// 3) 규칙이 손을 쓰기까지: 3배 보유 중 나스닥100 고점에서 첫 감축까지 걸린 하락
log('\n── 3배를 들고 있다가 처음 줄이기까지 (1991~2026, 3배 보유가 끝난 날마다: 그 3배 구간 중 나스닥100 최고 종가 대비 하락)')
{
  const { held, dates } = r1
  const ndx = mkt.close.slice(A, B + 1)
  const drops = []
  let start = -1
  for (let j = 0; j < held.length; j++) {
    if (held[j] === 'T3' && start < 0) start = j
    if (held[j] !== 'T3' && start >= 0) {
      let hi = start
      for (let k = start; k < j; k++) if (ndx[k] > ndx[hi]) hi = k
      drops.push({ from: dates[hi], to: dates[j], ndx: ndx[j] / ndx[hi] - 1, tri: r1.tri.v[j] / r1.tri.v[hi] - 1, to2: held[j] })
      start = -1
    }
  }
  drops.sort((x, y) => x.tri - y.tri)
  const med = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  log(`3배 구간 ${drops.length}개 · 끝날 때 나스닥100 하락 중간 ${pct(med(drops.map((d) => d.ndx)))}% · 그동안 트라이팟 하락 중간 ${pct(med(drops.map((d) => d.tri)))}%`)
  log('가장 크게 맞은 다섯 번 (3배 구간 중 고점 → 처음 줄인 날):')
  for (const d of drops.slice(0, 5)) log(`  ${d.from} → ${d.to} (${d.to2 === 'B15' ? '1.5배로' : '현금으로'}): 나스닥100 ${pct(d.ndx)}%, 트라이팟 ${pct(d.tri)}%`)
}
