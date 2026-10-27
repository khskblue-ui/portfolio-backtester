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

export type AssetGroup = '신호 전략' | '역사 월간 (1871~)' | '지수 (장기 히스토리)' | '주식 ETF' | '레버리지 (합성 소급)' | '채권/현금 ETF' | '원자재' | '크립토'

import type { SyntheticSpec } from './synthetic'
import { TRIPOD_SLEEVES } from './tripod'

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
  /** 실물 + 상장 전 합성 연결 (-EXT) — real 시작 전 구간을 synthetic(카탈로그의 다른 항목)으로 잇는다. 양쪽 모두 다시 연결 항목일 수 있다 */
  splice?: { real: string; synthetic: string }
  /** 자동완성 목록에서 숨김 (다른 상품을 만드는 내부 재료) */
  hidden?: boolean
  /**
   * 지수 총수익 재구성 — index 가격수익에 proxy ETF 분배금 수익률(전일 종가 대비)을 더하고, proxy 상장 뒤에는 그 보수를
   * 되돌려 총수익(gross)을 만든다(트라이팟 연구 buildProducts와 같은 정의). proxy 상장 전은 배당 없음
   */
  indexTotalReturn?: { index: string; proxy: string; proxyFeePct: number }
}

const PRICE_INDEX_NOTE = '가격지수 — 배당 미포함(총수익·배당세 과소). 매매 불가 지수를 보유 가능으로 가정'
const TR_INDEX_NOTE = '총수익지수 — 배당이 지수에 내재(배당 현금흐름·배당세 미계산). 매매 불가 지수를 보유 가능으로 가정'

const HIST_NOTE_COMMON =
  '역사 월간 합성 지수(Shiller 데이터 파생, 1871~) — 월간 해상도(월평균 가격)라 일중·일간 변동이 뭉개지고, ' +
  '배당 내재(총수익)라 배당 현금흐름·배당세가 계산되지 않으며, 매매 불가 지수를 보유 가능으로 가정합니다. ' +
  '일별 자산(ETF 등)과 같은 실행에 섞을 수 없고, 대공황·스태그플레이션 등 1900년대 구간 탐구 전용입니다'

const EXT_NOTE = (real: string, lev: number, since: string) =>
  `연결 시계열입니다. ${since} 상장 이후는 실물 ${real}, 그 전(1985-10~)은 나스닥100 지수(^NDX) 총수익의 일간 ${lev}배 − 차입비용(^IRX + 0.6%) − 보수로 ` +
  '만든 합성을 가격이 이어지게 붙였습니다. 총수익은 QQQ 분배금으로 재구성하고 QQQ 상장(1999-03) 전은 배당을 넣지 않았습니다(트라이팟 연구 문서와 같은 정의). ' +
  '합성 구간은 스왑 스프레드·추적오차가 빠져 소폭 낙관적이고, 1999-03 이전은 배당이 빠진 만큼 보수적입니다'

/** 트라이팟 가상 슬리브 안내 — 결과 화면 경고와 자동완성에 쓰인다 */
export const TRIPOD_NOTE =
  '신호 전략 슬리브입니다(실존 상품이 아니라 규칙). 매 거래일 나스닥100 종가가 250일선(위 1%·아래 5% 밴드)의 어느 쪽인지로 국면을 정하고, ' +
  'VIX 10일 평균과 52주 종가 고점 대비 낙폭으로 TQQQ 100% · QQQ 50%+QLD 50% · 현금 가운데 하나를 고릅니다. ' +
  '구성 상품은 QQQ-EXT·QLD-EXT·TQQQ-EXT(상장 전은 합성으로 연결)이고, 판정에 VIX가 필요해 1990-01 이후만 실행할 수 있습니다. ' +
  '신호가 바뀔 때의 교체는 실제 매도로 계산해 양도세를 해마다 정산합니다. 판정은 미국 종가 기준이고 체결 시점은 전략 카드에서 고릅니다(트라이팟 기본: 다음 거래일 종가). ' +
  '공개된 규칙의 과거 재현일 뿐이며, 규칙이 과거 데이터를 보고 만들어졌다는 한계(과최적화 가능성)가 있습니다'

