import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Play, RefreshCw, Sun, Moon, Download, Upload, TrendingUp, X, FileText, BarChart3, Landmark, Activity, GraduationCap } from 'lucide-react'
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
  // 실행 시점의 설정 시그니처 — 이후 설정이 바뀌면 결과에 "스테일" 배지 표시
  const [ranSignature, setRanSignature] = useState<string | null>(null)
  // 알림: 오류(빨강)와 안내(파랑)를 구분 — 성공 안내가 실패처럼 보이지 않게
  const [notice, setNoticeState] = useState<{ text: string; kind: 'error' | 'info' } | null>(null)
  const setNotice = (text: string | null, kind: 'error' | 'info' = 'error') =>
    setNoticeState(text == null ? null : { text, kind })
  const [showReport, setShowReport] = useState(false)
  const [view, setView] = useState<'backtest' | 'history' | 'now' | 'guide'>('backtest')
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
      setRanSignature(JSON.stringify({ shared, strategies }))
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
      <header className="sticky top-0 z-40 bg-white dark:bg-[#1e222d] border-b border-[#e0e3eb] dark:border-[#2a2e39]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 flex items-center justify-between flex-wrap gap-x-4 gap-y-1 min-h-14 py-1.5">
          <div className="flex items-center gap-3 sm:gap-7 min-w-0">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 ink-chip rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4" strokeWidth={2.5} />
              </div>
              {/* 좁은 화면에선 내비 공간 확보를 위해 로고 텍스트 생략 */}
              <h1 className="max-[479px]:hidden text-[15px] sm:text-base font-bold tracking-tight whitespace-nowrap">포트폴리오 백테스터</h1>
            </div>
            <nav className="flex items-center gap-3 sm:gap-6 overflow-x-auto">
              {(
                [
                  { key: 'backtest', label: '백테스트', Icon: BarChart3 },
                  { key: 'history', label: '역사 연구', Icon: Landmark },
                  { key: 'now', label: '현재 신호', Icon: Activity },
                  { key: 'guide', label: '기초 가이드', Icon: GraduationCap },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`flex items-center gap-1.5 py-2 text-[13.5px] min-[480px]:text-[15px] whitespace-nowrap transition-colors ${
                    view === key
                      ? 'font-bold text-zinc-900 dark:text-white'
                      : 'font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <Icon className={`hidden min-[480px]:block w-4 h-4 ${view === key ? 'text-[#2962ff]' : ''}`} />
                  {label}
                </button>
              ))}
            </nav>
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
              <GraduationCap className="w-3.5 h-3.5" /> 용어가 어렵다면 — 기초 가이드 (실질·TIPS·CAPE 등 4단계 학습)
            </button>
          </div>
        )}

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

        {/* 에피스테믹 경고 — 전략 설정 아래, 결과 위 */}
        <EpistemicsBanner />

        {/* 결과 */}
        {runs && bundle && runs.length > 0 && (
          <>
            {resultsStale && (
              <div className="bg-[#faf4e0] dark:bg-[#1d1a10] border-l-4 border-amber-700 dark:border-amber-500 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-200/90">
                설정이 변경되었습니다 — 아래 결과(와 보고서)는 <b>이전 설정 기준</b>입니다. "백테스트 실행"을 눌러 갱신하세요.
              </div>
            )}
            <ResultsSection runs={runs} bundle={bundle} palette={palette} theme={theme} taxEnabled={shared.taxEnabled} />
          </>
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
