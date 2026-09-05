import { useEffect, useMemo, useState } from 'react'
import { GraduationCap, Landmark, Activity, Play, ArrowRight, BarChart3 } from 'lucide-react'
import { btnPrimaryCls, btnGhostCls, tileCls as baseTileCls } from './common'
import { assessNow, type LiveSnapshot, type NowAssessment, type Signal } from './nowSignals'
import { fetchLiveSnapshot } from './nowData'
import { loadGuideProgress, computePartProgress, findSection } from './guideProgress'
import { TRADING_GUIDE_CHAPTERS } from './tradingGuide'
import { GUIDE_CHAPTERS } from './guideContent'
import type { StrategyConfig } from '@/core'

/**
 * 홈 — "오늘의 시장 위치" 콕핏 (A안). 체제 판정 히어로 + 신호 5종 요약 +
 * 이어서 하기(학습 진도·백테스트·닮은 역사). 각 탭의 입구 역할이며,
 * 신호의 상세 차트·설명은 "현재 신호" 탭이 담당한다.
 */

export interface HomeHistoryData {
  meta: { dataEnd: string; liveRefs?: { ym: string; sp500trMonthlyAvg: number | null; cpi: number; capeProxy: number | null; stockRealLast: number } }
  series: { dates: string[]; stock: number[]; bond?: (number | null)[]; gold?: (number | null)[] }
  macro: {
    cpiYoY: (number | null)[]
    gs10: (number | null)[]
    realRate10: (number | null)[]
    cape: (number | null)[]
    capeProxy?: (number | null)[]
    tbill3m?: (number | null)[]
    tips10?: (number | null)[]
  }
}

/** 카드 키커용 짧은 라벨 — 원문 라벨은 좁은 카드에서 잘려 보기 흉함 */
const SHORT_LABEL: Record<Signal['key'], string> = {
  market: '시장 상태',
  valuation: '밸류에이션 (CAPE)',
  inflation: 'CPI 인플레이션',
  realRate: '실질금리 (TIPS)',
  curve: '장단기 금리차',
}

const LEVEL_META: Record<Signal['level'], { label: string; text: string; chip: string; dot: string }> = {
  ok: { label: '양호', text: 'text-[#0f9d67] dark:text-[#1baf7a]', chip: 'bg-[#1baf7a]/10', dot: 'bg-[#1baf7a]' },
  watch: { label: '주의', text: 'text-[#c98500] dark:text-[#e3a008]', chip: 'bg-[#c98500]/10', dot: 'bg-[#c98500]' },
  alert: { label: '경계', text: 'text-[#e34948] dark:text-[#e66767]', chip: 'bg-[#e34948]/10', dot: 'bg-[#e34948]' },
}

/** 홈 타일 — 공용 tileCls에 클릭 가능 힌트(hover)만 얹음 */
const tileCls = `${baseTileCls} transition-colors hover:bg-white dark:hover:bg-white/[0.08]`

