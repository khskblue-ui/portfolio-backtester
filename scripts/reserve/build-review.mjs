// 독립 검토 종합 보고서 (HTML → PDF). 세 리뷰어(규칙 논리, 검증 타당성, 실행)의 보고를 정리한 문서다.
// 사용: node scripts/reserve/build-review.mjs → docs/research/reserve-plan/review.html, review.pdf
// 수치는 리뷰어들이 scripts/reserve/build-report.mjs의 sim을 옮겨 직접 돌린 값이다(이 스크립트는 계산하지 않는다).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const OUT = path.resolve(import.meta.dirname, '../../docs/research/reserve-plan')
const sev = (s) => `<span class="sev ${s === '높음' ? 'hi' : s === '중간' ? 'mid' : 'lo'}">${s}</span>`
const who = (...n) => n.map((x) => `<span class="who">${x}</span>`).join('')

const css = `
@page { size: A4; margin: 14mm 13mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'IBM Plex Sans KR', sans-serif; color: #0b0b0b; font-size: 10pt; line-height: 1.6; word-break: keep-all; }
.page { break-after: page; } .page:last-child { break-after: auto; }
h1 { font-size: 22pt; line-height: 1.25; margin: 0 0 6pt; }
h2 { font-size: 14.5pt; margin: 2pt 0 4pt; }
h3 { font-size: 10.5pt; margin: 12pt 0 3pt; }
.kicker { font-size: 8.5pt; color: #2962ff; font-weight: 700; }
.sub { color: #52514e; margin: 0 0 8pt; font-size: 9.5pt; }
.lead { font-size: 11pt; margin: 0 0 10pt; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 5pt 0; }
th { text-align: left; font-weight: 600; color: #52514e; border-bottom: 1px solid #c9ccd4; padding: 4pt 6pt; vertical-align: bottom; }
td { border-bottom: 1px solid #eceef2; padding: 4pt 6pt; vertical-align: top; }
td.n, th.n { text-align: right; font-family: 'IBM Plex Mono', 'IBM Plex Sans KR', monospace; white-space: nowrap; }
th.n { font-family: inherit; }
tr.pick td { background: #f4f7ff; font-weight: 600; }
.sev { display: inline-block; font-size: 8pt; font-weight: 700; padding: 0 5pt; border-radius: 4px; white-space: nowrap; }
.sev.hi { background: #fde8e1; color: #9a2f0e; } .sev.mid { background: #fdf1d3; color: #7a5200; } .sev.lo { background: #eceef2; color: #52514e; }
.who { display: inline-block; font-size: 7.5pt; border: 1px solid #c9ccd4; border-radius: 4px; padding: 0 4pt; margin-right: 3pt; color: #52514e; white-space: nowrap; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; margin: 8pt 0; }
.card { border: 1px solid #e0e3eb; border-radius: 8px; padding: 8pt 10pt; font-size: 9.3pt; }
.card b { display: block; font-size: 10.3pt; margin-bottom: 2pt; }
.note { border-left: 3px solid #2962ff; background: #f4f7ff; padding: 7pt 11pt; font-size: 9.5pt; margin: 8pt 0; border-radius: 0 6px 6px 0; }
ul { margin: 4pt 0; padding-left: 14pt; font-size: 9.5pt; } li { margin-bottom: 2pt; }
.foot { font-size: 8.5pt; color: #8a8984; margin: 6pt 0 0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
`

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>독립 검토 종합</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body>

