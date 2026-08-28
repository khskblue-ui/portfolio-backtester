import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @ts-expect-error vitest 필드 — vite 타입에는 없지만 vitest가 읽는다
  test: {
    // .claude/worktrees/ 안의 병렬 세션 워크트리가 테스트를 이중 발견하는 것 방지
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.omc/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
        },
      },
    },
  },
  server: {
    proxy: {
      // Stooq: 장기 히스토리 CSV (금 현물 XAUUSD 1968~ 등) — 프로덕션은 functions/stooq
      '/stooq': {
        target: 'https://stooq.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/stooq/, ''),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://stooq.com/',
        },
      },
      // FRED: 프로덕션은 vercel.json rewrite(또는 functions/fred)가 담당 —
      // dev 서버에서도 /fred/fredgraph.csv가 동작하도록 프록시
      '/fred': {
        target: 'https://fred.stlouisfed.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/fred/, '/graph'),
      },
      // Yahoo Finance: 프로덕션은 Cloudflare Pages Function(functions/yf)이 담당 —
      // dev 서버에서도 동일한 /yf/* 경로가 동작하도록 프록시
      '/yf': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yf/, ''),
        // 프로덕션 프록시(functions/yf)와 동일한 브라우저 UA — 429 완화
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    },
  },
})
