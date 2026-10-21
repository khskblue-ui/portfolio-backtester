// 4단계 상세: 한 조합의 결과를 영상 목표값 전부와 나란히 출력 + 체결 시차 진단
// 사용: node scripts/tripod/detail.mjs [exec] [ddDef] [hold]   (기본 close1 c252 A)
import { setup, evaluate, VIDEO } from './run.mjs'
import { computeSignals, simulate, RULE_DEFAULT, cagr, maxDD, years, idxOf } from './lib.mjs'

const [exec = 'close1', ddDef = 'c252', hold = 'A'] = process.argv.slice(2)
const ctx = setup()
const r = evaluate(ctx, { ddDef, hold }, { exec })
const NM = ['트라이팟', 'QQQ', 'QLD', 'TQQQ']
const f1 = (x) => x.toFixed(1)
const row = (label, mine, video) => console.log(`  ${label.padEnd(10)} ${mine.map((x) => f1(x).padStart(7)).join('')}   영상 ${video.map((x) => f1(x).padStart(6)).join('')}`)

console.log(`조합: exec=${exec} ddDef=${ddDef} hold=${hold}  (${ctx.mkt.dates[ctx.a]}~${ctx.mkt.dates[ctx.b]})`)
console.log('\n[4.1] 35년 성과 CAGR / MDD / Sortino / Ulcer')
const perfs = [r.perf, ...ctx.bench.map((v) => evaluate.length && null)].slice(0, 1)
console.log(`  트라이팟  ${f1(r.perf.cagr)} / ${f1(r.perf.mdd)} / ${r.perf.sortino.toFixed(2)} / ${f1(r.perf.ulcer)}   영상 ${VIDEO.perf.TRIPOD.join(' / ')}`)
void perfs

console.log(`\n[4.2] 보유 기간별 연환산 중앙값 (월말 진입)          ${NM.join(' / ')}`)
for (const n of [1, 3, 5, 10]) row(`${n}년`, r.median[n], VIDEO.median[n])
console.log('\n[4.3] 원금 손실 확률 (월말 진입)')
for (const n of [1, 3, 5, 7, 10]) row(`${n}년`, r.loss[n], VIDEO.loss[n])
console.log(`\n[4.4] 1억 원 10년 보유 최종액(억) 최악/25%/중간/최고 — 월말 진입 ${r.count10}개`)
r.dist10.forEach((d, k) => console.log(`  ${NM[k].padEnd(8)} ${d.map((x) => x.toFixed(2).padStart(8)).join('')}   영상 ${Object.values(VIDEO.dist10)[k].join(' / ')}`))
console.log(`  최악 시작 시점: ${r.worst10Start} (영상 2000년 9월)`)
console.log(`  일별 진입 ${r.dist10daily.count}개: ${r.dist10daily.q.map((x) => x.toFixed(2)).join(' / ')}`)
console.log('\n[4.5] QLD 대비 승률 (월말 진입)')
console.log(`  ${[1, 3, 5, 10].map((n) => `${n}년 ${f1(r.winVsQld[n])}%`).join(' · ')}   (일별 10년 ${f1(r.winVsQldDaily10)}%)   영상 59 · 62 · 76 · 78`)
console.log('\n[4.6] 매매 빈도')
const t = r.trades
console.log(`  연평균 ${t.perYear.toFixed(2)}회(목표 전환 ${t.count}회, 주문 단위 ${t.orders.toFixed(1)}회/년)  최다 ${t.maxPerYear}회(${t.maxYear})`)
console.log(`  무매매 해(1991~2025): ${t.zeroYears.length}개 [${t.zeroYears.join(', ')}]  최장 무매매 ${(t.longestGapDays / 365.25).toFixed(2)}년 (${t.longestAt})`)
console.log(`  간격 중앙값 ${f1(t.gapMedian)}일 · 평균 ${f1(t.gapMean)}일   영상 8.1회 · 5개 · 2년 7개월 · 21회 · 6일 · 45일`)
console.log('\n[4.7] 구간 결과 (1억 원 → 만 원)')
VIDEO.periods.forEach((p, j) => {
  const mine = r.periods.map((c) => Math.round(c[j] * 1e4))
  console.log(`  ${p.label.padEnd(16)} ${NM.map((n, k) => `${n} ${mine[k]}`).join('  ')}   영상 ${JSON.stringify(p).replace(/"label":"[^"]+",?/, '')}`)
})
console.log('\n[4.8] 보험료 통계')
console.log(`  TQQQ 이탈 에피소드 ${r.insurance.episodes}회, 그중 TQQQ 유지가 나았던 경우 ${r.insurance.tqqqBetter}회`)
console.log(`  (변형) 위험 축소 전이 ${r.insurance.cuts}회, 이전 보유 유지가 나았던 경우 ${r.insurance.holdBetter}회   영상 55회 / 40회 / 15회`)
console.log('\n[6] 2026년 매매')
for (const x of r.trades2026) console.log('  ' + x)

// 체결 시차 진단: 같은 신호를 몇 거래일 늦게 반영하느냐에 따른 CAGR
console.log('\n[4.9] 체결 시차 진단 (같은 규칙)')
const sig = computeSignals(ctx.mkt, { ...RULE_DEFAULT, ddDef, hold })
const lagRow = (from) => {
  const a = idxOf(ctx.mkt, from)
  return ['peek', 'close0', 'open1', 'close1', 'close2'].map((e) => {
    const { v } = simulate(ctx.mkt, ctx.prod, sig, { startIdx: a, endIdx: ctx.b, exec: e })
    return `${e} ${(cagr(v, years(ctx.mkt, a, ctx.b)) * 100).toFixed(1)}%/${(maxDD(v) * 100).toFixed(1)}%`
  }).join('  ')
}
console.log(`  1991~  ${lagRow('1991-01-02')}`)
console.log(`  2000~  ${lagRow('2000-01-03')}   (시가가 실제 값인 구간)`)
console.log('  영상: 당일 종가 체결 44.3%, 다음 거래일 체결 24.7%')