<section class="page">
  <div class="kicker">독립 검토 종합, 2026.11.18</div>
  <h1>현금 비중으로 사고파는 규칙: 리뷰어 세 명의 검토</h1>
  <p class="lead">같은 규칙과 자료를 리뷰어 세 명이 서로 다른 관점에서 따로 검토했습니다. 세 명 모두 시뮬레이터를 옮겨 보고서 수치를 재현한 뒤 직접 계산했습니다.</p>

  <div class="cards">
    <div class="card"><b>규칙 논리</b>규칙을 상태로 보고 충돌, 빈 상태, 반복 매매를 찾았습니다. 시작일 320개와 무작위 경로 600개를 돌렸습니다.</div>
    <div class="card"><b>검증 타당성</b>비교 기준, 표본 수, 시작일과 문턱값 민감도, 더 단순한 대안을 따졌습니다.</div>
    <div class="card"><b>실제 실행</b>원화 기준 측정과 환율, 체결 시각, 세금과 계좌, 규칙을 지킬 수 있는지를 봤습니다.</div>
  </div>

  <h3>결론 세 가지</h3>
  <table><tbody>
    <tr><td style="width:4%">1</td><td><b>규칙에 큰 모순은 없습니다.</b> 문턱 근처에서 사고팔기를 되풀이하는 일도, 현금이 음수가 되는 경로도, QQQ가 모자라 3번을 못 쓰는 경우도 없었습니다.</td></tr>
    <tr><td>2</td><td><b>이 규칙은 수익률을 더하지 않습니다.</b> 기준 비중(QQQ 50, 금 10, 암호화폐 10, 현금 30)을 매달 되돌리기만 해도 같은 성과가 나옵니다. 결과를 정하는 것은 평균 현금 비중입니다.</td></tr>
    <tr><td>3</td><td><b>고칠 곳은 두 군데에 몰려 있습니다.</b> 1번 규칙을 쓰기 전의 기간(지금 상태)과, 실제로 실행할 때의 정의(통화, 계좌, 세금)입니다.</td></tr>
  </tbody></table>

  <h3>두 명 이상이 따로 같은 것을 짚은 항목</h3>
  <table><thead><tr><th style="width:30%">항목</th><th style="width:19%">짚은 리뷰어</th><th>요지</th></tr></thead><tbody>
    <tr><td>1번 규칙을 쓰기 전 기간이 비어 있음</td><td>${who('논리', '검증', '실행')}</td><td>그 기간에는 현금 상한도 하한도 적용되지 않습니다. 현금이 9%까지 줄거나 65%까지 쌓였습니다.</td></tr>
    <tr><td>1번 규칙의 효과가 0에 가까움</td><td>${who('검증', '실행')}</td><td>기다리지 않고 바로 현금 30%로 시작한 경우와 수익률, 낙폭 차이의 중앙값이 0.0%p였습니다.</td></tr>
    <tr><td>2번 규칙이 깊은 하락에서만 사는 것이 아님</td><td>${who('논리', '검증', '실행')}</td><td>비트코인을 판 돈만으로 현금이 40%가 되어, QQQ가 최고가 근처일 때 산 경우가 있습니다.</td></tr>
    <tr><td>금 10%가 유지되지 않음</td><td>${who('논리', '검증')}</td><td>2004년 시작 구간에서 금 비중의 중앙값이 5.2%였고, 3.6%로 끝났습니다.</td></tr>
    <tr><td>환율이 빠져 있음</td><td>${who('검증', '실행')}</td><td>현금이 원화면 급락 때 달러가 올라 현금 비중이 덜 늘어납니다. 2번 규칙이 늦게 켜지거나 켜지지 않습니다.</td></tr>
  </tbody></table>

  <div class="note">아래 수치는 리뷰어들이 계산한 값입니다. 이 가운데 "기준 비중을 매달 되돌리면 2014년 시작 구간이 연 18.3%, 최대 낙폭 −27.8%"는 따로 다시 계산해 같은 값을 얻었습니다. 환율이 들어간 수치는 자료가 없어 리뷰어가 근사치로 계산한 것이라 방향만 믿을 수 있습니다.</div>
</section>

