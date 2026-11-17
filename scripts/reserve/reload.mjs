// 수정안 검토: 문턱 -20/-35/-50%, 하락 국면이 끝나면(QQQ 새 최고가) 현금을 일정 비중까지 되돌리는 규칙.
//   stage 'thirds' — 문턱마다 "국면이 시작될 때 가진 현금 중 하한(10%)을 넘는 부분"의 3분의 1씩 쓴다 (40%면 30/20/10, 30%면 23/17/10)
//   stage 'fixed'  — 현금 목표를 고정값(시작 현금 기준 30/20/10)으로 둔다. 되돌린 현금이 1단계 목표와 같으면 1단계는 살 것이 없다
//   reload null    — 되돌리지 않는다 / 숫자 — 국면이 끝난 다음 거래일에 QQQ를 팔아 현금을 그 비중까지 채운다
// 공통: 금·암호화폐 20% 넘으면 10%로, QQQ는 (다 투입한 비중 + 10%p) 넘으면 그 비중으로. 새 돈(적립)은 없다.
// 결정은 종가, 체결은 다음 거래일 종가. 낙폭 기준 최고가는 계산 시작 뒤의 최고 종가. 달러 기준(환율 제외).
// 사용: node scripts/reserve/reload.mjs [세율=0.22]  (세금: 평균 단가 기준 매도 차익, 공제·손익 합산 없음)
import fs from 'node:fs'
const ROOT = new URL('../../data-src/reserve', import.meta.url).pathname
const csv = (n) => new Map(fs.readFileSync(`${ROOT}/${n}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
const FLOOR = 0.1, FILL = 0.1, TRIM_AT = 0.2, TRIM_TO = 0.1, CAP_OVER = 0.1
const pc = (x, d = 1) => `${(x * 100).toFixed(d)}%`

function sim(dates, assets, base, o) {
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => {
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * o.tax
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
  }
  const buyA = (a, amt, d) => { if (amt > 0) { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt } }
  const others = assets.filter((a) => a.key !== 'qqq'), qA = assets.find((a) => a.key === 'qqq')
  const fixed = [1, 2, 3].map((k) => base.cash - ((base.cash - FLOOR) * k) / 3)
  const capTo = 1 - FLOOR - others.length * FILL, capAt = capTo + CAP_OVER, hasCap = capAt < 0.999
  let peakQ = QQQ.get(dates[0]), irx = 0, inEp = false, c0 = 0, epLevel = 0
  let pendBuy = null, pendTrim = [], pendQ = false, pendReload = false
  const V = [100], ev = []
  let cashSum = 0, epDays = 0
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) { const a = assets.find((x) => x.key === key), s = hold[key] * px(a, d) - TRIM_TO * total(d); if (s > 0) { sell(a, s, d); ev.push({ d, type: 'trim' }) } }
    pendTrim = []
    if (pendQ) {
      const T = total(d), s = hold.qqq * px(qA, d) - capTo * T
      if (s > 0) {
        const before = cash
        sell(qA, s, d)
        let left = cash - before
        for (const a of others) { const amt = Math.min(Math.max(0, FILL * total(d) - hold[a.key] * px(a, d)), left); if (amt > 0.002 * T) { buyA(a, amt, d); left -= amt } }
        ev.push({ d, type: 'qtrim' })
      }
      pendQ = false
    }
    if (pendReload) {
      const T = total(d), need = o.reload * T - cash
      if (need > 0.005 * T) { sell(qA, Math.min(need, hold.qqq * px(qA, d)), d); ev.push({ d, type: 'reload', pct: need / T }) }
      pendReload = false
    }
    if (pendBuy != null) {
      const T = total(d), buy = cash - pendBuy * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, FILL * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        assets.forEach((a, j) => buyA(a, a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k, d))
        ev.push({ d, type: 'buy', pct: buy / T, lv: epLevel })
      }
      pendBuy = null
    }
    const T = total(d), q = QQQ.get(d)
    if (q > peakQ) {
      peakQ = q
      if (inEp) { inEp = false; epLevel = 0; if (o.reload != null) pendReload = true }
    }
    let lv = 0
    while (lv < o.dd.length && q / peakQ - 1 <= o.dd[lv]) lv++
    if (lv > epLevel) {
      if (!inEp) { inEp = true; c0 = cash / T }
      epLevel = lv
      pendBuy = o.stage === 'thirds' ? FLOOR + (Math.max(c0, FLOOR) - FLOOR) * (1 - lv / 3) : fixed[lv - 1]
    }
    for (const a of others) if ((hold[a.key] * px(a, d)) / T >= TRIM_AT) pendTrim.push(a.key)
    if (hasCap && (hold.qqq * q) / T >= capAt) pendQ = true
    V.push(T); cashSum += cash / T; if (inEp) epDays++
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  let pk = 0, mdd = 0
  for (const v of V) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1) }
  const d = dates.at(-1), T = total(d)
  return { cagr: (T / 100) ** (1 / yrs) - 1, mdd, ev, taxPaid, avgCash: cashSum / (dates.length - 1), epShare: epDays / (dates.length - 1), w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T } }
}

const A = { qqq: { key: 'qqq', px: QQQ }, gold: { key: 'gold', px: GLD }, btc: { key: 'btc', px: BTC } }
const SCEN = [
  ['2014~ QQQ40·금10·BTC10·현금40', '2014-09-17', [A.qqq, A.gold, A.btc], { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }],
  ['2004~ QQQ45·금10·현금45', '2004-11-18', [A.qqq, A.gold], { qqq: 0.45, gold: 0.1, cash: 0.45 }],
  ['1999~ QQQ50·현금50', '1999-03-10', [A.qqq], { qqq: 0.5, cash: 0.5 }],
]
const DD = [-0.2, -0.35, -0.5], DD_OLD = [-0.2, -0.3, -0.4]
const tax = process.argv[2] != null ? +process.argv[2] : 0.22
for (const [title, start, assets, base] of SCEN) {
  const dates = [...QQQ.keys()].sort().filter((d) => d >= start && assets.every((a) => a.px.has(d)))
  const back = base.cash - 0.1 // 되돌리는 비중: 시작 현금보다 10%p 낮게 (40%면 30%)
  console.log(`\n=== ${title} (${dates[0]}~${dates.at(-1)}) · 되돌림 ${pc(back, 0)} · 세율 ${pc(tax, 0)}`)
  const row = (label, o) => {
    const a = sim(dates, assets, base, { ...o, tax: 0 }), b = sim(dates, assets, base, { ...o, tax })
    const n = (t) => a.ev.filter((e) => e.type === t).length
    const lv = [1, 2, 3].map((k) => a.ev.filter((e) => e.type === 'buy' && e.lv === k).length).join('/')
    console.log(`${label.padEnd(30)} 세전 ${pc(a.cagr)} · 세후 ${pc(b.cagr)} · MDD ${pc(a.mdd)} · 투입 ${n('buy')}회(단계별 ${lv}) · 되돌림 ${n('reload')}회 · 평균현금 ${pc(a.avgCash, 0)} · 국면 안 ${pc(a.epShare, 0)} · 끝 ${Object.entries(a.w).map(([k, v]) => `${k} ${pc(v, 0)}`).join(' ')}`)
  }
  row('확정본 문턱(-20/-30/-40) 되돌림X', { dd: DD_OLD, stage: 'thirds', reload: null })
  row('새 문턱 · 되돌림 없음', { dd: DD, stage: 'thirds', reload: null })
  row(`새 문턱 · 고정목표 · ${pc(back, 0)} 되돌림`, { dd: DD, stage: 'fixed', reload: back })
  row(`새 문턱 · 3분의1 · ${pc(back, 0)} 되돌림`, { dd: DD, stage: 'thirds', reload: back })
  row(`새 문턱 · 3분의1 · ${pc(base.cash, 0)} 되돌림`, { dd: DD, stage: 'thirds', reload: base.cash })
  const r = sim(dates, assets, base, { dd: DD, stage: 'thirds', reload: back, tax: 0 })
  console.log('   ' + r.ev.filter((e) => e.type === 'buy' || e.type === 'reload').map((e) => `${e.d.slice(0, 7)} ${e.type === 'buy' ? `투입${e.lv} ${pc(e.pct, 0)}` : `되돌림 ${pc(e.pct, 0)}`}`).join(' · '))
}
