// dist를 4175 포트로 서빙하는 E2E용 정적 서버.
// /yf, /fred 프록시 경로는 404로 막아 라이브 데이터 폴백 없이 결정적으로 테스트한다.
// 사용: npm run build && node scripts/e2e/staticserver.mjs &
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/yf/') || url.pathname.startsWith('/fred/')) { res.writeHead(404); res.end(); return }
  let file = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!existsSync(file)) file = join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(4175, () => console.log('static on 4175'))
