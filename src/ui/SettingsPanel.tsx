import { NumberInput } from './NumberInput'
import { cardCls, inputCls, labelCls, type SharedSettings } from './common'

/** 공통 설정 패널 — 납입·비용·세금 가정을 전 전략에 동일 적용 */
export function SettingsPanel({
  shared,
  onChange,
}: {
  shared: SharedSettings
  onChange: (updater: (prev: SharedSettings) => SharedSettings) => void
}) {
  const num = (key: keyof SharedSettings, label: string, allowDecimal = false) => (
    <div className="flex flex-col gap-1">
      <label className={labelCls}>{label}</label>
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
        {num('initialUsd', '초기 투자금 (USD)')}
        {num('monthlyUsd', '월 적립금 (USD)')}
        {num('feeBps', '수수료 (bps)', true)}
        {num('spreadBps', '슬리피지 (bps)', true)}
        {num('cashYieldPct', '유휴현금 금리 (%/년)', true)}
        {num('assumedUsdKrw', '가정 환율 (₩/$ — 세금 근사용)')}
        {num('marginalRatePct', '가정 한계세율 (%)', true)}
        {num('otherFinancialIncomeKrw', '기타 금융소득 (₩/년)')}
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
