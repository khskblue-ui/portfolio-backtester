<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# tests

## 목적

**콘텐츠 무결성 앵커 테스트** 8파일 (~62케이스). 지배적 패턴: must-contain 문자열
앵커로 가이드·연대기·신호·번들의 수치와 문구를 고정한다 — 콘텐츠나 재생성 번들이
어긋나면 즉시 실패. 엔진 자체 테스트는 `src/core/__tests__/`에 있고, 여기는
"앱이 말하는 내용"의 회귀 방지 담당.

`src/` 밖에 있는 이유: 앱 tsconfig(브라우저 전용 타입) 밖에서 `node:fs`로 번들
JSON을 직접 읽기 위함 (history-bundle.test.ts 주석 참조). 따라서 **tsc -b
타입체크 범위 밖** — vitest 실행으로만 검증된다.

## 주요 파일

| 파일 | 앵커 대상 | 특징 |
|------|-----------|------|
| `now-signals.test.ts` | `assessNow()` 신호 판정 (~16케이스, 최대) | 규칙 경계 테스트 + 실제 번들 대조. 앵커 18개: "1929년 수준 초과"(CAPE 43.5), "2000년 닷컴 버블 수준"(44.2), 커브 날짜 등 |
| `trading-guide.test.ts` | 가이드 1부 (~9케이스) | 정확히 7챕터, `docs/guides/trading-discipline.md` 포팅 수치 일치 (4,353배, $146,614, 89.2% 계열) |
| `guide-content.test.ts` | 가이드 2부 (~8케이스) | 9 STEP 순서·구조, `**` 짝 맞음, quad 표 4셀, 용어 사전 커버리지·가나다 정렬 |
| `mania-story.test.ts` | 광기의 해부 (~6케이스) | 크기 대비 최고 앵커 밀도(10개): "−81.1%"(U+2212), dataAsOf "2026-07" 등 |
| `era-timelines.test.ts` | 역사 연대기 (~4케이스) | 국면 시간순·차트 윈도 정렬·YM 형식, "147.27"(오일 멜트업) 등 |
| `history-bundle.test.ts` | `public/data/history.json` (~5케이스) | 1900-01=100, 시리즈 길이 동일, 에피소드 깊이 하드코딩(−50.1, −47.1), PE 밴드 |
| `history-extra.test.ts` | 나스닥 오버레이 파서 (~11케이스) | 합성 CSV로 실패 경로·무결성 가드 집중 |
| `audit-regressions.test.ts` | 2026-07 감사 회귀 (~3케이스) | 중복 전략 라벨(`uniqueRunLabels`), 에피소드 메타 커버리지, 전액 손실 TWRR |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- **앵커는 콘텐츠 변경의 안전망이지 장애물이 아니다.** 앱 콘텐츠 수치를 정당하게
  바꿨다면 앵커도 같은 커밋에서 갱신한다. 반대로, 앵커를 먼저 고쳐서 테스트를
  통과시키는 방식은 금지 — 항상 콘텐츠 쪽 근거가 먼저.
- 마이너스 기호는 **U+2212(−)** — 하이픈(-)으로 쓰면 앵커가 조용히 어긋난다.
  콘텐츠 쪽 표기 규약과 동일.
- 번들 재생성(`scripts/build-history.mjs`) 후에는 history-bundle·now-signals·
  era-timelines가 새 수치와 어긋나는지 반드시 확인.
- 용어 사전 앵커는 `localeCompare('ko')` 가나다 정렬을 강제한다 — 항목 추가 시
  정렬 위치 준수.

### 실행

```bash
npx vitest run                          # 전체 (src/core/__tests__ 포함 ~170개)
npx vitest run tests/now-signals.test.ts
```

## 의존 관계

### 내부

- `src/ui/`의 콘텐츠·로직 모듈 (guideContent, tradingGuide, eraTimelines, nowSignals,
  maniaStory, episodeInfo, eraStories, historyExtra, common)
- `public/data/history.json` (node:fs 직접 읽기)
- 동기화 사슬: `docs/guides/trading-discipline.md` ↔ `src/ui/tradingGuide.ts` ↔ 이 앵커들

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
