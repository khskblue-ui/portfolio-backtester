import { useMemo } from 'react'
import { GraduationCap, Activity } from 'lucide-react'
import { btnPrimaryCls, btnGhostCls } from './common'

/**
 * 홈 히어로 — "데이터 에디토리얼" 안. 사진 대신 이 앱의 126년 실질 총수익 곡선
 * (주식·10년 국채·금, 로그 눈금)을 배경 아트로 깐다. 라이선스 자산이 없고 몇 KB로
 * 끝나며, 라이트/다크는 토큰으로 처리된다. 슬로건·문구는 1부·신호 탭의 원칙
 * ("예측이 아니라 위치 확인")에서 가져왔다.
 */

interface HeroSeries {
  dates: string[]
  stock: number[]
  bond?: (number | null)[]
  gold?: (number | null)[]
}

const VB_W = 1600
const VB_H = 400
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
    .map(([i, y]) => `${((i / (n - 1)) * VB_W).toFixed(1)},${(VB_H - 20 - ((y - lo) / span) * (VB_H - 40)).toFixed(1)}`)
    .join(' ')
}

export function HomeHero({
  series,
  guideStarted,
  onNavigate,
}: {
  series: HeroSeries | null
  guideStarted: boolean
  onNavigate: (view: 'guide' | 'now') => void
}) {
  const curves = useMemo(() => {
    if (!series) return null
    const n = series.dates.length
    const first = series.dates[0]?.slice(0, 4) ?? '1900'
    const last = series.dates[n - 1]?.slice(0, 4) ?? ''
    const years = Math.floor((n - 1) / 12)
    const mult = Math.round(series.stock[n - 1] / series.stock[0])
    return {
      stock: toPolyline(series.stock, n),
      bond: toPolyline(series.bond, n),
      gold: toPolyline(series.gold, n),
      first,
      last,
      years,
      mult,
    }
  }, [series])

  const years = curves?.years ?? 126

  return (
    <section
      className="relative overflow-hidden rounded-xl border border-[#e0e3eb] dark:border-[#2a2e39] bg-gradient-to-b from-white to-[#eef1f5] dark:from-[#1e222d] dark:to-[#131722] shadow-[0_1px_3px_rgba(19,23,34,0.04)] dark:shadow-none"
      aria-label="투자의 정석 소개"
    >
      {/* 배경 아트: 126년 실질 총수익 곡선 3종 (로그 눈금). 장식이므로 보조기기에는 숨김 */}
      {curves && (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] sm:h-[62%] lg:h-[70%] w-full opacity-50 dark:opacity-60"
          aria-hidden="true"
        >
          <polyline points={curves.bond} fill="none" strokeWidth={2.2} strokeLinejoin="round" className="stroke-[#1baf7a]" />
          <polyline points={curves.gold} fill="none" strokeWidth={2.2} strokeLinejoin="round" className="stroke-[#eda100] dark:stroke-[#f2b632]" />
          <polyline points={curves.stock} fill="none" strokeWidth={2.8} strokeLinejoin="round" className="stroke-[#2962ff] dark:stroke-[#5b8aff]" />
        </svg>
      )}

      <div className="relative px-5 pt-9 pb-44 sm:px-10 sm:pt-14 sm:pb-56 lg:px-14 lg:pt-16 lg:pb-64 flex flex-col gap-4 sm:gap-5">
        <div className="text-[10px] sm:text-[11px] font-mono tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          {curves ? `${curves.first} — ${curves.last}` : '1900 —'} · {years}년의 실질 총수익
          <span className="hidden sm:inline">, 배당 재투자·물가 조정</span>
        </div>
        <h2 className="text-[40px] sm:text-[60px] lg:text-[76px] font-bold leading-[1.1] tracking-[-0.025em] text-zinc-900 dark:text-zinc-50 max-w-[900px]">
          {years}년의 시장을
          <br />
          먼저 읽습니다.
        </h2>
        <p className="text-[15px] sm:text-[17px] lg:text-[19px] leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-[620px]">
          예측이 아니라 위치 확인입니다. 역사 데이터로 배우고, 정해 둔 규칙으로 투자합니다.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 sm:items-center pt-1">
          <button
            onClick={() => onNavigate('guide')}
            className={`h-11 px-[18px] rounded-lg text-[14px] font-semibold inline-flex items-center justify-center gap-2 ${btnPrimaryCls}`}
          >
            <GraduationCap className="w-4 h-4" /> {guideStarted ? '가이드북 이어 읽기' : '가이드북 시작'}
          </button>
          <button
            onClick={() => onNavigate('now')}
            className={`h-11 px-[18px] rounded-lg text-[14px] font-medium inline-flex items-center justify-center gap-2 ${btnGhostCls}`}
          >
            <Activity className="w-4 h-4" /> 현재 신호 보기
          </button>
        </div>
      </div>

      {curves && (
        <div className="absolute right-5 sm:right-8 lg:right-14 bottom-4 hidden sm:flex gap-4 text-[12px] text-zinc-600 dark:text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-[3px] rounded-sm bg-[#2962ff] dark:bg-[#5b8aff]" />
            주식 {curves.mult.toLocaleString('ko-KR')}배
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-[3px] rounded-sm bg-[#1baf7a]" />
            10년 국채
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 h-[3px] rounded-sm bg-[#eda100] dark:bg-[#f2b632]" />금
          </span>
        </div>
      )}
    </section>
  )
}
