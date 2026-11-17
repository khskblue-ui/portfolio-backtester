import { QQQ, IRX, ALLQ, pct } from './lib.mjs'
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.round(p * (s.length - 1))] }
// 현금 지수
const ci = [1]; { let irx = 0; for (let i = 1; i < ALLQ.length; i++) { if (IRX.has(ALLQ[i - 1])) irx = IRX.get(ALLQ[i - 1]); ci.push(ci[i - 1] * (1 + (irx / 100) * ((Date.parse(ALLQ[i]) - Date.parse(ALLQ[i - 1])) / 864e5 / 365))) } }
const P = ALLQ.map((d) => QQQ.get(d))
const ath = []; { let m = 0; for (const p of P) { m = Math.max(m, p); ath.push(m) } }
console.log('자료 마지막:', ALLQ.at(-1), 'QQQ', P.at(-1).toFixed(2), '역대 최고 대비', pct(P.at(-1) / ath.at(-1) - 1))
// 시작일: QQQ가 역대 최고에서 nearPct 이내인 모든 거래일. 그날부터 -20% 첫 도달(다음 거래일 종가 체결)까지.
function waitStats(near, dd = -0.2) {
  const rows = []
  for (let i = 0; i < P.length; i++) {
    if (P[i] / ath[i] - 1 < -near) continue
    let j = i + 1, pk = ath[i]
    while (j < P.length) { pk = Math.max(pk, P[j]); if (P[j] / pk - 1 <= dd) break; j++ }
    if (j >= P.length - 1) { rows.push({ i, censored: true, wait: (Date.parse(ALLQ.at(-1)) - Date.parse(ALLQ[i])) / 864e5 / 365.25, rel: P.at(-1) / P[i] }); continue }
    const k = j + 1 // 체결일
    rows.push({ i, k, censored: false, wait: (Date.parse(ALLQ[k]) - Date.parse(ALLQ[i])) / 864e5 / 365.25, rel: P[k] / P[i], cashRel: ci[k] / ci[i] })
  }
  return rows
}
for (const near of [0.0001, 0.05, 0.1]) {
  const rows = waitStats(near), done = rows.filter((r) => !r.censored), cen = rows.filter((r) => r.censored)
  const w = done.map((r) => r.wait), rel = done.map((r) => r.rel - 1), adv = done.map((r) => r.cashRel / r.rel - 1)
  console.log(`\n시작: 역대 최고 대비 ${pct(-near, 0).trim()} 이내인 날 ${rows.length}일 (그중 아직 -20%가 오지 않은 날 ${cen.length}일, 대기 ${q(cen.map((r) => r.wait), 0).toFixed(1)}~${q(cen.map((r) => r.wait), 1).toFixed(1)}년, 그 사이 QQQ ${pct(q(cen.map((r) => r.rel - 1), 0.5))})`)
  console.log(`  대기 기간(년): p10 ${q(w, 0.1).toFixed(1)} p25 ${q(w, 0.25).toFixed(1)} med ${q(w, 0.5).toFixed(1)} p75 ${q(w, 0.75).toFixed(1)} p90 ${q(w, 0.9).toFixed(1)} max ${q(w, 1).toFixed(1)}`)
  console.log(`  체결가 / 시작일 가격 − 1: p10 ${pct(q(rel, 0.1))} p25 ${pct(q(rel, 0.25))} med ${pct(q(rel, 0.5))} p75 ${pct(q(rel, 0.75))} p90 ${pct(q(rel, 0.9))}  시작가보다 비싸게 산 비율 ${pct(rel.filter((x) => x > 0).length / rel.length, 0)}`)
  console.log(`  기다린 10%p의 이득(현금 이자 포함, QQQ 수량 기준): med ${pct(q(adv, 0.5))} p25 ${pct(q(adv, 0.25))} p75 ${pct(q(adv, 0.75))}  기다린 쪽이 유리 ${pct(adv.filter((x) => x > 0).length / adv.length, 0)}`)
}
// -20% 사건 자체는 몇 번인가(독립 사건 수)
let pk = 0, hit = false; const hits = []
P.forEach((p, i) => { if (p > pk) { pk = p; hit = false } else if (!hit && p / pk - 1 <= -0.2) { hit = true; hits.push(ALLQ[i]) } })
console.log('\n-20% 사건(새 최고가로 초기화):', hits.join(', '))
// 문턱별: 평균 대기와 기다린 쪽이 유리한 비율 (시작: 최고가 5% 이내)
console.log('\n문턱별(시작: 최고가 대비 5% 이내인 날)')
for (const dd of [-0.1, -0.15, -0.2, -0.25, -0.3]) {
  const rows = waitStats(0.05, dd), done = rows.filter((r) => !r.censored)
  const adv = done.map((r) => r.cashRel / r.rel - 1), w = done.map((r) => r.wait)
  console.log(`  ${pct(dd, 0)}: 미도달 ${rows.length - done.length}/${rows.length}, 대기 med ${q(w, 0.5).toFixed(1)}년 p90 ${q(w, 0.9).toFixed(1)}년, 기다린 쪽 유리 ${pct(adv.filter((x) => x > 0).length / adv.length, 0)}, 이득 med ${pct(q(adv, 0.5))}`)
}
// 기간별 분해: 2000년 버블 전 시작 vs 2003년 이후 시작
for (const [a, b] of [['1999-03-10', '2002-12-31'], ['2003-01-01', '2026-12-31']]) {
  const rows = waitStats(0.05).filter((r) => ALLQ[r.i] >= a && ALLQ[r.i] <= b), done = rows.filter((r) => !r.censored)
  const adv = done.map((r) => r.cashRel / r.rel - 1)
  console.log(`시작 ${a}~${b}: ${rows.length}일(미도달 ${rows.length - done.length}), 기다린 쪽 유리 ${pct(adv.filter((x) => x > 0).length / Math.max(1, adv.length), 0)}, 이득 med ${pct(q(adv, 0.5))}`)
}
