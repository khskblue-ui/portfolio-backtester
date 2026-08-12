/**
 * 백테스트 시뮬레이션 엔진 (PRD §4) — 결정론 상태기계, 룩어헤드 금지
 *
 * ### 타이밍 규약 (4.2 — 룩어헤드 킬러)
 * t 종가로 관측·결정 → t+1 시가로 체결. 같은 날 종가 체결 금지(코드로 강제:
 * 의사결정은 pendingOrders에 쌓이고 다음 루프의 시가에서만 체결됨).
 *
 * ### 하루 처리 순서 (고정)
 * 1) 유휴현금 이자 (실제 경과일수 기준 — 4.5, 당일 배당 입금 전 잔고에만)
 * 2) 배당 입금 — ex-date에 "오늘 체결 전" 보유분 기준 (ex-date 매수자는 미수령)
 * 3) 전일 결정 오더 체결 (t 시가): 매도 먼저 → 매수(현금 부족 시 예산 스케일)
 * 4) 외부 현금 유입 (초기 납입 / 월 적립 — 매월 첫 거래일)
 * 5) 종가 평가
 * 6) 의사결정 (적립 배분 → 리밸런싱 — 4.4 순서) → 내일 체결
 * 7) 연말 세금 정산 (5.2 연 손익통산) — 현금 차감, 부족 시 다음날 강제 매도
 * 8) 기록 + 리컨실 검증 (4.7)
 */

import type {
  StrategyConfig,
  DrawdownRule,
  SleeveConfig,
  AlignedDataBundle,
  BacktestResult,
  TradeLogEntry,
  TaxLogEntry,
  DailyPoint,
  EngineWarning,
} from './types'
import { CASH_TICKER } from './types'
import {
  computeCapitalGainsTax,
  computeCryptoTax,
  applyDividendWithholding,
  computeDividendComprehensiveTax,
  resolveTaxClass,
} from './tax'

interface Order {
  ticker: string
  side: 'BUY' | 'SELL'
  /** BUY: 지출 예산(USD, 수수료 포함) / SELL: 주식 수 (결정 시점 확정) */
  amount: number
  reason: TradeLogEntry['reason']
}

interface SleeveState {
  ticker: string
  shares: number
  /** 이동평균 원가 총액 (매수 수수료 포함 — 5.1 한국식) */
  totalCost: number
}

/** 부동소수 리컨실 허용오차 (상대) */
const RECON_EPS = 1e-6

