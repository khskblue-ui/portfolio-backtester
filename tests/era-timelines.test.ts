/**
 * 구간 연대기("흐름 따라가기") 무결성 — 커버리지·시간 순서·차트 창 정합
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ERA_TIMELINES, ERA_MARKERS } from '../src/ui/eraTimelines'

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

  it('이벤트 마커 — 7개 에피소드 전부, YM 형식·시간 순·차트 창 안·짧은 라벨', () => {
    for (const ep of h.episodes) {
      const ms = ERA_MARKERS[ep.peak]
      expect(ms, `마커 누락: ${ep.peak}`).toBeDefined()
      expect(ms.length, ep.peak).toBeGreaterThanOrEqual(3)
      const lo = addMonths(ep.peak, -12)
      const hi = addMonths(ep.recovery ?? h.meta.dataEnd, 12)
      let prev = ''
      for (const m of ms) {
        expect(m.ym, `${ep.peak} ${m.label}`).toMatch(YM)
        expect(m.ym >= lo && m.ym <= hi, `${ep.peak} ${m.label}: 창 밖 (${m.ym}, 허용 ${lo}~${hi})`).toBe(true)
        expect(m.ym >= prev, `${ep.peak} ${m.label}: 시간 역행`).toBe(true)
        expect(m.label.length).toBeGreaterThanOrEqual(2)
        expect(m.label.length, `${ep.peak} ${m.label}: 라벨이 김`).toBeLessThanOrEqual(10)
        prev = m.ym
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

describe('큐레이션 구간 (금태환 이후 상승·이행기)', () => {
  it('선언된 큐레이션 구간마다 서사·연대기(국면 5개 이상)·마커(3개 이상)가 전부 있다', async () => {
    const { CURATED_ERAS } = await import('../src/ui/curatedEras')
    const { ERA_STORIES } = await import('../src/ui/eraStories')
    for (const c of CURATED_ERAS) {
      expect(ERA_STORIES[c.start], `서사 누락: ${c.start}`).toBeDefined()
      const t = ERA_TIMELINES[c.start]
      expect(t, `연대기 누락: ${c.start}`).toBeDefined()
      expect(t.length, c.start).toBeGreaterThanOrEqual(5)
      const ms = ERA_MARKERS[c.start]
      expect(ms, `마커 누락: ${c.start}`).toBeDefined()
      expect(ms.length, c.start).toBeGreaterThanOrEqual(3)
      const lo = addMonths(c.start, -12)
      const hi = addMonths(c.end ?? h.meta.dataEnd, 12)
      let prevFrom = ''
      for (const p of t) {
        expect(p.from <= p.to, `${c.start} ${p.title}: from > to`).toBe(true)
        expect(p.from >= lo && p.to <= hi, `${c.start} ${p.title}: 창 밖 (${p.from}~${p.to}, 허용 ${lo}~${hi})`).toBe(true)
        expect(p.from >= prevFrom, `${c.start} ${p.title}: 시간 역행`).toBe(true)
        prevFrom = p.from
      }
      let prev = ''
      for (const m of ms) {
        expect(m.ym >= lo && m.ym <= hi, `${c.start} ${m.label}: 창 밖`).toBe(true)
        expect(m.ym >= prev, `${c.start} ${m.label}: 시간 역행`).toBe(true)
        expect(m.label.length).toBeLessThanOrEqual(10)
        prev = m.ym
      }
    }
  })

  it('커버리지 불변식 — 1971-08 이후 모든 달이 어느 구간의 상세 창(±12개월) 안에 있다', async () => {
    const { CURATED_ERAS } = await import('../src/ui/curatedEras')
    const windows: [string, string][] = [
      ...h.episodes.map((ep: { peak: string; recovery: string | null }) => [addMonths(ep.peak, -12), addMonths(ep.recovery ?? h.meta.dataEnd, 12)] as [string, string]),
      ...CURATED_ERAS.map((c) => [addMonths(c.start, -12), addMonths(c.end ?? h.meta.dataEnd, 12)] as [string, string]),
    ]
    const uncovered: string[] = []
    for (let ym = '1971-08'; ym <= h.meta.dataEnd; ym = addMonths(ym, 1)) {
      if (!windows.some(([a, b]) => ym >= a && ym <= b)) uncovered.push(ym)
    }
    expect(uncovered, `커버리지 공백: ${uncovered.slice(0, 6).join(', ')}`).toHaveLength(0)
  })
})
