<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# portfolio-backtester — 투자의 정석

## 목적

투자 교육 3면(가이드북 1·2부, 126년 역사 연구, 현재 신호) + 도구 1면(설정형 포트폴리오
백테스터) + 홈 콕핏. **백엔드 없는 정적 SPA** (React 19 + Vite 7 + Tailwind 4).
시세는 브라우저가 프록시(/yf·/fred·/stooq) 경유로 직접 조회하고, 1900~ 월간 역사는
검증된 정적 번들(`public/data/`)을 쓴다.
공개 서비스: https://portfolio-backtester-chi.vercel.app/ (main 푸시 → Vercel 자동 배포).

**읽는 순서**: 루트 `CLAUDE.md`(사용자 표준 규칙·검증 워크플로 — 권위 원천) →
`docs/HANDOFF.md`(작업 이력·도메인 규약·미결 과제) → 작업할 디렉토리의 AGENTS.md.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `CLAUDE.md` | 사용자 표준 규칙 7조 + 검증 워크플로 + 아키텍처 지도. **모든 세션에서 유효** |
| `README.md` | 빠른 시작, PV 대비 차별점 4가지, 장기 히스토리 자산 표, `-SIM` 합성 레버리지 설명, v1 한계 |
| `package.json` | scripts: `dev`/`build`(tsc -b + vite build)/`lint`/`test`(vitest run)/`preview`/`deploy`(wrangler pages). **Playwright는 의도적으로 devDeps에 없음** (e2e는 수동 설치). `scripts/*.mjs` 데이터 도구용 npm 래퍼도 없음(직접 `node`로 실행) |
| `vite.config.ts` | 별칭 `@` → `./src`, recharts manualChunks 분리, dev 프록시 3종(`/yf`·`/fred`·`/stooq` — 프로덕션 프록시와 1:1 대응, 주석에 명시) |
| `vercel.json` | 리라이트 5건: `/yf/:path*` → Yahoo(외부 리라이트, **경로 allowlist 없음** — CF 버전과의 차이), `/fred/fredgraph.csv` → FRED, `/stooq` 3변형 → `api/stooq` 함수. `/yf` 캐시 헤더 1건 |
| `wrangler.toml` | Cloudflare Pages 대체 배포 (`npm run deploy`, 출력 dist) |
| `tsconfig.json` | 솔루션 파일(app/node 참조만). **`tests/`·`api/`·`functions/`는 tsc -b 타입체크 범위 밖** — 해당 파일들이 타입을 수제 선언하는 이유 |
| `eslint.config.js` | flat config, `**/*.{ts,tsx}`만 대상 (`scripts/*.mjs`는 언린트) |
| `index.html` | `lang="ko"`, IBM Plex Sans KR + Mono (Google Fonts, display=swap), theme-color `#2962ff`, viewport-fit=cover |

## 하위 디렉토리

| 디렉토리 | 목적 |
|----------|------|
| `src/` | 앱 소스 — 셸·엔트리 (`src/AGENTS.md` 참조) |
| `src/core/` | 결정론 백테스트 엔진, React 무관 순수 TS (`src/core/AGENTS.md`) |
| `src/ui/` | 화면 26파일 — 컴포넌트 15 + 콘텐츠/로직 모듈 11 (`src/ui/AGENTS.md`) |
| `tests/` | 콘텐츠 무결성 앵커 테스트 8파일 (`tests/AGENTS.md`) |
| `scripts/` | 데이터 번들 빌드·수치 재검증 도구 (`scripts/AGENTS.md`) |
| `scripts/e2e/` | Playwright UI 검수 2종 (`scripts/e2e/AGENTS.md`) |
| `functions/` | Cloudflare Pages 프록시 함수 3종 (`functions/AGENTS.md`) |
| `api/` | Vercel 서버리스 함수 — stooq 프록시 (`api/AGENTS.md`) |
| `data-src/` | 번들 소스 CSV + 교차 검증 CSV (`data-src/AGENTS.md`) |
| `public/` | 정적 자산 + **생성된** 데이터 번들 (`public/AGENTS.md`) |
| `docs/` | PRD·HANDOFF·가이드 1부 원문·리서치 (`docs/AGENTS.md`) |

## AI 에이전트 지침

### 이 저장소에서 작업할 때 (CLAUDE.md 요약 — 원문이 권위)

1. 작업 단위마다 커밋·푸시하고 Vercel 배포 READY 확인 (로컬에만 남기지 말 것 —
   사용자는 공용 컴퓨터 사용).
2. 앱 콘텐츠 이모지 금지 (아이콘은 lucide-react만).
3. 수치·역사 서술은 컨센서스 수준 검증값만 — 기존 검증 수치와 어긋나는 새 수치 창작 금지.
4. em-dash 남용 금지 (제목·결측 표시·보호 인용 예외), 번역투·AI 문체 지양.
5. 동기화 의무 3종: 가이드 인용(`quotes[].quote` ↔ 앱 원문), 1부 수치
   (`tradingGuide.ts` ↔ `docs/guides/trading-discipline.md` ↔ `verify-timing-math.mjs`),
   콘텐츠 수치 ↔ `tests/` must-contain 앵커.
6. 짧은 괄호 묶음 줄바꿈 방지: `nbspShortParens` (src/ui/common.ts).

### 검증 워크플로 (변경 후 필수)

```bash
npx tsc --noEmit && npx eslint <변경 파일> && npx vitest run && npm run build
# UI 변경 시 추가 (Playwright 필요):
node scripts/e2e/staticserver.mjs &   # dist를 4175로 서빙
node scripts/e2e/e2e-fullaudit.mjs    # 오버플로 0건이 통과 기준
node scripts/e2e/e2e-wrapaudit.mjs    # 괄호 줄바꿈 (허용 잔존 11건)
```

테스트는 약 170개. Vercel 배포 확인용 projectId/teamId는 `docs/HANDOFF.md` §1.

## 의존 관계

### 외부

- 런타임: react 19, react-dom, recharts 3 (차트), lucide-react (아이콘)
- 빌드: vite 7 (+@vitejs/plugin-react), tailwindcss 4 (+@tailwindcss/vite), typescript 5.9
- 품질: vitest 4, eslint 9 (+typescript-eslint 8), wrangler 4 (CF 배포)
- 데이터 업스트림: Yahoo v8 chart API, FRED fredgraph.csv, (Stooq — 봇 챌린지로 현재 미사용)

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