export function runBacktest(config: StrategyConfig, bundle: AlignedDataBundle): BacktestResult {
  validateStrategyOrThrow(config, bundle)

  const { dates } = bundle
  const N = dates.length
  const marketSleeves = config.sleeves.filter((s) => s.ticker !== CASH_TICKER)
  const cashTarget = config.sleeves.find((s) => s.ticker === CASH_TICKER)?.targetWeight ?? 0

  // ── 낙폭 대응 규칙 (얕은 것부터 정렬 — 순회하며 마지막 발동 규칙 = 가장 깊은 규칙) ──
  const ddRules = [...(config.contribution.rules ?? [])].sort((a, b) => a.drawdownPct - b.drawdownPct)
  const overrides = config.contribution.overrides ?? []
  // growth-of-$1 추적 (metrics와 같은 정의: 유입은 당일 종가 직전 유입으로 간주)
  let growth = 1
  let growthPeak = 1
  let prevCloseValue = 0
  /** 전일 종가 관측으로 확정된 발동 규칙 (오늘의 유입·오늘 저녁 결정에 적용) */
  let activeRule: DrawdownRule | null = null
  /** 발동 구간 기록 — 차트 음영·보고서용 */
  const ruleEpisodes: { from: string; to: string | null; label: string }[] = []
  const ruleLabel = (r: DrawdownRule) => `−${r.drawdownPct}%` + ((r.basis ?? 'peak') === 'invested' ? ' 원금 기준' : '')
  const trackEpisode = (next: DrawdownRule | null, date: string) => {
    const open = ruleEpisodes[ruleEpisodes.length - 1]
    if (open && open.to === null) {
      if (next && ruleLabel(next) === open.label) return
      open.to = date
    }
    if (next) ruleEpisodes.push({ from: date, to: null, label: ruleLabel(next) })
  }

  // ── 상태 (4.1) ──
  const state: Record<string, SleeveState> = {}
  for (const s of marketSleeves) state[s.ticker] = { ticker: s.ticker, shares: 0, totalCost: 0 }
  let cash = 0
  let cumContributions = 0
  let pendingOrders: Order[] = []

  // 원장/로그
  const trades: TradeLogEntry[] = []
  const taxes: TaxLogEntry[] = []
  const daily: DailyPoint[] = []
  const warnings: EngineWarning[] = []
  let dividendsGrossUsd = 0
  let dividendsWithheldUsd = 0
  let totalFeesUsd = 0
  let totalTaxesUsd = 0

  // 연 단위 손익통산 그룹 (5.2/5.4) — 연도별·자산군별 실현손익 누적
  let yearRealized: Record<'foreign_equity' | 'crypto', number> = { foreign_equity: 0, crypto: 0 }
  let yearGrossDividends = 0

  // 리컨실용 현금 원장 (모든 현금 변동을 독립 누적 → 상태 현금과 대조)
  let cashLedger = 0

  // no_sell 과대 슬리브 에피소드 추적 (경고 스팸 방지 — 진입 시 1회 + 장기화 시 1회)
  const overweightEpisode: Record<string, number> = {}
  const bandWarned: Record<string, boolean> = {}

  const feeRate = config.costs.feeBps / 10_000
  const spreadRate = config.costs.spreadBps / 10_000
  const cashYield = config.execution.cashAnnualYieldPct / 100

  const closeAt = (ticker: string, i: number) => bundle.series[ticker].close[i]
  const openAt = (ticker: string, i: number) => bundle.series[ticker].open[i]
  const marketValue = (i: number) =>
    marketSleeves.reduce((sum, s) => sum + state[s.ticker].shares * closeAt(s.ticker, i), 0)

  const yearOf = (d: string) => Number(d.slice(0, 4))
  const monthOf = (d: string) => d.slice(0, 7)
  const daysBetween = (a: string, b: string) =>
    Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

  // 월 적립·periodic 판정용: 시작월 기준 경과 개월
  const startYm = monthOf(dates[0])
  const monthIndex = (d: string) => {
    const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))]
    const [sy, sm] = [Number(startYm.slice(0, 4)), Number(startYm.slice(5, 7))]
    return (y - sy) * 12 + (m - sm)
  }

  for (let i = 0; i < N; i++) {
    const date = dates[i]
    const isMonthStart = i > 0 && monthOf(dates[i - 1]) !== monthOf(date)

    // ── 1) 유휴현금 이자 (실제 경과일 — 주말·휴장 포함) ──
    // 배당 입금보다 먼저: 오늘 막 입금될 배당에 직전 기간 이자가 붙는 과대계상 방지
    if (i > 0 && cash > 0 && cashYield > 0) {
      const dt = daysBetween(dates[i - 1], date)
      const interest = cash * (Math.pow(1 + cashYield, dt / 365) - 1)
      cash += interest
      cashLedger += interest
    }

    // ── 2) 배당 (오늘 체결 전 보유분 = ex-date 전일 보유자) ──
    for (const s of marketSleeves) {
      const div = bundle.series[s.ticker].divPerShare[i]
      if (div > 0 && state[s.ticker].shares > 0) {
        const gross = state[s.ticker].shares * div
        const { netUsd, withheldUsd } = applyDividendWithholding(gross, config.tax)
        cash += netUsd
        cashLedger += netUsd
        dividendsGrossUsd += gross
        dividendsWithheldUsd += withheldUsd
        yearGrossDividends += gross
      }
    }

    // ── 3) 오더 체결 (t 시가) — 매도 먼저, 매수는 가용현금 내 스케일 ──
    if (pendingOrders.length > 0) {
      for (const o of pendingOrders) {
        if (o.side !== 'SELL') continue
        const sl = state[o.ticker]
        const shares = Math.min(o.amount, sl.shares)
        if (shares <= 0) continue
        const px = openAt(o.ticker, i) * (1 - spreadRate)
        const notional = shares * px
        const fee = notional * feeRate
        const avgCost = sl.shares > 0 ? sl.totalCost / sl.shares : 0
        const realized = notional - fee - shares * avgCost
        sl.totalCost -= shares * avgCost
        sl.shares -= shares
        cash += notional - fee
        cashLedger += notional - fee
        totalFeesUsd += fee
        const taxClass = resolveTaxClass(o.ticker, config.sleeves.find((s) => s.ticker === o.ticker)?.taxClass)
        if (taxClass !== 'exempt') yearRealized[taxClass] += realized
        trades.push({ date, ticker: o.ticker, side: 'SELL', shares, price: px, fee, realizedPnl: realized, reason: o.reason })
      }

      const buyOrders = pendingOrders.filter((o) => o.side === 'BUY')
      const totalBudget = buyOrders.reduce((s, o) => s + o.amount, 0)
      // 시가 갭으로 현금이 예산에 못 미치면 비례 축소 (결정론)
      const scale = totalBudget > 0 ? Math.min(1, Math.max(0, cash) / totalBudget) : 0
      for (const o of buyOrders) {
        const budget = o.amount * scale
        if (budget < 1e-9) continue
        const px = openAt(o.ticker, i) * (1 + spreadRate)
        // budget = shares×px + shares×px×feeRate → shares = budget / (px×(1+feeRate))
        let shares = budget / (px * (1 + feeRate))
        if (!config.execution.fractionalShares) shares = Math.floor(shares)
        if (shares <= 0) continue
        const notional = shares * px
        const fee = notional * feeRate
        const sl = state[o.ticker]
        sl.shares += shares
        sl.totalCost += notional + fee // 취득가액 = 매수가 + 수수료 (5.1)
        cash -= notional + fee
        cashLedger -= notional + fee
        totalFeesUsd += fee
        trades.push({ date, ticker: o.ticker, side: 'BUY', shares, price: px, fee, reason: o.reason })
      }
      pendingOrders = []
    }

    // ── 4) 외부 현금 유입 ──
    let externalFlow = 0
    if (i === 0 && config.contribution.initialUsd > 0) externalFlow += config.contribution.initialUsd
    // 월 적립은 시작월 포함 매월 유입 (스펙: 매월 첫 거래일 — 시작일이 곧 그 달의 첫 유입일)
    if (i === 0 || isMonthStart) {
      const ym = monthOf(date)
      const ov = overrides.find((o) => o.from <= ym && ym <= o.to)
      let monthly = ov ? ov.monthlyUsd : config.contribution.monthlyUsd
      // 배수는 전일 종가에서 관측된 규칙 기준 (당일 정보 사용 금지)
      if (activeRule?.contributionMultiplier != null) monthly *= activeRule.contributionMultiplier
      if (monthly > 0) externalFlow += monthly
    }
    if (externalFlow > 0) {
      cash += externalFlow
      cashLedger += externalFlow
      cumContributions += externalFlow
    }

    // ── 5) 종가 평가 ──
    let value = cash + marketValue(i)

    // ── 5.5) 낙폭 관측 (growth-of-$1 — 납입 효과 제거, metrics 6.2와 같은 자) ──
    // 오늘 종가 관측이 오늘 저녁의 결정(6)과 내일의 유입(4)에 적용된다.
    if (prevCloseValue > 0) growth *= Math.max(0, (value - externalFlow) / prevCloseValue)
    if (growth > growthPeak) growthPeak = growth
    prevCloseValue = value
    if (ddRules.length > 0) {
      const ddPeak = (1 - growth / growthPeak) * 100
      const ddInvested = cumContributions > 0 ? Math.max(0, (1 - value / cumContributions) * 100) : 0
      const ddOf = (r: DrawdownRule) => ((r.basis ?? 'peak') === 'invested' ? ddInvested : ddPeak)
      let next: DrawdownRule | null = null
      for (const r of ddRules) if (ddOf(r) >= r.drawdownPct) next = r
      const ddPct = next ? ddOf(next) : Math.max(ddPeak, ddInvested)
      const basisLabel = next && (next.basis ?? 'peak') === 'invested' ? '투입원금 대비' : '전고점 대비'
      if ((next?.drawdownPct ?? -1) !== (activeRule?.drawdownPct ?? -1)) {
        trackEpisode(next, date)
        warnings.push({
          date,
          code: 'dd_rule',
          message: next
            ? `낙폭 규칙 발동 (${basisLabel} −${ddPct.toFixed(1)}%): ` +
              [
                next.contributionMultiplier != null ? `적립 ×${next.contributionMultiplier}` : null,
                next.cashTargetOverride != null ? `현금 목표 ${(next.cashTargetOverride * 100).toFixed(0)}%` : null,
              ].filter(Boolean).join(' · ')
            : `낙폭 규칙 해제 (기준 낙폭 −${ddPct.toFixed(1)}%로 회복)`,
        })
      }
      activeRule = next
    }

    // ── 6) 의사결정 (t 종가 → t+1 시가 체결) ──
    if (i < N - 1) {
      pendingOrders = decide(i, value)
    }

    // ── 7) 연말 세금 정산 (마지막 날 포함 — 미결 연도분 정산) ──
    const isYearEnd = i === N - 1 || yearOf(dates[i + 1]) !== yearOf(date)
    if (isYearEnd && config.tax.enabled) {
      const year = yearOf(date)
      let taxDue = 0
      const cg = computeCapitalGainsTax(yearRealized.foreign_equity, config.tax)
      if (cg) { cg.year = year; taxes.push(cg); taxDue += cg.taxUsd }
      const crypto = computeCryptoTax(yearRealized.crypto, config.tax)
      if (crypto) { crypto.year = year; taxes.push(crypto); taxDue += crypto.taxUsd }
      const divTax = computeDividendComprehensiveTax(yearGrossDividends, config.tax)
      if (divTax) { divTax.year = year; taxes.push(divTax); taxDue += divTax.taxUsd }

      if (taxDue > 0) {
        cash -= taxDue
        cashLedger -= taxDue
        totalTaxesUsd += taxDue
        const valueBeforeTax = value
        value -= taxDue
        // 낙폭 관측(5.5)은 세전 값으로 이미 갱신됐으므로 세후 값으로 소급 보정 —
        // metrics의 growth-of-$1(세후 daily.value 기준)과 같은 자를 유지해,
        // 세금발 낙폭 규칙 발동이 다음 달(1월) 유입에서 누락되는 1스텝 지연 방지
        if (valueBeforeTax > 0) {
          growth *= Math.max(0, value / valueBeforeTax)
          prevCloseValue = value
          if (ddRules.length > 0) {
            const ddPeakT = (1 - growth / growthPeak) * 100
            const ddInvT = cumContributions > 0 ? Math.max(0, (1 - value / cumContributions) * 100) : 0
            let next: DrawdownRule | null = null
            for (const r of ddRules) if (((r.basis ?? 'peak') === 'invested' ? ddInvT : ddPeakT) >= r.drawdownPct) next = r
            if ((next?.drawdownPct ?? -1) !== (activeRule?.drawdownPct ?? -1)) trackEpisode(next, date)
            activeRule = next
          }
        }
        if (cash < 0 && i < N - 1) {
          // 현금 부족 → 다음날 시가에 슬리브 비례 강제 매도 (다음 연도 손익으로 실현)
          warnings.push({
            date,
            code: 'negative_cash_tax',
            message: `${year}년 세금 $${taxDue.toFixed(2)} 납부로 현금 부족 → 다음 거래일 비례 강제 매도`,
          })
          const mv = marketValue(i)
          const needed = -cash * 1.01 // 스프레드·수수료 여유
          if (mv > 0) {
            for (const s of marketSleeves) {
              const sleeveVal = state[s.ticker].shares * closeAt(s.ticker, i)
              if (sleeveVal <= 0) continue
              let sellShares = ((needed * sleeveVal) / mv) / closeAt(s.ticker, i)
            if (!config.execution.fractionalShares) sellShares = Math.ceil(sellShares)
              pendingOrders.push({ ticker: s.ticker, side: 'SELL', amount: Math.min(sellShares, state[s.ticker].shares), reason: 'forced_tax_sale' })
            }
          }
        }
      }
      yearRealized = { foreign_equity: 0, crypto: 0 }
      yearGrossDividends = 0
    }

    // ── 7.5) 강제 매도 후에도 현금이 음수면(시가 갭·수수료가 버퍼 초과) 추가 매도 재시도 ──
    // 연말 세금 강제매도는 1% 버퍼로 1회만 큐잉되므로, 갭다운이 크면 음수 현금이
    // 무이자 레버리지로 남는다 — 커버될 때까지 반복 큐잉해 invariant(cash >= 0) 복원
    if (cash < -0.005 && i < N - 1 && !pendingOrders.some((o) => o.reason === 'forced_tax_sale')) {
      const mvR = marketValue(i)
      if (mvR > 0) {
        warnings.push({
          date,
          code: 'negative_cash_retry',
          message: `강제 매도 후 현금 ${cash.toFixed(2)} 음수 지속 → 추가 비례 매도 재시도`,
        })
        const neededR = -cash * 1.02
        for (const s of marketSleeves) {
          const sleeveVal = state[s.ticker].shares * closeAt(s.ticker, i)
          if (sleeveVal <= 0) continue
          let sellShares = ((neededR * sleeveVal) / mvR) / closeAt(s.ticker, i)
          if (!config.execution.fractionalShares) sellShares = Math.ceil(sellShares)
          pendingOrders.push({ ticker: s.ticker, side: 'SELL', amount: Math.min(sellShares, state[s.ticker].shares), reason: 'forced_tax_sale' })
        }
      }
    }

    // ── 8) 기록 + 리컨실 (4.7) ──
    const sleeveValues: Record<string, number> = { [CASH_TICKER]: cash }
    for (const s of marketSleeves) sleeveValues[s.ticker] = state[s.ticker].shares * closeAt(s.ticker, i)
    daily.push({ date, value, externalFlow, cumContributions, sleeveValues, cash })

    const reconDiff = Math.abs(cash - cashLedger)
    if (reconDiff > RECON_EPS * Math.max(1, Math.abs(value))) {
      warnings.push({
        date,
        code: 'reconciliation',
        message: `현금 원장 불일치: state=${cash.toFixed(6)} ledger=${cashLedger.toFixed(6)}`,
      })
    }
    const sleeveSum = Object.values(sleeveValues).reduce((a, b) => a + b, 0)
    if (Math.abs(sleeveSum - value) > RECON_EPS * Math.max(1, Math.abs(value))) {
      warnings.push({
        date,
        code: 'reconciliation',
        message: `슬리브 합 ≠ 포트 가치: sleeves=${sleeveSum.toFixed(6)} value=${value.toFixed(6)}`,
      })
    }
  }

  return {
    strategyId: config.id,
    daily,
    ruleEpisodes,
    trades,
    taxes,
    dividendsGrossUsd,
    dividendsWithheldUsd,
    totalFeesUsd,
    totalTaxesUsd,
    warnings,
    finalValue: daily[N - 1].value,
    totalContributions: cumContributions,
  }

  // ─── 의사결정 (t 종가 기준) ─────────────────────────────────────────────────

  function decide(i: number, value: number): Order[] {
    const date = dates[i]
    if (value <= 0) return []

    const weights: Record<string, number> = {}
    for (const s of config.sleeves) {
      const v = s.ticker === CASH_TICKER ? cash : state[s.ticker].shares * closeAt(s.ticker, i)
      weights[s.ticker] = v / value
    }

    // 낙폭 규칙의 현금 목표 대체 — 시장 목표는 (1−유효현금)/(1−기본현금)으로 비례 확대
    const effCash = activeRule?.cashTargetOverride != null ? activeRule.cashTargetOverride : cashTarget
    const mktScale = cashTarget < 1 ? (1 - effCash) / (1 - cashTarget) : 1
    const effTarget = (s: SleeveConfig) => (s.ticker === CASH_TICKER ? effCash : s.targetWeight * mktScale)

    // 리밸런싱 트리거 판정 (4.4)
    const isMonthStart = i > 0 && monthOf(dates[i - 1]) !== monthOf(date)
    const periodMonths = config.rebalance.periodMonths ?? 0
    const periodicDue =
      (config.rebalance.trigger === 'periodic' || config.rebalance.trigger === 'band_or_periodic') &&
      periodMonths > 0 &&
      isMonthStart &&
      monthIndex(date) % periodMonths === 0

    let bandBreached = false
    if (config.rebalance.trigger === 'bands' || config.rebalance.trigger === 'band_or_periodic') {
      for (const s of config.sleeves) {
        const tw = effTarget(s)
        const dev = Math.abs(weights[s.ticker] - tw)
        const abs = config.rebalance.bandAbsPct != null && dev >= config.rebalance.bandAbsPct / 100
        const rel =
          config.rebalance.bandRelPct != null &&
          tw > 0 &&
          Math.abs(weights[s.ticker] / tw - 1) >= config.rebalance.bandRelPct / 100
        if (abs || rel) { bandBreached = true; break }
      }
    }

    // no_sell 모드에서 과대 슬리브 플래그 (4.4 — 무동작+경고, 장기화 시 band_unclosable)
    // day 0(초기 매수 전 전액 현금)은 제외. CASH는 매도 없이 스윕 매수로 해소 가능하므로 제외.
    if (config.rebalance.mode !== 'sell_to_target' && i > 0) {
      for (const s of config.sleeves) {
        if (s.ticker === CASH_TICKER) continue
        const bandAbs = (config.rebalance.bandAbsPct ?? 5) / 100
        const over = weights[s.ticker] - s.targetWeight > bandAbs
        if (over) {
          if (overweightEpisode[s.ticker] == null) {
            overweightEpisode[s.ticker] = i
            warnings.push({
              date,
              code: 'no_sell_overweight',
              message: `${s.ticker} 과대(${(weights[s.ticker] * 100).toFixed(1)}% > 목표 ${(s.targetWeight * 100).toFixed(0)}%) — 무매도 모드라 매도 불가, 적립 희석만 가능`,
            })
          } else if (!bandWarned[s.ticker] && daysBetween(dates[overweightEpisode[s.ticker]], date) >= 183) {
            bandWarned[s.ticker] = true
            warnings.push({
              date,
              code: 'band_unclosable',
              message: `${s.ticker} 과대 상태 6개월 지속 — 적립만으로 밴드를 못 닫는 구간`,
            })
          }
        } else if (overweightEpisode[s.ticker] != null) {
          delete overweightEpisode[s.ticker]
          delete bandWarned[s.ticker]
        }
      }
    }

    const sellsAllowed =
      config.rebalance.mode === 'sell_to_target' ||
      (config.rebalance.mode === 'no_sell_except_periodic' && periodicDue)
    const triggerFired =
      (config.rebalance.trigger !== 'none') && (periodicDue || bandBreached)

    const orders: Order[] = []

    if (triggerFired && sellsAllowed) {
      // 전면 리밸런싱: 목표 대비 초과분 매도(주식 수 확정) + 미달분 매수(예산)
      const reason = i === 0 ? 'initial' : 'rebalance'
      for (const s of marketSleeves) {
        const target = effTarget(s) * value
        const current = state[s.ticker].shares * closeAt(s.ticker, i)
        const delta = target - current
        if (delta < -1e-9) {
          let sellShares = -delta / closeAt(s.ticker, i)
          if (!config.execution.fractionalShares) sellShares = Math.floor(sellShares)
          if (sellShares > 0) orders.push({ ticker: s.ticker, side: 'SELL', amount: sellShares, reason })
        } else if (delta > 1e-9) {
          orders.push({ ticker: s.ticker, side: 'BUY', amount: delta, reason })
        }
      }
      return orders
    }

    // 적립/유휴현금 배분 (4.3 + 4.5 현금 스윕) — 매수만
    const targetCashUsd = effCash * value
    const investable = cash - targetCashUsd
    if (investable < config.execution.minTradeUsd) return orders

    const budgets = allocateBuys(investable, i, value, mktScale)
    const isContributionLike = daily.length === 0 || (daily[daily.length - 1]?.cumContributions ?? 0) < cumContributions
    for (const [ticker, budget] of Object.entries(budgets)) {
      if (budget > 1e-9) {
        orders.push({
          ticker,
          side: 'BUY',
          amount: budget,
          reason: i === 0 ? 'initial' : isContributionLike ? 'contribution' : 'cash_sweep',
        })
      }
    }
    return orders
  }

  /**
   * 4.3 적립 배분 타이브레이킹 — 결정론 고정:
   * to_underweight = "부족분 비례 배분". 전 슬리브 부족분이 충족되면
   * 잔여는 목표비중 비례. (가장-미달-우선 워터폴이 아님 — 명세 고정)
   */
  function allocateBuys(investable: number, i: number, value: number, mktScale = 1): Record<string, number> {
    const budgets: Record<string, number> = {}
    const policy = config.contribution.allocation

    if (policy === 'fixed_split' && config.contribution.fixedSplit) {
      for (const s of marketSleeves) {
        budgets[s.ticker] = investable * (config.contribution.fixedSplit[s.ticker] ?? 0)
      }
      return budgets
    }

    const marketTargetSum = marketSleeves.reduce((sum, s) => sum + s.targetWeight, 0)
    if (policy === 'pro_rata' || marketTargetSum <= 0) {
      for (const s of marketSleeves) {
        budgets[s.ticker] = marketTargetSum > 0
          ? investable * (s.targetWeight / marketTargetSum)
          : investable / marketSleeves.length
      }
      return budgets
    }

    // to_underweight: 투입 후 총가치 기준 부족분에 비례
    const projected = value // 적립분은 이미 cash에 반영돼 value에 포함
    const shortfalls: Record<string, number> = {}
    let totalShortfall = 0
    for (const s of marketSleeves) {
      const current = state[s.ticker].shares * closeAt(s.ticker, i)
      const sf = Math.max(0, s.targetWeight * mktScale * projected - current)
      shortfalls[s.ticker] = sf
      totalShortfall += sf
    }
    if (totalShortfall <= 1e-9) {
      // 부족 슬리브 없음 → 목표비중 비례
      for (const s of marketSleeves) budgets[s.ticker] = investable * (s.targetWeight / marketTargetSum)
      return budgets
    }
    if (investable <= totalShortfall) {
      for (const s of marketSleeves) budgets[s.ticker] = investable * (shortfalls[s.ticker] / totalShortfall)
      return budgets
    }
    // 부족분 전액 충족 + 잔여는 목표비중 비례
    const residual = investable - totalShortfall
    for (const s of marketSleeves) {
      budgets[s.ticker] = shortfalls[s.ticker] + residual * (s.targetWeight / marketTargetSum)
    }
    return budgets
  }
}

