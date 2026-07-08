/**
 * 역사 차트 데이터 빌드 — data-src/ 원본 CSV → public/data/*.json
 *
 * 실행: node scripts/build-history.mjs
 *
 * 소스 (전부 리포에 원본 커밋 — 재현 가능):
 * - data-src/shiller-sp500-monthly.csv — Shiller 예일 월간 데이터 미러
 *   (github.com/datasets/s-and-p-500, ODC-PDDL): 가격(일별 종가의 월평균)·배당(보간)·
 *   CPI·GS10·PE10. ⚠ 미러의 펀더멘털은 2023-06(CPI·GS10은 2023-09)에서 갱신 중단
 * - data-src/gold-monthly.csv — 금 월간 (github.com/datasets/gold-prices, ODC-PDDL, ~현재)
 * - data-src/fred-macro-monthly.csv — FRED 공식 시리즈 (수집: /fred 프록시, 2026-07):
 *   · M13002US35620M156NNBR: NBER 상업어음 금리(NY) 1857~1971 — 단기금리 1934년 이전 구간
 *   · TB3MS: 3개월 T-bill 1934~ — 단기금리(현금) 본선
 *   · GS10: 10년물 1953~ — Shiller GS10과 동일 시리즈, 2023-07 이후 연장용
 *   · CPIAUCNS: CPI-U(NSA) 1913~ — Shiller CPI와 동일 시리즈, 연장용
 * - data-src/sp500tr-monthly-avg.csv — ^SP500TR(총수익지수) 일별 종가의 월평균
 *   (Yahoo /yf 프록시로 수집·재계산) — 주식 총수익 2023-07 이후 연장용.
 *   Shiller 명목 총수익과 같은 대상(S&P500 배당 재투자)·같은 관례(월평균)
 *
 * 연장 방법: 2023-06까지는 Shiller 그대로, 2023-07부터
 *   주식 = ^SP500TR 월평균 성장률로 체인, 채권 = FRED GS10으로 동일 공식,
 *   금 = 원본 계속, CPI = CPIAUCNS 체인(2025-10 결측 1개월은 선형보간 —
 *   연방정부 데이터 공백), CAPE = 이익 데이터 부재로 2023-06 이후 null
 *
 * 산출 1) public/data/history.json — 역사 연구 탭 (1900-01=100 정규화):
 * - series: stock/bond/gold/bill 실질 + *Nom 명목
 *   · stock: S&P500(1957 이전 Cowles·S&P90 소급 합성) 총수익 — 월 배당 재투자
 *   · bond:  미 10년 국채 총수익 근사 — GS10 수익률 파생 만기고정(constant maturity):
 *            월수익 = y/12 + (10년 액면채 재가격 변화). 학술 관행, 실제 채권지수 아님
 *   · gold:  금 현물가 (배당 없음)
 *   · bill:  단기국채(현금) 총수익 — 3개월 T-bill(1934~) + NBER 상업어음(1871~1933 접합,
 *            신용 프리미엄만큼 T-bill보다 소폭 높음 — 지수는 수익률 체인이라 단절 없음)
 * - macro: cpiYoY(%), gs10(%), realRate10(%), cape
 *
 * 산출 2) public/data/history-assets.json — 백테스터용 월간 합성 자산 (명목, 1871~):
 * - SPX-HIST / UST10-HIST / GOLD-HIST / BILL-HIST
 *
 * 음수 구간 검출: 주식 실질 총수익 전고점 대비 낙폭 ≤ −25% AND 수면하 ≥ 36개월.
 * 검출 결과·매크로 앵커·연장 접합부를 검증하는 어서션 포함 — 어긋나면 빌드 실패.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const assert = (cond, msg) => {
  if (!cond) throw new Error(`검증 실패: ${msg}`)
}

// ─── CSV 로드 ─────────────────────────────────────────────────────────────────

function parseCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const cols = header.split(',')
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
}

const sp = parseCsv(join(root, 'data-src/shiller-sp500-monthly.csv'))
const goldRaw = parseCsv(join(root, 'data-src/gold-monthly.csv'))
const fred = parseCsv(join(root, 'data-src/fred-macro-monthly.csv'))
const trExt = parseCsv(join(root, 'data-src/sp500tr-monthly-avg.csv'))

const goldMap = new Map(goldRaw.map((r) => [r.Date, Number(r.Price)]))
const trMap = new Map(trExt.map((r) => [r.Date, Number(r.SP500TR_MonthlyAvg)]))

// FRED: "YYYY-MM" → { cp, tbill, gs10, cpi }
const fredMap = new Map(
  fred.map((r) => [
    r.observation_date.slice(0, 7),
    {
      cp: Number(r.M13002US35620M156NNBR) || null,
      tbill: Number(r.TB3MS) || null,
      gs10: Number(r.GS10) || null,
      cpi: Number(r.CPIAUCNS) || null,
    },
  ])
)

// CPI 2025-10 결측(연방 데이터 공백) → 인접월 선형보간
{
  const m = fredMap.get('2025-10')
  if (m && m.cpi == null) {
    const prev = fredMap.get('2025-09')?.cpi
    const next = fredMap.get('2025-11')?.cpi
    if (prev && next) m.cpi = (prev + next) / 2
  }
}

// ─── 월간 레코드 통합 (Shiller 1871~2023-06 + FRED/TR 연장) ──────────────────

// 미러 오기입 교정 — 교차 검증(scripts/verify-history.mjs)으로 확정된 단일 월 오류.
// 1974-07: 미러가 월평균 대신 월말 종가(79.31)를 기입 — ^GSPC 22거래일 평균 82.82
// (Shiller 관례 = 일별 종가의 월평균, 인접 795/796개월은 야후 재계산과 <1% 일치)
const SP500_CORRECTIONS = { '1974-07': 82.82 }

// 공식 소스 우선: CPI(1913-01~)·GS10(1953-04~)은 FRED 원본을 사용 — Shiller가 쓰는
// 것과 동일 시리즈이며, 미러의 전사 오류(예: GS10 2019-07에 8월 값 1.63 복사,
// FRED 정답 2.06)를 원천 차단. 그 이전 구간만 Shiller(재구성 접합) 사용
const shillerRows = sp
  .map((r) => {
    const ym = r.Date.slice(0, 7)
    const f = fredMap.get(ym)
    return {
      ym,
      price: SP500_CORRECTIONS[ym] ?? Number(r.SP500),
      div: Number(r.Dividend),
      cpi: ym >= '1913-01' && f?.cpi ? f.cpi : Number(r['Consumer Price Index']),
      gs10: ym >= '1953-04' && f?.gs10 ? f.gs10 : Number(r['Long Interest Rate']),
      cape: Number(r.PE10) > 0 ? Number(r.PE10) : null,
    }
  })
  .filter((r) => r.price > 0 && r.div > 0 && r.cpi > 0 && r.gs10 > 0)

const lastShiller = shillerRows[shillerRows.length - 1].ym
console.log(`Shiller 유효 구간: ${shillerRows[0].ym} ~ ${lastShiller}`)

// 연장 접합 검증 ① 동일 시리즈 일치: Shiller CPI·GS10 vs FRED (같은 원천이어야 함)
{
  const s = shillerRows[shillerRows.length - 1]
  const f = fredMap.get(s.ym)
  assert(f && Math.abs(f.cpi - s.cpi) < 0.5, `CPI 접합 불일치 ${s.ym}: shiller ${s.cpi} vs FRED ${f?.cpi}`)
  assert(f && Math.abs(f.gs10 - s.gs10) < 0.11, `GS10 접합 불일치 ${s.ym}: shiller ${s.gs10} vs FRED ${f?.gs10}`)
}

// 연장 레코드: lastShiller 다음 달부터, TR·GS10·CPI 모두 있는 달까지
const nextYm = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
const extRows = []
for (let ym = nextYm(lastShiller); ; ym = nextYm(ym)) {
  const f = fredMap.get(ym)
  const tr = trMap.get(ym)
  if (!f?.cpi || !f?.gs10 || !tr) break
  extRows.push({ ym, tr, cpi: f.cpi, gs10: f.gs10, cape: null })
}
assert(extRows.length > 24, `연장 구간이 너무 짧음 (${extRows.length}개월)`)
console.log(`FRED/TR 연장: ${extRows[0].ym} ~ ${extRows[extRows.length - 1].ym} (${extRows.length}개월)`)

// 연장 접합 검증 ② 주식 TR 관례 일치: 겹치는 마지막 두 달의 성장률 비교
{
  const n = shillerRows.length
  const p = shillerRows[n - 2]
  const s = shillerRows[n - 1]
  const shillerGrowth = (s.price + p.div / 12) / p.price
  const trGrowth = trMap.get(s.ym) / trMap.get(p.ym)
  assert(
    trGrowth && Math.abs(shillerGrowth / trGrowth - 1) < 0.01,
    `주식 TR 접합 불일치 ${s.ym}: shiller ${shillerGrowth} vs SP500TR ${trGrowth}`
  )
}

// ─── 지수 구축 (1871~, 이후 1900-01=100 정규화) ──────────────────────────────

const dates = []
const stock = [] // 실질 총수익
const bond = []
const gold = []
const bill = []
const stockNom = [] // 명목
const bondNom = []
const goldNom = []
const billNom = []
const cpiSeries = []
const cpiYoY = []
const gs10Arr = []
const realRate10 = []
const capeArr = []

let stockIdx = 1
let bondIdx = 1
let billIdx = 1

/** 10년 액면채 가격 (연 쿠폰 c, 수익률 y, 만기 10년) */
const bondPV = (c, y) => (c / y) * (1 - (1 + y) ** -10) + (1 + y) ** -10

