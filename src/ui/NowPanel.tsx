import { useState } from 'react'
import { ChevronDown, ChevronUp, Activity } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { cardCls } from './common'
import type { NowAssessment, SignalLevel } from './nowSignals'

/**
 * "지금은?" 패널 — 최신 데이터 월을 역사 구간들의 선행조건과 대조한 체크리스트.
 * 판정 로직·임계값 근거는 nowSignals.ts (순수 함수, 테스트 포함).
 */

const LEVEL_STYLE: Record<SignalLevel, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: '양호' },
  watch: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: '주의' },
  alert: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: '경계' },
}

export function NowPanel({ assessment }: { assessment: NowAssessment }) {
  const [open, setOpen] = useState(true)
  const a = assessment

  return (
    <div className={`${cardCls} p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
            NOW · SIGNAL CHECK · {a.live ? '라이브 결합 · 기준일은 카드별 표기' : `번들 기준 ${a.asOf}`}
          </span>
          <span className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-[#2962ff]" />
            지금은? — {a.headline}
            <HelpTip title="이 판정을 읽는 법">
              아래 5개 신호는 <b>역사 7개 하락 구간이 시작될 때 실측된 조건</b>(임계값의 출처)과
              지금을 같은 잣대로 비교한 체크리스트입니다. 예측이 아닙니다 — 선행조건 충족은
              "하락이 곧 온다"가 아니라 "만약 온다면 깊고 길 수 있는 출발점"이라는 뜻입니다.
              데이터는 이 앱의 검증된 번들(FRED·Shiller·야후 교차 검증)에서 매 갱신 시 자동
              재계산됩니다.
            </HelpTip>
          </span>
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1.5 rounded-md text-zinc-400 hover:bg-[#edf1f7] dark:hover:bg-[#2a2e39] hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0"
          aria-label={open ? '접기' : '펼치기'}
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {a.analog && (
        <p className="mt-1 text-xs font-medium text-[#2962ff] dark:text-[#5b8aff]">가장 닮은 역사 조합: {a.analog}</p>
      )}

      {open && (
        <>
          {/* 신호 카드 */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2.5">
            {a.signals.map((s) => {
              const st = LEVEL_STYLE[s.level]
              return (
                <div key={s.key} className="rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] p-3 bg-[#fafbfd] dark:bg-[#171c28]">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">{s.label}</span>
                    <span className={`flex items-center gap-1 text-[10px] font-semibold flex-shrink-0 ${st.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">{s.value}</div>
                  <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">기준 {s.asOf}</div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{s.reason}</p>
                </div>
              )
            })}
          </div>

          {/* 종합 근거 */}
          <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{a.rationale}</p>
        </>
      )}
    </div>
  )
}
