/**
 * "지금은?" 신호 판정 — 최신 데이터를 역사적 하락 구간들의 선행조건과 대조.
 *
 * 원칙:
 * - 예측이 아니라 "선행조건 체크리스트": 역사 7개 구간이 시작될 때 관측된 조건과
 *   지금을 같은 잣대로 비교한다. 임계값은 전부 역사 에피소드의 실측 시작값에서 도출.
 * - 모든 판정에 근거(reason)와 데이터 기준일(asOf)을 동봉 — 신호마다 소스의
 *   실시간성이 다르므로(주가·금리 = 일별, CPI = 월간 발표) 개별 표기.
 * - 순수 함수 — 번들(history.json) + 선택적 라이브 스냅샷만 입력 (테스트 가능).
 *
 * 데이터 소스 (실시간성 순):
 * - 주가: ^SP500TR 일별 종가 (Yahoo /yf 프록시) — 전일까지
 * - 금리: FRED DGS10·DTB3 일별 — 전일까지
 * - CPI: FRED CPIAUCNS 월간 — 최신 발표월 (통상 1~2개월 지연)
 * - 라이브 조회 실패 시 번들(월평균, dataEnd 기준)로 폴백
 *
 * 임계값의 역사적 근거 (번들 데이터 실측):
 * - CAPE: 1929 고점 32.6 / 2000 고점 44 / 1968 고점 24.1 (B형 시작 밸류에이션)
 * - CPI YoY: A형 본격화 수준 5%+ (1916: 20%대, 1946: 19%, 1973: 12%);
 *   3% 돌파 + 상승 추세 = 1968년형 "이륙 초입"
 * - 실질금리: A형 구간에서 마이너스로 매몰 (1946 −15%, 1974 −5%대);
 *   완화발(저인플레) 마이너스는 2009~2021처럼 자산가격에 순풍 — 원인 구분
 * - 장단기(10y−3m) 역전: 표준 침체 선행 신호 (1969·1973·1980·2000·2007·2019)
 */

export type SignalLevel = 'ok' | 'watch' | 'alert'

export interface Signal {
  key: 'market' | 'valuation' | 'inflation' | 'realRate' | 'curve'
  label: string
  value: string
  level: SignalLevel
  reason: string
  /** 이 신호가 근거한 데이터의 기준일/기준월 */
  asOf: string
}

export interface NowAssessment {
  /** 대표 기준 표기 (가장 실시간 소스 기준) */
  asOf: string
  signals: Signal[]
  headline: string
  rationale: string
  analog: string | null
  /** 라이브 데이터가 적용됐는지 (false = 번들 폴백) */
  live: boolean
}

/** 라이브 스냅샷 — nowData.ts가 프록시에서 수집 (부분 실패 허용: 필드별 optional) */
export interface LiveSnapshot {
  /** ^SP500TR 최신 일별 종가와 번들 기준월 월평균 대비 비율 */
  stock?: { date: string; trRatio: number }
  /** FRED DGS10 최신 일별 */
  gs10?: { date: string; value: number }
  /** FRED DTB3 최신 일별 */
  tbill3m?: { date: string; value: number }
  /** FRED CPIAUCNS 최신 발표월 (번들보다 새 달이면 갱신) */
  cpi?: { ym: string; value: number; yoy: number }
  /** FRED DFII10 최신 일별 — 10년 TIPS 수익률 (사전적 실질금리) */
  tips?: { date: string; value: number }
}

interface HistoryLike {
  series: { dates: string[]; stock: number[] }
  macro: {
    cpiYoY: (number | null)[]
    gs10: (number | null)[]
    realRate10: (number | null)[]
    cape: (number | null)[]
    capeProxy?: (number | null)[]
    tbill3m?: (number | null)[]
    tips10?: (number | null)[]
  }
  meta: { dataEnd: string; liveRefs?: { ym: string; cpi: number; capeProxy: number | null; stockRealLast: number } }
}

