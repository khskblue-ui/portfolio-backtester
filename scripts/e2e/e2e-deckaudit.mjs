// 트라이팟 발표 자료(docs/research/tripod/tripod-deck.html) 시각 검수.
// 슬라이드마다 SVG 글자끼리·글자와 선/막대/점의 겹침, 패널·화면 밖으로 튀어나온 요소,
// 가로 넘침, 콘솔 오류를 화면 크기별로 검출한다. 문제 0건이 통과 기준.
// 선행: npm i -D playwright(+install chromium). 크로미엄 경로는 CHROMIUM_PATH.
// 네트워크가 막힌 환경에서는 VENDOR_DIR에 d3.min.js·gsap.min.js·fonts.css를 두면 그것으로 대신 응답한다.
// 사용: node scripts/e2e/e2e-deckaudit.mjs [shots] [only=1,2] [vp=1440x900,390x844]
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const OUT = path.resolve('audit')
const FILE = pathToFileURL(path.resolve(import.meta.dirname, '../../docs/research/tripod/tripod-deck.html')).href
const V = process.env.VENDOR_DIR
fs.mkdirSync(OUT, { recursive: true })
const SHOTS = process.argv.includes('shots')
const ONLY = process.argv.find((a) => a.startsWith('only='))?.slice(5).split(',').map(Number)
const VPS = (process.argv.find((a) => a.startsWith('vp='))?.slice(3) || '1440x900,1280x720,1024x768,390x844,360x740').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h } })
const exec = process.env.CHROMIUM_PATH
const browser = await chromium.launch(exec ? { executablePath: exec } : {})
const fontCache = new Map()
async function route(page) {
  if (!V) return
  await page.route('**/*', async (r) => {
    const u = r.request().url()
    if (u.includes('d3.min.js')) return r.fulfill({ body: fs.readFileSync(`${V}/d3.min.js`), contentType: 'application/javascript' })
    if (u.includes('gsap.min.js')) return r.fulfill({ body: fs.readFileSync(`${V}/gsap.min.js`), contentType: 'application/javascript' })
    if (u.startsWith('https://fonts.googleapis.com/')) return r.fulfill({ body: fs.readFileSync(`${V}/fonts.css`), contentType: 'text/css' })
    if (u.startsWith('https://fonts.gstatic.com/')) {
      if (!fontCache.has(u)) fontCache.set(u, execFileSync('curl', ['-sS', u]))
      return r.fulfill({ body: fontCache.get(u), contentType: 'font/woff2' })
    }
    return r.continue()
  })
}