/** 단기금리(%): 1934~ TB3MS, 이전 NBER 상업어음(NY) */
function shortRate(ym) {
  const f = fredMap.get(ym)
  if (!f) return null
  return ym >= '1934-01' ? f.tbill : f.cp
}

let prev = null // { ym, price?, div?, tr?, gs10, cpi }
const pushMonth = (rec) => {
  const { ym, cpi, gs10, cape } = rec
  dates.push(ym)
  if (prev) {
    // 주식 명목 총수익: Shiller 구간 = (P + D/12)/P_prev, 연장 구간 = TR 체인
    const nomRet = rec.tr != null && prev.tr != null ? rec.tr / prev.tr : (rec.price + prev.div / 12) / prev.price
    stockIdx *= nomRet
    // 채권: 전월 수익률 쿠폰 + 재가격
    const y0 = prev.gs10 / 100
    const y1 = gs10 / 100
    bondIdx *= 1 + y0 / 12 + (bondPV(y0, y1) - 1)
    // 단기국채(현금): 전월 단기금리 월할 복리
    const sr = shortRate(prev.ym)
    if (sr != null) billIdx *= (1 + sr / 100) ** (1 / 12)
  }
  stockNom.push(stockIdx)
  bondNom.push(bondIdx)
  billNom.push(shortRate(ym) != null || billNom.length > 0 ? billIdx : null)
  const g = goldMap.get(ym)
  goldNom.push(g ?? null)
  cpiSeries.push(cpi)

  gs10Arr.push(gs10)
  capeArr.push(cape ?? null)
  prev = { ...rec }
}

