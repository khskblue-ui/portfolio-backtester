// 예비 현금 단계 투입 규칙(확정본) — 규칙 도해와 과거 데이터 점검 보고서 (HTML → PDF)
// 사용: node scripts/reserve/build-report.mjs   → docs/research/reserve-plan/reserve-plan.html · .pdf
// 자료: data-src/reserve/*.csv (야후 수정주가 일별 스냅숏, 2026-10-30까지). 달러 기준(환율 제외). 세금은 비교표의 '세금 반영' 줄에만 넣는다.
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
  dd: [-0.2, -0.3, -0.4], // QQQ가 최고가에서 내린 폭 문턱(1·2·3단계)
  floor: 0.1, // 어떤 경우에도 남기는 현금
  fillTo: 0.1, // 살 때 금·암호화폐를 채우는 비중
  trimAt: 0.2, trimTo: 0.1, // 금·암호화폐 상한과 줄인 뒤 비중
  qCapOver: 0.1, // QQQ 상한 = 세 단계를 다 쓴 뒤의 QQQ 비중 + 10%p (넘으면 그 비중으로 줄인다)
  taxRate: 0.22, // 세금 반영 계산에 쓰는 매도 차익 세율
}
/** 현금 c0에서 시작해 하한까지 세 번에 나눠 쓰는 단계별 현금 목표 (40% → 30 / 20 / 10%) */
const stageCash = (c0) => [1, 2, 3].map((k) => c0 - ((c0 - RULE.floor) * k) / 3)
/** 세 단계를 다 쓴 뒤의 QQQ 비중 (4자산이면 70%) */
const fullQ = (base) => 1 - RULE.floor - Object.keys(base).filter((k) => k !== 'qqq' && k !== 'cash').length * RULE.fillTo
const ALT = { shallow: [-0.15, -0.25, -0.35], deep: [-0.25, -0.35, -0.45], pf: [-0.15, -0.25, -0.35] }

/**
 * opt: { buy(단계 투입 여부), dd(문턱), signal('qqq' | 'pf' 전체 자산), cap(QQQ 상한 적용), tax(매도 차익 세율) }
 * 금·암호화폐 상한은 항상 적용. 새 돈(적립)은 없다. 결정은 그날 종가, 체결은 다음 거래일 종가.
 * 낙폭의 기준 최고가는 계산 시작일 뒤의 최고 종가다.
 */
function sim(dates, assets, base, opt = {}) {
  const o = { buy: true, dd: RULE.dd, signal: 'qqq', cap: true, tax: 0, ...opt }
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => { // 평균 단가 기준 차익에 과세(공제·손익 합산 없음)
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const lvCash = stageCash(base.cash), capTo = fullQ(base), capAt = capTo + RULE.qCapOver, hasCap = o.cap && capAt < 0.999
  let peakV = 100, peakQ = QQQ.get(dates[0]), irx = 0
  let struct = base.cash, epLevel = 0, x0 = null // struct: 내려가기만 하는 현금 목표, x0: 이번 하락이 시작될 때 목표보다 많던 현금
  let pendBuy = null, pendTrim = [], pendQ = false
  const series = [{ d: dates[0], V: 100, dd: 0, qdd: 0, cashT: struct, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d), s = cur - RULE.trimTo * T
      if (s > 0) { sell(a, s, d); events.push({ d, type: 'trim', key, from: cur / T, pct: s / T }) }
    }
    pendTrim = []
    if (pendQ) {
      const T = total(d), cur = hold.qqq * px(qA, d), s = cur - capTo * T
      if (s > 0) {
        const before = cash
        sell(qA, s, d)
        let left = cash - before
        const fills = {}
        for (const a of others) { const need = RULE.fillTo * total(d) - hold[a.key] * px(a, d), amt = Math.min(Math.max(0, need), left); if (amt > 0.002 * T) { buyA(a, amt, d); left -= amt; fills[a.key] = amt / T } }
        events.push({ d, type: 'qtrim', from: cur / T, pct: s / T, fills })
      }
      pendQ = false
    }
    if (pendBuy != null) {
      const T = total(d), buy = cash - pendBuy * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k))
        assets.forEach((a, j) => buyA(a, parts[j], d))
        events.push({ d, type: 'buy', pct: buy / T, cashT: struct, qdd: QQQ.get(d) / peakQ - 1, vdd: T / peakV - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      }
      pendBuy = null
    }
    const V = total(d), q = QQQ.get(d)
    if (q > peakQ) { peakQ = q; if (o.signal === 'qqq') { epLevel = 0; x0 = null } }
    if (V > peakV) { peakV = V; if (o.signal === 'pf') { epLevel = 0; x0 = null } }
    const dd = V / peakV - 1, qdd = q / peakQ - 1, sig = o.signal === 'pf' ? dd : qdd
    if (o.buy) {
      let lv = 0
      while (lv < o.dd.length && sig <= o.dd[lv]) lv++
      if (lv > epLevel) {
        if (x0 == null) x0 = Math.max(0, cash / V - struct)
        epLevel = lv
        struct = Math.min(struct, lvCash[lv - 1]) // 현금 목표는 내려가기만 한다
        pendBuy = struct + x0 * (1 - lv / 3) // 목표보다 많던 현금은 문턱마다 3분의 1씩
      }
    }
    for (const a of others) if ((hold[a.key] * px(a, d)) / V >= RULE.trimAt) pendTrim.push(a.key)
    if (hasCap && (hold.qqq * q) / V >= capAt) pendQ = true
    series.push({ d, V, dd, qdd, cashT: struct, w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / V])), cash: cash / V } })
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  for (const s of series) { if (s.V > pk) { pk = s.V; pkDay = s.d } if (s.V / pk - 1 < mdd) { mdd = s.V / pk - 1; mddDay = s.d; mddPeak = pkDay } }
  const rec = series.find((s) => s.d > mddDay && s.V >= series.find((x) => x.d === mddPeak).V)?.d ?? null
  const buys = events.filter((e) => e.type === 'buy')
  return { series, events, cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, mddDay, mddPeak, rec, final: last, firstBuy: buys[0]?.d ?? null, yrs, taxPaid, stages: lvCash.filter((c) => struct <= c + 1e-9).length, lvCash, capAt: hasCap ? capAt : null, capTo, minQdd: Math.min(...series.map((s) => s.qdd)) }
}

