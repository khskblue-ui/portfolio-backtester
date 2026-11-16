#!/bin/sh
# Vercel ignoreCommand: 종료 코드 0이면 배포를 건너뛰고, 1이면 빌드한다.
# signals/ 폴더만 바뀐 커밋(매 거래일 자동 기록)은 건너뛴다.
# Vercel은 최근 10개 커밋만 복제하므로, 직전 배포 커밋이 그 밖에 있으면 따로 받아 온다.
# 그래도 없으면 빌드한다(git diff가 bad object로 죽어 배포가 ERROR로 끝나는 것을 막는다).
prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$prev" ] || exit 1
git cat-file -e "$prev^{commit}" 2>/dev/null ||
  GIT_TERMINAL_PROMPT=0 git fetch --quiet --depth=1 origin "$prev" 2>/dev/null
git cat-file -e "$prev^{commit}" 2>/dev/null || exit 1
git diff --quiet "$prev" HEAD -- . ':(exclude)signals' && exit 0
exit 1