<section class="page">
  <div class="kicker">발견</div>
  <h2>검증에 관한 발견: 무엇을 믿을 수 있나</h2>
  <p class="sub">보고서의 결론 가운데 덜 믿어야 할 것들입니다.</p>

  <h3>비교 기준을 바꾸면 규칙의 우위가 사라집니다 ${sev('높음')}</h3>
  <table><thead><tr><th>2014~2026년</th><th class="n">연수익률</th><th class="n">변동성</th><th class="n">샤프</th><th class="n">최대 낙폭</th><th class="n">평균 현금</th></tr></thead><tbody>
    <tr class="pick"><td>규칙대로</td><td class="n">18.5%</td><td class="n">14.1%</td><td class="n">1.13</td><td class="n">−28.6%</td><td class="n">34%</td></tr>
    <tr><td>그냥 둔 경우 (보고서의 비교 기준)</td><td class="n">15.4%</td><td class="n">11.9%</td><td class="n">1.09</td><td class="n">−23.3%</td><td class="n">43%</td></tr>
    <tr><td>기준 비중을 매달 되돌림</td><td class="n">18.3%</td><td class="n">14.2%</td><td class="n">1.11</td><td class="n">−27.9%</td><td class="n">30%</td></tr>
    <tr><td>기준 비중을 분기마다 되돌림</td><td class="n">20.1%</td><td class="n">14.8%</td><td class="n">1.18</td><td class="n">−27.8%</td><td class="n">29%</td></tr>
  </tbody></table>
  <ul>
    <li>보고서가 말한 연 3.1%p 우위는 현금을 덜 들고 있었던 효과입니다. 그냥 둔 경우는 비트코인을 판 돈을 끝까지 쓰지 않아 평균 현금이 43%였습니다.</li>
    <li>기준 비중을 매달 되돌린 경우와의 차이는 연 0.1%p이고 통계로 구별되지 않습니다(t값 0.17).</li>
    <li>2004년 시작 구간에서 기준 현금을 10, 20, 30, 40%로 바꾸면 연수익률이 14.7, 13.2, 11.7, 10.4%, 최대 낙폭이 −40, −35, −32, −29%였고 샤프는 0.73~0.75로 같았습니다. 현금 10%p는 연 1.2~1.5%p와 낙폭 3~5%p를 맞바꾸는 선택입니다.</li>
  </ul>

  <div class="cols">
    <div>
      <h3>2014년 구간의 결과는 비트코인이 만들었습니다 ${sev('높음')}</h3>
      <table><thead><tr><th>비트코인만 바꿈</th><th class="n">규칙</th><th class="n">그냥 둠</th></tr></thead><tbody>
        <tr><td>실제 비트코인</td><td class="n">18.5%</td><td class="n">15.4%</td></tr>
        <tr><td>수익률을 QQQ와 같게</td><td class="n">16.2%</td><td class="n">13.4%</td></tr>
        <tr><td>수익률 0%</td><td class="n">13.6%</td><td class="n">12.7%</td></tr>
        <tr><td>비트코인 없이</td><td class="n">12.8%</td><td class="n">13.5%</td></tr>
      </tbody></table>
      <ul><li>그 구간의 첫 매수는 현금 60%를 30%로 줄인 것입니다. 실제로 하게 될 40%에서 30%와는 다른 사건입니다.</li></ul>
    </div>
    <div>
      <h3>결론이 기대는 사건이 몇 개뿐입니다 ${sev('높음')}</h3>
      <ul>
        <li>1번 규칙이 글에 적힌 대로(현금 40%에서 30%로) 실행된 사례는 과거 계산에 하나도 없습니다.</li>
        <li>2번과 3번 규칙은 2000년과 2008년 두 번의 폭락에서만 검증됐습니다. 2008년 10월 뒤 18년 동안 2번으로 산 적은 없습니다.</li>
        <li>"QQQ −20% 뒤 3년에 54~169% 올랐다"는 같은 시기의 아무 날과 다르지 않습니다. 2016~2023년 모든 거래일의 3년 뒤 수익률 중앙값이 75%였습니다.</li>
        <li>세 구간은 기간이 겹쳐 독립된 표본이 아닙니다. 겹치지 않게 나누면 규칙의 우위는 2004~2014년에 +1.7%p, 2014~2026년에 −1.6%p로 부호가 반대입니다.</li>
      </ul>
    </div>
  </div>

  <h3>문제가 없다고 확인된 것</h3>
  <ul>
    <li>문턱값을 108가지로 바꿔도 샤프가 거의 같았습니다(2014년 구간 1.01~1.21). 지금 값을 골라낸 흔적은 없지만, 문턱값이 성과를 좌우하지도 않습니다.</li>
    <li>체결을 0~21거래일 늦춰도, 거래 비용을 편도 1%로 넣어도 연수익률 변화는 0.2%p 안이었습니다.</li>
    <li>점검을 주 1회로 줄여도 매일 보는 것과 사고판 횟수가 같았습니다.</li>
  </ul>
