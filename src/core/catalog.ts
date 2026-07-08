/**
 * 자산 카탈로그 — 티커 자동완성 + 히스토리 안내 (§3 비정렬 시작일 대응)
 *
 * 최신 ETF(VOO 2010~, QQQM 2020~)로는 닷컴버블 같은 과거 구간을 볼 수 없다.
 * 같은 자산군의 장기 히스토리 대체 티커(지수·구형 ETF)를 함께 제시한다.
 *
 * ⚠ 지수(^) 주의: 지수는 직접 매매할 수 없고 보수·추적오차가 없다는 가정이 들어감.
 * 가격지수(^GSPC 등)는 배당이 빠져 총수익이 과소, 총수익지수(^SP500TR)는 배당이
 * 가격에 내재돼 배당 현금흐름·배당세가 계산되지 않음 — 엔진이 결과 화면에 플래그.
 */

export type AssetGroup = '역사 월간 (1871~)' | '지수 (장기 히스토리)' | '주식 ETF' | '레버리지 (합성 소급)' | '채권/현금 ETF' | '원자재' | '크립토'

import type { SyntheticSpec } from './synthetic'

export interface CatalogEntry {
  ticker: string
  label: string
  group: AssetGroup
  /** 데이터 대략 시작 연도 */
  startYear: number
  /** 에피스테믹 주의사항 — 결과 화면 경고로도 노출 */
  note?: string
  /** 데이터 소스 — 생략 시 yahoo. stooq는 배당 이벤트 없음(현물·지수 전용). bundle은 리포 번들 월간 합성(1871~) */
  source?: 'stooq' | 'bundle'
  /** 합성 레버리지 스펙 — 기초 ETF에서 소급 시뮬레이션 (synthetic.ts) */
  synthetic?: SyntheticSpec
}

const PRICE_INDEX_NOTE = '가격지수 — 배당 미포함(총수익·배당세 과소). 매매 불가 지수를 보유 가능으로 가정'
const TR_INDEX_NOTE = '총수익지수 — 배당이 지수에 내재(배당 현금흐름·배당세 미계산). 매매 불가 지수를 보유 가능으로 가정'

const HIST_NOTE_COMMON =
  '역사 월간 합성 지수(Shiller 데이터 파생, 1871~) — 월간 해상도(월평균 가격)라 일중·일간 변동이 뭉개지고, ' +
  '배당 내재(총수익)라 배당 현금흐름·배당세가 계산되지 않으며, 매매 불가 지수를 보유 가능으로 가정합니다. ' +
  '일별 자산(ETF 등)과 같은 실행에 섞을 수 없고, 대공황·스태그플레이션 등 1900년대 구간 탐구 전용입니다'

