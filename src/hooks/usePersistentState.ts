import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * localStorage 동기화 state — 독립 앱의 유일한 저장 수단.
 * 키에 스키마 버전을 포함시켜(예: bt_strategies_v1) 구조 변경 시 자연 초기화.
 */
export function usePersistentState<T>(key: string, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) return JSON.parse(raw) as T
    } catch {
      // 손상된 저장값 → 초기값으로
    }
    return initial()
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 용량 초과 등 — 저장은 최선노력
    }
  }, [key, value])

  return [value, setValue]
}
