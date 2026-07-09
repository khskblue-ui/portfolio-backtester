/**
 * 2026-07 종합 점검에서 확정된 버그들의 회귀 테스트
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { uniqueRunLabels } from '../src/ui/common'
import { EPISODE_INFO } from '../src/ui/episodeInfo'
import { ERA_STORIES } from '../src/ui/eraStories'
import { computeMetrics } from '../src/core/metrics'

describe('중복 전략 이름 라벨', () => {
  it('겹치는 이름은 "(1)/(2)"로 구분, 유일한 이름은 그대로', () => {
    const runs = [
      { config: { id: 'a', name: '60/40' } },
      { config: { id: 'b', name: '60/40' } },
      { config: { id: 'c', name: '주식100' } },
    ]
    const m = uniqueRunLabels(runs)
    expect(m.get('a')).toBe('60/40 (1)')
    expect(m.get('b')).toBe('60/40 (2)')
    expect(m.get('c')).toBe('주식100')
    // 라벨 유일성 — recharts dataKey 충돌 방지의 핵심
    expect(new Set([...m.values()]).size).toBe(3)
  })
})

describe('에피소드 메타 커버리지 (번들 재생성 시 UI 조용한 열화 방지)', () => {
  const h = JSON.parse(readFileSync(new URL('../public/data/history.json', import.meta.url), 'utf8'))
  it('history.json의 모든 구간에 EPISODE_INFO와 ERA_STORIES가 있다', () => {
    for (const e of h.episodes) {
      expect(EPISODE_INFO[e.peak], `EPISODE_INFO 누락: ${e.peak}`).toBeDefined()
      expect(ERA_STORIES[e.peak], `ERA_STORIES 누락: ${e.peak}`).toBeDefined()
    }
  })
})

describe('전액 손실 TWRR', () => {
  it('가치가 0이 된 전략의 연환산 TWRR은 0%가 아니라 -100%', () => {
    const daily = [
      { date: '2020-01-02', value: 1000, externalFlow: 1000, cumContributions: 1000, sleeveValues: {}, cash: 0 },
      { date: '2021-01-04', value: 0, externalFlow: 0, cumContributions: 1000, sleeveValues: {}, cash: 0 },
      { date: '2022-01-03', value: 0, externalFlow: 0, cumContributions: 1000, sleeveValues: {}, cash: 0 },
    ]
    const m = computeMetrics({ daily, warnings: [], trades: [] } as unknown as Parameters<typeof computeMetrics>[0])
    expect(m.twrrAnnualPct).toBe(-100)
    expect(m.maxDrawdownPct).toBe(-100)
  })
})