export const ASSET_CATALOG: CatalogEntry[] = [
  // ── 역사 월간 합성: ETF 이전 시대(1871~) — 역사 연구 탭의 구간을 실제로 백테스트 ──
  {
    ticker: 'SPX-HIST', label: '미국 대형주 총수익 (역사 월간)', group: '역사 월간 (1871~)', startYear: 1871, source: 'bundle',
    note: HIST_NOTE_COMMON + '. 주식: S&P 종합(1957년 이전은 Cowles/S&P90 소급 합성) 명목 총수익',
  },
  {
    ticker: 'UST10-HIST', label: '미국 10년 국채 총수익 근사 (역사 월간)', group: '역사 월간 (1871~)', startYear: 1871, source: 'bundle',
    note: HIST_NOTE_COMMON + '. 채권: GS10 수익률 파생 만기고정 근사 — 실제 채권지수·펀드가 아님',
  },
  {
    ticker: 'GOLD-HIST', label: '금 (역사 월간)', group: '역사 월간 (1871~)', startYear: 1871, source: 'bundle',
    note: HIST_NOTE_COMMON + '. 금: 1933-1974 미국 민간 금보유 금지·공정가($20.67→$35) 시대 주의',
  },

  // ── 지수: 닷컴버블·블랙먼데이 등 과거 구간용 장기 히스토리 ──
  { ticker: '^GSPC', label: 'S&P 500 지수', group: '지수 (장기 히스토리)', startYear: 1927, note: PRICE_INDEX_NOTE },
  { ticker: '^SP500TR', label: 'S&P 500 총수익지수', group: '지수 (장기 히스토리)', startYear: 1988, note: TR_INDEX_NOTE },
  { ticker: '^IXIC', label: '나스닥 종합지수', group: '지수 (장기 히스토리)', startYear: 1971, note: PRICE_INDEX_NOTE },
  { ticker: '^NDX', label: '나스닥 100 지수', group: '지수 (장기 히스토리)', startYear: 1985, note: PRICE_INDEX_NOTE },
  { ticker: '^DJI', label: '다우존스 산업지수', group: '지수 (장기 히스토리)', startYear: 1992, note: PRICE_INDEX_NOTE },
  { ticker: '^KS11', label: 'KOSPI', group: '지수 (장기 히스토리)', startYear: 1996, note: PRICE_INDEX_NOTE },

  // ── 주식 ETF ──
  { ticker: 'SPY', label: 'S&P 500 (최장 ETF)', group: '주식 ETF', startYear: 1993 },
  { ticker: 'QQQ', label: '나스닥 100 (닷컴버블 포함)', group: '주식 ETF', startYear: 1999 },
  { ticker: 'VTI', label: '미국 전체 시장', group: '주식 ETF', startYear: 2001 },
  { ticker: 'VOO', label: 'S&P 500 (저보수)', group: '주식 ETF', startYear: 2010 },
  { ticker: 'QQQM', label: '나스닥 100 (저보수)', group: '주식 ETF', startYear: 2020 },
  { ticker: 'VXUS', label: '미국 제외 전세계', group: '주식 ETF', startYear: 2011 },
  { ticker: 'SCHD', label: '미국 배당성장', group: '주식 ETF', startYear: 2011 },

  // ── 레버리지: 실물 + 합성 소급 (상장 전 시대 시뮬레이션) ──
  { ticker: 'TQQQ', label: '나스닥100 3배 (실물)', group: '레버리지 (합성 소급)', startYear: 2010, note: '일간 3배 레버리지 — 장기 보유 시 변동성 잠식. 상장 전 구간은 TQQQ-SIM 사용' },
  { ticker: 'QLD', label: '나스닥100 2배 (실물)', group: '레버리지 (합성 소급)', startYear: 2006, note: '일간 2배 레버리지 — 상장 전 구간은 QLD-SIM 사용' },
  {
    ticker: 'TQQQ-SIM', label: '나스닥100 3배 합성 (닷컴버블 소급)', group: '레버리지 (합성 소급)', startYear: 1999,
    synthetic: { base: 'QQQ', leverage: 3, expensePct: 0.86, borrowSpreadPct: 0.6 },
    note: '가상 합성 자산 — 실존 ETF가 아니라 QQQ 일간수익×3 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능',
  },
  {
    ticker: 'QLD-SIM', label: '나스닥100 2배 합성 (닷컴버블 소급)', group: '레버리지 (합성 소급)', startYear: 1999,
    synthetic: { base: 'QQQ', leverage: 2, expensePct: 0.95, borrowSpreadPct: 0.6 },
    note: '가상 합성 자산 — 실존 ETF가 아니라 QQQ 일간수익×2 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능',
  },
  {
    ticker: 'UPRO-SIM', label: 'S&P500 3배 합성 (1993~ 소급)', group: '레버리지 (합성 소급)', startYear: 1993,
    synthetic: { base: 'SPY', leverage: 3, expensePct: 0.91, borrowSpreadPct: 0.6 },
    note: '가상 합성 자산 — 실존 ETF가 아니라 SPY 일간수익×3 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능',
  },
  {
    ticker: 'SSO-SIM', label: 'S&P500 2배 합성 (1993~ 소급)', group: '레버리지 (합성 소급)', startYear: 1993,
    synthetic: { base: 'SPY', leverage: 2, expensePct: 0.89, borrowSpreadPct: 0.6 },
    note: '가상 합성 자산 — 실존 ETF가 아니라 SPY 일간수익×2 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능',
  },

  // ── 채권 뮤추얼펀드: ETF 이전 시대(80~90년대) 커버, 분배금 포함 ──
  {
    ticker: 'VUSTX', label: '미국 장기국채 펀드', group: '채권/현금 ETF', startYear: 1986,
    note: '뮤추얼펀드 — NAV 1일 1회(시가=종가 가정), 분배금 포함. TLT(2002~) 이전 시대 커버',
  },
  {
    ticker: 'VFITX', label: '미국 중기국채 펀드', group: '채권/현금 ETF', startYear: 1991,
    note: '뮤추얼펀드 — NAV 1일 1회(시가=종가 가정), 분배금 포함. IEF(2002~) 이전 시대 커버',
  },
  {
    ticker: 'VBMFX', label: '미국 종합채권 펀드', group: '채권/현금 ETF', startYear: 1986,
    note: '뮤추얼펀드 — NAV 1일 1회(시가=종가 가정), 분배금 포함. AGG(2003~) 이전 시대 커버',
  },

  // ── 채권/현금 ETF ──
  { ticker: 'TLT', label: '미국 장기국채 20년+', group: '채권/현금 ETF', startYear: 2002 },
  { ticker: 'IEF', label: '미국 중기국채 7-10년', group: '채권/현금 ETF', startYear: 2002 },
  { ticker: 'IEI', label: '미국 중기국채 3-7년', group: '채권/현금 ETF', startYear: 2007 },
  { ticker: 'SHY', label: '미국 단기국채 1-3년', group: '채권/현금 ETF', startYear: 2002 },
  { ticker: 'AGG', label: '미국 종합채권', group: '채권/현금 ETF', startYear: 2003 },
  { ticker: 'SGOV', label: '미국 초단기국채 0-3개월', group: '채권/현금 ETF', startYear: 2020 },

  // ── 원자재 ──
  { ticker: 'GLD', label: '금 ETF', group: '원자재', startYear: 2004 },
  { ticker: 'IAU', label: '금 ETF (저보수)', group: '원자재', startYear: 2005 },
  { ticker: 'GC=F', label: '금 선물 (장기)', group: '원자재', startYear: 2000, note: '선물 근월물 — 롤오버 왜곡 가능. 보관·롤 비용 미반영' },
  {
    ticker: 'CEF', label: '금·은 실물 신탁 (최장)', group: '원자재', startYear: 1986,
    note: '실물 금(~2/3)+은(~1/3) 폐쇄형 신탁 — 순수 금이 아니고 NAV 대비 프리미엄/디스카운트가 변동. 80~90년대에 실제 매매 가능했던 금 노출',
  },

  // ── 크립토 ──
  { ticker: 'BTC-USD', label: '비트코인', group: '크립토', startYear: 2014 },
  { ticker: 'ETH-USD', label: '이더리움', group: '크립토', startYear: 2017 },
]

/** 티커의 에피스테믹 주의사항 (카탈로그 외 티커도 ^/=F 패턴으로 감지) */
export function assetCautionFor(ticker: string): string | null {
  const t = ticker.toUpperCase()
  const entry = ASSET_CATALOG.find((e) => e.ticker === t)
  if (entry?.note) return entry.note
  if (t.startsWith('^')) return PRICE_INDEX_NOTE
  if (t.endsWith('=F')) return '선물 근월물 — 롤오버 왜곡 가능'
  if (t.endsWith('-SIM')) return '가상 합성 자산 — 실존 상품이 아닌 시뮬레이션'
  if (t.endsWith('-HIST')) return HIST_NOTE_COMMON
  return null
}

/** 리포 번들 월간 합성 자산 여부 (-HIST) */
export function isBundleTicker(ticker: string): boolean {
  const t = ticker.toUpperCase()
  return ASSET_CATALOG.some((e) => e.ticker === t && e.source === 'bundle')
}
