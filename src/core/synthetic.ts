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
 *
 * spliceSeries는 실물 상장 뒤에는 실물을 쓰고 그 전만 합성으로 잇는다(-EXT, 트라이팟 슬리브의 구성 상품).
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
    // 시가: 기초의 오버나이트 갭 × L 근사 (t+1 시가 체결용).
    // 종가 체인은 배당 포함(adjClose)인데 원시 시가는 배당락만큼 떨어지므로,
    // 당일 조정계수(adjClose/close)로 시가를 보정해 배당락일의 유령 갭(×L)을 제거
    const openAdj = base.open[i] * (base.adjClose[i] / base.close[i])
    const openFactor = Math.max(1e-6, 1 + spec.leverage * (openAdj / base.adjClose[i - 1] - 1))
    open.push(prev * openFactor)
    prev = prev * factor
    dates.push(d)
    close.push(prev)
  }

  // 배당은 adjClose 경유로 가격에 내재 — 별도 배당 현금흐름 없음 (배당세 미계산 주의)
  return { ticker, dates, open, close, adjClose: [...close], dividends: {} }
}

/**
 * 실물 + 상장 전 합성 연결 (-EXT) — 실물 상장일 d0 이전은 합성 시계열을 실물 첫 종가에 맞게
 * 스케일해 붙이고, d0부터는 실물 가격·배당을 그대로 쓴다.
 *
 * 스케일 k = 실물 d0 종가 ÷ 합성 d0 종가라서 d0 당일 수익률은 합성의 수익률이고, 이후는 실물 수익률이다.
 * 보유 주식 수가 연결 시점에 끊기지 않으므로 엔진은 한 자산으로 계속 보유한다(가상의 교체 매매 없음).
 * 합성이 d0를 포함하지 않으면 d0 직전 합성 값에 맞춘다(그 하루는 수익률 0으로 근사).
 */
export function spliceSeries(ticker: string, real: DailySeries, synthetic: DailySeries): DailySeries {
  if (real.dates.length === 0) throw new Error(`${ticker}: 실물 데이터가 없습니다`)
  const d0 = real.dates[0]
  const pre = synthetic.dates.filter((d) => d < d0).length
  const exact = synthetic.dates[pre] === d0
  // 합성이 실물보다 늦게 시작하면 이어 붙일 구간이 없다
  if (pre === 0) return { ...real, ticker }
  const anchor = exact ? pre : pre - 1
  const k = real.close[0] / synthetic.close[anchor]
  // 실물 adjClose는 이후 배당만큼 낮게 조정돼 있으므로 같은 비율로 합성 구간 adjClose를 맞춘다
  const adjK = k * (real.adjClose[0] / real.close[0])
  // 연결일 시가: 실물 첫 시가를 그대로 쓰면 합성 전일 종가와의 간격이 합성·실물 차이를 담아 튄다.
  // 합성 시가를 같은 비율로 옮겨 연결일의 밤사이·장중 수익률을 합성과 같게 한다
  const realOpen = exact ? [synthetic.open[anchor] * k, ...real.open.slice(1)] : real.open
  return {
    ticker,
    dates: [...synthetic.dates.slice(0, pre), ...real.dates],
    open: [...synthetic.open.slice(0, pre).map((x) => x * k), ...realOpen],
    close: [...synthetic.close.slice(0, pre).map((x) => x * k), ...real.close],
    adjClose: [...synthetic.close.slice(0, pre).map((x) => x * adjK), ...real.adjClose],
    dividends: { ...real.dividends },
  }
}

/**
 * 지수 총수익 재구성 — 지수 가격수익 + proxy ETF 분배금 수익률(배당락일, 전일 proxy 종가 대비) + proxy 상장 뒤 보수 되돌림.
 * 트라이팟 연구 buildProducts의 총수익(gross) 정의와 같다. proxy 상장 전은 배당을 넣지 않는다(가격지수 그대로).
 * 결과의 close·open은 지수 그대로, adjClose가 총수익 지수다(buildLeveragedSeries가 adjClose 비율로 기초 수익을 읽음).
 * 분배금 날짜가 지수 달력에 없으면 그 뒤 첫 지수 거래일에 붙인다(유실 방지)
 */
export function buildIndexTotalReturn(ticker: string, index: DailySeries, proxy: DailySeries, proxyFeePct: number): DailySeries {
  if (index.dates.length < 2) throw new Error(`${ticker}: 지수 데이터가 부족합니다`)
  const divYield = new Map<string, number>()
  for (const [d, amt] of Object.entries(proxy.dividends)) {
    // proxy 달력에서 배당락일(이후 첫 거래일)과 그 전일 종가
    const j = proxy.dates.findIndex((x) => x >= d)
    if (j <= 0) continue
    const y = amt / proxy.close[j - 1]
    // 지수 달력의 그날(없으면 다음 거래일)로
    const k = index.dates.findIndex((x) => x >= proxy.dates[j])
    if (k < 0) continue
    divYield.set(index.dates[k], (divYield.get(index.dates[k]) ?? 0) + y)
  }
  const listStart = proxy.dates[0]
  const adj = [index.close[0]]
  for (let i = 1; i < index.dates.length; i++) {
    const dt = (Date.parse(index.dates[i]) - Date.parse(index.dates[i - 1])) / 86_400_000
    const feeBack = index.dates[i] >= listStart ? (proxyFeePct / 100) * (dt / 365) : 0
    const r = index.close[i] / index.close[i - 1] - 1 + (divYield.get(index.dates[i]) ?? 0) + feeBack
    adj.push(adj[i - 1] * (1 + r))
  }
  return { ticker, dates: [...index.dates], open: [...index.open], close: [...index.close], adjClose: adj, dividends: {} }
}
