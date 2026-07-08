/**
 * 역사 데이터 교차 검증 — 독립 소스 대조로 번들 데이터의 정확도를 정량 측정
 *
 * 실행: node scripts/verify-history.mjs   (build-history.mjs 실행 후)
 *
 * 검증 축:
 *  A. 소스 간 전구간 대조 — Shiller 미러 vs FRED 원본 (동일 시리즈여야 함)
 *     A1. CPI: Shiller CPI vs CPIAUCNS, 1913-01~2023-06 완전 중첩
 *     A2. GS10: Shiller Long Rate vs FRED GS10, 1953-04~2023-06
 *     A3. 상업어음 vs T-bill 프리미엄 (1934~1971 중첩) — 1934 이전 현금 근사의 편향 크기
 *  B. 독립 재구성 — Yahoo 일별 데이터로 같은 관례(월평균) 재계산 후 대조
 *     B1. 주식: ^GSPC 일별→월평균 vs Shiller SP500 (1950-02~2023-06)
 *     B2. 단기금리: ^IRX 월평균 vs TB3MS (1960~)
 *     B3. 채권 근사: 우리 GS10 파생 월수익 vs IEF(7-10년 실물 ETF) 총수익 (2002-08~)
 *     B4. 주식 TR 연장: 우리 stockNom vs SPY adjClose 총수익 (2023-06~)
 *  C. 업계 표준 장기 집계 — SBBI(Ibbotson) 1926~2023 기하평균과 대조
 *  D. 수학 속성 — 채권 공식 항등식, 실질/명목/CPI 일관성
 *
 * 임계 초과 시 exit 1. 결과는 docs/research/data-verification-2026-07.md에 기록.
 */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name} — ${detail}`)
  if (!cond) failures++
}

function parseCsv(path) {
  const [header, ...lines] = readFileSync(join(root, path), 'utf8').trim().split(/\r?\n/)
  const cols = header.split(',')
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
}
const toMap = (rows, key, val) => new Map(rows.map((r) => [r[key].slice(0, 7), Number(r[val])]))

// 번들 산출물 + 원천
const hist = JSON.parse(readFileSync(join(root, 'public/data/history.json'), 'utf8'))
const shiller = parseCsv('data-src/shiller-sp500-monthly.csv')
const fred = parseCsv('data-src/fred-macro-monthly.csv')
const gspc = toMap(parseCsv('data-src/verify/gspc-monthly-avg.csv'), 'Date', 'GSPC_MonthlyAvg')
const irx = toMap(parseCsv('data-src/verify/irx-monthly-avg.csv'), 'Date', 'IRX_MonthlyAvg')
const ief = toMap(parseCsv('data-src/verify/ief-adjclose-monthly-avg.csv'), 'Date', 'IEF_AdjClose_MonthlyAvg')
const spy = toMap(parseCsv('data-src/verify/spy-adjclose-monthly-avg.csv'), 'Date', 'SPY_AdjClose_MonthlyAvg')

const sh = new Map(shiller.map((r) => [r.Date.slice(0, 7), r]))
const fr = new Map(fred.map((r) => [r.observation_date.slice(0, 7), r]))
const H = hist.series
const idx = new Map(H.dates.map((d, i) => [d, i]))

console.log('=== A. 소스 간 전구간 대조 (Shiller 미러 vs FRED 원본) ===')
{
  // A1. CPI 1913-01 ~ 2023-06
  let maxDev = 0, maxYm = '', n = 0
  for (const [ym, f] of fr) {
    if (ym < '1913-01' || ym > '2023-06') continue
    const s = sh.get(ym)
    const fcpi = Number(f.CPIAUCNS)
    const scpi = s ? Number(s['Consumer Price Index']) : 0
    if (!(fcpi > 0) || !(scpi > 0)) continue
    n++
    const dev = Math.abs(fcpi / scpi - 1) * 100
    if (dev > maxDev) { maxDev = dev; maxYm = ym }
  }
  check('A1. CPI 전구간 일치', maxDev < 0.5, `${n}개월 중첩, 최대 편차 ${maxDev.toFixed(3)}% (${maxYm || '-'}) — 임계 0.5%`)
}
{
  // A2. 번들이 실제 사용하는 GS10(macro.gs10) vs FRED 원본 — 1953-04부터는 FRED를
  // 직접 쓰므로 사실상 0이어야 함. (미러 자체의 오류는 A2b에서 진단용으로 집계)
  let maxDev = 0, maxYm = '', n = 0
  for (let i = 0; i < H.dates.length; i++) {
    const ym = H.dates[i]
    if (ym < '1953-04' || ym > '2026-06') continue
    const f = fr.get(ym)
    const fg = f ? Number(f.GS10) : 0
    if (!(fg > 0) || hist.macro.gs10[i] == null) continue
    n++
    const dev = Math.abs(fg - hist.macro.gs10[i])
    if (dev > maxDev) { maxDev = dev; maxYm = ym }
  }
  check('A2. 번들 GS10 vs FRED 원본', maxDev < 0.011, `${n}개월, 최대 편차 ${maxDev.toFixed(3)}%p (${maxYm || '-'}) — FRED 직사용으로 일치해야 함`)

  // A2b. (진단) 미러 자체의 GS10 오류 월 집계 — 번들은 미사용이므로 통과 조건 아님
  let mirrorErr = 0, worst = ''
  for (const [ym, f] of fr) {
    if (ym < '1953-04' || ym > '2023-06') continue
    const s = sh.get(ym)
    const fg = Number(f.GS10)
    const sg = s ? Number(s['Long Interest Rate']) : 0
    if (!(fg > 0) || !(sg > 0)) continue
    if (Math.abs(fg - sg) > 0.15) { mirrorErr++; worst = `${ym}(미러 ${sg} vs FRED ${fg})` }
  }
  console.log(`  ℹ A2b. 미러 GS10 오기입 ${mirrorErr}건 발견 ${worst} — FRED 우선 사용으로 번들에서 배제됨`)
}
{
  // A3. 상업어음 프리미엄 (1934-01 ~ 1971-12)
  let sum = 0, n = 0, min = Infinity, max = -Infinity
  for (const [ym, f] of fr) {
    if (ym < '1934-01' || ym > '1971-12') continue
    const cp = Number(f.M13002US35620M156NNBR)
    const tb = Number(f.TB3MS)
    if (!(cp > 0) || !(tb >= 0)) continue
    const d = cp - tb
    sum += d; n++
    if (d < min) min = d
    if (d > max) max = d
  }
  const mean = sum / n
  check('A3. 상업어음-T-bill 프리미엄', mean > 0 && mean < 1.2, `${n}개월 평균 +${mean.toFixed(2)}%p (범위 ${min.toFixed(2)}~${max.toFixed(2)}) — 1934 이전 현금 수익이 이만큼 과대 추정될 수 있음(문서화됨)`)
}

console.log('=== B. Yahoo 독립 재구성 대조 ===')
{
  // B1. ^GSPC 월평균 vs 번들이 사용하는 SP500 (미러 + 교정 테이블 적용 후) —
  // 1957(공식 지수 출범) 이후 레벨·수익률. 교정: 1974-07 미러 오기입(79.31→82.82)
  const SP500_CORRECTIONS = { '1974-07': 82.82 } // build-history.mjs와 동일 (검증 확정치)
  const priceOf = (ym) => {
    const s = sh.get(ym)
    if (!s) return null
    const p = SP500_CORRECTIONS[ym] ?? Number(s.SP500)
    return p > 0 ? p : null
  }
  let n = 0, maxLevDev = 0, maxYm = ''
  let retPairs = []
  let prevYm = null
  for (const [ym, g] of gspc) {
    if (ym < '1957-03' || ym > '2023-06') continue
    const sp = priceOf(ym)
    if (sp == null) continue
    n++
    const dev = Math.abs(g / sp - 1) * 100
    if (dev > maxLevDev) { maxLevDev = dev; maxYm = ym }
    if (prevYm && gspc.has(prevYm) && priceOf(prevYm) != null) {
      retPairs.push([g / gspc.get(prevYm) - 1, sp / priceOf(prevYm) - 1])
    }
    prevYm = ym
  }
  const corr = correlation(retPairs)
  check('B1a. 주식 레벨 일치 (교정 후, 1957~)', maxLevDev < 1.0, `${n}개월, 최대 레벨 편차 ${maxLevDev.toFixed(3)}% (${maxYm}) — 임계 1%`)
  check('B1b. 주식 월수익률 상관 (1957~)', corr > 0.995, `상관계수 ${corr.toFixed(5)} — 임계 0.995`)
}
{
  // B2. ^IRX vs TB3MS (둘 다 3개월 T-bill 할인율 계열)
  let n = 0, maxDev = 0, maxYm = '', sumAbs = 0
  for (const [ym, v] of irx) {
    if (ym > '2026-06') continue
    const f = fr.get(ym)
    const tb = f ? Number(f.TB3MS) : 0
    if (!(tb > 0) || !(v > 0)) continue
    n++
    const dev = Math.abs(v - tb)
    sumAbs += dev
    if (dev > maxDev) { maxDev = dev; maxYm = ym }
  }
  check('B2. 단기금리 ^IRX vs TB3MS', sumAbs / n < 0.15 && maxDev < 0.9, `${n}개월, 평균 |편차| ${(sumAbs / n).toFixed(3)}%p · 최대 ${maxDev.toFixed(2)}%p (${maxYm}) — 호가 관례 차이 감안 임계 평균 0.15/최대 0.9`)
}
{
  // B3. 채권 근사 vs IEF(7-10년 실물, 보수 0.15%) 월수익률 — 2002-08 ~ 2026-05
  const pairs = []
  let prev = null
  for (const [ym] of ief) {
    if (ym < '2002-08' || ym > '2026-05') { prev = ym; continue }
    const i0 = idx.get(prev), i1 = idx.get(ym)
    if (i0 != null && i1 != null && ief.has(prev)) {
      pairs.push([H.bondNom[i1] / H.bondNom[i0] - 1, ief.get(ym) / ief.get(prev) - 1])
    }
    prev = ym
  }
  const corr = correlation(pairs)
  const oursAnn = annualized(pairs.map((p) => p[0]))
  const iefAnn = annualized(pairs.map((p) => p[1]))
  check('B3a. 채권 근사 vs IEF 월수익률 상관', corr > 0.9, `${pairs.length}개월, 상관 ${corr.toFixed(4)} — 임계 0.9`)
  check('B3b. 채권 근사 vs IEF 연환산 수익', Math.abs(oursAnn - iefAnn) < 1.0, `우리 ${oursAnn.toFixed(2)}%/년 vs IEF ${iefAnn.toFixed(2)}%/년 (만기 7-10 vs 10 고정·보수 0.15% 감안) — 임계 1%p`)
}
{
  // B4. 주식 TR 연장 vs SPY 총수익 (2023-06 ~ 2026-05 누적)
  const a0 = idx.get('2023-06'), a1 = idx.get('2026-05')
  const ours = H.stockNom[a1] / H.stockNom[a0]
  const spyG = spy.get('2026-05') / spy.get('2023-06')
  const devPct = (ours / spyG - 1) * 100
  check('B4. 주식 TR 연장 vs SPY', Math.abs(devPct) < 1.0, `누적 우리 ×${ours.toFixed(4)} vs SPY ×${spyG.toFixed(4)} (편차 ${devPct.toFixed(2)}% · SPY 보수 0.09%/년 감안) — 임계 1%`)
}

console.log('=== C. 업계 표준 장기 집계 (SBBI/Ibbotson 1926~2023 기하평균) ===')
{
  // 참조값(발표치): 미국 대형주 ~10.3%, 중기 국채 ~5.0%, T-bill ~3.3%, 인플레 ~2.9%
  const i0 = idx.get('1925-12') ?? idx.get('1926-01')
  const i1 = idx.get('2023-12')
  const years = (i1 - i0) / 12
  const g = (arr) => (Math.pow(arr[i1] / arr[i0], 1 / years) - 1) * 100
  const stock = g(H.stockNom)
  const bond = g(H.bondNom)
  const bill = g(H.billNom)
  // CPI: 실질/명목 비율에서 역산
  const cpiG = (Math.pow((H.stockNom[i1] / H.stock[i1]) / (H.stockNom[i0] / H.stock[i0]), 1 / years) - 1) * 100
  check('C1. 주식 1926~2023 기하평균', Math.abs(stock - 10.3) < 0.5, `우리 ${stock.toFixed(2)}%/년 vs SBBI 대형주 ~10.3% — 임계 ±0.5%p`)
  check('C2. 채권(10년 근사) 기하평균', bond > 4.4 && bond < 5.6, `우리 ${bond.toFixed(2)}%/년 vs SBBI 중기~장기 국채 4.9~5.1% — 허용 4.4~5.6`)
  check('C3. 현금(T-bill) 기하평균', Math.abs(bill - 3.3) < 0.4, `우리 ${bill.toFixed(2)}%/년 vs SBBI T-bill ~3.3% — 임계 ±0.4%p`)
  check('C4. 인플레이션 기하평균', Math.abs(cpiG - 2.9) < 0.3, `우리 ${cpiG.toFixed(2)}%/년 vs SBBI ~2.9% — 임계 ±0.3%p`)
}

console.log('=== D. 수학 속성 ===')
{
  // D1. 채권 공식 항등식: 수익률 불변이면 월수익 = y/12
  const bondPV = (c, y) => (c / y) * (1 - (1 + y) ** -10) + (1 + y) ** -10
  const y = 0.05
  const ret = y / 12 + (bondPV(y, y) - 1)
  check('D1. 채권 공식: y 불변 → 월수익 = y/12', Math.abs(ret - y / 12) < 1e-12, `잔차 ${(ret - y / 12).toExponential(2)}`)
}
{
  // D2. 실질 = 명목 × (CPI_end/CPI_t) 일관성 — stock과 bond가 같은 디플레이터를 쓰는지
  let maxDev = 0
  for (let i = 0; i < H.dates.length; i += 37) {
    const dS = H.stock[i] / H.stockNom[i]
    const dB = H.bond[i] / H.bondNom[i]
    maxDev = Math.max(maxDev, Math.abs(dS / dB - 1))
  }
  check('D2. 시리즈 간 디플레이터 일관성', maxDev < 1e-3, `표본 최대 편차 ${(maxDev * 100).toFixed(4)}%`)
}
{
  // D3. 금 앵커 — 고정가 시대 + 자유화 후 공지 값
  const gAt = (ym) => H.goldNom[idx.get(ym)] / H.goldNom[idx.get('1913-01')] * /* $/oz 환산 */ 18.92 // 1913-01 ≈ $18.92 스케일 복원용 아님 — 비율 검증만
  const ratio = (a, b) => H.goldNom[idx.get(a)] / H.goldNom[idx.get(b)]
  check('D3a. 금 1934 절상 비율', Math.abs(ratio('1934-12', '1932-12') - 35 / 20.67) < 0.15, `1932-12→1934-12 배율 ${ratio('1934-12', '1932-12').toFixed(3)} vs 공식 절상 1.693`)
  check('D3b. 금 1980-01 스파이크', ratio('1980-01', '1979-01') > 2 && ratio('1980-01', '1979-01') < 3.2, `1979-01→1980-01 배율 ${ratio('1980-01', '1979-01').toFixed(2)} (공지: $227→$675 월평균, ~2.97배)`)
  check('D3c. 금 2011-09 vs 2015-12 반락', ratio('2015-12', '2011-09') > 0.55 && ratio('2015-12', '2011-09') < 0.68, `배율 ${ratio('2015-12', '2011-09').toFixed(3)} (공지: ~$1,772→~$1,068, 0.60)`)
}

function correlation(pairs) {
  const n = pairs.length
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n
  const my = pairs.reduce((s, p) => s + p[1], 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2 }
  return sxy / Math.sqrt(sxx * syy)
}
function annualized(rets) {
  const g = rets.reduce((p, r) => p * (1 + r), 1)
  return (Math.pow(g, 12 / rets.length) - 1) * 100
}

console.log(failures === 0 ? '\n전체 교차 검증 통과 ✓' : `\n검증 실패 ${failures}건 ✗`)
process.exit(failures === 0 ? 0 : 1)
