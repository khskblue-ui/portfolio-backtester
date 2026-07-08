import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Play, RefreshCw, Sun, Moon, Download, Upload, TrendingUp, X, FileText, BarChart3, Landmark } from 'lucide-react'
import {
  loadDataBundle,
  runComparison,
  validateStrategy,
  defaultStrategies,
  emptyStrategy,
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

type Theme = 'light' | 'dark'

/** 내보내기/가져오기 파일 스키마 */
interface ConfigFile {
  version: 1
  shared: SharedSettings
  strategies: StrategyConfig[]
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
  const [notice, setNotice] = useState<string | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [view, setView] = useState<'backtest' | 'history'>('backtest')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateStrategy = (id: string, updater: (s: StrategyConfig) => StrategyConfig) =>
    setStrategies((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))

  const run = async (forceRefresh = false) => {
    setNotice(null)
    if (strategies.length === 0) {
      setNotice('전략이 없습니다 — 전략을 추가하세요')
      return
    }
    if (shared.startDate && shared.endDate && shared.endDate <= shared.startDate) {
      setNotice('종료일이 시작일보다 빠릅니다 — 날짜를 확인하세요')
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
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '백테스트 실패')
    } finally {
      setRunning(false)
    }
  }

  const addStrategy = () => {
    if (strategies.length >= MAX_STRATEGIES) {
      setNotice(`전략은 최대 ${MAX_STRATEGIES}개까지 (팔레트 순서 고정)`)
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
      setShared({ ...defaultSharedSettings(), ...parsed.shared })
      setStrategies(parsed.strategies)
      setRuns(null)
      setBundle(null)
      setNotice(null)
    } catch {
      setNotice('설정 파일을 읽을 수 없습니다 (JSON 파싱 실패)')
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f5] dark:bg-[#131722] text-zinc-900 dark:text-zinc-100">
      {/* 상단 고정 헤더 바 — 화이트 서피스, 타이틀·액션·뷰 내비게이션 */}
      <header className="sticky top-0 z-40 bg-white dark:bg-[#1e222d] border-b border-[#e0e3eb] dark:border-[#2a2e39]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 ink-chip rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4.5 h-4.5" strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold leading-tight tracking-tight">포트폴리오 백테스터</h1>
                <p className="hidden sm:block text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight">
                  적립·리밸런싱 시뮬레이션 · 한국 세제 · 1871~ 역사 데이터
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title="테마 전환"
                className={`p-2 rounded-md ${btnGhostCls}`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium ${btnGhostCls}`}
              >
                <FileText className="w-4 h-4" /> <span className="hidden lg:inline">보고서</span>
              </button>
              <button
                onClick={exportConfig}
                title="전략·설정을 JSON 파일로 백업"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium ${btnGhostCls}`}
              >
                <Download className="w-4 h-4" /> <span className="hidden lg:inline">설정 저장</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="백업한 설정 JSON 불러오기"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium ${btnGhostCls}`}
              >
                <Upload className="w-4 h-4" /> <span className="hidden lg:inline">불러오기</span>
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
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm font-medium ${btnGhostCls} disabled:opacity-50`}
              >
                <RefreshCw className="w-4 h-4" /> <span className="hidden lg:inline">새로고침</span>
              </button>
              <button
                onClick={() => run(false)}
                disabled={running}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold ${btnPrimaryCls} disabled:opacity-50`}
              >
                <Play className="w-4 h-4" />
                {running ? '실행 중…' : '백테스트 실행'}
              </button>
            </div>
          </div>

          {/* 뷰 내비게이션 — 세그먼트 탭 (활성 = 프라이머리 블루) */}
          <nav className="flex gap-1.5 pb-2.5 overflow-x-auto">
            {(
              [
                { key: 'backtest', label: '백테스트', desc: '전략 시뮬레이션', Icon: BarChart3 },
                { key: 'history', label: '역사 연구', desc: '1900~ 약세 구간 · 매크로', Icon: Landmark },
              ] as const
            ).map(({ key, label, desc, Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-2 pl-3 pr-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  view === key
                    ? 'bg-[#2962ff] text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] border border-[#e0e3eb] dark:border-[#2a2e39]'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="text-left leading-tight">
                  {label}
                  <span className={`block text-[10px] font-normal ${view === key ? 'text-white/75' : 'text-zinc-400 dark:text-zinc-500'}`}>
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 py-4 sm:px-4 md:px-6 md:py-5 space-y-5">
        {/* 알림 배너 */}
        {notice && (
          <div className="flex items-center justify-between gap-2 bg-[#fdf1ef] dark:bg-[#231416] border-l-4 border-red-700 dark:border-red-500 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-300">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="p-1 hover:opacity-70 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {view === 'history' && (
          <HistoryView
            theme={theme}
            onExplore={(startDate, endDate, note, presetStrategies) => {
              if (presetStrategies) {
                // 사용자가 만든 전략 목록을 덮어쓰는 동작 — 명시적 확인
                if (!window.confirm('현재 전략 목록을 역사 자산 프리셋 3종으로 교체합니다. 계속할까요?\n(기존 전략이 필요하면 먼저 "설정 저장"으로 백업하세요)')) return
                setStrategies(presetStrategies)
                setRuns(null)
                setBundle(null)
              }
              setShared((p) => ({ ...p, startDate, endDate }))
              setView('backtest')
              setNotice(note)
              window.scrollTo({ top: 0 })
            }}
          />
        )}

        {view === 'backtest' && (
          <>
        <EpistemicsBanner />

        <SettingsPanel shared={shared} onChange={setShared} />

        {/* 전략 목록 */}
        <div className="space-y-4">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {strategies.map((s, idx) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                color={palette[idx % palette.length]}
                onChange={(updater) => updateStrategy(s.id, updater)}
                onDuplicate={() => {
                  if (strategies.length >= MAX_STRATEGIES) {
                    setNotice(`전략은 최대 ${MAX_STRATEGIES}개까지 (팔레트 순서 고정)`)
                    return
                  }
                  setStrategies((prev) => {
                    const i = prev.findIndex((x) => x.id === s.id)
                    const copy: StrategyConfig = JSON.parse(JSON.stringify(s))
                    copy.id = `${s.id}-copy-${prev.length}`
                    copy.name = `${s.name} (복사)`
                    return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]
                  })
                }}
                onRemove={() => setStrategies((prev) => prev.filter((x) => x.id !== s.id))}
              />
            ))}
          </div>
        </div>

        {/* 결과 */}
        {runs && bundle && runs.length > 0 && (
          <ResultsSection runs={runs} bundle={bundle} palette={palette} theme={theme} taxEnabled={shared.taxEnabled} />
        )}
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

        <footer className="text-center text-[11px] font-mono tracking-wide text-zinc-400 dark:text-zinc-600 border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-5 pb-8">
          데이터: Yahoo Finance (일별 EOD) · 모든 금액 USD · 결과는 원화 실현손익이 아닙니다
        </footer>
      </div>
    </div>
  )
}
