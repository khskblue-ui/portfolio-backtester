<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# src

## 목적

앱 소스 루트. 순수 TS 백테스트 엔진(`core/`)과 React 화면(`ui/`) 사이를 잇는
셸 레이어(App.tsx)와 전역 기반(엔트리·CSS·공용 유틸·훅)을 담는다.
경로 별칭 `@/`가 `src/`를 가리킨다(예: `@/core`, `@/hooks/usePersistentState`).

## 주요 파일

| 파일 | 설명 |
|------|------|
| `App.tsx` | 앱 셸 (589줄). 뷰 라우팅 단일 원천(`View` = `home\|guide\|history\|now\|backtest`), 테마(`bt_theme`), 전략·공통설정 영속(`bt_strategies_v1`/`bt_shared_v1`), 백테스트 실행 오케스트레이션, lg+ 좌측 레일 + 모바일 하단 탭바, 워크벤치 분할 + 모바일 3단계 위저드, JSON 가져오기/내보내기 |
| `main.tsx` | Vite 엔트리 (10줄) — StrictMode로 App 마운트, index.css import |
| `fetchUtil.ts` | `fetchWithTimeout()` (15줄). iOS Safari 16 이하가 `AbortSignal.timeout()` 미지원이라 수동 AbortController 사용 — 이 호환성이 존재 이유 |
| `index.css` | Tailwind v4 엔트리 + 전역 기반 (109줄). `@custom-variant dark`, IBM Plex Sans KR + `word-break: keep-all`, `@media print`(`.print-report`/`.no-print`/`.page-break`), 표 tabular-nums, `.btn-primary`/`.ink-chip`은 Tailwind `dark:` 특이성 동점 문제로 실클래스화 |

## 하위 디렉토리

| 디렉토리 | 목적 |
|----------|------|
| `core/` | 결정론 백테스트 엔진 — 데이터·엔진·세금·지표, React 무관 순수 TS (`core/AGENTS.md` 참조) |
| `ui/` | 화면 전체 — 컴포넌트 15 + 콘텐츠/로직 모듈 11 (`ui/AGENTS.md` 참조) |
| `hooks/` | `usePersistentState.ts` 단일 파일 (27줄) — localStorage 동기화 useState. 키에 스키마 버전을 넣어 구조 변경 시 자연 리셋, JSON 파싱 실패는 초기값 폴백 |

## AI 에이전트 지침

### 이 디렉토리에서 작업할 때

- App.tsx는 상태의 단일 원천이다. 뷰 추가 시 `View` 타입 + 내비 탭 테이블 +
  조건 렌더 스위치를 함께 갱신하고, 좌측 레일(lg+)과 하단 탭바(모바일) 양쪽에 반영할 것.
- 테마 색 선택(전략 팔레트 light/dark)은 App에서 이뤄져 하위로 내려간다 —
  컴포넌트에서 테마를 재판정하지 말 것.
- 영속 상태는 `usePersistentState` 경유가 원칙 (`bt_theme`만 역사적 예외).
- core는 React를 몰라야 한다 — src/core에 React import를 추가하지 말 것.

### 테스트 요건

`npx tsc --noEmit && npx eslint <변경 파일> && npx vitest run && npm run build`.
UI 변경 시 `scripts/e2e/` 검수 추가 (루트 CLAUDE.md 워크플로 참조).

## 의존 관계

### 내부

- `core/` ← `ui/`·`App.tsx` 방향으로만 의존 (역방향 금지)
- `public/data/history.json` — HomeView/NowView/HistoryView가 fetch하는 번들

### 외부

- react 19 · react-dom, recharts 3, lucide-react, tailwindcss 4 (+ @tailwindcss/vite), vite 7

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존됩니다 -->
