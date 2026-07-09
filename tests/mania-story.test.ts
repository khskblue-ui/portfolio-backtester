/**
 * 특집 "광기의 해부" 콘텐츠 무결성 — 구조·타임라인 순서·데이터 기준일·인식론 명시
 */

import { describe, it, expect } from 'vitest'
import { MANIA_STORY } from '../src/ui/maniaStory'

describe('광기의 해부 콘텐츠', () => {
  it('두 역사 사례(닷컴·서브프라임)와 현재(2026 AI) 파트가 있다', () => {
    expect(MANIA_STORY.parts.map((p) => p.id)).toEqual(['dotcom', 'subprime'])
    expect(MANIA_STORY.now.title).toContain('2026')
    expect(MANIA_STORY.grammar.length).toBeGreaterThan(0)
  })

  it('트리거 타임라인이 시간순이고 전환점(key) 표시가 있다', () => {
    for (const part of MANIA_STORY.parts) {
      expect(part.timeline.length).toBeGreaterThanOrEqual(5)
      const starts = part.timeline.map((t) => t.date.slice(0, 7))
      for (let i = 1; i < starts.length; i++) expect(starts[i] >= starts[i - 1], `${part.id}: ${starts[i - 1]} → ${starts[i]}`).toBe(true)
      expect(part.timeline.some((t) => t.key)).toBe(true)
    }
  })

  it('현재 파트는 데이터 기준일을 명시하고 잠재 트리거를 예측이 아닌 패턴 대입으로 표기한다', () => {
    expect(MANIA_STORY.dataAsOf).toMatch(/^2026-\d{2}-\d{2}$/)
    const nowText = MANIA_STORY.now.paras.join(' ')
    expect(nowText).toContain('2026-07') // 본문 수치에 기준일 표기
    expect(nowText).toContain('예측이 아니라')
    expect(nowText).toContain('다른 점') // 공정한 비교(닮은 점만 나열 금지)
    expect(MANIA_STORY.epistemics).toContain('사후에만')
  })

  it('핵심 수치·사건이 포함된다 (역사 앵커와 최신 데이터)', () => {
    const all = JSON.stringify(MANIA_STORY)
    for (const must of ['5,048', '−78%', 'Burning Up', '1.00% → 5.25%', '리먼', '−57%', '$4.77조', '36.4%', '41.3', '7,250억', '순환 거래'])
      expect(all, must).toContain(must)
  })

  it('굵게 마크업(**)이 짝을 이룬다', () => {
    const texts = [
      ...MANIA_STORY.grammar,
      ...MANIA_STORY.parts.flatMap((p) => [...p.mania, p.outcome, p.lesson]),
      ...MANIA_STORY.now.paras,
      MANIA_STORY.now.closing,
    ]
    for (const t of texts) expect((t.match(/\*\*/g) ?? []).length % 2, t.slice(0, 40)).toBe(0)
  })
})
