/**
 * 트라이팟 탭 데이터 — 스키마·불러오기·표시용 순수 함수.
 *
 * 판정은 이 앱에서 하지 않는다. scripts/tripod/live.mjs(백테스트와 같은 코드)가 매 거래일
 * signals/tripod/dashboard.json을 커밋하고, 이 탭은 그 파일을 읽어 보여 주기만 한다.
 * 실시간 기록: /tripod-signal/dashboard.json (vercel.json rewrite → GitHub 원본)
 * 저장본: /data/tripod-dashboard.json (빌드 시점 사본, vite.config.ts tripodSnapshot)
 */

export interface TripodDashboard {
  version: 1
  /** 판정 기준 미국 종가 날짜 */
  asOf: string
  /** 신호가 바뀌면 체결할 다음 거래일 */
  nextTradingDay: string
  /** 다음 거래일 미국 정규장 마감의 한국 시간 (MM-DD HH:MM) */
  nextCloseKst: string
  generatedAt: string
  warnings: string[]
  rule: { maWin: number; upBand: number; downBand: number; vixWin: number; vixUp: number; vixDown: number; ddLimit: number }
  tripod: {
    exposure: number
    holding: string
    /** [QQQ, QLD, TQQQ, 현금] */
    weights: number[]
    since: string
    sinceExec: string
    changed: boolean
    prevHolding: string
    reasons: string[]
    why: string[]
    checks: { regime: 'UP' | 'DOWN' | null; vixOk: boolean; ddOk: boolean | null }
    regime: 'UP' | 'DOWN' | null
    regimeSince: string
    close: number
    ma250: number
    ratio: number
    upPx: number
    downPx: number
    vix: number
    vix10: number
    vixNeed28: number
    vixNeed18: number
    dd: number
    high52: number
    ddPx: number
  }
  strategies: { id: string; name: string; desc: string; exposure: number; holding: string; weights: number[]; since: string; changed: boolean }[]
  paper: {
    start: string
    /** 세후 계산의 시작 금액(원) */
    initialKrw?: number
    dates: string[]
    /** 세전 평가액 경로(시작 1) */
    series: Record<string, number[]>
    /** 청산 기준 시작 이후 수익률(세전·세후). 2026-10-24 이전 기록에는 없음 */
    items?: PaperItem[]
  } | null
  history: { dates: string[]; close: number[]; ma250: number[]; vix10: number[]; dd: number[]; exposure: number[] }
  changes: { d: string; from: number; to: number; fromLabel: string; toLabel: string; exec: string }[]
}

export interface PaperItem { id: string; name: string; holding: string; exposure: number; weights: number[]; pre: number; post: number | null }

export type TripodSource = 'live' | 'snapshot'

export const LIVE_URL = '/tripod-signal/dashboard.json'
export const SNAPSHOT_URL = '/data/tripod-dashboard.json'
export const VIDEO_URL = 'https://youtu.be/lLdRKcBSKDM'

