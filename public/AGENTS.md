<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# public

## 목적

Vite가 그대로 서빙하는 정적 자산. 파비콘류와, **생성된** 역사 데이터 번들(`data/`).
참고: publicDir 특성상 이 디렉토리의 모든 파일(이 AGENTS.md 포함)은 빌드 시 dist에
복사되어 배포 사이트에서도 접근 가능하다 — 저장소가 공개라 문제는 없으나,
비공개여야 할 파일은 여기 두지 말 것.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `favicon.svg` | 파비콘 (index.html에서 `?v=2` 캐시버스팅으로 참조) |
| `apple-touch-icon.png` | iOS 홈 화면 아이콘 |

## data/ — 생성된 번들 (손편집 금지)

두 파일 모두 `scripts/build-history.mjs`가 생성한 minified 단일행 JSON이며 **커밋 대상**
(정적 SPA라 배포 파일이 곧 데이터베이스). 직접 편집하지 말고 항상 재생성할 것.

| 파일 | 구조 |
|------|------|
| `history.json` (~190KB) | `meta`(sources·method·`dataEnd: 2026-05`·liveRefs) + `series`(실질/명목 stock·bond·gold·bill — 길이 1517의 병렬 배열, 1900-01=100) + `macro`(cpiYoY·gs10·realRate10·cape·capeProxy·tbill3m·tips10·peTrail·peFwdReal — 일부 구간 null) + `episodes`(약세 7건: peak/trough/recovery/underwaterMonths/depthPct/assets) |
| `history-assets.json` (~163KB) | `meta`(한국어 note: 명목·총수익·월평균 해상도) + `assets` 4종: `SPX-HIST`·`UST10-HIST`·`GOLD-HIST`·`BILL-HIST` — 각 `{dates, close}`. 백테스터 `-HIST` 자산과 e2e 실주행의 데이터 원천 |

소비자: HISTORY·NOW·HOME 탭(fetch), `src/core/data.ts`(`-HIST` 로더 — localStorage
캐시 우회, 배포 파일 자체가 캐시 버전), `tests/history-bundle.test.ts`(node:fs),
`scripts/timing-math.mjs`·`verify-timing-math.mjs`.

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **`data/*.json`은 절대 손편집하지 말 것.** 수정 경로는 단 하나:
  `data-src/` 갱신 → `node scripts/build-history.mjs` → `node scripts/verify-history.mjs`
  → `npx vitest run` → 재생성된 JSON 커밋.
- 번들 스키마(키 추가·배열 구조 변경)를 바꾸면 위 소비자 전부와
  `tests/history-bundle.test.ts` 구조 앵커를 함께 갱신해야 한다.
- `dataEnd`가 최신 데이터 기준월이다 — 번들 갱신 시 신호 카드·연대기 앵커
  (`tests/now-signals.test.ts` 등)와 어긋나는지 확인.
- 새 정적 자산은 해시 없는 파일명이므로 캐시버스팅이 필요하면 index.html처럼
  쿼리 버전(`?v=N`)을 쓸 것.

## 의존 관계

### 내부

- 생성자: `scripts/build-history.mjs` / 검증자: `scripts/verify-history.mjs`
- 소비자: 위 data/ 절 참조

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
