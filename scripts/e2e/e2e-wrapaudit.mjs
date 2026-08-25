// 줄바꿈 품질 검사: 공백 있는 괄호 묶음이 두 줄에 걸쳐 갈라지면 검출(Range API).
// 허용 잔존: 문장 폭 전체를 쓰는 22자 이상 절 단위 괄호의 본문 내 줄바꿈(표준 조판).
// 새 findings가 나오면 nbspShortParens(src/ui/common.ts) 적용 범위/상한을 조정할 것.
import { chromium } from 'playwright'
import fs from 'node:fs'
const exec = process.env.CHROMIUM_PATH
const browser = await chromium.launch(exec ? { executablePath: exec } : {})
const strat = {
  id: 's1', name: '역사 주식 70/현금 30', sleeves: [{ ticker: 'SPX-HIST', targetWeight: 0.7 }, { ticker: 'CASH', targetWeight: 0.3 }],
  contribution: { initialUsd: 10000, monthlyUsd: 1000, allocation: 'pro_rata' },
  rebalance: { trigger: 'none', mode: 'sell_to_target' },
  costs: { feeBps: 0, spreadBps: 0 },
  execution: { fractionalShares: true, cashAnnualYieldPct: 4, minTradeUsd: 100 },
  tax: { enabled: false, costBasisMethod: 'moving_average', assumedUsdKrw: 1400, capitalGains: { ratePct: 22, annualDeductionKrw: 2500000 }, dividends: { usWithholdingPct: 15, comprehensiveThresholdKrw: 20000000, assumedOtherFinancialIncomeKrw: 0, assumedMarginalRatePct: 26.4 }, crypto: { enabled: false, ratePct: 22, annualDeductionKrw: 2500000 } },
}
const shared = { initialUsd: 10000, monthlyUsd: 1000, feeBps: 0, spreadBps: 0, cashYieldPct: 4, fractionalShares: true, taxEnabled: false, assumedUsdKrw: 1400, marginalRatePct: 26.4, otherFinancialIncomeKrw: 0, cryptoTaxEnabled: false, startDate: '1960-01-01', endDate: '1990-01-01', contributionOverrides: [] }
const findings = []

// 컴팩트 요소(라벨·셀·칩) 안에서 공백 있는 괄호 묶음이 두 줄에 걸치면 검출
async function wrapCheck(page, label) {
  const res = await page.evaluate(() => {
    const out = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const t = node.textContent ?? ''
      if (t.trim().length === 0 || t.trim().length > 70) continue // 본문 문단 제외
      if (!/\([^()]* [^()]*\)/.test(t)) continue
      const el = node.parentElement
      if (!el) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const re = /\([^()]+\)/g
      let m
      while ((m = re.exec(t))) {
        if (!m[0].includes(' ')) continue // 일반 공백이 있는 괄호만 (NBSP는 제외)
        const r = document.createRange()
        r.setStart(node, m.index)
        r.setEnd(node, m.index + m[0].length)
        const rects = [...r.getClientRects()].filter((x) => x.width > 0.5)
        const tops = new Set(rects.map((x) => Math.round(x.top / 4)))
        if (rects.length > 0 && tops.size > 1)
          out.push({ paren: m[0], ctx: t.trim().slice(0, 45), cls: (el.className || '').toString().slice(0, 45) })
      }
    }
    return out
  })
  for (const f of res) findings.push({ where: label, ...f })
}

async function sweep(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.addInitScript(([s, sh]) => { localStorage.setItem('bt_strategies_v1', JSON.stringify(s)); localStorage.setItem('bt_shared_v1', JSON.stringify(sh)) }, [[strat], shared])
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' })
  const mobile = width < 1024
  const nav = async (label) => { await page.locator(mobile ? 'nav.fixed button' : 'aside button', { hasText: label }).click(); await page.waitForTimeout(700) }
  await page.getByText('REGIME', { exact: false }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  await wrapCheck(page, `${tag}/home`)
  await nav('가이드북'); await wrapCheck(page, `${tag}/guide-p0`)
  await page.getByText('2부 · 경제 공부').first().click(); await page.waitForTimeout(900); await wrapCheck(page, `${tag}/guide-p1`)
  await nav('역사'); await page.waitForTimeout(1200); await wrapCheck(page, `${tag}/history`)
  // 구간 상세 열기 (첫 구간 카드 클릭)
  const eraCard = page.getByText('1929', { exact: false }).first()
  if (await eraCard.count()) { await eraCard.click().catch(() => {}); await page.waitForTimeout(900); await wrapCheck(page, `${tag}/history-detail`) }
  await nav('신호'); await page.waitForTimeout(1400); await wrapCheck(page, `${tag}/now`)
  await nav('백테스트'); await page.waitForTimeout(500); await wrapCheck(page, `${tag}/backtest-step1`)
  if (mobile) {
    await page.getByRole('button', { name: '다음: 가정 확인' }).click(); await page.waitForTimeout(300); await wrapCheck(page, `${tag}/backtest-step2`)
    await page.getByRole('button', { name: '백테스트 실행' }).last().click()
  } else {
    await page.getByRole('button', { name: '백테스트 실행' }).first().click()
  }
  await page.getByText('스냅샷').waitFor({ timeout: 60000 })
  await page.waitForTimeout(900)
  await wrapCheck(page, `${tag}/backtest-results`)
  await page.close()
}

await sweep(390, 844, 'm390')
await sweep(1280, 900, 'pc1280')
fs.writeFileSync('wrap-report.json', JSON.stringify(findings, null, 1))
console.log('WRAP AUDIT DONE. findings:', findings.length)
for (const f of findings.slice(0, 40)) console.log(`[${f.where}] ${f.paren} :: ${f.ctx} :: ${f.cls}`)
await browser.close()
