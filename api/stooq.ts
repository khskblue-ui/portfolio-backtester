/**
 * Vercel Serverless Function: Stooq 프록시
 *
 * /stooq/q/d/l/?s=xauusd&i=d → (rewrite) → /api/stooq?s=xauusd&i=d
 *
 * 외부 리라이트 대신 함수를 쓰는 이유: Stooq의 CSV 엔드포인트는 트레일링
 * 슬래시(/q/d/l/)가 필수인데 Vercel 경로 리라이트가 이를 보존하지 않아
 * 404가 났음. 함수에서 정확한 URL을 직접 구성하고, stooq.com 실패 시
 * 미러(stooq.pl)로 폴백해 가용성을 높인다.
 */

interface StooqRequest {
  query: Record<string, string | string[] | undefined>
}

interface StooqResponse {
  status(code: number): StooqResponse
  setHeader(key: string, value: string): void
  send(body: string): void
}

const HOSTS = ['stooq.com', 'stooq.pl']

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/csv, text/plain, */*',
}

export default async function handler(req: StooqRequest, res: StooqResponse) {
  const s = String(Array.isArray(req.query.s) ? req.query.s[0] : (req.query.s ?? '')).toLowerCase()
  const i = String(Array.isArray(req.query.i) ? req.query.i[0] : (req.query.i ?? 'd'))

  // 심볼 화이트리스트 패턴 (오픈 프록시 방지)
  if (!/^[a-z0-9._^=-]{1,24}$/.test(s) || !/^[a-z]$/.test(i)) {
    res.status(400).send('invalid symbol')
    return
  }

  let lastStatus = 502
  let lastBody = 'proxy error'

  for (const host of HOSTS) {
    try {
      const url = `https://${host}/q/d/l/?s=${encodeURIComponent(s)}&i=${encodeURIComponent(i)}`
      const r = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Referer: `https://${host}/` },
        signal: AbortSignal.timeout(15000),
      })
      const body = await r.text()
      lastStatus = r.status
      lastBody = body
      // 정상 CSV면 즉시 반환, 아니면(한도 페이지·404 등) 다음 호스트 시도
      if (r.ok && body.startsWith('Date')) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
        res.status(200).send(body)
        return
      }
    } catch {
      // 타임아웃/네트워크 — 다음 호스트로
    }
  }

  // 모든 호스트 실패 — 마지막 응답을 그대로 전달 (클라이언트가 본문 보고 원인 분류)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.status(lastStatus === 200 ? 502 : lastStatus).send(lastBody.slice(0, 500))
}
