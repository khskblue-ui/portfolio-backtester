<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# scripts/e2e

## 목적

UI 변경 후 실브라우저 검수 2종 (Playwright + Chromium). 빌드된 `dist`를 라이브 데이터
차단 상태로 서빙해 **결정론적** 결과를 얻는다. 상세 실행법은 이 디렉토리의 `README.md`.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `staticserver.mjs` | `dist` 정적 서버, 포트 **4175** (18줄, node:http). SPA 폴백 + **`/yf/*`·`/fred/*`는 의도적 404** — 검수 중 라이브 데이터 폴백 차단 장치 |
| `e2e-fullaudit.mjs` | 오버플로·페이지 오류 전수 검사 (115줄). 5뷰 × 3뷰포트(390×844 / 1280×900 / 1440×900), 모바일 3단계 위저드 포함, 네트워크 없이 `-HIST` 자산으로 백테스트 실주행(`bt_strategies_v1`에 SPX-HIST 70/CASH 30, 1960~1990 시드). 수평 스크롤 컨테이너 조상은 허용. 산출: `audit/report.json`. **통과 기준 flagged: 0** |
| `e2e-wrapaudit.mjs` | 괄호 줄바꿈 품질 (85줄). Range API로 "공백 있는 괄호 묶음이 두 줄에 걸침" 검출. 산출: `wrap-report.json`. **허용 잔존 11건** (22자 이상 절 단위 괄호 — 표준 조판). 새 검출 = `nbspShortParens` 미적용 의심 |
| `README.md` | 실행 순서·전제조건 원문 |

## AI 에이전트 지침

### 실행 전제 (매번 확인)

1. **Playwright는 package.json에 없다** — 최초 1회 `npm i -D playwright &&
   npx playwright install chromium`. 설치돼 있는지부터 확인할 것.
   크로미엄 경로 직접 지정: `CHROMIUM_PATH=... node scripts/e2e/...`.
2. 검수 대상은 `dist` — 먼저 `npm run build` (빌드가 낡았으면 헛검수).
3. 산출물 `audit/`·`wrap-report.json`은 gitignore 대상 — 커밋하지 말 것.

### 표준 시퀀스

```bash
npm run build
node scripts/e2e/staticserver.mjs &    # 4175
node scripts/e2e/e2e-fullaudit.mjs     # flagged 0 확인
node scripts/e2e/e2e-wrapaudit.mjs     # 잔존 ≤ 11 확인
```

### 판정 규약

- fullaudit flagged > 0 → 소스에서 원인 수정 후 재빌드·재검수 (검출 기준 완화 금지).
- wrapaudit 신규 검출 → 해당 텍스트 표면에 `nbspShortParens` 적용(상한 규약은
  `src/ui/AGENTS.md`) 또는 문구 단순화. 허용 잔존 11건 목록을 늘리는 변경은
  사용자 확인 필요.
- 뷰·뷰포트를 추가했으면 fullaudit의 대상 목록도 함께 확장할 것.

## 의존 관계

### 내부

- `dist/` (빌드 산출), `public/data/history-assets.json` (`-HIST` 실주행)

### 외부

- playwright (수동 설치), Chromium

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
