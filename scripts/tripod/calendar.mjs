// 뉴욕증권거래소 정규 휴장일·거래일·미국 서머타임 (실전 추적용)
// 국장·재해 같은 임시 휴장은 미리 알 수 없으므로 정규 규칙만 계산한다(SPECIAL_CLOSURES는 과거 검증용 목록).
const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
const addDays = (s, k) => new Date(Date.parse(`${s}T00:00:00Z`) + k * 864e5).toISOString().slice(0, 10)

/** m월의 n번째 요일 wd(0=일)의 날짜. n = -1이면 마지막 */
function nthWeekday(y, m, wd, n) {
  if (n > 0) return 1 + ((wd - dow(y, m, 1) + 7) % 7) + (n - 1) * 7
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return last - ((dow(y, m, last) - wd + 7) % 7)
}

/** 부활절(그레고리력, 익명 알고리즘) → [월, 일] */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451)
  return [Math.floor((h + l - 7 * mm + 114) / 31), ((h + l - 7 * mm + 114) % 31) + 1]
}

/** 고정일 휴일의 대체: 토요일이면 금요일, 일요일이면 월요일. 새해 첫날이 토요일이면 대체 없음(거래소 규칙) */
function observed(y, m, d, { saturdayToFriday = true } = {}) {
  const w = dow(y, m, d)
  if (w === 6) return saturdayToFriday ? addDays(ymd(y, m, d), -1) : null
  if (w === 0) return addDays(ymd(y, m, d), 1)
  return ymd(y, m, d)
}

/** y년 정규 휴장일 목록 */
export function nyseHolidays(y) {
  const [em, ed] = easter(y)
  const out = [
    observed(y, 1, 1, { saturdayToFriday: false }),
    y >= 1998 ? ymd(y, 1, nthWeekday(y, 1, 1, 3)) : null, // 마틴 루서 킹 데이
    ymd(y, 2, nthWeekday(y, 2, 1, 3)), // 대통령의 날
    addDays(ymd(y, em, ed), -2), // 성금요일
    ymd(y, 5, nthWeekday(y, 5, 1, -1)), // 현충일
    y >= 2022 ? observed(y, 6, 19) : null, // 준틴스
    observed(y, 7, 4), // 독립기념일
    ymd(y, 9, nthWeekday(y, 9, 1, 1)), // 노동절
    ymd(y, 11, nthWeekday(y, 11, 4, 4)), // 추수감사절
    observed(y, 12, 25), // 성탄절
  ]
  // 다음 해 새해 첫날이 토요일이면 올해 12-31은 대체하지 않는다(observed가 null 반환)
  return out.filter(Boolean)
}

/** 과거 임시 휴장(검증용). 앞으로의 임시 휴장은 데이터가 들어오지 않는 것으로 드러난다 */
export const SPECIAL_CLOSURES = [
  '1994-04-27', '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', '2004-06-11', '2007-01-02',
  '2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09',
]

const cache = new Map()
export function isHoliday(s) {
  const y = +s.slice(0, 4)
  if (!cache.has(y)) cache.set(y, new Set(nyseHolidays(y)))
  return cache.get(y).has(s)
}
export const isWeekend = (s) => { const w = new Date(`${s}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6 }
export const isTradingDay = (s) => !isWeekend(s) && !isHoliday(s)
export function nextTradingDay(s) { let d = addDays(s, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d }

/** 미국 동부 서머타임 여부(3월 둘째 일요일 ~ 11월 첫째 일요일 전날) */
export function isUsDst(s) {
  const y = +s.slice(0, 4)
  return s >= ymd(y, 3, nthWeekday(y, 3, 0, 2)) && s < ymd(y, 11, nthWeekday(y, 11, 0, 1))
}

/** 그날 미국 정규장 마감(16:00 동부) 시각의 한국 시간 문자열 */
export function closeInKst(s) {
  const kst = new Date(Date.parse(`${s}T${isUsDst(s) ? '20' : '21'}:00:00Z`) + 9 * 3600e3)
  return `${kst.toISOString().slice(5, 10).replace('-', '-')} ${kst.toISOString().slice(11, 16)}`
}

const WD = ['일', '월', '화', '수', '목', '금', '토']
export const withWeekday = (s) => `${s}(${WD[new Date(`${s}T00:00:00Z`).getUTCDay()]})`
export { addDays }
