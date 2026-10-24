import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  isTripodDashboard,
  exposureSpans,
  meterPos,
  conditionLevels,
  paperReturn,
  fmtRate,
  withWeekday,
  TRIPOD_FINDINGS,
  type TripodDashboard,
} from '@/ui/tripodData'

// 봇이 매 거래일 갱신하는 파일이라 특정 값이 아니라 내부 정합성만 고정한다
const root = path.resolve(__dirname, '..')
const dash = JSON.parse(fs.readFileSync(path.join(root, 'signals/tripod/dashboard.json'), 'utf8')) as TripodDashboard
const close = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol

describe('트라이팟 대시보드 기록(signals/tripod/dashboard.json)', () => {
  const t = dash.tripod, r = dash.rule
  it('스키마 검사를 통과한다', () => {
    expect(isTripodDashboard(dash)).toBe(true)
    expect(isTripodDashboard({ version: 1 })).toBe(false)
    expect(isTripodDashboard('<!doctype html>')).toBe(false)
  })
  it('경계값 = 규칙 계수 × 지표', () => {
    expect(close(t.upPx, t.ma250 * r.upBand)).toBe(true)
    expect(close(t.downPx, t.ma250 * r.downBand)).toBe(true)
    expect(close(t.ddPx, t.high52 * (1 + r.ddLimit))).toBe(true)
    expect(close(t.ratio, t.close / t.ma250, 1e-4)).toBe(true)
    expect(close(t.dd, t.close / t.high52 - 1, 1e-4)).toBe(true)
  })
  it('트라이팟 노출은 0·1.5·3배 중 하나이고 비중 합은 1', () => {
    expect([0, 1.5, 3]).toContain(t.exposure)
    expect(close(t.weights.reduce((s, w) => s + w, 0), 1, 1e-9)).toBe(true)
    for (const L of dash.history.exposure) expect([0, 1.5, 3]).toContain(L)
    expect(dash.history.exposure.at(-1)).toBe(t.exposure)
  })
  it('조건 충족 여부가 지표와 규칙에 맞다', () => {
    expect(t.checks.regime).toBe(t.regime)
    if (t.regime === 'UP') {
      expect(t.checks.vixOk).toBe(t.vix10 < r.vixUp)
      expect(t.checks.ddOk).toBe(t.dd >= r.ddLimit)
      expect(t.exposure).toBe(t.checks.vixOk && t.checks.ddOk ? 3 : 1.5)
    } else if (t.regime === 'DOWN') {
      expect(t.checks.vixOk).toBe(t.vix10 < r.vixDown)
      expect(t.exposure).toBe(t.checks.vixOk ? 1.5 : 0)
    }
  })
  it('흐름 배열 길이가 같고 날짜가 오름차순이며 마지막 날이 기준일', () => {
    const h = dash.history
    for (const k of ['close', 'ma250', 'vix10', 'dd', 'exposure'] as const) expect(h[k].length).toBe(h.dates.length)
    for (let i = 1; i < h.dates.length; i++) expect(h.dates[i] > h.dates[i - 1]).toBe(true)
    expect(h.dates.at(-1)).toBe(dash.asOf)
  })
  it('사전 등록 후보 4개와 트라이팟이 모두 있다', () => {
    expect(dash.strategies.map((s) => s.id).sort()).toEqual(['t2', 'te3', 'tev2', 'tev3', 'tripod'])
    expect(dash.nextTradingDay > dash.asOf).toBe(true)
  })
})

describe('트라이팟 표시 함수', () => {
  it('노출이 같은 날을 한 구간으로 묶는다', () => {
    expect(exposureSpans(['a', 'b', 'c', 'd'], [3, 3, 1.5, 3])).toEqual([
      { x1: 'a', x2: 'b', L: 3 },
      { x1: 'c', x2: 'c', L: 1.5 },
      { x1: 'd', x2: 'd', L: 3 },
    ])
  })
  it('게이지 위치는 0~1로 자른다', () => {
    expect(meterPos(5, 0, 10)).toBe(0.5)
    expect(meterPos(-1, 0, 10)).toBe(0)
    expect(meterPos(11, 0, 10)).toBe(1)
  })
  it('조건 카드 상태: 여유·근접·미충족·해당 없음', () => {
    const base = { ...dash.tripod, regime: 'UP' as const, close: 100, downPx: 90, vix10: 20, dd: -0.03 }
    expect(conditionLevels(base, dash.rule)).toEqual({ trend: 'ok', vix: 'ok', dd: 'ok' })
    expect(conditionLevels({ ...base, close: 92, vix10: 26, dd: -0.08 }, dash.rule)).toEqual({ trend: 'near', vix: 'near', dd: 'near' })
    expect(conditionLevels({ ...base, vix10: 29, dd: -0.1 }, dash.rule)).toEqual({ trend: 'ok', vix: 'off', dd: 'off' })
    expect(conditionLevels({ ...base, regime: 'DOWN', vix10: 12 }, dash.rule)).toEqual({ trend: 'off', vix: 'ok', dd: 'na' })
  })
  it('가상 추적 수익률과 표기', () => {
    expect(paperReturn([1, 1.1])).toBeCloseTo(0.1)
    expect(paperReturn(undefined)).toBeNull()
    expect(fmtRate(-0.0726)).toBe('−7.3%')
    expect(withWeekday('2026-10-23')).toBe('2026-10-23(금)')
  })
})

describe('트라이팟 검증 요약 수치는 연구 문서 값 그대로다', () => {
  const docs = {
    verification: fs.readFileSync(path.join(root, 'docs/research/tripod-verification.md'), 'utf8'),
    alternatives: fs.readFileSync(path.join(root, 'docs/research/tripod-alternatives.md'), 'utf8'),
  }
  for (const f of TRIPOD_FINDINGS) {
    it(f.text.slice(0, 24), () => {
      for (const a of f.anchors) {
        expect(f.text).toContain(a.value)
        expect(docs[a.doc]).toContain(a.value)
      }
    })
  }
})
