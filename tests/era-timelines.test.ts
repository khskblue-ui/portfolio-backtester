/**
 * 구간 연대기("흐름 따라가기") 무결성 — 커버리지·시간 순서·차트 창 정합
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ERA_TIMELINES } from '../src/ui/eraTimelines'

const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))

const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const addMonths = (ym: string, n: number) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

describe('구간 연대기', () => {
  it('7개 에피소드 전부에 6개 이상의 국면이 있다', () => {
    for (const ep of h.episodes) {
      const t = ERA_TIMELINES[ep.peak]
      expect(t, `연대기 누락: ${ep.peak}`).toBeDefined()
      expect(t.length, ep.peak).toBeGreaterThanOrEqual(6)
    }
  })

  it('국면 범위가 상세 차트 창(고점−12 ~ 회복+12) 안이고, from ≤ to, 배열은 시간 순', () => {
    for (const ep of h.episodes) {
      const lo = addMonths(ep.peak, -12)
      const hi = addMonths(ep.recovery ?? h.meta.dataEnd, 12)
      const t = ERA_TIMELINES[ep.peak]
      let prevFrom = ''
      for (const p of t) {
        expect(p.from, `${ep.peak} ${p.title}`).toMatch(YM)
        expect(p.to, `${ep.peak} ${p.title}`).toMatch(YM)
        expect(p.from <= p.to, `${ep.peak} ${p.title}: from > to`).toBe(true)
        expect(p.from >= lo && p.to <= hi, `${ep.peak} ${p.title}: 창 밖 (${p.from}~${p.to}, 허용 ${lo}~${hi})`).toBe(true)
        expect(p.from >= prevFrom, `${ep.peak} ${p.title}: 시간 역행`).toBe(true)
        prevFrom = p.from
      }
    }
  })

  it('모든 국면에 실측 수치(data)와 서사(story)가 있다', () => {
    for (const [peak, t] of Object.entries(ERA_TIMELINES)) {
      for (const p of t) {
        expect(/\d/.test(p.data), `${peak} ${p.title}: data에 수치 없음`).toBe(true)
        expect(p.story.length, `${peak} ${p.title}`).toBeGreaterThan(60)
        expect(p.title.length).toBeGreaterThanOrEqual(3) // 예: "대폭락"
      }
    }
  })

  it('사용자 핵심 질문(2007-08 CPI 급등 / 2009 금의 역설)에 답하는 국면이 존재한다', () => {
    const t = ERA_TIMELINES['2000-08']
    const all = JSON.stringify(t)
    expect(all).toContain('147.27') // 유가 멜트업
    expect(all).toContain('기저효과') // 2009 디플레 착시
    expect(all).toContain('사전') // ex-ante 실질금리
    expect(all).toContain('강제청산') // 2008 금 급락의 디레버리징
  })
})
