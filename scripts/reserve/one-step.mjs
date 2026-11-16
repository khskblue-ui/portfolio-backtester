// 한 단계 투입 뒤의 갈림길 비교: QQQ가 최고가 대비 -n%면 현금을 10%p 덜어 사고(금·암호화폐 10%까지 먼저, 나머지 QQQ),
//   stay   — 그대로 둔다(되돌리지 않음)
//   reload — QQQ가 최고가를 다시 넘으면 QQQ를 팔아 현금을 처음 비중으로 되돌린다(다음 하락에 다시 쓴다)
//   none   — 투입하지 않는다
// 공통: 금·암호화폐는 20%를 넘으면 10%로. 결정은 종가, 체결은 다음 거래일 종가. 달러 기준(환율 제외).
// 세금: 매도 차익(평균 단가 기준)에 세율을 매긴다(공제·손익 통산 없음, 보수적). 사용: node scripts/reserve/one-step.mjs [세율=0.22]
import fs from 'node:fs'
const ROOT = new URL('../../data-src/reserve', import.meta.url).pathname
const csv = (n) => new Map(fs.readFileSync(`${ROOT}/${n}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [d, v] = l.split(','); return [d, +v] }))
const QQQ = csv('QQQ'), GLD = csv('GLD'), BTC = csv('BTC-USD'), IRX = csv('IRX')
const FILL = 0.1, TRIM_AT = 0.2, TRIM_TO = 0.1, STEP = 0.1
const pc = (x, d = 1) => `${(x * 100).toFixed(d)}%`

function sim(dates, assets, base, opt) {
  const px = (a, d) => a.px.get(d)
  const hold = {}, cost = {}
  for (const a of assets) { hold[a.key] = (100 * base[a.key]) / px(a, dates[0]); cost[a.key] = 100 * base[a.key] }
  let cash = 100 * base.cash, taxPaid = 0, reloadTax = 0
  const total = (d) => cash + assets.reduce((s, a) => s + hold[a.key] * px(a, d), 0)
  const sell = (a, amt, d) => {
    const frac = amt / (hold[a.key] * px(a, d)), tax = Math.max(0, amt - cost[a.key] * frac) * opt.tax
    hold[a.key] -= amt / px(a, d); cost[a.key] *= 1 - frac; cash += amt - tax; taxPaid += tax
    return tax
  }
  const buyA = (a, amt, d) => { hold[a.key] += amt / px(a, d); cost[a.key] += amt; cash -= amt }
  const qA = assets.find((a) => a.key === 'qqq')
  let peakQ = QQQ.get(dates[0]), irx = 0, stepped = false, pend = null, pendTrim = [], steps = 0, reloads = 0, cashSum = 0
  const V = [100]
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], prev = dates[i - 1]
    if (IRX.has(prev)) irx = IRX.get(prev)
    cash *= 1 + (irx / 100) * ((Date.parse(d) - Date.parse(prev)) / 864e5 / 365)
    for (const key of pendTrim) { const a = assets.find((x) => x.key === key), s = hold[key] * px(a, d) - TRIM_TO * total(d); if (s > 0) sell(a, s, d) }
    pendTrim = []
    if (pend === 'buy') {
      const T = total(d), buy = cash - (base.cash - STEP) * T
      if (buy > 0.005 * T) {
        const sf = assets.map((a) => (a.key === 'qqq' ? 0 : Math.max(0, FILL * T - hold[a.key] * px(a, d))))
        const others = sf.reduce((x, y) => x + y, 0), k = others > buy ? buy / others : 1
        assets.forEach((a, j) => buyA(a, a.key === 'qqq' ? buy - Math.min(others, buy) : sf[j] * k, d))
        steps++
      }
    } else if (pend === 'reload') {
      const T = total(d), need = base.cash * T - cash
      if (need > 0.005 * T) { reloadTax += sell(qA, Math.min(need / (1 - 0.0), hold.qqq * px(qA, d)), d); reloads++ }
    }
    pend = null
    const T = total(d), q = QQQ.get(d)
    if (q > peakQ) { peakQ = q; if (stepped && opt.mode === 'reload') pend = 'reload'; if (opt.mode === 'reload') stepped = false }
    else if (opt.mode !== 'none' && !stepped && q / peakQ - 1 <= opt.n) { stepped = true; pend = 'buy' }
    for (const a of assets) if (a.key !== 'qqq' && (hold[a.key] * px(a, d)) / T >= TRIM_AT) pendTrim.push(a.key)
    V.push(T); cashSum += cash / T
  }
  const yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 864e5 / 365.25
  let pk = 0, mdd = 0
  for (const v of V) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1) }
  const d = dates.at(-1), T = total(d)
  // 끝에 전부 판다고 가정했을 때 남는 세금(미실현 차익)까지 뺀 값도 함께 본다
  const latent = assets.reduce((s, a) => s + Math.max(0, hold[a.key] * px(a, d) - cost[a.key]) * opt.tax, 0)
  return { cagr: (T / 100) ** (1 / yrs) - 1, cagrLiq: ((T - latent) / 100) ** (1 / yrs) - 1, mdd, steps, reloads, taxPaid, reloadTax, avgCash: cashSum / (dates.length - 1), w: { ...Object.fromEntries(assets.map((a) => [a.key, (hold[a.key] * px(a, d)) / T])), cash: cash / T } }
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
  console.log(`\n=== ${title} (${dates[0]}~${dates.at(-1)}) · 매도 차익 세율 ${pc(tax, 0)}`)
  const row = (label, opt) => {
    const r = sim(dates, assets, base, { ...opt, tax })
    console.log(`${label.padEnd(24)} 연 ${pc(r.cagr)} (전부 판 뒤 ${pc(r.cagrLiq)}) · MDD ${pc(r.mdd)} · 투입 ${r.steps}회 · 되돌림 ${r.reloads}회 · 낸 세금 ${r.taxPaid.toFixed(1)}(되돌림 ${r.reloadTax.toFixed(1)}) · 평균현금 ${pc(r.avgCash, 0)} · 끝 ${Object.entries(r.w).map(([k, v]) => `${k} ${pc(v, 0)}`).join(' ')}`)
  }
  row('투입 없음', { mode: 'none' })
  for (const n of [-0.2, -0.25, -0.3]) { row(`QQQ ${pc(n, 0)} · 그대로 둠`, { mode: 'stay', n }); row(`QQQ ${pc(n, 0)} · 되돌림`, { mode: 'reload', n }) }
}
// 참고: QQQ가 최고가 대비 -n%에 닿은 횟수와 그 뒤
{
  const dates = [...QQQ.keys()].sort()
  for (const n of [-0.2, -0.25, -0.3]) {
    let peak = 0, hit = false
    const out = []
    dates.forEach((d, i) => {
      const q = QQQ.get(d)
      if (q > peak) { peak = q; hit = false } else if (!hit && q / peak - 1 <= n) {
        hit = true
        let lo = q
        for (let j = i; j < dates.length && QQQ.get(dates[j]) <= peak; j++) lo = Math.min(lo, QQQ.get(dates[j]))
        const j3 = dates.findIndex((x) => x >= `${+d.slice(0, 4) + 3}${d.slice(4)}`)
        out.push(`${d.slice(0, 7)} (그 뒤 더 ${pc(lo / q - 1, 0)}, 3년 뒤 ${j3 > 0 ? pc(QQQ.get(dates[j3]) / q - 1, 0) : '미정'})`)
      }
    })
    console.log(`\nQQQ ${pc(n, 0)} 도달 ${out.length}회: ${out.join(' · ')}`)
  }
}
