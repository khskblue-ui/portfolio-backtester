// 트라이팟 실전 추적: 매 거래일 미국 장 마감 뒤 국면·목표 비중을 판정하고, 신호가 바뀌면 알린다.
// 규칙은 백테스트와 같은 코드(strategies.mjs → lib.mjs computeSignals)를 쓴다.
//
// 사용: node scripts/tripod/live.mjs [--notify] [--test-notify] [--offline] [--dry]
//   --notify       신호가 바뀌면 알림(GitHub 이슈, 환경변수 NTFY_TOPIC, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
//   --test-notify  알림 경로 시험 메시지 1건
//   --offline      data-src/tripod 스냅숏으로 계산(네트워크 없음, 자체 검사용, 파일 쓰지 않음)
//   --dry          파일을 쓰지 않고 화면에만 출력
// 출력: signals/tripod/STATUS.md(현황), state.json(상태·알림 기록), log.csv(매일 판정 기록, 추가만 함),
//       dashboard.json(홈페이지 트라이팟 탭이 읽는 데이터, 스키마는 src/ui/tripodData.ts)
import fs from 'node:fs'
import path from 'node:path'
import { readBars, readDivs, sma, drawdown52 } from './lib.mjs'
import { STRATEGIES, weightsOf, tripodExposure, planOf } from './strategies.mjs'
import { RULE_DEFAULT } from './lib.mjs'
import { simTax, TAX, holdPlan, mixPlan, yearlyRebal } from './aftertax.mjs'
import { nextTradingDay, isUsDst, closeInKst, withWeekday } from './calendar.mjs'

const ARGS = new Set(process.argv.slice(2))
const OFFLINE = ARGS.has('--offline'), DRY = ARGS.has('--dry') || OFFLINE
const OUT = path.resolve(import.meta.dirname, '../../signals/tripod')
// 가상 추적 시작(이 날 종가 기준). TRIPOD_PAPER_START는 계산 검사용(기록 파일은 쓰지 말 것: --dry와 함께)
export const PAPER_START = process.env.TRIPOD_PAPER_START || '2026-10-23'
const NOTIFY = (process.env.NOTIFY_STRATEGIES || 'tripod').split(',').map((s) => s.trim()).filter(Boolean)
const REPO = process.env.GITHUB_REPOSITORY || 'khskblue-ui/portfolio-backtester'
const STATUS_URL = `https://github.com/${REPO}/blob/main/signals/tripod/STATUS.md`
const log = (...a) => console.log(...a)
const fmt = (x, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (x, d = 1) => `${(Math.abs(x * 100) < 0.5 * 10 ** -d ? 0 : x * 100).toFixed(d)}%`

// ── 데이터 ────────────────────────────────────────────────────────────────

async function fetchJson(url, tries = 4) {
  let last
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (tripod-live)' } })
      if (res.ok) return await res.json()
      last = new Error(`HTTP ${res.status} ${url}`)
    } catch (e) { last = e }
    await new Promise((s) => setTimeout(s, 2000 * 2 ** k))
  }
  throw last
}

/** 지금 미국 동부 날짜와 장 마감(16:20, VIX 확정 여유) 이후인지 */
function nowEt() {
  const utc = new Date()
  const d0 = utc.toISOString().slice(0, 10)
  const off = isUsDst(d0) ? 4 : 5
  const et = new Date(utc.getTime() - off * 3600e3)
  return { date: et.toISOString().slice(0, 10), afterClose: et.getUTCHours() * 60 + et.getUTCMinutes() >= 16 * 60 + 20 }
}

