import type { GuideChapter } from './guideContent'

/**
 * 가이드 학습 진도 — 스크롤로 절에 도달하면 읽음으로 기록 (localStorage).
 * GuideView(기록·표시)와 HomeView(이어서 학습 카드)가 같은 키를 공유한다.
 */

export interface GuideProgressState {
  /** 읽은 절 id 집합 */
  visited: Record<string, true>
  /** 파트 인덱스(0=지침서, 1=경제 공부)별 마지막 읽던 절 id */
  last: Record<number, string>
}

export const GUIDE_PROGRESS_KEY = 'bt_guide_progress_v1'

export const emptyGuideProgress = (): GuideProgressState => ({ visited: {}, last: {} })

/** 훅 밖(HomeView 스냅숏 등)에서 읽기 전용 로드 */
export function loadGuideProgress(): GuideProgressState {
  try {
    const raw = localStorage.getItem(GUIDE_PROGRESS_KEY)
    if (raw != null) {
      const p = JSON.parse(raw) as Partial<GuideProgressState>
      if (p && typeof p === 'object') return { visited: p.visited ?? {}, last: p.last ?? {} }
    }
  } catch {
    // 손상된 저장값 → 빈 진도
  }
  return emptyGuideProgress()
}

export interface PartProgress {
  /** 읽은 절 비율 0~100 */
  pct: number
  doneChapters: number
  totalChapters: number
  /** 챕터별 미독 비율 × 분량의 합 (분) */
  remainMinutes: number
}

export function computePartProgress(chapters: GuideChapter[], visited: Record<string, true>): PartProgress {
  let total = 0
  let done = 0
  let doneCh = 0
  let remain = 0
  for (const c of chapters) {
    const n = c.sections.length
    const v = c.sections.filter((s) => visited[s.id]).length
    total += n
    done += v
    if (n > 0 && v === n) doneCh++
    else if (n > 0) remain += c.minutes * (1 - v / n)
  }
  return {
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    doneChapters: doneCh,
    totalChapters: chapters.length,
    remainMinutes: Math.round(remain),
  }
}

export function chapterDone(c: GuideChapter, visited: Record<string, true>): boolean {
  return c.sections.length > 0 && c.sections.every((s) => visited[s.id])
}

/** 절 id로 챕터·절을 찾는다 (이어 읽기 라벨용) */
export function findSection(chapters: GuideChapter[], sectionId: string | undefined) {
  if (!sectionId) return null
  for (const c of chapters) {
    const s = c.sections.find((x) => x.id === sectionId)
    if (s) return { chapter: c, section: s }
  }
  return null
}
