/**
 * 역사 차트 데이터 빌드 — data-src/ 원본 CSV → public/data/*.json
 *
 * 실행: node scripts/build-history.mjs
 *
 * 소스 (둘 다 ODC-PDDL 퍼블릭 도메인, 리포에 원본 커밋):
 * - data-src/shiller-sp500-monthly.csv — Shiller 예일 월간 데이터 미러
 *   (github.com/datasets/s-and-p-500): 가격(일별 종가의 월평균)·배당(보간)·CPI·GS10·PE10
 * - data-src/gold-monthly.csv — 금 월간 (github.com/datasets/gold-prices, 1833~)
 *
 * 산출 1) public/data/history.json — 역사 연구 탭용 (1900-01=100 정규화):
 * - stock/bond/gold: 실질 지수 + stockNom/bondNom/goldNom: 명목 지수
 *   · stock: 총수익 — 월간 배당 재투자 (Shiller 표준 방법), 실질은 CPI 디플레이트
 *   · bond:  10년 국채 총수익 근사 — GS10 수익률에서 파생:
 *            월수익 = y/12 + (10년 액면채를 새 수익률로 재가격한 가격변화).
 *            만기 고정(constant maturity) 근사 — 학술 관행, 정확한 채권지수 아님
 *   · gold:  가격 지수 (배당 없음)
 * - macro: 구간별 거시 배경 — cpiYoY(%), gs10(%), realRate10(%), cape
 *   · 실질금리 = GS10 − 직전 12개월 CPI 상승률 (사후적 근사 — 기대인플레 아님)
 *   · 세트 선정 사유: 1900년 전체를 커버하는 신뢰 시계열은 Shiller 파생이 유일.
 *     기준금리(연준 1913~)·M2(1959~)·하이일드 스프레드(1996~, Baa 대용도 1919~)는
 *     커버리지 미달로 제외 — docs/research/negative-real-return-eras.md 참조
 *
 * 산출 2) public/data/history-assets.json — 백테스터용 월간 합성 자산 (명목):
 * - SPX-HIST(주식 명목 총수익·배당 내재) / UST10-HIST(10년 국채 총수익 근사) /
 *   GOLD-HIST(금 가격), 1871~. 1900-01=100 스케일, 날짜는 "YYYY-MM-01"
 *
 * 음수 구간 검출: 주식 실질 총수익 지수의 전고점 대비 수면하 에피소드 중
 * 낙폭 ≤ −25% AND 수면하 ≥ 36개월. 검출 결과와 매크로 앵커를 리서치 문서의
 * 검증 수치와 대조하는 어서션 포함 — 데이터가 조용히 바뀌면 빌드가 실패한다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─── CSV 로드 ─────────────────────────────────────────────────────────────────

function parseCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const cols = header.split(',')
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
}

const sp = parseCsv(join(root, 'data-src/shiller-sp500-monthly.csv'))
const goldRaw = parseCsv(join(root, 'data-src/gold-monthly.csv'))

// 금: "YYYY-MM" → 가격 맵
const goldMap = new Map(goldRaw.map((r) => [r.Date, Number(r.Price)]))

// Shiller: 배당·CPI·GS10이 모두 유효한 행만 (미공표 꼬리 제거)
const rows = sp
  .map((r) => ({
    ym: r.Date.slice(0, 7),
    price: Number(r.SP500),
    div: Number(r.Dividend),
    cpi: Number(r['Consumer Price Index']),
    gs10: Number(r['Long Interest Rate']),
    cape: Number(r.PE10) > 0 ? Number(r.PE10) : null, // PE10은 1881-01부터 (이전 0.0)
  }))
  .filter((r) => r.price > 0 && r.div > 0 && r.cpi > 0 && r.gs10 > 0)

console.log(`Shiller 유효 구간: ${rows[0].ym} ~ ${rows[rows.length - 1].ym} (${rows.length}개월)`)

// ─── 지수 구축 (1871~, 이후 1900-01=100 정규화) ──────────────────────────────

const lastCpi = rows[rows.length - 1].cpi

const dates = []
const stock = [] // 실질 총수익
const bond = [] // 실질 총수익 (근사)
const gold = [] // 실질 가격
const stockNom = [] // 명목 총수익
const bondNom = [] // 명목 총수익 (근사)
const goldNom = [] // 명목 가격
const cpiYoY = [] // 직전 12개월 CPI 상승률 (%)
const gs10Arr = [] // 10년물 명목 금리 (%)
const realRate10 = [] // 실질 10년 금리 근사 (%) = gs10 − cpiYoY
const capeArr = [] // Shiller CAPE (PE10)
let stockIdx = 1
let bondIdx = 1
let stockNomIdx = 1
let bondNomIdx = 1

/** 10년 액면채 가격 (연 쿠폰 c, 수익률 y, 만기 10년) */
const bondPV = (c, y) => (c / y) * (1 - (1 + y) ** -10) + (1 + y) ** -10

