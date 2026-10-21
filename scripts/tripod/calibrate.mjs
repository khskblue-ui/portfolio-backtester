// 2단계: 비용 모델 보정 — 실제 ETF 추적오차와 영상의 비교 대상(QQQ·QLD·TQQQ 보유) 성과로만 정한다.
// 트라이팟 결과는 보지 않는다(목표값에 맞춘 튜닝 방지).
// 사용: node scripts/tripod/calibrate.mjs
import {
  loadMarket, buildProducts, holdCurve, COST_DEFAULT, cagr, maxDD, ulcer, sortinoVariants, years, idxOf, readBars,
} from './lib.mjs'

const mkt = loadMarket({ end: '2026-08-28' })
const f = (x, d = 2) => (x * 100).toFixed(d)

// (1) 실제 ETF vs 가상 상품 (상장 후 겹치는 구간)
console.log('── (1) 실제 ETF(adjclose) 대비 가상 상품 CAGR 차이 (가상 − 실제, %p)')
for (const [name, k] of [['QQQ', 0], ['QLD', 1], ['TQQQ', 2]]) {
  const real = new Map(readBars(name).map((x) => [x.d, x.a]))
  const a = idxOf(mkt, readBars(name)[1].d), b = mkt.dates.length - 1
  const yrs = years(mkt, a, b)
  const realCagr = (real.get(mkt.dates[b]) / real.get(mkt.dates[a])) ** (1 / yrs) - 1
  const row = []
  for (const spread of [0, 0.25, 0.5, 0.75, 1.0]) {
    const prod = buildProducts(mkt, { ...COST_DEFAULT, spread })
    const v = holdCurve(mkt, prod, k, a, b)
    row.push(`s=${spread}: ${(f(cagr(v, yrs) - realCagr))}`)
    if (k === 0) break // 1배는 스프레드 무관
  }
  console.log(`${name.padEnd(5)} ${mkt.dates[a]}~  실제 ${f(realCagr)}%  ${row.join('  ')}`)
}

// (2) 영상 비교 대상 표(27:29) — 1991~2026, 비용 반영
const TARGET = { QQQ: [15.4, -82.8, 0.83, 37.8], QLD: [19.7, -98.9, 0.80, 67.6], TQQQ: [16.4, -100.0, 0.81, 83.9] }
const a = idxOf(mkt, '1991-01-02'), b = mkt.dates.length - 1
const yrs = years(mkt, a, b)
const rfDaily = mkt.dates.slice(a, b + 1).map((d, j) => j === 0 ? 0 : (mkt.irx[a + j - 1] / 100) * ((Date.parse(d) - Date.parse(mkt.dates[a + j - 1])) / 864e5) / 365)
console.log(`\n── (2) 비교 대상 보유 성과 ${mkt.dates[a]}~${mkt.dates[b]} (${yrs.toFixed(2)}년). 목표: CAGR/MDD/Sortino/Ulcer`)
for (const [name, t] of Object.entries(TARGET)) console.log(`   목표 ${name.padEnd(5)} ${t.join(' / ')}`)
for (const preDivYield of [0, 0.25, 0.5, 0.75, 1.0]) {
  for (const spread of [0, 0.5]) {
    for (const divs of [true, false]) {
      if (!divs && preDivYield > 0) continue
      const prod = buildProducts(mkt, { ...COST_DEFAULT, preDivYield, spread, divs })
      const cells = ['QQQ', 'QLD', 'TQQQ'].map((name, k) => {
        const v = holdCurve(mkt, prod, k, a, b)
        const s = sortinoVariants(v, rfDaily, mkt.dates.slice(a, b + 1), yrs)
        return `${name} ${f(cagr(v, yrs), 1)}/${f(maxDD(v), 1)}/` +
          `S[d0 ${s.d0.toFixed(2)} d0c ${s.d0c.toFixed(2)} dx ${s.dx.toFixed(2)} m0 ${s.m0.toFixed(2)} neg ${s.neg.toFixed(2)}]/` +
          `U[d ${ulcer(v).toFixed(1)} m ${ulcer(v, mkt.dates.slice(a, b + 1)).toFixed(1)}]`
      })
      console.log(`\npre배당 ${divs ? preDivYield : '무배당'}%, 스프레드 ${spread}%`)
      for (const c of cells) console.log('   ' + c)
    }
  }
}