// ─── 검증 ─────────────────────────────────────────────────────────────────────

export function validateStrategy(config: StrategyConfig, bundle?: AlignedDataBundle): string[] {
  const errors: string[] = []
  const wSum = config.sleeves.reduce((s, x) => s + x.targetWeight, 0)
  if (Math.abs(wSum - 1) > 1e-6) errors.push(`목표비중 합이 1이 아님 (${wSum.toFixed(4)})`)
  if (config.sleeves.some((s) => s.targetWeight < 0)) errors.push('음수 목표비중 (숏 미지원 — v1 스코프)')
  const tickerSet = new Set(config.sleeves.map((s) => s.ticker))
  if (tickerSet.size !== config.sleeves.length) errors.push('중복 티커')
  if (config.sleeves.some((s) => s.ticker.trim() === '')) errors.push('빈 티커 — 심볼을 입력하거나 해당 행을 삭제하세요')

  if (config.contribution.initialUsd <= 0 && config.contribution.monthlyUsd <= 0)
    errors.push('초기 투자금 또는 월 적립금이 필요')
  const rules = config.contribution.rules ?? []
  for (const r of rules) {
    if (!(r.drawdownPct > 0)) errors.push('낙폭 규칙: 발동 낙폭은 0보다 커야 합니다')
    if (r.contributionMultiplier != null && r.contributionMultiplier < 0) errors.push('낙폭 규칙: 적립 배수는 0 이상이어야 합니다')
    if (r.cashTargetOverride != null && (r.cashTargetOverride < 0 || r.cashTargetOverride > 1)) errors.push('낙폭 규칙: 현금 목표는 0~100% 사이여야 합니다')
    if (r.contributionMultiplier == null && r.cashTargetOverride == null) errors.push('낙폭 규칙: 적립 배수나 현금 목표 중 하나는 지정해야 합니다')
  }
  if (new Set(rules.map((r) => r.drawdownPct)).size !== rules.length) errors.push('낙폭 규칙: 발동 낙폭이 중복됩니다')
  for (const o of config.contribution.overrides ?? []) {
    if (!/^\d{4}-\d{2}$/.test(o.from) || !/^\d{4}-\d{2}$/.test(o.to)) errors.push('기간별 적립: 월 형식(YYYY-MM)이 아닙니다')
    else if (o.from > o.to) errors.push('기간별 적립: 시작 월이 종료 월보다 늦습니다')
    if (o.monthlyUsd < 0) errors.push('기간별 적립: 금액은 0 이상이어야 합니다')
  }
  if (config.contribution.allocation === 'fixed_split') {
    const split = config.contribution.fixedSplit
    if (!split) errors.push('fixed_split에 배분 비율 필요')
    else {
      const sum = Object.values(split).reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 1) > 1e-6) errors.push(`fixed_split 합이 1이 아님 (${sum.toFixed(4)})`)
      const mkt = new Set(config.sleeves.filter((x) => x.ticker !== CASH_TICKER).map((x) => x.ticker))
      const stray = Object.keys(split).filter((k) => !mkt.has(k) && (split[k] ?? 0) > 0)
      if (stray.length > 0) errors.push(`고정 분할의 자산(${stray.join(', ')})이 자산 배분에 없습니다 — 티커를 맞춰 주세요`)
    }
  }

  const rb = config.rebalance
  if ((rb.trigger === 'periodic' || rb.trigger === 'band_or_periodic') && !(rb.periodMonths && rb.periodMonths >= 1))
    errors.push('periodic 트리거에 periodMonths 필요')
  if ((rb.trigger === 'bands' || rb.trigger === 'band_or_periodic') && rb.bandAbsPct == null && rb.bandRelPct == null)
    errors.push('bands 트리거에 밴드 폭 필요')
  if (rb.mode === 'no_sell_except_periodic' && !(rb.periodMonths && rb.periodMonths >= 1))
    errors.push('no_sell_except_periodic에 periodMonths 필요')

  if (bundle) {
    for (const s of config.sleeves) {
      if (s.ticker !== CASH_TICKER && !bundle.series[s.ticker]) errors.push(`${s.ticker} 데이터 없음`)
    }
  }
  return errors
}

function validateStrategyOrThrow(config: StrategyConfig, bundle: AlignedDataBundle): void {
  const errors = validateStrategy(config, bundle)
  if (errors.length > 0) throw new Error(`전략 "${config.name}" 설정 오류: ${errors.join(' / ')}`)
}
