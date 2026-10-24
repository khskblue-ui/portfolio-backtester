# 트라이팟 실전 추적

매 거래일 미국 장 마감 뒤 트라이팟 규칙으로 국면과 목표 비중을 판정하고, 신호가 바뀌면 알린다. 사전 등록한 후보 전략 4개와 QQQ 보유도 함께 가상 추적한다.

- **지금 상태**: [STATUS.md](STATUS.md)
- 매일 판정 기록(추가만 함, 한 번 기록한 판정은 고치지 않음): [log.csv](log.csv)
- 상태·알림 기록: [state.json](state.json)
- 규칙 검증: [tripod-verification.md](../../docs/research/tripod-verification.md), 후보 평가: [tripod-alternatives.md](../../docs/research/tripod-alternatives.md)

규칙을 기계적으로 판정한 결과이며 투자 권유가 아니다. 저장소가 공개라서 이 폴더와 알림 이슈도 공개된다. 판정은 공개 데이터에서 나오는 값만 담고 개인 보유 정보는 담지 않는다.

## 어떻게 돌아가나

| 단계 | 내용 |
|---|---|
| 실행 | GitHub Actions `tripod-signal` 워크플로가 평일 UTC 22:20(한국 07:20)에 돌고, 데이터 지연에 대비해 UTC 01:40에 한 번 더 돈다 |
| 데이터 | 야후 ^NDX·^VIX·^IRX 일봉(실패하면 FRED NASDAQ100·VIXCLS로 대체), 가상 추적은 QQQ·QLD·TQQQ 수정종가 |
| 판정 | 백테스트와 같은 코드(`scripts/tripod/strategies.mjs` → `lib.mjs`)를 그대로 쓴다. 실행 전에 자체 검사(`selftest.mjs`) 13건을 먼저 통과해야 한다 |
| 체결 기준 | t일 종가로 판정 → **다음 거래일 종가에 체결**(검증에서 영상 수치를 재현한 해석). 휴장일은 뉴욕증권거래소 정규 규칙으로 계산 |
| 기록 | `STATUS.md`·`state.json`·`log.csv`를 커밋한다. 이 폴더만 바뀐 커밋은 Vercel 배포를 건너뛴다(`vercel.json`의 `ignoreCommand`) |

## 알림 받기

신호가 바뀐 날 한 번만 알린다(재실행해도 중복 없음). 기본은 트라이팟만 알린다.

1. **GitHub 이슈(설정 불필요)**: `tripod-signal` 라벨 이슈가 열리고 저장소 소유자에게 배정된다. GitHub 알림 설정(Settings → Notifications)에서 이메일을 켜 두면 메일로 온다. 앞선 신호 이슈는 자동으로 닫힌다.
2. **휴대폰 푸시(선택, 무료)**: ntfy 앱을 설치하고 남이 추측하기 어려운 주제 이름(예: `tripod-` 뒤에 무작위 문자열)을 구독한 뒤, 저장소 Settings → Secrets and variables → Actions → Secrets에 `NTFY_TOPIC`으로 같은 이름을 넣는다.
3. **텔레그램(선택)**: 봇을 만들어 `TELEGRAM_BOT_TOKEN`, 받을 대화방 번호를 `TELEGRAM_CHAT_ID` 시크릿으로 넣는다.
4. **알릴 전략 바꾸기(선택)**: Actions → Variables에 `NOTIFY_STRATEGIES`를 쉼표로 넣는다. 예: `tripod,t2` (기호: `tripod` 트라이팟, `t2` 2배판, `te3`, `tev3`, `tev2`).

알림 경로 시험: Actions → tripod-signal → Run workflow에서 `test_notify`를 켜고 실행하면 시험 메시지가 간다. 워크플로가 실패하면(데이터 수집 실패 등) GitHub가 실패 메일을 보낸다.

## 알림을 받으면

- 알림의 "체결" 날짜는 미국 거래일이다. 그날 **미국 정규장 종가 무렵**에 비중을 맞춘다. 한국 시간으로는 그다음 날 새벽(서머타임 중 05:00, 해제 뒤 06:00 마감)이다.
- 증권사가 장 마감 주문(MOC·LOC)을 지원하면 그것을 쓰고, 아니면 마감 직전에 주문한다. 백테스트는 종가 체결과 편도 0.05% 비용을 가정했다.
- `STATUS.md`의 "경계선"은 다음 거래일에 어느 값에서 신호가 바뀌는지 보여 준다(250일선·52주 고점은 오늘 값으로 근사).

## 직접 실행

```bash
node scripts/tripod/live.mjs --dry       # 지금 판정만 화면에 출력(파일 쓰지 않음)
node scripts/tripod/live.mjs             # 판정 + 이 폴더 갱신
node scripts/tripod/live.mjs --offline   # 네트워크 없이 data-src 스냅숏으로 계산(검사용)
node scripts/tripod/selftest.mjs         # 규칙·달력·데이터 구성 자체 검사
```

## 한계

- 임시 휴장(국장, 재해)은 미리 알 수 없다. 그런 날은 데이터가 들어오지 않아 판정이 하루 밀린다.
- 야후 데이터가 늦게 확정되면 첫 실행은 전날 VIX로 계산하고 알리지 않는다. 재실행(UTC 01:40)에서 다시 판정한다.
- GitHub는 공개 저장소에서 60일 동안 활동이 없으면 예약 워크플로를 멈춘다. 매 거래일 기록 커밋이 활동이 되므로 보통은 멈추지 않지만, 멈추면 Actions 화면에서 다시 켜야 한다.
- 가상 추적은 세전이다. 세후 비교는 연구 문서 §8의 모델을 따른다.
