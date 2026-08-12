import { Copy, Trash2 } from 'lucide-react'
import {
  CASH_TICKER,
  type StrategyConfig,
  type AllocationPolicy,
  type RebalanceTrigger,
  type SellMode,
} from '@/core'
import { NumberInput } from './NumberInput'
import { HelpTip } from './HelpTip'
import { cardCls, inputCls, selectCls, labelCls } from './common'

/** 전략 편집 카드 — 슬리브·적립 배분·리밸런싱 규칙 DSL */
export function StrategyCard({
  strategy,
  color,
  onChange,
  onDuplicate,
  onRemove,
}: {
  strategy: StrategyConfig
  color: string
  onChange: (updater: (s: StrategyConfig) => StrategyConfig) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const weightSum = strategy.sleeves.reduce((a, s) => a + s.targetWeight, 0)
  const splitSum = Object.values(strategy.contribution.fixedSplit ?? {}).reduce((a, b) => a + b, 0)
  const needsPeriod =
    strategy.rebalance.trigger === 'periodic' ||
    strategy.rebalance.trigger === 'band_or_periodic' ||
    strategy.rebalance.mode === 'no_sell_except_periodic'
  const needsBand = strategy.rebalance.trigger === 'bands' || strategy.rebalance.trigger === 'band_or_periodic'

  return (
    <div className={`${cardCls} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <input
          value={strategy.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
          className="flex-1 min-w-0 font-semibold text-sm bg-transparent dark:text-zinc-100 border-b border-transparent hover:border-[#cfd5e1] dark:hover:border-[#363a45] focus:border-zinc-600 dark:focus:border-zinc-400 focus:outline-none py-0.5"
        />
        <button onClick={onDuplicate} title="복제" className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={onRemove} title="삭제" className="p-1.5 text-gray-400 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 슬리브 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelCls}>
            자산 배분
            <HelpTip title="자산 배분">
              보유할 자산(티커)과 목표 비중(합계 100%). 입력창에서 자동완성으로 장기 히스토리
              자산(^GSPC 1927~, SPY 1993~ 등)을 고를 수 있습니다. CASH는 현금 보유분(유휴현금
              금리 적용), ^로 시작하면 지수 자체 보유 가정(배당 미포함 주의).
            </HelpTip>
          </span>
          <span className={`text-xs font-mono ${Math.abs(weightSum - 1) > 1e-6 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
            합 {(weightSum * 100).toFixed(0)}%
          </span>
        </div>
        {strategy.sleeves.map((sleeve, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={sleeve.ticker}
              onChange={(e) =>
                onChange((s) => ({
                  ...s,
                  sleeves: s.sleeves.map((x, j) => (j === i ? { ...x, ticker: e.target.value.toUpperCase() } : x)),
                }))
              }
              placeholder="티커 (VOO, BTC-USD, CASH)"
              list="asset-catalog"
              className={`${inputCls} flex-1 font-mono uppercase`}
            />
            <div className="flex items-center gap-1 w-20 flex-shrink-0">
              <NumberInput
                value={Math.round(sleeve.targetWeight * 1000) / 10}
                onChange={(v) =>
                  onChange((s) => ({
                    ...s,
                    sleeves: s.sleeves.map((x, j) => (j === i ? { ...x, targetWeight: v / 100 } : x)),
                  }))
                }
                allowDecimal
                className={`${inputCls} text-right`}
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
            {strategy.contribution.allocation === 'fixed_split' && sleeve.ticker !== CASH_TICKER && (
              <div className="flex items-center gap-1 w-20 flex-shrink-0">
                <NumberInput
                  value={Math.round((strategy.contribution.fixedSplit?.[sleeve.ticker] ?? 0) * 1000) / 10}
                  onChange={(v) =>
                    onChange((s) => ({
                      ...s,
                      contribution: {
                        ...s.contribution,
                        fixedSplit: { ...(s.contribution.fixedSplit ?? {}), [sleeve.ticker]: v / 100 },
                      },
                    }))
                  }
                  allowDecimal
                  className={`${inputCls} text-right`}
                />
                <span className="text-xs text-gray-400">적립%</span>
              </div>
            )}
            <button
              onClick={() => onChange((s) => ({ ...s, sleeves: s.sleeves.filter((_, j) => j !== i) }))}
              className="p-1 text-gray-300 hover:text-red-500 flex-shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {strategy.contribution.allocation === 'fixed_split' && Math.abs(splitSum - 1) > 1e-6 && (
          <p className="text-xs text-red-500">적립 비율 합이 100%가 아닙니다 ({(splitSum * 100).toFixed(0)}%)</p>
        )}
        <button
          onClick={() => onChange((s) => ({ ...s, sleeves: [...s.sleeves, { ticker: '', targetWeight: 0 }] }))}
          className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          + 자산 추가
        </button>
      </div>

      {/* 규칙 DSL */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            적립 배분
            <HelpTip title="적립 배분">
              매달 들어오는 적립금을 어느 자산에 나눠 살지 정하는 규칙.
              <br />· <b>부족한 자산 우선</b>: 목표 비중보다 부족한 자산부터, 부족분에 비례해 채움.
              적립만으로 자연스럽게 리밸런싱 효과
              <br />· <b>목표비중 비례</b>: 현재 상태와 무관하게 항상 목표 비중대로
              <br />· <b>고정 분할</b>: 자산별로 직접 정한 비율대로 (적립% 입력란이 생김)
            </HelpTip>
          </label>
          <select
            value={strategy.contribution.allocation}
            onChange={(e) =>
              onChange((s) => ({ ...s, contribution: { ...s.contribution, allocation: e.target.value as AllocationPolicy } }))
            }
            className={selectCls}
          >
            <option value="to_underweight">부족한 자산 우선</option>
            <option value="pro_rata">목표비중 비례</option>
            <option value="fixed_split">고정 분할</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            리밸런싱 트리거
            <HelpTip title="리밸런싱 트리거" align="right">
              무너진 비중을 언제 목표로 되돌릴지 정하는 조건.
              <br />· <b>없음</b>: 리밸런싱 안 함 (적립 배분만)
              <br />· <b>주기</b>: N개월마다 정기 실행
              <br />· <b>밴드</b>: 비중이 목표 ±X%p를 벗어나는 순간
              <br />· <b>밴드 + 주기</b>: 둘 중 하나라도 충족되면
              <br />잦은 리밸런싱은 매도 → 양도세·비용을 만듭니다. 세후 결과로 비교하세요.
            </HelpTip>
          </label>
          <select
            value={strategy.rebalance.trigger}
            onChange={(e) => onChange((s) => ({ ...s, rebalance: { ...s.rebalance, trigger: e.target.value as RebalanceTrigger } }))}
            className={selectCls}
          >
            <option value="none">없음</option>
            <option value="periodic">주기</option>
            <option value="bands">밴드</option>
            <option value="band_or_periodic">밴드 + 주기</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            매도 정책
            <HelpTip title="매도 정책">
              트리거가 발동했을 때 매도를 허용할지.
              <br />· <b>매도 허용</b>: 초과 자산을 팔아 목표 비중 복원
              <br />· <b>무매도</b>: 절대 팔지 않음. 적립을 미달 자산에 몰아주는 것만으로 조정.
              양도세가 이연되지만, 과대 비중을 오래 못 닫을 수 있음(경고 표시)
              <br />· <b>무매도 + 주기 매도만</b>: 평소엔 무매도, N개월마다만 매도 허용
            </HelpTip>
          </label>
          <select
            value={strategy.rebalance.mode}
            onChange={(e) => onChange((s) => ({ ...s, rebalance: { ...s.rebalance, mode: e.target.value as SellMode } }))}
            className={selectCls}
          >
            <option value="sell_to_target">매도 허용</option>
            <option value="no_sell">무매도</option>
            <option value="no_sell_except_periodic">무매도 + 주기 매도만</option>
          </select>
        </div>
        {needsPeriod && (
          <div className="flex flex-col gap-1">
            <label className={labelCls}>주기 (개월)</label>
            <NumberInput
              value={strategy.rebalance.periodMonths ?? 0}
              onChange={(v) => onChange((s) => ({ ...s, rebalance: { ...s.rebalance, periodMonths: v } }))}
              className={inputCls}
            />
          </div>
        )}
        {needsBand && (
          <div className="flex flex-col gap-1">
            <label className={labelCls}>밴드 폭 (%p)</label>
            <NumberInput
              value={strategy.rebalance.bandAbsPct ?? 0}
              onChange={(v) => onChange((s) => ({ ...s, rebalance: { ...s.rebalance, bandAbsPct: v } }))}
              allowDecimal
              className={inputCls}
            />
          </div>
        )}
      </div>

      {/* 낙폭 대응 규칙 */}
      <div className="space-y-1.5">
        <label className={labelCls}>
          낙폭 대응 규칙
          <HelpTip title="낙폭 대응 규칙">
            지정한 낙폭 이하로 떨어져 있는 동안 적용되는 규칙입니다. 기준은 규칙마다 선택합니다:
            <br />· <b>전고점 대비</b>: 결과 차트의 "누적 수익률" 곡선(적립 타이밍 효과를
            제거한 전략 자체 성과)이 백테스트 구간에서 기록한 역대 최고점에서 −X%.
            최고점은 새 고점이 나올 때마다 갱신됩니다
            <br />· <b>투입원금 대비</b>: 평가액이 지금까지 넣은 돈의 합계(초기+적립 누적)보다
            −X% 아래, 즉 계좌가 원금 대비 물린 정도
            <br />전일 종가에서 관측한 낙폭이 다음 결정부터 반영되고(미래 정보 사용
            없음), 회복하면 자동 해제됩니다. 여러 규칙이 겹치면 가장 깊은 규칙
            하나만 적용됩니다.
            <br />· <b>적립 배수</b>: 발동 중 월 적립금에 곱할 배수 (예: 2 = 두 배)
            <br />· <b>현금 목표 %</b>: 발동 중 현금 목표 비중을 이 값으로 대체
            (빈칸 = 유지). 0이면 현금을 전량 투입하고, 시장 자산 목표는 비례
            확대됩니다. 규칙 발동·해제는 결과의 경고 로그에 기록됩니다.
          </HelpTip>
        </label>
        {(strategy.contribution.rules ?? []).map((r, i) => {
          const upd = (patch: Partial<typeof r>) =>
            onChange((s) => ({
              ...s,
              contribution: { ...s.contribution, rules: (s.contribution.rules ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) },
            }))
          return (
            <div key={i} className="rounded-lg border border-[#e0e3eb] dark:border-[#2a2e39] bg-[#fafbfd] dark:bg-[#171c28] px-2.5 py-2 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={r.basis ?? 'peak'}
                  onChange={(e) => upd({ basis: e.target.value as 'peak' | 'invested' })}
                  className={selectCls}
                  aria-label="낙폭 기준"
                >
                  <option value="peak">전고점 대비</option>
                  <option value="invested">투입원금 대비</option>
                </select>
                <span>−</span>
                <NumberInput value={r.drawdownPct} onChange={(v) => upd({ drawdownPct: v })} allowDecimal className={`${inputCls} !w-14 text-right`} />
                <span>% 도달하면 ↓</span>
                <button
                  onClick={() => onChange((s) => ({ ...s, contribution: { ...s.contribution, rules: (s.contribution.rules ?? []).filter((_, j) => j !== i) } }))}
                  className="ml-auto p-1 text-gray-300 hover:text-red-500"
                  aria-label="규칙 삭제"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap pl-1">
                <span>월 적립 ×</span>
                <NumberInput value={r.contributionMultiplier ?? 1} onChange={(v) => upd({ contributionMultiplier: v })} allowDecimal className={`${inputCls} !w-14 text-right`} />
                <span className="text-zinc-300 dark:text-zinc-600">|</span>
                <span>현금 목표를</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="유지"
                  value={r.cashTargetOverride != null ? Math.round(r.cashTargetOverride * 100) : ''}
                  onChange={(e) => upd({ cashTargetOverride: e.target.value === '' ? undefined : Number(e.target.value) / 100 })}
                  className={`${inputCls} !w-16 text-right`}
                />
                <span>%로 (기본 {Math.round((strategy.sleeves.find((x) => x.ticker === CASH_TICKER)?.targetWeight ?? 0) * 100)}%)</span>
              </div>
            </div>
          )
        })}
        {(strategy.contribution.rules ?? []).length > 0 && (
          <p className="text-[11px] leading-relaxed text-[#2962ff] dark:text-[#5b8aff] bg-[#f4f7ff] dark:bg-[#161d30] rounded-md px-2.5 py-1.5">
            요약: {[...(strategy.contribution.rules ?? [])]
              .sort((a, b) => a.drawdownPct - b.drawdownPct)
              .map((r) => {
                const eff = [
                  r.contributionMultiplier != null && r.contributionMultiplier !== 1 ? `적립 ×${r.contributionMultiplier}` : null,
                  r.cashTargetOverride != null ? `현금 ${Math.round(r.cashTargetOverride * 100)}%` : null,
                ].filter(Boolean).join('·') || '변경 없음'
                return `−${r.drawdownPct}%(${(r.basis ?? 'peak') === 'invested' ? '원금' : '전고점'})부터 ${eff}`
              })
              .join(' → ')}
            {' '}— 겹치면 가장 깊은 단계 하나만 적용되고, 회복하면 기본 설정으로 돌아갑니다. 발동 구간은 결과 차트에 색 음영으로 표시됩니다.
          </p>
        )}
        <button
          onClick={() =>
            onChange((s) => ({
              ...s,
              contribution: { ...s.contribution, rules: [...(s.contribution.rules ?? []), { drawdownPct: 10, contributionMultiplier: 2 }] },
            }))
          }
          className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          + 낙폭 규칙 추가 (예: −10%에서 적립 2배)
        </button>
      </div>
    </div>
  )
}
