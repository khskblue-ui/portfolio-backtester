import { useEffect, useState } from 'react'
import { GraduationCap, Landmark, Activity, Lightbulb, AlertTriangle, Quote, ArrowUpRight } from 'lucide-react'
import { cardCls, btnGhostCls } from './common'
import { GUIDE_INTRO, GUIDE_CHAPTERS, GUIDE_GLOSSARY, type GuideChapter, type GuideSection } from './guideContent'
import { TRADING_GUIDE_CHAPTERS } from './tradingGuide'

/** 탭의 2부 구성 — 1부 지침서(최상단), 2부 개념 4단계 */
const PARTS: { label: string; chapters: GuideChapter[] }[] = [
  { label: '1부 · 매매 습관 교정 지침서', chapters: TRADING_GUIDE_CHAPTERS },
  { label: '2부 · 개념 4단계', chapters: GUIDE_CHAPTERS },
]

/**
 * 기초 가이드 탭 — 콘텐츠는 guideContent.ts (설계 원칙도 그쪽 헤더 참조).
 * 좌측 고정 목차(데스크톱) + 본문. 각 절은 앵커로 점프 가능, 용어 사전에서 역링크.
 */

/** **굵게** 미니 렌더러 — 콘텐츠 파일을 데이터로 유지하기 위한 최소 마크업 */
function rich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-semibold text-zinc-800 dark:text-zinc-100">
        {part}
      </b>
    ) : (
      part
    ),
  )
}

const SOURCE_CHIP: Record<string, { icon: typeof Landmark; cls: string }> = {
  '역사 연구': { icon: Landmark, cls: 'text-[#7c3aed] dark:text-[#a78bfa] border-[#7c3aed]/30 dark:border-[#a78bfa]/30' },
  '현재 신호': { icon: Activity, cls: 'text-[#2962ff] dark:text-[#5b8aff] border-[#2962ff]/30 dark:border-[#5b8aff]/30' },
}

/** 연속된 '• ' 문단을 하나의 목록 블록으로 묶는다 (가독성 — 긴 나열은 줄로 쪼갬) */
function groupParas(paras: string[]): (string | string[])[] {
  const out: (string | string[])[] = []
  for (const p of paras) {
    if (p.startsWith('• ')) {
      const last = out[out.length - 1]
      if (Array.isArray(last)) last.push(p.slice(2))
      else out.push([p.slice(2)])
    } else out.push(p)
  }
  return out
}

