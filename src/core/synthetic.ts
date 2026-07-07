/**
 * 합성 레버리지 ETF 시뮬레이션 — 상장 전 시대로 소급 (예: TQQQ를 닷컴버블에)
 *
 * 레버리지 ETF는 "기초지수 일간수익 × L, 매일 리셋" 구조라 수학적으로 재구성 가능:
 *
 *   합성 일간수익 = L × 기초 총수익(일간) − (L−1) × (단기금리 + 스프레드) × Δt/365
 *                   − 운용보수 × Δt/365
 *
 * - 기초 총수익: 기초 ETF(QQQ/SPY)의 adjusted close 비율 — 배당 내재
 * - 차입비용: ^IRX(13주 T-bill, 1960~) 실제 시계열 + 스왑 스프레드 근사.
 *   상수 금리를 쓰면 고금리 시대(닷컴버블 ~6%)의 레버리지 비용이 왜곡되므로 필수
 * - 검증: 같은 공식을 실제 상장 이후 구간에 적용하면 실물 ETF와 거의 겹침 —
 *   TQQQ-SIM vs TQQQ를 2010~ 구간에서 함께 돌려 직접 확인 가능
 *
 * ⚠ 한계(카탈로그 노트로 상시 노출): 스왑 스프레드 변동·추적오차·유동성 미반영
 * (실제보다 소폭 낙관적), 배당이 가격에 내재돼 배당세 미계산, 하루 −(100/L)% 초과
 * 하락 시 실제로는 상장폐지지만 시뮬레이션은 잔존가치로 계속됨.
 */

import type { DailySeries } from './types'

export interface SyntheticSpec {
  /** 기초 ETF 티커 (adjClose로 총수익 계산) */
  base: string
  /** 레버리지 배수 (2, 3 …) */
  leverage: number
  /** 연 운용보수 (%) */
  expensePct: number
  /** 단기금리 위 차입(스왑) 스프레드 (%) */
  borrowSpreadPct: number
}

/** 차입금리 소스 티커 — 13주 T-bill 수익률 지수 (Yahoo, % 단위, 1960~) */
export const RATE_TICKER = '^IRX'

/**
 * 기초 시계열 + 금리 시계열 → 합성 레버리지 시계열 (시작가 100 정규화)
 */
export function buildLeveragedSeries(
  ticker: string,
  base: DailySeries,
  rate: DailySeries,
  spec: SyntheticSpec
): DailySeries {
  if (base.dates.length < 2) throw new Error(`${ticker} — 기초(${spec.base}) 데이터 부족`)

  // 금리 날짜 → 값(%) 맵. 기초 캘린더에 없는 날은 직전 값 forward-fill
  const rateMap = new Map<string, number>()
  for (let i = 0; i < rate.dates.length; i++) rateMap.set(rate.dates[i], rate.close[i])
  let lastRate = rate.close[0]
  const rateFor = (d: string): number => {
    const v = rateMap.get(d)
    if (v != null) lastRate = v
    return lastRate
  }

  const dates: string[] = [base.dates[0]]
  const open: number[] = [100]
  const close: number[] = [100]
  let prev = 100

  for (let i = 1; i < base.dates.length; i++) {
    const d = base.dates[i]
    const rBase = base.adjClose[i] / base.adjClose[i - 1] - 1
    const dtDays = (Date.parse(d) - Date.parse(base.dates[i - 1])) / 86_400_000
    const financing = (spec.leverage - 1) * ((rateFor(d) + spec.borrowSpreadPct) / 100) * (dtDays / 365)
    const expense = (spec.expensePct / 100) * (dtDays / 365)
    // 일간 리셋 — 하루 −(100/L)% 초과 하락은 전멸이지만 잔존가치 하한으로 클램프
    const factor = Math.max(1e-6, 1 + spec.leverage * rBase - financing - expense)
    // 시가: 기초의 오버나이트 갭 × L 근사 (t+1 시가 체결용)
    const openFactor = Math.max(1e-6, 1 + spec.leverage * (base.open[i] / base.close[i - 1] - 1))
    open.push(prev * openFactor)
    prev = prev * factor
    dates.push(d)
    close.push(prev)
  }

  // 배당은 adjClose 경유로 가격에 내재 — 별도 배당 현금흐름 없음 (배당세 미계산 주의)
  return { ticker, dates, open, close, adjClose: [...close], dividends: {} }
}
