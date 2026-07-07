/**
 * Cloudflare Pages Function: Stooq 프록시
 *
 * /stooq/* 경로를 stooq.com으로 중계합니다 (장기 히스토리 CSV — 금 현물 XAUUSD 1968~ 등).
 * 일별 CSV 다운로드 경로만 허용 (오픈 프록시 방지).
 *
 * 예: /stooq/q/d/l/?s=xauusd&i=d → https://stooq.com/q/d/l/?s=xauusd&i=d
 */

const ALLOWED_PREFIXES = ['q/d/l']

export const onRequest: PagesFunction = async ({ request, params }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const pathSegments = params.path
  const pathStr = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments ?? '')

  if (!ALLOWED_PREFIXES.some((prefix) => pathStr.startsWith(prefix))) {
    return new Response(JSON.stringify({ error: '허용되지 않은 경로입니다' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const originalUrl = new URL(request.url)
  const targetUrl = `https://stooq.com/${pathStr}${originalUrl.search}`

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/csv, text/plain, */*',
        Referer: 'https://stooq.com/',
      },
      signal: AbortSignal.timeout(15000),
    })

    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'text/csv',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        ...corsHeaders,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error'
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
}