</section>

<section class="page">
  <div class="kicker">발견</div>
  <h2>규칙과 실행에 관한 발견: 무엇을 고쳐야 하나</h2>
  <table><thead><tr><th style="width:24%">발견</th><th style="width:8%">심각도</th><th style="width:36%">근거</th><th>고치는 방법</th></tr></thead><tbody>
    <tr><td>1번 규칙 전에는 현금 하한이 꺼져 있음</td><td>${sev('높음')}</td><td>현금이 9.4%까지 줄었습니다. 1번이 걸린 직후 첫 행동이 급락 중의 QQQ 매도인 시작일이 26개였습니다.</td><td>3번 규칙을 첫날부터 적용합니다. 수익률 변화는 연 0.02%p입니다.</td></tr>
    <tr><td>1번 규칙 전에는 현금 상한도 없음</td><td>${sev('높음')}</td><td>비트코인을 판 돈이 쌓여 현금이 최고 65%였습니다. 50%를 넘긴 시작일이 37개입니다.</td><td>1번을 없애거나, "현금 50% 이상이면 40%까지 산다"를 붙입니다.</td></tr>
    <tr><td>1번 신호가 며칠뿐임</td><td>${sev('높음')}</td><td>QQQ가 −20% 이하였던 날은 2018년 12월에 2거래일, 2025년 4월에 3거래일입니다. 달에 한 번만 보면 놓쳐 첫 매수가 3년 넘게 밀립니다.</td><td>증권사에 가격 알림을 걸어 둡니다. 지금 기준은 QQQ 607.73달러입니다.</td></tr>
    <tr><td>5번 규칙이 글과 계산에서 다름</td><td>${sev('중간')}</td><td>글대로면 지금 들어오는 월급이 전부 QQQ로 갑니다. 계산은 1번 전에 현금 40%를 기준으로 삼았습니다.</td><td>"1번 전의 기준은 시작 비중(현금 40%)"이라고 적습니다.</td></tr>
    <tr><td>3번으로 판 QQQ를 며칠 뒤 2번으로 되삼</td><td>${sev('중간')}</td><td>현금을 끌어내린 것이 비트코인인데 QQQ를 팔고, 곧 6번이 걸려 QQQ를 최고가 근처에서 다시 삽니다. 133개 시작일 중 17개에서 생겼습니다.</td><td>3번으로 팔 때 금이나 암호화폐가 15% 이상이면 그 자산부터 10%까지 팝니다. 왕복이 0이 되고 수익률은 같았습니다.</td></tr>
    <tr><td>2번이 걸리는 하락 폭이 고정이 아님</td><td>${sev('중간')}</td><td>현금이 20%에서 출발하면 나머지 자산이 62% 내려야 하고, 39%면 4%만 내려도 걸립니다. 처음 산 뒤 날의 81%는 현금이 20~30%였습니다.</td><td>보고서의 "전체가 25% 줄면 산다"를 출발 현금별 표로 바꿉니다.</td></tr>
    <tr><td>금 10%가 유지되지 않음</td><td>${sev('중간')}</td><td>살 때는 금 비중이 이미 높아 채울 일이 없습니다. 매수 28건 중 18건에서 금으로 간 돈이 없었습니다.</td><td>3번으로 팔 때 금과 암호화폐도 10%까지 채웁니다(연 0.07~0.23%p 낮아짐). 아니면 글을 고칩니다.</td></tr>
    <tr><td>원화 현금이면 규칙이 다르게 움직임</td><td>${sev('높음')}</td><td>원/달러가 30% 오르면, 현금이 40%가 되는 데 필요한 QQQ 하락이 50%에서 71%로 늘어납니다.</td><td>비중을 재는 통화와 현금을 두는 통화를 정해 적습니다.</td></tr>
    <tr><td>국내 상장 ETF의 세금이 더 클 수 있음</td><td>${sev('높음')}</td><td>3번은 전체의 10%를 한 번에 팝니다. 일반 계좌의 국내 상장 해외지수 ETF는 차익이 배당소득이라 2,000만 원을 넘으면 종합과세와 건강보험료 대상입니다.</td><td>일반 계좌에서는 미국 상장 QQQ를, 국내 상장 ETF는 ISA와 연금 계좌 안에서만 듭니다.</td></tr>
    <tr><td>큰 돈이 들어오거나 나갈 때</td><td>${sev('중간')}</td><td>하락장에서 전체의 15%를 현금에서 꺼내면 3번이 걸려 QQQ를 최고가보다 33% 낮은 값에 팝니다.</td><td>"QQQ가 최고가보다 20% 넘게 낮을 때는 3번으로 팔지 않는다"를 붙입니다.</td></tr>
    <tr><td>국내 가격이 국제 가격보다 비쌀 때</td><td>${sev('중간')}</td><td>국내 비트코인은 2018년 1월에 40~50%, KRX 금은 2025년 2월에 약 20% 비쌌습니다(리뷰어의 기억, 확인 필요).</td><td>국내가가 3% 넘게 비싸면 그 자산의 매수를 미룹니다.</td></tr>
    <tr><td>글과 계산의 작은 차이</td><td>${sev('낮음')}</td><td>"20% 초과"와 "20% 이상", 전체의 0.5% 미만은 사지 않음, 같은 날 여러 규칙이 걸릴 때의 순서, 주문 크기를 재는 날.</td><td>글에 그대로 적습니다(다음 쪽).</td></tr>
  </tbody></table>
  <p class="foot">시작일 수는 규칙 논리 리뷰어가 매달 첫 거래일을 시작일로 삼아 돌린 320개 경로(비트코인이 든 경로는 133개) 기준입니다.</p>
