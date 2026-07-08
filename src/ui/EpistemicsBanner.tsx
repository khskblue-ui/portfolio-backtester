import { AlertTriangle } from 'lucide-react'

/**
 * §11 UI 에피스테믹스 — 문서가 아니라 결과 화면에 상시 노출.
 * 백테스트는 예측이 아니라 "이 규칙이 과거 한 경로에서 어떻게 움직였나"임을 내장.
 */
export function EpistemicsBanner() {
  return (
    <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg p-4 text-xs text-amber-900 dark:text-amber-200/90 space-y-1">
      <div className="flex items-center gap-1.5 font-semibold text-sm">
        <AlertTriangle className="w-4 h-4" /> 백테스트는 예측이 아닙니다
      </div>
      <p>· <b>단일 경로</b>: 과거 한 번의 경로일 뿐입니다. BTC 10년 = 크립토 사이클 한 번.</p>
      <p>· <b>USD ≠ 원화 실현손익</b>: v1은 환율 미반영. 실제 양도세는 원화 환산 손익 기준입니다.</p>
      <p>· <b>세금은 근사</b>: 가정 환율·단일 한계세율 단순화. 가상자산 과세는 유예 중 — 현행법을 확인하세요.</p>
      <p>· <b>과적합 주의</b>: 파라미터를 결과가 좋아질 때까지 튜닝하면 그 결과는 의미를 잃습니다.</p>
    </div>
  )
}