assert(trMap.get(lastShiller), `TR 연장 시리즈에 ${lastShiller} 겹침 구간 없음`)
for (const r of shillerRows) {
  // 접합 달(lastShiller)에 tr를 함께 실어, 연장 첫 달의 성장률이 (tr/tr) 체인이 되게 함
  pushMonth(r.ym === lastShiller ? { ...r, tr: trMap.get(r.ym) } : r)
}
for (const r of extRows) pushMonth({ ym: r.ym, tr: r.tr, gs10: r.gs10, cpi: r.cpi, cape: null })

// 실질 시리즈: 명목 × (기말 CPI 스케일이 아니라 비율만 중요 — 1900=100 정규화라 CPI_t 역수로 충분)
const lastCpi = cpiSeries[cpiSeries.length - 1]
for (let i = 0; i < dates.length; i++) {
  const defl = lastCpi / cpiSeries[i] // 실질(기말 물가 기준)
  stock.push(stockNom[i] * defl)
  bond.push(bondNom[i] * defl)
  bill.push(billNom[i] != null ? billNom[i] * defl : null)
  gold.push(goldNom[i] != null ? goldNom[i] * defl : null)
  // CPI YoY / 실질금리
  const yoy = i >= 12 ? (cpiSeries[i] / cpiSeries[i - 12] - 1) * 100 : null
  cpiYoY.push(yoy != null ? yoy : null)
  realRate10.push(yoy != null ? gs10Arr[i] - yoy : null)
}