function Section({ s }: { s: GuideSection }) {
  return (
    <section id={s.id} className="scroll-mt-24 space-y-2.5">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</h4>
      {groupParas(s.paras).map((p, i) =>
        Array.isArray(p) ? (
          <ul key={i} className="space-y-1.5 pl-1">
            {p.map((item, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#2962ff]/50 flex-shrink-0" />
                <span>{rich(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {rich(p)}
          </p>
        ),
      )}

      {s.analogy && (
        <div className="rounded-lg border-l-4 border-[#2962ff] bg-[#f4f7ff] dark:bg-[#161d30] px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2962ff] dark:text-[#5b8aff]">
            <Lightbulb className="w-3.5 h-3.5" /> 비유로 이해하기
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{rich(s.analogy)}</p>
        </div>
      )}

      {s.quotes?.map((q, i) => {
        const chip = SOURCE_CHIP[q.source]
        const Icon = chip.icon
        return (
          <div key={i} className="rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              <Quote className="w-3.5 h-3.5" /> 앱 문장 독해
              <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.cls}`}>
                <Icon className="w-3 h-3" /> {q.source} 탭
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-700 dark:text-zinc-200 border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 italic">
              “{q.quote}”
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{rich(q.reading)}</p>
          </div>
        )
      })}

      {s.table && (
        <div className="overflow-x-auto rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39]">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#f3f5f9] dark:bg-[#171c28]">
                {s.table.header.map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((row, i) => (
                <tr key={i} className="border-t border-[#e0e3eb] dark:border-[#2a2e39]">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-1.5 text-zinc-600 dark:text-zinc-300 ${j > 0 ? 'font-mono' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.form && (
        <pre className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 bg-[#fafbfd] dark:bg-[#171c28] px-3.5 py-3 text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
          {s.form}
        </pre>
      )}

      {s.pitfall && (
        <div className="rounded-lg border-l-4 border-amber-600 dark:border-amber-500 bg-[#fdf8ec] dark:bg-[#1f1a0e] px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" /> 흔한 오해
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">{rich(s.pitfall)}</p>
        </div>
      )}
    </section>
  )
}

export function GuideView({ onNavigate }: { onNavigate: (view: 'history' | 'now') => void }) {
  // 파트 세그먼트 — 성격이 다른 두 콘텐츠(코스형 지침서 / 레퍼런스형 개념)를 화면 단위로 분리
  const [part, setPart] = useState(0)
  const [activeId, setActiveId] = useState<string>('')
  const chapters = PARTS[part].chapters

  // 스크롤 위치에 따라 목차 현재 위치 하이라이트 (파트 전환 시 재구독)
  useEffect(() => {
    const ids = chapters.flatMap((c) => [c.id, ...c.sections.map((s) => s.id)]).concat(part === 1 ? ['glossary'] : [])
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-72px 0px -60% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [part, chapters])

  const jump = (id: string) => {
    setActiveId(id) // 스무스 스크롤 중 중간 절들로 하이라이트가 튀는 것 방지
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const switchPart = (i: number) => {
    if (i === part) return
    setPart(i)
    setActiveId('')
    window.scrollTo({ top: 0 })
  }

  // 아코디언: 현재 읽는 챕터(스크롤 위치 기준)만 하위 절을 펼침
  const activeChapterId = chapters.find((c) => c.id === activeId || c.sections.some((s) => s.id === activeId))?.id ?? chapters[0]?.id

  return (
    <div className="space-y-4">
      {/* 파트 세그먼트 */}
      <div className={`${cardCls} p-1.5 flex gap-1.5 sticky top-[60px] z-30`}>
        {PARTS.map((pt, i) => (
          <button
            key={pt.label}
            onClick={() => switchPart(i)}
            className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              part === i
                ? 'bg-[#2962ff] text-white'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            {pt.label}
            <span className={`ml-1.5 text-[11px] font-normal ${part === i ? 'text-white/70' : 'text-zinc-400'}`}>
              {pt.chapters.reduce((a, c) => a + c.minutes, 0)}분
            </span>
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[225px_minmax(0,1fr)] lg:gap-5 lg:items-start">
        {/* 목차 — 데스크톱 좌측 고정, 자체 스크롤, 현재 챕터만 하위 절 펼침(아코디언) */}
        <nav className={`${cardCls} hidden lg:block sticky top-[128px] p-4 text-[12px] max-h-[calc(100vh-148px)] overflow-y-auto`}>
          <div className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500 mb-2">
            CONTENTS · {PARTS[part].label}
          </div>
          <ul className="space-y-0.5">
            {chapters.map((c) => {
              const open = c.id === activeChapterId
              const chActive = activeId === c.id || c.sections.some((sec) => sec.id === activeId)
              return (
                <li key={c.id}>
                  <button
                    onClick={() => jump(c.id)}
                    className={`text-left w-full font-semibold py-1 leading-snug ${
                      chActive ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-700 dark:text-zinc-300 hover:text-[#2962ff]'
                    }`}
                  >
                    {c.toc ?? `${c.step}. ${c.title}`}
                  </button>
                  {open && c.sections.length > 1 && (
                    <ul className="mt-0.5 mb-1.5 space-y-0.5 border-l border-[#e0e3eb] dark:border-[#2a2e39] ml-1 pl-2.5">
                      {c.sections.map((sec) => (
                        <li key={sec.id}>
                          <button
                            onClick={() => jump(sec.id)}
                            className={`text-left w-full text-[11.5px] py-0.5 leading-snug ${
                              activeId === sec.id
                                ? 'text-[#2962ff] dark:text-[#5b8aff] font-medium'
                                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                          >
                            {sec.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
            {part === 1 && (
              <li>
                <button
                  onClick={() => jump('glossary')}
                  className={`text-left w-full font-semibold py-1 ${
                    activeId === 'glossary' ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-700 dark:text-zinc-300 hover:text-[#2962ff]'
                  }`}
                >
                  부록. 용어 사전
                </button>
              </li>
            )}
          </ul>
          {/* 다른 파트로 가는 상시 진입점 — "2부가 안 보인다" 방지 */}
          <button
            onClick={() => switchPart(part === 0 ? 1 : 0)}
            className="mt-3 w-full text-left text-[11px] text-zinc-400 hover:text-[#2962ff] border-t border-[#e0e3eb] dark:border-[#2a2e39] pt-2"
          >
            → {PARTS[part === 0 ? 1 : 0].label} 보기
          </button>
        </nav>

        <div className="space-y-5 min-w-0">
          {/* 인트로 — 첫 파트에서만 (두 파트 공통 안내) */}
          {part === 0 && (
            <div className={`${cardCls} p-4 sm:p-5`}>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                  GUIDE · 1부 80분 + 2부 45분
                </span>
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-[#2962ff]" />
                  {GUIDE_INTRO.title}
                </span>
              </h2>
              <div className="mt-2.5 space-y-2">
                {GUIDE_INTRO.paras.map((p, i) => (
                  <p key={i} className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {rich(p)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* 현재 파트 챕터 점프 칩 (모바일 목차 겸용) */}
          <div className="flex flex-wrap gap-2">
            {chapters.map((c) => (
              <button
                key={c.id}
                onClick={() => jump(c.id)}
                className="text-[11.5px] px-2.5 py-1.5 rounded-full border border-[#e0e3eb] dark:border-[#2a2e39] bg-white dark:bg-[#171c28] text-zinc-600 dark:text-zinc-300 hover:border-[#2962ff] hover:text-[#2962ff]"
              >
                {(c.toc ?? `${c.step}. ${c.title.split(' — ')[0]}`).split(' — ')[0]} · {c.minutes}분
              </button>
            ))}
            {part === 1 && (
              <button
                onClick={() => jump('glossary')}
                className="text-[11.5px] px-2.5 py-1.5 rounded-full border border-[#e0e3eb] dark:border-[#2a2e39] bg-white dark:bg-[#171c28] text-zinc-600 dark:text-zinc-300 hover:border-[#2962ff] hover:text-[#2962ff]"
              >
                용어 사전
              </button>
            )}
          </div>

          {/* 챕터 본문 */}
          {chapters.map((c) => (
            <div key={c.id} id={c.id} className={`${cardCls} p-4 sm:p-5 scroll-mt-32`}>
              <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                  {c.kicker ?? `STEP ${c.step}`} · 약 {c.minutes}분
                </span>
                {c.title}
              </h3>
              <p className="mt-1 text-[12px] text-[#2962ff] dark:text-[#5b8aff]">{c.goal}</p>
              <div className="mt-4 space-y-6">
                {c.sections.map((s) => (
                  <Section key={s.id} s={s} />
                ))}
              </div>
            </div>
          ))}

          {/* 용어 사전 — 개념 파트에서만 */}
          {part === 1 && (
            <div id="glossary" className={`${cardCls} p-4 sm:p-5 scroll-mt-32`}>
              <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">APPENDIX · GLOSSARY</span>
                용어 사전 — 막힐 때 찾아보기
              </h3>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {GUIDE_GLOSSARY.map((g) => (
                  <button
                    key={g.term}
                    onClick={() => jump(g.sectionId)}
                    className="text-left rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] p-3 hover:border-[#2962ff] group"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100">{g.term}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover:text-[#2962ff] flex-shrink-0" />
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{g.def}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 파트 말미 — 다음 동선 */}
          <div className={`${cardCls} p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3`}>
            <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
              {part === 0 ? '지침서를 마쳤다면 — 앱의 용어와 지표를 읽는 법(2부)으로.' : '준비됐다면 — 배운 눈으로 두 탭의 문장을 직접 읽어 보세요.'}
            </p>
            <div className="flex gap-2 flex-wrap">
              {part === 0 ? (
                <button onClick={() => switchPart(1)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}>
                  <GraduationCap className="w-4 h-4" /> 2부 개념 4단계로
                </button>
              ) : (
                <>
                  <button onClick={() => onNavigate('history')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}>
                    <Landmark className="w-4 h-4" /> 역사 연구 탭
                  </button>
                  <button onClick={() => onNavigate('now')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}>
                    <Activity className="w-4 h-4" /> 현재 신호 탭
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
