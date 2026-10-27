// 방어형 후보 규칙의 계산 검사 — 합성 데이터만 쓴다(실제 시장 성과는 보지 않음). 실패하면 exit 1.
// 사용: node scripts/tripod/defense-selftest.mjs
import {
  DEF, ewmaVol, conservativeVol, referenceVol, bandRegime, varianceExposure, defenseExposure, DEFENSE,
  excessMean, kellyRaw, DEFENSE2, KELLY_FRACTION,
} from './defense-strategies.mjs'
import { weightsOf, planOf } from './strategies.mjs'

let fails = 0
const ok = (cond, msg) => { if (!cond) { fails++; console.log(`실패: ${msg}`) } else console.log(`통과: ${msg}`) }
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function bizDates(start, n) {
  const out = []
  for (let t = Date.parse(`${start}T00:00:00Z`); out.length < n; t += 864e5) {
    const d = new Date(t), w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}
/** 로그수익 배열 → 합성 시장 */
function market(logRets, start = '2000-01-03', irx = 3) {
  const dates = bizDates(start, logRets.length + 1)
  const close = [100]
  for (const r of logRets) close.push(close[close.length - 1] * Math.exp(r))
  return { dates, close, irx: dates.map(() => irx) }
}

// 1) EWMA: ±1% 교대 수익이면 분산이 처음부터 1e-4로 고정 → 연율 변동성 0.01·√252
{
  const m = market(Array.from({ length: 400 }, (_, i) => (i % 2 ? 0.01 : -0.01)))
  const v = ewmaVol(m.close, 0.94)
  ok(v[251] === null && v[252] !== null, 'EWMA는 252번째 거래일부터 값을 낸다')
  ok(near(v[300], 0.01 * Math.sqrt(252)), `±1% 교대 수익의 EWMA 변동성 = ${(0.01 * Math.sqrt(252)).toFixed(4)}`)
}

// 2) 보수적 변동성: 변동성이 오르면 빠른 추정, 내리면 느린 추정을 따른다
{
  const rets = [...Array.from({ length: 600 }, (_, i) => (i % 2 ? 0.01 : -0.01)), ...Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.03 : -0.03)), ...Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.01 : -0.01))]
  const m = market(rets)
  const f = ewmaVol(m.close, DEF.lamFast), s = ewmaVol(m.close, DEF.lamSlow), c = conservativeVol(m.close)
  ok(f[610] > s[610] && c[610] === f[610], '변동성 급등 10일 뒤: 보수적 변동성 = 빠른 추정(더 큼)')
  ok(f[680] < s[680] && c[680] === s[680], '진정 20일 뒤: 보수적 변동성 = 느린 추정(더 큼)')
}

// 3) 확장 창 중앙값: 월말에만 갱신, 표본 refMin개부터, 정렬로 구한 중앙값과 같다
{
  const r = rng(7)
  const rets = Array.from({ length: 2600 }, () => (r() - 0.5) * 0.04 * (1 + 2 * r()))
  const m = market(rets)
  const vol = conservativeVol(m.close)
  const ref = referenceVol(m, vol)
  const firstValid = vol.findIndex((x) => x !== null)
  let good = true, updates = 0, checked = 0
  for (let i = 1; i < ref.length; i++) {
    const monthEnd = i < ref.length - 1 && m.dates[i].slice(0, 7) !== m.dates[i + 1].slice(0, 7)
    if (ref[i] !== ref[i - 1] && ref[i - 1] !== null) { updates++; if (!monthEnd) good = false }
    if (monthEnd && ref[i] !== null) {
      const xs = vol.slice(firstValid, i + 1).filter((x) => x !== null).sort((a, b) => a - b), k = xs.length
      const med = k % 2 ? xs[(k - 1) / 2] : (xs[k / 2 - 1] + xs[k / 2]) / 2
      if (!near(ref[i], med, 1e-12)) good = false
      checked++
    }
  }
  const firstRef = ref.findIndex((x) => x !== null)
  const nAtFirst = vol.slice(0, firstRef + 1).filter((x) => x !== null).length
  ok(good && updates > 10 && checked > 10, `기준 변동성은 월말에만 바뀌고 정렬 중앙값과 같다(월말 ${checked}곳 대조)`)
  ok(nAtFirst >= DEF.refMin && nAtFirst < DEF.refMin + 25, `기준 변동성은 표본 ${DEF.refMin}개가 쌓인 뒤 첫 월말부터(그때 표본 ${nAtFirst}개)`)
}

