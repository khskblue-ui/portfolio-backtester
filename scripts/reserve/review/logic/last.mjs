import { sim2, pct, allDates, scenFor, QQQ, athBefore } from './sim2.mjs'
// ATH 날짜와 1번이 걸리는 값
let m = 0, md = ''; for (const d of allDates) if (QQQ.get(d) > m) { m = QQQ.get(d); md = d }
console.log('ATH', md, m, '1번 기준값', (m * 0.8).toFixed(2), '지금에서 더 내려야 하는 폭', pct(m * 0.8 / QQQ.get(allDates.at(-1)) - 1))
// "1번으로 산 뒤부터"를 글자 그대로 읽으면(1번이 실제로 샀을 때만 2번이 켜짐) s1999에서 어떻게 되나: upper를 끈 것과 같다
const s = scenFor('1999-03-10'); const a = sim2(s.dates, s.assets, s.base, {}), b = sim2(s.dates, s.assets, s.base, { upper: 9 })
console.log('s1999 코드 해석', pct(a.cagr), pct(a.mdd), '산', a.buys.length, '판', a.sells.length, '| 글자 그대로(1번이 안 샀으니 2번 꺼짐)', pct(b.cagr), pct(b.mdd), '산', b.buys.length, '판', b.sells.length)
// 2번이 걸리는 데 필요한 하락폭: 현금 c0에서
for (const c of [0.201, 0.25, 0.30, 0.35, 0.39]) console.log('현금', pct(c), '에서 40%가 되려면 나머지 자산이', pct(1 - 1.5 * c / (1 - c)), '내려야')
// 2020, 2022 하락 직전 현금 위치 (세 구간)
for (const st of ['2014-09-17', '2004-11-18', '1999-03-10']) { const x = scenFor(st), r = sim2(x.dates, x.assets, x.base, {}); const f = (d) => pct(r.series.find((p) => p.d >= d).w.cash); console.log(st, '2020-02-19 현금', f('2020-02-19'), '2021-11-19 현금', f('2021-11-19'), '2022년 중 최고 현금', pct(Math.max(...r.series.filter((p) => p.d.startsWith('2022')).map((p) => p.w.cash)))) }