// 페이지 안에서 실행하는 검사
function inspect() {
  const out = []
  const s = [...document.querySelectorAll('.slide')].find((x) => !x.hidden)
  const sr = s.getBoundingClientRect()
  const R = (e) => e.getBoundingClientRect()
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const txt = (e) => (e.textContent || '').trim().slice(0, 28)
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('페이지 가로 스크롤')
  if (s.scrollWidth > s.clientWidth + 1) out.push(`슬라이드 가로 넘침 ${s.scrollWidth - s.clientWidth}px`)
  // 스크롤 컨테이너(표) 안쪽은 제외
  const scrollers = [...s.querySelectorAll('.tblwrap, pre')].filter((c) => c.scrollWidth > c.clientWidth + 1)
  scrollers.forEach((c) => out.push(`(정보) 가로 스크롤 표: ${txt(c)}`))
  const inScroller = (e) => scrollers.some((c) => c.contains(e))
  // 패널·타일·카드 밖으로 튀어나온 요소
  for (const box of s.querySelectorAll('.panel, .tile, .vcard, .miss, .col, .steps li, .opt, .chart')) {
    const br = R(box)
    for (const e of box.querySelectorAll('*')) {
      if (inScroller(e) || e.closest('#tip')) continue
      if (e.matches('.hit, rect.hit')) continue
      const r = R(e)
      if (!r.width || !r.height) continue
      const tol = 2
      if (r.right > br.right + tol || r.left < br.left - tol || r.bottom > br.bottom + tol || r.top < br.top - tol) {
        const tag = e.tagName.toLowerCase()
        if (tag === 'g' || tag === 'svg') continue
        out.push(`튀어나옴 [${box.className.split(' ')[0]}] <${tag}> "${txt(e)}" (${Math.round(Math.max(r.right - br.right, br.left - r.left, r.bottom - br.bottom, br.top - r.top))}px)`)
      }
    }
  }
  // 슬라이드 프레임 밖(가로)
  for (const e of s.querySelectorAll('*')) {
    if (inScroller(e)) continue
    const r = R(e)
    if (!r.width) continue
    if (r.right > sr.right + 1 || r.left < sr.left - 1) { out.push(`화면 밖 <${e.tagName.toLowerCase()}> "${txt(e)}"`); break }
  }
  // SVG 글자 겹침과 글자-표식 겹침
  for (const svg of s.querySelectorAll('.chart svg')) {
    const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() && getComputedStyle(t).opacity !== '0')
    const tb = texts.map((t) => { const r = R(t); return { t, r: { left: r.left + 1, right: r.right - 1, top: r.top + 1, bottom: r.bottom - 1 } } })
    for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
      const a = tb[i].r, b = tb[j].r
      const area = inter(a, b)
      if (area > 2) out.push(`글자 겹침 "${txt(tb[i].t)}" × "${txt(tb[j].t)}"`)
    }
    // 표식
    const marks = []
    svg.querySelectorAll('circle').forEach((c) => { if (getComputedStyle(c).opacity === '0' || c.classList.contains('xdot')) return; marks.push({ kind: c.classList.contains('dot-swarm') ? '점(분포)' : '점', r: R(c) }) })
    svg.querySelectorAll('path.anim-bar, path.anim-hbar, rect.anim-wipe').forEach((b) => marks.push({ kind: '막대', r: R(b) }))
    // 선: 경로를 따라 표본점
    const linePts = []
    svg.querySelectorAll('path.ln, line.ref, line.base').forEach((p) => {
      const kind = p.classList.contains('ln') ? '선' : p.classList.contains('ref') ? '기준선' : '0선'
      const m = p.getScreenCTM()
      if (!m) return
      if (p.tagName === 'line') {
        const x1 = +p.getAttribute('x1'), x2 = +p.getAttribute('x2'), y1 = +p.getAttribute('y1'), y2 = +p.getAttribute('y2')
        const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3))
        for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; linePts.push({ kind, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }) }
        return
      }
      const L = p.getTotalLength()
      for (let d = 0; d <= L; d += 3) { const q = p.getPointAtLength(d); linePts.push({ kind, x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }) }
    })
    for (const { t, r } of tb) {
      if (t.closest('.ax') && !t.classList.contains('ref-t')) {
        // 축 눈금 글자는 선과만 검사(막대·점은 축 밖)
      }
      const hitM = marks.filter((mk) => inter(r, mk.r) > 3)
      if (hitM.length) out.push(`글자-${hitM[0].kind} 겹침 "${txt(t)}" (${hitM.length}개)`)
      const kinds = new Set(linePts.filter((pt) => pt.x > r.left && pt.x < r.right && pt.y > r.top && pt.y < r.bottom).map((pt) => pt.kind))
      for (const k of kinds) out.push(`글자-${k} 겹침 "${txt(t)}"`)
    }
  }
  // HTML 글자 잘림
  for (const e of s.querySelectorAll('.chip, .big, .res, .eyebrow, h2, h3')) if (e.scrollWidth > e.clientWidth + 1) out.push(`HTML 잘림 "${txt(e)}"`)
  const vfit = s.scrollHeight > s.clientHeight + 1 ? s.scrollHeight - s.clientHeight : 0
  return { title: s.dataset.title, issues: [...new Set(out)], vscroll: vfit }
}

const report = {}
for (const vp of VPS) {
  const key = `${vp.width}x${vp.height}`
  const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await route(page)
  await page.goto(FILE)
  await page.waitForTimeout(1200)
  const N = await page.evaluate(() => document.querySelectorAll('.slide').length)
  report[key] = []
  for (let n = 1; n <= N; n++) {
    if (ONLY && !ONLY.includes(n)) continue
    await page.evaluate((k) => { location.hash = `#s${k}` }, n)
    await page.waitForTimeout(250)
    await page.evaluate(() => { if (window.gsap) gsap.globalTimeline.getChildren(true, true, true).forEach((t) => t.progress(1)) })
    await page.waitForTimeout(150)
    const r = await page.evaluate(inspect)
    report[key].push({ n, ...r })
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `deck-${key}-${String(n).padStart(2, '0')}.png`) })
  }
  if (errs.length) report[key].push({ errors: [...new Set(errs)] })
  await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'deck-audit.json'), JSON.stringify(report, null, 1))
let bad = 0
for (const [k, rows] of Object.entries(report)) {
  const badRows = rows.filter((r) => r.errors || (r.issues && r.issues.filter((i) => !i.startsWith('(정보)')).length))
  bad += badRows.length
  console.log(`\n== ${k}: 문제 슬라이드 ${badRows.length}개, 세로 스크롤 필요 ${rows.filter((r) => r.vscroll > 0).map((r) => `${r.n}(${r.vscroll})`).join(' ') || '없음'}`)
  for (const r of badRows) {
    if (r.errors) { console.log('  오류', r.errors); continue }
    console.log(`  #${r.n} ${r.title}`)
    for (const i of r.issues.filter((x) => !x.startsWith('(정보)')).slice(0, 12)) console.log(`     - ${i}`)
  }
}
process.exit(bad ? 1 : 0)
