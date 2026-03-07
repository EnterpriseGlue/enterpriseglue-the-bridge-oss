import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createRequire } from 'node:module'

export default defineConfig(({ mode }) => {
  const proxyTarget = (globalThis as any).process?.env?.DEV_PROXY_TARGET || 'http://localhost:8787'

  const require = createRequire(import.meta.url)
  let proxyPatterns = [
    '^/t/[^/]+/api',
    '^/t/[^/]+/engines-api',
    '^/t/[^/]+/starbase-api',
    '^/t/[^/]+/mission-control-api',
    '^/t/[^/]+/git-api',
    '^/t/[^/]+/vcs-api',
    '^/t/[^/]+/health',
    '/api',
    '/engines-api',
    '/starbase-api',
    '/mission-control-api',
    '/git-api',
    '/vcs-api',
    '/health',
  ]
  try {
    const proxyConfig = require('@enterpriseglue/frontend-host/proxy-routes.json') as {
      proxyPatterns: string[]
    }
    if (proxyConfig?.proxyPatterns?.length) {
      proxyPatterns = proxyConfig.proxyPatterns
    }
  } catch (error) {
    console.warn('Using fallback proxy routes (proxy-routes.json not found).')
  }
  const proxyRoutes = Object.fromEntries(
    proxyPatterns.map((pattern) => [
      pattern,
      { target: proxyTarget, changeOrigin: true },
    ]),
  )

  // Expose feature flags to frontend via import.meta.env
  const multiTenant = (globalThis as any).process?.env?.MULTI_TENANT

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@src': path.resolve(__dirname, '../packages/frontend-host/src'),
      },
    },
    esbuild: {
      jsxDev: mode !== 'production',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      // Expose MULTI_TENANT to frontend (same name as backend for consistency)
      ...(multiTenant !== undefined && {
        'import.meta.env.MULTI_TENANT': JSON.stringify(multiTenant),
      }),
    },
    server: {
      port: 5173,
      headers: {
        // Allow eval in development (removes CSP warning)
        // Allow Carbon Design System fonts from IBM CDN + data URIs for embedded fonts
        // Allow API calls to backend on localhost:8787
        // Allow images including data URIs (inline SVGs)
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://1.www.s81c.com; font-src 'self' data: https://fonts.gstatic.com https://1.www.s81c.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:8787;",
      },
      proxy: proxyRoutes,
    },
    preview: {
      proxy: proxyRoutes,
    },
  }
})