/** 최소 구조 검사 — 깨진 파일이나 HTML 폴백 응답을 걸러 낸다 */
export function isTripodDashboard(x: unknown): x is TripodDashboard {
  const d = x as TripodDashboard
  return (
    !!d && d.version === 1 && typeof d.asOf === 'string' && !!d.tripod && typeof d.tripod.exposure === 'number' &&
    !!d.history && Array.isArray(d.history.dates) && d.history.dates.length === d.history.close.length && Array.isArray(d.strategies)
  )
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 실시간 기록을 먼저, 안 되면 저장본을 읽는다 */
export async function loadTripodDashboard(): Promise<{ data: TripodDashboard; source: TripodSource }> {
  try {
    const d = await getJson(LIVE_URL, 8000)
    if (isTripodDashboard(d)) return { data: d, source: 'live' }
  } catch {
    // 저장본으로 넘어간다
  }
  const d = await getJson(SNAPSHOT_URL, 8000)
  if (!isTripodDashboard(d)) throw new Error('트라이팟 기록 형식이 올바르지 않습니다')
  return { data: d, source: 'snapshot' }
}

// ── 표시용 ────────────────────────────────────────────────────────────────

const WD = ['일', '월', '화', '수', '목', '금', '토']
/** 2026-10-23 → 2026-10-23(금) */
export const withWeekday = (s: string) => `${s}(${WD[new Date(`${s}T00:00:00Z`).getUTCDay()]})`
export const fmtNum = (x: number, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
/** 부호 붙은 퍼센트(U+2212 마이너스): -0.0726 → −7.3% */
export const fmtRate = (x: number, d = 1) => {
  const v = Number((x * 100).toFixed(d)) // 반올림 뒤 0이면 부호 없이 0.0%
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(d)}%`
}
export const fmtLev = (L: number) => `${+L.toFixed(2)}배`

/** 생성 시각(ISO) → 한국 시간 "MM-DD HH:MM" */
export function kstStamp(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const k = new Date(t + 9 * 3600e3).toISOString()
  return `${k.slice(5, 10)} ${k.slice(11, 16)}`
}

/** 노출이 같은 날들을 묶은 구간 — 차트 배경 음영용 */
export function exposureSpans(dates: string[], exposure: (number | null)[]): { x1: string; x2: string; L: number }[] {
  const out: { x1: string; x2: string; L: number }[] = []
  for (let i = 0; i < dates.length; i++) {
    const L = exposure[i] ?? 0
    const last = out[out.length - 1]
    if (last && last.L === L) last.x2 = dates[i]
    else out.push({ x1: dates[i], x2: dates[i], L })
  }
  return out
}

/** min~max 사이 위치(0~1, 범위 밖은 끝에 붙임) — 게이지 표식용 */
export const meterPos = (v: number, min: number, max: number) => Math.min(1, Math.max(0, (v - min) / (max - min)))

/**
 * 조건 카드 상태. 'ok' 충족·여유, 'near' 충족이지만 경계 가까움, 'off' 미충족, 'na' 지금 국면에서는 안 봄.
 * "가까움" 폭은 화면 안내용 기준이며 규칙의 일부가 아니다.
 */
export type CondLevel = 'ok' | 'near' | 'off' | 'na'
export const NEAR = { trendPct: 0.03, vixPts: 3, ddPts: 0.02 }

export function conditionLevels(t: TripodDashboard['tripod'], rule: TripodDashboard['rule']): { trend: CondLevel; vix: CondLevel; dd: CondLevel } {
  const up = t.regime === 'UP'
  const trend: CondLevel = t.regime == null ? 'na' : up ? (t.close / t.downPx - 1 > NEAR.trendPct ? 'ok' : 'near') : 'off'
  const vixThr = up ? rule.vixUp : rule.vixDown
  const vix: CondLevel = t.vix10 < vixThr ? (vixThr - t.vix10 > NEAR.vixPts ? 'ok' : 'near') : 'off'
  const dd: CondLevel = !up ? 'na' : t.dd >= rule.ddLimit ? (t.dd - rule.ddLimit > NEAR.ddPts ? 'ok' : 'near') : 'off'
  return { trend, vix, dd }
}

/** 가상 추적 수익률(시작 이후). 기록이 한 날뿐이면 0 */
export function paperReturn(series: number[] | undefined): number | null {
  if (!series || series.length === 0) return null
  return series[series.length - 1] / series[0] - 1
}

/** 비교 기준(단순 보유) 행의 id. 나머지는 사전 등록 후보와 트라이팟 */
export const PAPER_BENCH_IDS = ['qqq', 'qqq70', 'qqq50']

/** 가상 추적 표의 행. 새 기록은 items(세전·세후), 예전 기록은 series로 세전만 */
export function paperRows(d: TripodDashboard): PaperItem[] {
  const p = d.paper
  if (p?.items?.length) return p.items
  const pre = (id: string) => paperReturn(p?.series[id]) ?? NaN
  return [
    ...d.strategies.map((x) => ({ id: x.id, name: x.name, holding: x.holding, exposure: x.exposure, weights: x.weights, pre: pre(x.id), post: null })),
    { id: 'qqq', name: 'QQQ 보유', holding: 'QQQ 100%', exposure: 1, weights: [1, 0, 0, 0], pre: pre('qqq'), post: null },
  ]
}

/** 가상 추적 표의 물음표 설명: 매매법별 규칙(명세 docs/research/tripod/candidates-spec.md와 같은 내용) */
export const PAPER_INFO: Record<string, string> = {
  tripod:
    '영상에서 공개된 규칙입니다. 나스닥100이 250일선 × 1.01 위로 마감하면 상승 국면, × 0.95 아래로 마감하면 하락 국면으로 보고, 그 사이에서는 직전 국면을 유지합니다. 상승 국면에서 VIX 10일 평균이 28 미만이고 52주 고점 대비 낙폭이 9% 이내면 TQQQ 100%, 아니면 QQQ 50% + QLD 50%입니다. 하락 국면에서는 VIX 10일 평균이 18 미만이면 QQQ 50% + QLD 50%, 아니면 현금 100%입니다.',
  t2: '판정은 트라이팟과 같고, TQQQ 100% 자리에 QLD 100%를 넣어 최대 노출을 2배로 낮췄습니다. 결과를 보기 전에 기준을 고정한 대안 평가에서 유일하게 기준을 통과했습니다.',
  te3: '100·150·200·250·300일 이동평균 5개 가운데 나스닥100 종가가 위에 있는 비율만큼 3배를 싣습니다. 5개 모두 위면 3배, 4개면 2.4배, 하나도 없으면 현금입니다. 기간 하나에 걸지 않으려고 평균을 낸 방식입니다.',
  tev3: '추세 앙상블 노출에 변동성 상한을 씌웁니다. 상한은 3배 × (최근 5년 20일 변동성의 중앙값 ÷ 최근 20일 변동성)이고 월말에만 바꿉니다. 둘 중 작은 값을 0.5배 단위로 내리므로, 평소보다 출렁임이 크면 덜 싣게 됩니다.',
  tev2: '추세 앙상블 + 상대 변동성과 같은 규칙에서 최대 노출만 2배로 낮췄습니다.',
  qqq: 'QQQ(나스닥100 1배)를 사서 계속 들고 있습니다.',
  qqq70: 'QQQ 70%와 현금 30%로 시작해 매년 첫 거래일에 7:3으로 되돌립니다. 현금은 미국 3개월 국채 금리를 받는다고 봅니다.',
  qqq50: 'QQQ 50%와 현금 50%로 시작해 매년 첫 거래일에 5:5로 되돌립니다.',
}

/**
 * 검증 요약 — 연구 문서(docs/research/tripod-verification.md, tripod-alternatives.md)의 수치를 그대로 옮겼다.
 * tests/tripod-dashboard.test.ts가 각 수치가 문서에 있는지 확인한다.
 */
export const TRIPOD_FINDINGS: { text: string; anchors: { doc: 'verification' | 'alternatives'; value: string }[] }[] = [
  {
    text: '영상 규칙을 "신호 다음 거래일 종가에 체결"로 해석하면 1991~2026 성과가 재현됩니다. CAGR 32.6%, MDD -61.4%(영상 32.9%, -62.0%).',
    anchors: [{ doc: 'verification', value: '32.6%' }, { doc: 'verification', value: '-61.4%' }, { doc: 'verification', value: '32.9%' }, { doc: 'verification', value: '-62.0%' }],
  },
  {
    text: '한국 양도세(22%)를 넣으면 세후 CAGR 27.0%, QQQ 보유는 14.7%입니다. 실제 ETF 가격(2010~2026)으로 다시 계산해도 세후 25.1% 대 17.5%입니다.',
    anchors: [{ doc: 'verification', value: '27.0%' }, { doc: 'verification', value: '14.7%' }, { doc: 'verification', value: '25.1%' }, { doc: 'verification', value: '17.5%' }],
  },
  {
    text: '다만 수익 우위의 대부분은 레버리지 몫입니다. 같은 2010~2026 구간에는 QLD(2배)를 그냥 들고 있는 편이 세후 30.5%로 더 높았습니다.',
    anchors: [{ doc: 'verification', value: '30.5%' }],
  },
  {
    text: '같은 규칙을 러셀2000·FTSE100·닛케이225·항셍·코스피에 적용하면 MDD가 -76~-96%입니다. 나스닥100의 변동성이 25% 커지는 가정에서도 QQQ보다 낮아집니다.',
    anchors: [{ doc: 'verification', value: '-76~-96%' }, { doc: 'verification', value: '25% 커지' }],
  },
  {
    text: '결과를 보기 전에 기준을 고정한 대안 평가에서는 TQQQ 자리에 QLD를 쓰는 2배판만 기준을 통과했습니다(세후 21.9%, MDD -53.6%).',
    anchors: [{ doc: 'alternatives', value: '21.9%' }, { doc: 'alternatives', value: '-53.6%' }],
  },
]
