import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Flame, Lightbulb, Activity, CircleDot } from 'lucide-react'
import { MANIA_STORY } from './maniaStory'

/**
 * 특집 "광기의 해부" 팝업 — 콘텐츠·신뢰성 원칙은 maniaStory.ts.
 * 역사 연구(본진: 두 사례 모두 2000-08 구간 안)와 현재 신호(비교 문맥) 양쪽에서 연다.
 */

/** **굵게** 미니 렌더러 (guideContent와 동일 규칙) */
function rich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-semibold text-zinc-900 dark:text-zinc-50">
        {part}
      </b>
    ) : (
      part
    ),
  )
}

export function ManiaStoryModal({ onClose }: { onClose: () => void }) {
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

  const s = MANIA_STORY

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45 dark:bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-3xl max-h-full overflow-y-auto bg-white dark:bg-[#1e222d] border border-[#e0e3eb] dark:border-[#363a45] rounded-xl shadow-2xl">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[#1e222d] border-b border-[#e0e3eb] dark:border-[#2a2e39] px-5 py-3.5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
              FEATURE · MANIA & TRIGGERS · 데이터 기준 {s.dataAsOf}
            </p>
            <h3 className="flex items-center gap-1.5 text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              <Flame className="w-4 h-4 text-[#e34948]" /> {s.title}
            </h3>
            <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5">{s.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 rounded-md text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* 서론 — 거품의 공통 문법 */}
          <div className="space-y-2">
            {s.grammar.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {rich(p)}
              </p>
            ))}
          </div>

          {/* 1·2부 — 역사 사례 */}
          {s.parts.map((part) => (
            <div key={part.id} className="border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-4 space-y-3">
              <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                <span className="block text-[9px] font-mono tracking-[0.22em] text-[#e34948]">{part.kicker}</span>
                {part.title}
              </h4>
              {part.mania.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                  {rich(p)}
                </p>
              ))}

              {/* 트리거 타임라인 */}
              <div className="rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] p-3.5">
                <div className="text-[10px] font-mono tracking-[0.18em] text-zinc-400 dark:text-zinc-500 mb-2">TRIGGER TIMELINE — 방아쇠의 연쇄</div>
                <ol className="space-y-2">
                  {part.timeline.map((t) => (
                    <li key={t.date} className="flex gap-2.5">
                      <CircleDot className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${t.key ? 'text-[#e34948]' : 'text-zinc-300 dark:text-zinc-600'}`} />
                      <div className="text-[12.5px] leading-relaxed">
                        <span className={`font-mono font-semibold ${t.key ? 'text-[#e34948]' : 'text-zinc-500 dark:text-zinc-400'}`}>{t.date}</span>
                        <span className="text-zinc-600 dark:text-zinc-300"> — {t.event}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                <b className="text-zinc-900 dark:text-zinc-50">결말</b> — {rich(part.outcome)}
              </p>
              <div className="flex gap-2 bg-[#eef4ff] dark:bg-[#16223c] border-l-4 border-[#2962ff] rounded-lg px-3.5 py-3">
                <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#2962ff] dark:text-[#5b8aff]" />
                <p className="text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">{rich(part.lesson)}</p>
              </div>
            </div>
          ))}

          {/* 3부 — 지금 (2026 AI) */}
          <div className="border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-4 space-y-3">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              <span className="flex items-center gap-1 text-[9px] font-mono tracking-[0.22em] text-[#2962ff]">
                <Activity className="w-3 h-3" /> {s.now.kicker}
              </span>
              {s.now.title}
            </h4>
            {s.now.paras.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {rich(p)}
              </p>
            ))}
            <div className="flex gap-2 bg-[#eef4ff] dark:bg-[#16223c] border-l-4 border-[#2962ff] rounded-lg px-3.5 py-3">
              <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#2962ff] dark:text-[#5b8aff]" />
              <p className="text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">{rich(s.now.closing)}</p>
            </div>
          </div>

          {/* 신뢰성 각주 */}
          <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500 border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-3">
            {s.epistemics}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
