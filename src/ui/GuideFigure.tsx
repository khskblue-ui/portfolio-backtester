import { ArrowRight, ArrowDown, ChartNoAxesColumn } from 'lucide-react'
import { nbspShortParens } from './common'

/**
 * 가이드 도해(figure) — 텍스트 겹침이 없는 HTML/CSS 기반 도식 3종.
 * SVG 텍스트 배치를 쓰지 않는 것이 의도: 화면 폭·다크모드와 무관하게 가독성이 유지된다.
 * 데이터는 guideContent/tradingGuide의 본문 수치와 반드시 일치시킬 것 (본문에 없는 수치 금지).
 */

export type FigTone = 'blue' | 'red' | 'green' | 'amber' | 'gray'

export interface FigBar {
  label: string
  /** 막대 길이를 정하는 값 (부호 지원 — 음수는 중앙 기준 왼쪽) */
  value: number
  /** 막대 옆 표기 (생략 시 value 그대로) */
  text?: string
  tone?: FigTone
}

export type GuideFigureData =
  | {
      kind: 'bars'
      title: string
      /** 하단 각주 (가정·출처·읽는 법) */
      note?: string
      bars: FigBar[]
    }
  | {
      kind: 'flow'
      title: string
      note?: string
      steps: { label: string; sub?: string; tone?: FigTone }[]
    }
  | {
      kind: 'quad'
      title: string
      note?: string
      /** 열 제목 2개 (생략 가능) */
      xLabels?: [string, string]
      /** 행 제목 2개 (생략 가능) */
      yLabels?: [string, string]
      /** 좌상→우상→좌하→우하 순 4칸 */
      cells: { title: string; sub?: string; tone?: FigTone }[]
    }

const BAR_FILL: Record<FigTone, string> = {
  blue: 'bg-[#2962ff]',
  red: 'bg-[#e34948]',
  green: 'bg-[#1baf7a]',
  amber: 'bg-[#c98500]',
  gray: 'bg-zinc-400 dark:bg-zinc-500',
}

const CHIP_TONE: Record<FigTone, string> = {
  blue: 'border-[#2962ff]/40 bg-[#2962ff]/5 dark:bg-[#2962ff]/15',
  red: 'border-[#e34948]/40 bg-[#e34948]/5 dark:bg-[#e34948]/15',
  green: 'border-[#1baf7a]/40 bg-[#1baf7a]/5 dark:bg-[#1baf7a]/15',
  amber: 'border-[#c98500]/40 bg-[#c98500]/5 dark:bg-[#c98500]/15',
  gray: 'border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/40',
}

const TITLE_TONE: Record<FigTone, string> = {
  blue: 'text-[#2962ff] dark:text-[#5b8aff]',
  red: 'text-[#e34948]',
  green: 'text-[#0f9d67] dark:text-[#1baf7a]',
  amber: 'text-[#c98500] dark:text-[#e3a008]',
  gray: 'text-zinc-600 dark:text-zinc-300',
}