for (let i = 0; i < rows.length; i++) {
  const r = rows[i]
  dates.push(r.ym)

  if (i > 0) {
    const p = rows[i - 1]
    // 주식: 명목 총수익 → 실질 (Shiller 표준: 월 배당 = 연 배당/12)
    const nomRet = (r.price + p.div / 12) / p.price
    stockNomIdx *= nomRet
    stockIdx *= nomRet * (p.cpi / r.cpi)
    // 채권: 전월 수익률로 쿠폰 발생 + 수익률 변화 재가격 (만기 고정 근사)
    const y0 = p.gs10 / 100
    const y1 = r.gs10 / 100
    const bondRet = 1 + y0 / 12 + (bondPV(y0, y1) - 1)
    bondNomIdx *= bondRet
    bondIdx *= bondRet * (p.cpi / r.cpi)
  }
  stock.push(stockIdx)
  bond.push(bondIdx)
  stockNom.push(stockNomIdx)
  bondNom.push(bondNomIdx)

  const g = goldMap.get(r.ym)
  gold.push(g ? (g / r.cpi) * lastCpi : null)
  goldNom.push(g ?? null)

  // 매크로: CPI YoY(12개월 전 대비), 명목 GS10, 실질금리 근사, CAPE
  const yoy = i >= 12 ? (r.cpi / rows[i - 12].cpi - 1) * 100 : null
  cpiYoY.push(yoy)
  gs10Arr.push(r.gs10)
  realRate10.push(yoy != null ? r.gs10 - yoy : null)
  capeArr.push(r.cape)
}

// 1900-01 = 100 정규화
const baseI = dates.indexOf('1900-01')
if (baseI < 0) throw new Error('1900-01 기준월 없음')
const norm = (arr) => arr.map((v) => (v == null ? null : (v / arr[baseI]) * 100))
const stockN = norm(stock)
const bondN = norm(bond)
const goldN = norm(gold)
const stockNomN = norm(stockNom)
const bondNomN = norm(bondNom)
const goldNomN = norm(goldNom)

// ─── 음수 구간 검출 (주식 실질 총수익, 1900년 이후) ──────────────────────────

