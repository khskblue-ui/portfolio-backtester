import { CURVE_VB_W, CURVE_VB_H, useCurvePolylines, type CurveSeries } from './curveData'

/**
 * 탭 상단 배경(가이드북·역사·신호) — 홈 히어로와 같은 126년 곡선을 옅게 깔아 탭이
 * 바뀌어도 한 몸으로 읽히게 한다. 앱 루트(relative isolate) 안에서 헤더 뒤부터 아래로
 * 460px, 페이지 바탕으로 잦아드는 페이드. 장식이므로 포인터·보조기기에서 제외.
 */
export function CurveBackdrop({ series }: { series: CurveSeries | null }) {
  const curves = useCurvePolylines(series)
  if (!curves) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] -z-10 overflow-hidden" aria-hidden="true">
      <svg
        viewBox={`0 0 ${CURVE_VB_W} ${CURVE_VB_H}`}
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-0 h-full w-full opacity-[0.16] dark:opacity-[0.22]"
      >
        <polyline points={curves.bond} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-[#1baf7a]" />
        <polyline points={curves.gold} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-[#eda100] dark:stroke-[#f2b632]" />
        <polyline points={curves.stock} fill="none" strokeWidth={2.4} strokeLinejoin="round" className="stroke-[#2962ff] dark:stroke-[#5b8aff]" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-b from-transparent to-[#eef1f5] dark:to-[#131722]" />
    </div>
  )
}
