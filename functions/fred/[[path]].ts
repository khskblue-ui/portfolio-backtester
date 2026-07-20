/**
 * Cloudflare Pages Function: FRED 프록시
 *
 * /fred/* 경로를 세인트루이스 연준 FRED CSV로 중계합니다 (브라우저 CORS 우회).
 * Vercel 배포의 vercel.json rewrite(/fred/fredgraph.csv)와 동일 동작 —
 * '현재 신호'의 금리·CPI 조회와 '역사 연구'의 나스닥 오버레이가 사용.
 *
 * 예: /fred/fredgraph.csv?id=DGS10&cosd=2026-05-01
 *   → https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2026-05-01
 */

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

  // 경로 allowlist — fredgraph CSV만 중계 (오픈 프록시 방지)
  if (pathStr !== 'fredgraph.csv') {
    return new Response(JSON.stringify({ error: '허용되지 않은 경로입니다' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const originalUrl = new URL(request.url)
  const targetUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv${originalUrl.search}`

  try {
    const response = await fetch(targetUrl)
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/csv',
        'Cache-Control': 'public, max-age=3600',
        ...corsHeaders,
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'FRED 중계 실패' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }
}
