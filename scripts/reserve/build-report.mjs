// 예비 현금 단계 투입 규칙 — 규칙 도해와 과거 데이터 점검 보고서 (HTML → PDF)
// 사용: node scripts/reserve/build-report.mjs   → docs/research/reserve-plan/reserve-plan.html · .pdf
// 자료: data-src/reserve/*.csv (야후 수정주가 일별 스냅숏, 2026-10-30까지). 달러 기준(환율 제외), 세금·거래 비용 미반영.
// 결정은 그날 종가, 체결은 다음 거래일 종가. 수치는 전부 이 스크립트의 계산 결과를 그대로 넣는다(손으로 적은 수치 없음).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'docs/research/reserve-plan')
const csv = (name) => new Map(fs.readFileSync(path.join(ROOT, 'data-src/reserve', `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')

// ── 규칙 (문서와 계산이 같은 값을 쓴다) ──────────────────────────────────────
const RULE = {
  levels: [[-0.15, 0.3], [-0.25, 0.2], [-0.35, 0.1]], // [전체 낙폭 문턱, 현금 목표]
  fillTo: 0.1, // 투입할 때 금·암호화폐를 채우는 비중
  trimAt: 0.2, trimTo: 0.1, // 금·암호화폐 상한과 줄인 뒤 비중
}
const ALT = {
  near: [[-0.15, 0.3], [-0.2, 0.2], [-0.25, 0.1]],
}

/** opt: { levels | null, minGap(일) } — 줄이기(상한)는 항상 적용 */
function sim(dates, assets, base, opt) {
  const px = (a, d) => a.px.get(d)
  const hold = Object.fromEntries(assets.map((a) => [a.key, (100 * base[a.key]) / px(a, dates[0])]))
  let cash = 100 * base.cash
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  let peakV = 100, peakQ = QQQ.get(dates[0]), irx = 0
  let cashTarget = base.cash, epLevel = 0, pendBuy = false, pendTrim = [], lastBuy = null
  const series = [{ d: dates[0], V: 100, dd: 0, qdd: 0, cashT: cashTarget, w: { ...Object.fromEntries(assets.map((a) => [a.key, base[a.key]])), cash: base.cash } }]
  const events = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) {
      const a = assets.find((x) => x.key === key), T = total(d), cur = hold[key] * px(a, d), sell = cur - RULE.trimTo * T
      if (sell > 0) { hold[key] -= sell / px(a, d); cash += sell; events.push({ d, type: 'trim', key, from: cur / T, pct: sell / T }) }
    }
    pendTrim = []
    if (pendBuy) {
      const T = total(d), buy = cash - cashTarget * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, RULE.fillTo * T - hold[a.key] * px(a, d))))
        const others = sf.reduce((x, y) => x + y, 0), k = others > buy ? buy / others : 1
        const parts = assets.map((a, j) => (a.key === 'qqq' ? buy - Math.min(others, buy) : sf[j] * k))
        assets.forEach((a, j) => { hold[a.key] += parts[j] / px(a, d) })
        cash -= buy
        events.push({ d, type: 'buy', pct: buy / T, cashT: cashTarget, qdd: QQQ.get(d) / peakQ - 1, vdd: T / peakV - 1, parts: Object.fromEntries(assets.map((a, j) => [a.key, parts[j] / T])) })
      }
      pendBuy = false
    }
    const V = total(d), q = QQQ.get(d)
    if (q > peakQ) peakQ = q
    if (V > peakV) { peakV = V; epLevel = 0 }
    const dd = V / peakV - 1
    if (opt.levels) {
      let lv = 0
      while (lv < opt.levels.length && dd <= opt.levels[lv][0]) lv++
      if (opt.minGap != null) {
        const used = opt.levels.filter(([, c]) => cashTarget <= c + 1e-9).length
        const gapOk = lastBuy == null || (Date.parse(d) - Date.parse(lastBuy)) / 864e5 >= opt.minGap
        if (lv > used && gapOk) { cashTarget = opt.levels[used][1]; pendBuy = true; lastBuy = d }
        else if (lv > epLevel && lv <= used && cash / V > cashTarget + 0.02 && gapOk) { epLevel = lv; pendBuy = true; lastBuy = d }
      } else if (lv > epLevel) {
        epLevel = lv
        cashTarget = Math.min(cashTarget, opt.levels[lv - 1][1]) // 현금 목표는 내려가기만 한다
        pendBuy = true // 목표보다 많은 현금(줄이기 대금·이자)도 이때 함께 나간다
      }
    }
    for (const a of assets) if (a.key !== 'qqq' && (hold[a.key] * px(a, d)) / V >= RULE.trimAt) pendTrim.push(a.key)
    series.push({ d, V, dd, qdd: q / peakQ - 1, cashT: cashTarget, w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / V])), cash: cash / V } })
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  const last = series.at(-1)
  let mdd = 0, mddDay = dates[0], pk = 100, pkDay = dates[0], mddPeak = dates[0]
  for (const s of series) { if (s.V > pk) { pk = s.V; pkDay = s.d } if (s.V / pk - 1 < mdd) { mdd = s.V / pk - 1; mddDay = s.d; mddPeak = pkDay } }
  const rec = series.find((s) => s.d > mddDay && s.V >= series.find((x) => x.d === mddPeak).V)?.d ?? null
  const buys = events.filter((e) => e.type === 'buy')
  return { series, events, cagr: (last.V / 100) ** (1 / yrs) - 1, mdd, mddDay, mddPeak, rec, final: last, avgCash: series.reduce((s, x) => s + x.w.cash, 0) / series.length, firstBuy: buys[0]?.d ?? null, yrs }
}

const A_QQQ = { key: 'qqq', name: 'QQQ', px: QQQ }, A_GOLD = { key: 'gold', name: '금', px: GLD }, A_BTC = { key: 'btc', name: '비트코인', px: BTC }
const SCEN = [
  { id: 's2014', title: '2014~2026년', sub: 'QQQ 40 · 금 10 · 비트코인 10 · 현금 40으로 시작', start: '2014-09-17', assets: [A_QQQ, A_GOLD, A_BTC], base: { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }, note: '지금 구성과 같은 비중입니다. 비트코인 자료가 2014년 9월부터라 이때 시작합니다.' },
  { id: 's2004', title: '2004~2026년 (2008년 포함)', sub: 'QQQ 45 · 금 10 · 현금 45로 시작', start: '2004-11-18', assets: [A_QQQ, A_GOLD], base: { qqq: 0.45, gold: 0.1, cash: 0.45 }, note: '비트코인이 없던 시기라 그 몫을 QQQ와 현금에 나눴습니다. 금 ETF(GLD) 상장일부터입니다.' },
  { id: 's1999', title: '1999~2026년 (닷컴 버블 포함)', sub: 'QQQ 50 · 현금 50으로 시작', start: '1999-03-10', assets: [A_QQQ], base: { qqq: 0.5, cash: 0.5 }, note: '금 ETF도 없던 시기라 QQQ와 현금만 둡니다. 가장 나쁜 경우를 보려는 구간입니다.' },
]
for (const s of SCEN) {
  s.dates = [...QQQ.keys()].sort().filter((d) => d >= s.start && s.assets.every((a) => a.px.has(d)))
  s.plan = sim(s.dates, s.assets, s.base, { levels: RULE.levels })
  s.hold = sim(s.dates, s.assets, s.base, { levels: null })
  s.near = sim(s.dates, s.assets, s.base, { levels: ALT.near })
  s.gap = sim(s.dates, s.assets, s.base, { levels: RULE.levels, minGap: 182 })
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
  const H = 190, T = 14, B = 26, x = xScale(s.dates), keep = new Set()
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
  const H = 170, T = 10, B = 26, x = xScale(s.dates)
  const buys = s.plan.events.filter((e) => e.type === 'buy'), keep = new Set(buys.map((e) => e.d))
  const a = sample(s.plan.series, keep)
  const lo = Math.min(-0.4, Math.floor((s.plan.mdd - 0.02) * 10) / 10)
  const y = (v) => T + (v / lo) * (H - T - B)
  const ticks = []; for (let v = 0; v >= lo - 1e-9; v -= lo < -0.5 ? 0.2 : 0.1) ticks.push(v)
  const line = pathOf(a.map((p) => [x(p.d), y(p.dd)]))
  const byDay = new Map(s.plan.series.map((p) => [p.d, p]))
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="전체 낙폭과 투입 시점">
    ${ticks.map((v) => `<line x1="${ML}" x2="${W - MR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/><text x="${ML - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${p0(v)}</text>`).join('')}
    <path d="${line}L${x(a.at(-1).d).toFixed(1)},${y(0)}L${x(a[0].d).toFixed(1)},${y(0)}Z" fill="${C.plan}" opacity="0.1"/>
    <path d="${line}" fill="none" stroke="${C.plan}" stroke-width="1.5" stroke-linejoin="round"/>
    ${RULE.levels.map(([t, c], k) => `<line x1="${ML}" x2="${W - MR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${C.ink2}" stroke-width="1"/><text x="${W - MR + 6}" y="${(y(t) + 3.5).toFixed(1)}" class="lbl2">${k + 1}단계 ${p0(t)}</text>`).join('')}
    ${buys.map((e) => { const p = byDay.get(e.d); return `<circle cx="${x(e.d).toFixed(1)}" cy="${y(p.dd).toFixed(1)}" r="4.5" fill="${C.ink}" stroke="#fff" stroke-width="2"/>` }).join('')}
    ${xAxis(s.dates, x, H - B)}
  </svg>`
}

function weightChart(s) {
  const H = 190, T = 16, B = 26, x = xScale(s.dates)
  const trims = s.plan.events.filter((e) => e.type === 'trim'), keep = new Set(s.plan.events.map((e) => e.d))
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
const tiles = (s) => {
  const t = (label, a, b) => `<div class="tile"><div class="tl">${label}</div><div class="tv">${a}</div><div class="tb">투입 없음 ${b}</div></div>`
  return `<div class="tiles">
    ${t('연수익률', pct(s.plan.cagr), pct(s.hold.cagr))}
    ${t('최대 낙폭', pct(s.plan.mdd), pct(s.hold.mdd))}
    ${t('마지막 현금 비중', p0(s.plan.final.w.cash), p0(s.hold.final.w.cash))}
    ${t('마지막 QQQ 비중', p0(s.plan.final.w.qqq), p0(s.hold.final.w.qqq))}
  </div>`
}
const eventTable = (s) => {
  const rows = s.plan.events.map((e) => e.type === 'buy'
    ? `<tr><td>${ymd(e.d)}</td><td>투입</td><td class="n">${p0(e.pct)}</td><td class="n">${p0(e.vdd)}</td><td class="n">${p0(e.qdd)}</td><td>${s.assets.filter((a) => e.parts[a.key] > 0.004).map((a) => `${a.name} ${p0(e.parts[a.key])}`).join(' · ')} → 현금 목표 ${p0(e.cashT)}</td></tr>`
    : `<tr><td>${ymd(e.d)}</td><td>줄이기</td><td class="n">${p0(e.pct)}</td><td class="n"></td><td class="n"></td><td>${NAME[e.key]} ${p0(e.from)} → ${p0(RULE.trimTo)}, 판 돈은 현금으로</td></tr>`)
  return `<table class="t"><thead><tr><th style="width:13%">날짜</th><th style="width:9%">한 일</th><th class="n" style="width:14%">크기 (전체 대비)</th><th class="n" style="width:11%">전체 낙폭</th><th class="n" style="width:11%">QQQ 낙폭</th><th>내용</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6">발동 없음</td></tr>'}</tbody></table>`
}
const takeaways = {
  s2014: (s) => [
    `첫 투입이 ${ym(s.plan.firstBuy)}입니다. 시작한 뒤 ${yearsBetween(s.dates[0], s.plan.firstBuy).toFixed(1)}년 동안 한 번도 발동하지 않았습니다.`,
    `비트코인을 ${s.plan.events.filter((e) => e.type === 'trim').length}번 줄였고, 그 돈이 현금으로 돌아와 다음 투입의 재원이 됐습니다.`,
    `세 단계 가운데 ${RULE.levels.filter(([, c]) => s.plan.final.cashT <= c + 1e-9).length}단계까지 썼습니다. 마지막 현금 목표는 ${p0(s.plan.final.cashT)}입니다.`,
  ],
  s2004: (s) => {
    const b = s.plan.events.filter((e) => e.type === 'buy')
    return [
      `${b.length}번의 투입이 ${ymd(b[0].d)}부터 ${ymd(b.at(-1).d)} 사이에 일어났습니다.`,
      `그 뒤로 현금을 채우지 않아, QQQ가 전체의 ${p0(s.plan.final.w.qqq)}가 됐습니다. 연수익률의 대부분은 이 QQQ 비중에서 나왔습니다.`,
      `금은 ${p0(s.base.gold)}에서 ${p0(s.plan.final.w.gold)}로 줄었습니다. 투입할 때만 채우기 때문입니다.`,
    ]
  },
  s1999: (s) => {
    const b = s.plan.events.filter((e) => e.type === 'buy')
    return [
      `${ymd(b[0].d)}부터 ${ymd(b.at(-1).d)}까지 투입이 ${b.length}번 있었습니다. 마지막 투입 때 QQQ 낙폭은 ${p0(b.at(-1).qdd)}였습니다.`,
      `그 뒤에도 하락이 이어져 전체가 ${pct(s.plan.mdd)}까지 빠졌습니다(${ymd(s.plan.mddDay)}). 고점 회복은 ${s.plan.rec ? ymd(s.plan.rec) : '기간 안에 못 함'}입니다.`,
      `투입 없이 들고만 있어도 ${pct(s.hold.mdd)}였습니다. 시작 뒤 QQQ가 급등해 비중이 불어난 상태에서 하락을 맞았기 때문입니다.`,
    ]
  },
}
const scenarioPage = (s, n) => `<section class="page">
  <div class="kicker">과거 데이터 ${n}</div>
  <h2>${s.title}</h2>
  <p class="sub">${s.sub}. ${s.note}</p>
  ${tiles(s)}
  <h3>자산 가치 <span class="hint">시작 = 100, 세로축은 로그 눈금</span></h3>
  ${legend([['ln', C.plan, '규칙대로'], ['ln', C.base, '투입 없음 (상한 규칙만 적용)']])}
  ${valueChart(s)}
  <h3>전체 낙폭과 투입 시점 <span class="hint">최고점 대비, 규칙대로 운용한 경우</span></h3>
  ${legend([['dot', C.ink, '투입한 날'], ['rule', C.ink2, '단계 문턱']])}
  ${ddChart(s)}
  <h3>비중 변화</h3>
  ${legend([...STACK.filter((k) => k in s.base).map((k) => ['sw', C[k], NAME[k]]), ['rule', C.ink, '현금 목표'], ...(s.plan.events.some((e) => e.type === 'trim') ? [['dia', C.ink, '20% 넘어 줄인 날']] : [])])}
  ${weightChart(s)}
  <ul class="take">${takeaways[s.id](s).map((t) => `<li>${t}</li>`).join('')}</ul>
</section>`
const recordsPage = () => `<section class="page">
  <div class="kicker">기록</div>
  <h2>투입과 줄이기 기록</h2>
  <p class="sub">세 구간에서 규칙이 실제로 움직인 날입니다. 크기는 그날 전체 평가액 대비 비율입니다.</p>
  ${SCEN.map((s) => `<h3>${s.title} <span class="hint">${s.sub}</span></h3>${eventTable(s)}`).join('')}
  <p class="foot">낙폭과 비중은 체결한 날 종가 기준이라, 신호가 난 전날 값과 조금 다를 수 있습니다. 전날 20%를 넘은 비중이 체결일에 18%로 적히거나, 전날 문턱을 넘은 낙폭이 체결일 반등으로 얕게 적히는 경우입니다. 현금 목표가 그대로인 투입은 쌓인 초과 현금을 넣은 것입니다(5번 규칙).</p>
</section>`

const stepDiagram = () => {
  const Wd = 688, H = 230, L = 60, R = 30, T = 20, B = 44
  const x = (dd) => L + (dd / -0.45) * (Wd - L - R), y = (c) => T + (1 - c / 0.45) * (H - T - B)
  const pts = [[0, 0.4], [-0.15, 0.4], [-0.15, 0.3], [-0.25, 0.3], [-0.25, 0.2], [-0.35, 0.2], [-0.35, 0.1], [-0.45, 0.1]]
  return `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="전체 낙폭에 따른 현금 목표">
    <rect x="${x(0)}" y="${y(0.1)}" width="${x(-0.45) - x(0)}" height="${y(0) - y(0.1)}" fill="${C.cash}" opacity="0.14"/>
    <text x="${x(-0.02)}" y="${y(0.05) + 4}" class="lbl2">하한 10%: 어떤 경우에도 쓰지 않는 돈</text>
    ${[0, 0.1, 0.2, 0.3, 0.4].map((c) => `<line x1="${L}" x2="${Wd - R}" y1="${y(c)}" y2="${y(c)}" stroke="${C.grid}"/><text x="${L - 8}" y="${y(c) + 4}" text-anchor="end" class="tick">${p0(c)}</text>`).join('')}
    ${[0, -0.15, -0.25, -0.35, -0.45].map((d) => `<line x1="${x(d)}" x2="${x(d)}" y1="${y(0)}" y2="${y(0) + 5}" stroke="${C.ink3}"/><text x="${x(d)}" y="${y(0) + 18}" text-anchor="middle" class="tick">${d === 0 ? '최고점' : p0(d)}</text>`).join('')}
    <path d="${pathOf(pts.map(([d, c]) => [x(d), y(c)]))}" fill="none" stroke="${C.cash}" stroke-width="3" stroke-linejoin="round"/>
    ${RULE.levels.map(([d, c], k) => `<circle cx="${x(d)}" cy="${y(c)}" r="5" fill="${C.ink}" stroke="#fff" stroke-width="2"/><text x="${x(d) + 10}" y="${y(c) - 8}" class="lbl">${k + 1}단계: 현금 ${p0(c)}로</text>`).join('')}
    <text x="${x(-0.01)}" y="${y(0.4) - 8}" class="lbl">평상시: 현금 40%</text>
    <text x="${(L + Wd - R) / 2}" y="${H - 6}" text-anchor="middle" class="axis">전체 자산이 최고점에서 내린 폭 (환율 제외)</text>
    <text x="14" y="${(T + H - B) / 2}" text-anchor="middle" class="axis" transform="rotate(-90 14 ${(T + H - B) / 2})">현금 목표</text>
  </svg>`
}
const cashBars = () => {
  const rows = [['평상시', 0.4], ...RULE.levels.map(([d, c], k) => [`${k + 1}단계 뒤 (${p0(d)} 이하)`, c])]
  return `<div class="bars">${rows.map(([label, c]) => `<div class="bar-row"><div class="bar-l">${label}</div><div class="bar"><span class="seg" style="width:${c * 100}%;background:${C.cash}"></span><span class="seg" style="width:${(1 - c) * 100}%;background:${C.qqq}"></span></div><div class="bar-v">현금 ${p0(c)} · 투자 자산 ${p0(1 - c)}</div></div>`).join('')}</div>`
}

const cmpRow = (label, key, mark = '') => `<tr${mark ? ' class="pick"' : ''}><td>${label}</td>${SCEN.map((s) => `<td class="n">${pct(s[key].cagr)}</td><td class="n">${pct(s[key].mdd)}</td>`).join('')}</tr>`
const s14 = SCEN[0], s04 = SCEN[1], s99 = SCEN[2]
const gapBuys99 = s99.gap.events.filter((e) => e.type === 'buy')

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
.bar-row { display: grid; grid-template-columns: 120pt 1fr 150pt; gap: 10pt; align-items: center; font-size: 9.5pt; }
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
  <div class="kicker">투자 규칙 초안 · ${ymd(s14.dates.at(-1))} 자료 기준</div>
  <h1>예비 현금 단계 투입 규칙</h1>
  <p class="lead">현금 40%를 예비로 들고 있다가, 전체 자산이 깊게 빠질 때 세 번에 나눠 투자 자산으로 옮깁니다. 한 번 산 것은 팔지 않습니다. 금과 암호화폐가 너무 커졌을 때만 줄입니다.</p>

  <h3>시작 비중</h3>
  <div class="bars"><div class="bar-row"><div class="bar-l">평상시</div><div class="bar">
    <span class="seg" style="width:40%;background:${C.cash}"></span><span class="seg" style="width:10%;background:${C.gold}"></span><span class="seg" style="width:40%;background:${C.qqq}"></span><span class="seg" style="width:10%;background:${C.btc}"></span>
  </div><div class="bar-v"></div></div></div>
  ${legend([['sw', C.cash, '현금 40% (원화 현금, 단기 국채 ETF)'], ['sw', C.gold, '금 10%'], ['sw', C.qqq, 'QQQ 40%'], ['sw', C.btc, '암호화폐 10%']])}

  <h3>규칙 여섯 가지</h3>
  <div class="rules">
    <div class="rulecard"><b><span class="no">1</span>깊은 하락에서만 현금을 씁니다</b><p>전체 자산이 최고점에서 ${RULE.levels.map(([d]) => p0(d)).join(' / ')} 이하로 내리면 현금 목표를 ${RULE.levels.map(([, c]) => p0(c)).join(' / ')}로 낮춥니다. 낙폭은 환율을 뺀 시세로 잽니다.</p></div>
    <div class="rulecard"><b><span class="no">2</span>살 때의 순서</b><p>암호화폐와 금이 전체의 ${p0(RULE.fillTo)}보다 적으면 ${p0(RULE.fillTo)}까지 먼저 채웁니다. 남은 돈은 모두 QQQ를 삽니다.</p></div>
    <div class="rulecard"><b><span class="no">3</span>산 것은 팔지 않습니다</b><p>낙폭이 회복돼도 현금 목표를 다시 올리지 않습니다. 파는 경우는 4번과 생활에 필요한 돈, 두 가지뿐입니다.</p></div>
    <div class="rulecard"><b><span class="no">4</span>금·암호화폐는 ${p0(RULE.trimAt)}에서 줄입니다</b><p>둘 중 하나가 전체의 ${p0(RULE.trimAt)}를 넘으면 한 번에 ${p0(RULE.trimTo)}로 줄입니다. 판 돈은 현금에 둡니다.</p></div>
    <div class="rulecard"><b><span class="no">5</span>다시 쌓인 현금</b><p>4번의 매도 대금이나 이자로 현금이 목표보다 많아졌으면, 다음에 전체 낙폭이 ${p0(RULE.levels[0][0])} 이하로 갈 때 초과분을 투입합니다.</p></div>
    <div class="rulecard"><b><span class="no">6</span>현금 ${p0(RULE.levels.at(-1)[1])}는 남깁니다</b><p>마지막 단계를 지나도 현금 ${p0(RULE.levels.at(-1)[1])}는 쓰지 않습니다. 더 깊은 하락을 버티는 돈입니다.</p></div>
  </div>

  <div class="note">이 문서의 과거 수치는 달러 기준 일별 자료로 계산했고, 세금과 거래 비용은 넣지 않았습니다. 깊은 하락 사례가 2000년, 2008년, 2022년 세 번뿐이라 앞으로의 결과를 보장하지 않습니다.</div>
</section>

<section class="page">
  <div class="kicker">규칙 도해</div>
  <h2>낙폭이 깊어질수록 현금 목표가 계단처럼 내려갑니다</h2>
  <p class="sub">한 번 내려간 계단은 다시 올라가지 않습니다. 회복한 뒤 다음 하락이 와도, 이미 쓴 단계는 다시 발동하지 않습니다.</p>
  ${stepDiagram()}
  <h3>단계별 현금과 투자 자산</h3>
  ${cashBars()}
  ${legend([['sw', C.cash, '현금'], ['sw', C.qqq, '투자 자산 (QQQ, 금, 암호화폐)']])}

  <h3>점검할 때의 판단 순서</h3>
  <div class="flow">
    <div class="step"><div class="no">1</div><div class="q"><b>금이나 암호화폐가 전체의 ${p0(RULE.trimAt)}를 넘었나</b>둘을 따로 봅니다. 암호화폐는 비트코인, 이더리움, 관련 주식을 합칩니다.</div><div class="a"><span class="yes">넘었으면</span>${p0(RULE.trimTo)}로 줄이고 판 돈은 현금에 둡니다.</div></div>
    <div class="step"><div class="no">2</div><div class="q"><b>전체 낙폭이 아직 쓰지 않은 단계의 문턱 아래인가</b>최고점은 환율을 뺀 시세 기준으로 직접 기록해 둡니다.</div><div class="a"><span class="yes">그렇다면</span>현금 목표를 그 단계 값으로 낮추고, 목표를 넘는 현금을 다음 거래일에 투입합니다.</div></div>
    <div class="step"><div class="no">3</div><div class="q"><b>현금이 목표보다 많고, 전체 낙폭이 새로 ${p0(RULE.levels[0][0])} 아래로 내려왔나</b>4번 규칙으로 판 돈과 이자가 쌓인 경우입니다.</div><div class="a"><span class="yes">그렇다면</span>초과분을 투입합니다. 현금 목표는 그대로입니다.</div></div>
    <div class="step"><div class="no">4</div><div class="q"><b>위 어디에도 해당하지 않는가</b></div><div class="a"><span class="yes">그렇다면</span>아무것도 하지 않습니다. 오른 자산을 팔지 않고, 빠진 자산을 따로 사지도 않습니다.</div></div>
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
    ${cmpRow(`문턱 ${ALT.near.map(([d]) => p0(d)).join(' / ')}`, 'near')}
    ${cmpRow(`문턱 ${RULE.levels.map(([d]) => p0(d)).join(' / ')} (이 문서)`, 'plan', 'pick')}
    ${cmpRow('같은 문턱 + 단계 사이 6개월 이상', 'gap')}
  </tbody></table>
  <ul class="take">
    <li>세 구간 모두 투입하는 쪽이 연수익률이 높았고, 최대 낙폭은 더 깊었습니다.</li>
    <li>문턱을 넓히거나 단계 사이를 벌리면 닷컴 구간에서는 더 싸게 샀습니다. 6개월 간격을 둔 경우 마지막 투입 때 QQQ 낙폭이 ${p0(gapBuys99.at(-1).qdd)}였습니다. 빨리 회복한 2008년과 2022년에는 덜 사게 되어 수익이 조금 낮았습니다.</li>
    <li>어떤 방식도 닷컴 구간의 최대 낙폭을 줄이지 못했습니다. 문턱은 평균 매입가를 바꿀 뿐, 손실의 깊이는 QQQ 비중이 정합니다.</li>
  </ul>

  <h3>이 규칙의 성격</h3>
  <div class="cols">
    <div><table class="t"><thead><tr><th>얻는 것</th></tr></thead><tbody>
      <tr><td>깊은 하락에서 싸게 사는 구조가 미리 정해져 있습니다.</td></tr>
      <tr><td>팔지 않으므로 양도세가 거의 생기지 않습니다(4번 규칙 제외).</td></tr>
      <tr><td>금·암호화폐의 급등을 현금으로 바꿔 다음 하락의 재원으로 씁니다.</td></tr>
    </tbody></table></div>
    <div><table class="t"><thead><tr><th>치르는 것</th></tr></thead><tbody>
      <tr><td>현금은 한 번 쓰면 돌아오지 않습니다. 2004년 시작 구성은 마지막에 QQQ가 ${p0(s04.plan.final.w.qqq)}였습니다.</td></tr>
      <tr><td>발동을 기다리는 동안 현금 40%가 묶입니다. 2014년 시작 구성은 첫 투입까지 ${yearsBetween(s14.dates[0], s14.plan.firstBuy).toFixed(1)}년이 걸렸습니다.</td></tr>
      <tr><td>긴 하락에서는 손실이 커집니다. 닷컴 구간 최대 낙폭은 ${pct(s99.plan.mdd)}, 투입하지 않았다면 ${pct(s99.hold.mdd)}였습니다.</td></tr>
    </tbody></table></div>
  </div>
</section>

<section class="page">
  <div class="kicker">설계 점검표</div>
  <h2>아직 정하지 않았거나 다시 볼 부분</h2>
  <p class="sub">규칙을 더 치밀하게 다듬을 때 볼 항목입니다. 위에서부터 영향이 큰 순서입니다.</p>
  <table class="t"><thead><tr><th style="width:21%">항목</th><th style="width:27%">지금 규칙</th><th style="width:26%">걸리는 점</th><th>선택지</th></tr></thead><tbody>
    <tr><td>현금을 다 쓴 뒤</td><td>QQQ 비중에 상한이 없습니다.</td><td>세 단계를 쓰고 나면 사실상 QQQ 보유가 됩니다. 그 뒤의 하락에는 쓸 돈이 없습니다.</td><td>받아들인다 / QQQ가 일정 비중을 넘으면 새로 넣는 돈을 현금으로 쌓는다</td></tr>
    <tr><td>긴 하락</td><td>현금 ${p0(RULE.levels.at(-1)[1])} 하한만 둡니다.</td><td>닷컴 구간에서 전체 ${pct(s99.plan.mdd)}, 고점 회복 ${s99.plan.rec ? ym(s99.plan.rec) : '미회복'}.</td><td>하한을 올린다 / 단계 사이에 시간 간격을 둔다 / 그대로 둔다</td></tr>
    <tr><td>문턱의 깊이</td><td>${RULE.levels.map(([d]) => p0(d)).join(' / ')}</td><td>깊을수록 덜 자주 발동하고 기다림이 길어집니다. 얕으면 회복 뒤 다시 사고 싶어질 만큼 일찍 씁니다.</td><td>앞 장의 비교표 참고</td></tr>
    <tr><td>기다리는 기간</td><td>기한이 없습니다.</td><td>2014년 시작 구성에서 첫 투입까지 ${yearsBetween(s14.dates[0], s14.plan.firstBuy).toFixed(1)}년.</td><td>받아들인다 / 일정 기간 발동이 없으면 일부를 넣는다</td></tr>
    <tr><td>낙폭을 재는 방법</td><td>매일 종가, 환율 제외, 다음 거래일 체결.</td><td>최고점을 직접 기록해야 합니다. 돈을 넣고 빼면 최고점이 흐려집니다.</td><td>주 1회 점검으로 줄인다 / 입출금은 수익률에서 뺀다</td></tr>
    <tr><td>금·암호화폐 ${p0(RULE.fillTo)}</td><td>투입할 때만 채웁니다.</td><td>평소에는 줄어들기만 합니다. 2004년 시작 구성에서 금이 ${p0(s04.plan.final.w.gold)}까지 내려갔습니다.</td><td>그대로 둔다 / 연 1회 ${p0(RULE.fillTo)}까지 채운다(현금 사용)</td></tr>
    <tr><td>${p0(RULE.trimAt)} 상한의 세금</td><td>한 번에 ${p0(RULE.trimTo)}로 줄입니다.</td><td>매도 이익에 세금이 붙을 수 있습니다. 계산에는 넣지 않았습니다.</td><td>보유 방식별 세금 확인 / 여러 해에 나눠 줄인다</td></tr>
    <tr><td>암호화폐 안의 구성</td><td>합계로만 봅니다.</td><td>비트코인, 이더리움, 관련 주식의 근거가 서로 다릅니다.</td><td>채울 때 비트코인만 산다 / 비율을 정한다</td></tr>
    <tr><td>새로 생기는 돈</td><td>정한 것이 없습니다.</td><td>월급, 이자, 배당이 들어올 때 어디에 둘지에 따라 현금 비중이 달라집니다.</td><td>현금에 쌓는다(5번 규칙) / 들어올 때마다 비중대로 산다</td></tr>
    <tr><td>돈이 필요할 때</td><td>"생활에 필요한 돈"만 예외입니다.</td><td>어디서 먼저 꺼낼지 정하지 않았습니다.</td><td>현금 하한 위쪽부터 / 비중이 가장 큰 자산부터</td></tr>
  </tbody></table>
  <p class="foot">계산 방법: 일별 수정주가(배당 재투자 가정), 현금은 미국 3개월 국채 금리로 이자. 신호는 그날 종가, 체결은 다음 거래일 종가. 금은 GLD, 비트코인은 BTC-USD를 썼습니다. 생성: scripts/reserve/build-report.mjs</p>
</section>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'reserve-plan.html'), html)
for (const s of SCEN) console.log(`${s.title}: 규칙 ${pct(s.plan.cagr)} / ${pct(s.plan.mdd)} · 투입 없음 ${pct(s.hold.cagr)} / ${pct(s.hold.mdd)} · 투입 ${s.plan.events.filter((e) => e.type === 'buy').length}회 · 줄이기 ${s.plan.events.filter((e) => e.type === 'trim').length}회 · 첫 투입 ${s.plan.firstBuy}`)

const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(OUT, 'reserve-plan.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const fontOk = await page.evaluate(() => document.fonts.check('12px "IBM Plex Sans KR"', '한글'))
await page.pdf({ path: path.join(OUT, 'reserve-plan.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`PDF 저장: ${path.join(OUT, 'reserve-plan.pdf')} (한글 글꼴 ${fontOk ? '적용' : '미적용'})`)
