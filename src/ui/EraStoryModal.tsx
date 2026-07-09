import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, TrendingUp, Landmark, Coins, Banknote, HelpCircle, Lightbulb, Scale } from 'lucide-react'
import type { EraStory, AssetStory } from './eraStories'
import { STORY_EPISTEMICS } from './eraStories'

/**
 * 구간 스토리 팝업 — "왜 각 자산이 그렇게 움직였나"를 통념 vs 실제 구조로 풀어낸
 * 초보자용 서사. 내용은 eraStories.ts (컨센서스 해석만 채택, 논쟁은 명시).
 */
export function EraStoryModal({
  title,
  period,
  story,
  onClose,
}: {
  title: string
  period: string
  story: EraStory
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const assetSection = (label: string, Icon: typeof TrendingUp, colorCls: string, a: AssetStory) => (
    <div className="space-y-1.5">
      <h4 className={`flex items-center gap-1.5 text-sm font-bold ${colorCls}`}>
        <Icon className="w-4 h-4" /> {label}
      </h4>
      {a.myth && (
        <p className="flex gap-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 bg-[#f3f5f9] dark:bg-[#171c28] rounded-lg px-3 py-2">
          <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            <b className="text-zinc-600 dark:text-zinc-300">통념:</b> {a.myth}
          </span>
        </p>
      )}
      <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">{a.story}</p>
    </div>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45 dark:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-2xl max-h-full overflow-y-auto bg-white dark:bg-[#1e222d] border border-[#e0e3eb] dark:border-[#363a45] rounded-xl shadow-2xl">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[#1e222d] border-b border-[#e0e3eb] dark:border-[#2a2e39] px-5 py-3.5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">WHY IT MOVED · 자산별 스토리</p>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              {title} <span className="text-xs font-mono font-normal text-zinc-400 ml-1">{period}</span>
            </h3>
          </div>
          <button onClick={onClose} aria-label="닫기" autoFocus className="p-1.5 rounded-md text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* 배경 */}
          <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">{story.intro}</p>

          {/* 자산별 */}
          <div className="space-y-4 border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-4">
            {assetSection('주식 (S&P500 총수익)', TrendingUp, 'text-[#2962ff] dark:text-[#5b8aff]', story.stock)}
            {assetSection('장기국채 (미 10년물 근사)', Landmark, 'text-emerald-700 dark:text-emerald-400', story.bond)}
            {assetSection('금 (현물)', Coins, 'text-amber-600 dark:text-amber-400', story.gold)}
            {story.cash && assetSection('현금 (3개월 단기국채)', Banknote, 'text-slate-500 dark:text-slate-400', story.cash)}
          </div>

          {/* 교훈 */}
          <div className="flex gap-2 bg-[#eef4ff] dark:bg-[#16223c] border-l-4 border-[#2962ff] rounded-lg px-3.5 py-3">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#2962ff] dark:text-[#5b8aff]" />
            <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-100">
              <b>이 구간의 교훈</b> — {story.lesson}
            </p>
          </div>

          {/* 논쟁 (있을 때만) */}
          {story.debate && (
            <div className="flex gap-2 bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-600 dark:border-amber-500 rounded-lg px-3.5 py-3">
              <Scale className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200/90">
                <b>논쟁 지점</b> — {story.debate}
              </p>
            </div>
          )}

          {/* 신뢰성 각주 */}
          <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500 border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-3">
            {STORY_EPISTEMICS}
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
