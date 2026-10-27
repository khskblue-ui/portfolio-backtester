// dist를 4175 포트로 서빙하는 E2E용 정적 서버.
// /yf, /fred, /tripod-signal 프록시 경로는 404로 막아 라이브 데이터 폴백 없이 결정적으로 테스트한다.
// FIXTURES=1이면 /yf 일별 조회를 저장소 스냅숏(data-src/tripod/*.csv)으로 야후 v8 형식에 맞춰 응답한다
// (외부 접속 없이 실제 데이터로 백테스트 흐름 전체를 돌리는 e2e-tripodrun.mjs용).
// 사용: npm run build && node scripts/e2e/staticserver.mjs &   (또는 FIXTURES=1 node scripts/e2e/staticserver.mjs &)
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIST = join(ROOT, 'dist')
const SNAP = join(ROOT, 'data-src', 'tripod')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }
const FIXTURES = process.env.FIXTURES === '1'
/** 야후 심볼 → 스냅숏 파일 이름 */
const FIX = { QQQ: 'QQQ', QLD: 'QLD', TQQQ: 'TQQQ', SPY: 'SPY', '^NDX': 'NDX', '^VIX': 'VIX', '^IRX': 'IRX', '^GSPC': 'GSPC', '^IXIC': 'IXIC' }

function yahooFixture(symbol) {
  const name = FIX[symbol]
  if (!name || !existsSync(join(SNAP, `${name}.csv`))) return null
  const rows = readFileSync(join(SNAP, `${name}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
  // 미국 동부 09:30 = UTC 14:30 (gmtoffset −18000이면 그날 날짜로 해석됨)
  const ts = (d) => Date.parse(`${d}T14:30:00Z`) / 1000
  const dividends = {}
  const divFile = join(SNAP, `${name}-div.csv`)
  if (existsSync(divFile)) {
    for (const l of readFileSync(divFile, 'utf8').trim().split('\n').slice(1)) {
      const [d, amt] = l.split(',')
      dividends[String(ts(d))] = { amount: Number(amt), date: ts(d) }
    }
  }
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: -18000, dataGranularity: '1d', firstTradeDate: ts(rows[0][0]) },
          timestamp: rows.map((r) => ts(r[0])),
          events: { dividends },
          indicators: {
            quote: [{ open: rows.map((r) => Number(r[1])), close: rows.map((r) => Number(r[4])) }],
            adjclose: [{ adjclose: rows.map((r) => (r[5] === '' ? Number(r[4]) : Number(r[5]))) }],
          },
        },
      ],
    },
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (FIXTURES && url.pathname.startsWith('/yf/v8/finance/chart/')) {
    const body = yahooFixture(decodeURIComponent(url.pathname.split('/').pop()))
    if (!body) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }
  if (url.pathname.startsWith('/yf/') || url.pathname.startsWith('/fred/') || url.pathname.startsWith('/tripod-signal/')) { res.writeHead(404); res.end(); return }
  let file = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!existsSync(file)) file = join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(Number(process.env.PORT ?? 4175), () => console.log(`static on ${process.env.PORT ?? 4175}${FIXTURES ? ' (yf fixtures)' : ''}`))
