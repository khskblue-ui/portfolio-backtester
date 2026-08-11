import type { ReactNode } from 'react'
import { NumberInput } from './NumberInput'
import { HelpTip } from './HelpTip'
import { cardCls, inputCls, labelCls, type SharedSettings } from './common'

/** 공통 설정 패널 — 납입·비용·세금 가정을 전 전략에 동일 적용 */
export function SettingsPanel({
  shared,
  onChange,
}: {
  shared: SharedSettings
  onChange: (updater: (prev: SharedSettings) => SharedSettings) => void
}) {
  const num = (key: keyof SharedSettings, label: string, allowDecimal = false, help?: ReactNode) => (
    <div className="flex flex-col gap-1">
      <label className={labelCls}>
        {label}
        {help && <HelpTip title={label}>{help}</HelpTip>}
      </label>
      <NumberInput
        value={shared[key] as number}
        onChange={(v) => onChange((p) => ({ ...p, [key]: v }))}
        allowDecimal={allowDecimal}
        className={inputCls}
      />
    </div>
  )

  return (
    <div className={`${cardCls} p-5 space-y-4`}>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        <span className="block text-[9px] font-mono tracking-[0.22em] text-zinc-400 dark:text-zinc-500">ASSUMPTIONS</span>
        공통 설정 <span className="text-xs font-normal text-zinc-400">— 모든 전략에 동일 적용 (공정 비교)</span>
      </h2>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {num('initialUsd', '초기 투자금 (USD)', false, '시작 시점에 한 번에 넣는 금액. 첫 거래일 종가에 유입돼 다음 거래일 시가로 매수됩니다.')}
        {num('monthlyUsd', '월 적립금 (USD)', false, '매월 첫 거래일에 들어오는 적립금. 각 전략의 "적립 배분" 규칙대로 매수됩니다.')}
        {num('feeBps', '수수료 (bps)', true, '거래대금 대비 매매 수수료. 1bp = 0.01% (예: 7bps = 0.07%, 해외주식 온라인 수수료 수준). 매수·매도 모두 부과.')}
        {num('spreadBps', '슬리피지 (bps)', true, '호가 스프레드·체결 미끄러짐 근사. 매수는 비싸게, 매도는 싸게 체결된다고 가정 (거래 규모 무관 고정 bps 근사).')}
        {num('cashYieldPct', '유휴현금 금리 (%/년)', true, '투자되지 않은 현금이 버는 이자 (SGOV·단기국채·파킹 근사). 고금리 국면에서 이걸 빼먹으면 현금 비중 전략의 수익이 과소평가됩니다.')}
        {num('assumedUsdKrw', '가정 환율 (₩/$, 세금 근사용)', false, '양도세 250만원 공제·금융소득 2,000만원 임계를 USD 손익에 적용하기 위한 고정 환율 가정. 실제 세금은 거래일 환율 기준이라 근사입니다.')}
        {num('marginalRatePct', '가정 한계세율 (%)', true, '금융소득 종합과세(연 2,000만원 초과) 시 적용될 본인의 종합소득 한계세율 가정. 초과 배당에 (한계세율 − 원천 15%)를 추가 과세하는 근사.')}
        {num('otherFinancialIncomeKrw', '기타 금융소득 (₩/년)', false, '이 포트폴리오 밖에서 발생하는 연간 이자·배당 소득. 종합과세 임계(2,000만원) 판정에 합산됩니다.')}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            시작일 (빈칸 = 자동)
            <HelpTip title="시작일">
              비교 시작 날짜. 비워두면 선택한 자산들이 모두 데이터를 가진 가장 이른
              날부터 시작합니다. 자산 중 하나라도 이 날짜에 데이터가 없으면 그
              자산의 데이터 시작일로 자동 조정됩니다 (결과에 안내 표시).
            </HelpTip>
          </label>
          <input
            type="date"
            value={shared.startDate}
            onChange={(e) => onChange((p) => ({ ...p, startDate: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            종료일 (빈칸 = 최신)
            <HelpTip title="종료일">
              비교 종료 날짜. 특정 구간(예: 닷컴버블 1998~2003, 금융위기 2007~2009)만
              잘라서 볼 때 시작일과 함께 지정하세요.
            </HelpTip>
          </label>
          <input
            type="date"
            value={shared.endDate}
            onChange={(e) => onChange((p) => ({ ...p, endDate: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-2 justify-end pb-1">
          {(
            [
              { key: 'taxEnabled', label: '한국 세금 반영' },
              { key: 'fractionalShares', label: '분수주 허용' },
              { key: 'cryptoTaxEnabled', label: '가상자산 과세 가정' },
            ] as const
          ).map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={shared[key]}
                onChange={(e) => onChange((p) => ({ ...p, [key]: e.target.checked }))}
                className="rounded"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 기간별 월 적립 조정 (고급) */}
      <div className="space-y-1.5 pt-1 border-t border-[#e0e3eb] dark:border-[#2a2e39]">
        <label className={labelCls}>
          기간별 월 적립 조정 (고급)
          <HelpTip title="기간별 월 적립 조정">
            지정한 기간 동안 월 적립금을 기본값 대신 이 금액으로 바꿉니다. 모든
            전략에 동일하게 적용되어 공정 비교가 유지됩니다. 결과의 누적 수익률
            차트에서 구간을 드래그해서 추가할 수도 있습니다. 겹치는 기간이 있으면
            먼저 만든 행이 우선합니다.
          </HelpTip>
        </label>
        {(shared.contributionOverrides ?? []).map((o, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
            <input
              type="month"
              value={o.from}
              onChange={(e) => onChange((p) => ({ ...p, contributionOverrides: p.contributionOverrides.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) }))}
              className={`${inputCls} !w-40`}
            />
            <span>~</span>
            <input
              type="month"
              value={o.to}
              onChange={(e) => onChange((p) => ({ ...p, contributionOverrides: p.contributionOverrides.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) }))}
              className={`${inputCls} !w-40`}
            />
            <span>월 적립 $</span>
            <NumberInput
              value={o.monthlyUsd}
              onChange={(v) => onChange((p) => ({ ...p, contributionOverrides: p.contributionOverrides.map((x, j) => (j === i ? { ...x, monthlyUsd: v } : x)) }))}
              className={`${inputCls} !w-24 text-right`}
            />
            <button
              onClick={() => onChange((p) => ({ ...p, contributionOverrides: p.contributionOverrides.filter((_, j) => j !== i) }))}
              className="text-red-400 hover:text-red-600 px-1"
              aria-label="기간 조정 삭제"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange((p) => ({ ...p, contributionOverrides: [...(p.contributionOverrides ?? []), { from: '', to: '', monthlyUsd: shared.monthlyUsd }] }))}
          className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          + 기간 추가 (예: 특정 2년만 적립 2배)
        </button>
      </div>
    </div>
  )
}
