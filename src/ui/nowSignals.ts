/**
 * "지금은?" 신호 판정 — 최신 데이터 월을 역사적 하락 구간들의 선행조건과 대조.
 *
 * 원칙:
 * - 예측이 아니라 "선행조건 체크리스트": 역사 7개 구간이 시작될 때 관측된 조건과
 *   지금을 같은 잣대로 비교한다. 임계값은 전부 역사 에피소드의 실측 시작값에서 도출.
 * - 모든 판정에 근거(reason)를 문장으로 동봉 — 사용자가 왜 그 판정인지 볼 수 있게.
 * - 순수 함수 — history.json만 입력받아 계산 (테스트 가능, UI 무관).
 *
 * 임계값의 역사적 근거 (번들 데이터 실측):
 * - CAPE: 1929 고점 32.6 / 2000 고점 44 / 1968 고점 24.1 (B형 시작 밸류에이션)
 * - CPI YoY: A형 구간 본격화 수준 5%+ (1916: 20%대, 1946: 19%, 1973: 12%);
 *   3% 돌파 + 상승 추세 = 1968년형 "이륙 초입"
 * - 실질금리: A형 구간에서 마이너스로 매몰 (1946 −15%, 1974 −5%대);
 *   완화발(저인플레) 마이너스는 2009~2021처럼 주식에 순풍이었으므로 원인 구분
 * - 장단기(10y−3m) 역전: 표준 침체 선행 신호 (1969·1973·1980·2000·2007·2019 역전 사례)
 */

export type SignalLevel = 'ok' | 'watch' | 'alert'

export interface Signal {
  key: 'market' | 'valuation' | 'inflation' | 'realRate' | 'curve'
  label: string
  /** 현재 값 표시 문자열 */
  value: string
  level: SignalLevel
  /** 판정 이유 — 역사 기준선과의 비교 */
  reason: string
}

export interface NowAssessment {
  asOf: string
  signals: Signal[]
  /** 종합 판정 헤드라인 */
  headline: string
  /** 종합 판정 근거 문단 */
  rationale: string
  /** 가장 닮은 역사 구간 (있을 때) */
  analog: string | null
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
  }
  meta: { dataEnd: string }
}