export const TRIPOD_2X_SHORT_NOTE =
  '트라이팟과 같은 판정 규칙에서 3배 자리(TQQQ 100%)에 QLD 100%를 쓰는 2배판입니다(최대 2배). 구성 상품은 QQQ-EXT·QLD-EXT이고 그 밖의 가정·한계는 TRIPOD와 같습니다'

/** 결과·보고서의 자산 주의 목록 — 두 트라이팟 슬리브가 함께 있으면 2배판은 짧은 안내로 */
export function assetCautionList(tickers: string[]): [string, string][] {
  const uniq = [...new Set(tickers.map((t) => t.trim().toUpperCase()))]
  const both = uniq.includes('TRIPOD') && uniq.includes('TRIPOD-2X')
  const out: [string, string][] = []
  for (const t of uniq) {
    const c = both && t === 'TRIPOD-2X' ? TRIPOD_2X_SHORT_NOTE : assetCautionFor(t)
    if (c) out.push([t, c])
  }
  return out
}

export const ASSET_CATALOG: CatalogEntry[] = [
  // ── 신호 전략: 규칙이 매일 보유 상품을 바꾸는 가상 슬리브 (tripod.ts) ──
  {
    ticker: 'TRIPOD', label: `${TRIPOD_SLEEVES.TRIPOD.label} (신호로 TQQQ·QQQ+QLD·현금 전환)`, group: '신호 전략', startYear: 1999,
    note: TRIPOD_NOTE,
  },
  {
    ticker: 'TRIPOD-2X', label: `${TRIPOD_SLEEVES['TRIPOD-2X'].label} (3배 자리에 QLD, 최대 2배)`, group: '신호 전략', startYear: 1999,
    note: TRIPOD_NOTE.replace('TQQQ 100% · QQQ 50%+QLD 50% · 현금', 'QLD 100%(2배판) · QQQ 50%+QLD 50% · 현금').replace('QQQ-EXT·QLD-EXT·TQQQ-EXT', 'QQQ-EXT·QLD-EXT'),
  },

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
  {
    ticker: 'BILL-HIST', label: '단기국채/현금 (역사 월간)', group: '역사 월간 (1871~)', startYear: 1871, source: 'bundle',
    note: HIST_NOTE_COMMON + '. 현금: 3개월 T-bill(1934~, FRED TB3MS) + 1934년 이전 NY 상업어음 금리(NBER — 신용 프리미엄만큼 소폭 높음) 월 복리. 고정 유휴현금 금리 대신 실제 역사 단기금리로 현금을 보유하는 용도',
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
  {
    ticker: 'QQQ-EXT', label: '나스닥 100 (실물 QQQ + 상장 전 지수 합성 연결)', group: '주식 ETF', startYear: 1985,
    splice: { real: 'QQQ', synthetic: 'QQQ-NDX-SIM' },
    note:
      '연결 시계열입니다. 1999-03-10 상장 이후는 실물 QQQ, 그 이전(1985-10~)은 나스닥100 가격지수(^NDX)에서 연 0.2% 보수를 뺀 합성입니다. ' +
      '상장 전 구간은 배당을 넣지 않아 실제보다 조금 낮게 나오고(트라이팟 연구 문서 §2.2와 같은 가정), 야후 ^NDX의 1999년 이전 시가는 대부분 ' +
      '전일 종가 복사본이라 그 구간의 시가 체결 결과는 정확하지 않습니다. 1999~2003년 야후 QQQ 일별 종가는 지수와 하루 1%p 넘게 어긋나는 날이 ' +
      '많습니다(장기 보유 수익에는 영향이 작음)',
  },
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
    note: '가상 합성 자산 — 실존 ETF가 아니라 QQQ 일간수익×3 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능. 야후의 1999~2003년 QQQ 일별 종가는 나스닥100 지수와 하루 1%p 넘게 어긋나는 날이 많아(2000년 75일) 그 어긋남이 3배로 커지므로, 그 시기에는 지수 기반 합성을 잇는 TQQQ-EXT가 더 정확합니다',
  },
  {
    ticker: 'QLD-SIM', label: '나스닥100 2배 합성 (닷컴버블 소급)', group: '레버리지 (합성 소급)', startYear: 1999,
    synthetic: { base: 'QQQ', leverage: 2, expensePct: 0.95, borrowSpreadPct: 0.6 },
    note: '가상 합성 자산 — 실존 ETF가 아니라 QQQ 일간수익×2 − 차입비용(^IRX 실제 단기금리+0.6%) − 보수의 소급 시뮬레이션. 스왑 스프레드·추적오차 미반영(실제보다 소폭 낙관적), 배당 내재(배당세 미계산). 실물 상장 이후 구간에서 실제 ETF와 겹쳐 검증 가능. 야후의 1999~2003년 QQQ 일별 종가는 나스닥100 지수와 하루 1%p 넘게 어긋나는 날이 많아(2000년 75일) 그 어긋남이 2배로 커지므로, 그 시기에는 지수 기반 합성을 잇는 QLD-EXT가 더 정확합니다',
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
  {
    ticker: 'QLD-EXT', label: '나스닥100 2배 (실물 + 상장 전 합성 연결)', group: '레버리지 (합성 소급)', startYear: 1985,
    splice: { real: 'QLD', synthetic: 'QLD-NDX-SIM' }, note: EXT_NOTE('QLD', 2, '2006-06'),
  },
  {
    ticker: 'TQQQ-EXT', label: '나스닥100 3배 (실물 + 상장 전 합성 연결)', group: '레버리지 (합성 소급)', startYear: 1985,
    splice: { real: 'TQQQ', synthetic: 'TQQQ-NDX-SIM' }, note: EXT_NOTE('TQQQ', 3, '2010-02'),
  },
  // ── 연결 상품의 내부 재료 (자동완성 숨김): 나스닥100 지수 총수익 기반 합성 ──
  // 레버리지 ETF는 지수(미국 16:00 종가)를 따르므로 상장 전 구간을 지수로 만든다. 야후의 1999~2003년 QQQ 일별 종가는
  // 지수와 하루 1%p 넘게 어긋나는 날이 많아(2000년 75일) QQQ 기반 합성(-SIM)은 그 어긋남이 배수만큼 커진다
  {
    ticker: '^NDX-TR', label: '나스닥100 총수익 재구성 (내부)', group: '지수 (장기 히스토리)', startYear: 1985, hidden: true,
    indexTotalReturn: { index: '^NDX', proxy: 'QQQ', proxyFeePct: 0.2 },
  },
  {
    ticker: 'QQQ-NDX-SIM', label: '나스닥100 1배 지수 합성 (내부)', group: '레버리지 (합성 소급)', startYear: 1985, hidden: true,
    synthetic: { base: '^NDX-TR', leverage: 1, expensePct: 0.2, borrowSpreadPct: 0 },
  },
  {
    ticker: 'QLD-NDX-SIM', label: '나스닥100 2배 지수 합성 (내부)', group: '레버리지 (합성 소급)', startYear: 1985, hidden: true,
    synthetic: { base: '^NDX-TR', leverage: 2, expensePct: 0.95, borrowSpreadPct: 0.6 },
  },
  {
    ticker: 'TQQQ-NDX-SIM', label: '나스닥100 3배 지수 합성 (내부)', group: '레버리지 (합성 소급)', startYear: 1985, hidden: true,
    synthetic: { base: '^NDX-TR', leverage: 3, expensePct: 0.86, borrowSpreadPct: 0.6 },
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
  if (t.endsWith('-EXT')) return '연결 시계열(상장 전 구간은 합성 자산)'
  if (t.endsWith('-HIST')) return HIST_NOTE_COMMON
  return null
}

/** 리포 번들 월간 합성 자산 여부 (-HIST) */
export function isBundleTicker(ticker: string): boolean {
  const t = ticker.toUpperCase()
  return ASSET_CATALOG.some((e) => e.ticker === t && e.source === 'bundle')
}
