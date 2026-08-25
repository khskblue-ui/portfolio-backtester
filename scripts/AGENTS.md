<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# scripts

## 목적

데이터 번들 생성과 수치 재검증 도구 (Node ESM `.mjs`, npm 래퍼 없이 `node`로 직접 실행,
eslint 대상 밖). 철학: **앱이 말하는 모든 역사 수치는 여기서 재현·재검증 가능해야 한다.**
빌드 스크립트는 앵커 assert를 품고 있어 소스 데이터가 어긋나면 시끄럽게 실패한다.

## 주요 파일

| 파일 | 설명 |
|------|------|
| `build-history.mjs` | 데이터 파이프라인 (493줄). `data-src/*.csv` 파싱 → 1871~현재 월간 시리즈 접합(Shiller+FRED+TR연장) → 1900-01=100 정규화 → 약세 에피소드 검출(실질 낙폭 ≤−25% AND 수면하 ≥36개월) → `public/data/history.json` + `history-assets.json` 산출. 인라인 assert가 접합점·매크로 앵커 검증 |
| `verify-history.mjs` | 번들 교차 검증 (246줄). 4개 축 18체크: (A) Shiller 미러 vs FRED 원본, (B) Yahoo 일별 독립 재구성(`data-src/verify/`), (C) SBBI 1926~2023 기하평균, (D) 수학 항등식. **임계 초과 시 exit 1**. 결과는 `docs/research/data-verification-2026-07.md`에 수기 기록 |
| `timing-math.mjs` | 가이드 1부 "타이밍 실패의 수학" 수치 계산 (185줄). 30년 롤링 시나리오(완벽/최악/즉시/DCA/현금), 최고·최악 월 결측, 60/40 리밸런스 vs 방치. stdout 전용 — 결과를 `docs/guides/trading-discipline.md`에 수기 반영 |
| `verify-timing-math.mjs` | timing-math 재검증 (199줄). **의도적으로 다른 구현**(프리픽스 곱, 로그 합, 대안 상태기계)으로 전 수치 재계산해 문서 하드코딩 값과 대조 (기본 톨러런스 0.5%). exit 1 on fail |

## 하위 디렉토리

| 디렉토리 | 목적 |
|----------|------|
| `e2e/` | Playwright UI 검수 2종 — 오버플로·괄호 줄바꿈 (`e2e/AGENTS.md` 참조) |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **표준 재생성 시퀀스**: `data-src/` CSV 갱신 → `node scripts/build-history.mjs` →
  `node scripts/verify-history.mjs` (exit 0 확인) → `npx vitest run`(번들 앵커 테스트) →
  번들 JSON과 함께 커밋.
- verify 스크립트의 존재 이유는 **독립 구현 대조**다. verify 쪽을 본 구현과 같은
  방식으로 "정리"하면 검증력이 사라진다 — 구현 다양성을 유지할 것.
- `timing-math.mjs` 수치 변경은 3중 동기화 의무 발동: `docs/guides/trading-discipline.md` +
  `src/ui/tradingGuide.ts` + `verify-timing-math.mjs`의 기대값.
- 새 데이터 소스 추가 시 build-history의 접합점 assert와 verify-history의 대조 축을
  함께 추가한다 — 검증 없는 시리즈를 번들에 넣지 말 것.

### 실행 요약

```bash
node scripts/build-history.mjs      # 번들 재생성 (public/data/에 쓰기)
node scripts/verify-history.mjs     # 교차 검증 18체크
node scripts/timing-math.mjs        # 가이드 수치 리포트 (읽기 전용)
node scripts/verify-timing-math.mjs # 가이드 수치 재검증
```

## 의존 관계

### 내부

- 입력: `data-src/*.csv`, `data-src/verify/*.csv`, `public/data/history.json`
- 출력: `public/data/history.json`, `public/data/history-assets.json`
- 하류 소비자: `tests/history-bundle.test.ts` 등 번들 앵커, HISTORY/NOW 탭, `-HIST` 자산

### 외부

- 없음 (Node 표준 라이브러리만 — package.json 의존성 무관)

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