export function assessNow(h: HistoryLike, liveIn?: LiveSnapshot): NowAssessment {
  const { dates, stock } = h.series
  const n = dates.length - 1
  const m = h.macro
  const refs = h.meta.liveRefs
  const live = liveIn ?? {}
  const anyLive = Boolean(live.stock || live.gs10 || live.tbill3m || live.cpi)
  const signals: Signal[] = []

  // ── 라이브 병합: 최신 유효값과 그 기준일 ──
  // CPI: 라이브가 번들보다 새 달이면 교체
  const cpiBundle = latest(m.cpiYoY)
  const cpiNewer = live.cpi && refs && live.cpi.ym > refs.ym ? live.cpi : null
  const cpiV = cpiNewer ? cpiNewer.yoy : cpiBundle?.v ?? null
  const cpiAsOf = cpiNewer ? cpiNewer.ym : dates[n]
  const cpi6mAgo = cpiBundle ? m.cpiYoY[cpiBundle.i - (cpiNewer ? 5 : 6)] : null
  // 실질 주가: 번들 마지막 실질 지수 × TR 비율 ÷ CPI 변화 (CPI는 최신 발표치 유지 가정)
  const cpiAdj = cpiNewer && refs ? cpiNewer.value / refs.cpi : 1
  const stockRealNow = live.stock && refs ? refs.stockRealLast * (live.stock.trRatio / cpiAdj) : stock[n]
  const stockAsOf = live.stock ? live.stock.date : dates[n]
  // 금리
  const gs10V = live.gs10 ? live.gs10.value : latest(m.gs10)?.v ?? null
  const gs10AsOf = live.gs10 ? live.gs10.date : dates[n]
  const tbV = live.tbill3m ? live.tbill3m.value : m.tbill3m ? latest(m.tbill3m)?.v ?? null : null
  const tbAsOf = live.tbill3m ? live.tbill3m.date : dates[n]

  // ── 1. 시장 상태: 실질 전고점 대비 (구간 검출과 동일 잣대) ──
  let peakI = 0
  for (let k = 1; k <= n; k++) if (stock[k] >= stock[peakI]) peakI = k
  const peakV = Math.max(stock[peakI], stockRealNow)
  const ddPct = (stockRealNow / peakV - 1) * 100
  const atHigh = stockRealNow >= stock[peakI]
  // 미회복 개월: 번들 기준 근사 (라이브가 신고점이면 0)
  const uwMonths = atHigh ? 0 : n - peakI
  let marketLevel: SignalLevel = 'ok'
  if (ddPct <= -25) marketLevel = 'alert'
  else if (ddPct <= -10) marketLevel = 'watch'
  signals.push({
    key: 'market',
    label: '시장 상태 (실질 전고점 대비)',
    value: atHigh ? '실질 신고점 부근' : `${ddPct.toFixed(1)}%${uwMonths > 0 ? ` · ~${uwMonths}개월` : ''}`,
    level: marketLevel,
    asOf: stockAsOf,
    reason: atHigh
      ? `${stockAsOf} 기준 실질 총수익 지수가 역사상 최고 수준 — 이 앱의 구간 검출 규칙(낙폭 −25% 이상 + 3년 이상 미회복)에 해당하는 하락은 진행되고 있지 않습니다.`
      : `실질 전고점(${dates[peakI]}) 대비 ${ddPct.toFixed(1)}% — 역사 구간 기준(−25%·36개월)에 ${ddPct <= -25 ? '낙폭은 도달' : '아직 미달'}.`,
  })

  // ── 2. 밸류에이션 (CAPE — B형 선행조건) ──
  const capeSeries = m.capeProxy ?? m.cape
  const capeBundle = latest(capeSeries)
  const isProxy = capeBundle != null && m.cape[capeBundle.i] == null
  // 라이브: 프록시를 실질가격 변화로 미세 연장 (2개월 내 배당·이익 성장 보정은 무시 가능)
  const capeV = capeBundle ? (live.stock && refs?.capeProxy != null ? refs.capeProxy * (stockRealNow / refs.stockRealLast) : capeBundle.v) : null
  const capeAsOf = live.stock ? stockAsOf : dates[n]
  let valLevel: SignalLevel = 'ok'
  if (capeV != null && capeV >= 32) valLevel = 'alert'
  else if (capeV != null && capeV >= 24) valLevel = 'watch'
  signals.push({
    key: 'valuation',
    label: `밸류에이션 (CAPE${isProxy || live.stock ? ' 프록시' : ''})`,
    value: capeV != null ? capeV.toFixed(1) : '—',
    level: valLevel,
    asOf: capeAsOf,
    reason:
      capeV != null
        ? `역사적 대형 하락(B형)의 시작 밸류에이션: 1968년 24.1 · 1929년 32.6 · 2000년 44. 현재 ${capeV.toFixed(1)}은 ${
            capeV >= 40 ? '2000년 닷컴 버블 수준' : capeV >= 32 ? '1929년 수준 초과' : capeV >= 24 ? '1968년 수준 초과' : '역사적 위험 구간 미만'
          }. (프록시: 2023-06 실측 CAPE를 실질가격 변화로 연장한 근사 — 딥리서치 검증치 2026년 초 ~41과 정합)`
        : 'CAPE 데이터 없음',
  })

  // ── 3. 인플레이션 (A형 선행조건) ──
  const rising = cpiV != null && cpi6mAgo != null && cpiV - cpi6mAgo > 0.5
  let infLevel: SignalLevel = 'ok'
  if (cpiV != null && cpiV >= 5) infLevel = 'alert'
  else if (cpiV != null && (cpiV >= 3.5 || (cpiV >= 3 && rising))) infLevel = 'watch'
  signals.push({
    key: 'inflation',
    label: 'CPI 인플레이션 (전년동월비)',
    value: cpiV != null ? `${cpiV.toFixed(1)}%${rising ? ' ↑' : ''}` : '—',
    level: infLevel,
    asOf: cpiAsOf,
    reason:
      cpiV != null
        ? `인플레이션형(A형) 구간의 본격화 수준은 5%+ (1946년 19%, 1973년 12%). 최신 발표(${cpiAsOf}) ${cpiV.toFixed(1)}%${
            cpi6mAgo != null ? ` (6개월 전 ${cpi6mAgo.toFixed(1)}%${rising ? ' — 상승 추세' : ''})` : ''
          }${cpiV >= 3 && rising ? ' — 1968년의 "인플레 이륙 초입"과 유사한 재가속 패턴' : ''}. CPI는 월간 지표라 발표 지연(1~2개월)이 있습니다.`
        : '데이터 없음',
  })

  // ── 4. 실질금리 — 사전적(TIPS)을 주 지표로, 사후적은 역사 표지판으로 병기 ──
  // 사후적(GS10 − 후행 CPI) = 1900년대까지 비교 가능한 '체제 표지판'. 그러나 시장이
  // 할인율로 쓰는 건 사전적(TIPS) — 2022년엔 사후적이 −6%로 추락하는 동안 사전적이
  // −1%→+1.7%로 급등하며 주가를 눌렀다. 두 지표의 괴리 자체가 정보다:
  // 괴리 = 실현 인플레 − 기대 인플레 → 시장이 현 인플레를 일시적으로 보는지의 척도.
  const rrV = gs10V != null && cpiV != null ? gs10V - cpiV : null // 사후적
  const tipsV = live.tips ? live.tips.value : m.tips10 ? latest(m.tips10)?.v ?? null : null // 사전적
  const tipsAsOf = live.tips ? live.tips.date : dates[n]
  let rrLevel: SignalLevel = 'ok'
  const rrNotes: string[] = []
  // (a) A형 표지판: 사후적 마이너스 + 고인플레 = 1946·1973년과 같은 인플레 쇼크 마커
  if (rrV != null && cpiV != null && rrV < 0 && cpiV >= 3.5) {
    rrLevel = 'alert'
    rrNotes.push('사후적 마이너스 + 고인플레 = 1946·1973년형 인플레 쇼크의 표지판')
  } else if (rrV != null && rrV < 1 && cpiV != null && cpiV >= 3) {
    rrLevel = 'watch'
    rrNotes.push('실현 인플레이션이 명목금리보다 빨리 오르며 사후적 실질금리가 압축되는 국면')
  } else if (rrV != null && rrV < 0) {
    rrLevel = 'watch'
    rrNotes.push('사후적 마이너스(저인플레) — 완화발 성격: 자산가격엔 순풍이나 과열을 배양(2010년대형)')
  }
  // (b) 사전적(TIPS) 스탠스: 시장의 실제 할인율
  if (tipsV != null) {
    if (tipsV >= 2.5) {
      rrLevel = rrLevel === 'alert' ? 'alert' : 'watch'
      rrNotes.push(`TIPS ${tipsV.toFixed(2)}% = 긴축적 실질 할인율 — 고밸류에이션과 결합 시 멀티플 압박(2022년형 채널)`)
    } else if (tipsV < 0) {
      rrLevel = rrLevel === 'alert' ? 'alert' : 'watch'
      rrNotes.push(`TIPS ${tipsV.toFixed(2)}% = 초완화 — 자산가격엔 순풍이나 과열을 배양(2020-21년형)`)
    }
    // (c) 괴리 해석
    if (rrV != null && tipsV - rrV > 1) {
      rrNotes.push(`사전-사후 괴리 +${(tipsV - rrV).toFixed(1)}%p — 시장은 현재 인플레이션을 일시적으로 판단 중(기대 인플레 ≈ 브레이크이븐). 이 기대가 틀리면 금리 재가격 위험`)
    }
  }
  if (rrNotes.length === 0) rrNotes.push('사전적·사후적 모두 중립 범위 — 인플레이션형 체제와 거리')
  signals.push({
    key: 'realRate',
    label: '실질 10년 금리 (사전적 TIPS · 사후적)',
    value:
      tipsV != null && rrV != null
        ? `TIPS ${tipsV >= 0 ? '+' : ''}${tipsV.toFixed(2)}% · 사후 ${rrV >= 0 ? '+' : ''}${rrV.toFixed(2)}%`
        : rrV != null
          ? `사후 ${rrV >= 0 ? '+' : ''}${rrV.toFixed(2)}%p`
          : '—',
    level: rrLevel,
    asOf: tipsV != null && live.tips ? `TIPS ${tipsAsOf} · CPI ${cpiAsOf}` : `금리 ${gs10AsOf} · CPI ${cpiAsOf}`,
    reason:
      rrV != null || tipsV != null
        ? `${rrNotes.join('. ')}. 주의: 실질금리는 하락의 "원인"이 아니라 체제의 표지판입니다 — 실제 전달 경로는 긴축(실제·기대)·마진 압박·불확실성 프리미엄·화폐 착시이며, 인플레 구간에서도 주식은 채권·현금보다 나은(명목자산 중 최선의) 자산이었습니다(1946 회복시 실질: 주식 +3% vs 채권 −19%·현금 −22%).`
        : '데이터 없음',
  })

  // ── 5. 장단기 금리차 (10y − 3m) ──
  const spread = gs10V != null && tbV != null ? gs10V - tbV : null
  let curveLevel: SignalLevel = 'ok'
  if (spread != null && spread < 0) curveLevel = 'alert'
  else if (spread != null && spread < 0.3) curveLevel = 'watch'
  signals.push({
    key: 'curve',
    label: '장단기 금리차 (10년 − 3개월)',
    value: spread != null ? `${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%p` : '—',
    level: curveLevel,
    asOf: live.gs10 && live.tbill3m ? `${gs10AsOf} · ${tbAsOf}` : dates[n],
    reason:
      spread != null
        ? `역전(음수)은 침체의 고전적 선행 신호 — 1969·1973·1980·2000·2007·2019년 역전 후 침체가 뒤따랐습니다. 현재 ${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%p로 ${spread < 0 ? '역전 상태' : spread < 0.3 ? '평탄 — 역전에 근접' : '정상 기울기'}.`
        : '데이터 없음',
  })

  // ── 종합 ──
  const lv = (k: Signal['key']) => signals.find((s) => s.key === k)!.level
  const alerts = signals.filter((s) => s.level === 'alert').length
  const watches = signals.filter((s) => s.level === 'watch').length

  let headline: string
  let analog: string | null = null
  if (lv('market') === 'alert') headline = '역사적 하락 구간의 한복판'
  else if (alerts >= 2) headline = '하락은 시작되지 않았으나, 선행조건이 다수 충족'
  else if (alerts === 1 || watches >= 2) headline = '하락 신호는 없음 — 단, 선행조건 일부가 켜져 있음'
  else headline = '역사적 하락의 선행조건이 뚜렷하지 않음'

  const capeHigh = lv('valuation') === 'alert'
  const infRising = cpiV != null && cpiV >= 3 && rising
  const infHigh = infLevel === 'alert'
  if (capeHigh && infHigh) analog = '1973년형 (고밸류에이션 + 본격 인플레이션) 조합에 근접'
  else if (capeHigh && infRising) analog = '1968년형 — 고밸류에이션에서 인플레이션이 이륙하던 초입과 유사한 조합 (단, 밸류에이션은 당시 24 vs 지금이 더 높음)'
  else if (capeHigh) analog = '2000년형 — 인플레 없는 극단 밸류에이션'
  else if (infHigh) analog = '1946/1973년형 — 인플레이션 주도'

  const rationale =
    `${anyLive ? `주가·금리는 일별(${stockAsOf} 기준), CPI는 최신 발표월(${cpiAsOf}) 데이터로` : `번들 데이터(${dates[n]})로`} 계산한 체크리스트입니다. ` +
    `${signals.filter((s) => s.level === 'alert').map((s) => s.label).join(', ') || '없음'} = 경계, ` +
    `${signals.filter((s) => s.level === 'watch').map((s) => s.label).join(', ') || '없음'} = 주의. ` +
    `역사가 보여주는 것: 선행조건 충족은 "하락이 곧 온다"가 아니라 "만약 하락이 오면 깊고 길 수 있는 출발점"이라는 뜻입니다 — ` +
    `CAPE가 1968년 수준(24)을 넘은 1996년 이후에도 시장은 4년을 더 올랐고, 고평가 해소가 하락 없이 이익 성장만으로 이뤄진 사례도 있습니다. ` +
    `반대로 1929·2000년의 공통점은 "극단 밸류에이션에서 출발한 하락은 얕게 끝나지 않았다"는 것입니다.`

  return { asOf: stockAsOf, signals, headline, rationale, analog, live: anyLive }

  function latest(arr: (number | null)[]): { v: number; i: number } | null {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return { v: arr[i] as number, i }
    return null
  }
}
