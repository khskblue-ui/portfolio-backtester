// UI 오버플로 전수 검사: 5개 뷰 × 390/1280/1440 뷰포트에서 뷰포트를 벗어나는
// 요소(의도된 가로 스크롤 컨테이너 제외)와 페이지 가로 스크롤을 검출하고,
// 백테스트는 -HIST 자산으로 실제 실행까지 수행한다. flagged 0이 통과 기준.
// 선행: npm run build, staticserver.mjs 실행, npm i -D playwright(+install chromium)
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('audit', { recursive: true })
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
const report = []

async function overflow(page, label) {
  const res = await page.evaluate(() => {
    const vw = window.innerWidth
    const canScrollX = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true
      }
      return false
    }
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right > vw + 1.5 || r.left < -1.5) {
        if (canScrollX(el)) continue
        offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 30) })
      }
    }
    return { pageOverflow: document.documentElement.scrollWidth - vw, offenders: offenders.slice(0, 8) }
  })
  if (res.pageOverflow > 1 || res.offenders.length) report.push({ label, ...res })
}

async function auditViewport(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(([s, sh]) => { localStorage.setItem('bt_strategies_v1', JSON.stringify(s)); localStorage.setItem('bt_shared_v1', JSON.stringify(sh)) }, [[strat], shared])
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' })
  const mobile = width < 1024
  const nav = async (label) => {
    const sel = mobile ? 'nav.fixed button' : 'aside button'
    await page.locator(sel, { hasText: label }).click()
    await page.waitForTimeout(600)
  }
  // 홈
  await page.getByText('REGIME', { exact: false }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(400)
  await overflow(page, `${tag}/home`)
  if (await page.getByText('김현성').count() === 0) throw new Error('저작권 표기 없음(home)')
  await page.screenshot({ path: `audit/${tag}-home.png` })
  // 헤더에 '홈' 라벨 없음 (헤더 영역 텍스트 검사)
  const headerTxt = await page.locator('header').innerText()
  if (headerTxt.includes('홈')) throw new Error('헤더에 홈 라벨 잔존')
  // 가이드 1부
  await nav('가이드북')
  await page.waitForTimeout(700)
  await overflow(page, `${tag}/guide-p0`)
  await page.screenshot({ path: `audit/${tag}-guide-hero.png` })
  // 2부 (quad 도해 확인)
  await page.getByText('2부 · 경제 공부').first().click()
  await page.waitForTimeout(800)
  await overflow(page, `${tag}/guide-p1`)
  const quad = page.locator('#s2-curveshapes figure')
  await quad.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await quad.screenshot({ path: `audit/${tag}-quad.png` })
  // 역사
  await nav('역사')
  await page.waitForTimeout(1200)
  await overflow(page, `${tag}/history`)
  // 신호
  await nav('신호')
  await page.waitForTimeout(1200)
  await overflow(page, `${tag}/now`)
  // 백테스트
  await nav('백테스트')
  await page.waitForTimeout(500)
  await overflow(page, `${tag}/backtest-pre`)
  if (mobile) {
    await page.getByRole('button', { name: '다음: 가정 확인' }).click()
    await page.waitForTimeout(300)
    await overflow(page, `${tag}/wizard-step2`)
    await page.getByRole('button', { name: '백테스트 실행' }).last().click()
  } else {
    await page.getByRole('button', { name: '백테스트 실행' }).first().click()
  }
  await page.getByText('스냅샷').waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)
  await overflow(page, `${tag}/backtest-results`)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `audit/${tag}-footer.png` })
  if (errors.length) report.push({ label: `${tag}/pageerrors`, errors: errors.slice(0, 3) })
  await page.close()
}

await auditViewport(390, 844, 'm390')
await auditViewport(1280, 900, 'pc1280')
await auditViewport(1440, 900, 'pc1440')
fs.writeFileSync('audit/report.json', JSON.stringify(report, null, 2))
console.log('AUDIT DONE. flagged:', report.length)
if (report.length) console.log(JSON.stringify(report, null, 1).slice(0, 3000))
await browser.close()