// 1900-01 = 100 정규화
const baseI = dates.indexOf('1900-01')
assert(baseI >= 0, '1900-01 기준월 없음')
const norm = (arr) => arr.map((v) => (v == null ? null : (v / arr[baseI]) * 100))
const stockN = norm(stock)
const bondN = norm(bond)
const goldN = norm(gold)
const billN = norm(bill)
const stockNomN = norm(stockNom)
const bondNomN = norm(bondNom)
const goldNomN = norm(goldNom)
const billNomN = norm(billNom)

// ─── 음수 구간 검출 (주식 실질 총수익, 1900년 이후) ──────────────────────────

const episodes = []
let peakI = baseI
for (let i = baseI + 1; i < dates.length; i++) {
  if (stockN[i] >= stockN[peakI]) {
    const start = peakI
    let troughI = start
    for (let j = start + 1; j <= i; j++) if (stockN[j] < stockN[troughI]) troughI = j
    const months = i - start
    const depth = stockN[troughI] / stockN[start] - 1
    if (months >= 36 && depth <= -0.25) {
      episodes.push({ peak: dates[start], trough: dates[troughI], recovery: dates[i], months, depthPct: depth * 100, peakI: start, troughI, recI: i })
    }
    peakI = i
  }
}
{
  // 진행 중 에피소드 (기말까지 미회복)
  let troughI = peakI
  for (let j = peakI + 1; j < dates.length; j++) if (stockN[j] < stockN[troughI]) troughI = j
  const months = dates.length - 1 - peakI
  const depth = stockN[troughI] / stockN[peakI] - 1
  if (months >= 36 && depth <= -0.25) {
    episodes.push({ peak: dates[peakI], trough: dates[troughI], recovery: null, months, depthPct: depth * 100, peakI, troughI, recI: dates.length - 1 })
  }
}

console.log('\n검출된 음수 구간 (낙폭 ≤ −25%, 수면하 ≥ 36개월):')
for (const e of episodes) {
  console.log(`  ${e.peak} → 저점 ${e.trough} (${e.depthPct.toFixed(1)}%) → 회복 ${e.recovery ?? '미회복'} [${(e.months / 12).toFixed(1)}년]`)
}

// ─── 구간별 타 자산 실질 성과 ────────────────────────────────────────────────

function assetStats(arr, e) {
  if (arr[e.peakI] == null) return null
  const toTrough = arr[e.troughI] != null ? (arr[e.troughI] / arr[e.peakI] - 1) * 100 : null
  const toRec = arr[e.recI] != null ? (arr[e.recI] / arr[e.peakI] - 1) * 100 : null
  return { toTroughPct: toTrough, toRecoveryPct: toRec }
}
for (const e of episodes) {
  e.assets = {
    stock: assetStats(stockN, e),
    bond: assetStats(bondN, e),
    gold: assetStats(goldN, e),
    bill: assetStats(billN, e),
  }
}

