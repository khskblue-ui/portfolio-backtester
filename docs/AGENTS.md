<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# docs

## 목적

프로젝트 문서 계층. 백테스터 스펙(PRD), 세션 인수인계(HANDOFF), 가이드 1부 원문(guides/),
데이터 검증·역사 리서치 근거(research/)를 담는다. 앱 콘텐츠의 수치는 이 문서들과
동기화 관계에 있으므로, 여기 있는 문서는 "참고 자료"가 아니라 **정합성 앵커**다.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `HANDOFF.md` | 세션 인수인계 — 작업 이력 타임라인, 도메인 규약, 미결 과제, 기각된 제안 목록. **새 세션은 루트 CLAUDE.md 다음에 이 문서를 읽을 것** |
| `PRD.md` | 백테스터 스펙 v1.1 (190줄). 데이터 이중 스트림(§3), 엔진 상태기계(§4), 한국 세제(§5), 지표(§6), 검증(§9), 리스크 레지스터(§10), UI 에피스테믹스(§11) |

## 하위 디렉토리

| 디렉토리 | 목적 |
|----------|------|
| `guides/` | `trading-discipline.md` (350줄) — 가이드 1부 "매매 습관 교정" **원문**. 앱 내 렌더는 `src/ui/tradingGuide.ts` |
| `research/` | 데이터 검증 리포트 2건: `data-verification-2026-07.md` (18개 체크 교차 검증), `negative-real-return-eras.md` (1900~ 실질 수익률 음(−) 구간 7개, 역사 차트 기초 자료) |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **`guides/trading-discipline.md` 수정 = 3중 동기화 의무**: 이 원문의 수치·문구를 바꾸면
  `src/ui/tradingGuide.ts`(앱 렌더 데이터)와 `scripts/verify-timing-math.mjs`(수치 재검증)를
  같이 바꾸고 `tests/trading-guide.test.ts` 앵커를 확인해야 한다. 단독 수정 금지.
- **PRD의 §번호는 코드 주석의 앵커다** (예: `engine.ts`의 `// §4.2`). 섹션 번호 체계를
  바꾸지 말 것. 스펙 변경은 v1.2 등 버전 표기와 함께 추가하는 방식으로.
- research/ 문서의 수치에는 검증 상태 라벨(`✅ 3-0 검증`, `✅ 재계산` 등)이 붙어 있다.
  라벨 없이 수치를 추가하거나, 재검증 없이 기존 수치를 고치지 말 것. 재계산 경로:
  `node scripts/build-history.mjs && node scripts/verify-history.mjs` (임계 초과 시 exit 1).
- HANDOFF.md는 세션 스냅숏 문서다. 큰 작업 단위가 끝나면 타임라인·미결 과제를 갱신하되,
  "기각/보류된 제안" 절의 항목(쌍 막대 도해, M2 갭 신호 등)은 지우지 말 것 — 재제안
  방지 장치다.

### 테스트 요건

문서 자체는 테스트 대상이 아니지만, 여기 수치를 인용하는 앱 콘텐츠는
`tests/trading-guide.test.ts` 등의 must-contain 앵커로 고정돼 있다.
문서 수치 변경 시 `npx vitest run`으로 동기화 깨짐을 확인.

## 의존 관계

### 내부

- `src/ui/tradingGuide.ts` — guides/trading-discipline.md의 앱 렌더 대응물 (3중 동기화)
- `scripts/verify-timing-math.mjs`, `scripts/verify-history.mjs` — 문서 수치의 재검증 스크립트
- `public/data/history.json` — research/ 리서치의 재계산 결과가 산출되는 번들

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
