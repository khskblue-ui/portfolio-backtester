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
      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
        공통 설정 <span className="text-xs font-normal text-gray-400">— 모든 전략에 동일 적용 (공정 비교)</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {num('initialUsd', '초기 투자금 (USD)', false, '시작 시점에 한 번에 넣는 금액. 첫 거래일 종가에 유입돼 다음 거래일 시가로 매수됩니다.')}
        {num('monthlyUsd', '월 적립금 (USD)', false, '매월 첫 거래일에 들어오는 적립금. 각 전략의 "적립 배분" 규칙대로 매수됩니다.')}
        {num('feeBps', '수수료 (bps)', true, '거래대금 대비 매매 수수료. 1bp = 0.01% (예: 7bps = 0.07%, 해외주식 온라인 수수료 수준). 매수·매도 모두 부과.')}
        {num('spreadBps', '슬리피지 (bps)', true, '호가 스프레드·체결 미끄러짐 근사. 매수는 비싸게, 매도는 싸게 체결된다고 가정 (거래 규모 무관 고정 bps 근사).')}
        {num('cashYieldPct', '유휴현금 금리 (%/년)', true, '투자되지 않은 현금이 버는 이자 (SGOV·단기국채·파킹 근사). 고금리 국면에서 이걸 빼먹으면 현금 비중 전략의 수익이 과소평가됩니다.')}
        {num('assumedUsdKrw', '가정 환율 (₩/$ — 세금 근사용)', false, '양도세 250만원 공제·금융소득 2,000만원 임계를 USD 손익에 적용하기 위한 고정 환율 가정. 실제 세금은 거래일 환율 기준이라 근사입니다.')}
        {num('marginalRatePct', '가정 한계세율 (%)', true, '금융소득 종합과세(연 2,000만원 초과) 시 적용될 본인의 종합소득 한계세율 가정. 초과 배당에 (한계세율 − 원천 15%)를 추가 과세하는 근사.')}
        {num('otherFinancialIncomeKrw', '기타 금융소득 (₩/년)', false, '이 포트폴리오 밖에서 발생하는 연간 이자·배당 소득. 종합과세 임계(2,000만원) 판정에 합산됩니다.')}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>시작일 (빈칸 = 자동)</label>
          <input
            type="date"
            value={shared.startDate}
            onChange={(e) => onChange((p) => ({ ...p, startDate: e.target.value }))}
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
            <label key={key} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
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
    </div>
  )
}
