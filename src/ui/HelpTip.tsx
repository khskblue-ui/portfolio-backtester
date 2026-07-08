import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopPos {
  top: number
  left: number
  width: number
  maxHeight: number
}

/**
 * 개념 설명 팝업 — 라벨 옆의 작은 '?' 버튼을 클릭하면 열림.
 *
 * 팝업은 document.body 포털에 fixed로 렌더링:
 * overflow 컨테이너(가로 스크롤 테이블 등)에 잘리지 않고,
 * 뷰포트 경계에 맞춰 좌우 클램핑 + 세로는 maxHeight 스크롤.
 * 바깥 클릭/터치·ESC·스크롤 시 닫힘.
 */
export function HelpTip({
  title,
  children,
  align = 'left',
}: {
  title: string
  children: ReactNode
  /** 선호 정렬 — 공간이 없으면 뷰포트에 맞게 자동 보정됨 */
  align?: 'left' | 'right'
}) {
  const [pos, setPos] = useState<PopPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)

  const openAt = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(320, vw - 24)
    let left = align === 'right' ? r.right - width : r.left - 4
    left = Math.max(12, Math.min(left, vw - width - 12))
    const top = r.bottom + 6
    const maxHeight = Math.max(120, vh - top - 12)
    setPos({ top, left, width, maxHeight })
  }
  const close = () => setPos(null)

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // fixed 좌표는 스크롤 시 어긋나므로 닫음 (표준 팝오버 동작)
    const onScroll = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pos])

  return (
    <span className="relative inline-flex align-top ml-1">
      <button
        ref={btnRef}
        type="button"
        aria-label={`${title} 설명`}
        aria-expanded={pos != null}
        onClick={() => (pos ? close() : openAt())}
        className={`w-3.5 h-3.5 rounded-full border text-[9px] font-bold leading-none flex items-center justify-center transition-colors
          ${pos
            ? 'border-emerald-700 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400'
            : 'border-zinc-400 dark:border-zinc-600 text-zinc-400 dark:text-zinc-500 hover:border-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400'}`}
      >
        ?
      </button>
      {pos != null &&
        createPortal(
          <span
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
            className="z-[60] block overflow-y-auto bg-[#ffffff] dark:bg-[#1e222d] border border-[#d3d8e3] dark:border-[#363a45] rounded shadow-lg p-3
              text-xs font-normal text-zinc-600 dark:text-zinc-300 whitespace-normal text-left leading-relaxed"
          >
            <span className="block font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</span>
            {children}
          </span>,
          document.body
        )}
    </span>
  )
}
