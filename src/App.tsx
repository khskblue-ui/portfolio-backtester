import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Play, RefreshCw, Sun, Moon, Download, Upload, X, FileText, BarChart3, Landmark, Activity, GraduationCap, Check, Home } from 'lucide-react'
import {
  loadDataBundle,
  runComparison,
  validateStrategy,
  defaultStrategies,
  emptyStrategy,
  nextId,
  ASSET_CATALOG,
  type StrategyConfig,
  type StrategyRun,
  type AlignedDataBundle,
} from '@/core'
import { usePersistentState } from '@/hooks/usePersistentState'
import {
  SERIES_COLORS_LIGHT,
  SERIES_COLORS_DARK,
  MAX_STRATEGIES,
  defaultSharedSettings,
  applyShared,
  btnPrimaryCls,
  btnGhostCls,
  type SharedSettings,
} from '@/ui/common'
import { EpistemicsBanner } from '@/ui/EpistemicsBanner'
import { SettingsPanel } from '@/ui/SettingsPanel'
import { StrategyCard } from '@/ui/StrategyCard'
import { ResultsSection } from '@/ui/ResultsSection'
import { ReportView } from '@/ui/ReportView'
import { HistoryView } from '@/ui/HistoryView'
import { NowView } from '@/ui/NowView'
import { GuideView } from '@/ui/GuideView'
import { HomeView, type HomeHistoryData } from '@/ui/HomeView'
import { HomeHero } from '@/ui/HomeHero'
import { loadGuideProgress, computePartProgress } from '@/ui/guideProgress'
import { TRADING_GUIDE_CHAPTERS } from '@/ui/tradingGuide'
import { GUIDE_CHAPTERS } from '@/ui/guideContent'

type Theme = 'light' | 'dark'
type View = 'home' | 'guide' | 'history' | 'now' | 'backtest'

/** 전역 내비 항목 — 데스크톱 좌측 레일 + 모바일 하단 탭바 공용 (A안) */
const NAV_ITEMS = [
  { key: 'home', label: '홈', Icon: Home },
  { key: 'guide', label: '가이드북', Icon: GraduationCap },
  { key: 'history', label: '역사', Icon: Landmark },
  { key: 'now', label: '신호', Icon: Activity },
  { key: 'backtest', label: '백테스트', Icon: BarChart3 },
] as const

/** 내보내기/가져오기 파일 스키마 */
interface ConfigFile {
  version: 1
  shared: SharedSettings
  strategies: StrategyConfig[]
}

/** 기간 프리셋 — 역사적 스트레스 구간을 원클릭으로 (워크벤치 상단 칩) */
const PERIOD_PRESETS = [
  { label: '전체', start: '', end: '' },
  { label: '닷컴 1998~03', start: '1998-01-01', end: '2003-12-31' },
  { label: '금융위기 2007~13', start: '2007-10-01', end: '2013-03-31' },
  { label: '2022 긴축', start: '2022-01-01', end: '2023-12-31' },
] as const

