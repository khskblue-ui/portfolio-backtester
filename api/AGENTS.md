<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# api

## 목적

**Vercel 서버리스 함수** 디렉토리. 현재 `stooq.ts` 하나 — Stooq 일별 CSV
(`/stooq/q/d/l/?s=<sym>&i=<interval>`, 장기 금 현물 XAUUSD 1968~ 용) 프록시.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `stooq.ts` | Stooq CSV 프록시 (68줄). 리라이트가 아닌 함수인 이유: Stooq는 `/q/d/l/`의 **말미 슬래시가 필수**인데 Vercel 경로 리라이트가 이를 떨어뜨려 404가 남 → 함수가 URL을 직접 조립. `stooq.com` 실패 시 `stooq.pl` **미러 폴백**. 심볼 allowlist 정규식 `^[a-z0-9._^=-]{1,24}$`(오픈 프록시 방지), 15s 타임아웃, 성공 판정은 `r.ok && body.startsWith('Date')`, 캐시 `max-age=3600, s-maxage=86400` |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- `@vercel/node` 타입 의존을 피하려고 요청/응답 인터페이스를 **수제 선언**했다
  (tsc -b 범위 밖이기도 함). 의존성 추가 없이 이 패턴 유지.
- Cloudflare 쪽 쌍둥이는 `functions/stooq/[[path]].ts` — 검증 방식이 다르다
  (여기는 심볼 정규식+미러, CF는 경로 접두). 동작 변경 시 양쪽과 `vercel.json`
  리라이트 3변형(`/stooq/q/d/l/`·`/stooq/q/d/l`·`/stooq/:path*`)을 함께 점검.
- **Stooq는 2026-07 확인 기준 서버사이드 봇 챌린지로 프록시 사용 불가** — 앱
  카탈로그에서 미사용 상태다. 이 함수를 지우지는 말 것(인프라 보존, README에 문서화됨).

### 테스트 요건

자동 테스트 없음. 로컬은 vite dev 프록시로, 배포 후엔
`/stooq/q/d/l/?s=xauusd&i=m` 실호출로 확인 (현재는 봇 챌린지 응답이 정상 결과).

## 의존 관계

### 내부

- `vercel.json`의 `/stooq` 리라이트 3건이 이 함수로 향함
- 잠재 소비자: `src/core/data.ts`의 `fetchStooqSeries` (현재 카탈로그 미사용)

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