function Bars({ f }: { f: Extract<GuideFigureData, { kind: 'bars' }> }) {
  const maxAbs = Math.max(...f.bars.map((b) => Math.abs(b.value)), 1e-9)
  const hasNeg = f.bars.some((b) => b.value < 0)
  return (
    <div className="space-y-1.5">
      {f.bars.map((b, i) => {
        const pct = (Math.abs(b.value) / maxAbs) * 100
        const tone = b.tone ?? 'blue'
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-2 gap-y-0.5">
            <div className="text-[11px] leading-tight text-left sm:text-right text-zinc-600 dark:text-zinc-300">{nbspShortParens(b.label)}</div>
            <div className="flex items-center gap-1.5 min-w-0">
              {hasNeg ? (
                <div className="relative h-4 flex-1 rounded bg-[#f3f5f9] dark:bg-[#1e222d] overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-300 dark:bg-zinc-600" />
                  <div
                    className={`absolute inset-y-0 rounded-sm ${BAR_FILL[tone]}`}
                    style={
                      b.value < 0
                        ? { right: '50%', width: `${pct / 2}%` }
                        : { left: '50%', width: `${pct / 2}%` }
                    }
                  />
                </div>
              ) : (
                <div className="h-4 flex-1 rounded bg-[#f3f5f9] dark:bg-[#1e222d] overflow-hidden">
                  <div className={`h-full rounded-sm ${BAR_FILL[tone]}`} style={{ width: `${Math.max(pct, 0.75)}%` }} />
                </div>
              )}
              <div className="text-[11px] font-mono whitespace-nowrap text-zinc-700 dark:text-zinc-200">{b.text ?? String(b.value)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Flow({ f }: { f: Extract<GuideFigureData, { kind: 'flow' }> }) {
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-1.5">
      {f.steps.map((s, i) => {
        const tone = s.tone ?? 'gray'
        return (
          <div key={i} className="contents">
            {i > 0 && (
              <div className="flex justify-center sm:items-center text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                <ArrowDown className="w-3.5 h-3.5 sm:hidden" />
                <ArrowRight className="w-3.5 h-3.5 hidden sm:block" />
              </div>
            )}
            <div className={`rounded-lg border px-2.5 py-1.5 min-w-0 sm:flex-1 ${CHIP_TONE[tone]}`}>
              <div className={`text-[11.5px] font-semibold leading-snug ${TITLE_TONE[tone]}`}>{nbspShortParens(s.label)}</div>
              {s.sub && <div className="text-[10.5px] leading-snug text-zinc-500 dark:text-zinc-400 mt-0.5">{nbspShortParens(s.sub)}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Quad({ f }: { f: Extract<GuideFigureData, { kind: 'quad' }> }) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: f.yLabels ? 'auto 1fr 1fr' : '1fr 1fr' }}
    >
      {f.xLabels && (
        <>
          {f.yLabels && <div />}
          {f.xLabels.map((x, i) => (
            <div key={i} className="text-center text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400 leading-tight">
              {x}
            </div>
          ))}
        </>
      )}
      {[0, 1].map((row) => (
        <div key={row} className="contents">
          {f.yLabels && (
            <div className="flex flex-col justify-center pr-1.5 text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400 leading-tight">
              {f.yLabels[row].split(/ (?=\()/).map((piece, i) => (
                <span key={i} className="whitespace-nowrap">
                  {piece}
                </span>
              ))}
            </div>
          )}
          {[0, 1].map((col) => {
            const c = f.cells[row * 2 + col]
            const tone = c.tone ?? 'gray'
            return (
              <div key={col} className={`rounded-lg border px-2.5 py-2 ${CHIP_TONE[tone]}`}>
                <div className={`text-[11.5px] font-semibold leading-snug ${TITLE_TONE[tone]}`}>{nbspShortParens(c.title)}</div>
                {c.sub && <div className="text-[10.5px] leading-snug text-zinc-500 dark:text-zinc-400 mt-0.5">{nbspShortParens(c.sub)}</div>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 도해 블록 — 제목 헤더 + 본문 + 각주 */
export function GuideFigureBlock({ f }: { f: GuideFigureData }) {
  return (
    <figure className="rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-white dark:bg-[#131722] px-3.5 py-3 space-y-2.5">
      <figcaption className="flex items-start gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 leading-snug">
        <ChartNoAxesColumn className="w-3.5 h-3.5 text-[#2962ff] flex-shrink-0" /> <span>{nbspShortParens(f.title, 20)}</span>
      </figcaption>
      {f.kind === 'bars' && <Bars f={f} />}
      {f.kind === 'flow' && <Flow f={f} />}
      {f.kind === 'quad' && <Quad f={f} />}
      {f.note && <p className="text-[10.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">{nbspShortParens(f.note)}</p>}
    </figure>
  )
}
