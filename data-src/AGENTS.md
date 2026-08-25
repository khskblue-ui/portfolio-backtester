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
