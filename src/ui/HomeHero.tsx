import { useMemo } from 'react'
import { GraduationCap, Activity, ChevronDown } from 'lucide-react'

/**
 * 홈 히어로 — "유기체 홈"(테마 연동). App 셸이 컨테이너 바깥에서 렌더해 화면 끝까지
 * 닿고, 투명해진 헤더·좌측 레일 뒤까지 이어진다(-mt-14). 사진 대신 이 앱의 126년
 * 실질 총수익 곡선(주식·10년 국채·금, 로그 눈금)을 배경 아트로 쓴다.
 * 라이트 = 흰→회 한 장의 바탕(O1), 다크 = 검정→남색 바탕 + 곡선 글로우(O2).
 * 페이지 바탕(#eef1f5 / #131722)으로 끝나 아래 콕핏과 경계 없이 이어진다.
 */

export interface HeroSeries {
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
    return {
      stock: toPolyline(series.stock, n),
      bond: toPolyline(series.bond, n),
      gold: toPolyline(series.gold, n),
      years: Math.floor((n - 1) / 12),
      mult: Math.round(series.stock[n - 1] / series.stock[0]),
    }
  }, [series])

  const years = curves?.years ?? 126

  // 다크에서는 흰 알약형(O2), 라이트에서는 기존 프라이머리/고스트(O1)
  const primaryCls =
    'h-11 px-[18px] rounded-lg dark:rounded-full text-[14px] font-semibold inline-flex items-center justify-center gap-2 btn-primary dark:!bg-white dark:!text-[#0c101b]'
  const ghostCls =
    'h-11 px-[18px] rounded-lg dark:rounded-full text-[14px] font-medium inline-flex items-center justify-center gap-2 bg-white border border-[#d3d8e3] text-zinc-700 hover:bg-[#edf1f7] dark:bg-transparent dark:border-white/25 dark:text-zinc-200 dark:hover:bg-white/10'
  const ctas = (
    <>
      <button onClick={() => onNavigate('guide')} className={primaryCls}>
        <GraduationCap className="w-4 h-4" /> {guideStarted ? '가이드북 이어 읽기' : '가이드북 시작'}
      </button>
      <button onClick={() => onNavigate('now')} className={ghostCls}>
        <Activity className="w-4 h-4" /> 현재 신호 보기
      </button>
    </>
  )

  return (
    <>
      {/* -mt-14: 헤더(56px) 뒤까지 올라가 투명 헤더가 곡선 위에 떠 있게 한다 */}
      <section
        id="home-hero"
        className="relative overflow-hidden -mt-14 bg-gradient-to-b from-white to-[#eef1f5] dark:from-[#0c101b] dark:via-[#10141f] dark:to-[#131722]"
        aria-label="투자의 정석 소개"
      >
        {/* 다크 전용 글로우 한 점 (O2) */}
        <div
          className="hidden dark:block pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(55% 40% at 80% 12%, rgba(41,98,255,0.26) 0%, rgba(41,98,255,0) 70%)' }}
          aria-hidden="true"
        />

        {/* 배경 아트: 126년 실질 총수익 곡선 3종 (로그 눈금). 장식이므로 보조기기에는 숨김 */}
        {curves && (
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] sm:h-[60%] lg:h-[66%] w-full opacity-50 dark:opacity-90"
            aria-hidden="true"
          >
            <defs>
              <filter id="home-hero-glow" x="-5%" y="-20%" width="110%" height="140%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>
            {/* 다크 전용 빛줄기(글로우) — 같은 곡선을 굵고 흐리게 한 번 더 */}
            <g className="hidden dark:block" filter="url(#home-hero-glow)">
              <polyline points={curves.stock} fill="none" strokeWidth={10} strokeOpacity={0.35} className="stroke-[#5b8aff]" />
              <polyline points={curves.gold} fill="none" strokeWidth={8} strokeOpacity={0.25} className="stroke-[#f2b632]" />
            </g>
            <polyline points={curves.bond} fill="none" strokeWidth={2.2} strokeLinejoin="round" className="stroke-[#1baf7a]" />
            <polyline points={curves.gold} fill="none" strokeWidth={2.2} strokeLinejoin="round" className="stroke-[#eda100] dark:stroke-[#f2b632]" />
            <polyline points={curves.stock} fill="none" strokeWidth={2.8} strokeLinejoin="round" className="stroke-[#2962ff] dark:stroke-[#5b8aff]" />
          </svg>
        )}

        {/* 다크: 곡선이 아래 콕핏 바탕으로 잦아들며 이어지게 */}
        <div className="hidden dark:block pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#131722]" aria-hidden="true" />

        {/* 본문 — 앱 콘텐츠 컬럼(레일 64px + max-w-7xl)과 같은 축에 정렬 */}
        <div className="lg:pl-16">
          <div className="relative max-w-7xl mx-auto px-3 sm:px-4 md:px-6 pt-[104px] sm:pt-[128px] lg:pt-[150px] pb-40 sm:pb-52 lg:pb-64 flex flex-col gap-4 sm:gap-5">
            <h2 className="text-[40px] sm:text-[60px] lg:text-[80px] font-bold leading-[1.08] tracking-[-0.028em] text-zinc-900 dark:text-white max-w-[900px]">
              {years}년의 시장을
              <br />
              먼저 읽습니다.
            </h2>
            <p className="text-[15px] sm:text-[17px] lg:text-[19px] leading-relaxed text-zinc-600 dark:text-[#b4b8c2] max-w-[620px]">
              역사 데이터로 배우고, 정해 둔 규칙으로 투자
            </p>
            <div className="hidden sm:flex flex-row gap-2.5 items-center pt-1">{ctas}</div>
          </div>
        </div>

        {curves && (
          <div className="absolute right-4 sm:right-8 lg:right-24 bottom-5 hidden sm:flex gap-4 text-[12px] text-zinc-600 dark:text-[#b4b8c2]">
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
        <div className="hidden sm:flex absolute inset-x-0 bottom-2 justify-center pointer-events-none" aria-hidden="true">
          <ChevronDown className="w-5 h-5 text-zinc-400 dark:text-[#6f7480]" />
        </div>
      </section>

      {/* 모바일(<sm): 버튼은 곡선 아래 바닥에 별도 행으로 — 곡선을 가리지 않는다 */}
      <div className="sm:hidden px-3 pt-3">
        <div className="grid grid-cols-2 gap-2">{ctas}</div>
      </div>
    </>
  )
}
