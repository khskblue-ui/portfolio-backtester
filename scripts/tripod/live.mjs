// 트라이팟 실전 추적: 매 거래일 미국 장 마감 뒤 국면·목표 비중을 판정하고, 신호가 바뀌면 알린다.
// 규칙은 백테스트와 같은 코드(strategies.mjs → lib.mjs computeSignals)를 쓴다.
//
// 사용: node scripts/tripod/live.mjs [--notify] [--test-notify] [--offline] [--dry]
//   --notify       신호가 바뀌면 알림(GitHub 이슈, 환경변수 NTFY_TOPIC, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
//   --test-notify  알림 경로 시험 메시지 1건
//   --offline      data-src/tripod 스냅숏으로 계산(네트워크 없음, 자체 검사용, 파일 쓰지 않음)
//   --dry          파일을 쓰지 않고 화면에만 출력
// 출력: signals/tripod/STATUS.md(현황), state.json(상태·알림 기록), log.csv(매일 판정 기록, 추가만 함)
import fs from 'node:fs'
import path from 'node:path'
import { readBars, readDivs, sma, drawdown52 } from './lib.mjs'
import { STRATEGIES, weightsOf, tripodExposure } from './strategies.mjs'
import { nextTradingDay, isUsDst, closeInKst, withWeekday } from './calendar.mjs'

const ARGS = new Set(process.argv.slice(2))
const OFFLINE = ARGS.has('--offline'), DRY = ARGS.has('--dry') || OFFLINE
const OUT = path.resolve(import.meta.dirname, '../../signals/tripod')
export const PAPER_START = '2026-10-23' // 가상 추적 시작(이 날 종가 기준)
const NOTIFY = (process.env.NOTIFY_STRATEGIES || 'tripod').split(',').map((s) => s.trim()).filter(Boolean)
const REPO = process.env.GITHUB_REPOSITORY || 'khskblue-ui/portfolio-backtester'
const STATUS_URL = `https://github.com/${REPO}/blob/main/signals/tripod/STATUS.md`
const log = (...a) => console.log(...a)
const fmt = (x, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`

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

/** 실제 ETF 수정종가로 PAPER_START 종가부터 가상 추적(세전, 편도 5bp) */
function paper(m, etf, a) {
  if (!['QQQ', 'QLD', 'TQQQ'].every((n) => etf[n])) return null
  const adj = ['QQQ', 'QLD', 'TQQQ'].map((n) => new Map(etf[n].bars.map((x) => [x.d, x.a])))
  const p0 = m.dates.indexOf(PAPER_START)
  if (p0 < 0 || p0 > a.t) return null
  const out = {}
  const run = (Lfn) => {
    let V = weightsOf(Lfn(p0)).slice(), cur = Lfn(p0)
    const path = [1]
    for (let i = p0 + 1; i <= a.t; i++) {
      const d = m.dates[i], dp = m.dates[i - 1]
      const r = adj.map((mp) => (mp.has(d) && mp.has(dp) ? mp.get(d) / mp.get(dp) : 1))
      const rf = 1 + (m.irx[i - 1] / 100) * ((Date.parse(d) - Date.parse(dp)) / 864e5) / 365
      V = V.map((v, k) => v * (k < 3 ? r[k] : rf))
      const want = Lfn(i)
      if (String(want) !== String(cur)) {
        const tot = V.reduce((s, x) => s + x, 0), w = weightsOf(want)
        const turn = w.reduce((s, x, k) => s + Math.abs(x - V[k] / tot), 0)
        const post = tot * (1 - 5e-4 * turn)
        V = w.map((x) => x * post)
        cur = want
      }
      path.push(V.reduce((s, x) => s + x, 0))
    }
    return path
  }
  for (const s of STRATEGIES) out[s.id] = run((i) => a.st[s.id].L[i - 1] ?? 0)
  out.qqq = run(() => 1)
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
  L.push(`${PAPER_START} 종가부터 실제 ETF 수정종가로 추적한다(세전, 편도 5bp). 판정 근거: [candidates-spec.md](../../docs/research/tripod/candidates-spec.md)`, '')
  L.push('| 전략 | 지금 비중 | 노출 | 마지막 변경(판정일) | 시작 이후 |', '|---|---|---|---|---|')
  for (const s of STRATEGIES) {
    const x = a.st[s.id], ret = pp ? pct(pp.out[s.id].at(-1) - 1) : '—'
    L.push(`| ${s.name} | ${label(x.now)}${x.changed ? ' (오늘 변경)' : ''} | ${lev(x.now)} | ${x.since} | ${ret} |`)
  }
  L.push(`| QQQ 보유 | QQQ 100% | 1배 | — | ${pp ? pct(pp.out.qqq.at(-1) - 1) : '—'} |`)
  L.push('', '## 최근 신호 (트라이팟)', '', '| 판정일 | 변경 | 체결일(종가) |', '|---|---|---|')
  for (const c of tr.changes) L.push(`| ${withWeekday(c.d)} | ${label(c.from)} → ${label(c.to)} | ${withWeekday(c.exec)} |`)
  if (warn.length) L.push('', '## 데이터 경고', '', ...warn.map((w) => `- ${w}`))
  return L.join('\n') + '\n'
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
  state.asOf = a.asOf
  state.strategies = Object.fromEntries(STRATEGIES.map((s) => [s.id, { exposure: +a.st[s.id].now.toFixed(3), holding: label(a.st[s.id].now), since: a.st[s.id].since, changedToday: a.st[s.id].changed }]))
  state.nextExecution = a.exec
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
export { analyze, label, signalMessage }