/** 야후 v8 일봉 → [{d,o,h,c,a}] (마감 전 당일 봉 제외), 배당 [{d,amt}] */
async function yahoo(sym, period1 = 470000000) {
  const p2 = Math.floor(Date.now() / 1000) + 86400
  const q = `/v8/finance/chart/${encodeURIComponent(sym)}?period1=${period1}&period2=${p2}&interval=1d&events=div`
  let j
  try { j = await fetchJson(`https://query2.finance.yahoo.com${q}`, 2) } catch { j = await fetchJson(`https://query1.finance.yahoo.com${q}`, 3) }
  const r = j.chart.result[0], qt = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose
  const day = (t) => new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10)
  const bars = []
  r.timestamp.forEach((t, i) => {
    if (qt.close[i] == null) return
    const d = day(t)
    if (bars.length && bars.at(-1).d === d) bars.pop()
    bars.push({ d, o: qt.open[i] ?? qt.close[i], h: qt.high[i] ?? qt.close[i], c: qt.close[i], a: adj?.[i] ?? qt.close[i] })
  })
  const et = nowEt()
  if (bars.length && bars.at(-1).d === et.date && !et.afterClose) bars.pop() // 장중 봉은 판정에 쓰지 않는다
  const divs = Object.values(r.events?.dividends ?? {}).sort((a, b) => a.date - b.date).map((x) => ({ d: day(x.date), amt: x.amount }))
  return { bars, divs }
}

