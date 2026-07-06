/**
 * iOS Safari 호환 timeout fetch 유틸리티
 * AbortSignal.timeout()은 iOS Safari 16 이하에서 미지원 → AbortController 사용
 */
export function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  )
}
