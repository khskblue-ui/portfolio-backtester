// 3단계: 규칙 구현 자체 검사 (손으로 만든 짧은 시계열)
// 사용: node scripts/tripod/selftest.mjs  — 실패 시 exit 1
import assert from 'node:assert/strict'
import { computeSignals, simulate, buildProducts, drawdown52, loadMarket, TARGETS } from './lib.mjs'

const NOCOST = { preDivYield: 0, etfFee: 0, levFee: 0, spread: 0, divs: false }
function fakeMarket(close, vix, open = null) {
  const n = close.length
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2000, 0, 3) + i * 864e5).toISOString().slice(0, 10))
  return {
    dates, close, high: close.slice(), open: open ?? close.map((c, i) => (i ? close[i - 1] : c)),
    vix: Array.isArray(vix) ? vix : new Array(n).fill(vix), irx: new Array(n).fill(0),
    etfStart: '2999-01-01', divYield: new Map(),
  }
}
// MA 3일, 낙폭창 3일로 줄인 규칙 — 계산을 손으로 따라갈 수 있게
const R = { maWin: 3, vixWin: 1, ddDef: 'c252' }
const small = (mkt, rule = {}) => {
  // drawdown52는 252일 창이라 짧은 시계열에선 NaN → 테스트에선 낙폭 조건을 끈다
  return computeSignals(mkt, { ...R, useDD: false, ...rule })
}
let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('ok', name) }

t('히스테리시스: 밴드 안에서는 직전 국면 유지', () => {
  // MA3: i=2부터. 100,100,100 → MA 100, p=100 → 밴드 안, init=cash → 국면 없음
  const c = [100, 100, 100, 103, 103, 103, 100, 97, 85, 85, 85, 92]
  const s = small(fakeMarket(c, 15))
  assert.equal(s.regime[2], null) // 첫 밴드 이탈 전
  assert.equal(s.target[2], 'CASH')
  assert.equal(s.regime[3], 'UP') // 103 > 1.01×MA 101
  assert.equal(s.regime[6], 'UP') // 100, MA 102 → 밴드 안 → 유지
  assert.equal(s.regime[7], 'UP') // 97, MA 100 → 밴드 안 → 유지
  assert.equal(s.regime[8], 'DOWN') // 85 < 0.95×MA 94
  assert.equal(s.regime[10], 'DOWN') // 85, MA 85 → 밴드 안 → 유지
  assert.equal(s.target[10], 'B15') // 하락 + VIX 15 < 18
  assert.equal(s.regime[11], 'UP') // 92 > 1.01×MA 87.3
})

t('경계값 등호: 1% "위"·5% "넘게 아래"는 엄격 부등호', () => {
  // MA=100이 되도록 앞 두 날을 맞추고 셋째 날 가격을 경계에 둔다: (a+b+p)/3 = 100
  const up = fakeMarket([100, 98.5, 101.5], 15) // MA 100, p=101.5 → >101 → UP
  assert.equal(small(up).regime[2], 'UP')
  const eqUp = fakeMarket([99.5, 99.5, 101], 15) // MA 100, p=101 → 1.01×MA와 같음 → UP 아님
  assert.equal(small(eqUp).regime[2], null)
  const eqDn = fakeMarket([102.5, 102.5, 95], 15) // MA 100, p=95 → 0.95×MA와 같음 → DOWN 아님
  assert.equal(small(eqDn).regime[2], null)
})

t('VIX 경계: 상승 28 이상이면 1.5배, 하락 18 이상이면 현금', () => {
  const c = [100, 98.5, 101.5]
  assert.equal(small(fakeMarket(c, 27.99)).target[2], 'T3')
  assert.equal(small(fakeMarket(c, 28)).target[2], 'B15')
  const d = [103, 103, 94]
  assert.equal(small(fakeMarket(d, 17.99)).target[2], 'B15')
  assert.equal(small(fakeMarket(d, 18)).target[2], 'CASH')
})

t('낙폭 경계: 9% "이내"는 −9.00% 포함', () => {
  const n = 260
  const c = Array.from({ length: n }, (_, i) => (i < 255 ? 100 + i * 0.1 : 0))
  const peak = c[254]
  c[255] = peak * 0.91; c[256] = peak * 0.9099
  const dd = drawdown52(fakeMarket(c, 15), 'c252')
  assert.ok(Math.abs(dd[255] + 0.09) < 1e-12)
  const s = computeSignals(fakeMarket(c, 15), { maWin: 3, vixWin: 1, downBand: 0, upBand: 0 })
  // upBand 0 → 항상 UP. −9.00%는 T3, −9.01%는 B15
  assert.equal(s.target[255], 'T3')
  assert.equal(s.target[256], 'B15')
})