/** FRED 일별 계열(야후 실패 시 대체). 결측('.')은 건너뛴다 */
async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`)
  return (await res.text()).trim().split('\n').slice(1).map((l) => l.split(',')).filter(([, v]) => v && v !== '.').map(([d, v]) => ({ d, o: +v, h: +v, c: +v, a: +v }))
}

async function loadLive() {
  const warn = []
  let ndx, vix, irx
  try { ndx = (await yahoo('^NDX')).bars } catch (e) { warn.push(`야후 ^NDX 실패(${e.message}), FRED NASDAQ100 사용`); ndx = await fred('NASDAQ100') }
  try { vix = (await yahoo('^VIX')).bars } catch (e) { warn.push(`야후 ^VIX 실패(${e.message}), FRED VIXCLS 사용`); vix = await fred('VIXCLS') }
  try { irx = (await yahoo('^IRX')).bars } catch (e) { warn.push(`야후 ^IRX 실패(${e.message}), 현금 수익 0으로 계산`); irx = [] }
  const etf = {}
  for (const n of ['QQQ', 'QLD', 'TQQQ']) {
    try { etf[n] = await yahoo(n, Math.floor(Date.parse('2026-01-01') / 1000)) } catch (e) { warn.push(`야후 ${n} 실패(${e.message}), 가상 추적 생략`) }
  }
  return { ndx, vix, irx, etf, warn }
}

function loadOffline() {
  const etf = {}
  for (const n of ['QQQ', 'QLD', 'TQQQ']) etf[n] = { bars: readBars(n), divs: readDivs(n) }
  return { ndx: readBars('NDX'), vix: readBars('VIX'), irx: readBars('IRX'), etf, warn: ['오프라인: data-src/tripod 스냅숏 사용'] }
}

/** 나스닥100 달력에 맞춘 시장 객체(lib.loadMarket과 같은 형태·같은 forward-fill) */
export function buildMarket(ndx, vix, irx) {
  const ffill = (bars) => {
    const m = new Map(bars.map((x) => [x.d, x.c]))
    let last = NaN
    return ndx.map((x) => { const v = m.get(x.d); if (v != null) last = v; return last })
  }
  const dates = ndx.map((x) => x.d)
  return {
    base: 'NDX', etf: null, etfStart: '9999-12-31', etfClose: new Map(), divYield: new Map(),
    dates, open: ndx.map((x) => x.o), high: ndx.map((x) => x.h), close: ndx.map((x) => x.c),
    vix: ffill(vix), irx: irx.length ? ffill(irx).map((v) => (Number.isNaN(v) ? 0 : v)) : dates.map(() => 0),
    lastIsMonthEnd: dates.length ? nextTradingDay(dates.at(-1)).slice(0, 7) !== dates.at(-1).slice(0, 7) : false,
  }
}

// ── 판정 ──────────────────────────────────────────────────────────────────

const label = (L) => {
  const w = weightsOf(L), n = ['QQQ', 'QLD', 'TQQQ', '현금']
  const parts = w.map((x, k) => [x, n[k]]).filter(([x]) => x > 1e-9).map(([x, nm]) => `${nm} ${Math.round(x * 100)}%`)
  return parts.join(' + ')
}
const lev = (L) => `${+L.toFixed(2)}배`

/** 트라이팟 판정 근거와 경계선 */
function tripodDetail(m) {
  const { sig } = tripodExposure(m, 3)
  const t = m.dates.length - 1
  const ma = sma(m.close, 250), dd = drawdown52(m, 'c252')
  let hi = -Infinity
  for (let j = t - 251; j <= t; j++) hi = Math.max(hi, m.close[j])
  return {
    t, close: m.close[t], ma: ma[t], ratio: m.close[t] / ma[t], regime: sig.regime[t], vix: m.vix[t], vix10: sig.vix10[t], dd: dd[t], hi,
    target: sig.target[t], prevTarget: sig.target[t - 1], prevRegime: sig.regime[t - 1], prevVix10: sig.vix10[t - 1], prevDd: dd[t - 1],
    // 다음 거래일 종가 기준 경계(근사: 250일선·52주 고점은 하루 사이 거의 변하지 않는다고 봄. VIX는 정확)
    upPx: 1.01 * ma[t], downPx: 0.95 * ma[t], ddPx: 0.91 * hi,
    sig,
  }
}

function reasons(d) {
  const r = []
  if (d.regime !== d.prevRegime) r.push(d.regime === 'UP' ? `나스닥100이 250일선 × 1.01(${fmt(d.upPx)}) 위로 마감해 상승 국면으로 전환` : `나스닥100이 250일선 × 0.95(${fmt(d.downPx)}) 아래로 마감해 하락 국면으로 전환`)
  if (d.regime === 'UP') {
    if ((d.vix10 < 28) !== (d.prevVix10 < 28)) r.push(`VIX 10일 평균 ${d.vix10.toFixed(1)}이 28 ${d.vix10 < 28 ? '아래로 내려옴' : '이상으로 올라감'}`)
    if ((d.dd >= -0.09) !== (d.prevDd >= -0.09)) r.push(`52주 고점 대비 ${pct(d.dd)}로 한도 -9%${d.dd >= -0.09 ? ' 안으로 회복' : '를 넘음'}`)
  } else if ((d.vix10 < 18) !== (d.prevVix10 < 18)) r.push(`하락 국면에서 VIX 10일 평균 ${d.vix10.toFixed(1)}이 18 ${d.vix10 < 18 ? '아래로 내려옴' : '이상으로 올라감'}`)
  return r.length ? r : ['국면·VIX·낙폭 조건 조합이 바뀜']
}

function analyze(m) {
  const t = m.dates.length - 1
  const asOf = m.dates[t], exec = nextTradingDay(asOf)
  const st = {}
  for (const s of STRATEGIES) {
    const L = s.exposure(m)
    let j = t
    while (j > 0 && String(L[j - 1]) === String(L[j])) j--
    const changes = []
    for (let i = t; i > 0 && changes.length < 8; i--) if (L[i - 1] !== null && String(L[i - 1]) !== String(L[i])) changes.push({ d: m.dates[i], from: L[i - 1], to: L[i], exec: nextTradingDay(m.dates[i]) })
    st[s.id] = { L, now: L[t], prev: L[t - 1], changed: String(L[t]) !== String(L[t - 1]), since: m.dates[j], changes }
  }
  return { t, asOf, exec, st, trip: tripodDetail(m) }
}

/** 비교용 단순 보유(후보와 함께 가상 추적). QQQ+현금은 매년 첫 거래일에 비중을 되돌린다(검증 §8과 같음) */
export const PAPER_BENCH = [
  { id: 'qqq', name: 'QQQ 보유', exposure: 1, plan: () => holdPlan(0), rebalance: () => () => false },
  { id: 'qqq70', name: 'QQQ 70% + 현금 30%', exposure: 0.7, plan: () => mixPlan(0.7), rebalance: yearlyRebal },
  { id: 'qqq50', name: 'QQQ 50% + 현금 50%', exposure: 0.5, plan: () => mixPlan(0.5), rebalance: yearlyRebal },
]
export const PAPER_KRW = 1e8 // 세후 계산의 시작 금액(연 250만 원 공제가 금액에 따라 달라지므로 고정)

/**
 * 실제 ETF 수정종가로 PAPER_START 종가부터 가상 추적. 세전·세후 모두 aftertax.mjs의 simTax로 계산하고
 * "오늘 전부 판다"고 본 청산 기준 값을 낸다(편도 5bp, 세후는 1억 원 시작·한국 세금 모델).
 * QQQ 분배금은 수정종가에 들어 있고, 원천징수 15%를 매기려고 분배 비율을 따로 넣는다.
 */
function paper(m, etf, a) {
  if (!['QQQ', 'QLD', 'TQQQ'].every((n) => etf[n])) return null
  const p0 = m.dates.indexOf(PAPER_START)
  if (p0 < 0 || p0 > a.t) return null
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(etf[n].bars.map((x) => [x.d, x.a])))
  const n = m.dates.length
  const full = [0, 1, 2, 3].map(() => new Float64Array(n).fill(1))
  for (let i = p0 + 1; i <= a.t; i++) {
    const d = m.dates[i], dp = m.dates[i - 1]
    adj.forEach((mp, k) => { if (mp.has(d) && mp.has(dp)) full[k][i] = mp.get(d) / mp.get(dp) })
    full[3][i] = 1 + (m.irx[i - 1] / 100) * ((Date.parse(d) - Date.parse(dp)) / 864e5) / 365
  }
  const qb = etf.QQQ.bars
  const divYield = new Map()
  for (const dv of etf.QQQ.divs ?? []) {
    const j = qb.findIndex((x) => x.d >= dv.d)
    if (j > 0) divYield.set(qb[j].d, dv.amt / qb[j - 1].c)
  }
  const mt = { ...m, etfStart: qb[0].d, divYield }
  const prod = { full }
  const run = (plan, rebalance) => {
    const opts = { startIdx: p0, endIdx: a.t, plan, rebalance, initialKrw: PAPER_KRW }
    const pre = simTax(mt, prod, { ...opts, tax: { ...TAX, enabled: false } })
    const post = simTax(mt, prod, { ...opts, tax: TAX })
    return { path: Array.from(pre.path, (v) => v / PAPER_KRW), pre: pre.final / PAPER_KRW - 1, post: post.final / PAPER_KRW - 1 }
  }
  const out = {}
  for (const s of STRATEGIES) out[s.id] = run(planOf(a.st[s.id].L), () => false)
  for (const b of PAPER_BENCH) out[b.id] = run(b.plan(), b.rebalance(mt))
  return { p0, out }
}

// ── 출력 ──────────────────────────────────────────────────────────────────

function statusMd(m, a, pp, warn) {
  const d = a.trip, tr = a.st.tripod
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16)
  const regimeKo = d.regime === 'UP' ? '상승 국면' : d.regime === 'DOWN' ? '하락 국면' : '판정 전'
  const L = [
    '# 트라이팟 실전 추적 현황', '',
    `기준: **${withWeekday(a.asOf)} 미국 종가** · 생성 ${kst} (한국 시간) · 매 거래일 장 마감 뒤 자동 갱신`, '',
    '규칙을 기계적으로 판정한 결과이며 투자 권유가 아니다. 규칙·검증: [tripod-verification.md](../../docs/research/tripod-verification.md), 대안 평가: [tripod-alternatives.md](../../docs/research/tripod-alternatives.md), 운영 안내: [README.md](README.md)', '',
    '## 지금 들고 있어야 할 비중 (트라이팟)', '',
    `**${label(tr.now)}** (${lev(tr.now)}, ${withWeekday(tr.since)} 판정부터)`, '',
    tr.changed
      ? `> **신호 변경**: ${label(tr.prev)} → **${label(tr.now)}**. ${withWeekday(a.exec)} 미국 종가 무렵 체결(한국 시간 ${closeInKst(a.exec)} 마감). 이유: ${reasons(d).join(', ')}`
      : `다음 매매: 없음. 신호가 바뀌면 판정 다음 거래일(${withWeekday(a.exec)}) 종가에 체결한다.`,
    '',
    '## 국면 판정', '',
    '| 항목 | 값 | 기준 | 판정 |', '|---|---|---|---|',
    `| 나스닥100 종가 | ${fmt(d.close)} | 250일선 ${fmt(d.ma)} (비율 ${d.ratio.toFixed(3)}), 상승 전환 × 1.01 = ${fmt(d.upPx)}, 하락 전환 × 0.95 = ${fmt(d.downPx)} | ${regimeKo} |`,
    `| VIX 10일 평균 | ${d.vix10.toFixed(2)} (당일 ${d.vix.toFixed(2)}) | 상승 국면: 28 미만이면 3배 · 하락 국면: 18 미만이면 1.5배 | ${d.regime === 'UP' ? (d.vix10 < 28 ? '28 미만' : '28 이상') : (d.vix10 < 18 ? '18 미만' : '18 이상')} |`,
    `| 52주 고점 대비 | ${pct(d.dd)} (고점 ${fmt(d.hi)}) | 상승 국면에서 -9% 이내면 3배 | ${d.dd >= -0.09 ? '이내' : '초과'} |`,
    '',
    '## 경계선 (다음 거래일 종가 기준, 250일선·52주 고점은 오늘 값으로 근사)', '',
  ]
  // 내일 10일 평균 = (오늘까지 9일 + 내일) / 10 → 기준을 넘기는 내일 VIX
  const vixNeed = (thr) => thr * 10 - m.vix.slice(d.t - 8, d.t + 1).reduce((s, x) => s + x, 0)
  if (d.regime === 'UP') {
    L.push(`- 나스닥100이 **${fmt(d.downPx)}** 아래로 마감하면 하락 국면(오늘 대비 ${pct(d.downPx / d.close - 1)})`)
    L.push(`- 나스닥100이 **${fmt(d.ddPx)}** 아래로 마감하면 52주 낙폭 -9% 초과(오늘 대비 ${pct(d.ddPx / d.close - 1)})`)
    L.push(`- VIX가 **${vixNeed(28).toFixed(2)}** 이상으로 마감하면 10일 평균이 28 이상`)
  } else if (d.regime === 'DOWN') {
    L.push(`- 나스닥100이 **${fmt(d.upPx)}** 위로 마감하면 상승 국면(오늘 대비 ${pct(d.upPx / d.close - 1)})`)
    L.push(`- VIX가 **${vixNeed(18).toFixed(2)}** ${d.vix10 < 18 ? '이상으로 마감하면 10일 평균이 18 이상(현금으로)' : '미만으로 마감하면 10일 평균이 18 미만(1.5배로)'}`)
  }
  L.push('', '## 후보 전략 (사전 등록, 가상 추적)', '')
  L.push(`${PAPER_START} 종가에 1억 원으로 시작해 실제 ETF 수정종가로 추적한다(편도 5bp, 오늘 전부 판다고 본 청산 기준). 세후는 한국 세금 모델(양도세 22%·연 250만 원 공제, 배당 15%, 이자 15.4%). 판정 근거: [candidates-spec.md](../../docs/research/tripod/candidates-spec.md)`, '')
  L.push('| 전략 | 지금 비중 | 노출 | 마지막 변경(판정일) | 시작 이후 세전 | 세후 |', '|---|---|---|---|---|---|')
  const ret = (id, k) => (pp ? pct(pp.out[id][k]) : '—')
  for (const s of STRATEGIES) {
    const x = a.st[s.id]
    L.push(`| ${s.name} | ${label(x.now)}${x.changed ? ' (오늘 변경)' : ''} | ${lev(x.now)} | ${x.since} | ${ret(s.id, 'pre')} | ${ret(s.id, 'post')} |`)
  }
  for (const b of PAPER_BENCH) L.push(`| ${b.name} | ${label(b.exposure)} | ${lev(b.exposure)} | — | ${ret(b.id, 'pre')} | ${ret(b.id, 'post')} |`)
  L.push('', '## 최근 신호 (트라이팟)', '', '| 판정일 | 변경 | 체결일(종가) |', '|---|---|---|')
  for (const c of tr.changes) L.push(`| ${withWeekday(c.d)} | ${label(c.from)} → ${label(c.to)} | ${withWeekday(c.exec)} |`)
  if (warn.length) L.push('', '## 데이터 경고', '', ...warn.map((w) => `- ${w}`))
  return L.join('\n') + '\n'
}

/** 지금 목표가 나온 이유(변경이 없어도 보여 줄 판정 근거)와 조건별 충족 여부 */
function currentWhy(d) {
  const why = []
  if (d.regime === 'UP') {
    why.push(`상승 국면: 나스닥100이 250일선 × 1.01 위로 올라선 뒤 × 0.95 아래로 내려가지 않음(지금 × ${d.ratio.toFixed(3)})`)
    why.push(d.vix10 < 28 ? `VIX 10일 평균 ${d.vix10.toFixed(2)} < 28` : `VIX 10일 평균 ${d.vix10.toFixed(2)} ≥ 28이라 1.5배`)
    why.push(d.dd >= -0.09 ? `52주 고점 대비 ${pct(d.dd)}로 -9% 이내` : `52주 고점 대비 ${pct(d.dd)}로 -9%를 넘어 1.5배`)
  } else if (d.regime === 'DOWN') {
    why.push(`하락 국면: 나스닥100이 250일선 × 0.95 아래로 내려간 뒤 × 1.01 위로 올라서지 않음(지금 × ${d.ratio.toFixed(3)})`)
    why.push(d.vix10 < 18 ? `VIX 10일 평균 ${d.vix10.toFixed(2)} < 18이라 1.5배` : `VIX 10일 평균 ${d.vix10.toFixed(2)} ≥ 18이라 현금`)
  }
  return {
    why,
    checks: { regime: d.regime, vixOk: d.regime === 'UP' ? d.vix10 < 28 : d.vix10 < 18, ddOk: d.regime === 'UP' ? d.dd >= -0.09 : null },
  }
}

/** 홈페이지 트라이팟 탭용 데이터. 최근 2년 흐름과 가상 추적까지 담는다 */
function dashboardJson(m, a, pp, warn) {
  const d = a.trip, tr = a.st.tripod
  const r2 = (x) => +x.toFixed(2), r4 = (x) => +x.toFixed(4)
  const ma = sma(m.close, 250), dd = drawdown52(m, 'c252')
  const from = Math.max(0, a.t - 503)
  let rs = a.t
  while (rs > 0 && d.sig.regime[rs - 1] === d.sig.regime[a.t]) rs--
  const vixNeed = (thr) => r2(thr * 10 - m.vix.slice(d.t - 8, d.t + 1).reduce((s, x) => s + x, 0))
  const { why, checks } = currentWhy(d)
  return {
    version: 1,
    asOf: a.asOf,
    nextTradingDay: a.exec,
    nextCloseKst: closeInKst(a.exec),
    generatedAt: new Date().toISOString(),
    warnings: warn,
    rule: { maWin: RULE_DEFAULT.maWin, upBand: RULE_DEFAULT.upBand, downBand: RULE_DEFAULT.downBand, vixWin: RULE_DEFAULT.vixWin, vixUp: RULE_DEFAULT.vixUp, vixDown: RULE_DEFAULT.vixDown, ddLimit: RULE_DEFAULT.ddLimit },
    tripod: {
      exposure: tr.now, holding: label(tr.now), weights: weightsOf(tr.now), since: tr.since, sinceExec: nextTradingDay(tr.since),
      changed: tr.changed, prevHolding: label(tr.prev), reasons: tr.changed ? reasons(d) : [], why, checks,
      regime: d.regime, regimeSince: m.dates[rs],
      close: r2(d.close), ma250: r2(d.ma), ratio: r4(d.ratio), upPx: r2(d.upPx), downPx: r2(d.downPx),
      vix: r2(d.vix), vix10: r2(d.vix10), vixNeed28: vixNeed(28), vixNeed18: vixNeed(18),
      dd: r4(d.dd), high52: r2(d.hi), ddPx: r2(d.ddPx),
    },
    strategies: STRATEGIES.map((s) => {
      const x = a.st[s.id]
      return { id: s.id, name: s.name, desc: s.desc, exposure: +x.now.toFixed(3), holding: label(x.now), weights: weightsOf(x.now).map((w) => +w.toFixed(3)), since: x.since, changed: x.changed }
    }),
    paper: pp
      ? {
          start: PAPER_START,
          initialKrw: PAPER_KRW,
          dates: m.dates.slice(pp.p0, a.t + 1),
          // 세전 평가액 경로(시작 1). 청산 기준 수익률은 items의 pre·post
          series: Object.fromEntries(Object.entries(pp.out).map(([k, v]) => [k, v.path.map(r4)])),
          items: [
            ...STRATEGIES.map((s) => ({ id: s.id, name: s.name, holding: label(a.st[s.id].now), exposure: +a.st[s.id].now.toFixed(3), weights: weightsOf(a.st[s.id].now).map((w) => +w.toFixed(3)), pre: r4(pp.out[s.id].pre), post: r4(pp.out[s.id].post) })),
            ...PAPER_BENCH.map((b) => ({ id: b.id, name: b.name, holding: label(b.exposure), exposure: b.exposure, weights: weightsOf(b.exposure), pre: r4(pp.out[b.id].pre), post: r4(pp.out[b.id].post) })),
          ],
        }
      : null,
    history: {
      dates: m.dates.slice(from, a.t + 1),
      close: m.close.slice(from, a.t + 1).map(r2),
      ma250: Array.from(ma.slice(from, a.t + 1), r2),
      vix10: Array.from(d.sig.vix10.slice(from, a.t + 1), r2),
      dd: Array.from(dd.slice(from, a.t + 1), r4),
      exposure: tr.L.slice(from, a.t + 1),
    },
    changes: tr.changes.map((c) => ({ d: c.d, from: c.from, to: c.to, fromLabel: label(c.from), toLabel: label(c.to), exec: c.exec })),
  }
}

function appendLog(m, a) {
  const f = path.join(OUT, 'log.csv')
  const head = 'date,ndx,ma250,vix,vix10,dd52,regime,' + STRATEGIES.map((s) => s.id).join(',')
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [head]
  const have = new Set(lines.slice(1).map((l) => l.slice(0, 10)))
  const ma = sma(m.close, 250), dd = drawdown52(m, 'c252'), sig = a.trip.sig
  for (let i = m.dates.indexOf(PAPER_START); i >= 0 && i <= a.t; i++) {
    if (have.has(m.dates[i])) continue // 한 번 기록한 판정은 고치지 않는다(실전 기록)
    lines.push([m.dates[i], m.close[i].toFixed(2), ma[i].toFixed(2), m.vix[i].toFixed(2), sig.vix10[i].toFixed(2), dd[i].toFixed(4), sig.regime[i], ...STRATEGIES.map((s) => +a.st[s.id].L[i].toFixed(3))].join(','))
  }
  fs.writeFileSync(f, lines.join('\n') + '\n')
}

// ── 알림 ──────────────────────────────────────────────────────────────────

async function notify(title, body) {
  const sent = []
  const token = process.env.GITHUB_TOKEN
  if (token) {
    const api = (p, init) => fetch(`https://api.github.com/repos/${REPO}${p}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } })
    const assignee = process.env.NOTIFY_ASSIGNEE
    const make = (extra) => api('/issues', { method: 'POST', body: JSON.stringify({ title, body, ...extra }) })
    let res = await make({ labels: ['tripod-signal'], ...(assignee ? { assignees: [assignee] } : {}) })
    if (!res.ok) res = await make({})
    if (res.ok) {
      const issue = await res.json()
      sent.push(`GitHub 이슈 #${issue.number}`)
      // 앞선 신호 이슈는 닫아 목록을 정리한다(기록은 남음)
      const open = await (await api('/issues?state=open&labels=tripod-signal&per_page=50')).json().catch(() => [])
      for (const o of Array.isArray(open) ? open : []) if (o.number !== issue.number) await api(`/issues/${o.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) })
    } else sent.push(`GitHub 이슈 실패 HTTP ${res.status}`)
  }
  if (process.env.NTFY_TOPIC) {
    const res = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: process.env.NTFY_TOPIC, title, message: body.replace(/\*\*/g, '').slice(0, 3500), click: STATUS_URL, priority: 4 }) })
    sent.push(res.ok ? 'ntfy' : `ntfy 실패 HTTP ${res.status}`)
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `${title}\n\n${body.replace(/\*\*/g, '')}`.slice(0, 4000), disable_web_page_preview: true }) })
    sent.push(res.ok ? 'Telegram' : `Telegram 실패 HTTP ${res.status}`)
  }
  return sent
}

function signalMessage(s, x, a) {
  const d = a.trip
  const title = `[${s.name}] 매매 신호: ${label(x.prev)} → ${label(x.now)} (${a.exec} 종가 체결)`
  const why = s.id === 'tripod' || s.id === 't2' ? reasons(d).join(', ') : `노출 ${lev(x.prev)} → ${lev(x.now)}`
  const body = [
    `판정: ${withWeekday(a.asOf)} 미국 종가`,
    `체결: **${withWeekday(a.exec)} 미국 종가 무렵** (한국 시간 ${closeInKst(a.exec)} 마감)`,
    `바꿀 비중: ${label(x.prev)} → **${label(x.now)}**`,
    `이유: ${why}`,
    '',
    `지표: 나스닥100 ${fmt(d.close)}, 250일선 ${fmt(d.ma)} (비율 ${d.ratio.toFixed(3)}), VIX 10일 평균 ${d.vix10.toFixed(2)}, 52주 고점 대비 ${pct(d.dd)}`,
    `현황 전체: ${STATUS_URL}`,
    '',
    '규칙을 기계적으로 판정한 결과이며 투자 권유가 아니다.',
    process.env.NOTIFY_ASSIGNEE ? `\n@${process.env.NOTIFY_ASSIGNEE}` : '',
  ].join('\n')
  return { title, body }
}

// ── 실행 ──────────────────────────────────────────────────────────────────

async function main() {
  const src = OFFLINE ? loadOffline() : await loadLive()
  const m = buildMarket(src.ndx, src.vix, src.irx)
  const a = analyze(m)
  const warn = [...src.warn]
  const vixDates = new Set(src.vix.map((x) => x.d))
  if (!vixDates.has(a.asOf)) warn.push(`${a.asOf} VIX 종가가 아직 없어 전날 값으로 계산함(다음 실행에서 다시 판정)`)
  const stale = (Date.now() - Date.parse(`${a.asOf}T21:00:00Z`)) / 864e5
  if (!OFFLINE && stale > 4) warn.push(`마지막 데이터가 ${a.asOf}로 ${stale.toFixed(0)}일 전임(데이터 지연 또는 휴장)`)
  const pp = paper(m, src.etf, a)
  const md = statusMd(m, a, pp, warn)
  log(md)

  const stateFile = path.join(OUT, 'state.json')
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { notified: {} }
  if (ARGS.has('--test-notify')) {
    const sent = await notify('[트라이팟] 알림 경로 시험', `알림이 이 경로로 도착하는지 확인하는 시험 메시지다. 실제 매매 신호가 아니다.\n\n현재 비중: ${label(a.st.tripod.now)} (${a.asOf} 판정)\n현황: ${STATUS_URL}`)
    log(`시험 알림: ${sent.join(', ') || '설정된 경로 없음'}`)
  }
  if (ARGS.has('--notify') && !vixDates.has(a.asOf)) log('VIX 미갱신: 이번 실행에서는 알리지 않음')
  else if (ARGS.has('--notify')) {
    for (const id of NOTIFY) {
      const s = STRATEGIES.find((x) => x.id === id), x = a.st[id]
      if (!s || !x.changed || state.notified[id] === a.asOf) continue
      const { title, body } = signalMessage(s, x, a)
      const sent = await notify(title, body)
      log(`알림(${id}): ${sent.join(', ') || '설정된 경로 없음'}`)
      if (sent.length) state.notified[id] = a.asOf
    }
  }
  if (DRY) return
  fs.mkdirSync(OUT, { recursive: true })
  // 생성 시각만 다르면 다시 쓰지 않는다(재실행 때 빈 커밋 방지)
  const statusFile = path.join(OUT, 'STATUS.md')
  const norm = (x) => x.replace(/ · 생성 [^·]+\(한국 시간\)/, '')
  if (!fs.existsSync(statusFile) || norm(fs.readFileSync(statusFile, 'utf8')) !== norm(md)) fs.writeFileSync(statusFile, md)
  appendLog(m, a)
  // 대시보드 데이터: 생성 시각만 다르면 다시 쓰지 않는다
  const dashFile = path.join(OUT, 'dashboard.json')
  const dash = dashboardJson(m, a, pp, warn)
  const strip = (o) => JSON.stringify({ ...o, generatedAt: null })
  if (!fs.existsSync(dashFile) || strip(JSON.parse(fs.readFileSync(dashFile, 'utf8'))) !== strip(dash)) fs.writeFileSync(dashFile, JSON.stringify(dash) + '\n')
  state.asOf = a.asOf
  state.strategies = Object.fromEntries(STRATEGIES.map((s) => [s.id, { exposure: +a.st[s.id].now.toFixed(3), holding: label(a.st[s.id].now), since: a.st[s.id].since, changedToday: a.st[s.id].changed }]))
  state.nextExecution = a.exec
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
export { analyze, label, signalMessage, dashboardJson }
