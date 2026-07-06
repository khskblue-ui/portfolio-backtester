/**
 * Cloudflare Pages Function: Yahoo Finance 프록시
 *
 * /yf/* 경로를 Yahoo Finance API로 중계합니다 (브라우저 CORS 우회).
 * 공개 시장 데이터만 다루므로 CORS는 '*' 허용, 경로는 chart API로 제한.
 *
 * 예: /yf/v8/finance/chart/VOO?interval=1d&range=max&events=div
 *   → https://query1.finance.yahoo.com/v8/finance/chart/VOO?...
 */

const ALLOWED_PREFIXES = ['v8/finance/chart/', 'v8/finance/spark']

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

  // 경로 allowlist — 알려진 Yahoo chart API만 중계 (오픈 프록시 방지)
  if (!ALLOWED_PREFIXES.some((prefix) => pathStr.startsWith(prefix))) {
    return new Response(JSON.stringify({ error: '허용되지 않은 경로입니다' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const originalUrl = new URL(request.url)
  const targetUrl = `https://query1.finance.yahoo.com/${pathStr}${originalUrl.search}`

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })

    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
        // 일별 데이터라 1시간 엣지 캐시로 충분 (스냅샷 해시가 변경 감지 담당)
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