// 4) 국면: 첫 이탈 전 NONE, 250일선×1.01 위로 UP, ×0.95 아래로 DOWN, 사이에서는 유지
{
  const flat = Array(300).fill(0)
  const up = [Math.log(1.02), ...Array(5).fill(0)]
  const midDrop = [Math.log(0.98 / 1.02), ...Array(3).fill(0)] // 100 근처(밴드 안)로 복귀
  const down = [Math.log(0.94 / 0.98), ...Array(3).fill(0)]
  const m = market([...flat, ...up, ...midDrop, ...down])
  const reg = bandRegime(m.close)
  ok(reg[248] === null && reg[249] === 'NONE', '250일선 준비 전 null, 준비 뒤 첫 이탈 전 NONE')
  ok(reg[301] === 'UP', '250일선 × 1.01 위 종가 → 상승 국면')
  ok(reg[307] === 'UP', '밴드 안으로 돌아와도 상승 국면 유지')
  ok(reg[311] === 'DOWN', '250일선 × 0.95 아래 종가 → 하락 국면')
}

// 5) 분산 조절 노출: 변동성이 기준과 같으면 1, 기준의 1/√2면 2(상한), 2배면 0.25
{
  const base = Array.from({ length: 1700 }, (_, i) => (i % 2 ? 0.01 : -0.01)) // 기준 변동성 = 0.01·√252
  const calm = Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.01 / Math.SQRT2 : -0.01 / Math.SQRT2))
  const wild = Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.02 : -0.02))
  const m1 = market(base)
  const V1 = varianceExposure(m1)
  const i1 = V1.findIndex((x) => x !== null)
  ok(i1 > 0 && near(V1[i1], 1, 1e-9), '기준과 같은 변동성 → V = 1')
  const m2 = market([...base, ...calm])
  // 느린 추정(λ = 0.97)은 300일 뒤에도 옛 분산이 0.97^300 ≈ 1e-4만큼 남아 V = 1.9998
  ok(near(varianceExposure(m2)[1999], 2, 1e-3), '기준의 1/√2 변동성(300일 뒤) → V ≈ 2(상한)')
  const m3 = market([...base, ...wild])
  const V3 = varianceExposure(m3)
  ok(near(V3[1999], 0.25, 1e-3), `기준의 2배 변동성 → V = 0.25 (계산 ${V3[1999].toFixed(4)}, 기준은 월말에 조금씩 오름)`)
}

