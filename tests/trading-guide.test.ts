/**
 * 인앱 매매 지침서(기초 가이드 1부) 무결성 — 원문(docs/guides/trading-discipline.md)
 * 이식본의 구조·수치·표 정합성
 */

import { describe, it, expect } from 'vitest'
import { TRADING_GUIDE_CHAPTERS, TRADING_GUIDE_GLOSSARY } from '../src/ui/tradingGuide'
import { GUIDE_CHAPTERS } from '../src/ui/guideContent'

describe('매매 지침서 인앱 이식본', () => {
  it('구성: 자가진단 + 1부 STEP 1~4 + 2부 STEP 5 + 마치며 = 7개 챕터', () => {
    expect(TRADING_GUIDE_CHAPTERS).toHaveLength(7)
    expect(TRADING_GUIDE_CHAPTERS[0].id).toBe('tg-diag')
    expect(TRADING_GUIDE_CHAPTERS.every((c) => c.kicker && c.toc && c.goal && c.minutes > 0)).toBe(true)
  })

  it('id가 기초 개념 파트와 충돌하지 않고 전역 유일', () => {
    const ids = [...TRADING_GUIDE_CHAPTERS, ...GUIDE_CHAPTERS].flatMap((c) => [c.id, ...c.sections.map((s) => s.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('표는 헤더와 행 너비가 일치', () => {
    for (const c of TRADING_GUIDE_CHAPTERS)
      for (const s of c.sections)
        if (s.table) for (const row of s.table.rows) expect(row.length, `${c.id}/${s.id}`).toBe(s.table.header.length)
  })

  it('도해(figure) 무결성 — 값 유한, quad는 4칸', () => {
    let count = 0
    for (const c of TRADING_GUIDE_CHAPTERS)
      for (const s of c.sections) {
        const f = s.figure
        if (!f) continue
        count++
        if (f.kind === 'bars') for (const b of f.bars) expect(Number.isFinite(b.value), `${s.id}/${b.label}`).toBe(true)
        else if (f.kind === 'flow') expect(f.steps.length).toBeGreaterThanOrEqual(3)
        else if (f.kind === 'quad') expect(f.cells.length).toBe(4)
      }
    expect(count).toBeGreaterThanOrEqual(6)
  })

  it('원문의 검증된 핵심 수치가 보존됨', () => {
    const all = JSON.stringify(TRADING_GUIDE_CHAPTERS)
    for (const must of ['$146,614', '89.2%', '18.6%', '67.1%', '−13.2%p', '4,285배', '+4.10%', '10회', '31.2%', '−25%', '−50%로', '4,285배', '글라이드패스', '시퀀스 리스크', '행동 장치', '$36,000'])
      expect(all, must).toContain(must)
    // 서식 2종(IPS·매매일지)과 빨간 봉투 존재
    expect(all).toContain('투자정책서')
    expect(all).toContain('매매일지')
    expect(all).toContain('빨간 봉투')
  })

  it('이모지 없음 · 굵게 마크업 짝 맞음', () => {
    const all = JSON.stringify(TRADING_GUIDE_CHAPTERS)
    expect(/[\u{1F000}-\u{1FAFF}☀-➿]/u.test(all)).toBe(false)
    for (const c of TRADING_GUIDE_CHAPTERS)
      for (const s of c.sections)
        for (const t of [...s.paras, s.pitfall ?? ''])
          expect((t.match(/\*\*/g) ?? []).length % 2, t.slice(0, 40)).toBe(0)
  })
})

describe('1부 용어 사전', () => {
  it('모든 항목이 실제 1부 절로 링크된다', () => {
    const sectionIds = new Set(TRADING_GUIDE_CHAPTERS.flatMap((c) => c.sections.map((s) => s.id)))
    for (const g of TRADING_GUIDE_GLOSSARY) expect(sectionIds.has(g.sectionId), g.term).toBe(true)
  })

  it('지침서의 핵심 용어를 커버한다', () => {
    const all = TRADING_GUIDE_GLOSSARY.map((g) => g.term).join(' ')
    for (const must of ['투자정책서', '빨간 봉투', '코어-새틀라이트', '처분효과', '손실회피', '행동 갭', '글라이드패스', '시퀀스 리스크', 'DCA', '결과 편향', '네 관문', '리밸런싱'])
      expect(all, must).toContain(must)
  })

  it('가나다순 정렬 (한글 → 라틴)', () => {
    const terms = TRADING_GUIDE_GLOSSARY.map((g) => g.term)
    const sorted = [...terms].sort((a, b) => a.localeCompare(b, 'ko'))
    expect(terms).toEqual(sorted)
  })
})
