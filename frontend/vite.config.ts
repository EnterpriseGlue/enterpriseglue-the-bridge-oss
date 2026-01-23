import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const proxyTarget = (globalThis as any).process?.env?.DEV_PROXY_TARGET || 'http://localhost:8787'

  // Expose feature flags to frontend via import.meta.env
  const multiTenant = (globalThis as any).process?.env?.MULTI_TENANT

  return {
    plugins: [react()],
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
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/engines-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/starbase-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/mission-control-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/git-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/vcs-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/health': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/engines-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/starbase-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/mission-control-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/git-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/vcs-api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/health': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
