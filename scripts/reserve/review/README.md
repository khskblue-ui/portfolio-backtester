# 독립 리뷰어 실험 스크립트

`docs/research/reserve-plan/review.pdf`(독립 검토 종합)의 수치를 낸 스크립트다. 리뷰어 세 명이 각자
`scripts/reserve/build-report.mjs`의 `sim`을 옮겨 보고서 수치를 재현한 뒤 실험했다. 정리하지 않은 실험용 코드다.

- `logic/` 규칙 논리와 경계 상황. `sim2.mjs`가 계측과 수정안 스위치를 붙인 시뮬레이터, `verify.mjs`가 원본과 일치 확인,
  `sweep.mjs` 등이 시작일 320개 실험, `mc.mjs`가 무작위 극단 경로.
- `quant/` 검증 타당성. `lib.mjs`가 시뮬레이터, `t0_validate.mjs`가 보고서 수치 재현, `t1`~`t12`가 비교 기준, 민감도, 대안 실험.
- `practice/` 실제 실행. `lib.mjs`에 환율, 원화 현금, 점검 주기를 붙였다. **환율과 한국 단기 금리는 자료가 없어 리뷰어가
  기억으로 만든 근사치**라 환율이 들어간 결과는 방향만 본다.

자료 경로가 절대 경로(`/home/user/portfolio-backtester/data-src/reserve`)로 적힌 파일이 있다. 다른 위치에서 돌리려면 고쳐야 한다.