console.log('\n구간별 실질 성과 (주식 고점→저점/회복, %):')
for (const e of episodes) {
  const f = (a) => (a ? `${a.toTroughPct?.toFixed(0)}%/${a.toRecoveryPct?.toFixed(0)}%` : 'n/a')
  console.log(`  ${e.peak}: 주식 ${f(e.assets.stock)} | 채권 ${f(e.assets.bond)} | 금 ${f(e.assets.gold)} | 현금 ${f(e.assets.bill)}`)
}

// ─── 검증 (리서치 대조 + 매크로 앵커 + 연장 앵커) ────────────────────────────

const findEp = (p) => episodes.find((e) => e.peak.startsWith(p))
const gd = findEp('1929')
assert(gd, '1929 에피소드 미검출')
assert(gd.depthPct < -70 && gd.depthPct > -85, `1929 낙폭 ${gd.depthPct}`)
assert(findEp('1973'), '스태그플레이션 에피소드 미검출')
const lost = findEp('2000')
assert(lost?.recovery?.startsWith('2013'), `2000 회복 ${lost?.recovery} (기대: 2013)`)

const at = (arr, ym) => arr[dates.indexOf(ym)]
assert(Math.abs(at(capeArr, '1929-09') - 32.6) < 1.5, `CAPE 1929-09 = ${at(capeArr, '1929-09')}`)
assert(at(capeArr, '2000-01') > 42 && at(capeArr, '2000-01') < 45, `CAPE 2000-01 = ${at(capeArr, '2000-01')}`)
assert(Math.abs(at(gs10Arr, '1981-09') - 15.32) < 0.5, `GS10 1981-09 = ${at(gs10Arr, '1981-09')}`)
assert(at(cpiYoY, '1920-06') > 15, `CPI YoY 1920-06 = ${at(cpiYoY, '1920-06')}`)
assert(at(cpiYoY, '1932-09') < -9, `CPI YoY 1932-09 = ${at(cpiYoY, '1932-09')}`)
assert(at(cpiYoY, '1947-06') > 8, `CPI YoY 1947-06 = ${at(cpiYoY, '1947-06')}`)
assert(at(cpiYoY, '1980-03') > 12, `CPI YoY 1980-03 = ${at(cpiYoY, '1980-03')}`)
assert(at(realRate10, '1974-12') < 0, `실질금리 1974-12 = ${at(realRate10, '1974-12')}`)
assert(at(realRate10, '1984-06') > 4, `실질금리 1984-06 = ${at(realRate10, '1984-06')}`)
// 연장 구간 앵커: 2022 인플레 급등이 반영됐는지 + 최근 금리가 실측 범위인지
assert(at(cpiYoY, '2022-06') > 8, `CPI YoY 2022-06 = ${at(cpiYoY, '2022-06')} (>8% 기대)`)
assert(at(gs10Arr, '2026-05') > 3.5 && at(gs10Arr, '2026-05') < 5.5, `GS10 2026-05 = ${at(gs10Arr, '2026-05')}`)
// 현금(단기채) 앵커: 명목 지수는 단조 증가(금리 ≥ 0), 1981년 전후 실질 강세 전환
for (let i = baseI + 1; i < dates.length; i++) assert(billNomN[i] >= billNomN[i - 1] - 1e-9, `현금 명목 지수 역행 ${dates[i]}`)
console.log('\n앵커 검증 통과: 구간·CAPE·GS10·CPI·실질금리·연장(2022 인플레, 2026 금리)·현금 단조성 ✓')

// ─── 출력 1: history.json ────────────────────────────────────────────────────

