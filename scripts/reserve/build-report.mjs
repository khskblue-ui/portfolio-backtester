// 현금 비중으로 사고파는 규칙 — 규칙 도해와 과거 데이터 점검 보고서 (HTML → PDF)
// 사용: node scripts/reserve/build-report.mjs   → docs/research/reserve-plan/reserve-plan.html · .pdf
// 자료: data-src/reserve/*.csv (야후 수정주가 일별 스냅숏, 2026-10-30까지). 달러 기준(환율 제외). 세금은 비교표의 세금 줄에만 넣는다.
// 결정은 그날 종가, 체결은 다음 거래일 종가. 수치는 전부 이 스크립트의 계산 결과를 그대로 넣고, 본문 서술은 check()로 계산과 맞춘다.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'docs/research/reserve-plan')
const csv = (name) => new Map(fs.readFileSync(path.join(ROOT, 'data-src/reserve', `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')

// ── 규칙 (문서와 계산이 같은 값을 쓴다) ──────────────────────────────────────
const RULE = {
  startCash: 0.4, // 지금의 현금 비중
  firstDd: -0.2, // 첫 투입: QQQ가 최고가에서 이만큼 내리면
  target: 0.3, // 기준 현금 비중
  upper: 0.4, // 현금 상한: 닿으면 기준까지 써서 산다
  lower: 0.2, lowerTo: 0.25, // 현금 하한: 닿으면 QQQ를 팔아 lowerTo까지 채운다
  fillTo: 0.1, // 살 때 금과 암호화폐를 채우는 비중
  trimAt: 0.2, trimTo: 0.1, // 금, 암호화폐 상한과 줄인 뒤 비중
  taxRate: 0.22, // 세금 반영 계산에 쓰는 매도 차익 세율
}

/**
 * opt: { rule(false면 사지도 팔지도 않고 금, 암호화폐 상한만 적용), lower(현금 하한 적용), contrib(새 돈: 연간, 전체 자산 대비), tax(매도 차익 세율) }
 * 결정은 그날 종가, 체결은 다음 거래일 종가. 현금 하한은 매달 첫 거래일에만 본다. 낙폭의 기준 최고가는 계산 시작일 뒤의 최고 종가.
 * 수익률은 새 돈의 영향을 뺀 시간가중 수익률(V).
 */
function sim(dates, assets, base, opt = {}) {
  const o = { rule: true, lower: true, contrib: 0, tax: 0, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => { // 평균 단가 기준 차익에 과세(공제와 손익 합산 없음)
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const weights = (d, T) => ({ ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T })
  let peakQ = QQQ.get(dates[0]), irx = 0, stepped = false, nav = 100, lastPost = 100
  let pendBuy = null, pendSell = false, pendTrim = []
  const series = [{ d: dates[0], V: 100, qdd: 0, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1], newMonth = d.slice(0, 7) !== prev.slice(0, 7)
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d), s = cur - RULE.trimTo * T
      if (s > 0) { sell(a, s, d); events.push({ d, type: 'trim', key, from: cur / T, pct: s / T }) }
    }
    pendTrim = []
    if (pendSell) {
      const T = total(d), from = cash / T, need = RULE.lowerTo * T - cash
      if (need > 0.005 * T) { sell(qA, Math.min(need, hold.qqq * px(qA, d)), d); events.push({ d, type: 'sell', pct: need / T, from, to: cash / total(d) }) }
      pendSell = false
    }
    if (pendBuy) {
      const T = total(d), from = cash / T, buy = cash - RULE.target * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d))
        events.push({ d, type: 'buy', first: pendBuy === 'first', pct: buy / T, from, to: cash / total(d), qdd: QQQ.get(d) / peakQ - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      }
      pendBuy = null
    }
    nav *= total(d) / lastPost // 새 돈이 들어오기 전 값으로 하루 수익을 잰다
    if (o.contrib && newMonth) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? RULE.target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) { // 현금이 기준 이상이면 기준보다 가장 모자란 자산을 산다
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * RULE.fillTo : RULE.fillTo) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.rule) {
      if (!stepped) { if (qdd <= RULE.firstDd) { stepped = true; pendBuy = 'first' } }
      else if (cw >= RULE.upper) pendBuy = 'upper'
      else if (o.lower && newMonth && cw <= RULE.lower) pendSell = true
    }
    for (const a of others) if ((hold[a.key] * px(a, d)) / T >= RULE.trimAt) pendTrim.push(a.key)
    series.push({ d, V: nav, qdd, w: weights(d, T) })
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  for (const s of series) { if (s.V > pk) { pk = s.V; pkDay = s.d } if (s.V / pk - 1 < mdd) { mdd = s.V / pk - 1; mddDay = s.d; mddPeak = pkDay } }
  const rec = series.find((s) => s.d > mddDay && s.V >= series.find((x) => x.d === mddPeak).V)?.d ?? null
  const buys = events.filter((e) => e.type === 'buy'), sells = events.filter((e) => e.type === 'sell')
  const firstDay = buys[0]?.d ?? null, after = firstDay ? series.filter((s) => s.d > firstDay) : []
  return { series, events, buys, sells, trims: events.filter((e) => e.type === 'trim'), cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, mddDay, rec, final: last, firstBuy: firstDay, yrs, taxPaid, avgCash: series.reduce((x, s) => x + s.w.cash, 0) / series.length, minCashAfter: after.length ? Math.min(...after.map((s) => s.w.cash)) : null }
}

const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
const SCEN = [
  { id: 's2014', title: '2014~2026년', sub: 'QQQ 40, 금 10, 비트코인 10, 현금 40으로 시작', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, note: '지금 구성과 같은 비중입니다. 비트코인 자료가 2014년 9월부터라 이때 시작합니다.' },
  { id: 's2004', title: '2004~2026년 (2008년 포함)', sub: 'QQQ 50, 금 10, 현금 40으로 시작', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.5, gold: 0.1, cash: 0.4 }, note: '비트코인이 없던 시기라 그 몫을 QQQ에 더했습니다. 금 ETF(GLD) 상장일부터입니다.' },
  { id: 's1999', title: '1999~2026년 (닷컴 버블 포함)', sub: 'QQQ 60, 현금 40으로 시작', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.6, cash: 0.4 }, note: '금 ETF도 없던 시기라 금과 비트코인 몫을 QQQ에 더했습니다. 가장 나쁜 경우를 보려는 구간입니다.' },
]
for (const s of SCEN) {
  s.dates = [...QQQ.keys()].sort().filter((d) => d >= s.start && s.assets.every((a) => a.px.has(d)))
  const run = (opt) => sim(s.dates, s.assets, s.base, opt)
  s.plan = run({})
  s.hold = run({ rule: false })
  s.nolower = run({ lower: false })
  s.c3 = run({ contrib: 0.03 })
  s.c6 = run({ contrib: 0.06 })
  s.tax = run({ tax: RULE.taxRate })
  s.holdTax = run({ rule: false, tax: RULE.taxRate })
}

// ── 표기 ────────────────────────────────────────────────────────────────────
const pct = (x, d = 1) => `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`
const p0 = (x) => pct(x, 0)
const ym = (d) => `${d.slice(0, 4)}.${d.slice(5, 7)}`
const ymd = (d) => d.replaceAll('-', '.')
const ymK = (d) => `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월`
const ymdK = (d) => `${ymK(d)} ${+d.slice(8, 10)}일`
const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25
const C = { cash: '#1baf7a', gold: '#eda100', qqq: '#2a78d6', btc: '#eb6834', plan: '#2a78d6', base: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', ink3: '#8a8984', grid: '#e6e5e1', surface: '#ffffff' }
const NAME = { cash: '현금', gold: '금', qqq: 'QQQ', btc: '비트코인' }
const STACK = ['cash', 'gold', 'qqq', 'btc'] // 색 인접 검사를 통과한 순서(aqua, yellow, blue, orange)

// ── 차트 (인라인 SVG, 인쇄용 정적 도표) ─────────────────────────────────────
const W = 688, ML = 46, MR = 92
const xScale = (dates) => { const t0 = Date.parse(dates[0]), t1 = Date.parse(dates.at(-1)); return (d) => ML + ((Date.parse(d) - t0) / (t1 - t0)) * (W - ML - MR) }
const sample = (series, keep) => series.filter((s, i) => i % 4 === 0 || i === series.length - 1 || keep.has(s.d))
const yearTicks = (dates) => { const y0 = +dates[0].slice(0, 4) + 1, y1 = +dates.at(-1).slice(0, 4); const step = y1 - y0 > 20 ? 4 : y1 - y0 > 10 ? 2 : 1; const out = []; for (let y = y0; y <= y1; y += step) out.push(`${y}-01-01`); return out }
const xAxis = (dates, x, y) => yearTicks(dates).map((d) => `<line x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${y}" y2="${y + 4}" stroke="${C.ink3}"/><text x="${x(d).toFixed(1)}" y="${y + 15}" text-anchor="middle" class="tick">${d.slice(0, 4)}</text>`).join('')
const pathOf = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')

function valueChart(s) {
  const H = 168, T = 14, B = 26, x = xScale(s.dates), keep = new Set()
  const a = sample(s.plan.series, keep), b = sample(s.hold.series, keep)
  const all = [...a, ...b].map((p) => p.V), lo = Math.min(...all), hi = Math.max(...all)
  const l0 = Math.log10(lo * 0.9), l1 = Math.log10(hi * 1.1)
  const y = (v) => T + (1 - (Math.log10(v) - l0) / (l1 - l0)) * (H - T - B)
  const ticks = [25, 50, 100, 200, 500, 1000, 2000, 5000].filter((v) => Math.log10(v) > l0 && Math.log10(v) < l1)
  const endA = s.plan.final.V, endB = s.hold.final.V
  let ya = y(endA), yb = y(endB)
  if (Math.abs(ya - yb) < 13) { const mid = (ya + yb) / 2; if (ya < yb) { ya = mid - 6.5; yb = mid + 6.5 } else { ya = mid + 6.5; yb = mid - 6.5 } }
  const xe = x(s.dates.at(-1))
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="자산 가치 추이">
    ${ticks.map((v) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${v.toLocaleString('en-US')}</text>`).join('')}
    <path d="${pathOf(b.map((p) => [x(p.d), y(p.V)]))}" fill="none" stroke="${C.base}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${pathOf(a.map((p) => [x(p.d), y(p.V)]))}" fill="none" stroke="${C.plan}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${xe}" cy="${y(endB)}" r="4" fill="${C.base}" stroke="#fff" stroke-width="2"/><circle cx="${xe}" cy="${y(endA)}" r="4" fill="${C.plan}" stroke="#fff" stroke-width="2"/>
    <text x="${xe + 9}" y="${(ya + 3.5).toFixed(1)}" class="lbl">규칙대로 ${Math.round(endA).toLocaleString('en-US')}</text>
    <text x="${xe + 9}" y="${(yb + 3.5).toFixed(1)}" class="lbl2">그냥 두면 ${Math.round(endB).toLocaleString('en-US')}</text>
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

function cashChart(s) {
  const H = 158, T = 10, B = 26, x = xScale(s.dates)
  const marks = [...s.plan.buys, ...s.plan.sells], keep = new Set(marks.map((e) => e.d))
  const a = sample(s.plan.series, keep)
  const hi = Math.max(0.5, Math.ceil(Math.max(...a.map((p) => p.w.cash), ...marks.map((e) => e.from)) * 10) / 10)
  const y = (v) => T + (1 - v / hi) * (H - T - B)
  const ticks = []; for (let v = 0; v <= hi + 1e-9; v += 0.1) ticks.push(v)
  const lines = [[RULE.upper, `현금 상한 ${p0(RULE.upper)}`, C.ink2, ''], [RULE.target, `기준 ${p0(RULE.target)}`, C.ink3, ' stroke-dasharray="3 3"'], [RULE.lower, `현금 하한 ${p0(RULE.lower)}`, C.ink2, '']]
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="현금 비중과 사고판 날">
    ${ticks.map((v) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <rect x="${ML}" y="${y(RULE.upper).toFixed(1)}" width="${W - MR - ML}" height="${(y(RULE.lower) - y(RULE.upper)).toFixed(1)}" fill="${C.cash}" opacity="0.1"/>
    ${lines.map(([v, label, color, dash]) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="1"${dash}/><text x="${W - MR + 6}" y="${(y(v) + 3.5).toFixed(1)}" class="lbl2">${label}</text>`).join('')}
    <path d="${pathOf(a.map((p) => [x(p.d), y(p.w.cash)]))}" fill="none" stroke="${C.cash}" stroke-width="2" stroke-linejoin="round"/>
    ${s.plan.buys.map((e) => `<circle cx="${x(e.d).toFixed(1)}" cy="${y(e.from).toFixed(1)}" r="4.5" fill="${C.ink}" stroke="#fff" stroke-width="2"/>`).join('')}
    ${s.plan.sells.map((e) => `<path d="M${x(e.d).toFixed(1)},${(y(e.from) - 5.5).toFixed(1)}l5.5,5.5l-5.5,5.5l-5.5,-5.5z" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/>`).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

function weightChart(s) {
  const H = 158, T = 8, B = 26, x = xScale(s.dates)
  const keep = new Set(s.plan.events.map((e) => e.d))
  const a = sample(s.plan.series, keep), keys = STACK.filter((k) => k in s.base)
  const y = (v) => T + (1 - v) * (H - T - B)
  let acc = a.map(() => 0)
  const layers = keys.map((k) => { const lo = acc.slice(); acc = acc.map((v, i) => v + a[i].w[k]); return { k, lo, hi: acc.slice() } })
  const last = s.plan.final.w
  let cum = 0
  const labels = keys.map((k) => { const mid = cum + last[k] / 2; cum += last[k]; return { k, mid, v: last[k] } }).filter((l) => l.v >= 0.04)
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="비중 변화">
    ${[0, 0.25, 0.5, 0.75, 1].map((v) => `<text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    ${layers.map((L) => `<path d="${pathOf(a.map((p, i) => [x(p.d), y(L.hi[i])]))}${a.map((p, i) => [x(p.d), y(L.lo[i])]).reverse().map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')}Z" fill="${C[L.k]}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>`).join('')}
    ${labels.map((l) => `<text x="${W - MR + 6}" y="${(y(l.mid) + 3.5).toFixed(1)}" class="lbl2">${NAME[l.k]} ${p0(l.v)}</text>`).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

const legend = (items) => `<div class="legend">${items.map(([kind, color, label]) => `<span class="lg"><span class="${kind}" style="--c:${color}"></span>${label}</span>`).join('')}</div>`

// ── 본문 조각 ───────────────────────────────────────────────────────────────
/** 본문에 적은 서술이 계산 결과와 어긋나면 만들지 않는다 */
const check = (cond, msg) => { if (!cond) throw new Error(`본문 서술과 계산이 어긋남: ${msg}`) }
const winMdd = (r, from, to) => { let pk = 0, m = 0; for (const p of r.series) if (p.d >= from && p.d <= to) { pk = Math.max(pk, p.V); m = Math.min(m, p.V / pk - 1) } return m }
const span = (list) => (list.length > 1 ? `${ymK(list[0].d)}부터 ${ymK(list.at(-1).d)}까지` : ymK(list[0].d))
const tiles = (s) => {
  const t = (label, a, b) => `<div class="tile"><div class="tl">${label}</div><div class="tv">${a}</div><div class="tb">${b}</div></div>`
  return `<div class="tiles">
    ${t('연수익률', pct(s.plan.cagr), `그냥 두면 ${pct(s.hold.cagr)}`)}
    ${t('최대 낙폭', pct(s.plan.mdd), `그냥 두면 ${pct(s.hold.mdd)}`)}
    ${t('산 횟수', `${s.plan.buys.length}번`, `처음 산 때 ${ymK(s.plan.firstBuy)}`)}
    ${t('현금을 채우려 판 횟수', `${s.plan.sells.length}번`, `마지막 현금 비중 ${p0(s.plan.final.w.cash)}`)}
  </div>`
}
const partsText = (s, parts) => s.assets.filter((a) => Math.round((parts[a.key] ?? 0) * 100) >= 1).map((a) => `${a.name} ${p0(parts[a.key])}`).join(', ')
const eventTable = (s) => {
  const rows = s.plan.events.filter((e) => e.type !== 'trim').map((e) => (e.type === 'buy'
    ? `<tr><td>${ymd(e.d)}</td><td>삼</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.from)} → ${p0(e.to)}</td><td class="n">${p0(e.qdd)}</td><td>${e.first ? '1번 규칙' : `2번 규칙(현금 ${p0(RULE.upper)} 이상)`}: ${partsText(s, e.parts)}</td></tr>`
    : `<tr><td>${ymd(e.d)}</td><td>팖</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.from)} → ${p0(e.to)}</td><td class="n"></td><td>3번 규칙(현금 ${p0(RULE.lower)} 이하): QQQ를 팔아 현금으로</td></tr>`))
  return `<table class="t dense"><thead><tr><th style="width:13%">날짜</th><th style="width:8%">한 일</th><th class="n" style="width:14%">크기 (전체 대비)</th><th class="n" style="width:15%">현금 비중</th><th class="n" style="width:11%">QQQ 낙폭</th><th>이유와 내용</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6">없음</td></tr>'}</tbody></table>`
}
const takeaways = (s) => {
  const { buys, sells, trims } = s.plan, out = []
  const first = buys[0]
  if (first?.first) out.push(`처음 산 때는 ${ymK(first.d)}입니다. 그때 현금이 ${p0(first.from)}였고 ${p0(first.to)}로 줄였습니다.${first.from > RULE.startCash + 0.05 && trims.some((e) => e.d < first.d) ? ' 비트코인을 20%에서 줄인 돈이 현금에 쌓여 있었습니다.' : ''}`)
  else out.push(`QQQ가 최고가에서 ${p0(-RULE.firstDd)} 내렸을 때는 현금이 이미 ${p0(RULE.target)}보다 적어 사지 않았습니다. QQQ가 그 전에 크게 올랐기 때문입니다.`)
  const upper = buys.filter((e) => !e.first)
  out.push(upper.length ? `현금이 ${p0(RULE.upper)} 이상이 되어 산 것은 ${upper.length}번입니다. 그때 QQQ는 최고가보다 ${upper.map((e) => p0(-e.qdd)).join(', ')} 낮았습니다.` : `처음 산 뒤로 현금이 ${p0(RULE.upper)} 이상이 된 적은 없습니다.`)
  out.push(sells.length ? `현금이 ${p0(RULE.lower)} 이하가 되어 QQQ를 판 것은 ${sells.length}번입니다(${span(sells)}).` : `현금이 ${p0(RULE.lower)} 이하가 된 적은 없습니다.`)
  if (s.id === 's1999') out.push(`하락이 길어져 전체 자산이 최고점보다 ${pct(-s.plan.mdd)} 낮아졌습니다(${ymdK(s.plan.mddDay)}). 이전 최고점은 ${ymdK(s.plan.rec)}에 다시 넘었습니다.`)
  return out
}
const scenarioPage = (s, n) => `<section class="page">
  <div class="kicker">과거 데이터 ${n}</div>
  <h2>${s.title}</h2>
  <p class="sub">${s.sub}합니다. ${s.note}</p>
  ${tiles(s)}
  <h3>자산 가치 <span class="hint">시작 = 100, 세로축은 로그 눈금</span></h3>
  ${legend([['ln', C.plan, '규칙대로'], ['ln', C.base, '그냥 둔 경우 (금, 암호화폐 상한만 적용)']])}
  ${valueChart(s)}
  <h3>현금 비중과 사고판 날 <span class="hint">초록 띠 안에서는 사고팔지 않습니다</span></h3>
  ${legend([['ln', C.cash, '현금 비중'], ['dot', C.ink, '산 날'], ['dia', C.ink, 'QQQ를 판 날']])}
  ${cashChart(s)}
  <h3>비중 변화</h3>
  ${legend(STACK.filter((k) => k in s.base).map((k) => ['sw', C[k], NAME[k]]))}
  ${weightChart(s)}
  <ul class="take">${takeaways(s).map((t) => `<li>${t}</li>`).join('')}</ul>
</section>`
const recordsPage = () => `<section class="page">
  <div class="kicker">기록</div>
  <h2>사고판 기록</h2>
  <p class="sub">세 구간에서 규칙에 따라 사고판 날입니다. 크기는 그날 전체 평가액에서 차지하는 비율입니다. 금이나 비트코인을 20%에서 줄인 날은 뺐습니다.</p>
  ${SCEN.map((s) => `<h3>${s.title} <span class="hint">${s.sub}</span></h3>${eventTable(s)}`).join('')}
  <p class="foot">현금 비중과 낙폭은 사고판 날의 종가로 계산했습니다. 사고팔지는 그 전 거래일 종가를 보고 정했습니다.</p>
</section>`

// ── 규칙 도해 ───────────────────────────────────────────────────────────────
const NOW = SCEN[0].base
const BASELINE = { cash: RULE.target, gold: NOW.gold, qqq: NOW.qqq + (NOW.cash - RULE.target), btc: NOW.btc }
const mixText = (m) => `QQQ ${Math.round(m.qqq * 100)}, 암호화폐 ${Math.round(m.btc * 100)}, 금 ${Math.round(m.gold * 100)}, 현금 ${Math.round(m.cash * 100)}`
const mixBar = (m) => `<div class="bar">${STACK.map((k) => `<span class="seg" style="width:${m[k] * 100}%;background:${C[k]}"></span>`).join('')}</div>`
const REST = 1 - RULE.target // 현금을 뺀 나머지 자산
const FALL = 1 - (RULE.target / RULE.upper - RULE.target) / REST // 나머지 자산이 이만큼 내리면 현금이 상한
const RISE = (RULE.target / RULE.lower - RULE.target) / REST - 1 // 나머지 자산이 이만큼 오르면 현금이 하한
const TOTAL_FALL = 1 - RULE.target / RULE.upper
const qqqFallFor = (btcFall) => 1 - (RULE.target / RULE.upper - RULE.target - BASELINE.gold - BASELINE.btc * (1 - btcFall)) / BASELINE.qqq
const gauge = () => {
  const Wd = 688, H = 124, L = 24, R = 24, Y = 52, BH = 26, max = 0.5
  const x = (c) => L + (c / max) * (Wd - L - R)
  const arrow = (from, to, yy, color) => { const dir = to > from ? 1 : -1; return `<line x1="${x(from)}" x2="${x(to) - dir * 7}" y1="${yy}" y2="${yy}" stroke="${color}" stroke-width="2.5"/><path d="M${x(to)},${yy}l${-dir * 9},-5v10z" fill="${color}"/>` }
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="현금 비중 눈금">
    <rect x="${x(0)}" y="${Y}" width="${x(max) - x(0)}" height="${BH}" fill="#eceef2" rx="4"/>
    <rect x="${x(RULE.lower)}" y="${Y}" width="${x(RULE.upper) - x(RULE.lower)}" height="${BH}" fill="${C.cash}" opacity="0.28"/>
    <text x="${x(RULE.target)}" y="${Y + 17}" text-anchor="middle" class="big">${p0(RULE.lower)}와 ${p0(RULE.upper)} 사이에서는 사고팔지 않습니다</text>
    ${[0, 0.1, RULE.lower, RULE.lowerTo, RULE.target, RULE.upper, 0.5].map((c) => `<line x1="${x(c)}" x2="${x(c)}" y1="${Y + BH}" y2="${Y + BH + 5}" stroke="${C.ink3}"/><text x="${x(c)}" y="${Y + BH + 18}" text-anchor="middle" class="tick">${p0(c)}</text>`).join('')}
    <line x1="${x(RULE.lower)}" x2="${x(RULE.lower)}" y1="${Y - 6}" y2="${Y + BH}" stroke="${C.ink}" stroke-width="2"/>
    <line x1="${x(RULE.upper)}" x2="${x(RULE.upper)}" y1="${Y - 6}" y2="${Y + BH}" stroke="${C.ink}" stroke-width="2"/>
    ${arrow(RULE.upper, RULE.target, Y - 16, C.qqq)}
    <text x="${x(max)}" y="${Y - 30}" text-anchor="end" class="big">현금 ${p0(RULE.upper)} 이상이면 ${p0(RULE.target)}까지 써서 삽니다</text>
    ${arrow(RULE.lower, RULE.lowerTo, Y - 16, C.btc)}
    <text x="${x(0)}" y="${Y - 30}" class="big">현금 ${p0(RULE.lower)} 이하면 QQQ를 팔아 ${p0(RULE.lowerTo)}까지 채웁니다</text>
    <text x="${(L + Wd - R) / 2}" y="${H - 4}" text-anchor="middle" class="axis">전체 자산에서 현금이 차지하는 비중</text>
  </svg>`
}
const amountBars = () => {
  const rows = [
    ['기준 비중일 때', REST, `현금 ${p0(RULE.target)}`, ''],
    [`나머지 자산이 ${p0(FALL)} 내리면`, REST * (1 - FALL), `현금 ${p0(RULE.upper)}`, '삽니다'],
    [`나머지 자산이 ${p0(RISE)} 오르면`, REST * (1 + RISE), `현금 ${p0(RULE.lower)}`, 'QQQ를 팝니다'],
  ]
  const Wd = 688, RH = 30, L = 170, unit = (Wd - L - 150) / (RULE.target + REST * (1 + RISE))
  return `<svg viewBox="0 0 ${Wd} ${rows.length * RH + 6}" role="img" aria-label="현금 비중이 달라지는 경우">
    ${rows.map(([label, rest, cashLabel, act], i) => { const yy = i * RH + 4, wc = RULE.target * unit, wr = rest * unit; return `<text x="0" y="${yy + 15}" class="big">${label}</text>
      <rect x="${L}" y="${yy}" width="${wc - 2}" height="20" rx="3" fill="${C.cash}"/><rect x="${L + wc}" y="${yy}" width="${wr}" height="20" rx="3" fill="${C.qqq}"/>
      <text x="${L + wc + wr + 10}" y="${yy + 15}" class="big">${cashLabel}${act ? `, ${act}` : ''}</text>` }).join('')}
  </svg>`
}

const cmpRow = (label, key, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${SCEN.map((s) => `<td class="n">${pct(s[key].cagr)}</td><td class="n">${pct(s[key].mdd)}</td>`).join('')}</tr>`
const cntRow = (label, key, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${SCEN.map((s) => `<td class="n">${s[key].buys.length}번 / ${s[key].sells.length}번</td><td class="n">${s[key].minCashAfter == null ? '' : p0(s[key].minCashAfter)}</td>`).join('')}</tr>`
const s14 = SCEN[0], s04 = SCEN[1], s99 = SCEN[2]
const BEAR22 = ['2021-11-01', '2022-12-31']
const dd22 = { plan: winMdd(s04.plan, ...BEAR22), hold: winMdd(s04.hold, ...BEAR22) }
// 비교 장의 서술을 계산이 뒷받침하는지 확인
check(s14.plan.cagr - s14.hold.cagr > 0.02 && s14.plan.buys[0].first && s14.plan.buys[0].from > 0.5, '2014~: 규칙이 2%p 넘게 높고 첫 투입 때 현금이 50%를 넘음')
for (const s of [s04, s99]) check(Math.abs(s.plan.cagr - s.hold.cagr) < 0.005 && s.tax.cagr < s.holdTax.cagr, `${s.id}: 규칙과 투입 없음이 0.5%p 안, 세금 넣으면 규칙이 낮음`)
check(dd22.plan > dd22.hold + 0.03 && s04.hold.final.w.qqq > 0.85, '2004~: 2022년 낙폭은 규칙이 3%p 넘게 얕고 투입 없음은 QQQ 85% 초과')
for (const s of [s04, s99]) check(s.nolower.cagr > s.plan.cagr + 0.01 && s.nolower.minCashAfter < 0.05, `${s.id}: 하한을 빼면 수익률은 1%p 넘게 높고 현금은 5% 아래까지`)
check(SCEN.every((s) => s.c6.sells.length === 0) && SCEN.every((s) => s.c3.sells.length <= 2), '새 돈 6%면 판 적 없음, 3%면 2번 이하')
check(s14.plan.buys.every((e) => e.d < '2020-01-01'), '2014~: 2020년과 2022년에는 사지 않음')
check(s99.plan.mdd < s99.hold.mdd, '1999~: 규칙의 최대 낙폭이 더 깊음')

const css = `
@page { size: A4; margin: 14mm 13mm 14mm 13mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'IBM Plex Sans KR', sans-serif; color: ${C.ink}; font-size: 10.5pt; line-height: 1.6; word-break: keep-all; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
h1 { font-size: 24pt; line-height: 1.25; margin: 0 0 6pt; letter-spacing: -0.01em; }
h2 { font-size: 15pt; margin: 2pt 0 4pt; }
h3 { font-size: 10.5pt; margin: 12pt 0 2pt; }
.hint { font-weight: 400; color: ${C.ink3}; font-size: 8.5pt; margin-left: 6pt; }
.kicker { font-size: 8.5pt; color: #2962ff; font-weight: 700; letter-spacing: 0.04em; }
.sub { color: ${C.ink2}; margin: 0 0 8pt; font-size: 9.5pt; }
.lead { font-size: 11.5pt; margin: 0 0 12pt; }
svg { width: 100%; height: auto; display: block; }
svg text { font-family: 'IBM Plex Sans KR', sans-serif; }
.tick { font-size: 8px; fill: ${C.ink3}; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; }
.lbl { font-size: 9.5px; fill: ${C.ink}; font-weight: 500; }
.big { font-size: 11px; fill: ${C.ink}; font-weight: 500; }
.lbl2 { font-size: 9px; fill: ${C.ink2}; }
.axis { font-size: 9px; fill: ${C.ink2}; }
.legend { display: flex; flex-wrap: wrap; gap: 4pt 14pt; font-size: 8.5pt; color: ${C.ink2}; margin: 2pt 0 2pt; }
.lg { display: inline-flex; align-items: center; gap: 5pt; }
.ln { width: 16pt; height: 0; border-top: 2px solid var(--c); }
.rule { width: 16pt; height: 0; border-top: 1.5px solid var(--c); }
.sw { width: 9pt; height: 9pt; border-radius: 2px; background: var(--c); }
.dot { width: 8pt; height: 8pt; border-radius: 50%; background: var(--c); }
.dia { width: 6pt; height: 6pt; background: #fff; border: 1.5px solid var(--c); transform: rotate(45deg); }
.rules { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin: 10pt 0; }
.rulecard { border: 1px solid #e0e3eb; border-radius: 8px; padding: 9pt 11pt; break-inside: avoid; }
.rulecard b { display: block; font-size: 10.5pt; margin-bottom: 2pt; }
.rulecard .no { display: inline-block; width: 16pt; height: 16pt; line-height: 16pt; text-align: center; border-radius: 50%; background: #2962ff; color: #fff; font-size: 8.5pt; font-weight: 700; margin-right: 6pt; }
.rulecard p { margin: 0; color: ${C.ink2}; font-size: 9.5pt; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 6pt 0 4pt; }
.tile { border: 1px solid #e0e3eb; border-radius: 8px; padding: 7pt 9pt; }
.tl { font-size: 8.5pt; color: ${C.ink2}; }
.tv { font-size: 16pt; font-weight: 700; line-height: 1.3; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; }
.tb { font-size: 8.5pt; color: ${C.ink3}; }
.take { margin: 8pt 0 0; padding-left: 14pt; font-size: 9.5pt; }
.take li { margin-bottom: 2pt; }
table.t { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 6pt 0; }
table.t th { text-align: left; font-weight: 600; color: ${C.ink2}; border-bottom: 1px solid #c9ccd4; padding: 4pt 6pt; vertical-align: bottom; }
table.t td { border-bottom: 1px solid #eceef2; padding: 4pt 6pt; vertical-align: top; }
table.t .n { text-align: right; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; white-space: nowrap; }
table.t th.n { font-family: inherit; }
table.t.dense td { padding: 2.6pt 6pt; }
table.t.dense { margin: 3pt 0; }
table.t tr.sep td { border-top: 1.5px solid #c9ccd4; }
table.t tr.pick td { background: #f4f7ff; font-weight: 600; }
.foot { font-size: 8.5pt; color: ${C.ink3}; margin: 4pt 0 0; }
.flow { display: grid; gap: 6pt; margin: 8pt 0; }
.step { display: grid; grid-template-columns: 22pt 1fr 1fr; gap: 8pt; align-items: stretch; break-inside: avoid; }
.step .no { width: 20pt; height: 20pt; line-height: 20pt; text-align: center; border-radius: 50%; background: ${C.ink}; color: #fff; font-size: 9pt; font-weight: 700; margin-top: 6pt; }
.q, .a { border: 1px solid #e0e3eb; border-radius: 8px; padding: 7pt 10pt; font-size: 9.5pt; }
.q b { display: block; }
.a { background: #f6f8fb; }
.a .yes { font-weight: 700; color: #2962ff; margin-right: 4pt; }
.bars { display: grid; gap: 6pt; margin: 8pt 0; }
.bar-row { display: grid; grid-template-columns: 96pt 1fr 190pt; gap: 10pt; align-items: center; font-size: 9.5pt; }
.bar { display: flex; gap: 2px; height: 14pt; }
.seg { display: block; height: 100%; border-radius: 3px; }
.bar-v { color: ${C.ink2}; font-size: 9pt; }
.note { border-left: 3px solid #2962ff; background: #f4f7ff; padding: 7pt 11pt; font-size: 9.5pt; margin: 10pt 0; border-radius: 0 6px 6px 0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
`

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>현금 비중으로 사고파는 규칙</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>

<section class="page">
  <div class="kicker">운용 규칙, 2026.11.17 작성, 자료는 ${ymd(s14.dates.at(-1))}까지</div>
  <h1>현금 비중으로 사고파는 규칙</h1>
  <p class="lead">현금은 전체의 ${p0(RULE.target)}를 기준으로 둡니다. 현금 비중이 ${p0(RULE.upper)} 이상으로 늘면 사고, ${p0(RULE.lower)} 이하로 줄면 QQQ를 팝니다. 지금 들고 있는 현금 ${p0(RULE.startCash)}는 QQQ가 최고가에서 ${p0(-RULE.firstDd)} 내릴 때 ${p0(RULE.target)}로 줄입니다.</p>

  <h3>지금 비중과 기준 비중</h3>
  <div class="bars">
    <div class="bar-row"><div class="bar-l">지금</div>${mixBar(NOW)}<div class="bar-v">${mixText(NOW)}</div></div>
    <div class="bar-row"><div class="bar-l">기준 (처음 산 뒤)</div>${mixBar(BASELINE)}<div class="bar-v">${mixText(BASELINE)}</div></div>
  </div>
  ${legend([['sw', C.cash, '현금 (원화 현금, 단기 국채 ETF)'], ['sw', C.gold, '금'], ['sw', C.qqq, 'QQQ'], ['sw', C.btc, '암호화폐']])}

  <h3>현금 비중 눈금</h3>
  ${gauge()}

  <h3>규칙 여섯 가지</h3>
  <div class="rules">
    <div class="rulecard"><b><span class="no">1</span>처음 한 번</b><p>QQQ가 최고가에서 ${p0(-RULE.firstDd)} 넘게 내리면 현금을 ${p0(RULE.target)}까지 써서 삽니다. 이 규칙은 한 번만 씁니다.</p></div>
    <div class="rulecard"><b><span class="no">2</span>현금 상한 ${p0(RULE.upper)}</b><p>처음 한 번을 산 뒤에는 현금이 ${p0(RULE.upper)} 이상이 될 때마다 ${p0(RULE.target)}까지 써서 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">3</span>현금 하한 ${p0(RULE.lower)}</b><p>현금이 ${p0(RULE.lower)} 이하가 되면 QQQ를 팔아 ${p0(RULE.lowerTo)}까지 채웁니다. 한 달에 한 번 확인합니다.</p></div>
    <div class="rulecard"><b><span class="no">4</span>살 때의 순서</b><p>금과 암호화폐가 전체의 ${p0(RULE.fillTo)}보다 적으면 ${p0(RULE.fillTo)}까지 먼저 채웁니다. 남은 돈으로 QQQ를 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">5</span>새로 들어오는 돈</b><p>월급, 배당, 이자는 현금이 ${p0(RULE.target)}보다 적으면 현금에 둡니다. 아니면 기준 비중보다 모자란 자산을 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">6</span>금, 암호화폐 상한 ${p0(RULE.trimAt)}</b><p>금이나 암호화폐가 전체의 ${p0(RULE.trimAt)}를 넘으면 ${p0(RULE.trimTo)}로 줄입니다. 판 돈은 현금에 둡니다.</p></div>
  </div>
</section>

<section class="page">
  <div class="kicker">규칙 풀이</div>
  <h2>현금 비중은 다른 자산이 움직여서 바뀝니다</h2>
  <p class="sub">현금은 가만히 있어도, 나머지 자산이 내리면 현금 비중이 늘고, 오르면 줄어듭니다. 그래서 현금 비중만 보면 살 때와 팔 때를 알 수 있습니다.</p>
  ${amountBars()}
  ${legend([['sw', C.cash, '현금'], ['sw', C.qqq, '나머지 자산 (QQQ, 금, 암호화폐)']])}
  <ul class="take">
    <li>현금이 ${p0(RULE.upper)}가 되는 때는 전체 자산이 ${p0(TOTAL_FALL)} 줄었을 때입니다. 금과 암호화폐가 그대로라면 QQQ가 ${p0(qqqFallFor(0))} 내려야 하고, 암호화폐가 함께 60% 내리면 QQQ가 ${p0(qqqFallFor(0.6))} 내렸을 때입니다.</li>
    <li>현금이 ${p0(RULE.lower)}가 되는 때는 나머지 자산이 크게 오른 뒤입니다. 이때 파는 QQQ는 값이 오른 뒤에 파는 것입니다.</li>
    <li>새로 들어오는 돈을 현금에 채워 두면(5번 규칙) 현금이 ${p0(RULE.lower)}까지 줄어드는 일이 드뭅니다.</li>
  </ul>

  <h3>확인할 때의 순서</h3>
  <div class="flow">
    <div class="step"><div class="no">1</div><div class="q"><b>금이나 암호화폐가 전체의 ${p0(RULE.trimAt)}를 넘었나</b>둘을 따로 봅니다. 암호화폐는 비트코인, 이더리움, 관련 주식을 합칩니다.</div><div class="a"><span class="yes">넘었으면</span>${p0(RULE.trimTo)}로 줄이고 판 돈은 현금에 둡니다.</div></div>
    <div class="step"><div class="no">2</div><div class="q"><b>아직 한 번도 사지 않았고, QQQ가 최고가에서 ${p0(-RULE.firstDd)} 넘게 내렸나</b>지금은 아직 사지 않은 상태입니다.</div><div class="a"><span class="yes">그렇다면</span>현금을 ${p0(RULE.target)}까지 써서 삽니다. 그 뒤의 기준 비중은 ${mixText(BASELINE)}입니다.</div></div>
    <div class="step"><div class="no">3</div><div class="q"><b>현금이 ${p0(RULE.upper)} 이상인가</b>처음 한 번을 산 뒤부터 봅니다.</div><div class="a"><span class="yes">그렇다면</span>현금을 ${p0(RULE.target)}까지 써서 삽니다. 금과 암호화폐를 ${p0(RULE.fillTo)}까지 채우고 나머지로 QQQ를 삽니다.</div></div>
    <div class="step"><div class="no">4</div><div class="q"><b>현금이 ${p0(RULE.lower)} 이하인가</b>한 달에 한 번, 새로 들어온 돈을 넣는 날에 봅니다.</div><div class="a"><span class="yes">그렇다면</span>QQQ를 팔아 현금을 ${p0(RULE.lowerTo)}까지 채웁니다. 나머지 ${Math.round((RULE.target - RULE.lowerTo) * 100)}%p는 새로 들어오는 돈으로 채웁니다.</div></div>
    <div class="step"><div class="no">5</div><div class="q"><b>새로 들어온 돈이 있나</b>월급, 배당, 이자입니다.</div><div class="a"><span class="yes">있으면</span>현금이 ${p0(RULE.target)}보다 적으면 현금에 둡니다. 아니면 기준 비중보다 모자란 자산을 삽니다.</div></div>
  </div>
  <p class="foot">어디에도 해당하지 않으면 아무것도 하지 않습니다.</p>
</section>

${SCEN.map((s, i) => scenarioPage(s, i + 1)).join('\n')}
${recordsPage()}

<section class="page">
  <div class="kicker">비교</div>
  <h2>세 구간 한눈에 보기</h2>
  <p class="sub">칸마다 연수익률과 최대 낙폭입니다. 파란 줄이 규칙대로 한 경우입니다. 세 구간 모두 현금 ${p0(RULE.startCash)}로 시작합니다.</p>
  <table class="t"><thead><tr><th>방식</th>${SCEN.map((s) => `<th class="n" colspan="2">${s.title.replace(/ \(.*\)/, '')}</th>`).join('')}</tr></thead><tbody>
    ${cmpRow('그냥 둔 경우 (금, 암호화폐 상한만 적용)', 'hold')}
    ${cmpRow('규칙대로 한 경우', 'plan', 'pick')}
    ${cmpRow('현금 하한을 뺀 경우', 'nolower')}
    ${cmpRow('해마다 자산의 3%만큼 돈이 새로 들어오는 경우', 'c3')}
    ${cmpRow('해마다 자산의 6%만큼 돈이 새로 들어오는 경우', 'c6')}
    ${cmpRow(`규칙대로 한 경우, 매도 차익 세금 ${p0(RULE.taxRate)}`, 'tax', 'sep')}
    ${cmpRow(`그냥 둔 경우, 매도 차익 세금 ${p0(RULE.taxRate)}`, 'holdTax')}
  </tbody></table>

  <h3>산 횟수와 판 횟수, 가장 낮았던 현금 비중</h3>
  <table class="t"><thead><tr><th>방식</th>${SCEN.map((s) => `<th class="n">${s.title.replace(/ \(.*\)/, '').replace('년', '')} 산 / 판</th><th class="n">최저 현금</th>`).join('')}</tr></thead><tbody>
    ${cntRow('규칙대로 한 경우', 'plan', 'pick')}
    ${cntRow('현금 하한을 뺀 경우', 'nolower')}
    ${cntRow('새로 들어오는 돈 연 3%', 'c3')}
    ${cntRow('새로 들어오는 돈 연 6%', 'c6')}
  </tbody></table>
  <ul class="take">
    <li>2014년에 시작한 구간은 규칙을 따른 경우가 연 ${((s14.plan.cagr - s14.hold.cagr) * 100).toFixed(1)}%p 높았습니다. 차이는 대부분 ${ymK(s14.plan.firstBuy)}에 현금 ${p0(s14.plan.buys[0].from)}를 ${p0(s14.plan.buys[0].to)}로 줄여 산 데서 나왔습니다.</li>
    <li>2004년과 1999년에 시작한 구간은 규칙을 따르나 그냥 두나 수익률이 비슷했습니다. 세금을 넣으면 규칙을 따른 경우가 조금 낮습니다. 현금 ${p0(RULE.lower)}를 지키려고 QQQ를 ${s04.plan.sells.length}번, ${s99.plan.sells.length}번 팔았기 때문입니다.</li>
    <li>대신 위험이 다릅니다. 그냥 둔 경우는 QQQ가 전체의 ${p0(s04.hold.final.w.qqq)}까지 불어났습니다. 2004년 시작 구간에서 2022년 하락 때 낙폭은 규칙대로 한 경우 ${pct(dd22.plan)}, 그냥 둔 경우 ${pct(dd22.hold)}였습니다.</li>
    <li>현금 하한을 빼면 수익률은 높아지지만 현금이 ${p0(Math.min(s04.nolower.minCashAfter, s99.nolower.minCashAfter))}까지 줄었습니다. 그러면 현금이 다시 ${p0(RULE.upper)}가 될 일이 없어 2번 규칙을 쓸 일이 없어집니다.</li>
    <li>해마다 자산의 6%만큼 돈이 새로 들어오면 세 구간 모두 QQQ를 한 번도 팔지 않았습니다. 3%면 많아야 2번입니다.</li>
  </ul>

  <h3>규칙대로 하면 받아들여야 하는 것</h3>
  <table class="t"><tbody>
    <tr><td style="width:34%">깊지 않은 하락에는 사지 않습니다</td><td>2014년 시작 구간에서는 ${ymK(s14.plan.firstBuy)}에 처음 산 뒤 2020년과 2022년 하락에 사지 않았습니다. 현금이 ${p0(RULE.upper)}까지 늘지 않았기 때문입니다.</td></tr>
    <tr><td>긴 하락에서는 손실이 더 큽니다</td><td>닷컴 구간에서 QQQ가 최고가보다 ${s99.plan.buys.map((e) => p0(-e.qdd)).join(', ')} 낮을 때 샀고, 전체 낙폭은 ${pct(s99.plan.mdd)}였습니다. 사지 않았다면 ${pct(s99.hold.mdd)}였습니다.</td></tr>
    <tr><td>현금이 늘 20~40% 있습니다</td><td>오르는 장에서는 그만큼 덜 법니다. 세 구간의 평균 현금 비중은 ${SCEN.map((s) => p0(s.plan.avgCash)).join(', ')}였습니다.</td></tr>
  </tbody></table>
</section>

<section class="page">
  <div class="kicker">세금과 남은 결정</div>
  <h2>팔 때의 세금</h2>
  <p class="sub">규칙대로 하면 파는 경우는 3번(현금 하한)과 6번(금, 암호화폐 상한)뿐입니다. 아래는 일반 규정이고 세법은 자주 바뀝니다. 팔기 전에 확인해야 합니다.</p>
  <table class="t"><thead><tr><th style="width:30%">담은 곳</th><th>팔 때</th></tr></thead><tbody>
    <tr><td>미국 상장 ETF (QQQ, GLD 등)</td><td>차익의 22%를 냅니다. 한 해 250만 원까지는 공제합니다. 같은 해 해외 주식의 이익과 손실을 합쳐서 계산합니다.</td></tr>
    <tr><td>국내 상장 해외지수 ETF</td><td>차익의 15.4%를 냅니다. 이익과 손실을 합치지 않습니다. 금융소득이 한 해 2,000만 원을 넘으면 종합과세 대상입니다.</td></tr>
    <tr><td>암호화폐 (거래소 보유)</td><td>2027년 1월부터 과세할 예정입니다. 시행이 여러 번 미뤄졌으므로 확인해야 합니다.</td></tr>
    <tr><td>KRX 금현물</td><td>매매 차익에 세금이 없습니다.</td></tr>
    <tr><td>ISA, 연금 계좌</td><td>계좌 안에서 사고팔 때는 세금을 내지 않습니다.</td></tr>
  </tbody></table>
  <ul class="take">
    <li>3번 규칙으로 QQQ를 팔 때는 ISA나 연금 계좌에 든 것부터 팝니다.</li>
    <li>일반 계좌에서 팔 때는 12월과 1월로 나누면 250만 원 공제를 두 번 받습니다. 3번 규칙은 며칠 늦어도 위험이 커지지 않습니다.</li>
    <li>같은 해에 손실이 난 해외 종목이 있으면 함께 팔아 이익과 합칩니다.</li>
  </ul>

  <h2 style="margin-top:18pt">아직 정하지 않은 것</h2>
  <table class="t"><thead><tr><th style="width:24%">항목</th><th style="width:36%">지금</th><th>고를 수 있는 것</th></tr></thead><tbody>
    <tr><td>암호화폐 안의 구성</td><td>합계로만 봅니다. 계산에는 비트코인만 넣었습니다.</td><td>채울 때 비트코인만 사기 / 비트코인, 이더리움, 관련 주식의 비율 정하기</td></tr>
    <tr><td>1번과 2번을 확인하는 주기</td><td>계산은 매일 종가로 보고 다음 거래일에 샀습니다.</td><td>매일 보기 / 주 1회 정한 요일에 보기</td></tr>
    <tr><td>새로 들어온 돈을 나누는 방법</td><td>기준 비중보다 가장 모자란 자산 하나를 삽니다.</td><td>그대로 두기 / 모자란 만큼 비례해서 나누기</td></tr>
    <tr><td>생활에 돈이 필요할 때</td><td>정하지 않았습니다.</td><td>현금에서 꺼내고 3번 규칙에 맡기기 / 기준 비중보다 넘치는 자산부터 팔기</td></tr>
    <tr><td>QQQ 최고가의 기준</td><td>1번 규칙에만 씁니다. 역대 최고 종가(달러)입니다.</td><td>증권사 화면의 시세로 보기 / 배당을 넣은 수정주가로 보기</td></tr>
  </tbody></table>
  <p class="foot">계산 방법: 일별 수정주가(배당 재투자 가정)를 썼고, 현금에는 미국 3개월 국채 금리로 이자를 붙였습니다. 그날 종가로 판단하고 다음 거래일 종가에 사고팔았습니다. 현금 하한은 매달 첫 거래일에만 확인했습니다. QQQ 최고가는 각 구간을 시작한 뒤의 최고 종가입니다. 금은 GLD, 비트코인은 BTC-USD입니다. 돈이 새로 들어오는 경우의 수익률은 그 돈이 들어온 효과를 뺀 값입니다. 생성: scripts/reserve/build-report.mjs</p>
</section>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'reserve-plan.html'), html)
for (const s of SCEN) console.log(`${s.title}: 규칙 ${pct(s.plan.cagr)} / ${pct(s.plan.mdd)}, 투입 없음 ${pct(s.hold.cagr)} / ${pct(s.hold.mdd)}, 산 횟수 ${s.plan.buys.length}, 판 횟수 ${s.plan.sells.length}, 세금 반영 ${pct(s.tax.cagr)} (투입 없음 ${pct(s.holdTax.cagr)})`)

const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(OUT, 'reserve-plan.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const fontOk = await page.evaluate(() => document.fonts.check('12px "IBM Plex Sans KR"', '한글'))
await page.pdf({ path: path.join(OUT, 'reserve-plan.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`PDF 저장: ${path.join(OUT, 'reserve-plan.pdf')} (한글 글꼴 ${fontOk ? '적용' : '미적용'})`)
