/**
 * "타이밍 실패의 수학" — 지침서 실증 계산 (public/data/history.json 실질 총수익 기준)
 * 전부 월간 해상도(1900-01 ~ dataEnd), 실질(CPI 조정) 기준.
 */
import { readFileSync } from 'node:fs'

const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))
const dates = h.series.dates
const stock = h.series.stock // 실질 TR 지수 (1900-01 = 100)
const bill = h.series.bill // 실질 단기국채(현금) 지수
const N = dates.length
console.log(`데이터: ${dates[0]} ~ ${dates[N - 1]} (${N}개월), 실질 총수익 기준\n`)

// 전체 기간 성장 배수
console.log(`[0] 시장 자체: 1900-01 → ${dates[N - 1]} 실질 ${(stock[N - 1] / stock[0]).toFixed(0)}배 (연 ${((Math.pow(stock[N - 1] / stock[0], 12 / (N - 1)) - 1) * 100).toFixed(2)}%)`)

// ── (a) 30년 창: 연 $1,200를 넣는 4명의 투자자 (Schwab 스타일, 롤링 전 구간 평균) ──
// perfect: 그 해 최저가 달에 / worst: 최고가 달에 / immediate: 1월에 / dca: 매달 $100
{
  const results = { perfect: [], worst: [], immediate: [], dca: [], cashOnly: [] }
  for (let start = 0; start + 360 <= N - 1; start += 12) {
    const end = start + 360
    let sP = 0, sW = 0, sI = 0, sD = 0, sC = 0
    for (let y = 0; y < 30; y++) {
      const y0 = start + y * 12
      const months = Array.from({ length: 12 }, (_, k) => y0 + k)
      const lo = months.reduce((a, b) => (stock[a] <= stock[b] ? a : b))
      const hi = months.reduce((a, b) => (stock[a] >= stock[b] ? a : b))
      sP += (1200 / stock[lo]) * stock[end]
      sW += (1200 / stock[hi]) * stock[end]
      sI += (1200 / stock[y0]) * stock[end]
      for (const m of months) sD += (100 / stock[m]) * stock[end]
      sC += 1200 * (bill[end] / bill[y0]) // 현금 보유 (타이밍 기다리다 영영 못 들어간 사람)
    }
    results.perfect.push(sP); results.worst.push(sW); results.immediate.push(sI); results.dca.push(sD); results.cashOnly.push(sC)
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const p = avg(results.perfect), w = avg(results.worst), i = avg(results.immediate), d = avg(results.dca), c = avg(results.cashOnly)
  console.log(`\n[a] 30년간 총 $36,000 (연 $1,200) 투입 (롤링 ${results.perfect.length}개 창 평균, 실질 최종가치):`)
  console.log(`  신(神)의 타이밍(매년 최저점): $${Math.round(p).toLocaleString()}`)
  console.log(`  즉시 투자(매년 첫 달):       $${Math.round(i).toLocaleString()} (신의 ${((i / p) * 100).toFixed(1)}%)`)
  console.log(`  매달 적립(DCA):              $${Math.round(d).toLocaleString()} (신의 ${((d / p) * 100).toFixed(1)}%)`)
  console.log(`  최악의 타이밍(매년 최고점):  $${Math.round(w).toLocaleString()} (신의 ${((w / p) * 100).toFixed(1)}%)`)
  console.log(`  현금 대기(영영 미진입):      $${Math.round(c).toLocaleString()} (신의 ${((c / p) * 100).toFixed(1)}%)`)
}

// ── (b) 최고/최악의 달 제외 효과 (1900~현재 전 기간, 월수익률 상위/하위 제외) ──
{
  const rets = []
  for (let i = 1; i < N; i++) rets.push(stock[i] / stock[i - 1])
  const grow = (excludeIdx) => {
    let g = 1
    rets.forEach((r, i) => { g *= excludeIdx.has(i) ? 1 : r })
    return g
  }
  const sortedIdx = rets.map((r, i) => [r, i]).sort((a, b) => b[0] - a[0])
  const full = grow(new Set())
  for (const k of [10, 30]) {
    const noBest = grow(new Set(sortedIdx.slice(0, k).map(([, i]) => i)))
    const noWorst = grow(new Set(sortedIdx.slice(-k).map(([, i]) => i)))
    console.log(`\n[b] ${(N - 1)}개월 중 최고 ${k}개월을 현금(0%)으로 놓치면: 전체 수익의 ${((noBest / full) * 100).toFixed(1)}% (${(full / noBest).toFixed(1)}분의 1로 감소)`)
    console.log(`    (공정 비교) 최악 ${k}개월을 피하면: ${(noWorst / full).toFixed(1)}배 — 단, 최고·최악의 달은 같은 폭락기에 몰려 있어 하나만 골라 피하기는 불가능`)
  }
  // 최고의 달들이 언제였나 (군집 증거)
  const top10 = sortedIdx.slice(0, 10).map(([r, i]) => `${dates[i + 1]}(+${((r - 1) * 100).toFixed(0)}%)`)
  console.log(`    최고의 달 Top10: ${top10.join(', ')}`)
}

// ── (c) 목돈: 일시투자 vs 12개월 분할 (대기분은 현금 수익, 12개월 후 비교) ──
{
  let lsWin = 0, total = 0, gaps = []
  for (let m = 0; m + 12 < N; m++) {
    const ls = stock[m + 12] / stock[m]
    let dcaV = 0
    for (let k = 0; k < 12; k++) {
      // k개월 대기(현금) 후 1/12 투입
      dcaV += (1 / 12) * (bill[m + k] / bill[m]) * (stock[m + 12] / stock[m + k])
    }
    if (ls > dcaV) lsWin++
    gaps.push(ls / dcaV - 1)
    total++
  }
  gaps.sort((a, b) => a - b)
  console.log(`\n[c] 목돈 일시투자 vs 12개월 분할 (${total}개 시작월, 12개월 후 실질 비교):`)
  console.log(`  일시투자 승률 ${((lsWin / total) * 100).toFixed(1)}%, 중앙값 격차 +${(gaps[Math.floor(total / 2)] * 100).toFixed(1)}%p`)
  console.log(`  단, 하위 5% 시나리오에선 일시투자가 ${(gaps[Math.floor(total * 0.05)] * 100).toFixed(1)}%p 뒤짐 (분할의 가치 = 수익이 아니라 후회 최소화)`)
}

// ── (d) 공포매도 프로토콜: -25% 도달 시 전량 매도 → 전고점 회복 시 재진입 ──
{
  let vSell = 1, vHold = 1 // 시작 $1
  let peak = stock[0], inMarket = true, exitPeak = 0, switches = 0
  for (let i = 1; i < N; i++) {
    if (inMarket) {
      vSell *= stock[i] / stock[i - 1]
      peak = Math.max(peak, stock[i])
      if (stock[i] / peak <= 0.75) { inMarket = false; exitPeak = peak; switches++ } // 매도
    } else {
      vSell *= bill[i] / bill[i - 1]
      if (stock[i] >= exitPeak) { inMarket = true; peak = stock[i] } // "안전해진 뒤" 재진입
    }
    vHold *= stock[i] / stock[i - 1]
  }
  const cagr = (v) => (Math.pow(v, 12 / (N - 1)) - 1) * 100
  console.log(`\n[d] "-25%에 팔고 전고점 회복하면 다시 산다" (${switches}회 발동) vs 계속 보유, 1900~현재:`)
  console.log(`  공포매도 프로토콜: 최종 ${vSell.toFixed(0)}배 (연 ${cagr(vSell).toFixed(2)}%)`)
  console.log(`  계속 보유:        최종 ${vHold.toFixed(0)}배 (연 ${cagr(vHold).toFixed(2)}%)`)
  console.log(`  → 같은 하락을 다 맞고, 회복 랠리만 놓치는 구조 (기계적으로 '싸게 팔고 비싸게 되삼')`)
}

// ── (e) 최악의 고점에 물린 사람: 거치식 vs 그 시점부터 월 적립 병행 ──
{
  console.log(`\n[e] 역사상 최악의 7개 고점에서 시작한 두 사람 (실질):`)
  for (const ep of h.episodes) {
    const p = dates.indexOf(ep.peak)
    // 거치식: 전고점 회복까지 = ep.underwaterMonths
    // 적립식: 고점부터 매달 $100 — 평가액 ≥ 납입액 되는 달
    let sh = 0, paid = 0, be = null
    for (let i = p; i < N; i++) {
      sh += 100 / stock[i]
      paid += 100
      if (be == null && i > p && sh * stock[i] >= paid) { be = i - p; break }
    }
    console.log(`  ${ep.peak} 고점: 거치식 원금회복 ${(ep.underwaterMonths / 12).toFixed(1)}년 vs 같은 날부터 월 적립 손익분기 ${be != null ? (be / 12).toFixed(1) + '년' : '기간 내 미도달'}`)
  }
}

// ── (f) 보유 기간별 실질 손실 확률 (롤링 전 구간) ──
{
  console.log(`\n[f] 보유 기간별 "실질 손실로 끝날 확률" (모든 시작월 롤링):`)
  for (const yrs of [1, 5, 10, 20, 30]) {
    const hMo = yrs * 12
    let neg = 0, tot = 0, worst = Infinity
    for (let i = 0; i + hMo < N; i++) {
      const r = stock[i + hMo] / stock[i]
      if (r < 1) neg++
      worst = Math.min(worst, r)
      tot++
    }
    console.log(`  ${String(yrs).padStart(2)}년 보유: 손실 확률 ${((neg / tot) * 100).toFixed(1)}% (표본 ${tot}개, 최악 ${((worst - 1) * 100).toFixed(0)}%)`)
  }
  console.log(`  주의: 손실 "확률"은 기간과 함께 줄지만, 결과의 "폭"(최악~최선 격차)은 커진다 — 시간은 확률을 다듬지 보장을 만들지 않는다`)
}

// ── (g) 비용의 복리 효과: 연 드래그가 30년 최종가치를 얼마나 깎나 ──
{
  const base = 0.0684 // 위 [0]의 실질 연수익
  console.log(`\n[g] 연 비용(수수료·스프레드·세금 드래그)이 30년 복리에 미치는 효과 (기준 연 ${(base * 100).toFixed(2)}%):`)
  for (const drag of [0.005, 0.01, 0.02]) {
    const clean = Math.pow(1 + base, 30)
    const net = Math.pow(1 + base - drag, 30)
    console.log(`  연 ${(drag * 100).toFixed(1)}% 비용 → 30년 최종가치 ${((1 - net / clean) * 100).toFixed(0)}% 감소`)
  }
}

// ── (h) 60/40 월간 리밸런싱 vs 방치(드리프트), 실질 1900~ ──
{
  const bond = h.series.bond
  let start = 0
  while (start < N && (bond[start] == null || stock[start] == null)) start++
  let vReb = 1, wS = 0.6, wB = 0.4 // 리밸런싱: 매월 60/40 복원
  let sDrift = 0.6, bDrift = 0.4 // 방치: 최초 60/40 이후 그대로
  let vStock = 1
  let pR = 1, ddR = 0, pD = 1, ddD = 0, pS = 1, ddS = 0
  for (let i = start + 1; i < N; i++) {
    if (bond[i] == null || bond[i - 1] == null) continue
    const rs = stock[i] / stock[i - 1]
    const rb = bond[i] / bond[i - 1]
    vReb *= wS * rs + wB * rb
    sDrift *= rs
    bDrift *= rb
    vStock *= rs
    const vD = sDrift + bDrift
    pR = Math.max(pR, vReb); ddR = Math.min(ddR, vReb / pR - 1)
    pD = Math.max(pD, vD); ddD = Math.min(ddD, vD / pD - 1)
    pS = Math.max(pS, vStock); ddS = Math.min(ddS, vStock / pS - 1)
  }
  const yrsTot = (N - 1 - start) / 12
  const cagr = (v) => (Math.pow(v, 1 / yrsTot) - 1) * 100
  const vDriftFinal = sDrift + bDrift
  console.log(`\n[h] 60/40 포트폴리오, ${dates[start]}~${dates[N - 1]} 실질:`)
  console.log(`  주식 100%:        연 ${cagr(vStock).toFixed(2)}% · 최대낙폭 ${(ddS * 100).toFixed(0)}%`)
  console.log(`  60/40 월 리밸런싱: 연 ${cagr(vReb).toFixed(2)}% · 최대낙폭 ${(ddR * 100).toFixed(0)}%`)
  console.log(`  60/40 방치(드리프트): 연 ${cagr(vDriftFinal).toFixed(2)}% · 최대낙폭 ${(ddD * 100).toFixed(0)}% (주식 비중이 저절로 커져 낙폭이 리밸런싱보다 깊어짐)`)
}
