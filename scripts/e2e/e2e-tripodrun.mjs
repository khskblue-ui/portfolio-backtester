// 트라이팟 백테스트 흐름 e2e — 저장소 데이터 스냅숏으로 실제 실행까지 확인한다.
//  1) 트라이팟 탭 → "백테스트에서 비교하기" → 실행 → 결과(비교표·트라이팟 신호 요약·청산 열) → 보고서
//  2) 트라이팟 60% + SPY 30% + 현금 10% 혼합(연 1회 리밸런싱) · 적립식 · 2007~2013 기간 지정
// 390·1280 뷰포트에서 화면 넘침·페이지 오류·엔진 정합성 경고가 없어야 통과(exit 0).
// 선행: npm run build, FIXTURES=1 PORT=4176 node scripts/e2e/staticserver.mjs &
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('audit', { recursive: true })
const BASE = process.env.BASE ?? 'http://127.0.0.1:4176'
const exec = process.env.CHROMIUM_PATH
const browser = await chromium.launch(exec ? { executablePath: exec } : {})
const problems = []

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
    const off = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if ((r.right > vw + 1.5 || r.left < -1.5) && !canScrollX(el)) off.push((el.textContent || '').trim().slice(0, 40))
    }
    return { pageOverflow: document.documentElement.scrollWidth - vw, off: off.slice(0, 5) }
  })
  if (res.pageOverflow > 1 || res.off.length) problems.push({ label, ...res })
}

/** 비교표(첫 ledger-table) 행 → { name, twrr, liq, liqMwrr } */
async function readTable(page) {
  return page.evaluate(() => {
    const t = document.querySelector('table.ledger-table')
    const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim())
    const col = (re) => heads.findIndex((h) => re.test(h))
    const [iT, iF, iL, iLm] = [col(/^TWRR/), col(/^최종 가치/), col(/^청산 후 가치/), col(/^청산 MWRR/)]
    const num = (s) => Number(s.replace(/[$,%]/g, ''))
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const c = [...tr.children].map((x) => x.textContent.trim())
      return { name: c[0], twrr: num(c[iT]), final: num(c[iF]), liq: num(c[iL]), liqMwrr: num(c[iLm]) }
    })
  })
}

async function runFlow(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const mobile = width < 1024
  const nav = async (label) => { await page.locator(mobile ? 'nav.fixed button' : 'aside button', { hasText: label }).click(); await page.waitForTimeout(600) }
  const run = async () => {
    if (mobile) {
      await page.getByRole('button', { name: '다음: 가정 확인' }).click()
      await page.getByRole('button', { name: '백테스트 실행' }).last().click()
    } else await page.getByRole('button', { name: '백테스트 실행' }).first().click()
  }

  // 1) 비교 세트
  await nav('트라이팟')
  await page.getByRole('button', { name: '백테스트에서 비교하기' }).click()
  await page.getByText('트라이팟 슬리브 100%').first().waitFor({ timeout: 10000 })
  await run()
  await page.getByText('트라이팟 신호 요약').first().waitFor({ timeout: 120000 })
  await page.waitForTimeout(800)
  const rows = await readTable(page)
  const by = (n) => rows.find((r) => r.name.startsWith(n))
  const tri = by('트라이팟 100%'), qqq = by('QQQ 100%')
  if (rows.length !== 5 || !tri || !qqq) problems.push({ label: `${tag}/set`, rows })
  else {
    if (!(tri.twrr > qqq.twrr && Number.isFinite(tri.liqMwrr) && tri.liq <= tri.final && qqq.liq < qqq.final)) problems.push({ label: `${tag}/set-values`, tri, qqq })
  }
  const bodyText = await page.locator('body').innerText()
  if (/현금 원장 불일치|범위를 벗어남|슬리브 합/.test(bodyText)) problems.push({ label: `${tag}/reconciliation` })
  if (!/신호 전환 \d+회/.test(bodyText)) problems.push({ label: `${tag}/tripod-summary` })
  await overflow(page, `${tag}/results-set`)
  await page.screenshot({ path: `audit/${tag}-tripodrun-results.png`, fullPage: true })
  // 보고서
  await page.locator('button[title="백테스트 결과 보고서 (PDF 저장)"]').click()
  await page.getByText('포트폴리오 백테스트 보고서').waitFor({ timeout: 10000 })
  const rep = await page.locator('.print-report').innerText()
  for (const must of ['청산 후 가치', '트라이팟 신호 전환', '체결 시점', '다음 거래일 종가', '미국 단기국채(^IRX) 실제 금리']) if (!rep.includes(must)) problems.push({ label: `${tag}/report-missing`, must })
  await page.screenshot({ path: `audit/${tag}-tripodrun-report.png`, fullPage: true })
  await page.getByRole('button', { name: '닫기' }).click()
  console.log(`[${tag}] 비교 세트:`, rows.map((r) => `${r.name} TWRR ${r.twrr}% 청산MWRR ${r.liqMwrr}%`).join(' | '))

  // 2) 혼합 · 적립식 · 기간 지정 (설정은 저장소에 넣고 새로 고침)
  await page.evaluate(() => {
    const strategies = JSON.parse(localStorage.getItem('bt_strategies_v1'))
    const tri = strategies[0]
    const mix = JSON.parse(JSON.stringify(tri))
    mix.id = 'mix'
    mix.name = '트라이팟 60 + SPY 30 + 현금 10'
    mix.sleeves = [{ ticker: 'TRIPOD', targetWeight: 0.6 }, { ticker: 'SPY', targetWeight: 0.3 }, { ticker: 'CASH', targetWeight: 0.1 }]
    mix.rebalance = { trigger: 'periodic', periodMonths: 12, mode: 'sell_to_target' }
    const spy = JSON.parse(JSON.stringify(strategies[3]))
    spy.id = 'spy'
    spy.name = 'SPY 100%'
    spy.sleeves = [{ ticker: 'SPY', targetWeight: 1 }]
    localStorage.setItem('bt_strategies_v1', JSON.stringify([mix, tri, spy]))
    const sh = JSON.parse(localStorage.getItem('bt_shared_v1'))
    localStorage.setItem('bt_shared_v1', JSON.stringify({ ...sh, initialUsd: 0, monthlyUsd: 2000, startDate: '2007-01-01', endDate: '2013-12-31' }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await nav('백테스트')
  await run()
  await page.getByText('트라이팟 신호 요약').first().waitFor({ timeout: 120000 })
  await page.waitForTimeout(800)
  const rows2 = await readTable(page)
  const head = await page.getByText('2007-01-03 ~ 2013-12-31', { exact: false }).count()
  if (rows2.length !== 3 || head === 0) problems.push({ label: `${tag}/mix`, rows2, head })
  await overflow(page, `${tag}/results-mix`)
  await page.screenshot({ path: `audit/${tag}-tripodrun-mix.png`, fullPage: true })
  console.log(`[${tag}] 혼합·적립:`, rows2.map((r) => `${r.name} TWRR ${r.twrr}% 최종 $${r.final} 청산 $${r.liq}`).join(' | '))
  if (errors.length) problems.push({ label: `${tag}/pageerrors`, errors: errors.slice(0, 3) })
  await page.close()
}

await runFlow(1280, 900, 'pc1280')
await runFlow(390, 844, 'm390')
await browser.close()
console.log('TRIPOD RUN DONE. problems:', problems.length)
if (problems.length) {
  console.log(JSON.stringify(problems, null, 1).slice(0, 4000))
  process.exit(1)
}
