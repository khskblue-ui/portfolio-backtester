/**
 * timing-math.mjs 독립 재검증 — 같은 수치를 "다른 구현"으로 재계산해 교차 대조.
 * (지침서 docs/guides/trading-discipline.md의 모든 실증 수치가 대상)
 * 구현을 일부러 다르게: 프리픽스 곱·로그 합·함수형 순회·다른 상태기계.
 * 하나라도 어긋나면 exit 1.
 */
import { readFileSync } from 'node:fs'

const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))
const dates = h.series.dates
const stock = h.series.stock
const bill = h.series.bill
const bond = h.series.bond
const N = dates.length

let failures = 0
const check = (name, actual, expected, tol = 0.005) => {
  const rel = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12)
  const ok = rel <= tol
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 재계산 ${actual} vs 문서 ${expected}${ok ? '' : ` (상대오차 ${(rel * 100).toFixed(2)}%)`}`)
}

// [0] 전체 성장 — 로그 합으로 재계산
{
  let logSum = 0
  for (let i = 1; i < N; i++) logSum += Math.log(stock[i] / stock[i - 1])
  const mult = Math.exp(logSum)
  check('[0] 126년 실질 배수', Math.round(mult), 4285, 0.001)
  check('[0] 연 수익률(%)', (Math.pow(mult, 12 / (N - 1)) - 1) * 100, 6.84, 0.002)
}

// [a] 30년 5인 비교 — 다른 순회(연 단위 min/max를 정렬로) 재계산
{
  const acc = { p: 0, w: 0, im: 0, d: 0, c: 0 }
  let windows = 0
  for (let start = 0; start + 360 <= N - 1; start += 12) {
    const end = start + 360
    for (let y = 0; y < 30; y++) {
      const idx = Array.from({ length: 12 }, (_, k) => start + y * 12 + k)
      const sorted = [...idx].sort((a, b) => stock[a] - stock[b])
      acc.p += (1200 * stock[end]) / stock[sorted[0]]
      acc.w += (1200 * stock[end]) / stock[sorted[11]]
      acc.im += (1200 * stock[end]) / stock[idx[0]]
      acc.d += idx.reduce((s, m) => s + (100 * stock[end]) / stock[m], 0)
      acc.c += (1200 * bill[end]) / bill[idx[0]]
    }
    windows++
  }
  for (const k of Object.keys(acc)) acc[k] /= windows
  check('[a] 창 개수', windows, 97, 0)
  check('[a] 신의 타이밍 $', acc.p, 146614)
  check('[a] 즉시 $', acc.im, 133922)
  check('[a] 적립 $', acc.d, 130808)
  check('[a] 최악 $', acc.w, 118123)
  check('[a] 현금 $', acc.c, 41309)
  check('[a] 즉시/신 %', (acc.im / acc.p) * 100, 91.3, 0.005)
  check('[a] 적립/신 %', (acc.d / acc.p) * 100, 89.2, 0.005)
  check('[a] 최악/신 %', (acc.w / acc.p) * 100, 80.6, 0.005)
  check('[a] 현금/신 %', (acc.c / acc.p) * 100, 28.2, 0.005)
  check('[a] 신/적립 (문서 "+12%")', (acc.p / acc.d - 1) * 100, 12, 0.02)
  check('[a] 현금/적립 (문서 "-68%")', (1 - acc.c / acc.d) * 100, 68, 0.01)
}

// [b] 최고의 달 제외 — 로그 합에서 상위 k개 로그를 빼는 방식으로 재계산
{
  const logs = []
  for (let i = 1; i < N; i++) logs.push(Math.log(stock[i] / stock[i - 1]))
  const total = logs.reduce((a, b) => a + b, 0)
  const desc = [...logs].sort((a, b) => b - a)
  const missTop = (k) => Math.exp(total - desc.slice(0, k).reduce((a, b) => a + b, 0)) / Math.exp(total)
  check('[b] 최고 10개월 제외 잔존 %', missTop(10) * 100, 18.6, 0.005)
  check('[b] 최고 30개월 제외 잔존 %', missTop(30) * 100, 3.4, 0.01)
  check('[b] 문서 "최종 자산의 81% 소멸"', (1 - missTop(10)) * 100, 81, 0.01)
  // Top10이 전부 위기 국면(1930년대·1982·1991·2009)인지 — 연도 집합 확인
  const years = logs
    .map((v, i) => [v, i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10)
    .map(([, i]) => dates[i + 1].slice(0, 4))
  const crisisEras = years.every((y) => ['1932', '1933', '1938', '1982', '1991', '2009'].includes(y))
  check('[b] Top10 전부 위기 국면 연도', crisisEras ? 1 : 0, 1, 0)
}

// [c] 일시 vs 12개월 분할 — 승률·중앙값·5퍼센타일 재계산 (역방향 누적)
{
  const gaps = []
  for (let m = 0; m + 12 < N; m++) {
    const ls = stock[m + 12] / stock[m]
    let dca = 0
    for (let k = 0; k < 12; k++) dca += (bill[m + k] / bill[m]) * (stock[m + 12] / stock[m + k])
    dca /= 12
    gaps.push(ls / dca - 1)
  }
  const wins = gaps.filter((g) => g > 0).length
  const s = [...gaps].sort((a, b) => a - b)
  check('[c] 표본 수', gaps.length, 1505, 0)
  check('[c] 일시 승률 %', (wins / gaps.length) * 100, 67.1, 0.005)
  check('[c] 중앙값 %p', s[Math.floor(gaps.length / 2)] * 100, 3.6, 0.03)
  check('[c] 하위 5% %p', s[Math.floor(gaps.length * 0.05)] * 100, -13.2, 0.02)
}

// [d] 공포매도 프로토콜 — 다른 상태기계(이벤트 목록 먼저 추출)로 재계산
{
  // 낙폭 -25% 도달 이벤트와 회복 이벤트를 먼저 스캔
  let peak = stock[0], inMkt = true, exitPeak = 0
  let v = 1, triggers = 0
  const trigYears = []
  for (let i = 1; i < N; i++) {
    const r = stock[i] / stock[i - 1]
    if (inMkt) {
      v *= r
      if (stock[i] > peak) peak = stock[i]
      if (stock[i] <= peak * 0.75) {
        inMkt = false
        exitPeak = peak
        triggers++
        trigYears.push(dates[i].slice(0, 4))
      }
    } else {
      v *= bill[i] / bill[i - 1]
      if (stock[i] >= exitPeak) {
        inMkt = true
        peak = stock[i]
      }
    }
  }
  check('[d] 발동 횟수', triggers, 10, 0)
  check('[d] 프로토콜 배수', Math.round(v), 161, 0.01)
  check('[d] 프로토콜 연수익 %', (Math.pow(v, 12 / (N - 1)) - 1) * 100, 4.1, 0.01)
  check('[d] 문서 "약 27분의 1"', 4285 / v, 26.6, 0.02)
  check('[d] 문서 "약 13년에 한 번"', (N - 1) / 12 / triggers, 12.6, 0.01)
  console.log(`     발동 연도: ${trigYears.join(', ')}`)
}

// [e] 7개 고점 적립 손익분기 — 이분 없이 직접 스캔 재계산
{
  const expected = { '1916-11': 2.5, '1929-09': 0.5, '1937-02': 1.4, '1946-04': 2.2, '1968-12': 0.4, '1973-01': 3.0, '2000-08': 3.3 }
  for (const ep of h.episodes) {
    const p = dates.indexOf(ep.peak)
    let sh = 0, paid = 0, be = null
    for (let i = p; i < N && be == null; i++) {
      sh += 1 / stock[i]
      paid += 1
      if (i > p && sh * stock[i] >= paid) be = (i - p) / 12
    }
    check(`[e] ${ep.peak} 적립 손익분기(년)`, be, expected[ep.peak], 0.05)
  }
}

// [f] 보유 기간 손실 확률 — filter 방식 재계산
{
  const prob = (yrs) => {
    const hMo = yrs * 12
    const rs = Array.from({ length: N - hMo - 1 }, (_, i) => stock[i + hMo] / stock[i])
    return (rs.filter((r) => r < 1).length / rs.length) * 100
  }
  check('[f] 1년 손실확률 %', prob(1), 31.2, 0.005)
  check('[f] 5년 손실확률 %', prob(5), 23.0, 0.005)
  check('[f] 10년 손실확률 %', prob(10), 13.8, 0.005)
  check('[f] 20년 손실확률 %', prob(20), 0.1, 0.5)
  check('[f] 30년 손실확률 %', prob(30), 0.0, 0)
}

// [g] 비용 드래그 — 대수적 항등식으로 재계산
{
  const eff = (drag) => (1 - Math.pow((1.0684 - drag) / 1.0684, 30)) * 100
  check('[g] 0.5% 드래그 → 30년 감소 %', eff(0.005), 13, 0.04)
  check('[g] 1.0% 드래그 → 30년 감소 %', eff(0.01), 25, 0.02)
  check('[g] 2.0% 드래그 → 30년 감소 %', eff(0.02), 43, 0.02)
}

// [h] 60/40 — 별도 구현 재계산
{
  let start = 0
  while (start < N && (bond[start] == null || stock[start] == null)) start++
  let vR = 1, sD = 0.6, bD = 0.4, vS = 1
  let pR = 1, mR = 0, pD = 1, mD = 0, pS = 1, mS = 0
  for (let i = start + 1; i < N; i++) {
    if (bond[i] == null || bond[i - 1] == null) continue
    const rs = stock[i] / stock[i - 1], rb = bond[i] / bond[i - 1]
    vR *= 0.6 * rs + 0.4 * rb
    sD *= rs; bD *= rb; vS *= rs
    const vDd = sD + bD
    if (vR > pR) pR = vR; mR = Math.min(mR, vR / pR - 1)
    if (vDd > pD) pD = vDd; mD = Math.min(mD, vDd / pD - 1)
    if (vS > pS) pS = vS; mS = Math.min(mS, vS / pS - 1)
  }
  const yrs = (N - 1 - start) / 12
  const cagr = (v) => (Math.pow(v, 1 / yrs) - 1) * 100
  check('[h] 60/40 리밸 연수익 %', cagr(vR), 4.97, 0.01)
  check('[h] 60/40 리밸 낙폭 %', mR * 100, -50, 0.02)
  check('[h] 60/40 방치 연수익 %', cagr(sD + bD), 6.41, 0.01)
  check('[h] 60/40 방치 낙폭 %', mD * 100, -68, 0.02)
  check('[h] 주식 낙폭 %', mS * 100, -77, 0.02)
}

console.log(failures === 0 ? '\n독립 재검증 전체 통과' : `\n실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