function PeriodPresetChips({ shared, onPick }: { shared: SharedSettings; onPick: (start: string, end: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500 mr-1">PERIOD</span>
      {PERIOD_PRESETS.map((p) => {
        const active = shared.startDate === p.start && shared.endDate === p.end
        return (
          <button
            key={p.label}
            onClick={() => onPick(p.start, p.end)}
            className={`text-[11.5px] px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? 'ink-chip border-transparent font-medium'
                : 'border-[#d3d8e3] dark:border-[#363a45] text-zinc-500 dark:text-zinc-400 hover:border-[#2962ff] hover:text-[#2962ff]'
            }`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

export default function App() {
  // ── 테마 (독립 앱 자체 다크모드) ──
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('bt_theme')
    if (stored === 'dark' || stored === 'light') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('bt_theme', theme)
  }, [theme])
  const palette = theme === 'dark' ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT

  // ── 설정 (localStorage 자동 저장 — 백엔드 없는 독립 툴의 저장 수단) ──
  const [strategies, setStrategies] = usePersistentState<StrategyConfig[]>('bt_strategies_v1', defaultStrategies)
  const [sharedStored, setShared] = usePersistentState<SharedSettings>('bt_shared_v1', defaultSharedSettings)
  // 저장된 설정에 새 필드(예: endDate)가 없어도 기본값으로 채움 — 스키마 확장 호환
  const shared = useMemo(() => ({ ...defaultSharedSettings(), ...sharedStored }), [sharedStored])

  // ── 실행 상태 ──
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<StrategyRun[] | null>(null)
  const [bundle, setBundle] = useState<AlignedDataBundle | null>(null)
  // 실행 시점의 설정 시그니처 — 이후 설정이 바뀌면 결과에 "스테일" 배지 표시
  const [ranSignature, setRanSignature] = useState<string | null>(null)
  // 알림: 오류(빨강)와 안내(파랑)를 구분 — 성공 안내가 실패처럼 보이지 않게
  const [notice, setNoticeState] = useState<{ text: string; kind: 'error' | 'info' } | null>(null)
  const setNotice = (text: string | null, kind: 'error' | 'info' = 'error') =>
    setNoticeState(text == null ? null : { text, kind })
  const [showReport, setShowReport] = useState(false)
  const [view, setView] = useState<View>('home')

  // 홈 히어로·콕핏이 함께 쓰는 역사 번들 — 셸에서 한 번만 받아 둘에 내려준다
  const [history, setHistory] = useState<HomeHistoryData | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  useEffect(() => {
    fetch('/data/history.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HomeHistoryData) => setHistory(d))
      .catch((e) => setHistoryError(e instanceof Error ? e.message : '로드 실패'))
  }, [])

  // 유기체 홈: 최상단 근처(스크롤 80px 미만)에서만 헤더·레일이 투명(곡선 위에 떠 있음),
  // 조금만 내려도 유리(blur) 바탕으로 — 히어로 문구·버튼 위에 투명 헤더가 겹치지 않게.
  // 다른 탭에서는 늘 불투명. 같은 값 setState는 리렌더를 만들지 않아 스크롤 비용은 없다
  const [atTop, setAtTop] = useState(true)
  useEffect(() => {
    if (view !== 'home') return
    const onScroll = () => setAtTop(window.scrollY < 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [view])
  const floating = view === 'home' && atTop
  const guideStarted = useMemo(() => {
    const prog = loadGuideProgress()
    return computePartProgress(TRADING_GUIDE_CHAPTERS, prog.visited).pct > 0 || computePartProgress(GUIDE_CHAPTERS, prog.visited).pct > 0
    // 홈으로 돌아올 때마다 다시 읽음 (가이드 진도는 localStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  // 모바일 워크벤치 위저드 (① 전략 → ② 가정 → ③ 결과). 데스크톱(lg+) 분할 화면에서는 무시됨
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateStrategy = (id: string, updater: (s: StrategyConfig) => StrategyConfig) =>
    setStrategies((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))

  // 실행에 영향을 주는 전체 설정의 시그니처 (스테일 판정용)
  const configSignature = useMemo(() => JSON.stringify({ shared, strategies }), [shared, strategies])
  const resultsStale = runs != null && ranSignature != null && ranSignature !== configSignature

  const run = async (forceRefresh = false) => {
    setNotice(null)
    // 다른 탭에서 실행해도 결과가 보이도록 백테스트 탭으로 전환
    setView('backtest')
    if (strategies.length === 0) {
      setNotice('전략이 없습니다. 전략을 추가하세요')
      return
    }
    if (shared.startDate && shared.endDate && shared.endDate <= shared.startDate) {
      setNotice('종료일이 시작일보다 빠릅니다. 날짜를 확인하세요')
      return
    }
    const applied = strategies.map((s) => applyShared(s, shared))
    for (const s of applied) {
      const errors = validateStrategy(s)
      if (errors.length > 0) {
        setNotice(`"${s.name}": ${errors[0]}`)
        return
      }
    }
    setRunning(true)
    try {
      const tickers = applied.flatMap((s) => s.sleeves.map((x) => x.ticker))
      const b = await loadDataBundle(tickers, {
        startDate: shared.startDate || undefined,
        endDate: shared.endDate || undefined,
        forceRefresh,
      })
      setBundle(b)
      setRuns(runComparison(applied, b))
      setRanSignature(JSON.stringify({ shared, strategies }))
      setWizardStep(3) // 모바일 위저드: 실행 성공 시 결과 단계로
      window.scrollTo({ top: 0 })
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '백테스트 실패')
    } finally {
      setRunning(false)
    }
  }

  const addStrategy = () => {
    if (strategies.length >= MAX_STRATEGIES) {
      setNotice(`전략은 최대 ${MAX_STRATEGIES}개까지 비교할 수 있습니다`)
      return
    }
    setStrategies((prev) => [...prev, emptyStrategy(`전략 ${prev.length + 1}`)])
  }

  // ── 설정 파일 내보내기/가져오기 (재현성 — 설정 소유권은 사용자에게) ──
  const exportConfig = () => {
    const data: ConfigFile = { version: 1, shared, strategies }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtester-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importConfig = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ConfigFile>
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.strategies) ||
        parsed.strategies.length === 0 ||
        parsed.strategies.some((s) => !Array.isArray(s?.sleeves)) ||
        typeof parsed.shared !== 'object' ||
        parsed.shared == null
      ) {
        setNotice('설정 파일 형식이 올바르지 않습니다 (version 1 스키마 필요)')
        return
      }
      if (parsed.strategies.length > MAX_STRATEGIES) {
        setNotice(`전략은 최대 ${MAX_STRATEGIES}개까지 가져올 수 있습니다 (파일에 ${parsed.strategies.length}개)`)
        return
      }
      // id 중복(수동 편집 파일 등)은 조용한 상태 오염을 일으키므로 재발급
      const ids = new Set<string>()
      const cleaned = parsed.strategies.map((s) => {
        const id = !s.id || ids.has(s.id) ? nextId() : s.id
        ids.add(id)
        return { ...s, id }
      })
      setShared({ ...defaultSharedSettings(), ...parsed.shared })
      setStrategies(cleaned)
      setRuns(null)
      setBundle(null)
      setNotice(null)
    } catch {
      setNotice('설정 파일을 읽을 수 없습니다 (JSON 파싱 실패)')
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f5] dark:bg-[#131722] text-zinc-900 dark:text-zinc-100">
      {/* 상단 고정 헤더 — 단일 바: 로고 · 텍스트 내비 · 우측 액션 (미니멀) */}
      <header
        className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
          floating
            ? 'bg-transparent border-transparent'
            : view === 'home'
              ? 'bg-white/90 dark:bg-[#1e222d]/90 backdrop-blur-md border-[#e0e3eb] dark:border-[#2a2e39]'
              : 'bg-white dark:bg-[#1e222d] border-[#e0e3eb] dark:border-[#2a2e39]'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 flex items-center justify-between flex-wrap gap-x-4 gap-y-1 min-h-14 py-1.5">
          <div className="flex items-center gap-3 sm:gap-7 min-w-0">
            <button onClick={() => setView('home')} className="flex items-center gap-2 flex-shrink-0" title="홈으로">
              {/* 로고: 파비콘(favicon.svg)과 동일한 正 마크 */}
              <div className="w-7 h-7 ink-chip rounded-lg flex items-center justify-center text-[16px] font-black leading-none select-none" aria-hidden="true">
                正
              </div>
              <h1 className="text-[15px] sm:text-base font-bold tracking-tight whitespace-nowrap">투자의 정석</h1>
            </button>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title="테마 전환"
              className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </button>
            <button
              onClick={() => {
                if (!runs || !bundle) {
                  setNotice('보고서를 만들려면 먼저 백테스트를 실행하세요')
                  return
                }
                setShowReport(true)
              }}
              title="백테스트 결과 보고서 (PDF 저장)"
              className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <FileText className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={exportConfig}
              title="전략·설정을 JSON 파일로 백업"
              className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <Download className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="백업한 설정 JSON 불러오기"
              className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <Upload className="w-[18px] h-[18px]" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importConfig(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => run(true)}
              disabled={running}
              title="캐시를 비우고 데이터 다시 조회"
              className="p-2 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-50"
            >
              <RefreshCw className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={() => run(false)}
              disabled={running}
              className={`flex items-center gap-1.5 ml-1 sm:ml-2 px-3.5 py-2 rounded-lg text-sm font-semibold ${btnPrimaryCls} disabled:opacity-50`}
            >
              <Play className="w-4 h-4" />
              {running ? '실행 중…' : '백테스트 실행'}
            </button>
          </div>
        </div>
      </header>

      {/* 데스크톱 좌측 아이콘 레일 (A안) — 헤더 아래 고정 */}
      <aside
        className={`hidden lg:flex fixed left-0 top-14 bottom-0 w-16 z-30 flex-col items-center gap-1 pt-3 border-r transition-colors duration-300 ${
          floating ? 'bg-transparent border-transparent' : 'bg-white dark:bg-[#1e222d] border-[#e0e3eb] dark:border-[#2a2e39]'
        }`}
      >
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setView(key)} title={label} className="flex flex-col items-center gap-0.5 py-1.5 w-14 rounded-xl">
            <span
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                view === key
                  ? 'ink-chip'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="w-5 h-5" />
            </span>
            <span className={`text-[9px] ${view === key ? 'font-bold text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-400 dark:text-zinc-500'}`}>
              {label}
            </span>
          </button>
        ))}
      </aside>

      {/* 유기체 홈: 히어로는 컨테이너·레일 바깥에서 화면 끝까지 (헤더 뒤까지 -mt-14) */}
      {view === 'home' && <HomeHero series={history?.series ?? null} guideStarted={guideStarted} onNavigate={setView} />}
      <div className="lg:pl-16 pb-20 lg:pb-0">
      <div className="max-w-7xl mx-auto px-3 py-4 sm:px-4 md:px-6 md:py-5 space-y-5">
        {/* 알림 배너 — 오류는 빨강, 안내는 파랑 */}
        {notice && (
          <div
            className={`flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm border-l-4 ${
              notice.kind === 'error'
                ? 'bg-[#fdf1ef] dark:bg-[#231416] border-red-700 dark:border-red-500 text-red-800 dark:text-red-300'
                : 'bg-[#eef4ff] dark:bg-[#16223c] border-[#2962ff] text-zinc-800 dark:text-zinc-100'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="p-1 hover:opacity-70 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 역사·신호 탭 상단: 용어 가이드 진입점 */}
        {(view === 'history' || view === 'now') && (
          <div className="flex justify-end">
            <button
              onClick={() => setView('guide')}
              className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-[#2962ff] dark:hover:text-[#5b8aff]"
            >
              <GraduationCap className="w-3.5 h-3.5" /> 용어가 어렵다면, 가이드북의 경제 공부로
            </button>
          </div>
        )}

        {view === 'home' && <HomeView data={history} error={historyError} strategies={strategies} onNavigate={setView} onRun={() => run(false)} />}

        {view === 'guide' && <GuideView onNavigate={setView} />}

        {view === 'now' && <NowView theme={theme} />}

        {view === 'history' && (
          <HistoryView
            theme={theme}
            onExplore={(startDate, endDate, note, presetStrategies) => {
              if (presetStrategies) {
                // 사용자가 만든 전략 목록을 덮어쓰는 동작 — 명시적 확인
                if (!window.confirm('현재 전략 목록을 역사 자산 프리셋 3종으로 교체합니다. 계속할까요?\n(기존 전략이 필요하면 먼저 상단의 내려받기(↓) 아이콘으로 JSON 백업하세요)')) return
                setStrategies(presetStrategies)
                setRuns(null)
                setBundle(null)
              }
              setShared((p) => ({ ...p, startDate, endDate }))
              setView('backtest')
              setNotice(note, 'info')
              window.scrollTo({ top: 0 })
            }}
          />
        )}

        {view === 'backtest' && (
          <>
        {/* 모바일 워크벤치 위저드 스텝퍼 — lg 미만에서만. 데스크톱은 분할 화면 상시 표시 */}
        <div className="lg:hidden flex items-center gap-2">
          {(
            [
              { n: 1, label: '전략' },
              { n: 2, label: '가정' },
              { n: 3, label: '결과' },
            ] as const
          ).map(({ n, label }, i) => (
            <div key={n} className="contents">
              {i > 0 && <div className={`h-0.5 flex-1 rounded ${wizardStep >= n ? 'bg-[#2962ff]' : 'bg-[#d3d8e3] dark:bg-[#363a45]'}`} />}
              <button onClick={() => setWizardStep(n)} className="flex items-center gap-1.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    wizardStep === n
                      ? 'ink-chip'
                      : wizardStep > n
                        ? 'bg-[#1baf7a] text-white'
                        : 'border-2 border-[#d3d8e3] dark:border-[#363a45] text-zinc-400'
                  }`}
                >
                  {wizardStep > n ? <Check className="w-3.5 h-3.5" /> : n}
                </span>
                <span className={`text-[12px] ${wizardStep === n ? 'font-bold text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {label}
                </span>
              </button>
            </div>
          ))}
        </div>

        {/* 가정 — 데스크톱 상시(전폭), 모바일 ② 단계 */}
        <div className={`${wizardStep === 2 ? 'block' : 'hidden'} lg:block space-y-3`}>
          <div className="lg:hidden">
            <PeriodPresetChips shared={shared} onPick={(start, end) => setShared((p) => ({ ...p, startDate: start, endDate: end }))} />
          </div>
          <SettingsPanel shared={shared} onChange={setShared} />
        </div>

        {/* 워크벤치 분할: 좌 전략 스택 | 우 결과 캔버스 (lg+). 모바일은 위저드 단계별 표시 */}
        <div className="lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-5 lg:items-start space-y-5 lg:space-y-0">
          {/* 전략 — 모바일 ① 단계 */}
          <div className={`${wizardStep === 1 ? 'block' : 'hidden'} lg:block space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">STRATEGIES</span>
                전략 ({strategies.length})
              </h2>
              <button
                onClick={addStrategy}
                className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}
              >
                <Plus className="w-4 h-4" /> 전략 추가
              </button>
            </div>
            <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-1 gap-4">
              {strategies.map((s, idx) => (
                <StrategyCard
                  key={s.id}
                  strategy={s}
                  color={palette[idx % palette.length]}
                  onChange={(updater) => updateStrategy(s.id, updater)}
                  onDuplicate={() => {
                    if (strategies.length >= MAX_STRATEGIES) {
                      setNotice(`전략은 최대 ${MAX_STRATEGIES}개까지 비교할 수 있습니다`)
                      return
                    }
                    setStrategies((prev) => {
                      const i = prev.findIndex((x) => x.id === s.id)
                      const copy: StrategyConfig = JSON.parse(JSON.stringify(s))
                      copy.id = nextId() // 배열 길이 기반 id는 삭제 후 재복제 시 충돌 — UUID 사용
                      copy.name = `${s.name} (복사)`
                      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]
                    })
                  }}
                  onRemove={() => setStrategies((prev) => prev.filter((x) => x.id !== s.id))}
                />
              ))}
            </div>
          </div>

          {/* 결과 캔버스 — 모바일 ③ 단계 */}
          <div className={`${wizardStep === 3 ? 'block' : 'hidden'} lg:block space-y-4 min-w-0`}>
            <div className="hidden lg:block">
              <PeriodPresetChips shared={shared} onPick={(start, end) => setShared((p) => ({ ...p, startDate: start, endDate: end }))} />
            </div>

            {/* 에피스테믹 경고 — 결과 해석 주의는 결과 옆에 */}
            <EpistemicsBanner />

            {runs && bundle && runs.length > 0 ? (
              <>
                {resultsStale && (
                  <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-200/90">
                    설정이 변경되었습니다. 아래 결과(와 보고서)는 <b>이전 설정 기준</b>입니다. "백테스트 실행"을 눌러 갱신하세요.
                  </div>
                )}
                <ResultsSection
                  runs={runs}
                  bundle={bundle}
                  palette={palette}
                  theme={theme}
                  taxEnabled={shared.taxEnabled}
                  onAddOverride={(from, to, monthlyUsd) => {
                    setShared((p) => ({ ...p, contributionOverrides: [...(p.contributionOverrides ?? []), { from, to, monthlyUsd }] }))
                    setNotice(`기간 조정 추가됨: ${from}~${to} 월 $${monthlyUsd.toLocaleString()} — "백테스트 실행"을 누르면 반영됩니다`, 'info')
                  }}
                />
              </>
            ) : (
              <div className="bg-white dark:bg-[#1e222d] rounded-xl border border-dashed border-[#d3d8e3] dark:border-[#363a45] px-6 py-14 flex flex-col items-center gap-3 text-center">
                <BarChart3 className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  아직 결과가 없습니다.
                  <br />
                  전략과 가정을 정한 뒤 실행하면 이 자리에 차트와 지표가 채워집니다.
                </p>
                <button
                  onClick={() => run(false)}
                  disabled={running}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${btnPrimaryCls} disabled:opacity-50`}
                >
                  <Play className="w-4 h-4" /> {running ? '실행 중…' : '백테스트 실행'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 모바일 위저드 하단 내비 */}
        <div className="lg:hidden flex gap-2">
          {wizardStep === 1 && (
            <button onClick={() => setWizardStep(2)} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${btnPrimaryCls}`}>
              다음: 가정 확인
            </button>
          )}
          {wizardStep === 2 && (
            <>
              <button onClick={() => setWizardStep(1)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${btnGhostCls}`}>
                이전: 전략
              </button>
              <button
                onClick={() => run(false)}
                disabled={running}
                className={`flex-[2] py-2.5 rounded-lg text-sm font-semibold ${btnPrimaryCls} disabled:opacity-50`}
              >
                {running ? '실행 중…' : '백테스트 실행'}
              </button>
            </>
          )}
          {wizardStep === 3 && (
            <>
              <button onClick={() => setWizardStep(1)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${btnGhostCls}`}>
                전략 수정
              </button>
              <button onClick={() => setWizardStep(2)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${btnGhostCls}`}>
                가정 수정
              </button>
            </>
          )}
        </div>
          </>
        )}

        {/* 보고서 (PDF) 오버레이 */}
        {showReport && runs && bundle && (
          <ReportView runs={runs} bundle={bundle} shared={shared} onClose={() => setShowReport(false)} />
        )}

        {/* 티커 자동완성 카탈로그 — 장기 히스토리(^GSPC 1927~ 등) 포함 */}
        <datalist id="asset-catalog">
          {ASSET_CATALOG.map((a) => (
            <option key={a.ticker} value={a.ticker}>
              {`${a.label} · ${a.startYear}~ · ${a.group}${a.note ? ' ⚠' : ''}`}
            </option>
          ))}
        </datalist>

        <footer className="text-center text-[11px] font-mono tracking-wide text-zinc-400 dark:text-zinc-600 border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-5 pb-8 space-y-1.5">
          <p>데이터: 야후 파이낸스 일별 종가 · 모든 금액은 미국 달러(USD) 기준이며, 원화 손익과는 다릅니다</p>
          <p>
            © {new Date().getFullYear()} 김현성 (lifescienkhs@naver.com) · All rights reserved — 콘텐츠·코드의 저작권은
            저작자에게 있으며 무단 전재·재배포를 금합니다
          </p>
        </footer>
      </div>
      </div>

      {/* 모바일 하단 탭바 (A안) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 grid grid-cols-5 bg-white dark:bg-[#1e222d] border-t border-[#e0e3eb] dark:border-[#2a2e39]">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => {
              setView(key)
              window.scrollTo({ top: 0 })
            }}
            className={`flex flex-col items-center justify-center gap-0.5 ${
              view === key ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            <Icon className={`w-5 h-5 ${view === key ? '' : ''}`} strokeWidth={view === key ? 2.2 : 1.8} />
            <span className={`text-[9.5px] ${view === key ? 'font-bold' : ''}`}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