const round = (arr, d = 3) => arr.map((v) => (v == null ? null : Number(v.toFixed(d))))
const out = {
  meta: {
    sources: [
      'Robert Shiller (Yale) 월간 미러 — github.com/datasets/s-and-p-500 (ODC-PDDL), ~2023-06',
      '금 월간 — github.com/datasets/gold-prices (ODC-PDDL)',
      'FRED: TB3MS(3개월 T-bill 1934~) · M13002(NBER 상업어음 1871~1933) · GS10 · CPIAUCNS — 2023-07 이후 연장 + 현금 시리즈',
      '^SP500TR 일별 종가의 월평균 (Yahoo) — 주식 총수익 2023-07 이후 연장',
    ],
    method: {
      stock: 'S&P500(1957 이전 Cowles·S&P90 소급 합성) 총수익 — 월평균 가격 + 배당(연/12) 월간 재투자. 2023-07~ ^SP500TR 월평균 체인',
      bond: '미 10년물(GS10) 수익률 파생 만기고정 근사 총수익 — 실제 채권지수 아님',
      gold: '금 현물가 (배당 없음). 1933-1974 미국 민간 금보유 금지·공정가 시대 주의',
      bill: '단기국채(현금): 3개월 T-bill(1934~) + NBER 상업어음 NY(1871~1933 접합 — 신용 프리미엄만큼 소폭 높음) 월할 복리',
      macro: 'cpiYoY = 직전 12개월 CPI 상승률(2025-10 결측 1개월 선형보간), realRate10 = GS10 − cpiYoY (사후적 근사), cape = Shiller PE10(1881~2023-06, 이후 이익 데이터 부재로 결측)',
      base: '1900-01 = 100 · 실질 = CPI-U(NSA) 디플레이트',
    },
    dataEnd: dates[dates.length - 1],
    generatedBy: 'scripts/build-history.mjs',
  },
  series: {
    dates: dates.slice(baseI),
    stock: round(stockN.slice(baseI)),
    bond: round(bondN.slice(baseI)),
    gold: round(goldN.slice(baseI)),
    bill: round(billN.slice(baseI)),
    stockNom: round(stockNomN.slice(baseI)),
    bondNom: round(bondNomN.slice(baseI)),
    goldNom: round(goldNomN.slice(baseI)),
    billNom: round(billNomN.slice(baseI)),
  },
  macro: {
    cpiYoY: round(cpiYoY.slice(baseI), 2),
    gs10: round(gs10Arr.slice(baseI), 2),
    realRate10: round(realRate10.slice(baseI), 2),
    cape: round(capeArr.slice(baseI), 2),
  },
  episodes: episodes.map((e) => ({
    peak: e.peak,
    trough: e.trough,
    recovery: e.recovery,
    underwaterMonths: e.months,
    depthPct: Number(e.depthPct.toFixed(1)),
    assets: e.assets,
  })),
}

mkdirSync(join(root, 'public/data'), { recursive: true })
writeFileSync(join(root, 'public/data/history.json'), JSON.stringify(out))
console.log(`\npublic/data/history.json 생성 (${dates.length - baseI}개월, ~${dates[dates.length - 1]}, ${episodes.length}개 구간) ✓`)

// ─── 출력 2: history-assets.json (백테스터 월간 합성 자산 — 명목, 1871~) ─────

function toAsset(arr) {
  const ds = []
  const close = []
  for (let i = 0; i < dates.length; i++) {
    const v = arr[i]
    if (v == null || !(v > 0)) continue
    ds.push(`${dates[i]}-01`)
    close.push(Number(v.toFixed(4)))
  }
  return { dates: ds, close }
}

const assetsOut = {
  meta: {
    note: '역사 월간 합성 자산 — 명목 지수, 배당·이자 내재(총수익), 월간 해상도(월평균 가격). 1900-01=100 스케일',
    generatedBy: 'scripts/build-history.mjs',
    dataEnd: dates[dates.length - 1],
  },
  assets: {
    'SPX-HIST': toAsset(stockNomN),
    'UST10-HIST': toAsset(bondNomN),
    'GOLD-HIST': toAsset(goldNomN),
    'BILL-HIST': toAsset(billNomN),
  },
}
for (const [t, a] of Object.entries(assetsOut.assets)) {
  assert(a.dates.length > 1200, `${t} 데이터 부족 (${a.dates.length}개월)`)
  console.log(`  ${t}: ${a.dates[0]} ~ ${a.dates[a.dates.length - 1]} (${a.dates.length}개월)`)
}
writeFileSync(join(root, 'public/data/history-assets.json'), JSON.stringify(assetsOut))
console.log('public/data/history-assets.json 생성 ✓')