const episodes = []
let peakI = baseI
for (let i = baseI + 1; i < dates.length; i++) {
  if (stockN[i] >= stockN[peakI]) {
    // 회복 — 직전 에피소드 마감
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
// 진행 중 에피소드 (기말까지 미회복)
{
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
  console.log(
    `  ${e.peak} → 저점 ${e.trough} (${e.depthPct.toFixed(1)}%) → 회복 ${e.recovery ?? '미회복'} [${(e.months / 12).toFixed(1)}년]`
  )
}

// ─── 구간별 타 자산 실질 성과 (고점→저점 / 고점→회복) ────────────────────────

function assetStats(arr, e) {
  const at = (i) => arr[i]
  if (at(e.peakI) == null) return null
  const toTrough = at(e.troughI) != null ? (at(e.troughI) / at(e.peakI) - 1) * 100 : null
  const toRec = at(e.recI) != null ? (at(e.recI) / at(e.peakI) - 1) * 100 : null
  return { toTroughPct: toTrough, toRecoveryPct: toRec }
}
for (const e of episodes) {
  e.assets = {
    stock: assetStats(stockN, e),
    bond: assetStats(bondN, e),
    gold: assetStats(goldN, e),
  }
}

console.log('\n구간별 실질 성과 (주식 고점→회복 시점 기준, %):')
for (const e of episodes) {
  const f = (a) => (a ? `저점 ${a.toTroughPct?.toFixed(0)}% / 회복시 ${a.toRecoveryPct?.toFixed(0)}%` : 'n/a')
  console.log(`  ${e.peak}: 주식 ${f(e.assets.stock)} | 채권 ${f(e.assets.bond)} | 금 ${f(e.assets.gold)}`)
}

// ─── 리서치 검증 수치와 대조 (데이터 드리프트 가드) ──────────────────────────

function findEp(peakPrefix) {
  return episodes.find((e) => e.peak.startsWith(peakPrefix))
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(`검증 실패: ${msg}`)
}
const gd = findEp('1929')
assert(gd, '1929 에피소드 미검출')
assert(gd.depthPct < -70 && gd.depthPct > -85, `1929 낙폭 ${gd.depthPct}`)
const stag = episodes.find((e) => e.peak >= '1965' && e.peak <= '1974')
assert(stag, '스태그플레이션 에피소드 미검출')
const lost = findEp('2000')
assert(lost, '2000 에피소드 미검출')
assert(lost.recovery && lost.recovery.startsWith('2013'), `2000 회복 ${lost?.recovery} (검증 기대: 2013)`)

// 매크로 앵커 — 딥리서치 검증 수치·공지의 역사적 사실과 대조 (신뢰도 가드)
const at = (arr, ym) => arr[dates.indexOf(ym)]
assert(Math.abs(at(capeArr, '1929-09') - 32.6) < 1.5, `CAPE 1929-09 = ${at(capeArr, '1929-09')} (검증 기대 ~32.6)`)
assert(at(capeArr, '2000-01') > 42 && at(capeArr, '2000-01') < 45, `CAPE 2000-01 = ${at(capeArr, '2000-01')} (검증 기대 ~44)`)
assert(Math.abs(at(gs10Arr, '1981-09') - 15.32) < 0.5, `GS10 1981-09 = ${at(gs10Arr, '1981-09')} (역사적 고점 15.32%)`)
assert(at(cpiYoY, '1920-06') > 15, `CPI YoY 1920-06 = ${at(cpiYoY, '1920-06')} (WWI 인플레 >15% 기대)`)
assert(at(cpiYoY, '1932-09') < -9, `CPI YoY 1932-09 = ${at(cpiYoY, '1932-09')} (대공황 디플레 <-9% 기대)`)
assert(at(cpiYoY, '1947-06') > 8, `CPI YoY 1947-06 = ${at(cpiYoY, '1947-06')} (전후 인플레 >8% 기대)`)
assert(at(cpiYoY, '1980-03') > 12, `CPI YoY 1980-03 = ${at(cpiYoY, '1980-03')} (스태그 정점 >12% 기대)`)
assert(at(realRate10, '1974-12') < 0, `실질금리 1974-12 = ${at(realRate10, '1974-12')} (음수 기대)`)
assert(at(realRate10, '1984-06') > 4, `실질금리 1984-06 = ${at(realRate10, '1984-06')} (볼커 이후 +4% 초과 기대)`)
console.log('\n매크로 앵커 검증 통과: CAPE(1929/2000)·GS10(1981)·CPI YoY(1920/1932/1947/1980)·실질금리(1974/1984) ✓')

// ─── 출력 1: history.json (역사 연구 탭) ─────────────────────────────────────

const round = (arr, d = 3) => arr.map((v) => (v == null ? null : Number(v.toFixed(d))))
const out = {
  meta: {
    sources: [
      'Robert Shiller (Yale) 월간 데이터 — github.com/datasets/s-and-p-500 미러 (ODC-PDDL)',
      '금 월간 — github.com/datasets/gold-prices (ODC-PDDL)',
    ],
    method: {
      stock: 'Shiller 총수익: 월평균 가격 + 배당(연/12) 월간 재투자. 실질 = CPI 디플레이트',
      bond: 'GS10 수익률 파생 10년 만기고정 근사 총수익 — 실제 채권지수 아님',
      gold: '금가격 (배당 없음). 1933-1974 미국 민간 금보유 금지·공정가 시대 주의',
      macro: 'cpiYoY = 직전 12개월 CPI 상승률, realRate10 = GS10 − cpiYoY (사후적 근사), cape = Shiller PE10(1881~)',
      base: '1900-01 = 100',
    },
    dataEnd: dates[dates.length - 1],
    generatedBy: 'scripts/build-history.mjs',
  },
  series: {
    dates: dates.slice(baseI),
    stock: round(stockN.slice(baseI)),
    bond: round(bondN.slice(baseI)),
    gold: round(goldN.slice(baseI)),
    stockNom: round(stockNomN.slice(baseI)),
    bondNom: round(bondNomN.slice(baseI)),
    goldNom: round(goldNomN.slice(baseI)),
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
console.log(`\npublic/data/history.json 생성 (${dates.length - baseI}개월, ${episodes.length}개 구간) ✓`)

// ─── 출력 2: history-assets.json (백테스터 월간 합성 자산 — 명목, 1871~) ─────

/** 명목 지수를 1900-01=100 스케일 그대로 자산 가격으로 사용 (1871~ 전체) */
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
    note: '역사 월간 합성 자산 — 명목 지수, 배당 내재(총수익), 월간 해상도(월평균 가격). 1900-01=100 스케일',
    generatedBy: 'scripts/build-history.mjs',
    dataEnd: dates[dates.length - 1],
  },
  assets: {
    'SPX-HIST': toAsset(stockNomN),
    'UST10-HIST': toAsset(bondNomN),
    'GOLD-HIST': toAsset(goldNomN),
  },
}
for (const [t, a] of Object.entries(assetsOut.assets)) {
  assert(a.dates.length > 1200, `${t} 데이터 부족 (${a.dates.length}개월)`)
  console.log(`  ${t}: ${a.dates[0]} ~ ${a.dates[a.dates.length - 1]} (${a.dates.length}개월)`)
}
writeFileSync(join(root, 'public/data/history-assets.json'), JSON.stringify(assetsOut))
console.log('public/data/history-assets.json 생성 ✓')