export function HomeView({
  data,
  error,
  strategies,
  onNavigate,
  onRun,
}: {
  /** 역사 번들 — App 셸이 한 번 받아 히어로와 공유 (null = 로딩 중) */
  data: HomeHistoryData | null
  error: string | null
  strategies: StrategyConfig[]
  onNavigate: (view: 'guide' | 'history' | 'now' | 'backtest') => void
  onRun: () => void
}) {
  const [live, setLive] = useState<LiveSnapshot | null>(null)

  useEffect(() => {
    if (data?.meta.liveRefs) fetchLiveSnapshot(data.meta.liveRefs).then(setLive).catch(() => {})
  }, [data])

  const assessment: NowAssessment | null = useMemo(
    () => (data ? assessNow(data, live ?? undefined) : null),
    [data, live],
  )

  // 가이드 진도 스냅숏 — 홈에 들어올 때마다 새로 읽음 (GuideView와 같은 저장 키)
  const guide = useMemo(() => {
    const prog = loadGuideProgress()
    const parts = [
      { label: '1부 지침서', chapters: TRADING_GUIDE_CHAPTERS, idx: 0 },
      { label: '2부 경제 공부', chapters: GUIDE_CHAPTERS, idx: 1 },
    ]
    // 읽는 중(0% 초과 100% 미만)인 파트 우선, 없으면 1부
    const active =
      parts.find((p) => {
        const pp = computePartProgress(p.chapters, prog.visited)
        return pp.pct > 0 && pp.pct < 100
      }) ?? parts[0]
    const pp = computePartProgress(active.chapters, prog.visited)
    const last = findSection(active.chapters, prog.last[active.idx])
    return { label: active.label, pct: pp.pct, done: pp.doneChapters, total: pp.totalChapters, last }
  }, [])

  const counts = useMemo(() => {
    const c: Record<Signal['level'], number> = { ok: 0, watch: 0, alert: 0 }
    for (const s of assessment?.signals ?? []) c[s.level]++
    return c
  }, [assessment])

  return (
    <div className="space-y-6">
      {/* 체제 블록 — 유기체 홈: 카드 선 없이 바탕 위에 놓고 여백·글자 크기로 구분 */}
      <div className="px-1 pt-1 sm:pt-2">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <div className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
              REGIME · 지금은?{assessment && <span className="ml-2 normal-case tracking-normal">기준 {assessment.asOf}{assessment.live ? ' · 라이브' : ''}</span>}
            </div>
            <h2 className="text-xl sm:text-[26px] font-bold leading-snug tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
              {assessment ? assessment.headline : error ? '신호 데이터를 불러오지 못했습니다' : '시장 위치 확인 중…'}
            </h2>
            {assessment?.analog && (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                가장 닮은 역사 조합: <b className="text-[#2962ff] dark:text-[#5b8aff]">{assessment.analog.split(' — ')[0]}</b> · 예측이 아니라
                선행조건 체크리스트입니다
              </p>
            )}
          </div>
          {assessment && (
            <div className="flex gap-2 flex-wrap">
              {(['ok', 'watch', 'alert'] as const)
                .filter((lv) => counts[lv] > 0)
                .map((lv) => (
                  <span
                    key={lv}
                    className="flex items-center gap-1.5 border border-[#e0e3eb] dark:border-[#2a2e39] rounded-full px-3 py-1 text-[12px] text-zinc-600 dark:text-zinc-300"
                  >
                    <span className={`w-2 h-2 rounded-full ${LEVEL_META[lv].dot}`} />
                    {LEVEL_META[lv].label} {counts[lv]}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* 신호 5종 미니카드 */}
      {assessment && (
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {assessment.signals.map((s) => (
            <button
              key={s.key}
              onClick={() => onNavigate('now')}
              className={`${tileCls} p-4 text-left ${
                s.level === 'alert' ? 'ring-1 ring-[#e34948]/45 dark:ring-[#e66767]/50' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono tracking-[0.18em] text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                  {SHORT_LABEL[s.key] ?? s.label}
                </span>
                <span className={`text-[10.5px] font-medium rounded-full px-2 py-0.5 ${LEVEL_META[s.level].text} ${LEVEL_META[s.level].chip}`}>
                  {LEVEL_META[s.level].label}
                </span>
              </div>
              <div className="mt-1.5 text-[15px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">{s.value}</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2">{s.reason}</div>
            </button>
          ))}
        </div>
      )}

      {/* 이어서 하기 — 각 탭의 입구 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 가이드 학습 */}
        <div className={`${tileCls} p-4 flex flex-col gap-2.5`}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">CONTINUE · 가이드북</span>
            <span className="text-[12px] font-mono font-semibold text-[#2962ff] dark:text-[#5b8aff]">
              {guide.label} {guide.pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[#eef1f5] dark:bg-[#2a2e39] overflow-hidden">
            <div className="h-full rounded-full bg-[#2962ff]" style={{ width: `${guide.pct}%` }} />
          </div>
          <div className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug flex-1">
            {guide.last ? guide.last.section.title : '매매 습관 교정 지침서부터 시작해 보세요'}
          </div>
          <button
            onClick={() => onNavigate('guide')}
            className={`self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${btnPrimaryCls}`}
          >
            <GraduationCap className="w-4 h-4" /> {guide.last ? '이어서 읽기' : '학습 시작'}
          </button>
        </div>

        {/* 백테스트 */}
        <div className={`${tileCls} p-4 flex flex-col gap-2.5`}>
          <span className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">RE-RUN · 백테스트</span>
          <div className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug">
            전략 {strategies.length}개 대기 중
          </div>
          <div className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed flex-1">
            {strategies
              .slice(0, 2)
              .map((s) => s.name)
              .join(' · ')}
            {strategies.length > 2 && ` 외 ${strategies.length - 2}개`}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRun}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${btnPrimaryCls}`}
            >
              <Play className="w-4 h-4" /> 바로 실행
            </button>
            <button
              onClick={() => onNavigate('backtest')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${btnGhostCls}`}
            >
              <BarChart3 className="w-4 h-4" /> 워크벤치 열기
            </button>
          </div>
        </div>

        {/* 닮은 역사 */}
        <div className={`${tileCls} p-4 flex flex-col gap-2.5`}>
          <span className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">READ · 닮은 역사</span>
          <div className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug flex-1">
            {assessment?.analog ? assessment.analog.replace(/ \(단,[^)]*\)/, '') : '1900년 이후 7개 대형 하락 구간의 연대기를 읽어보세요'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onNavigate('history')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${btnGhostCls}`}
            >
              <Landmark className="w-4 h-4" /> 역사 연구 열기
            </button>
            <button
              onClick={() => onNavigate('now')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${btnGhostCls}`}
            >
              <Activity className="w-4 h-4" /> 신호 상세
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