// 6) 낙폭 예산: 그림자 순자산을 손으로 다시 계산하고, 여유 계수 공식(고점 대비 -10% → 0.667, -20% → 0.25)을 확인
{
  const r = rng(11)
  // 완만한 상승(저변동) 1,800일 → 상승 국면에서 2배 → 급락 구간
  const rets = [...Array.from({ length: 1800 }, () => 0.0006 + (r() - 0.5) * 0.008), ...Array(15).fill(-0.02), ...Array.from({ length: 120 }, () => 0.0005 + (r() - 0.5) * 0.008)]
  const m = market(rets)
  const L2 = defenseExposure(m, 'd2'), L1 = defenseExposure(m, 'd1')
  // 그림자 순자산 재계산
  const W = [1]
  for (let i = 1; i < m.close.length; i++) {
    const rf = (m.irx[i - 1] / 100) * ((Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5 / 365)
    const h = i >= 2 ? (L2[i - 2] ?? 0) : 0
    W.push(W[i - 1] * (1 + h * (m.close[i] / m.close[i - 1] - 1 - rf) + rf))
  }
  let good = true, cut = false
  for (let i = 1700; i < m.close.length; i++) {
    if (L2[i] === null || L1[i] === null) continue
    const M = Math.max(...W.slice(Math.max(0, i - DEF.ddWin + 1), i + 1))
    const g = Math.min(1, Math.max(0, (1 - (DEF.alpha * M) / W[i]) / (1 - DEF.alpha)))
    const V = varianceExposure(m)[i]
    const expect = L1[i] === 0 ? 0 : Math.round(Math.min(2, V * g) / DEF.step) * DEF.step
    if (L2[i] !== expect) good = false
    if (L2[i] < L1[i]) cut = true
  }
  ok(good, '낙폭 예산 노출 = 반올림(min(2, V × g)), g는 손으로 다시 계산한 그림자 순자산 기준')
  ok(cut, '급락 구간에서 낙폭 예산이 D1보다 노출을 줄인다')
  const g = (dd) => (1 - DEF.alpha / (1 - dd)) / (1 - DEF.alpha)
  ok(near(g(0), 1) && near(g(0.1), 2 / 3, 1e-9) && near(g(0.2), 0.25, 1e-9) && near(g(0.25), 0, 1e-9), '여유 계수: 고점 1, -10% 0.667, -20% 0.25, -25% 0')
}

// 6b) 금리 결측: ^IRX가 없는 날은 금리 0으로 보고 노출이 NaN이 되지 않는다(1984년 이전 나스닥 종합, FTSE100 첫날)
{
  const r = rng(5)
  const m = market(Array.from({ length: 2000 }, () => 0.0004 + (r() - 0.5) * 0.02))
  m.irx = m.irx.map((x, i) => (i < 300 ? NaN : x))
  const L2 = defenseExposure(m, 'd2')
  ok(L2.every((x) => x === null || Number.isFinite(x)) && L2.some((x) => x !== null && x > 0), '금리 결측 구간이 있어도 낙폭 예산 노출이 숫자로 계산된다')
}

// 7) 미래 참조 없음: 앞부분만 준 데이터로 계산한 노출이 전체 데이터로 계산한 같은 날까지의 노출과 같다
{
  const r = rng(3)
  let vol = 0.01
  const rets = Array.from({ length: 3200 }, (_, i) => { if (i % 250 === 0) vol = 0.005 + 0.02 * r(); return (r() - 0.48) * vol * 3 })
  const full = market(rets)
  let good = true
  for (const s of DEFENSE) {
    const Lf = s.exposure(full)
    for (const k of [1600, 2100, 2500, 2999, 3150]) {
      const part = { dates: full.dates.slice(0, k + 1), close: full.close.slice(0, k + 1), irx: full.irx.slice(0, k + 1) }
      part.lastIsMonthEnd = full.dates[k].slice(0, 7) !== full.dates[k + 1].slice(0, 7)
      const Lp = s.exposure(part)
      for (let i = 0; i <= k; i++) if (Lp[i] !== Lf[i]) { good = false; break }
    }
  }
  ok(good, '네 후보 모두 앞부분만 준 데이터와 전체 데이터의 노출이 같은 날까지 일치(미래 참조 없음)')
  const vals = new Set(DEFENSE.flatMap((s) => s.exposure(full)).filter((x) => x !== null))
  ok([...vals].every((x) => [0, 0.5, 1, 1.5, 2].includes(x)), `노출 값은 0~2배, 0.5배 단위(${[...vals].sort().join(', ')})`)
}

// 7b) 2차 후보: 초과수익 추정(월말 갱신·확장 창 평균)과 반켈리 노출, 미래 참조 없음
{
  const r = rng(9)
  const rets = Array.from({ length: 3000 }, () => 0.0005 + (r() - 0.5) * 0.03)
  const m = market(rets, '2000-01-03', 2)
  const mu = excessMean(m)
  // 손으로 다시 계산: 첫 유효 월말의 평균
  const first = mu.findIndex((x) => x !== null)
  let s = 0
  for (let i = 1; i <= first; i++) {
    const dt = (Date.parse(m.dates[i]) - Date.parse(m.dates[i - 1])) / 864e5 / 365
    s += m.close[i] / m.close[i - 1] - 1 - (2 / 100) * dt
  }
  ok(first >= DEF.refMin && near(mu[first], (s / first) * 252, 1e-12), `초과수익 추정 = 첫날부터 그날까지 일간 초과수익 평균 × 252 (표본 ${first}개부터)`)
  let monthOnly = true
  for (let i = first + 1; i < mu.length - 1; i++) if (mu[i] !== mu[i - 1] && m.dates[i].slice(0, 7) === m.dates[i + 1].slice(0, 7)) monthOnly = false
  ok(monthOnly, '초과수익 추정은 월말에만 바뀐다')
  const vol = conservativeVol(m.close), K = kellyRaw(m)
  const j = mu.length - 10
  ok(near(K[j], Math.min(2, Math.max(0, (KELLY_FRACTION * mu[j]) / vol[j] ** 2)), 1e-12), '반켈리 노출 = min(2, max(0, 0.5 × μ̂ / σ²))')
  const neg = market(Array.from({ length: 2000 }, () => -0.0008 + (r() - 0.5) * 0.02))
  ok(kellyRaw(neg).filter((x) => x !== null).every((x) => x === 0), '초과수익 추정이 음수면 노출 0')
  let good = true
  for (const st of DEFENSE2) {
    const Lf = st.exposure(m)
    for (const k of [1500, 2200, 2999 - 1]) {
      const part = { dates: m.dates.slice(0, k + 1), close: m.close.slice(0, k + 1), irx: m.irx.slice(0, k + 1) }
      part.lastIsMonthEnd = m.dates[k].slice(0, 7) !== m.dates[k + 1].slice(0, 7)
      const Lp = st.exposure(part)
      for (let i = 0; i <= k; i++) if (Lp[i] !== Lf[i]) { good = false; break }
    }
    if (!Lf.filter((x) => x !== null).every((x) => [0, 0.5, 1, 1.5, 2].includes(x))) good = false
  }
  ok(good, '2차 후보도 미래 참조 없음, 노출은 0~2배 0.5배 단위')
}

// 8) 노출 → 상품 비중, 다음 날 체결
{
  ok(JSON.stringify(weightsOf(0.5)) === '[0.5,0,0,0.5]' && JSON.stringify(weightsOf(1.5)) === '[0.5,0.5,0,0]' && JSON.stringify(weightsOf(2)) === '[0,1,0,0]', '0.5배 = 1배 50%+현금, 1.5배 = 1배 50%+2배 50%, 2배 = 2배 100%')
  const p = planOf([1, 2, null])
  ok(p(1).key === '1' && p(2).key === '2' && p(3).key === '0', 'i일 체결 목표 = i−1일 판정(준비 전은 현금)')
}

console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과')
if (fails) process.exit(1)
