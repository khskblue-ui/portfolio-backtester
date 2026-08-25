# E2E 검수 스크립트

UI 변경 후 실행하는 자동 검수 2종. 빌드 산출물(dist)을 라이브 데이터 없이 서빙해
결정적으로 검사한다.

## 준비 (로컬 최초 1회)

```bash
npm i -D playwright
npx playwright install chromium
```

크로미엄을 직접 지정하려면 `CHROMIUM_PATH=/path/to/chromium` 환경변수를 쓴다.

## 실행

```bash
npm run build
node scripts/e2e/staticserver.mjs &          # http://127.0.0.1:4175
node scripts/e2e/e2e-fullaudit.mjs           # 오버플로·페이지 오류 — flagged 0이 통과
node scripts/e2e/e2e-wrapaudit.mjs           # 괄호 줄바꿈 품질 — 신규 findings 없어야 통과
```

- fullaudit: 홈/가이드 1·2부/역사(+구간 상세)/신호/백테스트(모바일 위저드 3단계 포함)를
  390·1280·1440에서 순회. 저작권 표기 존재, 헤더 라벨 부재도 함께 확인.
- wrapaudit: 허용 잔존(2026-08 기준 11건)은 22자 이상 절 단위 괄호의 본문 줄바꿈.
  그 외가 나오면 회귀 — `nbspShortParens` 적용 누락이나 새 컴포넌트일 가능성이 크다.
- 결과 리포트는 실행 디렉터리에 audit/, wrap-report.json으로 남는다(.gitignore 대상).
