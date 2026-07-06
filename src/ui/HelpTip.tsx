import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 개념 설명 팝업 — 라벨 옆의 작은 '?' 버튼을 클릭하면 열림.
 * 바깥 클릭·ESC로 닫힘.
 */
export function HelpTip({
  title,
  children,
  align = 'left',
}: {
  title: string
  children: ReactNode
  /** 팝업 정렬 — 카드 우측 끝 라벨은 'right'로 오버플로 방지 */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex align-top ml-1">
      <button
        type="button"
        aria-label={`${title} 설명`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-3.5 h-3.5 rounded-full border text-[9px] font-bold leading-none flex items-center justify-center transition-colors
          ${open
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-blue-400 hover:text-blue-500'}`}
      >
        ?
      </button>
      {open && (
        <span
          className={`absolute top-full mt-1.5 z-50 w-64 max-w-[75vw] ${align === 'right' ? 'right-0' : 'left-0'}
            bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg p-3
            text-xs font-normal text-gray-600 dark:text-gray-300 whitespace-normal text-left leading-relaxed`}
        >
          <span className="block font-semibold text-gray-800 dark:text-gray-100 mb-1">{title}</span>
          {children}
        </span>
      )}
    </span>
  )
}