</section>

<section class="page">
  <div class="kicker">종합 판단</div>
  <h2>권하는 순서</h2>
  <p class="sub">리뷰어 세 명의 제안을 모아, 값이 거의 들지 않는 것과 정해야 하는 것으로 나눴습니다.</p>

  <h3>바로 고쳐도 되는 것 <span style="font-weight:400;color:#8a8984;font-size:8.5pt">리뷰어가 계산해 수익률이 나빠지지 않음을 확인</span></h3>
  <table><tbody>
    <tr><td style="width:4%">1</td><td>3번 규칙(현금 하한)을 첫날부터 적용합니다.</td></tr>
    <tr><td>2</td><td>3번으로 팔 때 금이나 암호화폐가 전체의 15% 이상이면 그 자산부터 10%까지 팔고, 모자란 만큼만 QQQ를 팝니다.</td></tr>
    <tr><td>3</td><td>1번 규칙의 뜻을 적습니다. "QQQ 종가가 역대 최고 종가보다 20% 이상 낮은 날이 처음 나오면 1번을 쓴 것으로 친다. 그날 현금이 30%를 넘으면 넘는 만큼 산다. 어느 쪽이든 그 뒤로 2번을 적용한다."</td></tr>
    <tr><td>4</td><td>체결의 세부를 적습니다. 다음 거래일에 조건이 풀려 있어도 그대로 사고판다. 주문 크기는 판단한 날 종가로 계산한다. 같은 날 여러 규칙이 걸리면 6번, 3번, 2번 순서로 한다. 전체의 0.5% 미만은 매매하지 않는다.</td></tr>
    <tr><td>5</td><td>보고서의 서술을 고칩니다. 비교표에 "기준 비중을 매달 되돌린 경우"와 변동성, 샤프를 넣고, "깊이 내렸을 때만 산다", "금과 암호화폐 비중이 10% 가까이 유지된다", "현금이 늘 20~40% 있다"를 실제 계산에 맞게 바꿉니다.</td></tr>
  </tbody></table>

  <h3>정해야 하는 것</h3>
  <table><thead><tr><th style="width:22%">결정</th><th style="width:40%">고를 수 있는 것</th><th>리뷰어들의 의견</th></tr></thead><tbody>
    <tr><td>1번 규칙을 둘 것인가</td><td>없애고 지금 기준 비중으로 가기 / 기한을 붙이기(예: 2027년 말까지 −20%가 안 오면 삼) / 그대로 두고 기다리는 동안의 규칙을 적기</td><td>두 명이 없애기를 권했습니다. 결과 차이가 없고 규칙이 다섯 개로 줍니다. 한 번에 사기 부담스러우면 6개월에 나눠 삽니다.</td></tr>
    <tr><td>금과 암호화폐 10%를 지킬 것인가</td><td>3번으로 팔 때 함께 채우기 / 지금대로 두고 글만 고치기</td><td>채우면 금 비중이 평균 10.6%로 유지되고 연 0.07~0.23%p 낮아집니다.</td></tr>
    <tr><td>어느 통화로 재고 현금을 둘 것인가</td><td>현금을 달러 단기 국채로 두기 / 원화로 두고 원화 환산 비중으로 재기</td><td>달러 현금이면 과거 계산이 그대로 맞습니다. 원화 현금이면 2008년 같은 하락에서 2번이 늦거나 덜 걸립니다.</td></tr>
    <tr><td>계좌와 상품 배치</td><td>일반 계좌는 미국 상장 QQQ, ISA와 연금 계좌는 국내 상장 나스닥100 ETF와 현금성 ETF, 금은 KRX 금현물</td><td>한 번 사면 옮길 때 세금이 들어 첫 매수 전에 정해야 합니다. 세법은 확인이 필요합니다.</td></tr>
    <tr><td>점검 방법</td><td>매일 / 주 1회 정한 시각에 한 장으로 계산</td><td>주 1회도 결과가 같았습니다. "전체 자산"에 넣는 계좌 범위와 쓰는 시세를 함께 정합니다.</td></tr>
  </tbody></table>

  <h3>권하지 않는 것</h3>
  <ul>
    <li>2번 규칙에 "QQQ가 최고가보다 10% 넘게 낮을 때만"을 붙이는 것. 위 2번 수정으로 최고가 근처 매수가 18개에서 0개로 사라지고, 조건을 붙여도 수익률은 같았습니다.</li>
    <li>해마다 전부 기준 비중으로 되돌리는 것. 낙폭은 조금 얕아지지만 과세 매도가 4배쯤 늘어, 세금을 넣으면 2004년 구간에서 연 10.5% 대 11.3%로 규칙대로 한 경우보다 낮았습니다.</li>
  </ul>

  <div class="note"><b>다음에 할 일.</b> 원/달러 일별 자료를 넣어 원화 기준으로 다시 계산하는 것이 가장 큰 빈칸입니다. 그다음 위의 "바로 고쳐도 되는 것" 다섯 가지를 규칙 문서에 반영합니다.</div>
  <p class="foot">리뷰어들의 실험 스크립트는 scripts/reserve/review/에 있습니다. 이 문서의 수치는 리뷰어 보고에서 옮긴 것이고, 세법과 국내 가격 프리미엄, 환율 수치는 리뷰어가 확신 정도를 중간 이하로 표시한 항목이 섞여 있습니다. 생성: scripts/reserve/build-review.mjs</p>
</section>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'review.html'), html)
const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${path.join(OUT, 'review.html')}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: path.join(OUT, 'review.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`PDF 저장: ${path.join(OUT, 'review.pdf')}`)
