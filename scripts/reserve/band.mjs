// 단순안 검토: 처음 한 번만 QQQ 하락(-20%)으로 현금을 10%p 줄이고(40 → 30), 그 뒤로는 현금 비중의 위·아래 선으로만 움직인다.
//   위쪽 선(up, 기본 목표+10%p = 40%)에 닿으면 현금을 목표(30%)까지 써서 산다(금·암호화폐 10%까지 먼저, 나머지 QQQ).
//   아래쪽 선(lower: 목표보다 몇 %p 아래, 0.1 = 20%)에 닿으면 QQQ를 팔아 현금을 (목표 - lowerTo)까지 채운다. null이면 아래쪽 선 없음.
//   needDrop — true면 위쪽 선에 닿아도 QQQ가 최고가 대비 -10% 이하일 때만 산다(상한으로 판 돈 때문에 닿은 경우를 거른다)
//   contrib — 새 돈: 매달 첫 거래일에 (전체 자산 x contrib / 12)가 들어온다. 현금이 목표보다 적으면 현금에, 아니면 기준보다 가장 모자란 자산에.
// 공통: 금·암호화폐 20% 넘으면 10%로. 아래쪽 선이 없을 때만 QQQ 상한(다 투입한 비중 + 10%p)을 둔다.
// 결정은 종가, 체결은 다음 거래일 종가. 달러 기준(환율 제외). 수익률은 새 돈의 영향을 뺀 시간가중 수익률.
// 사용: node scripts/reserve/band.mjs [세율=0.22]  (세금: 평균 단가 기준 매도 차익, 공제·손익 합산 없음)
import fs from 'node:fs'
const ROOT = new URL('../../data-src/reserve', import.meta.url).pathname
const csv = (n) => new Map(fs.readFileSync(`${ROOT}/${n}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
const FILL = 0.1, TRIM_AT = 0.2, TRIM_TO = 0.1, STEP = 0.1, FIRST_DD = -0.2
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
  const target = base.cash - STEP, upper = target + (o.up ?? STEP)
  const capTo = 1 - 0.1 - others.length * FILL, capAt = capTo + 0.1, hasCap = capAt < 0.999 && o.lower == null
  let peakQ = QQQ.get(dates[0]), irx = 0, stepped = false
  let pendBuy = null, pendSell = false, pendTrim = [], pendQ = false
  let nav = 100, lastPost = 100, cashSum = 0, minCash = 1, soldSum = 0
  const N = [100], ev = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) { const a = assets.find((x) => x.key === key), s = hold[key] * px(a, d) - TRIM_TO * total(d); if (s > 0) { sell(a, s, d); ev.push({ d, type: 'trim' }) } }
    pendTrim = []
    if (pendQ) {
      const T = total(d), s = hold.qqq * px(qA, d) - capTo * T
      if (s > 0) { sell(qA, s, d); ev.push({ d, type: 'qtrim' }) }
      pendQ = false
    }
    if (pendSell) {
      const T = total(d), need = (target - (o.lowerTo ?? 0)) * T - cash
      if (need > 0.005 * T) { sell(qA, Math.min(need, hold.qqq * px(qA, d)), d); soldSum += need / T; ev.push({ d, type: 'sell', pct: need / T }) }
      pendSell = false
    }
    if (pendBuy) {
      const T = total(d), buy = cash - target * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, FILL * T - hold[a.key] * px(a, d))))
        const sum = sf.reduce((x, y) => x + y, 0), k = sum > buy ? buy / sum : 1
        assets.forEach((a, j) => buyA(a, a.key === 'qqq' ? buy - Math.min(sum, buy) : sf[j] * k, d))
        ev.push({ d, type: 'buy', pct: buy / T, qdd: QQQ.get(d) / peakQ - 1 })
      }
      pendBuy = null
    }
    // 시간가중 수익률: 새 돈이 들어오기 전 값으로 하루 수익을 잰다
    nav *= total(d) / lastPost
    if (o.contrib && d.slice(0, 7) !== prev.slice(0, 7)) {
      const T = total(d), amt = (o.contrib / 12) * T, tgtCash = stepped ? target : base.cash
      cash += amt
      if (cash - amt >= tgtCash * T) { // 현금이 목표 이상이면 기준보다 가장 모자란 자산을 산다
        const gap = (a) => (a.key === 'qqq' ? 1 - tgtCash - others.length * FILL : FILL) - (hold[a.key] * px(a, d)) / T
        buyA(assets.reduce((m, a) => (gap(a) > gap(m) ? a : m)), amt, d)
      }
    }
    const T = total(d), q = QQQ.get(d)
    lastPost = T
    if (q > peakQ) peakQ = q
    const qdd = q / peakQ - 1, cw = cash / T
    if (o.mode !== 'none') {
      if (!stepped) { if (qdd <= FIRST_DD) { stepped = true; pendBuy = true } }
      else if (cw >= upper && (!o.needDrop || qdd <= -0.1)) pendBuy = true
      else if (o.lower != null && cw <= target - o.lower) pendSell = true
    }
    for (const a of others) if ((hold[a.key] * px(a, d)) / T >= TRIM_AT) pendTrim.push(a.key)
    if (hasCap && (hold.qqq * q) / T >= capAt) pendQ = true
    N.push(nav); cashSum += cw; if (stepped) minCash = Math.min(minCash, cw)
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  let pk = 0, mdd = 0
  for (const v of N) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1) }
  const d = dates.at(-1), T = total(d)
  return { cagr: (nav / 100) ** (1 / yrs) - 1, mdd, ev, taxPaid, soldSum, minCash, avgCash: cashSum / (dates.length - 1), w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T } }
}

const A = { qqq: { key: 'qqq', px: QQQ }, gold: { key: 'gold', px: GLD }, btc: { key: 'btc', px: BTC } }
const SCEN = [
  ['2014~ QQQ40·금10·BTC10·현금40', '2014-09-17', [A.qqq, A.gold, A.btc], { qqq: 0.4, gold: 0.1, btc: 0.1, cash: 0.4 }],
  ['2004~ QQQ45·금10·현금45', '2004-11-18', [A.qqq, A.gold], { qqq: 0.45, gold: 0.1, cash: 0.45 }],
  ['1999~ QQQ50·현금50', '1999-03-10', [A.qqq], { qqq: 0.5, cash: 0.5 }],
]
const tax = process.argv[2] != null ? +process.argv[2] : 0.22
for (const [title, start, assets, base] of SCEN) {
  const dates = [...QQQ.keys()].sort().filter((d) => d >= start && assets.every((a) => a.px.has(d)))
  const t = base.cash - STEP
  console.log(`\n=== ${title} (${dates[0]}~${dates.at(-1)}) · 목표 현금 ${pc(t, 0)} · 위쪽 선 ${pc(base.cash, 0)} · 아래쪽 선 ${pc(t - 0.1, 0)} · 세율 ${pc(tax, 0)}`)
  const row = (label, o, detail) => {
    const a = sim(dates, assets, base, { mode: 'band', ...o, tax: 0 }), b = sim(dates, assets, base, { mode: 'band', ...o, tax })
    const n = (t2) => a.ev.filter((e) => e.type === t2).length
    console.log(`${label.padEnd(30)} 세전 ${pc(a.cagr)} · 세후 ${pc(b.cagr)} · MDD ${pc(a.mdd)} · 투입 ${n('buy')}회 · 현금 채우려 매도 ${n('sell')}회(합 ${pc(a.soldSum, 0)}) · 평균현금 ${pc(a.avgCash, 0)} · 최저현금 ${pc(a.minCash, 0)} · 끝 현금 ${pc(a.w.cash, 0)} QQQ ${pc(a.w.qqq, 0)}`)
    if (detail) console.log('   ' + a.ev.filter((e) => e.type === 'buy' || e.type === 'sell').map((e) => (e.type === 'buy' ? `${e.d.slice(0, 7)} 투입 ${pc(e.pct, 0)}(QQQ ${pc(e.qdd, 0)})` : `${e.d.slice(0, 7)} 매도 ${pc(e.pct, 0)}`)).join(' · '))
  }
  row('투입 없음', { mode: 'none', lower: null })
  row('위쪽 선만 (아래쪽 선 없음)', { lower: null })
  row(`아래쪽 선 → ${pc(t, 0)}까지 채움`, { lower: 0.1 }, true)
  row(`아래쪽 선 → ${pc(t - 0.05, 0)}까지 채움`, { lower: 0.1, lowerTo: 0.05 }, true)
  row(`아래쪽 선 → ${pc(t - 0.08, 0)}까지 (조금씩)`, { lower: 0.1, lowerTo: 0.08 })
  for (const c of [0.03, 0.06, 0.1]) {
    row(`새 돈 연 ${pc(c, 0)} · 아래쪽 선 없음`, { lower: null, contrib: c })
    row(`새 돈 연 ${pc(c, 0)} · 아래쪽 선 → ${pc(t, 0)}`, { lower: 0.1, contrib: c }, c === 0.06)
    row(`새 돈 연 ${pc(c, 0)} · 아래쪽 선 → ${pc(t - 0.05, 0)}`, { lower: 0.1, lowerTo: 0.05, contrib: c })
  }
}
