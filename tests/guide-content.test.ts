/**
 * 기초 가이드 콘텐츠 무결성 — 구조·앵커·핵심 용어 커버리지 검증
 */

import { describe, it, expect } from 'vitest'
import { GUIDE_CHAPTERS, GUIDE_GLOSSARY, GUIDE_INTRO } from '../src/ui/guideContent'

describe('가이드 구조', () => {
  it('4단계가 순서대로 있고, 각 단계에 목표·시간·2개 이상의 절이 있다', () => {
    expect(GUIDE_CHAPTERS.map((c) => c.step)).toEqual([1, 2, 3, 4])
    for (const c of GUIDE_CHAPTERS) {
      expect(c.goal).toContain('해석')
      expect(c.minutes).toBeGreaterThan(0)
      expect(c.sections.length).toBeGreaterThanOrEqual(2)
    }
    expect(GUIDE_INTRO.paras.length).toBeGreaterThan(0)
  })

  it('절 id가 전역에서 유일하다 (앵커 충돌 방지)', () => {
    const ids = GUIDE_CHAPTERS.flatMap((c) => [c.id, ...c.sections.map((s) => s.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('모든 앱 인용문에 출처 탭과 해석(reading)이 있다', () => {
    for (const c of GUIDE_CHAPTERS)
      for (const s of c.sections)
        for (const q of s.quotes ?? []) {
          expect(['역사 연구', '현재 신호']).toContain(q.source)
          expect(q.quote.length).toBeGreaterThan(10)
          expect(q.reading.length).toBeGreaterThan(30)
        }
  })

  it('굵게 마크업(**)이 짝을 이룬다', () => {
    const texts = GUIDE_CHAPTERS.flatMap((c) =>
      c.sections.flatMap((s) => [...s.paras, s.analogy ?? '', s.pitfall ?? '', ...(s.quotes ?? []).map((q) => q.reading)]),
    )
    for (const t of texts) expect((t.match(/\*\*/g) ?? []).length % 2, t.slice(0, 40)).toBe(0)
  })
})

describe('용어 사전', () => {
  it('모든 항목이 실제 본문 절로 링크된다', () => {
    const sectionIds = new Set(GUIDE_CHAPTERS.flatMap((c) => c.sections.map((s) => s.id)))
    for (const g of GUIDE_GLOSSARY) expect(sectionIds.has(g.sectionId), g.term).toBe(true)
  })

  it('두 탭의 핵심 용어를 모두 커버한다', () => {
    const all = GUIDE_GLOSSARY.map((g) => g.term).join(' ')
    for (const must of ['사전적', '사후적', 'CAPE', '스태그플레이션', '실질 수익률', '명목', '장단기', '채권', 'TIPS', '금융억압', '할인율', '화폐 착시'])
      expect(all, must).toContain(must)
  })

  it('가나다순 정렬 (한글 → 라틴)', () => {
    const terms = GUIDE_GLOSSARY.map((g) => g.term)
    const sorted = [...terms].sort((a, b) => a.localeCompare(b, 'ko'))
    expect(terms).toEqual(sorted)
  })
})