const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
const SCEN = [
  { id: 's2014', title: '2014~2026년', sub: 'QQQ 40 · 금 10 · 비트코인 10 · 현금 40으로 시작', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, note: '지금 구성과 같은 비중입니다. 비트코인 자료가 2014년 9월부터라 이때 시작합니다.' },
  { id: 's2004', title: '2004~2026년 (2008년 포함)', sub: 'QQQ 45 · 금 10 · 현금 45로 시작', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.45, gold: 0.1, cash: 0.45 }, note: '비트코인이 없던 시기라 그 몫을 QQQ와 현금에 나눴습니다. 금 ETF(GLD) 상장일부터입니다.' },
  { id: 's1999', title: '1999~2026년 (닷컴 버블 포함)', sub: 'QQQ 50 · 현금 50으로 시작', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.5, cash: 0.5 }, note: '금 ETF도 없던 시기라 QQQ와 현금만 둡니다. 가장 나쁜 경우를 보려는 구간입니다.' },
]
for (const s of SCEN) {
  s.dates = [...QQQ.keys()].sort().filter((d) => d >= s.start && s.assets.every((a) => a.px.has(d)))
  const run = (opt) => sim(s.dates, s.assets, s.base, opt)
  s.plan = run({})
  s.hold = run({ buy: false })
  s.shallow = run({ dd: ALT.shallow })
  s.deep = run({ dd: ALT.deep })
  s.pf = run({ signal: 'pf', dd: ALT.pf })
  s.nocap = run({ cap: false })
  s.tax = run({ tax: RULE.taxRate })
  s.holdTax = run({ buy: false, tax: RULE.taxRate })
}

// ── 표기 ────────────────────────────────────────────────────────────────────
const pct = (x, d = 1) => `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`
const p0 = (x) => pct(x, 0)
const ym = (d) => `${d.slice(0, 4)}.${d.slice(5, 7)}`
const ymd = (d) => d.replaceAll('-', '.')
const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25
const C = { cash: '#1baf7a', gold: '#eda100', qqq: '#2a78d6', btc: '#eb6834', plan: '#2a78d6', base: '#8a8984', ink: '#0b0b0b', ink2: '#52514e', ink3: '#8a8984', grid: '#e6e5e1', surface: '#ffffff' }
const NAME = { cash: '현금', gold: '금', qqq: 'QQQ', btc: '비트코인' }
const STACK = ['cash', 'gold', 'qqq', 'btc'] // 색 인접 검사를 통과한 순서(aqua·yellow·blue·orange)

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
    <text x="${xe + 9}" y="${(yb + 3.5).toFixed(1)}" class="lbl2">투입 없음 ${Math.round(endB).toLocaleString('en-US')}</text>
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