export function assessNow(h: HistoryLike): NowAssessment {
  const { dates, stock } = h.series
  const n = dates.length - 1
  const m = h.macro
  const signals: Signal[] = []

  // ── 1. 시장 상태: 실질 전고점 대비 (구간 검출과 동일한 잣대) ──
  let peakI = 0
  for (let k = 1; k <= n; k++) if (stock[k] >= stock[peakI]) peakI = k
  const ddPct = (stock[n] / stock[peakI] - 1) * 100
  const uwMonths = n - peakI
  let marketLevel: SignalLevel = 'ok'
  if (ddPct <= -25) marketLevel = 'alert'
  else if (ddPct <= -10) marketLevel = 'watch'
  signals.push({
    key: 'market',
    label: '시장 상태 (실질 전고점 대비)',
    value: uwMonths === 0 ? '실질 신고점' : `${ddPct.toFixed(1)}% · ${uwMonths}개월째`,
    level: marketLevel,
    reason:
      uwMonths === 0
        ? `기준월(${dates[n]})의 실질 총수익 지수가 역사상 최고치 — 이 앱의 구간 검출 규칙(낙폭 −25% 이상 + 3년 이상 미회복)에 해당하는 하락은 진행되고 있지 않습니다.`
        : `실질 전고점(${dates[peakI]}) 대비 ${ddPct.toFixed(1)}%, ${uwMonths}개월째 미회복 — 역사 구간 기준(−25%·36개월)에 ${ddPct <= -25 ? '낙폭은 도달' : '아직 미달'}.`,
  })

  // ── 2. 밸류에이션 (CAPE — B형 선행조건) ──
  const capeSeries = m.capeProxy ?? m.cape
  const cape = latest(capeSeries)
  const isProxy = cape != null && m.cape[cape.i] == null
  let valLevel: SignalLevel = 'ok'
  if (cape && cape.v >= 32) valLevel = 'alert'
  else if (cape && cape.v >= 24) valLevel = 'watch'
  signals.push({
    key: 'valuation',
    label: `밸류에이션 (CAPE${isProxy ? ' 프록시' : ''})`,
    value: cape ? cape.v.toFixed(1) : '—',
    level: valLevel,
    reason: cape
      ? `역사적 대형 하락(B형)의 시작 밸류에이션: 1968년 24.1 · 1929년 32.6 · 2000년 44. 현재 ${cape.v.toFixed(1)}은 ${
          cape.v >= 40 ? '2000년 닷컴 버블 수준' : cape.v >= 32 ? '1929년 수준 초과' : cape.v >= 24 ? '1968년 수준 초과' : '역사적 위험 구간 미만'
        }.${isProxy ? ' (프록시: 2023-06 실측 CAPE를 실질가격 변화로 연장한 근사 — 딥리서치 검증치 2026년 초 ~41과 정합)' : ''}`
      : 'CAPE 데이터 없음',
  })

  // ── 3. 인플레이션 (A형 선행조건) ──
  const cpi = latest(m.cpiYoY)
  const cpi6mAgo = cpi ? m.cpiYoY[cpi.i - 6] : null
  const rising = cpi != null && cpi6mAgo != null && cpi.v - cpi6mAgo > 0.5
  let infLevel: SignalLevel = 'ok'
  if (cpi && cpi.v >= 5) infLevel = 'alert'
  else if (cpi && (cpi.v >= 3.5 || (cpi.v >= 3 && rising))) infLevel = 'watch'
  signals.push({
    key: 'inflation',
    label: 'CPI 인플레이션 (전년동월비)',
    value: cpi ? `${cpi.v.toFixed(1)}%${rising ? ' ↑' : ''}` : '—',
    level: infLevel,
    reason: cpi
      ? `인플레이션형(A형) 구간의 본격화 수준은 5%+ (1946년 19%, 1973년 12%). 현재 ${cpi.v.toFixed(1)}%${
          cpi6mAgo != null ? ` (6개월 전 ${cpi6mAgo.toFixed(1)}%${rising ? ' — 상승 추세' : ''})` : ''
        }${cpi.v >= 3 && rising ? ' — 1968년의 "인플레 이륙 초입"과 유사한 재가속 패턴' : ''}.`
      : '데이터 없음',
  })

  // ── 4. 실질금리 (원인 구분 포함) ──
  const rr = latest(m.realRate10)
  let rrLevel: SignalLevel = 'ok'
  let rrCause = ''
  if (rr && cpi) {
    if (rr.v < 0 && cpi.v >= 3.5) { rrLevel = 'alert'; rrCause = '인플레발 마이너스 — 1946·1973년형 (주식·채권에 역사적 악재)' }
    else if (rr.v < 0) { rrLevel = 'watch'; rrCause = '완화발 마이너스 — 2009~2021년형 (자산가격엔 순풍이나 과열 배양)' }
    else if (rr.v < 1) { rrLevel = 'watch'; rrCause = '양수지만 압축 중 — 인플레이션이 금리보다 빨리 오르는 국면' }
    else rrCause = '충분한 양수 — 인플레이션형 체제와 거리'
  }
  signals.push({
    key: 'realRate',
    label: '실질 10년 금리 (명목 − 인플레)',
    value: rr ? `${rr.v >= 0 ? '+' : ''}${rr.v.toFixed(2)}%p` : '—',
    level: rrLevel,
    reason: rr
      ? `${rrCause}. 역사 기준: A형 구간에선 실질금리가 마이너스로 매몰(1946년 −15%, 1974년 −5%대), 볼커 긴축 후 +4% 이상으로 회복되며 인플레형 종료.`
      : '데이터 없음',
  })

  // ── 5. 장단기 금리차 (10y − 3m) ──
  const gs = latest(m.gs10)
  const tb = m.tbill3m ? latest(m.tbill3m) : null
  const spread = gs && tb ? gs.v - tb.v : null
  let curveLevel: SignalLevel = 'ok'
  if (spread != null && spread < 0) curveLevel = 'alert'
  else if (spread != null && spread < 0.3) curveLevel = 'watch'
  signals.push({
    key: 'curve',
    label: '장단기 금리차 (10년 − 3개월)',
    value: spread != null ? `${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%p` : '—',
    level: curveLevel,
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

  // 역사 아날로그: 조건 조합 매칭
  const capeHigh = lv('valuation') === 'alert'
  const infRising = cpi != null && cpi.v >= 3 && rising
  const infHigh = infLevel === 'alert'
  if (capeHigh && infHigh) analog = '1973년형 (고밸류에이션 + 본격 인플레이션) 조합에 근접'
  else if (capeHigh && infRising) analog = '1968년형 — 고밸류에이션에서 인플레이션이 이륙하던 초입과 유사한 조합 (단, 밸류에이션은 당시 24 vs 지금이 더 높음)'
  else if (capeHigh) analog = '2000년형 — 인플레 없는 극단 밸류에이션'
  else if (infHigh) analog = '1946/1973년형 — 인플레이션 주도'

  const rationale =
    `기준월 ${dates[n]} 데이터로 계산한 체크리스트입니다. ` +
    `${signals.filter((s) => s.level === 'alert').map((s) => s.label).join(', ') || '없음'} = 경계, ` +
    `${signals.filter((s) => s.level === 'watch').map((s) => s.label).join(', ') || '없음'} = 주의. ` +
    `역사가 보여주는 것: 선행조건 충족은 "하락이 곧 온다"가 아니라 "만약 하락이 오면 깊고 길 수 있는 출발점"이라는 뜻입니다 — ` +
    `CAPE가 1968년 수준(24)을 넘은 1996년 이후에도 시장은 4년을 더 올랐고, 고평가 해소가 상승 없이 이익 성장만으로 이뤄진 사례도 있습니다. ` +
    `반대로 1929·2000년의 공통점은 "극단 밸류에이션에서 출발한 하락은 얕게 끝나지 않았다"는 것입니다.`

  return { asOf: dates[n], signals, headline, rationale, analog }

  function latest(arr: (number | null)[]): { v: number; i: number } | null {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return { v: arr[i] as number, i }
    return null
  }
}
