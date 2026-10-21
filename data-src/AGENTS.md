<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# data-src

## 목적

`scripts/build-history.mjs`의 **소스 CSV** (번들 생성 입력)와 `scripts/verify-history.mjs`의
**독립 대조 CSV** (`verify/`). 전부 커밋 대상 — 재현 가능한 백테스트의 전제
(벤더가 조용히 수정해도 결과가 바뀌지 않도록 스냅숏을 저장소에 고정).

## 소스 CSV (번들 입력)

| 파일 | 내용 | 범위 |
|------|------|------|
| `shiller-sp500-monthly.csv` | Shiller 예일 월간 데이터셋 미러 (S&P·배당·이익·CPI·GS10·실질계열·PE10, 10컬럼) | 1871-01~2026-06. **주의: 펀더멘털은 2023-06, CPI/GS10은 2023-09에서 갱신 중단**(이후 0.0) — FRED·TR 연장 접합 로직이 존재하는 이유 |
| `fred-macro-monthly.csv` | FRED 4시리즈: 상업어음(M13002...), TB3MS, GS10, CPIAUCNS | 1857-01~2026-06 |
| `fred-tips10-monthly.csv` | FII10 (10년 TIPS 실질금리) | 2003-01~2026-06 |
| `gold-monthly.csv` | 금 월간 가격 | 1833-01~2026-06 |
| `sp500tr-monthly-avg.csv` | S&P 500 TR 월평균 (Shiller 중단 이후 연장용) | 2023-05~2026-07 |

## verify/ — 교차 검증 전용 (번들에 미포함)

| 파일 | 용도 |
|------|------|
| `gspc-monthly-avg.csv` | ^GSPC 일별→월평균 재구성 (1950-01~) — Shiller와 독립 벤더 대조 |
| `irx-monthly-avg.csv` | ^IRX 월평균 (1960-01~) — TB3MS 대조 |
| `ief-adjclose-monthly-avg.csv` | IEF 총수익 (2002-07~) — GS10 파생 채권 근사 대조 |
| `spy-adjclose-monthly-avg.csv` | SPY 총수익 (2023-05~) — TR 연장 구간 대조 |

## tripod/ — 외부 매매법 재현 검증용 일봉 스냅숏 (번들·앱 미사용)

`scripts/tripod/fetch-data.mjs`가 야후 v8에서 받은 ^NDX ^VIX ^IRX ^GSPC QQQ QLD TQQQ SPY
일봉(`date,open,high,low,close,adjclose`)과 ETF 배당(`*-div.csv`). 수집일 2026-10-20.
비판적 점검(`critique.mjs`)용으로 같은 날 ^IXIC(1971~) ^RUT ^GDAXI ^FTSE ^N225 ^HSI ^KS11과
1970년부터의 ^IRX(`IRX-1971.csv`, 겹치는 구간은 `IRX.csv`와 같음)를 추가로 받았다.
기존 계열은 다시 받지 않는다(`fetch-data.mjs 이름…`으로 계열을 골라 받을 수 있음).
^NDX 시가는 1999년 이전 대부분 전일 종가 복사본이다. 소비자는 `scripts/tripod/`와
`docs/research/tripod-verification.md`뿐이므로, 다시 받으면 그 문서 수치도 함께 재계산할 것.

공통 형식: `Date`(`YYYY-MM` 또는 `YYYY-MM-DD`) + 값 컬럼.

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **손편집 금지.** 이 CSV들은 외부 소스의 스냅숏이다. 갱신은 원 소스에서 새로 받아
  통째로 교체하고, 교체 근거(소스 URL·받은 날짜)를 커밋 메시지에 남길 것.
- 갱신 후 필수 시퀀스: `node scripts/build-history.mjs` (인라인 assert 통과) →
  `node scripts/verify-history.mjs` (18체크, exit 0) → `npx vitest run`
  (tests/의 번들 앵커 — 수치가 정당하게 바뀌면 앵커 동반 갱신).
- `verify/` 파일을 소스 CSV와 같은 벤더 데이터로 바꾸면 안 된다 — 독립성이
  검증의 존재 이유 (A~B축은 서로 다른 벤더·전송 경로가 전제).
- Shiller 미러의 방법론 한계(월평균 가격 → 낙폭 과소, 1913 이전 재구성 CPI 접합,
  1957 이전 소급 합성 지수)는 `docs/research/negative-real-return-eras.md` §0 참조 —
  이 한계를 무시한 해석 문구를 앱에 넣지 말 것.

## 의존 관계

### 내부

- 소비자: `scripts/build-history.mjs`(소스), `scripts/verify-history.mjs`(소스+verify)
- 산출 하류: `public/data/history.json`·`history-assets.json`

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
