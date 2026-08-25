<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# functions

## 목적

**Cloudflare Pages Functions** 프록시 3종 (CF 배포 경로 `npm run deploy`용).
브라우저의 CORS 제약을 우회해 시세·매크로 데이터를 중계한다. 세 함수 모두 같은 형태:
`export const onRequest: PagesFunction`, CORS 프리플라이트(OPTIONS→204), 경로
allowlist(오픈 프록시 방지), 한국어 오류 JSON, 실패 시 502.

각 하위 디렉토리는 `[[path]].ts` 단일 파일이라 별도 AGENTS.md 없이 여기서 설명한다.

## 하위 파일

| 파일 | 업스트림 | allowlist | 캐시 |
|------|----------|-----------|------|
| `yf/[[path]].ts` (67줄) | `query1.finance.yahoo.com` | 접두 `v8/finance/chart/`, `v8/finance/spark` → 외 403 | `max-age=3600, s-maxage=3600` (일별 데이터 — 변경 감지는 스냅샷 해시가 담당) |
| `fred/[[path]].ts` (53줄) | `fred.stlouisfed.org/graph/fredgraph.csv` | **정확히** `fredgraph.csv`만 → 외 403 | `max-age=3600`, Content-Type text/csv 강제 |
| `stooq/[[path]].ts` (64줄) | `stooq.com` | 접두 `q/d/l`만 → 외 403 | `max-age=3600, s-maxage=3600`, 브라우저 UA + Referer, 15s 타임아웃 |

## 플랫폼 대응 관계 (수정 시 반드시 함께 볼 것)

| 공개 경로 | Vercel (기본 배포) | Cloudflare (이 디렉토리) |
|-----------|--------------------|--------------------------|
| `/yf/*` | vercel.json 외부 리라이트 (**allowlist 없음**) | `yf/[[path]].ts` (allowlist 있음) |
| `/fred/*` | vercel.json 리라이트 (fredgraph.csv만) | `fred/[[path]].ts` |
| `/stooq/*` | `api/stooq.ts` 서버리스 함수 (미러 폴백 있음) | `stooq/[[path]].ts` (미러 없음) |
| dev 서버 | `vite.config.ts` server.proxy 3종 | 좌동 |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **프록시 동작 변경은 3곳 동시 수정**: 이 디렉토리 + `vercel.json`(또는 `api/`) +
  `vite.config.ts` dev 프록시. 한 곳만 고치면 배포 플랫폼별로 동작이 갈린다.
- allowlist는 오픈 프록시 방지 장치 — 새 업스트림 경로가 필요하면 allowlist에
  명시적으로 추가하고, 와일드카드 완화는 금지.
- **tsc -b 타입체크 범위 밖** (tsconfig가 src만 포함). `PagesFunction` 타입은
  wrangler 제공 — 수정 후 최소한 `npx eslint`와 배포 전 수동 확인.
- Stooq는 서버사이드 요청에 JS 봇 챌린지를 걸어 **현재 카탈로그에서 미사용**
  (README 참조). 인프라는 유지하되 재활성화는 실검증 후에.

### 테스트 요건

자동 테스트 없음. 변경 시 dev 프록시로 로컬 확인
(`npm run dev` 후 `/yf/v8/finance/chart/SPY?...` 등 실호출) 후 배포 검증.

## 의존 관계

### 내부

- 소비자: `src/core/data.ts` (`/yf`, `/stooq`), `src/ui/nowData.ts`·`historyExtra.ts` (`/fred`)

### 외부

- wrangler (배포·타입), Yahoo v8 chart API, FRED fredgraph.csv, Stooq CSV

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