function ddChart(s) {
  const H = 152, T = 10, B = 26, x = xScale(s.dates)
  const buys = s.plan.events.filter((e) => e.type === 'buy'), keep = new Set(buys.map((e) => e.d))
  const a = sample(s.plan.series, keep)
  const lo = Math.min(-0.5, Math.floor((s.plan.minQdd - 0.02) * 10) / 10)
  const y = (v) => T + (v / lo) * (H - T - B)
  const ticks = []; for (let v = 0; v >= lo - 1e-9; v -= lo < -0.6 ? 0.2 : 0.1) ticks.push(v)
  const line = pathOf(a.map((p) => [x(p.d), y(p.qdd)]))
  const byDay = new Map(s.plan.series.map((p) => [p.d, p]))
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="QQQ 낙폭과 투입 시점">
    ${ticks.map((v) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <path d="${line}L${x(a.at(-1).d).toFixed(1)},${y(0)}L${x(a[0].d).toFixed(1)},${y(0)}Z" fill="${C.plan}" opacity="0.1"/>
    <path d="${line}" fill="none" stroke="${C.plan}" stroke-width="1.5" stroke-linejoin="round"/>
    ${RULE.dd.map((t, k) => `<line x1="${ML}" x2="${W - MR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${C.ink2}" stroke-width="1"/><text x="${W - MR + 6}" y="${(y(t) + 3.5).toFixed(1)}" class="lbl2">${k + 1}단계 ${p0(t)}</text>`).join('')}
    ${buys.map((e) => { const p = byDay.get(e.d); return `<circle cx="${x(e.d).toFixed(1)}" cy="${y(p.qdd).toFixed(1)}" r="4.5" fill="${C.ink}" stroke="#fff" stroke-width="2"/>` }).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

function weightChart(s) {
  const H = 172, T = 16, B = 26, x = xScale(s.dates)
  const trims = s.plan.events.filter((e) => e.type !== 'buy'), keep = new Set(s.plan.events.map((e) => e.d))
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
    <path d="${pathOf(a.flatMap((p, i) => (i && a[i - 1].cashT !== p.cashT ? [[x(p.d), y(a[i - 1].cashT)], [x(p.d), y(p.cashT)]] : [[x(p.d), y(p.cashT)]])))}" fill="none" stroke="${C.ink}" stroke-width="1.5"/>
    ${trims.map((e) => `<path d="M${x(e.d).toFixed(1)},${T - 11}l5,5l-5,5l-5,-5z" fill="${C.ink}" stroke="#fff" stroke-width="1.5"/>`).join('')}
    ${labels.map((l) => `<text x="${W - MR + 6}" y="${(y(l.mid) + 3.5).toFixed(1)}" class="lbl2">${NAME[l.k]} ${p0(l.v)}</text>`).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

const legend = (items) => `<div class="legend">${items.map(([kind, color, label]) => `<span class="lg"><span class="${kind}" style="--c:${color}"></span>${label}</span>`).join('')}</div>`

// ── 본문 조각 ───────────────────────────────────────────────────────────────
/** 본문에 적은 서술이 계산 결과와 어긋나면 만들지 않는다 */
const check = (cond, msg) => { if (!cond) throw new Error(`본문 서술과 계산이 어긋남: ${msg}`) }
const tiles = (s) => {
  const t = (label, a, b) => `<div class="tile"><div class="tl">${label}</div><div class="tv">${a}</div><div class="tb">투입 없음 ${b}</div></div>`
  return `<div class="tiles">
    ${t('연수익률', pct(s.plan.cagr), pct(s.hold.cagr))}
    ${t('최대 낙폭', pct(s.plan.mdd), pct(s.hold.mdd))}
    ${t('마지막 현금 비중', p0(s.plan.final.w.cash), p0(s.hold.final.w.cash))}
    ${t('마지막 QQQ 비중', p0(s.plan.final.w.qqq), p0(s.hold.final.w.qqq))}
  </div>`
}
const partsText = (s, parts) => s.assets.filter((a) => Math.round((parts[a.key] ?? 0) * 100) >= 1).map((a) => `${a.name} ${p0(parts[a.key])}`).join(' · ')
const eventTable = (s) => {
  const rows = s.plan.events.map((e) => {
    if (e.type === 'buy') return `<tr><td>${ymd(e.d)}</td><td>투입</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.qdd)}</td><td class="n">${p0(e.vdd)}</td><td>${partsText(s, e.parts)} → 현금 목표 ${p0(e.cashT)}</td></tr>`
    if (e.type === 'qtrim') return `<tr><td>${ymd(e.d)}</td><td>줄이기</td><td class="n">${p0(e.pct)}</td><td class="n"></td><td class="n"></td><td>QQQ ${p0(e.from)} → ${p0(s.plan.capTo)}, ${Object.keys(e.fills).length ? `${partsText(s, e.fills)} 채우고 나머지는 현금으로` : '판 돈은 현금으로'}</td></tr>`
    return `<tr><td>${ymd(e.d)}</td><td>줄이기</td><td class="n">${p0(e.pct)}</td><td class="n"></td><td class="n"></td><td>${NAME[e.key]} ${p0(e.from)} → ${p0(RULE.trimTo)}, 판 돈은 현금으로</td></tr>`
  })
  return `<table class="t dense"><thead><tr><th style="width:13%">날짜</th><th style="width:9%">한 일</th><th class="n" style="width:14%">크기 (전체 대비)</th><th class="n" style="width:11%">QQQ 낙폭</th><th class="n" style="width:11%">전체 낙폭</th><th>내용</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6">발동 없음</td></tr>'}</tbody></table>`
}
/** 투입을 '현금 목표를 낮춘 것'과 '목표보다 많던 현금을 다시 넣은 것'으로 나눈다 */
const splitBuys = (s) => {
  let prev = s.base.cash, stage = 0, extra = 0
  for (const e of s.plan.events) if (e.type === 'buy') { if (e.cashT < prev - 1e-9) { stage++; prev = e.cashT } else extra++ }
  return { stage, extra }
}
const takeaways = (s) => {
  const buys = s.plan.events.filter((e) => e.type === 'buy'), { stage, extra } = splitBuys(s)
  const trimCount = {}
  for (const e of s.plan.events) if (e.type !== 'buy') { const k = e.type === 'qtrim' ? 'qqq' : e.key; trimCount[k] = (trimCount[k] ?? 0) + 1 }
  const out = [
    `투입은 ${buys.length}번입니다. 첫 투입은 ${ym(s.plan.firstBuy)}로, 시작한 뒤 ${yearsBetween(s.dates[0], s.plan.firstBuy).toFixed(1)}년 만입니다.${extra ? ` ${stage}번은 현금 목표를 낮춘 투입이고, ${extra}번은 목표보다 많아진 현금(상한으로 판 돈, 이자)을 다시 넣은 것입니다.` : ''}`,
    s.plan.stages === 3 ? `세 단계를 모두 썼습니다. 현금 목표는 ${p0(s.plan.final.cashT)}입니다.` : `세 단계 가운데 ${s.plan.stages}단계까지 썼습니다. 현금 목표는 ${p0(s.plan.final.cashT)}입니다.`,
    Object.keys(trimCount).length ? `상한에 닿아 줄인 것은 ${Object.entries(trimCount).map(([k, n]) => `${NAME[k]} ${n}번`).join(', ')}입니다.` : '상한에 닿아 줄인 적은 없습니다.',
  ]
  if (s.id === 's1999') out.push(`세 단계를 다 쓴 뒤에도 하락이 이어져 전체가 ${pct(s.plan.mdd)}까지 빠졌습니다(${ymd(s.plan.mddDay)}). 고점 회복은 ${s.plan.rec ? ymd(s.plan.rec) : '기간 안에 못 함'}입니다.`)
  return out
}
const scenNote = (s) => `현금 목표는 ${s.plan.lvCash.map(p0).join(' / ')}로 내려갑니다. ${s.plan.capAt ? `QQQ 상한은 ${p0(s.plan.capAt)}입니다.` : 'QQQ와 현금뿐이라 QQQ 상한은 두지 않았습니다.'}`
const scenarioPage = (s, n) => `<section class="page">
  <div class="kicker">과거 데이터 ${n}</div>
  <h2>${s.title}</h2>
  <p class="sub">${s.sub}. ${s.note} ${scenNote(s)}</p>
  ${tiles(s)}
  <h3>자산 가치 <span class="hint">시작 = 100, 세로축은 로그 눈금</span></h3>
  ${legend([['ln', C.plan, '규칙대로'], ['ln', C.base, '투입 없음 (상한 규칙만 적용)']])}
  ${valueChart(s)}
  <h3>QQQ 낙폭과 투입 시점 <span class="hint">계산을 시작한 뒤의 최고가 대비</span></h3>
  ${legend([['dot', C.ink, '투입한 날'], ['rule', C.ink2, '단계 문턱']])}
  ${ddChart(s)}
  <h3>비중 변화</h3>
  ${legend([...STACK.filter((k) => k in s.base).map((k) => ['sw', C[k], NAME[k]]), ['rule', C.ink, '현금 목표'], ...(s.plan.events.some((e) => e.type !== 'buy') ? [['dia', C.ink, '상한에 닿아 줄인 날']] : [])])}
  ${weightChart(s)}
  <ul class="take">${takeaways(s).map((t) => `<li>${t}</li>`).join('')}</ul>
</section>`
const recordsPage = () => `<section class="page">
  <div class="kicker">기록</div>
  <h2>투입과 줄이기 기록</h2>
  <p class="sub">세 구간에서 규칙이 실제로 움직인 날입니다. 크기는 그날 전체 평가액 대비 비율입니다.</p>
  ${SCEN.map((s) => `<h3>${s.title} <span class="hint">${s.sub}</span></h3>${eventTable(s)}`).join('')}
  <p class="foot">낙폭과 비중은 체결한 날 종가 기준이라, 신호가 난 전날 값과 조금 다를 수 있습니다. 전날 문턱을 넘은 낙폭이 체결일 반등으로 얕게 적히는 경우입니다. 현금 목표가 그대로인 투입은 목표보다 많아진 현금을 3분의 1씩 넣은 것입니다(7번 규칙).</p>
</section>`

const BASE = SCEN[0].base, LV = stageCash(BASE.cash), FULLQ = fullQ(BASE), CAP_AT = FULLQ + RULE.qCapOver
/** 단계 k를 지난 뒤의 기준 비중 (현금이 준 만큼 QQQ가 는다) */
const stageMix = (k) => ({ cash: k ? LV[k - 1] : BASE.cash, gold: BASE.gold, qqq: BASE.qqq + (BASE.cash - (k ? LV[k - 1] : BASE.cash)), btc: BASE.btc })
const mixText = (m) => `QQQ ${Math.round(m.qqq * 100)} · 암호화폐 ${Math.round(m.btc * 100)} · 금 ${Math.round(m.gold * 100)} · 현금 ${Math.round(m.cash * 100)}`
const stepDiagram = () => {
  const Wd = 688, H = 230, L = 60, R = 30, T = 20, B = 44, X1 = RULE.dd.at(-1) - 0.1
  const x = (dd) => L + (dd / X1) * (Wd - L - R), y = (c) => T + (1 - c / 0.45) * (H - T - B)
  const pts = [[0, BASE.cash], ...RULE.dd.flatMap((d, k) => [[d, k ? LV[k - 1] : BASE.cash], [d, LV[k]]]), [X1, LV.at(-1)]]
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="QQQ 낙폭에 따른 현금 목표">
    <rect x="${x(0)}" y="${y(RULE.floor)}" width="${x(X1) - x(0)}" height="${y(0) - y(RULE.floor)}" fill="${C.cash}" opacity="0.14"/>
    <text x="${x(-0.02)}" y="${y(RULE.floor / 2) + 4}" class="lbl2">하한 ${p0(RULE.floor)}: 어떤 경우에도 쓰지 않는 돈</text>
    ${[0, 0.1, 0.2, 0.3, 0.4].map((c) => `<line x1="${L}" x2="${Wd - R}" y1="${y(c)}" y2="${y(c)}" stroke="${C.grid}"/><text x="${L - 8}" y="${y(c) + 4}" text-anchor="end" class="tick">${p0(c)}</text>`).join('')}
    ${[0, ...RULE.dd, X1].map((d) => `<line x1="${x(d)}" x2="${x(d)}" y1="${y(0)}" y2="${y(0) + 5}" stroke="${C.ink3}"/><text x="${x(d)}" y="${y(0) + 18}" text-anchor="middle" class="tick">${d === 0 ? '최고가' : p0(d)}</text>`).join('')}
    <path d="${pathOf(pts.map(([d, c]) => [x(d), y(c)]))}" fill="none" stroke="${C.cash}" stroke-width="3" stroke-linejoin="round"/>
    ${RULE.dd.map((d, k) => `<circle cx="${x(d)}" cy="${y(LV[k])}" r="5" fill="${C.ink}" stroke="#fff" stroke-width="2"/><text x="${x(d) + 10}" y="${y(LV[k]) - 8}" class="lbl">${k + 1}단계: 현금 ${p0(LV[k])}로</text>`).join('')}
    <text x="${x(-0.01)}" y="${y(BASE.cash) - 8}" class="lbl">평상시: 현금 ${p0(BASE.cash)}</text>
    <text x="${(L + Wd - R) / 2}" y="${H - 6}" text-anchor="middle" class="axis">QQQ가 최고가에서 내린 폭 (달러 시세)</text>
    <text x="14" y="${(T + H - B) / 2}" text-anchor="middle" class="axis" transform="rotate(-90 14 ${(T + H - B) / 2})">현금 목표</text>
  </svg>`
}
const mixBar = (m) => `<div class="bar">${STACK.map((k) => `<span class="seg" style="width:${m[k] * 100}%;background:${C[k]}"></span>`).join('')}</div>`
const cashBars = () => {
  const rows = [['평상시', 0], ...RULE.dd.map((d, k) => [`${k + 1}단계 뒤 (${p0(d)} 이하)`, k + 1])]
  return `<div class="bars">${rows.map(([label, k]) => `<div class="bar-row"><div class="bar-l">${label}</div>${mixBar(stageMix(k))}<div class="bar-v">${mixText(stageMix(k))}</div></div>`).join('')}</div>`
}

const cmpRow = (label, key, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${SCEN.map((s) => `<td class="n">${pct(s[key].cagr)}</td><td class="n">${pct(s[key].mdd)}</td>`).join('')}</tr>`
const ddLabel = (dd) => dd.map(p0).join(' / ')
const s14 = SCEN[0], s04 = SCEN[1], s99 = SCEN[2]
const btcRefill = s14.plan.events.filter((e) => e.type === 'buy').reduce((m, e) => (e.parts.btc > (m?.parts.btc ?? 0) ? e : m), null)
const qtrims04 = s04.plan.events.filter((e) => e.type === 'qtrim')
const buys04late = s04.plan.events.filter((e) => e.type === 'buy' && e.d >= '2020-01-01').reduce((x, e) => x + e.pct, 0)
// 비교 장의 서술을 계산이 뒷받침하는지 확인
for (const s of SCEN) {
  check(s.plan.cagr > s.hold.cagr && s.plan.mdd < s.hold.mdd, `${s.id}: 투입이 수익률은 높고 낙폭은 깊다`)
  check(s.tax.cagr > s.holdTax.cagr, `${s.id}: 세금을 넣어도 순서 유지`)
}
check(s14.shallow.cagr > s14.plan.cagr && s14.plan.cagr > s14.deep.cagr, '2014~: 얕은 문턱이 높다')
check(s04.deep.cagr >= s04.plan.cagr && s99.deep.cagr >= s99.plan.cagr, '2004~·1999~: 깊은 문턱이 높거나 같다')
check(qtrims04.length > 0 && s14.plan.events.every((e) => e.type !== 'qtrim') && s04.nocap.cagr > s04.plan.cagr, 'QQQ 상한은 2004~ 구간에서만 발동, 수익률을 낮춤')
check(s14.plan.events.filter((e) => e.type !== 'buy').every((e) => e.key === 'btc'), '2014~: 매도는 비트코인 줄이기뿐')
check(s04.plan.stages === 3 && buys04late < 0.05, '2004~: 2008년에 세 단계를 다 써 이후 투입이 거의 없음')

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
.lbl2 { font-size: 9px; fill: ${C.ink2}; }
.axis { font-size: 9px; fill: ${C.ink2}; }
.legend { display: flex; flex-wrap: wrap; gap: 4pt 14pt; font-size: 8.5pt; color: ${C.ink2}; margin: 2pt 0 2pt; }
.lg { display: inline-flex; align-items: center; gap: 5pt; }
.ln { width: 16pt; height: 0; border-top: 2px solid var(--c); }
.rule { width: 16pt; height: 0; border-top: 1.5px solid var(--c); }
.sw { width: 9pt; height: 9pt; border-radius: 2px; background: var(--c); }
.dot { width: 8pt; height: 8pt; border-radius: 50%; background: var(--c); }
.dia { width: 7pt; height: 7pt; background: var(--c); transform: rotate(45deg); }
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
.bar-row { display: grid; grid-template-columns: 112pt 1fr 178pt; gap: 10pt; align-items: center; font-size: 9.5pt; }
.bar { display: flex; gap: 2px; height: 14pt; }
.seg { display: block; height: 100%; border-radius: 3px; }
.bar-v { color: ${C.ink2}; font-size: 9pt; }
.note { border-left: 3px solid #2962ff; background: #f4f7ff; padding: 7pt 11pt; font-size: 9.5pt; margin: 10pt 0; border-radius: 0 6px 6px 0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
`

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>예비 현금 단계 투입 규칙</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>

<section class="page">
  <div class="kicker">운용 규칙 확정본 · 2026.11.16 · ${ymd(s14.dates.at(-1))} 자료 기준</div>
  <h1>예비 현금 단계 투입 규칙</h1>
  <p class="lead">현금 ${p0(BASE.cash)}를 예비로 들고 있다가, QQQ가 깊게 빠질 때 세 번에 나눠 삽니다. 회복해도 현금을 되채우지 않습니다. 평소 비중은 새로 들어오는 돈으로 맞추고, 파는 것은 상한에 닿았을 때뿐입니다.</p>

  <h3>시작 비중</h3>
  <div class="bars"><div class="bar-row"><div class="bar-l">평상시</div>${mixBar(stageMix(0))}<div class="bar-v">${mixText(stageMix(0))}</div></div></div>
  ${legend([['sw', C.cash, '현금 (원화 현금, 단기 국채 ETF)'], ['sw', C.gold, '금'], ['sw', C.qqq, 'QQQ'], ['sw', C.btc, '암호화폐']])}

  <h3>규칙 여덟 가지</h3>
  <div class="rules">
    <div class="rulecard"><b><span class="no">1</span>사는 때</b><p>QQQ가 최고가에서 ${ddLabel(RULE.dd)} 이하로 내리면 현금 목표를 ${LV.map(p0).join(' / ')}로 낮추고 그만큼 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">2</span>사는 순서</b><p>암호화폐와 금이 전체의 ${p0(RULE.fillTo)}보다 적으면 ${p0(RULE.fillTo)}까지 먼저 채웁니다. 남은 돈은 모두 QQQ를 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">3</span>되돌리지 않습니다</b><p>회복해도 현금을 되채우지 않습니다. 단계를 지난 뒤의 비중이 새 기준입니다. 정기 리밸런싱은 하지 않습니다.</p></div>
    <div class="rulecard"><b><span class="no">4</span>평소에는 새 돈으로 맞춥니다</b><p>월급, 배당, 이자는 기준보다 모자란 자산에 넣습니다. 팔지 않고 비중을 맞추는 방법은 이것 하나입니다.</p></div>
    <div class="rulecard"><b><span class="no">5</span>금·암호화폐 상한 ${p0(RULE.trimAt)}</b><p>둘 중 하나가 전체의 ${p0(RULE.trimAt)}를 넘으면 한 번에 ${p0(RULE.trimTo)}로 줄입니다. 판 돈은 현금에 둡니다.</p></div>
    <div class="rulecard"><b><span class="no">6</span>QQQ 상한 ${p0(CAP_AT)}</b><p>QQQ가 전체의 ${p0(CAP_AT)}를 넘으면 ${p0(FULLQ)}로 줄입니다. 판 돈으로 금·암호화폐를 ${p0(RULE.fillTo)}까지 채우고 나머지는 현금에 둡니다.</p></div>
    <div class="rulecard"><b><span class="no">7</span>다시 생긴 현금</b><p>5번, 6번, 이자로 현금이 목표보다 많아졌으면, 다음 하락의 세 문턱에서 3분의 1씩 투입합니다.</p></div>
    <div class="rulecard"><b><span class="no">8</span>현금 ${p0(RULE.floor)}는 남깁니다</b><p>마지막 단계를 지나도 현금 ${p0(RULE.floor)}는 쓰지 않습니다. 생활에 필요한 돈이 생기면 여기서 먼저 꺼냅니다.</p></div>
  </div>

  <div class="note">과거 수치는 달러 기준 일별 자료로 계산했고, 따로 적지 않은 한 세금과 거래 비용은 넣지 않았습니다. 4번 규칙(새 돈)은 계산에 들어 있지 않습니다. QQQ가 최고가에서 ${p0(RULE.dd[0])} 넘게 빠진 사례가 많지 않아 앞으로의 결과를 보장하지 않습니다.</div>
</section>

<section class="page">
  <div class="kicker">규칙 도해</div>
  <h2>QQQ가 깊게 빠질수록 현금 목표가 계단처럼 내려갑니다</h2>
  <p class="sub">한 번 내려간 계단은 다시 올라가지 않습니다. 회복한 뒤 다음 하락이 와도, 이미 쓴 단계는 다시 발동하지 않습니다.</p>
  ${stepDiagram()}
  <h3>단계를 지난 뒤의 기준 비중</h3>
  ${cashBars()}
  ${legend([['sw', C.cash, '현금'], ['sw', C.gold, '금'], ['sw', C.qqq, 'QQQ'], ['sw', C.btc, '암호화폐']])}

  <h3>점검할 때의 판단 순서</h3>
  <div class="flow">
    <div class="step"><div class="no">1</div><div class="q"><b>금이나 암호화폐가 전체의 ${p0(RULE.trimAt)}를 넘었나</b>둘을 따로 봅니다. 암호화폐는 비트코인, 이더리움, 관련 주식을 합칩니다.</div><div class="a"><span class="yes">넘었으면</span>${p0(RULE.trimTo)}로 줄이고 판 돈은 현금에 둡니다.</div></div>
    <div class="step"><div class="no">2</div><div class="q"><b>QQQ가 전체의 ${p0(CAP_AT)}를 넘었나</b>세 단계를 다 쓴 뒤의 QQQ 비중(${p0(FULLQ)})보다 ${Math.round(RULE.qCapOver * 100)}%p 높은 선입니다.</div><div class="a"><span class="yes">넘었으면</span>${p0(FULLQ)}로 줄이고, 금·암호화폐를 ${p0(RULE.fillTo)}까지 채운 뒤 나머지는 현금에 둡니다.</div></div>
    <div class="step"><div class="no">3</div><div class="q"><b>QQQ가 최고가 대비 새 문턱 아래로 내려왔나</b>아직 쓰지 않은 단계이거나, 현금이 목표보다 많은 경우입니다.</div><div class="a"><span class="yes">그렇다면</span>현금 목표를 그 단계 값으로 낮추고 다음 거래일에 삽니다. 목표보다 많던 현금은 문턱마다 3분의 1씩 함께 넣습니다.</div></div>
    <div class="step"><div class="no">4</div><div class="q"><b>새 돈이 들어왔나</b>월급, 배당, 이자입니다.</div><div class="a"><span class="yes">들어왔으면</span>지금 기준 비중보다 모자란 자산에 넣습니다.</div></div>
    <div class="step"><div class="no">5</div><div class="q"><b>위 어디에도 해당하지 않는가</b></div><div class="a"><span class="yes">그렇다면</span>아무것도 하지 않습니다. 오른 자산을 팔지 않고, 빠진 자산을 따로 사지도 않습니다.</div></div>
  </div>
</section>

${SCEN.map((s, i) => scenarioPage(s, i + 1)).join('\n')}
${recordsPage()}

<section class="page">
  <div class="kicker">비교</div>
  <h2>세 구간 한눈에 보기</h2>
  <p class="sub">연수익률 / 최대 낙폭. 파란 줄이 이 문서의 규칙입니다.</p>
  <table class="t"><thead><tr><th>방식</th>${SCEN.map((s) => `<th class="n" colspan="2">${s.title.replace(/ \(.*\)/, '')}</th>`).join('')}</tr></thead><tbody>
    ${cmpRow('투입 없음 (상한 규칙만)', 'hold')}
    ${cmpRow(`QQQ ${ddLabel(ALT.shallow)}`, 'shallow')}
    ${cmpRow(`QQQ ${ddLabel(RULE.dd)} (이 문서)`, 'plan', 'pick')}
    ${cmpRow(`QQQ ${ddLabel(ALT.deep)}`, 'deep')}
    ${cmpRow(`전체 자산 기준 ${ddLabel(ALT.pf)}`, 'pf')}
    ${cmpRow('이 문서에서 QQQ 상한을 뺀 경우', 'nocap')}
    ${cmpRow(`이 문서, 매도 차익 세금 ${p0(RULE.taxRate)} 반영`, 'tax', 'sep')}
    ${cmpRow(`투입 없음, 매도 차익 세금 ${p0(RULE.taxRate)} 반영`, 'holdTax')}
  </tbody></table>
  <ul class="take">
    <li>세 구간 모두 투입하는 쪽이 연수익률이 높았고, 최대 낙폭은 더 깊었습니다.</li>
    <li>문턱의 깊이는 구간마다 순서가 달랐습니다. 2014년 시작 구간에서는 얕은 문턱이, 나머지 두 구간에서는 깊은 문턱이 조금 높았습니다. 문턱으로는 우열이 가려지지 않습니다.</li>
    <li>2014년 시작 구간의 차이에는 ${ym(btcRefill.d)}에 비트코인을 전체의 ${p0(btcRefill.parts.btc)}만큼 다시 채운 것이 들어 있습니다. 비트코인이 그 뒤 크게 올랐기 때문이라, 다음에도 같으리라 보기 어렵습니다.</li>
    <li>QQQ 상한은 2004년 시작 구간에서만 ${qtrims04.length}번 발동했습니다(${qtrims04.map((e) => ym(e.d)).join(', ')}). 연수익률이 ${pct(s04.nocap.cagr)}에서 ${pct(s04.plan.cagr)}로 낮아지는 대신 금 비중이 ${p0(s04.nocap.final.w.gold)}가 아닌 ${p0(s04.plan.final.w.gold)}로 유지됐습니다.</li>
    <li>세금을 넣어도 순서는 같습니다. 2014년 시작 구간에서 낸 세금은 모두 비트코인을 ${p0(RULE.trimAt)}에서 줄일 때 생겼습니다. 세금은 평균 단가 기준 차익에 ${p0(RULE.taxRate)}를 매겼고, 공제와 손익 합산은 넣지 않았습니다.</li>
  </ul>

  <h3>받아들인 것</h3>
  <table class="t"><tbody>
    <tr><td style="width:34%">현금이 줄어든 채로 다음 하락을 맞습니다</td><td>2004년 시작 구성은 2008년에 세 단계를 다 썼습니다. 2022년 하락 때 넣은 돈은 전체의 ${p0(buys04late)}뿐이었습니다. 새 돈(4번 규칙)이 없다면 이렇게 됩니다.</td></tr>
    <tr><td>긴 하락에서는 손실이 커집니다</td><td>닷컴 구간에서 ${ym(s99.plan.events.filter((e) => e.type === 'buy').at(-1).d)}까지 세 단계를 다 썼고, 전체 낙폭은 ${pct(s99.plan.mdd)}였습니다. 투입하지 않았다면 ${pct(s99.hold.mdd)}였습니다. 고점 회복은 ${s99.plan.rec ? ym(s99.plan.rec) : '기간 안에 못 함'}입니다.</td></tr>
    <tr><td>기다리는 동안 현금이 묶입니다</td><td>2014년 시작 구성은 첫 투입까지 ${yearsBetween(s14.dates[0], s14.plan.firstBuy).toFixed(1)}년이 걸렸습니다.</td></tr>
  </tbody></table>
</section>

<section class="page">
  <div class="kicker">세금과 남은 결정</div>
  <h2>팔 때의 세금</h2>
  <p class="sub">이 규칙에서 세금이 생기는 매도는 5번과 6번뿐입니다. 아래는 일반 규정이고 세법은 자주 바뀝니다. 실행 전에 확인이 필요합니다.</p>
  <table class="t"><thead><tr><th style="width:30%">담은 곳</th><th>팔 때</th></tr></thead><tbody>
    <tr><td>미국 상장 ETF (QQQ, GLD 등)</td><td>차익의 22%. 연 250만 원 공제. 같은 해 해외 주식의 이익과 손실을 합산합니다.</td></tr>
    <tr><td>국내 상장 해외지수 ETF</td><td>차익의 15.4%. 손익 합산이 없습니다. 금융소득이 연 2천만 원을 넘으면 종합과세 대상입니다.</td></tr>
    <tr><td>암호화폐 (거래소 보유)</td><td>2027년 1월부터 과세 예정입니다. 시행이 여러 번 미뤄졌으므로 확인이 필요합니다.</td></tr>
    <tr><td>KRX 금현물</td><td>매매 차익은 비과세입니다.</td></tr>
    <tr><td>ISA, 연금 계좌</td><td>계좌 안에서 사고파는 것은 그때 과세하지 않습니다.</td></tr>
  </tbody></table>
  <ul class="take">
    <li>같은 해에 손실이 난 해외 종목이 있으면 함께 팔아 차익과 합산합니다.</li>
    <li>큰 매도는 12월과 1월로 나누면 250만 원 공제를 두 번 씁니다. 다만 5번과 6번은 비중이 쏠린 상태를 푸는 규칙이라, 미루는 기간은 짧게 잡습니다.</li>
    <li>상한에 자주 닿는 자산(암호화폐)은 가능하면 세금이 덜한 곳에 둡니다.</li>
  </ul>

  <h2 style="margin-top:18pt">아직 정하지 않은 것</h2>
  <table class="t"><thead><tr><th style="width:22%">항목</th><th style="width:36%">지금</th><th>선택지</th></tr></thead><tbody>
    <tr><td>암호화폐 안의 구성</td><td>합계로만 봅니다. 계산은 비트코인만 넣었습니다.</td><td>채울 때 비트코인만 산다 / 비트코인, 이더리움, 관련 주식의 비율을 정한다</td></tr>
    <tr><td>점검 주기</td><td>계산은 매일 종가로 보고 다음 거래일에 체결했습니다.</td><td>매일 본다 / 주 1회 정한 요일에 본다</td></tr>
    <tr><td>새 돈을 나누는 방법</td><td>기준보다 모자란 자산에 넣습니다.</td><td>가장 모자란 자산 하나에 / 모자란 폭에 비례해서</td></tr>
    <tr><td>돈이 필요할 때</td><td>현금 하한(${p0(RULE.floor)})에서 먼저 꺼냅니다.</td><td>하한이 바닥나면 비중이 가장 큰 자산부터 / 기준보다 넘치는 자산부터</td></tr>
    <tr><td>최고가의 기준</td><td>QQQ의 역대 최고 종가(달러)입니다.</td><td>배당을 넣은 수정주가로 볼지, 화면에 보이는 시세로 볼지</td></tr>
  </tbody></table>
  <p class="foot">계산 방법: 일별 수정주가(배당 재투자 가정), 현금은 미국 3개월 국채 금리로 이자. 신호는 그날 종가, 체결은 다음 거래일 종가. 낙폭의 기준 최고가는 각 구간을 시작한 뒤의 최고 종가입니다. 금은 GLD, 비트코인은 BTC-USD를 썼습니다. 생성: scripts/reserve/build-report.mjs</p>
</section>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'reserve-plan.html'), html)
for (const s of SCEN) console.log(`${s.title}: 규칙 ${pct(s.plan.cagr)} / ${pct(s.plan.mdd)} · 투입 없음 ${pct(s.hold.cagr)} / ${pct(s.hold.mdd)} · 투입 ${s.plan.events.filter((e) => e.type === 'buy').length}회 · 줄이기 ${s.plan.events.filter((e) => e.type !== 'buy').length}회 · 세금 반영 ${pct(s.tax.cagr)} · 첫 투입 ${s.plan.firstBuy}`)

const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(OUT, 'reserve-plan.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const fontOk = await page.evaluate(() => document.fonts.check('12px "IBM Plex Sans KR"', '한글'))
await page.pdf({ path: path.join(OUT, 'reserve-plan.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`PDF 저장: ${path.join(OUT, 'reserve-plan.pdf')} (한글 글꼴 ${fontOk ? '적용' : '미적용'})`)