t('상승 1.5배 ↔ 하락 1.5배는 보유가 같아 매매가 아니다', () => {
  // UP + VIX 30 → B15, 이후 DOWN + VIX 15 → B15
  const c = [100, 98.5, 101.5, 101.5, 101.5, 90, 88, 86]
  const v = [30, 30, 30, 30, 30, 15, 15, 15]
  const mkt = fakeMarket(c, v)
  const s = small(mkt)
  assert.equal(s.target[2], 'B15'); assert.equal(s.regime[2], 'UP')
  assert.equal(s.target[6], 'B15'); assert.equal(s.regime[6], 'DOWN')
  const r = simulate(mkt, buildProducts(mkt, NOCOST), s, { startIdx: 3, exec: 'close1', costBps: 0 }) // close1은 전일 판정이 있어야 출발
  assert.equal(r.trades.length, 0)
})

t('V3-B: 밴드 안에서는 VIX가 바뀌어도 포트폴리오 고정', () => {
  const c = [100, 98.5, 101.5, 100.5, 100.5]
  const v = [15, 15, 15, 30, 30]
  const a = small(fakeMarket(c, v), { hold: 'A' }), b = small(fakeMarket(c, v), { hold: 'B' })
  assert.equal(a.target[4], 'B15') // 국면 UP 유지 + VIX 30 → 1.5배
  assert.equal(b.target[4], 'T3') // 밴드 안 → 어제 포트폴리오 그대로
})

t('체결 시점: close0은 판정 당일, close1은 다음 날 종가에 교체', () => {
  const c = [100, 100, 100, 103, 106, 109, 112]
  const mkt = fakeMarket(c, 15)
  const s = small(mkt)
  const p = buildProducts(mkt, NOCOST)
  const r0 = simulate(mkt, p, s, { startIdx: 2, exec: 'close0', costBps: 0 })
  const r1 = simulate(mkt, p, s, { startIdx: 2, exec: 'close1', costBps: 0 })
  assert.equal(r0.trades[0].i, 3); assert.equal(r1.trades[0].i, 4)
  // close0: 4일차부터 3배 → 106/103, 109/106, 112/109 를 3배로
  const g = (a, b) => 1 + 3 * (b / a - 1)
  assert.ok(Math.abs(r0.v.at(-1) - g(103, 106) * g(106, 109) * g(109, 112)) < 1e-12)
  assert.ok(Math.abs(r1.v.at(-1) - g(106, 109) * g(109, 112)) < 1e-12)
})

t('시가가 전일 종가 복사본이면 다음 날 시가 체결 ≡ 당일 종가 체결', () => {
  // 야후 ^NDX 1999년 이전 시가의 성질. 이 등가성이 "시가 체결" 결과를 부풀린다
  const c = [100, 100, 100, 103, 101, 106, 100, 94, 99, 104, 107]
  const mkt = fakeMarket(c, [15, 15, 15, 15, 30, 30, 15, 15, 15, 15, 15])
  const s = small(mkt)
  const p = buildProducts(mkt, NOCOST)
  const r0 = simulate(mkt, p, s, { startIdx: 2, exec: 'close0', costBps: 0 })
  const ro = simulate(mkt, p, s, { startIdx: 2, exec: 'open1', costBps: 0 })
  assert.ok(r0.trades.length >= 2)
  assert.ok(Math.abs(r0.v.at(-1) - ro.v.at(-1)) < 1e-12)
})

t('가상 3배: 무비용이면 일간 +1% → +3%', () => {
  const mkt = fakeMarket([100, 101], 15)
  const p = buildProducts(mkt, NOCOST)
  assert.ok(Math.abs(p.full[2][1] - 1.03) < 1e-12)
  assert.ok(Math.abs(p.full[1][1] - 1.02) < 1e-12)
})

t('실데이터 교차 구현: 고정 비중·무비용이면 Σ w·r 직접 곱과 simulate가 같다', () => {
  const mkt = loadMarket({ end: '2026-08-28' })
  const prod = buildProducts(mkt)
  const sig = computeSignals(mkt)
  const a = mkt.dates.indexOf('1991-01-02'), b = mkt.dates.length - 1
  for (const [exec, lag] of [['close0', 0], ['close1', 1], ['close2', 2]]) {
    let v = 1
    for (let i = a + 1; i <= b; i++) v *= TARGETS[sig.target[i - 1 - lag] ?? 'CASH'].reduce((s, w, k) => s + w * prod.full[k][i], 0)
    const sim = simulate(mkt, prod, sig, { startIdx: a, endIdx: b, exec, rebal: 'daily', costBps: 0 })
    assert.ok(Math.abs(sim.v.at(-1) / v - 1) < 1e-9, exec)
  }
})

console.log(`\n${pass}개 통과`)
