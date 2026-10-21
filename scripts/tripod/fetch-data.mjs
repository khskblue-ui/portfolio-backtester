// 트라이팟 검증용 일봉 스냅숏 수집 (Yahoo v8 chart API → data-src/tripod/*.csv)
// 사용: node scripts/tripod/fetch-data.mjs
// 스냅숏은 커밋해 고정한다. 다시 받으면 과거 값도 미세하게 바뀔 수 있으므로
// 검증 결과를 갱신할 때만 재수집할 것.
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(import.meta.dirname, '../../data-src/tripod')
const P1 = 470000000 // 1984-11
const P2 = Date.UTC(2026, 9, 21) / 1000 // 2026-10-21 00:00 UTC (스냅숏 기준일)
const TICKERS = [
  ['^NDX', 'NDX'], ['^VIX', 'VIX'], ['^IRX', 'IRX'], ['^GSPC', 'GSPC'],
  ['QQQ', 'QQQ'], ['QLD', 'QLD'], ['TQQQ', 'TQQQ'], ['SPY', 'SPY'],
]

const num = (v) => (v == null || Number.isNaN(v) ? '' : String(+v.toFixed(6)))

fs.mkdirSync(OUT, { recursive: true })
for (const [sym, name] of TICKERS) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?period1=${P1}&period2=${P2}&interval=1d&events=div`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`${sym}: HTTP ${res.status}`)
  const r = (await res.json()).chart.result[0]
  const q = r.indicators.quote[0]
  const adj = r.indicators.adjclose?.[0]?.adjclose
  const day = (t) => new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10)
  const lines = ['date,open,high,low,close,adjclose']
  let prev = ''
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null) return
    const d = day(t)
    if (d === prev) return // 장중 갱신 중복 봉 방지
    prev = d
    lines.push([d, num(q.open[i]), num(q.high[i]), num(q.low[i]), num(q.close[i]), num(adj?.[i])].join(','))
  })
  fs.writeFileSync(path.join(OUT, `${name}.csv`), lines.join('\n') + '\n')
  const divs = Object.values(r.events?.dividends ?? {}).sort((a, b) => a.date - b.date)
  if (divs.length) {
    fs.writeFileSync(path.join(OUT, `${name}-div.csv`),
      ['date,amount', ...divs.map((x) => `${day(x.date)},${num(x.amount)}`)].join('\n') + '\n')
  }
  console.log(`${name}: ${lines.length - 1}봉 ${lines[1].slice(0, 10)}~${prev}${divs.length ? `, 배당 ${divs.length}건` : ''}`)
  await new Promise((s) => setTimeout(s, 400))
}
