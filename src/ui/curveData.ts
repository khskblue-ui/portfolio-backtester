import { useMemo } from 'react'

/**
 * 126년 실질 총수익 곡선(주식·10년 국채·금, 로그 눈금)의 폴리라인 계산 — 유기체 홈의
 * 공용 모티프. 홈 히어로(HomeHero)와 탭 상단 배경(CurveBackdrop)이 함께 쓴다.
 * 컴포넌트가 아닌 것만 이 파일에 둔다(react-refresh 규칙).
 */

export interface CurveSeries {
  dates: string[]
  stock: number[]
  bond?: (number | null)[]
  gold?: (number | null)[]
}

export const CURVE_VB_W = 1600
export const CURVE_VB_H = 400
const SAMPLE_STEP = 3 // 3개월 간격 샘플 — 1,519개월을 500점 안팎으로

/** 로그 눈금 폴리라인 — 각 시리즈를 자기 범위로 정규화해 세 곡선이 같은 높이대를 쓰게 한다 */
function toPolyline(arr: (number | null)[] | undefined, n: number): string {
  if (!arr) return ''
  const pts: [number, number][] = []
  for (let i = 0; i < n; i += SAMPLE_STEP) {
    const v = arr[i]
    if (v != null && v > 0) pts.push([i, Math.log10(v)])
  }
  if (pts.length < 2) return ''
  let lo = Infinity
  let hi = -Infinity
  for (const [, y] of pts) {
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  const span = hi - lo || 1
  return pts
    .map(
      ([i, y]) =>
        `${((i / (n - 1)) * CURVE_VB_W).toFixed(1)},${(CURVE_VB_H - 20 - ((y - lo) / span) * (CURVE_VB_H - 40)).toFixed(1)}`,
    )
    .join(' ')
}

export function useCurvePolylines(series: CurveSeries | null) {
  return useMemo(() => {
    if (!series) return null
    const n = series.dates.length
    return {
      stock: toPolyline(series.stock, n),
      bond: toPolyline(series.bond, n),
      gold: toPolyline(series.gold, n),
      years: Math.floor((n - 1) / 12),
    }
  }, [series])
}
