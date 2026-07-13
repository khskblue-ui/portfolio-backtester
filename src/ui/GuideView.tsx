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
const ALL_CHAPTERS = PARTS.flatMap((p) => p.chapters)

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
  const [activeId, setActiveId] = useState<string>('')

  // 스크롤 위치에 따라 목차 현재 위치 하이라이트
  useEffect(() => {
    const ids = ALL_CHAPTERS.flatMap((c) => [c.id, ...c.sections.map((s) => s.id)]).concat('glossary')
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
  }, [])

  const jump = (id: string) => {
    setActiveId(id) // 스무스 스크롤 중 중간 절들로 하이라이트가 튀는 것 방지
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const totalMin = ALL_CHAPTERS.reduce((a, c) => a + c.minutes, 0)

  return (
    <div className="lg:grid lg:grid-cols-[225px_minmax(0,1fr)] lg:gap-5 lg:items-start">
      {/* 목차 — 데스크톱 좌측 고정 */}
      <nav className={`${cardCls} hidden lg:block sticky top-[72px] p-4 text-[12px]`}>
        <div className="text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500 mb-2">CONTENTS</div>
        <ul className="space-y-1">
          {PARTS.map((part) => (
            <li key={part.label}>
              <div className="text-[9px] font-mono tracking-[0.18em] text-zinc-400 dark:text-zinc-500 mt-2 mb-1">{part.label}</div>
              <ul className="space-y-1">
          {part.chapters.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => jump(c.id)}
                className={`text-left w-full font-semibold py-0.5 ${
                  activeId === c.id || c.sections.some((s) => s.id === activeId)
                    ? 'text-[#2962ff] dark:text-[#5b8aff]'
                    : 'text-zinc-700 dark:text-zinc-300 hover:text-[#2962ff]'
                }`}
              >
                {c.toc ?? `${c.step}. ${c.title}`}
              </button>
              <ul className="mt-0.5 mb-1.5 space-y-0.5 border-l border-[#e0e3eb] dark:border-[#2a2e39] ml-1 pl-2.5">
                {c.sections.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => jump(s.id)}
                      className={`text-left w-full text-[11.5px] py-0.5 leading-snug ${
                        activeId === s.id ? 'text-[#2962ff] dark:text-[#5b8aff] font-medium' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
              </ul>
            </li>
          ))}
          <li>
            <button
              onClick={() => jump('glossary')}
              className={`text-left w-full font-semibold py-0.5 ${activeId === 'glossary' ? 'text-[#2962ff] dark:text-[#5b8aff]' : 'text-zinc-700 dark:text-zinc-300 hover:text-[#2962ff]'}`}
            >
              부록. 용어 사전
            </button>
          </li>
        </ul>
      </nav>

      <div className="space-y-5 min-w-0">
        {/* 인트로 */}
        <div className={`${cardCls} p-4 sm:p-5`}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
              GUIDE · MACRO BASICS · 총 {totalMin}분
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
          {/* 단계 점프 칩 (모바일 목차 겸용) */}
          <div className="mt-3 flex flex-wrap gap-2">
            {ALL_CHAPTERS.map((c) => (
              <button
                key={c.id}
                onClick={() => jump(c.id)}
                className="text-[11.5px] px-2.5 py-1.5 rounded-full border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] text-zinc-600 dark:text-zinc-300 hover:border-[#2962ff] hover:text-[#2962ff]"
              >
                {(c.toc ?? `${c.step}. ${c.title.split(' — ')[0]}`)} · {c.minutes}분
              </button>
            ))}
            <button
              onClick={() => jump('glossary')}
              className="text-[11.5px] px-2.5 py-1.5 rounded-full border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] text-zinc-600 dark:text-zinc-300 hover:border-[#2962ff] hover:text-[#2962ff]"
            >
              용어 사전
            </button>
          </div>
        </div>

        {/* 파트·단계별 본문 */}
        {ALL_CHAPTERS.map((c) => (
          <div key={c.id} id={c.id} className={`${cardCls} p-4 sm:p-5 scroll-mt-24`}>
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

        {/* 용어 사전 */}
        <div id="glossary" className={`${cardCls} p-4 sm:p-5 scroll-mt-24`}>
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

        {/* 다음 단계 CTA */}
        <div className={`${cardCls} p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-[13px] text-zinc-600 dark:text-zinc-300">
            준비됐다면 — 배운 눈으로 두 탭의 문장을 직접 읽어 보세요.
          </p>
          <div className="flex gap-2">
            <button onClick={() => onNavigate('history')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}>
              <Landmark className="w-4 h-4" /> 역사 연구 탭
            </button>
            <button onClick={() => onNavigate('now')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${btnGhostCls}`}>
              <Activity className="w-4 h-4" /> 현재 신호 탭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
